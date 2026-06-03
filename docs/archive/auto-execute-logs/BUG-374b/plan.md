# BUG-374b — Plan (locked) — destructive retention purge cycle

## Locked answers (user 2026-04-27, saved to memory)

- **Q-A(a)** Add `patients.last_contact_at timestamptz NULLABLE` + backfill from clinical activity.
- **Q-B** Scrub identifiers + lookups + viva_triage + health_fund; **PRESERVE consent_*** booleans.
- **Q-C none** — **DO NOT scrub free-text** in clinical_notes. Patient identity wipe only; free-text preserved as clinical record. Implication doc'd in CLAUDE.md + UI.
- **Q-D annual** — cron `0 4 1 1 *` AEST (1st January 04:00). One run per year.
- **Q-E** `purged_at` bright line. No re-anonymisation.
- **Q-F TRIPLE-LOCK** — env (`RETENTION_DRY_RUN=false`) + superadmin clinic flag (`retention_purge_enabled=true`) + **manager approval** (segregation of duties; different staff from enabler; 30-day TTL).
- **Q-G** `1900-01-01` DOB sentinel.

## Files to create / modify

### Create
- `apps/api/migrations/20260427000002_patients_last_contact_at_and_manager_approval.ts` — adds `patients.last_contact_at` + `clinics.retention_purge_manager_approved_by_staff_id` + `clinics.retention_purge_manager_approved_at` + backfill last_contact_at.
- `apps/api/src/features/privacy/anonymisePatientService.ts` — TS replacement for ghost SQL function. Returns `Result<AnonymiseOutcome, AppError>`. Patient identity wipe (no free-text scrubbing per Q-C).
- `apps/api/src/features/privacy/retentionPredicate.ts` — pure function `isPurgeable(row, configuredYears, now)` + 3-clock predicate + `MAX(25, configured)` floor.
- `apps/api/src/jobs/schedulers/dataRetentionScheduler.ts` — annual cron + dry-run + triple-lock arming + per-row try/catch + zero-row WARN.
- `apps/api/src/features/power-settings/retentionApprovalService.ts` — manager-approval workflow (set/check/expire/audit-log).
- `apps/api/src/features/power-settings/retentionApprovalRoutes.ts` — `POST /power-settings/retention/manager-approval` (manager role only; rejects if same staff as enabler).
- `apps/web/src/features/power-settings/components/RetentionApprovalPanel.tsx` — manager approval UI.
- 3 RED-gate unit test files: anonymisePatientService, dataRetentionScheduler, retentionPredicate.
- 2 RED-gate integration test files: retentionPurge.int (live-DB scheduler tick) + anonymisePatient.int (privacyRoutes ↔ TS service round-trip).

### Modify
- `apps/api/src/features/privacy/privacyRoutes.ts:128` — replace `db.raw('SELECT anonymise_patient(?, ?)')` with `anonymisePatientService.anonymise(...)`. Closes BUG-594 atomically.
- `apps/api/src/jobs/bootstrap.ts` — register `dataRetentionScheduler`.
- `apps/api/src/utils/audit.ts` — add `'ANONYMISE'` to AuditAction union.
- `apps/api/.env.example` — add `RETENTION_DRY_RUN=true` (default), `RETENTION_CRON`, `RETENTION_TZ`. Document each as destructive.
- `apps/api/src/db/schema-snapshot.json` — regenerate (CLAUDE.md §12.3).
- `apps/web/src/features/power-settings/components/RetentionPanel.tsx` — add manager-approval status display + free-text-PHI-not-scrubbed clinical-safety disclaimer copy.
- `CLAUDE.md` — new sub-section documenting "anonymisation scope: patient identity wipe only; free-text preserved as clinical record" per Q-C.
- `docs/quality/bugs-remaining.md` — atomic flip BUG-374b → fixed; flip BUG-594 → fixed; file new cascades atomically.
- `docs/quality/fix-registry.md` — 12+ new BUG-374b anchors.

## Anonymisation scope (per Q-B locked, Q-C locked)

### Scrub on `patients`:
- Names → `'[REDACTED]'`: given_name, family_name, preferred_name
- DOB → `'1900-01-01'`: date_of_birth (Q-G sentinel; preserves NOT NULL)
- Contact → NULL: email, email_primary, phone_mobile, phone_home, address_line1, address_line2, suburb, state, postcode, country
- Identifiers → NULL: medicare_number, medicare_reference, medicare_expiry, ihi_number, dva_number, dva_card_type, emr_number
- Lookup blind-index → NULL: medicare_number_lookup, ihi_number_lookup, dva_number_lookup
- Demographics → NULL: gender, pronouns, indigenous_status, atsi_status, interpreter_required (false), interpreter_language
- Emergency → NULL: emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
- GP details → NULL: gp_name, gp_practice, gp_phone, gp_fax, gp_email, gp_provider_number, gp_address_*
- NOK → NULL: nok_name, nok_relationship, nok_phone
- Other identifying → NULL: viva_triage_number, health_fund_name, health_fund_number, photo_url
- Status → `'anonymised'`: status
- Sentinel → `now()`: purged_at

### PRESERVE on `patients`:
- id, clinic_id (FK targets, traceability)
- consent_* booleans (Q-B kept consent records)
- created_at, updated_at, deleted_at (chronology)
- last_contact_at, deceased_date (clinical metadata)
- sms_consent_*

### NOT TOUCHED tables (per Q-C none-scrub):
- `clinical_notes.*` — preserved as clinical record. Free-text PHI (e.g. "Patient John Smith presented with...") may persist; this is a documented user-policy choice.
- `prescriptions.*`, `patient_medications.*`, `episodes.*`, `appointments.*`, `pathology_results.*`, `letters_*`, `patient_attachments.*`, `contact_records.content`, `escalations.description`, `staff.*`

## Triple-lock arming (Q-F)

Cron purge predicate ALL must be true:
1. `process.env.RETENTION_DRY_RUN === 'false'` (default `'true'` — first env gate)
2. `clinic.retention_purge_enabled === true` (superadmin per BUG-374a)
3. `clinic.retention_purge_manager_approved_at !== null` AND `>= now() - 30d` (manager approval, segregation of duties)
4. `clinic.retention_purge_manager_approved_by_staff_id !== clinic.retention_purge_enabled_by_staff_id` (different person)

Manager approval workflow:
- Manager-role staff (NOT same as enabling superadmin) calls `POST /power-settings/retention/manager-approval` with `{ approve: true, reason }`.
- Service rejects if `auth.staffId === clinic.retention_purge_enabled_by_staff_id` with `SEGREGATION_OF_DUTIES_VIOLATION`.
- Audit-log every approval set/clear.
- Approval expires 30 days from `retention_purge_manager_approved_at`. Cron checks expiry; if expired → skip clinic + WARN log.

## RED-gate tests (must FAIL on stub)

### Unit (retentionPredicate.test.ts) — 11 tests
- TP-RPRED-1..11 covering 3-clock predicate (last_contact, dob, deceased clocks), MAX(25, configured) floor, NULL handling, SQL builder shape.

### Unit (anonymisePatientService.test.ts) — 12 tests
- TP-ANON-1..12 covering: superadmin/auth gate, idempotency (purged_at no-op), Q-B scrub list, Q-C NO-free-text-touch, audit log, transactional rollback, cross-tenant isolation, FK preservation, lookup-column null, sentinel purged_at + DOB.

### Unit (dataRetentionScheduler.test.ts) — 14 tests
- TP-RSCHED-1..14 covering: dry-run gate, per-clinic flag, manager-approval gate, segregation-of-duties enforcement, 30-day expiry, zero-row WARN, per-row failure isolation, top-level failure, cron-tick failure, idempotency on rerun, 3-clock SQL predicate.

### Integration (retentionPurge.int.test.ts) — 9 tests
- TP-RINT-1..9 covering: DB CHECK floor as L5 belt; dry-run zero-mod; full purge with all 3 gates; idempotency; cross-tenant; minor-aware (Q1b); deceased-aware (Q2b); free-text NOT scrubbed (Q-C); audit-log persistence.

### Integration (anonymisePatient.int.test.ts) — 4 tests
- TP-ANONINT-1..4 covering: privacyRoutes endpoint returns 200 (not 500 from missing SQL fn); admin gate; persists scrub; idempotent re-call.

## Fix-registry anchors (12+)

1. `R-FIX-BUG-374B-NO-GHOST-FUNCTION` — absent `db.raw\('SELECT anonymise_patient` in privacyRoutes.ts (closes BUG-594)
2. `R-FIX-BUG-374B-SCHED-EXISTS` — present `processDataRetention` in scheduler
3. `R-FIX-BUG-374B-DRY-RUN-DEFAULT` — present `RETENTION_DRY_RUN` env-read defaulting to `'true'`
4. `R-FIX-BUG-374B-PER-CLINIC-FLAG-CHECK` — present `retention_purge_enabled` filter
5. `R-FIX-BUG-374B-MANAGER-APPROVAL-CHECK` — present `retention_purge_manager_approved_at` filter
6. `R-FIX-BUG-374B-SEGREGATION-OF-DUTIES` — present rejection of same-staff approver
7. `R-FIX-BUG-374B-APPROVAL-30D-TTL` — present 30-day expiry check
8. `R-FIX-BUG-374B-3-CLOCK-PREDICATE` — present GREATEST + 3 clauses in retentionPredicate.ts
9. `R-FIX-BUG-374B-SQL-FLOOR-MAX-25` — present `Math.max(25, configured)` in predicate
10. `R-FIX-BUG-374B-AUDIT-ANONYMISE` — present `action: 'ANONYMISE'` in service
11. `R-FIX-BUG-374B-NO-FREE-TEXT-SCRUB` — absent any phi_scrubber call in anonymisePatientService.ts (Q-C none-scrub policy enforced)
12. `R-FIX-BUG-374B-IDEMPOTENT-PURGED-AT` — present `purged_at IS NOT NULL` short-circuit in service AND `whereNull('purged_at')` in candidate query
13. `R-FIX-BUG-374B-DBADMIN-FROM-INCEPTION` — present `dbAdmin` import per BUG-583 lesson
14. `R-FIX-BUG-374B-ZERO-ROW-WARN` — present `kind: 'RETENTION_ZERO_ROWS'` log
15. `R-FIX-BUG-374B-LAST-CONTACT-COLUMN` — present in migration

## Cascades to file atomically

- BUG-374b-CASCADE-1 (S2): document free-text PHI persistence in CLAUDE.md per Q-C. Future regulatory escalation may require phase-2 phi_scrubber pass.
- BUG-374b-CASCADE-2 (S2): trigger / write-through to maintain `patients.last_contact_at` going forward (the migration backfills; the live-update plumbing is BUG-374b-CASCADE-2 scope to keep BUG-374b's surface bounded).
- BUG-374b-CASCADE-3 (S2): RetentionApprovalPanel UI for manager workflow (BUG-374b ships the API; the UI panel + manager-role gate is the cascade).
- BUG-374b-CASCADE-4 (S3): age-derived calc guards (when `purged_at IS NOT NULL`, age display = "purged" not "age 126" from the 1900 sentinel).
- BUG-374b-CASCADE-5 (S2): `clinical_notes_no_insert_on_purged` CHECK constraint (defensive — prevents future inserts referencing a purged patient).

## Acceptance gates (full discipline)

- [ ] Pre-fix RED tests written + FAIL on stub
- [ ] Schema verification commands run + outputs checked
- [ ] **L1 — FULL 25 guards** + tsc × 3 + 1173+ fix-registry anchors verified
- [ ] L2 — 3× flake on new tests + 0 regressions vs §0.2 baseline
- [ ] L3 — code-reviewer-general PASS or absorb (max 1; 2-REJECT cap = BLOCKED)
- [ ] L4 — clinical-safety-reviewer PASS (touches `patients` PHI + cron destructive)
- [ ] L5 — architecture-reviewer PASS (new feature module + scheduler + new arming pattern)
- [ ] Atomic catalogue flip BUG-374b + BUG-594 → fixed; cascades filed
- [ ] Explicit user push authorization
