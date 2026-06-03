# BUG-180 — 37 production TODO/FIXME/HACK markers across apps/{api,web}/src

> **Post-hoc backfill.** Plan doc created after commit.

## 1. Metadata

| | |
|---|---|
| Severity | S2 |
| Track | A |
| Wave | A-0 (pre-flight) |
| Change-class | standard (documentation + annotation sweep) |
| Commit SHA | `19bdf5b` |
| Fix-registry anchor | R-FIX-TODO-TRIAGE-COMPLETE |
| Discovered | pre-plan |
| Closed | 2026-04-20 |

## 2. Diagnosis

**Root cause:** 37 raw `TODO`/`FIXME`/`HACK`/`XXX` markers existed across `apps/api/src` and `apps/web/src` production paths. Each was either (a) a real unresolved bug hidden behind a comment, (b) a valid engineering note without structured attribution, or (c) obsolete. The L1 QA agent check `L1.7 no-production-todo` rejects these unconditionally — without triage the check can't go green.

**Classification:** isolated per marker, but programme-wide in aggregate. Sweep required.

## 3. Approach

**Gold-standard sweep:** classify every marker into one of three buckets and act:
1. **Real bug** → file new BUG row in catalogue, replace marker with `// @catalogued: BUG-NNN (Wave N)` annotation.
2. **Valid note** → replace marker with `// @note: <reason>` (becomes first-class documentation, not a latent bug).
3. **Obsolete** → delete.

All markers in scope: `apps/api/src/**/*.ts` + `apps/web/src/**/*.ts` + `apps/web/src/**/*.tsx`. Patient-app and other non-production paths explicitly out of scope per scope-creep concern (see refinement trail).

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Broad allowlist (let L1 skip TODOs under a category) | Defeats the guard — we'd still have latent bugs masquerading as TODOs |
| Delete all TODOs | Several carry real engineering context that deserves first-class @note documentation |
| Include patient-app scope | Scope creep; patient-app is a separate deployment target — handle in its own triage |

## 5. Reviewer refinement trail

**Initial proposal — REJECTED.** Reviewer feedback:
1. Scope crept into `apps/patient-app` — out of scope for this bug.
2. Missed a fix-registry row.
3. Proposed XXX allowlist was too broad — would bypass L1 for real TODOs.

**Revised proposal — accepted:**
1. Scope locked to `apps/{api,web}/src`; patient-app explicitly out.
2. Added `R-FIX-TODO-TRIAGE-COMPLETE` row with `absent` anchor on a representative TODO marker in `webauthnRoutes.ts`.
3. Narrow `L1_7_ALLOWLIST` with exact file + pattern tuples — only AU phone-mask literals (`04XX XXX XXX`, `0412 XXX XXX`) in specific demographic / seed files. NOT a blanket XXX skip.

## 6. Implementation outline

**Files touched:** 28 production files + `scripts/qa-agent/level-1-static.ts` + catalogue + fix-registry.

**Triage outcome (representative):**
- BUG-238 (new) — `hl7Worker.ts:139` HL7 transport TODO (real bug, catalogued).
- BUG-239 (new) — `webauthnRoutes.ts` ×3 WebAuthn crypto TODOs (real bug, catalogued).
- BUG-241 (new) — `apps/web/src/features/**/queryKeys.ts` ×14 query-key-factory TODOs (real bug, catalogued).
- BUG-242 (new) — nurse escalation TODO (real bug, catalogued).
- ~10 markers → `@note:` annotations.
- ~10 markers → deleted as obsolete.

**Allowlist shape:**
```typescript
const L1_7_ALLOWLIST: ReadonlyArray<{ file: string; pattern: RegExp }> = [
  { file: 'apps/web/src/features/patients/components/registration/Step1Demographics.tsx', pattern: /04XX XXX XXX/ },
  { file: 'apps/web/src/features/patients/components/registration/EditPatientWizard.tsx', pattern: /04XX XXX XXX/ },
  { file: 'apps/api/src/seed-all-verticals.ts', pattern: /Ph 0412 XXX XXX/ },
  { file: 'apps/api/src/seed-test-data.ts', pattern: /0412 XXX XXX|0413 XXX XXX/ },
];
```

## 7. Tests

No new runtime tests. Verification is the L1 QA agent check `L1.7 no-production-todo` passing against the swept paths.

**Red-first:** before sweep, L1 returned 37 violations. After sweep, 0 violations in scope.

## 8. Verification trace

- L1.7 against `apps/api/src`: 0 TODO/FIXME/HACK/XXX violations.
- L1.7 against `apps/web/src`: 0 violations.
- Fix-registry anchor `\bTODO\(@simplewebauthn` — must be **absent** in webauthnRoutes.ts — anchor trips if any future commit reintroduces the representative TODO.
- AU phone-mask allowlist narrow enough that a random `XXX` in an unrelated file would still fail.

## 9. Residual risk

- Four new BUG rows filed (238, 239, 241, 242) — these are the real work, now tracked.
- Allowlist could drift if future seed files adopt the phone-mask idiom but are not added — L1 will fail loudly; path forward is to add the specific file+pattern tuple.
- patient-app has its own TODO surface — separate triage needed when patient-app is next touched.

## 10. CAB / change-control notes

- Four new BUG rows added to catalogue (238, 239, 241, 242) — all tracked; no scope ambiguity.
- No new dependency, no licence acceptance.

## 11. QA agent verdicts

Fix pre-dates QA-agent L1-L5 framework going live for this BUG. Manual reviewer sign-off. L1 guard now actively enforces the post-sweep state.
