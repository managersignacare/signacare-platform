# BUG-239 — WebAuthn cryptographic verification is a placeholder (silent MFA bypass)

> **Post-hoc backfill.** Plan doc created after commit. This is the most recent of the backfilled set; the deliberation trail is more complete.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-1 (critical blockers) |
| Change-class | risky (auth surface + new dependency + security-critical) |
| Commit SHA | `333ae71` |
| Fix-registry anchor | R-FIX-WEBAUTHN-REAL-CRYPTO |
| Discovered | pre-plan |
| Closed | 2026-04-20 |

## 2. Diagnosis

**Root cause:** `apps/api/src/features/auth/webauthnRoutes.ts` at lines 143 (register/verify) and 237 (login/verify) accepted any credential payload with a matching `credential_id` and persisted client-echoed material (`JSON.stringify(credential.response)`) as the public key — no signature verification, no origin validation, no RP ID hash check. Any actor who knew a staff email could mint `{verified: true, staffId}` by POSTing an arbitrary payload.

**Classification:** isolated — two placeholder call-sites, one module.

**Other instances:** grep confirmed no `verifySignaturePlaceholder` pattern elsewhere. `breakGlassRoutes.ts` sibling uses separate TOTP (speakeasy) — independent.

## 3. Approach

**Gold-standard fix:** install `@simplewebauthn/server@13.3.0` (MIT) and wire `verifyRegistrationResponse` + `verifyAuthenticationResponse` into the existing route handlers. Key discipline:
- Library-derived `credential.id`, `credential.publicKey`, `credential.counter` persisted (NEVER client echo).
- `expectedChallenge` from existing Redis atomic GET+DEL pattern (unchanged).
- `expectedOrigin` + `expectedRPID` from env (`WEBAUTHN_ORIGIN` comma-list + `WEBAUTHN_RP_ID`).
- Counter-regression guard retained as defence-in-depth on top of library's `verified` flag. Exception only when both stored and new are 0 (some authenticators never implement counter).

**Pattern cited:** `apps/api/src/features/auth/breakGlassRoutes.ts` uses `HttpError` for route-layer errors (15+ call sites). This file already used `HttpError` 9× pre-existing. Kept consistent.

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Roll-your-own WebAuthn verify | Crypto is unforgiving; use audited library (catalogued) |
| Leave TODO, mark GAP-10 as partial | Compliance regression — GAP-10 was declared CLOSED under false pretenses |
| Store client-echoed `credential.response` (original placeholder behaviour) | Keeps the silent-MFA-bypass vector |
| Switch to `AppError` class | `AppError extends HttpError` — they're the same; switching mid-file would INTRODUCE inconsistency with the 9 pre-existing `HttpError` calls + the sibling `breakGlassRoutes.ts` |

## 5. Reviewer refinement trail

**Round 1 — REFINED (not rejected).** Reviewer flagged four issues:

1. **Fix-registry anchor drift** — proposed `R-FIX-WEBAUTHN-CRYPTO-VERIFY`; catalogue [line 322](../bug-catalogue-v2.yaml#L322) had already locked `R-FIX-WEBAUTHN-REAL-CRYPTO`. **ACCEPTED.** Adopted catalogue name.
2. **Error class choice** — reviewer said "only AppError is approved; switch or escalate." **REBUT with source citation.** `packages/shared/src/errors.ts` does NOT exist in this repo; `apps/api/src/shared/errors.ts:49` has `AppError extends HttpError` as a convenience subclass. HttpError is the de facto pattern in `webauthnRoutes.ts` (9 uses) and sibling `breakGlassRoutes.ts` (15+). Switching to AppError for only this commit would introduce inconsistency — the real pattern-migration belongs in Sprint B-7 if desired.
3. **MIT licence "required escalation per plan"** — reviewer said plan requires MIT check. **REBUT framing, ACCEPT action.** Plan has no such clause, but licence check is good hygiene regardless — recorded explicit acceptance in commit body.
4. **Integration filename** — reviewer said "mechanical plan specifies `webauthnEndToEnd.int.test.ts`." **REBUT framing, ACCEPT filename.** No such plan in repo (grep confirmed). Chose the name on own merit for traceability.

**Self-audit moment:** after the refinement, the user challenged whether I had critically analysed the reviewer's claims. Two of the reviewer's citations (mechanical plan for filename; plan-mandated MIT escalation) were fabricated. Lesson captured: apply the same critical-analysis discipline to reviewer feedback as to my own proposals — reviewer text is not privileged source.

## 6. Implementation outline

**Files touched:**
- `apps/api/package.json` + `package-lock.json` — `@simplewebauthn/server@13.3.0` added.
- `apps/api/src/features/auth/webauthnRoutes.ts` — both placeholders replaced; `getExpectedRpId()` + `getExpectedOrigins()` file-local helpers; try/catch around library calls; library-derived storage.
- `apps/api/.env.example` — documents `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGIN`; explicitly defers startup enforcement to BUG-233.
- `apps/api/tests/unit/webauthnVerify.test.ts` — 6 unit tests.
- `apps/api/tests/integration/webauthnEndToEnd.int.test.ts` — 2 integration tests.
- `docs/fix-registry.md` — `R-FIX-WEBAUTHN-REAL-CRYPTO` row.
- `docs/audit-2026-04-19/follow-up-on-cloud-deploy.md` — §11 proxy-layer Host-header hygiene.
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-239 state → `fixed`, `files_touched` populated, `licence_acceptance` block added.

**Key shape (register/verify):**
```typescript
const verification = await verifyRegistrationResponse({
  response: credential as unknown as RegistrationResponseJSON, // @intentional above
  expectedChallenge,
  expectedOrigin: getExpectedOrigins(),
  expectedRPID: getExpectedRpId(),
  requireUserVerification: false,
});
if (!verification.verified || !verification.registrationInfo) throw new HttpError(401, 'INVALID_CREDENTIAL', ...);
const info = verification.registrationInfo;
await db('webauthn_credentials').insert({
  staff_id: userId, clinic_id: clinicId,
  credential_id: info.credential.id,                                          // library-derived
  public_key: Buffer.from(info.credential.publicKey).toString('base64url'),   // library-derived
  counter: info.credential.counter,                                           // library-derived
  aaguid: info.aaguid,
  backup_eligible: info.credentialDeviceType === 'multiDevice',
  backup_state: info.credentialBackedUp,
});
```

## 7. Tests

**Unit tests (`webauthnVerify.test.ts`) — 6 tests:**
1. `verifyRegistrationResponse` called with expected challenge + origin + RPID.
2. Library-derived `credential.id` + `publicKey` + `counter` persisted (NOT client echo).
3. Register `verified:false` → 401 INVALID_CREDENTIAL, no INSERT.
4. Login replay via consumed challenge → 400 CHALLENGE_EXPIRED.
5. Login `verified:false` → 401 INVALID_CREDENTIAL, no counter UPDATE.
6. Login `verified:true` + `newCounter <= storedCounter` → 401 COUNTER_REGRESSION, no counter UPDATE.

**Integration tests (`webauthnEndToEnd.int.test.ts`) — 2 tests against live Postgres + Redis (library mocked for determinism):**
1. Register→login round trip: row stored with `clinic_id` (RLS-scoped), library-derived `credential_id`, counter advances on login.
2. `verified:false` rejects login AND leaves stored counter unchanged.

**Red-first trace:**
- Pre-fix: 5 of 6 unit tests FAIL. 1 passes (replay-via-consumed-challenge) because Redis challenge consumption was pre-existing correct behaviour.
- Post-fix: 6 of 6 unit tests PASS + 2 of 2 integration tests PASS.

## 8. Verification trace

- Original failing scenario — POST `/login/verify` with crafted payload → pre-fix: 200 + counter incremented; post-fix: 401 INVALID_CREDENTIAL.
- Null/empty credential → Zod rejects at boundary.
- Concurrent replay → atomic Redis GET+DEL; losing worker gets CHALLENGE_EXPIRED.
- Missing `WEBAUTHN_ORIGIN` → dev fallback `http://localhost:3000`; production startup enforcement = BUG-233 scope.
- Expired challenge → CHALLENGE_EXPIRED via 5-min Redis TTL.
- Max payload → Zod + browser spec both cap.

## 9. Residual risk

- **Origin/RP enforcement at reverse-proxy layer** — application-layer is authoritative; proxy Host-header hygiene is defence-in-depth (follow-up doc §11).
- **Attestation MDS checks** — deferred per pre-existing `@note` until hardware-key-only is enforced as product decision.
- **Env-var startup validation** — BUG-233 scope (Wave A-4).
- **Protobufjs critical transitive CVE** (GHSA-xq3m-2v4x-88gg) surfaced by `npm audit` — pre-existing via google-auth; NOT introduced by this commit. Backlog follow-up.
- **5 pre-existing `req.user!` non-null-bang + 1 pre-existing logger-import violations** in this file — explicitly out-of-scope per principal-engineer rule 3.1 #4 (no scope creep). Would be addressed in Sprint B-5 or B-7.

## 10. CAB / change-control notes

- Catalogue state → `fixed`.
- **Licence acceptance recorded:** `@simplewebauthn/server@13.3.0`, **MIT**, verified via `npm view @simplewebauthn/server license version` at 2026-04-20. MIT compatible with Signacare's open-source allowlist posture.

## 11. QA agent verdicts

- **L1 static:** FAIL with pre-existing-outside-scope (5 × `req.user!`, 1 × logger import) + 1 × declared-class-mismatch (expected — declared in commit body). Zero new violations introduced.
- **L2 narrative:** PASS — PR-template sections present, red-first trace enumerated.
- **L3 code judgement:** APPROVE — 7/7 dimensions. Two non-blocking nits: tighten Zod schema to retire `as unknown as` casts; track protobufjs CVE.
- **L4 clinical safety:** APPROVE — 8/8 dimensions. Non-blocking follow-up: sanitise library error messages.
- **L5 architecture:** APPROVE — 5/5 standards.
