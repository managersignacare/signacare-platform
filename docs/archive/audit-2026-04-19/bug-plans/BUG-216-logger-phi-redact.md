# BUG-216 — PHI in structured logs (pino redact expansion)

> Plan doc authored at end of propose → review → execute cycle, co-committed with the fix.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-2 (patient safety) |
| Change-class | **risky** (PHI surface touched per plan PART 5.1) |
| Commit SHA | _pending_ |
| Fix-registry anchor | R-FIX-LOGGER-PHI-REDACT-EXPANDED |
| Discovered | pre-plan (EXECUTION-PLAN-v3-FULL.md line 818) |
| Closed | _pending_ |

## 2. Diagnosis

**Root cause:** `apps/api/src/utils/logger.ts:6-16` declares `PHI_FIELDS` with only 16 field names and `redact.paths` with only 6 paths, while the Signacare DB schema (`apps/api/src/db/schema-snapshot.json`) exposes at least 40+ PHI-flavoured column names actually used by repositories + services. A repository returning a patient row to `logger.info({ patient })` for debugging silently leaks address, next-of-kin, GP details, medicare metadata, and health fund numbers — all of which flow unredacted through Pino to the log sink.

**Classification:** **structural** — narrow fix (expand the list) closes immediate exposure; drift problem (schema adds columns → redaction list stays stale) is tracked separately via BUG-269.

**Other instances:** grep confirmed only one active logger module with redaction (`utils/logger.ts`); sibling `shared/logger.ts` is a 34-line console-based helper with no redaction (1 caller; tracked via BUG-268 for canonical-path reconciliation).

## 3. Approach

**Gold-standard fix:** expand `PHI_FIELDS` set from 16 → ~100 field names (snake_case + camelCase variants for every PHI category), keeping the recursive `redactPhi` helper. Expand `redact.paths` with pino wildcard patterns for known request-body shapes. Add a header comment documenting the maintenance rule: "any new PHI-flavoured column added to schema → add to PHI_FIELDS + re-run loggerRedaction test."

**Downstream impact:** every call to `logger.info/warn/error` with an object containing any of the expanded PHI field names now emits `[REDACTED]` instead of the value. Zero API surface change. One risk: legitimate non-PHI fields that happen to share a name (e.g. `email` for clinic contact) will also be redacted. Conservative call — those callers can rename to `clinic_contact_email` if unredacted visibility is needed.

**Pattern cited:** existing `PHI_FIELDS.has(k)` recursive walk in `redactPhi` — same mechanism, expanded inputs. Pino redact built-in paths follow the library's documented wildcard syntax.

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Regex-based PHI detection (e.g. phone-number pattern, email pattern, medicare pattern) | High false-positive rate; medicare numbers look like generic 10-digit ints; over-redaction would hide operationally useful IDs (order numbers, session IDs). Explicit field-name list is auditable. |
| Allow-list instead of deny-list (only specific fields pass through) | Breaking change — every log call everywhere would need adjustment. Scope explosion. |
| Leave `shared/logger.ts` as the canonical entry point per L1.14 | `shared/logger.ts` has ZERO redaction (34 lines, console.log based). Routing PHI-touching code through it would worsen the leak. Tracking that canonical-path conflict as BUG-268. |
| Fix `err.message` serializer in-scope | Larger change — requires rewriting pino's stdSerializers.err. Fired constraint violations can contain column values (`duplicate key violates medicare_number_uniq: (medicare_number)=(2123456789)`). Tracking as BUG-267. |

## 5. Reviewer refinement trail

**Round 1 — REFINED with 5 points. Two fabricated-authority citations rebutted with source; three technical points accepted on merit.**

1. **"Approved Wave A-2 action requires `check-log-no-phi.ts` guard."** REBUT — grep of plan files returns zero hits. The plan text for BUG-216 in sleepy-roaming-meteor.md and EXECUTION-PLAN-v3-FULL.md:818 says only "pino redact expansion / pino redact config" — no guard mandate. Third fabricated-authority citation across recent reviews (BUG-239 had two). **ACCEPTED on merit** — a preventive guard is a good idea independently; filed as BUG-269 (S2, B-11) to be designed with proper time for false-positive allowlist.

2. **"Reconcile shared/logger.ts canonical-path conflict before closure."** **ALREADY ADDRESSED** — original proposal filed BUG-268 for this. Reviewer's own acceptance criterion ("fix in-scope OR file adjacent bug before closure") satisfied.

3. **"Approved Wave A-2 exit criterion requires testing Pino against fixture patient object."** REBUT framing — grep returns zero hits for "fixture patient" in plans. Fabricated authority. **ACCEPTED on technical merit** — my initial test matrix only exercised the recursive `redactPhi` helper, missing the pino `redact.paths` built-in layer. Added test 6 which pipes real pino output through a captured stream and parses the JSON.

4. **"Reclassify as risky (PHI surface touched)."** ACCEPTED with source citation — plan PART 5.1 `risky — ANY: Auth/RLS/PHI surface touched`. My initial "standard" classification was wrong. Reclassified as risky → requires L3 + L4 + L5 subagent review.

5. **"Red-first artefact, not just narrative."** ACCEPTED — reviewer correctly flagged "Pre-fix: tests FAIL" as narrative only. Matches my BUG-239 / BUG-238 discipline. Actual captured FAIL + PASS output included in commit body.

## 6. Implementation outline

**Files touched:**
- `apps/api/src/utils/logger.ts` — expand `PHI_FIELDS` (16 → ~100 entries); expand `redact.paths`; add header maintenance note.
- **New** `apps/api/tests/unit/loggerRedaction.test.ts` — 6 tests (5 helper-level + 1 real-pino-stream).
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — file BUG-216 full row + BUG-267 (err.message) + BUG-268 (canonical logger path) + BUG-269 (preventive guard).
- `docs/fix-registry.md` — `R-FIX-LOGGER-PHI-REDACT-EXPANDED`.
- `docs/audit-2026-04-19/bug-plans/BUG-216-logger-phi-redact.md` — this plan doc.

**PHI_FIELDS categories** (all grounded in actual `pathology_orders` / `patients` / `staff` / `correspondence` / `appointments` schema columns):

- Names: patient + NOK + GP + provider + emergency-contact + caller + partner + recipient + preferred (~20 variants)
- Birth: dob, date_of_birth, birth_date
- Medicare/IHI/DVA: medicare_number, medicare_reference, medicare_expiry, ihi_number, dva_number, recipient_mhr_ihi
- Health fund: health_fund_number, health_fund_member_number, health_fund_name, private_health_fund
- Phone: home, mobile, work, nok, gp, provider, from_provider, emergency_contact, caller (+ camelCase)
- Email: primary, gp, provider, from_provider, outlook, recipient (+ camelCase)
- Address: street, line1, line2, suburb, state, postcode, gp_address_*, provider_address, recipient_address (+ camelCase)
- Auth/secrets: password, password_hash, mfa_secret (unchanged)

**redact.paths expansion** — keep existing 6 paths + add nested-request-body fast paths for `req.body.{email,phone,password,mfaSecret}`.

## 7. Tests

**Red-first trace:**
- Pre-fix: run `npx vitest run tests/unit/loggerRedaction.test.ts` against the existing 16-field PHI_FIELDS list. Expected: 4 of 6 tests FAIL (tests 1, 2, 5, 6 which rely on expanded fields; tests 3 non-PHI and 4 redact.paths pass with pre-fix config). **Actual captured FAIL log** pasted in commit body.
- Post-fix: same command. Expected: 6/6 PASS. **Actual captured PASS log** pasted in commit body.

**Test matrix:**
1. Every PHI_FIELDS entry as a flat object → `[REDACTED]` via recursive helper.
2. Nested: `{patient: {given_name, family_name, address}}` → all redacted at depth.
3. Non-PHI fields pass through: `{device_name, panel_name, drug_name, queue_name, brand_name}` — values preserved.
4. `redact.paths` fast path: `{req: {body: {password, email}}}` — both redacted.
5. Realistic audit log shape: `{clinicId, staffId, patient: {givenName, medicareNumber, phoneMobile, addressPostcode}}` — top-level IDs preserved, patient.* all redacted.
6. **Real Pino stream**: pipe a pino logger through an in-memory write stream, log a fixture patient row, parse the emitted JSON, assert PHI fields `[REDACTED]` and non-PHI preserved — tests the full stringify path, not just the recursive helper.

## 8. Verification trace

- **Original failing scenario** — `logger.info({ patient: { given_name: 'Jane', family_name: 'Doe', address_postcode: '3000' } })` pre-fix emits postcode verbatim; post-fix emits `[REDACTED]`.
- **Non-PHI preservation** — drug_name / panel_name / device_name / queue_name / brand_name are operational fields; post-fix still logged as plaintext.
- **Pino redact.paths fast path** — `{req: {body: {password: 'x'}}}` redacted via pino's C-level redactor (bypasses the recursive helper).
- **Real-stream test** — emitted JSON has `"address":"[REDACTED]"` not `"address":"1 Sesame St"` when the full pipeline runs.
- **err.message residual** — DB constraint violation with column name in the message still leaks (BUG-267 tracks).

## 9. Residual risk

- **err.message PHI leak** — pino's default `stdSerializers.err` prints `err.message` verbatim; DB constraint violations can embed column values. **BUG-267** (S1 A-2) filed for dedicated err-serializer redaction.
- **L1.14 guard inverted** — QA agent check enforces `shared/logger.ts` (no redaction) as canonical. **BUG-268** (S2 B-11) filed to fix guard + reconcile canonical path to `utils/logger.ts`.
- **Preventive guard missing** — no CI check scans logger calls for raw PHI-field additions that bypass the redaction set. **BUG-269** (S2 B-11) filed; designed with false-positive allowlist for audit-log shapes.
- **Schema drift** — new PHI columns don't auto-propagate to PHI_FIELDS. Mitigation: header comment in logger.ts naming the maintenance rule; BUG-269 provides the active check.
- **False positives on generic names** (`email`, `address`, `phone`) — legitimate non-PHI uses (clinic contact email, office phone) redacted. Conservative trade accepted; rename to `clinic_contact_email` etc. if unredacted visibility needed.

## 10. CAB / change-control notes

- BUG-216 promoted from plan-table reference to full YAML row with state=fixed.
- BUG-267, BUG-268, BUG-269 newly filed as disclosed residual risks.
- No new dependency. No licence acceptance. No schema/migration. No API surface change.

## 11. QA agent verdicts

### Round 1 verdicts

- **L1 static:** no new violations from BUG-216 files (utils/logger.ts + test file both clean).
- **L2 narrative:** PASS.
- **L3 code judgement:** **APPROVE** across all 7 dimensions. Root cause accurate, pattern adherent, test adequate, residuals honestly scoped.
- **L4 clinical safety:** **REQUEST_CHANGES × 3 blockers.**
  1. Missing AU-specific identifiers: `ndis_number`, `ndis_package_manager`, `hpii`, `prescriber_number`, `provider_number`, `gp_provider_number`, `referring_provider_number`, `pbs_code`, `pbs_item_code`.
  2. Missing clinical narrative fields (largest PHI vector): `clinical_notes`, `presenting_problem`, `presenting_complaints`, `understand_notes`, `retain_notes`, `weigh_notes`, `communicate_notes`, `message_body`.
  3. BUG-267 (err.message) + BUG-269 (CI guard) must land in Wave A-2 chain, not deferred indefinitely.
- **L5 architecture:** **REQUEST_CHANGES × 2.**
  1. Refactor `PHI_FIELDS` into named category arrays so BUG-269 guard has structured input.
  2. Boot-time schema-snapshot drift check that WARNs on unmatched PHI-regex columns.
  Plus performance follow-up: measure redactPhi recursive overhead on bulk payloads.

### Round 2 (all addressable items absorbed)

**For L4 blockers:**
1. `PHI_CATEGORY_AU_IDENTIFIERS` array added with 9 fields (from_provider_number omitted — not in schema per grep; schema-verified additions only).
2. `PHI_CATEGORY_CLINICAL_NARRATIVE` array added with 8 schema-verified fields. Generic `notes`/`content`/`subject`/`title` intentionally omitted — false-positive rate too high; BUG-269 guard responsibility for contextual misuse.
3. BUG-267 elevated from S1 → **S0/A-2** with inline catalogue comment. BUG-269 elevated from S2/B-11 → **S1/A-2** with inline catalogue comment. Both must land in Wave A-2 chain.

**For L5 items:**
1. `PHI_FIELDS` refactored into 10 named category arrays (all exported for BUG-269 guard consumption).
2. `checkSchemaPhiDrift()` runs at module-load time; scans `schema-snapshot.json`, applies PHI regex, emits `console.warn` listing any unmatched columns. Skipped in `NODE_ENV=test` to avoid test noise.
3. BUG-270 (S3 B-9) filed for redactPhi performance measurement.

**L4 Round 2 conditional APPROVE** with 3 conditions:
- (a) BUG-267 + BUG-269 remain in A-2. ✓ Catalogue state preserved.
- (b) BUG-269 CI guard must land before Wave A-2 closes. Scheduling commitment documented.
- (c) loggerRedaction.test.ts adds explicit AU-identifier + clinical-narrative assertions. ✓ Tests 6a + 6b added; now **8 tests PASS**.

### Final

- **L1 static:** clean
- **L2 narrative:** PASS
- **L3 Round 1:** APPROVE
- **L4 Round 2:** APPROVE (conditional)
- **L5 Round 1:** REQUEST_CHANGES → addressed inline

tsc clean across 3 workspaces; fix-registry 817/817 verified; 8/8 tests PASS.
