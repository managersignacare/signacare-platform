# Agent H — Persona RBAC matrix (COMPLETED)

## CRITICAL findings — over-permissioning / access leaks

**[CRIT-H1]** GAP-B1: Nurse can read all MAR without patient relationship check (nurseFeatureRoutes.ts:54-100 GET /medications/mar/:patientId — only filters by clinic_id + patientId). Violates NSQHS Std 1. Fix: add `requirePatientRelationship(auth, patientId)` before querying. BLOCKING.

**[CRIT-H2]** GAP-B2: Receptionist has full CRUD on `phone_triage.triage_notes` containing clinical risk flags (receptionistFeatureRoutes.ts:145-244). Split into `receptionist_summary` (admin) + `clinical_risk_flags` (NURSE_ROLES).

**[CRIT-H3]** GAP-B3: Manager can access /reports/admin-overview (reportsRoutes.ts:70-150) which includes per-clinician note_cnt / appointment counts. NO requireRoles guard. Fix: add `requireRoles(['admin','superadmin'])`. BLOCKING.

**[CRIT-H4]** GAP-B4: Clinical formulations (5P diagnostic reasoning) at psychiatristFeatureRoutes.ts:156-172 — gated via CLINICAL_ROLES which includes psychologist. Psychologist can read all psychiatrist formulations. Fix: restrict to ['psychiatrist','admin','superadmin'] explicitly + add `shared_with_clinicians` flag for consent-based sharing.

## HIGH findings — under-permissioning

**[HIGH-H1]** GAP-A1: Psychologist cannot record medication observations (nurseFeatureRoutes only). Create psychologist-gated medication observation endpoint.

**[HIGH-H2]** GAP-A2: Psychologist has no outcome measures recording route. Create psychologistFeatureRoutes.ts.

**[HIGH-H3]** GAP-A3: Clinic Manager cannot view appointment schedules for rostering (gated to NURSE + CASE_MANAGER only). Add manager read endpoint.

## MEDIUM findings — mental-health confidentiality

**[MED-H1]** GAP-C1: clinical_formulations has no `confidentiality_level` column. Readable by any CLINICAL_ROLES. Add enum + role-gated reads.

**[MED-H2]** GAP-C2: No `psychology_session_notes` table. Session notes in generic outcomes module — cannot restrict to psychologist+patient.

**[MED-H3]** GAP-C3: No `patient_access_restrictions` table. Patient-initiated privacy requests not programmatically enforced.

**[MED-H4]** GAP-C4: MHA orders readable by any staff with legal_orders:read. Should be psychiatrist + MD only. Add explicit role check.

**[MED-H5]** GAP-C5: Psychology outcome data exposed via manager /reports/admin-overview. Add `is_sensitive` flag OR gate report to admin-only.

## Access Control Matrix (7 personas × 16 modules)

See agent's full report in task output (transcript). Key columns: Patient Demo, Appts, Clinical Notes, Meds, Vitals, Pathology, Risk, MHA, Psychology, Letters, Billing, Reports, Staff Mgmt, Audit, Settings, AI. Matrix shows CAN (✓R/W/CRU) vs CANNOT (✗) per cell.

## Break-glass: FULLY IMPLEMENTED ✓

- Two-person rule enforced (requester ≠ approver)
- Time-limited JWT (BREAK_GLASS_TTL_MINUTES, default 30min)
- break_glass_sessions immutable audit (actions_performed JSONB append-only)
- Slack webhook (dry-run in dev, production-wired)
- HIPAA 164.312(a)(2)(ii), NSQHS Std 1, ISO 27001 A.8.3 compliant

## 3 blockers for production release

1. GAP-B3 /reports/admin-overview missing requireRoles
2. GAP-B1 MAR missing requirePatientRelationship
3. GAP-B4 Clinical formulations open to all CLINICAL_ROLES (inc psychologist)
