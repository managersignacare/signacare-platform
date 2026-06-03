# Retention Production Enablement Runbook

**Status:** ACTIVE — required before enabling production retention purge for any clinic.
**Owner:** Platform engineering + clinical-governance lead.
**Standard satisfied:** AHPRA Code of Conduct §8.4 + APP 11.2 + state Health Records Acts.

This runbook is the operator's checklist for enabling the data-retention purge cron (annual `0 4 1 1 *` AEST) for a production clinic. The retention infrastructure (BUG-374a/b) ships safe-by-default — `RETENTION_DRY_RUN=true` in every environment — and only flips to live purge when **all three gates** are satisfied.

---

## 1. Prerequisites

Before this runbook applies, the following must be true (BUG-374a + BUG-374b ALREADY shipped):

| Item | Verification command | Expected |
|---|---|---|
| `RETENTION_DRY_RUN=true` set in production env | `grep RETENTION_DRY_RUN apps/api/.env.production` | `RETENTION_DRY_RUN=true` |
| Migration `20260427000001_data_retention_storage.ts` applied | `psql -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='clinics' AND column_name='data_retention_years'"` | 1 |
| `dataRetentionScheduler.ts` registered in `apps/api/src/jobs/bootstrap.ts` | `grep dataRetentionScheduler apps/api/src/jobs/bootstrap.ts` | non-empty |
| Power Settings UI `RetentionPanel.tsx` reachable | Open Power Settings → "Data Retention" tab → loads | renders |
| Audit-log writes exercised | `psql -c "SELECT COUNT(*) FROM audit_log WHERE table_name='clinics' AND new_data::text LIKE '%retentionPurgeEnabled%'"` | grows on each setter call |

If any prerequisite fails, **STOP** and resolve before proceeding.

---

## 2. The triple-lock policy (Q-F locked 2026-04-26)

The retention cron `processDataRetention` predicate requires ALL THREE gates simultaneously:

1. **Env gate** — `RETENTION_DRY_RUN=false` in the running process. Default `'true'` in every environment; operations must explicitly disable on production deploys after this runbook is signed off.
2. **Per-clinic gate** — `clinics.retention_purge_enabled=true` set by superadmin via Power Settings UI. The setter writes `retention_purge_enabled_at` + `retention_purge_enabled_by_staff_id` for forensic attribution.
3. **Manager-approval gate** — `clinics.retention_purge_manager_approved_at` is non-null AND within `MANAGER_APPROVAL_TTL_DAYS` (30 days) AND `retention_purge_manager_approved_by_staff_id !== retention_purge_enabled_by_staff_id` (segregation of duties).

**On any gate fail:** the cron emits a structured WARN log (`kind: 'RETENTION_CLINIC_SKIPPED'` / `'RETENTION_MANAGER_APPROVAL_MISSING'`) and performs **NO mutation**.

**In dry-run mode (gate #1 fail):** the cron still enumerates candidates and logs `kind: 'RETENTION_DRY_RUN_CANDIDATE'` per row so operations can audit the would-be purge population without committing.

---

## 3. Acceptance criteria — when is a clinic "ready to enable purge"?

A clinic is ready to graduate from DRY_RUN to live purge when **every** item below is true:

### 3.1 Dry-run telemetry (≥ 30 days)

- [ ] Cron has fired ≥1 time with `RETENTION_DRY_RUN=true` for this clinic.
- [ ] At least 30 days have elapsed since the FIRST `RETENTION_DRY_RUN_CANDIDATE` log entry for this clinic.
- [ ] The 30-day dry-run window has been reviewed by clinical-governance lead — no surprise candidates (e.g., recently-active patients should NOT be in the candidate set).
- [ ] The candidate-count trajectory is stable (not oscillating; not unexpectedly growing).

### 3.2 Per-clinic configuration verified

- [ ] `clinics.data_retention_years >= 25` for THIS clinic (DB CHECK enforces this; double-check via `psql`).
- [ ] If clinic configured `data_retention_years > 25`, the elevated value is documented in the clinic's compliance register.
- [ ] `RetentionPanel.tsx` shows the configured value to the superadmin without error.

### 3.3 Manager-approval workflow exercised

- [ ] Superadmin has set `retention_purge_enabled=true` via Power Settings.
- [ ] A SECOND admin/superadmin (different staff member) has approved via `POST /power-settings/retention/manager-approval` with a rationale citing this runbook.
- [ ] The approval is FRESH (within TTL) at the moment of go-live.
- [ ] Both audit-log rows (set + approve) are visible in `audit_log` for this clinic.

### 3.4 Tested locally

- [ ] Local dev environment has run `processDataRetention` end-to-end with `RETENTION_DRY_RUN=false` against synthetic data and verified:
  - [ ] Anonymisation columns are scrubbed per BUG-374b §17.1 (identity columns + DOB sentinel + emr_number; clinical narrative PRESERVED).
  - [ ] `purged_at` is set on the patient row.
  - [ ] Idempotency: re-running the cron does NOT re-anonymise already-purged rows.
  - [ ] Audit-log row for the purge is written.
- [ ] Integration tests pass (see §5 below).

### 3.5 Disaster-recovery rehearsal

- [ ] Backup cadence verified — `apps/api/scripts/backup-history.ts` shows successful nightly backups for ≥ 14 days preceding go-live.
- [ ] Restore drill executed within 90 days (ref `docs/operations/runbooks/backup-restore-drill.md`) and verified retention columns survive restore.

### 3.6 Stakeholder sign-off

- [ ] **Clinical-governance lead**: name + date + signature on a printed copy of this runbook.
- [ ] **Privacy officer / DPO**: separate sign-off citing APP 11.2 review.
- [ ] **Platform engineering on-call**: acknowledges retention purge cron will fire and has the rollback runbook (§7) accessible.

If ANY box above is unchecked, **DO NOT** flip `RETENTION_DRY_RUN=false`.

---

## 4. Per-clinic enablement workflow

### 4.1 Pre-enablement (operations + superadmin, ≥ 30 days before go-live)

1. Verify env: `RETENTION_DRY_RUN=true` (default; should already be set).
2. Superadmin opens Power Settings → Data Retention → confirms `data_retention_years` for this clinic (default 25; configurable upward).
3. Superadmin toggles `retention_purge_enabled=true` (irreversible-confirmation dialog: type CONFIRM + reason). This is a **dry-run readiness signal**, not a go-live; the env gate still blocks live purges.
4. Different admin/superadmin clicks "Approve Retention Purge" in Power Settings → enters reason citing this runbook. This sets `retention_purge_manager_approved_at` and the segregation-of-duties check passes.
5. Wait ≥ 30 days while the dry-run cron emits `RETENTION_DRY_RUN_CANDIDATE` logs each annual run. Operations reviews per §3.1.

### 4.2 Go-live (operations only)

Only after every box in §3 is ticked:

1. Schedule a maintenance window with the clinic's clinical-governance lead.
2. Edit production env: `RETENTION_DRY_RUN=false`.
3. Roll the API process so the new env value takes effect.
4. Verify cron registration: tail logs at next annual cron tick for `kind: 'RETENTION_PURGE_*'` (NOT `RETENTION_DRY_RUN_CANDIDATE`).
5. Document the go-live date + clinic + approver names in the compliance register.

### 4.3 Roll-forward expectation

Once enabled, the annual cron will purge eligible patient rows on the next 1st January 04:00 AEST tick. The 3-clock predicate per BUG-374b §17.4 ensures:

```
purgeable_at = MAX(
  last_contact_at + MAX(25, configured_years),
  date_of_birth + (MAX(25, configured_years) + 7),  // minor protection
  deceased_date + MAX(25, configured_years),         // when deceased
)
```

Patients are purge-eligible only when ALL applicable clocks have expired.

---

## 5. Integration test corpus (BUG-374c §5)

The retention infrastructure has comprehensive integration tests. Run before signing off §3.4:

```bash
# Power Settings retention setter tests (12 tests)
npm run test:integration --workspace=api -- retentionSetting

# Manager-approval workflow tests (20 tests; segregation of duties + 30-day TTL)
npm run test:integration --workspace=api -- retentionApproval

# Anonymisation service tests (Q-C scope; identity-only, narrative preserved)
npm run test:integration --workspace=api -- anonymisePatient

# Scheduler tests (annual cron + 3-clock predicate + dry-run mode)
npm run test:integration --workspace=api -- dataRetentionScheduler
```

All four suites must PASS before §3.4 can be ticked.

**Corpus coverage** (per BUG-374a + BUG-374b SHIPPED):
- 12 retention-setter unit tests (TP-RET-1..12) — floor-25 enforcement, superadmin-only, audit-on-set, default-25 fallback, all 3 setter combos.
- 20 manager-approval workflow tests (TP-APPR-1..20) — fail-CLOSED on null enabled-by, 30-day TTL boundary, segregation-of-duties, audit log on approve/revoke.
- 14 scheduler tests (TP-RSCHED-1..14) — annual cron registration, 3-clock predicate, dry-run candidate logging, dbAdmin-from-inception, zero-row handling.

**Gap** (filed as BUG-374c-FOLLOWUP-LIVE-DB-CRON-DRILL): live-DB cron drill against staging Postgres with synthetic 30-year-old patient + verifying anonymisation succeeds AND idempotent re-run does not re-anonymise. Pre-go-live this drill runs manually per §3.4.

---

## 6. Telemetry to watch post-enablement

For 90 days after a clinic goes live:

| Signal | Source | Threshold |
|---|---|---|
| `RETENTION_PURGE_SUCCESS` log per clinic | API stdout / Sentry | ≥ 1 per annual cron tick |
| `RETENTION_PURGE_FAILED` log | API stdout / Sentry | 0 (page on-call immediately) |
| `RETENTION_MANAGER_APPROVAL_MISSING` | API stdout | should be 0 — indicates approval lapsed mid-window |
| Patient row count delta | `SELECT COUNT(*) FROM patients WHERE clinic_id = ?` before/after cron | matches log-reported purge count |
| `purged_at` non-null count | `SELECT COUNT(*) FROM patients WHERE clinic_id = ? AND purged_at IS NOT NULL` | grows monotonically |
| Audit-log retention rows | `SELECT COUNT(*) FROM audit_log WHERE table_name='patients' AND operation='UPDATE' AND new_data::text LIKE '%purged_at%'` | grows in lockstep with purge count |

---

## 7. Rollback (reverse the production go-live)

If retention purge fires unexpectedly or surfaces a bug:

### 7.1 Immediate stop

```bash
# 1. Edit production env: RETENTION_DRY_RUN=true
# 2. Roll the API process
# 3. Verify next cron tick logs RETENTION_DRY_RUN_CANDIDATE (NOT RETENTION_PURGE_SUCCESS)
```

This stops further purges immediately. **Already-purged rows are NOT recovered** — the anonymisation is irreversible by design (Q-C scope: identity columns are scrubbed; reverting requires backup restore).

### 7.2 Investigate

- Pull all `kind: 'RETENTION_*'` logs for the affected clinic.
- Compare to the `RETENTION_DRY_RUN_CANDIDATE` log from before go-live — if the live purge population != dry-run population, a bug landed; file as a **CRITICAL** AHPRA incident.
- Engage clinical-governance lead + privacy officer immediately.

### 7.3 Recover (if applicable)

If a row was purged in error AND the clinical-governance lead authorises recovery:

1. Identify the most recent backup taken BEFORE the cron tick (use `apps/api/scripts/backup-history.ts`).
2. Restore the affected patient row(s) per `docs/operations/runbooks/backup-restore-drill.md`.
3. Document the recovery in the compliance register.
4. Refile the dry-run readiness gate from §3 — DO NOT re-enable until root cause is fixed and reviewed.

---

## 8. Sign-off record

For each clinic graduating to live purge, retain a signed copy of this runbook with:

```
Clinic ID: __________________________________________
Clinic name: ________________________________________
Date dry-run started: _______________________________
Date dry-run reviewed: ______________________________
data_retention_years (configured): __________________
retention_purge_enabled_by (superadmin): ____________
retention_purge_manager_approved_by (different admin): ___
Manager-approval reason (cite this runbook): ________

Clinical-governance lead signature: _________________
Privacy officer / DPO signature: ____________________
Platform on-call ack: _______________________________

Production env flip date (DRY_RUN=false): ___________
First live-purge cron tick: _________________________
First live-purge row count: _________________________
```

This sign-off page is the audit-trail evidence for AHPRA / state regulator review. File it with the clinic's compliance register.

---

## 9. Related infrastructure

- **CLAUDE.md §17** — locked policy (Q-C / Q-F / Q-E / Q1b/Q2b).
- **`apps/api/src/features/privacy/anonymisePatientService.ts`** — Q-C identity-only scrub.
- **`apps/api/src/features/power-settings/retentionApprovalService.ts`** — Q-F triple-lock 3rd gate.
- **`apps/api/src/jobs/schedulers/dataRetentionScheduler.ts`** — annual cron `0 4 1 1 *` AEST.
- **`apps/web/src/features/power-settings/components/RetentionPanel.tsx`** — operator UI.
- **R-FIX-BUG-374B-NO-FREE-TEXT-SCRUB** — fix-registry anchor preventing re-introduction of clinical-narrative scrubbing.
