# BUG-040 — Psychologist prescribing barrier (AHPRA-compliant two-layer defence)

**Severity:** S0 | **Track:** A | **Wave:** A-2 | **Date:** 2026-04-21

---

## 1. Metadata

| Field | Value |
|---|---|
| Bug ID | BUG-040 |
| Plan source | EXECUTION-PLAN-v3-FULL §2.1 Wave A-2 |
| Related | BUG-039 (canonical trigger pattern), CLAUDE.md §13 (service-layer AuthContext), AHPRA / Psychology Board of Australia rules |
| Owner | Clinical Safety Approver |
| Change-class | risky (migration + auth surface + DB trigger + business-rule on clinical data) |

---

## 2. Diagnosis

**Root cause (one sentence):** `patient_medications.prescribed_by_staff_id` is a nullable FK to `staff.id` with NO database-level CHECK on the prescriber's AHPRA discipline, and the app-layer `requireSpecialty` helper in `authGuards.ts` is NOT called from `medicationService.ts:94` — so a compromised app path, a future buggy refactor, or direct SQL can record a psychologist (or any non-prescribing discipline) as the prescriber of record, violating AHPRA / Psychology Board of Australia registration rules and creating a patient-safety hazard.

**Why patient-safety critical:**
- Under Australian law, psychologists are NOT registered to prescribe medications. Only medical practitioners (psychiatrists, GPs) and endorsed nurse practitioners may prescribe.
- A compromised clinician account or a direct-SQL bypass could record a psychologist as the prescriber, producing a legally-invalid prescription.
- Forensic review of a medication-related adverse event would surface: "Who issued this prescription?" — if the recorded prescriber is a non-prescribing discipline, the accountability chain breaks.

**Classification:** structural — single class (prescribed_by_staff_id → discipline integrity). Today only `patient_medications` carries this field; BUG-290 tracks proactive extension if a `prescription_orders` table lands.

---

## 3. Approach — two-layer defence (mirrors BUG-039)

### Layer A — App-layer gate
- New helper `requirePrescribingDiscipline(auth)` in `apps/api/src/shared/authGuards.ts`.
- Called by `medicationService.ts` create + update paths before the prescriber is persisted.
- Returns HTTP 403 with `PRESCRIBING_DISCIPLINE_REQUIRED` code when the staff discipline is not in the allow-list.
- Admin / superadmin bypass (matches existing `requireSpecialty` behaviour; audit trail catches bypass).

### Layer B — DB-level trigger on `patient_medications`
- `is_prescribing_eligible_discipline(slug text) RETURNS boolean` — SQL function. SSoT for the allow-list. Marked STABLE so Postgres can short-circuit.
- `patient_medications_prescriber_discipline_check()` — PL/pgSQL trigger function. Looks up `staff.discipline` via `NEW.prescribed_by_staff_id`, calls the eligibility function, raises `'prescriber discipline "%" not authorised to prescribe (BUG-040)'` on denial.
- BEFORE INSERT + BEFORE UPDATE OF prescribed_by_staff_id — fires only when the prescriber column is touched (no wasted work on cease / status updates).
- Allows `NULL prescribed_by_staff_id` (legacy / import / transient).
- Fires for ALL roles including `dbAdmin` — defence-in-depth per BUG-039 precedent.

### SSoT decision
The allow-list lives in the DB function `is_prescribing_eligible_discipline(text)`. The trigger calls it directly. The TS helper calls it via `SELECT is_prescribing_eligible_discipline($1)` from app layer — **zero drift possible** because both layers source the truth from one function body. (L5 review blocker from BUG-039 explicitly called out allow-list drift as the failure mode this design prevents.)

---

## 4. Scope decisions

| Discipline (slug) | Decision | Rationale |
|---|---|---|
| psychiatry | ALLOW | Core prescribers (RANZCP) |
| general-practice | ALLOW | GPs (RACGP/ACRRM) prescribe routinely |
| nurse-practitioner | ALLOW | PBS-authorised NP scope per AHPRA |
| clinical-psychology | BLOCK | No AHPRA prescribing authority |
| general-psychology | BLOCK | No AHPRA prescribing authority |
| counselling-psychology | BLOCK | No AHPRA prescribing authority |
| mental-health-nursing | BLOCK | RN-level MH; not NP-endorsed |
| registered-nursing | BLOCK | General RN; no prescribing authority |
| enrolled-nursing | BLOCK | Supervised practice, no prescribing |
| social-work | BLOCK | No prescribing authority |
| occupational-therapy | BLOCK | No prescribing authority |
| pharmacy | BLOCK | Scope is dispense / HMR review, not prescribing |
| dietetics / physio / speech-path / peer / counselling / art-therapy / exercise | BLOCK | No prescribing authority |
| aboriginal-health-work | BLOCK | Certificate-level practitioner (not medical) |
| NULL `prescribed_by_staff_id` | ALLOW | Legacy / import / transient paths |

**Midwives / dentists / podiatrists / optometrists / vaccinating-pharmacists** — out of scope for mental-health EMR; BUG-289 tracks if scope expands.

---

## 5. Reviewer refinement trail

**L3 code-reviewer — PASS.** Two non-blocking observations:
1. UPDATE gate `hasOwnProperty.call(changes, 'prescribedByStaffId')` is future-proofing — MedicationUpdateBodySchema doesn't carry the field today. Accepted; noted inline.
2. Missing test for NULL `staff.discipline` — absorbed as T9.

**L4 clinical-safety — BLOCK → ABSORBED → PASS.** Four substantive findings verified against code:
1. **`medicationRepository.create()` was silently dropping `prescribed_by_staff_id`** — trigger was decorative on the real service path. **Absorbed**: repo now accepts `prescribedByStaffId` + `recordedByStaffId` from DTO; service populates from `auth.staffId`; T10 pins the column round-trip.
2. **`prescriptions` (eScript) table — existing table with `prescribed_by_staff_id` but no guard + no trigger.** Higher severity than the hypothetical `prescription_orders` table BUG-290 tracks. **Filed as BUG-292 (S0 A-3, dated SLA Wave A-3 exit).** Plan-framing corrected: "only patient_medications carries this today" was false; prescriptions carries it too.
3. **`clozapineRepository` paths — highest-risk psychotropic with no discipline guard.** **Filed as BUG-293 (S0 A-3).**
4. **Tests bypass service layer.** Added T10 (column round-trip via dbAdmin). Full HTTP E2E (service → repo → trigger round-trip) tracked in BUG-292 scope because it requires clinician-role session + RLS middleware wiring.
5. **Plan honesty fix**: §4 residual-risk row "NULL prescribed_by_staff_id is a legacy/transient allowance" — clarified that NULL on new rows is now the exception (service layer populates), not the rule.

**L5 architecture — PASS on all 5 standards.** Verdict: "Architecture is indistinguishable from code written when the system was new — in fact tighter than BUG-039's per-table trigger shape." Key confirmations:
- Standard 1 Defence in Depth: four independent layers (HTTP → service guard → DB trigger → SSoT function); no inter-layer trust.
- Standard 3 SSoT: shared `is_prescribing_eligible_discipline()` called by both layers is the drift-preventer. BUG-292/293 will re-use the same function — cannot drift the allow-list.
- Shared-function + per-table-trigger-wrapper is the right compromise (one policy, per-table forensics).
- `db` (RLS-scoped) for the guard's SELECT is correct (staff.discipline lookup is clinic-scoped).
- Free-text discipline fail-closed is a feature, not brittleness — BUG-291 data-quality survey is the recovery path.
- medicationService.update future-proofing gate is idempotent (safe if Zod schema later grows the field).
- T10 dbAdmin round-trip is the right scope; full HTTP E2E amortised into BUG-292.
- Repository DTO expansion with 2 optional fields is minimum-surface-area.

---

## 6. Implementation outline

### New files
- `apps/api/migrations/20260421000003_prescriber_discipline_barrier.ts` — SQL function + trigger function + BEFORE INSERT/UPDATE triggers + idempotent down().
- `apps/api/tests/integration/prescriberDisciplineBarrier.int.test.ts` — 8 tests.

### Modified files
- `apps/api/src/shared/authGuards.ts` — add `requirePrescribingDiscipline(auth)` helper that SELECTs the SSoT function.
- `apps/api/src/features/medications/medicationService.ts` — call the guard in `create` + `update` paths.
- `apps/api/src/db/schema-snapshot.json` — regenerated.
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-040 + BUG-289 / 290 / 291 follow-ups.
- `docs/fix-registry.md` — R-FIX-PRESCRIBER-DISCIPLINE-BARRIER anchor.

### Not touched
- `medicationRoutes.ts` role gate — remains; discipline gate is at service layer (closer to data).
- Seed data — disciplines are already seeded from `AU_DISCIPLINES`; no schema changes.

---

## 7. Tests (red-first)

Integration file: `apps/api/tests/integration/prescriberDisciplineBarrier.int.test.ts`

1. **T1** — Psychiatrist INSERT via `dbAdmin('patient_medications').insert(...)` with `prescribed_by_staff_id` pointing at a psychiatrist-discipline staff succeeds.
2. **T2** — Nurse practitioner INSERT succeeds.
3. **T3** — GP INSERT succeeds.
4. **T4** — Clinical psychologist INSERT raises `'prescriber discipline "clinical-psychology" not authorised to prescribe (BUG-040)'`.
5. **T5** — Registered nurse INSERT raises.
6. **T6** — UPDATE swapping `prescribed_by_staff_id` to psychologist raises.
7. **T7** — NULL `prescribed_by_staff_id` INSERT succeeds (legacy path).
8. **T8** — App-layer: POST `/api/v1/medications` as a psychologist-user returns HTTP 403 `PRESCRIBING_DISCIPLINE_REQUIRED` BEFORE the DB trigger fires (faster failure + structured error code).

**Red-first trace:** pre-migration T4–T8 FAIL (no trigger; no app-layer guard). Post-fix: 8/8 PASS.

---

## 8. Verification trace

- **Original failing scenario:** `dbAdmin('patient_medications').insert({ prescribed_by_staff_id: <psychologist_id>, ... })` succeeds → legally-invalid prescription persisted. Post-fix: raises `BUG-040` tamper message.
- **Null / empty input:** T7 covers NULL `prescribed_by_staff_id`.
- **Concurrent / race:** trigger is per-row BEFORE INSERT/UPDATE — no race window.
- **Max payload:** N/A — no data-path changes.
- **Missing env var:** N/A — migration deterministic.
- **Expired token / auth:** app-layer guard runs within auth context; cannot be reached with expired token (route middleware rejects first).
- **Discipline changes mid-session:** if a staff's discipline is changed to psychologist WHILE they have an open session, their next prescribe attempt hits the DB guard with the NEW discipline — correct.
- **Admin/superadmin bypass:** Layer A bypasses (matches `requireSpecialty` pattern) but Layer B still fires — so a superadmin creating a prescription UI-side with a psychologist prescriber would hit the DB-layer exception. This is the intended safety property; operators correcting data must first update the staff's discipline.

---

## 9. Residual risk → follow-ups

| Risk | Mitigation | Follow-up |
|---|---|---|
| Allow-list drift between layers | SSoT is the SQL function; both layers call it | — |
| Midwives / dentists / vaccinating pharmacists with limited prescribing rights | Out of mental-health EMR scope today | **BUG-289** (S2 B-8) — extend allow-list when EMR scope grows |
| Future `prescription_orders` table | Only `patient_medications` exists today | **BUG-290** (S1 A-3) — proactively apply same barrier when table lands |
| Existing rows with non-prescribing prescriber | Trigger fires only on INSERT/UPDATE — existing rows unaffected | **BUG-291** (S2 B-9) — data-quality survey + retrospective Medical-Director review |
| Admin/superadmin Layer A bypass | Layer B still enforces; audit row captures every prescribe attempt | accepted — matches `requireSpecialty` pattern |
| Staff.discipline is a free-text column | slug values are controlled by `professional_disciplines` seed; any free-text value not matching seed slugs fails as "not authorised" (correct fail-closed behaviour) | accepted |
| Migration rollback re-enables the hole | down() is dev-only; CAB approval required for prod rollback | accepted per CLAUDE.md §12 |

---

## 10. CAB / change-control notes

- Migration 20260421000003_prescriber_discipline_barrier.ts — risky (DDL + trigger + business rule).
- No PHI touched; no data migration.
- down() is honest reversible but CAB must approve any prod rollback.
- Snapshot regenerate required (no column changes, but guard expects fresh timestamps).

---

## 11. QA agent verdicts

- **L1 static:** PASS (tsc × 3 clean; migration-convention green; snapshot-freshness green; row-iface-drift + code-columns green; fix-registry green).
- **L2 narrative:** PASS (plan doc + catalogue + fix-registry + red-first trace).
- **L3 code judgement:** PASS (2 non-blocking observations absorbed).
- **L4 clinical safety:** BLOCK → ABSORBED → PASS (4 findings: 2 absorbed in-commit — repo persists prescriber + T9 NULL fail-closed + T10 column round-trip; 2 elevated to follow-ups — BUG-292 prescriptions table + BUG-293 clozapine).
- **L5 architecture:** PASS on all 5 standards (shared SSoT function is the drift-preventer; BUG-292/293 will re-use it).
