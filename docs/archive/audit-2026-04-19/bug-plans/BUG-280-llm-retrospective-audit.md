# BUG-280 — Retrospective audit of `llm_interactions` for pre-BUG-036 contamination

**Metadata**

- Severity: S1
- Track / Wave: A / A-2
- State: **fixed** + `resolution_note: "audit_capability_shipped; findings_pending_ops_run; NDB_assessment_pending"`
- Change class: risky
- Fix-registry anchor: `R-FIX-LLM-INTERACTIONS-RETROSPECTIVE-AUDIT`
- Origin: BUG-036 L4 clinical-safety review dimension 7 (retrospective verification).

## Diagnosis

Before BUG-036, 5 LLM endpoints accepted `patientId` without `requirePatientRelationship`:

- `enhancedGenerate` RAG
- `runAgent`
- `/patient-summary`
- `/referral-letter`
- `/search`

Any clinician could have triggered LLM calls against any patient — producing `llm_interactions` rows where `user_id` had no sanctioned care-relationship to `patient_id` at `created_at`.

This fix DOES NOT remediate — `llm_interactions` is append-only per BUG-039, and remediation decisions require human + legal review under the OAIC NDB scheme. The fix SHIPS A CAPABILITY that identifies candidate contamination rows so ops + legal can assess whether any event constitutes an "eligible data breach likely to result in serious harm".

**NDB framing (R3 absorption):** the audit **supports** NDB assessment; it does **not** establish reportability. Only the separate human + legal review triggers the NDB notification obligation. Plan doc, fix-registry row, resolution_note, and commit body all use this precision-wording verbatim to prevent "BUG-280 fixed" being misread as "no contamination occurred".

## Relationship model — mirrors `requirePatientRelationship` exactly

[apps/api/src/shared/authGuards.ts:127-185](apps/api/src/shared/authGuards.ts#L127-L185) is the SSoT. Original 3-check audit plan (episode / team / appointment only) would have false-positived BYPASS_ROLES + break-glass paths as contamination. R3 pre-exec absorption expanded the model to 5 checks:

| Access path | Check |
|---|---|
| 1. BYPASS_ROLES | `staff.role IN ('superadmin', 'admin')` — scalar per-row check against staffRoleMap built once. |
| 2. Break-glass session | `EXISTS` row in `break_glass_sessions` with `staff_id` + `clinic_id` match, `status='approved'`, `approved_at <= T`, `(expires_at IS NULL OR > T)`, `(revoked_at IS NULL OR > T)`. Session-wide — grants access to ANY patient during the window. |
| 3. Episode | `EXISTS` row in `episodes` with `patient_id` + `clinic_id` match, `status IN ('open','active','admitted')`, `deleted_at IS NULL`, `(primary_clinician_id = user_id OR key_worker_id = user_id)`, `created_at <= T`. |
| 4. Team assignment | `EXISTS` row in `patient_team_assignments × staff_team_assignments` joined on `org_unit_id`, both `is_active=true`, `created_at <= T`, `(sta.end_date IS NULL OR sta.end_date > T::date)`. |
| 5. Appointment attendance | `EXISTS` row in `appointment_attendees × appointments` (joined on `appointment_id`), `attendance_status != 'removed'`, `a.deleted_at IS NULL`, `a.created_at <= T`. |

Row fails ALL five → candidate contamination.

## Schema reality corrections during execution

- `llm_interactions.user_id` (NOT `staff_id`). SQL adjusted.
- `break_glass_sessions` has NO `patient_id` — sessions are clinician-scoped, not patient-bound. Check 2 adjusted: break-glass grants access to ANY patient during the window.
- `episodes` has no `ended_at` column. Status + `deleted_at` are the termination signals. Check 3 uses `status IN ('open','active','admitted') AND deleted_at IS NULL`.
- `appointments.type` NOT NULL; `appointment_attendees.attendance_status` CHECK constrains to a specific list; `appointment_attendees.role` CHECK constrains to `primary / co_clinician / supervisor / observer / interpreter / support`. Test seed data uses valid values.
- `specialties.code` — test uses `mental_health` (real seeded code); `psychiatry` is not a seeded specialty code and would fail the episodes FK.
- `org_units` requires `level` + `sort_order`, not `unit_type`.

## Performance posture (R1 absorption)

- Every relationship check uses `EXISTS()` — not `LEFT JOIN`. Planner short-circuits on the first matching row. Essential against `appointment_attendees` × historical `llm_interactions` cardinality.
- `SET statement_timeout = '10min'` at session start prevents runaway queries.
- `staff.role` preloaded into a Map at start → zero per-row lookups.
- Script honours `DB_READ_HOST` when set (falls back to primary via existing db helper).
- Dry-run is the default — `AUDIT_WRITE_REPORT=true` gates the findings-append.

## Files changed

- NEW `apps/api/scripts/audit-llm-interactions-contamination.ts` — audit script (~230 LOC) with `require.main === module` guard so tests can safely import `hasRelationship` without triggering `main() + process.exit()`.
- NEW `apps/api/tests/integration/auditLlmContamination.int.test.ts` — 7 integration tests against real fixtures.
- NEW `docs/audit-2026-04-19/findings/BUG-280-llm-interactions-contamination.md` — findings report template + runbook + NDB-assessment workflow.
- MOD `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — state: fixed + resolution_note.
- MOD `docs/fix-registry.md` — `R-FIX-LLM-INTERACTIONS-RETROSPECTIVE-AUDIT` anchor.

## Tests — 7 integration, all PASS

| # | Scenario | Expected |
|---|---|---|
| A1 | Open episode, staff=primary_clinician, created before T | PASS |
| A2 | No episode / team / appointment / break-glass, staff not in BYPASS_ROLES | FAIL (candidate contamination) |
| A5 | Episode created AFTER T | FAIL (time-boundary) |
| A6 | Team assignment with `sta.end_date BEFORE T` | FAIL (time-boundary) |
| A7 | Active approved break-glass covering T | PASS (session-wide, any patient) |
| A8 | Break-glass with `expires_at BEFORE T` | FAIL (expired) |
| A9 | Appointment attendance with staff | PASS |

Notes: A3 (`patient_id IS NULL`) + A4 (BYPASS_ROLES bypass) live in the audit script's `main()` scalar-check loop, not inside `hasRelationship()` — they're straight-line conditional skips/short-circuits, exercised by the audit-run time itself rather than the unit test.

## Non-goals

- Do NOT remediate — the audit is read-only; `llm_interactions` is append-only per BUG-039.
- Do NOT automate NDB notification — human + legal review is the gate.
- Do NOT retrospectively re-attest consent — impossible for past interactions.
- Do NOT run against prod without ops sign-off — this commit ships the capability; ops decides when / how to run.

## QA verdicts

- L3 code-reviewer-general: TBD
- L4 clinical-safety-reviewer: TBD
- L5 architecture-reviewer: TBD

## Residual risk

- **`staff.role` current state only.** No `staff_role_history` table. Staff member who is `superadmin` now but was `clinician` at call-time would falsely PASS. Tracked as enhancement if role-history lands.
- **`break_glass_sessions.clinic_id` match assumption.** Cross-clinic break-glass (if ever introduced) would need model extension.
- **`is_active` snapshot vs historical.** Team assignments currently inactive may have been active at call time. Full point-in-time query needs history tables. Model approximates.
- **Runtime on prod-scale data.** Untested at production cardinality. Script sets `statement_timeout='10min'` and uses `EXISTS` — but a 100M-row `llm_interactions` might need batching. Flag as post-run learning.
- **NDB wording is everything.** The audit identifies CANDIDATES; it does NOT establish reportability. Findings require human + legal review to classify as "eligible data breach".
