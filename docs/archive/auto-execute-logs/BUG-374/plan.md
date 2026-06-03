# BUG-374 — Plan (locked) — 3 sub-cycles + locked Q1/Q2/Q3 answers

## Locked policy answers (user 2026-04-26)

- **Q1(b)** — Minor-aware: purge predicate uses `MAX(last_contact_clock, dob_clock, deceased_clock)`; the dob clock adds +7y over base for HPP 4.2 compliance.
- **Q2(b)** — Add `patients.deceased_date date NULLABLE` column in BUG-374a; use as third clock when present.
- **Q3(b)** — BOTH `data_retention_years` AND `retention_purge_enabled` setters are **superadmin-only**.

## Sub-cycle split (atomic per `feedback_atomic_catalogue_flip.md`)

| Sub | Scope | Lands |
|---|---|---|
| **374a** | Storage migration + setter service + setter routes + Power Settings UI tab | `retention_purge_enabled=false` per clinic; cron does NOT yet exist |
| **374b** | `dataRetentionScheduler.ts` + `anonymisePatientService.ts` (TS replacement for ghost SQL function) + dry-run + 3-clock predicate + cascade-1 fix (privacyRoutes) | DRY-RUN by default; per-clinic flag still OFF |
| **374c** | Production enablement runbook + ≥30-day dry-run review + per-clinic opt-in workflow | Production switch |

## BUG-374a scope (this cycle)

**Migration `apps/api/migrations/20260427000001_data_retention_storage.ts`** adds:
- `clinics.data_retention_years` int NOT NULL DEFAULT 25
- `clinics.retention_purge_enabled` bool NOT NULL DEFAULT false
- `clinics.retention_purge_enabled_at` timestamptz NULLABLE
- `clinics.retention_purge_enabled_by_staff_id` uuid NULLABLE FK staff
- `patients.deceased_date` date NULLABLE (Q2b)
- `patients.purged_at` timestamptz NULLABLE (sentinel for BUG-374b)
- DB CHECK: `data_retention_years >= 25` (L4 floor)
- Backfill: `UPDATE clinics SET data_retention_years = 25` (atomic in same migration)

**NEW `apps/api/src/features/power-settings/retentionSettingService.ts`:**
- `getRetention(auth)` → `Result<{years, purgeEnabled, ...}, AppError>`
- `setRetention(auth, years)` → `Result<void, AppError>` — superadmin guard, Zod min(25), audit log on set
- `setPurgeEnabled(auth, enabled, reason)` → `Result<void, AppError>` — superadmin guard, captures actor + timestamp, audit log

**NEW `apps/api/src/features/power-settings/retentionSettingRoutes.ts`:**
- `GET /api/v1/power-settings/retention` — read current state + audit history
- `PUT /api/v1/power-settings/retention` — set years (superadmin only)
- `PUT /api/v1/power-settings/retention/purge-enabled` — toggle flag (superadmin only)
- All AuthContext-typed per CLAUDE.md §13. Mounted into existing powerSettingsRoutes.

**NEW `apps/web/src/features/power-settings/components/RetentionPanel.tsx`:**
- Display current `data_retention_years` + `retention_purge_enabled`
- Edit form with `min=25` (UI layer)
- Enable Purge toggle with confirmation dialog ("Type CONFIRM to proceed")
- Audit history table from GET response

**Modified files:**
- `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx` — add "Data Retention" tab (superadmin-only render)
- `apps/web/src/features/power-settings/services/powerSettingsApi.ts` — `getRetention`, `setRetention`, `setPurgeEnabled`
- `apps/web/src/features/power-settings/queryKeys.ts` — `retention(clinicId)` factory
- `apps/api/src/db/schema-snapshot.json` — regenerate per CLAUDE.md §12.3
- `docs/quality/bugs-remaining.md` — atomic flip BUG-374a → fixed; file BUG-374b/c open + cascades atomically
- `docs/quality/fix-registry.md` — 7 BUG-374a anchors

## RED tests (BUG-374a)

Unit (`apps/api/tests/unit/retentionSettingService.test.ts`):
- TP-RET-1: `setRetention` rejects 24 with `RETENTION_BELOW_FLOOR`
- TP-RET-2: `setRetention` accepts 25 / 30 / 50 / 100
- TP-RET-3: `setRetention` rejects negative / NaN / fractional
- TP-RET-4: `setRetention` rejects non-superadmin caller with `FORBIDDEN`
- TP-RET-5: `setRetention` writes audit_log row with old + new value
- TP-RET-6: `setPurgeEnabled` writes audit_log + captures actor + timestamp
- TP-RET-7: `getRetention` returns 25 default for clinic without explicit setting

Integration (`apps/api/tests/integration/retentionSetting.int.test.ts`):
- TP-RET-INT-1: PUT /retention 30 → GET returns 30; verifies persistence
- TP-RET-INT-2: PUT /retention 24 → 422; verifies floor enforcement
- TP-RET-INT-3: PUT /retention from non-superadmin → 403; verifies access control

## Fix-registry anchors (BUG-374a — 7 anchors)

1. `R-FIX-BUG-374A-COLUMN-EXISTS` — `data_retention_years` in migration (present)
2. `R-FIX-BUG-374A-CHECK-FLOOR-25` — `>= 25` CHECK in migration (present)
3. `R-FIX-BUG-374A-ZOD-MIN-25` — `z.number().int().min(25)` in routes (present)
4. `R-FIX-BUG-374A-SERVICE-FLOOR-GUARD` — `RETENTION_BELOW_FLOOR` in service (present)
5. `R-FIX-BUG-374A-SUPERADMIN-GUARD` — `requireSuperadmin` or equivalent in routes (present)
6. `R-FIX-BUG-374A-AUDIT-ON-SET` — `writeAuditLog` call in service (present)
7. `R-FIX-BUG-374A-PURGE-DEFAULT-FALSE` — `retention_purge_enabled` defaultTo(false) in migration (present)
8. `R-FIX-BUG-374A-DECEASED-DATE-COLUMN` — `deceased_date` in migration (present)
9. `R-FIX-BUG-374A-UI-MIN-25` — `min: 25` in RetentionPanel.tsx (present)

(9 actually — exceeds 7 minimum)

## Cascades filed atomically with BUG-374a

- BUG-374b S1 — destructive scheduler (open after this cycle)
- BUG-374c S1 — production enablement (open after BUG-374b)
- BUG-594 S1 — `privacyRoutes.ts:128` calls non-existent `anonymise_patient(uuid, reason)` SQL function (CASCADE-1; fix lands atomically with BUG-374b)
- BUG-595 S2 — `phi_scrubber_rules` defaults required for fresh clinics (CASCADE-2)
- BUG-596 S2 — `data_retention_policies` table CHECK >= 25 needs raising (CASCADE-3)
- BUG-597 S2 — `audioRetentionScheduler` 30-day default vs 25-year clinical floor — document exemption (CASCADE-4)
- BUG-598 S3 — `patient_attachments` / `pathology_results` / `letters_*` retention coverage (CASCADE-5)
- BUG-599 S2 — `staff` table has no retention rule (CASCADE-6)
- BUG-600 S3 — training-export approvals retroactive re-anonymisation (CASCADE-7)

## Acceptance gates (per `feedback_wave_gate_discipline.md`)

- Pre-fix RED tests (7 unit + 3 int) FAIL on stub
- L1: tsc × 3 + key guards + 1158+ fix-registry anchors PASS
- L2: 3× flake on new tests + 0 regressions
- L3: code-reviewer-general PASS
- L4: clinical-safety-reviewer PASS (touches `patients`, `clinical_notes` indirectly via deceased_date column)
- L5: architecture-reviewer PASS (storage migration + new feature directory + new UI panel)
- 2-REJECT cap default BLOCKED per `feedback_explicit_override_for_2reject_cap.md`
- Atomic catalogue flip per `feedback_atomic_catalogue_flip.md`
- Explicit per-cycle user push authorization per `feedback_explicit_push_authorization.md`

See full plan at /Users/drprakashkamath/.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/project_data_retention_policy.md
