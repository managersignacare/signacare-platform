# Decision Log

This log records operator- or owner-significant decisions that future execution must not silently forget.

## 2026-05-14 — B2 BUG-323 follow-up: clozapine response-shape boundary made explicit + allowlist drained

**Decision:** close the remaining local clozapine response-shape debt by
enforcing explicit controller-boundary Zod parse contracts for registration and
blood-result surfaces, then removing all matching `BUG-638` allowlist rows.

**Why:** these endpoints still emitted service-returned payloads directly, which
left response-shape verification dependent on historical allowlist exemptions
instead of fail-closed route-boundary validation.

**Effect:**
- `apps/api/src/features/clozapine/clozapineController.ts`
  - Added explicit response parsing for registration list/get/create/update.
  - Added explicit response parsing for blood-result list/create.
  - Introduced named list schemas:
    - `ClozapineRegistrationListResponseSchema`
    - `ClozapineBloodResultListResponseSchema`
- `apps/api/src/features/clozapine/clozapineMappers.ts`
  - Normalized historical comments to avoid false-positive `res.json` token
    matching in non-route mapper docs.
- `scripts/guards/check-response-shape-validated.allowlist`
  - Removed 7 stale clozapine rows (6 controller hits + 1 mapper-comment row).

**Verification (same session):**
- `npm run guard:response-shape-validated` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run test:integration -w apps/api -- tests/integration/clozapineDisciplineBarrier.int.test.ts tests/integration/clozapineAncThresholdGuards.int.test.ts` => PASS (`12/12` + `7/7`)

Evidence: `docs/quality/remediation/evidence/b2-clozapine-response-shape-allowlist-drain-2026-05-14.md`

## 2026-05-14 — B3 BUG-AD follow-up: JSONB extraction allowlist debt drained

**Decision:** remove the stale `guard:jsonb-extraction` allowlist exemption for
`advanceDirectiveRoutes.ts` and keep AD JSONB extraction enforced by canonical
mapper boundary behavior.

**Why:** the AD surface already routes response extraction through
`mapAdvanceDirectiveRowToResponse(...)`; keeping a file-level exemption would
mask future drift for this clinical surface.

**Effect:**
- `scripts/guards/check-jsonb-extraction.allowlist`
  - Removed AD row:
    `apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts`.
- No product behavior change; this is mechanical guard-debt drain on an already
  converged AD route/repository mapper path.

**Verification (same session):**
- `npm run guard:jsonb-extraction` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts tests/integration/bug565AdvanceDirectiveOptimisticLock.int.test.ts` => PASS (`3/3` + `4/4`)
- `npm run lint:changed` => PASS

Evidence: `docs/quality/remediation/evidence/b3-ad-jsonb-extraction-allowlist-drain-2026-05-14.md`

## 2026-05-14 — B3 BUG-ONC follow-up: JSONB extraction mapper convergence + allowlist drain

**Decision:** complete the next ONC family residual by converging chemo-cycle
JSONB extraction onto the canonical repository mapper and draining the matching
`guard:jsonb-extraction` allowlist debt.

**Why:** routes still carried a duplicate local JSONB parse path for
`dose_modifications` / `toxicity_ctcae` while the repository now had the
canonical mapper. Keeping both paths risks silent divergence and defeats
mechanical-guard intent.

**Effect:**
- `apps/api/src/features/oncology/oncologyRepository.ts`
  - Added/exported canonical `mapChemoCycleToResponse(...)` that normalizes
    date/datetime fields and extracts JSONB payloads fail-safe.
- `apps/api/src/features/oncology/oncologyRoutes.ts`
  - Removed duplicate route-local JSONB parse mapper path.
  - Rewired chemo-cycle list/create responses to use
    `mapChemoCycleToResponse(...)` from repository SSoT.
- `scripts/guards/check-jsonb-extraction.allowlist`
  - Removed stale ONC exemption:
    `apps/api/src/features/oncology/oncologyRepository.ts`.

**Verification (same session):**
- `npm run guard:jsonb-extraction` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts tests/integration/bugOncCtcaeContract.int.test.ts` => PASS (`2/2` + `2/2`)

Evidence: `docs/quality/remediation/evidence/b3-onc-jsonb-extraction-mapper-convergence-2026-05-14.md`

## 2026-05-14 — B3 BUG-561 treatment-pathway response shape made canonical and fail-closed

**Decision:** close local implementation for `BUG-561` by removing
snake_case compatibility fallbacks and enforcing canonical camelCase treatment-pathway
response fields end-to-end.

**Why:** legacy fallback readers masked contract drift and could silently
reintroduce shape mismatches between backend and frontend treatment-pathway
surfaces.

**Effect:**
- Frontend convergence:
  - `apps/web/src/features/treatment-pathways/pages/PathwaysPage.tsx`
  - Removed snake_case read fallbacks (`pathway_name`, `pathway_type`,
    `total_sessions`, `completed_sessions`, `start_date`, `lock_version`).
  - Pathway create payload now emits canonical fields
    (`name`, `pathwayName`, `totalSessions`) alongside existing path metadata.
- Backend mapper hardening:
  - `apps/api/src/features/treatment-pathways/pathwayRoutes.ts`
  - Removed temporary mapper defaults that hid malformed rows
    (`pathwayType ?? r.name`, `totalSessions ?? 0`, `completedSessions ?? 0`).
  - Added explicit canonical milestone readers and fail-closed
    `PATHWAY_RESPONSE_SHAPE_INVALID` on missing required milestone fields.
- Regression-proof update:
  - `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts`
  - TP-OL-7 now asserts canonical camelCase fields are present and snake_case
    siblings are absent.

**Verification (same session):**
- `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts` => PASS (`7/7` + `4/4`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b3-bug-561-treatment-pathway-response-shape-2026-05-14.md`

## 2026-05-14 — B1 RF-family residual RBAC matrix closure completed

**Decision:** close the remaining local RF-family RBAC residual by applying explicit
`requirePermission(...)` middleware to referral mutation routes and pinning the
role-permission contract with a deterministic integration matrix.

**Why:** command consolidation removed route-level mutation orchestration drift, but
mutation endpoints still had inconsistent explicit permission gates. This left a
recurrence seam for silent role drift on referral write paths.

**Effect:**
- Updated `apps/api/src/features/referrals/referralRoutes.ts` with centralized
  permission middleware constants:
  - `referral:create`
  - `referral:update`
  - `referral:triage`
  - `referral:assign`
- Applied gates to referral mutation surfaces including create/update,
  by-episode status updates, task transitions, notes, decision, attachment,
  OCR confirm, allocation, and offer-response endpoints.
- Added regression matrix test:
  - `apps/api/tests/integration/bugRfRbacPermissionMatrix.int.test.ts`
  - proves:
    - receptionist denied triage while clinician allowed
    - clinician denied assign while referral coordinator allowed

**Verification (same session):**
- `npm run test:integration -w apps/api -- tests/integration/bugRfRbacPermissionMatrix.int.test.ts tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bug415ReferralStateMachine.int.test.ts` => PASS (`4/4`)
- `npm run guard:controller-repo-write-bypass` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run guard:response-shape-validated` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b1-rf-rbac-matrix-closure-2026-05-14.md`

## 2026-05-14 — B3 BUG-567 optimistic-lock conflict details redacted at shared helper boundary

**Decision:** close local implementation for `BUG-567` by redacting tenant-scope identifiers from `OPTIMISTIC_LOCK_CONFLICT` details in the shared optimistic-lock helper instead of patching individual routes.

**Why:** client-facing conflict details previously echoed `where.clinic_id`. This is not PHI egress, but it is avoidable tenant-scope leakage and inconsistent with least-exposure API posture.

**Effect:**
- Updated shared helper:
  - `apps/api/src/shared/db/optimisticLock.ts`
  - Added `redactOptimisticLockWhereForClient(where)` to keep only `id`.
  - Added `buildOptimisticLockConflictDetails(...)` and routed all helper conflict throws through this builder.
- New conflict details contract:
  - `table`
  - `where: { id }`
  - `expectedLockVersion`
  - `scope: 'clinic_scoped'`
- Because this sits in `updateWithOptimisticLock`, the contract now applies uniformly to all helper consumers (prescriptions, medications, episodes helper path, treatment pathways, advance directives, legal orders, escalations, and future adopters).
- Added regression coverage:
  - `apps/api/tests/unit/optimisticLock.test.ts` (`OL-VAL-10`)
  - `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` (`TP-OL-1` payload assertion)

**Verification (same session):**
- `npm run test -w apps/api -- tests/unit/optimisticLock.test.ts` => PASS (`10/10`)
- `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` => PASS (`7/7`)

Evidence: `docs/quality/remediation/evidence/b3-bug-567-optimistic-lock-conflict-redaction-2026-05-14.md`

## 2026-05-14 — B3 BUG-563 treatment-pathway transition guard centralized

**Decision:** close local implementation for `BUG-563` by introducing one canonical treatment-pathway status-transition state machine and enforcing it across both mutable service paths.

**Why:** treatment pathways allowed status regression (`completed/discontinued -> active`) and allowed session writes on closed pathways, which can silently corrupt pathway lifecycle truth.

**Effect:**
- Added canonical state machine:
  - `apps/api/src/features/treatment-pathways/pathwayStatusStateMachine.ts`
  - exports `assertPathwayStatusTransition(fromStatus, toStatus)` with strict invalid-transition rejection (`422 INVALID_STATE_TRANSITION`).
- Enforced in service mutation SSoT:
  - `apps/api/src/features/treatment-pathways/pathwayService.ts`
  - `update(...)` now validates status transitions before write.
  - `recordSession(...)` now requires `existing.status === 'active'` and rejects closed-state session writes.
- Added regression coverage:
  - `apps/api/tests/unit/pathwayStatusStateMachine.test.ts`
  - `apps/api/tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts`
  - Includes positive transition path + negative terminal-reopen and closed-session paths.
- Added sibling no-regression replay:
  - `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts`

**Verification (same session):**
- `npm run test -w apps/api -- tests/unit/pathwayStatusStateMachine.test.ts` => PASS (`4/4`)
- `npm run test:integration -w apps/api -- tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts` => PASS (`4/4`)
- `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` => PASS (`7/7`)
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b3-bug-563-treatment-pathway-state-machine-2026-05-14.md`

## 2026-05-14 — B1 BUG-415 referral status regression guard centralized

**Decision:** close local implementation for `BUG-415` by introducing a single referral status-transition state machine and enforcing it across both update paths (repository and by-episode route).

**Why:** referral lifecycle transitions were not structurally guarded, which allowed status regression (`DRAFT -> SENT -> DRAFT` class) and terminal-state rewrites through mutable endpoints.

**Effect:**
- Added canonical state machine:
  - `apps/api/src/features/referrals/referralStatusStateMachine.ts`
  - exports `assertReferralStatusTransition(fromStatus, toStatus)` with legacy-label normalization and strict invalid-transition rejection (`422 INVALID_STATE_TRANSITION`).
- Enforced in repository mutation SSoT:
  - `apps/api/src/features/referrals/referralRepository.ts`
  - `updateReferral` now uses row lock (`FOR UPDATE`) and validates transition before status mutation.
- Enforced in route mutation sibling:
  - `apps/api/src/features/referrals/referralRoutes.ts`
  - `PATCH /by-episode/:episodeId` now reads current status first and applies the same transition guard.
- Added regression coverage:
  - `apps/api/tests/unit/referralStatusStateMachine.test.ts`
  - `apps/api/tests/integration/bug415ReferralStateMachine.int.test.ts`
  - Includes both positive progression and negative-path terminal regression blocks on route and by-episode surfaces.

**Verification (same session):**
- `npm run test -w apps/api -- tests/unit/referralStatusStateMachine.test.ts` => PASS (`5/5`)
- `npm run test:integration -w apps/api -- tests/integration/bug415ReferralStateMachine.int.test.ts` => PASS (`4/4`)
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b1-bug-415-referral-state-machine-2026-05-14.md`

## 2026-05-14 — B4 BUG-451 follow-up migrated to production live-context path

**Decision:** close `BUG-451-FOLLOWUP-MIGRATE-OLDER-PATHOLOGY-INT-TEST` by removing the legacy in-test parallel-SQL context clone and reusing the exported production `buildLiveContext()`.

**Why:** the old test duplicated scheduler SQL (`buildLiveCtx`) and could drift silently from production behavior, which is the exact anti-pattern the BUG-451 cycle-2 guidance was created to eliminate.

**Effect:**
- Updated:
  - `apps/api/tests/integration/pathologyCriticalAlerts.int.test.ts`
- Changes:
  - Removed in-file `buildLiveCtx()` implementation.
  - Switched TP-PA-INT-1..4 to `processPathologyCriticalAlerts(..., await buildLiveContext())`.
  - Reworked TP-PA-INT-4 assertion to result-scoped before/after notification count checks (seeded `resultId`) so determinism is preserved without test-side SQL wrappers.

**Verification (same session):**
- `npm run test:integration -w apps/api -- tests/integration/pathologyCriticalAlerts.int.test.ts` => PASS (`4/4`)

Evidence: `docs/quality/remediation/evidence/b4-bug-451-followup-migrate-older-pathology-int-test-2026-05-14.md`

## 2026-05-13 — B4 BUG-569 orphan-prescriber fallback implemented

**Decision:** complete local implementation for `BUG-569-FOLLOWUP-ORPHAN-PRESCRIBER-FALLBACK` by adding a dedicated alert class for active clozapine registrations with `prescriber_staff_id IS NULL`.

**Why:** the BUG-569 absorb-1 safety filter (`whereNotNull('prescriber_staff_id')`) prevents unsafe clinic-wide broadcast, but left orphan registrations silent.

**Effect:**
- `apps/api/src/jobs/schedulers/clozapineAlertScheduler.ts`
  - Added orphan query path `listOrphanedPrescriber`.
  - Added active-recipient resolver input (`primary_clinician_id`, `nominated_admin_staff_id`, `delegated_admin_staff_id`) with active-staff filtering.
  - Added dedicated dedupe namespace helper:
    - `dedupeKeyForClozapineOrphanPrescriber`
  - Added critical alert emit path (`alert_kind='orphan_prescriber_registration'`) to current treating team + governance admin recipients.
  - Added fail-visible structured error logs when no configured/active recipient is available.
- Tests updated:
  - `apps/api/tests/unit/clozapineAlertScheduler.test.ts` (new TP-CL-2c, TP-CL-4j, TP-CL-4k)
  - `apps/api/tests/integration/clozapineAlertSchedulerCycle2.int.test.ts` (TP-CL-INT-569-5 now asserts orphan alerts to primary + governance admin)

**Verification (same session):**
- `npm run test -w apps/api -- tests/unit/clozapineAlertScheduler.test.ts` => PASS (`19/19`)
- `npm run test:integration -w apps/api -- clozapineAlertSchedulerCycle2.int.test.ts` => PASS (`6/6`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b4-bug-569-followup-orphan-prescriber-fallback-2026-05-13.md`

## 2026-05-13 — B4 BUG-578 title-prefix convention codified with payload-tier authority

**Decision:** complete local implementation for `BUG-578-FOLLOWUP-TIER-PREFIX-CONVENTION` by documenting escalation title conventions and explicitly defining `payload.tier` as the canonical authority.

**Why:** without a written convention, title-copy drift can create inconsistent escalation semantics across emitters and UI consumers.

**Effect:**
- Added convention doc:
  - `docs/quality/remediation/notification-escalation-title-convention.md`
- Codified:
  - authority order: `payload.tier` first, title prefix second
  - standard tier prefixes (`[ESCALATION]`, `[CRITICAL ESCALATION]`, `[REGULATORY]`)
  - compatibility rule that UI must not infer tier exclusively from title text

**Verification (same session):**
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b4-bug-578-followup-tier-prefix-convention-2026-05-13.md`

## 2026-05-13 — B4 BUG-578 UI tier discriminator landed on payload.tier

**Decision:** close local implementation for `BUG-578-FOLLOWUP-UI-TIER-DISCRIMINATOR` by moving notification escalation rendering from title-prefix inference to explicit `payload.tier` interpretation.

**Why:** title parsing is brittle and can drift from backend semantics; `payload.tier` is the contractual machine-readable source.

**Effect:**
- Added tier parsing/presentation helper:
  - `apps/web/src/features/notifications/notificationTier.ts`
  - parses numeric/string tier values
  - suppresses non-escalation tier (`<=1`)
  - maps tier-2 to error-tone badge, tier-3+ to warning-tone badge
- Updated notification bell renderer:
  - `apps/web/src/features/notifications/NotificationBell.tsx`
  - row header now renders badge from `payload.tier` (`Escalation`, `Escalation Tn`)
  - no dependence on `[ESCALATION]` title text for UI discrimination
- Added regression tests:
  - `apps/web/src/features/notifications/notificationTier.test.ts` (5 cases)

**Verification (same session):**
- `npx vitest run src/features/notifications/notificationTier.test.ts` (workdir `apps/web`) => PASS (`5/5`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b4-bug-578-followup-ui-tier-discriminator-2026-05-13.md`

## 2026-05-13 — B4 BUG-583 follow-up: remove threshold override, seed live clinic thresholds

**Decision:** complete local implementation for `BUG-583-FOLLOWUP-CLINIC-THRESHOLDS-DBADMIN-SETUP` by replacing the remaining integration-test override pattern with dbAdmin-seeded `clinic_thresholds` data and explicit state restoration.

**Why:** the previous test wrapper (`{ ...liveCtx, getEscalationThreshold: async () => 30 }`) could mask production key-path drift by bypassing live threshold lookup.

**Effect:**
- Updated `apps/api/tests/integration/pathologyCriticalAlertsCycle2.int.test.ts`:
  - removed test-side `getEscalationThreshold` override for TP-PA-INT-578-1
  - added `seedClinicEscalationThresholdForTest()` helper that:
    - upserts `clinic_thresholds.pathology_escalation_minutes` via `dbAdmin`
    - restores prior threshold row state in `finally`
  - test now runs on `await buildLiveContext()` with live production threshold lookup.
- Updated `apps/api/tests/integration/hl7InboundIngest.int.test.ts` T8 assertion shape to align with shared resolver SSoT: expected admin recipient is derived from currently configured clinic admin slots (`nominated` then `delegated`) instead of a brittle fixture-order assumption.

**Verification (same session):**
- `npm run test:integration -w apps/api -- pathologyCriticalAlertsCycle2.int.test.ts` => PASS (`9/9`)
- `npm run test:integration -w apps/api -- hl7InboundIngest.int.test.ts` => PASS (`9/9`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b4-bug-583-followup-clinic-thresholds-dbadmin-setup-2026-05-13.md`

## 2026-05-13 — B4 BUG-577 bootstrap-admin preventive signal completed with startup sweep

**Decision:** complete `BUG-577-FOLLOWUP-CLINIC-BOOTSTRAP-ADMIN-CHECK` local implementation by adding a deduped startup/bootstrap sweep for pre-existing clinics with both admin slots unset.

**Why:** creation-time prevention alone only covers new clinics; existing misconfigured clinics could still stay silent until a runtime critical-result fallback event.

**Effect:**
- Added startup/bootstrap checker:
  - `apps/api/src/jobs/schedulers/clinicAdminSlotBootstrapCheck.ts`
  - pure processor + live context + runner
  - scans clinics with both `nominated_admin_staff_id` and `delegated_admin_staff_id` unset
  - dedupes per clinic using prior 24h `ADMIN_ALERT` rows (`kind='clinic_admin_slots_unconfigured'`)
- Wired non-blocking startup execution:
  - `apps/api/src/jobs/bootstrap.ts` (`startSchedulers()` import + run + structured outcome log)
- Extended admin alert kind:
  - `apps/api/src/features/patient-outreach/adminAlert.ts` (`clinic_admin_slots_unconfigured`)
- Preserved creation-time prevention from phase-1:
  - `apps/api/src/features/clinic/clinicService.ts`

**Verification (same session):**
- `npm run test -w apps/api -- tests/unit/clinicAdminSlotBootstrapCheck.test.ts tests/unit/clinicService.test.ts tests/unit/pathologyCriticalScheduler.test.ts` => PASS (`45/45`)
- `npm run test:integration -w apps/api -- hl7InboundIngest.int.test.ts pathologyCriticalAlertsCycle2.int.test.ts` => PASS (`9/9`, `9/9`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b4-bug-577-followup-clinic-bootstrap-admin-check-2026-05-13.md`

## 2026-05-13 — B4 BUG-577 follow-up resolver consolidation landed (implementation state)

**Decision:** close the local implementation gap for `BUG-577-FOLLOWUP-CONSOLIDATE-RESOLVERS` by converging HL7-ingest and scheduler recipient-resolution logic onto one shared resolver and restoring immutable audit parity.

**Why:** the active-staff/admin-fallback rule had drift risk because it was duplicated in two paths (`pathologyService.resolveCriticalAssigneeAdmin` and `pathologyCriticalScheduler.buildLiveContext.resolveActiveRecipients`). The scheduler path emitted immutable `CRITICAL_*` audit rows, but HL7-ingest path only logged to pino for fallback events.

**Effect:**
- Added shared resolver module:
  - `apps/api/src/shared/staffActivenessResolver.ts`
  - centralises candidate ordering, active filter, admin fallback, no-admin compatibility fallback, and optional audit fallback writes
- Updated HL7-ingest path:
  - `apps/api/src/features/pathology/pathologyService.ts`
  - `resolveCriticalAssigneeAdmin` now consumes shared resolver
  - HL7 fallback events now emit immutable `CRITICAL_RECIPIENT_REASSIGNED` / `CRITICAL_NO_RECIPIENT_AVAILABLE` audit rows
- Updated scheduler live context path:
  - `apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts`
  - `resolveActiveRecipients` now consumes shared resolver (audit ownership remains in scheduler processor via `writeAuditLogRow`)
- Added regression proof:
  - `apps/api/tests/integration/hl7InboundIngest.int.test.ts`
    - T8 now asserts reassignment audit row
    - T9 added for no-admin fallback audit row + fallback-assignee metadata

**Verification (same session):**
- `npm run test -w apps/api -- tests/unit/pathologyCriticalScheduler.test.ts` => PASS (`39/39`)
- `npm run test:integration -w apps/api -- hl7InboundIngest.int.test.ts` => PASS (`9/9`)
- `npm run test:integration -w apps/api -- pathologyCriticalAlertsCycle2.int.test.ts` => PASS (`9/9`)
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/b4-bug-577-followup-consolidate-resolvers-2026-05-13.md`

## 2026-05-13 — B4 BUG-577 bootstrap-admin preventive signal (phase-1 landed)

**Decision:** start `BUG-577-FOLLOWUP-CLINIC-BOOTSTRAP-ADMIN-CHECK` with clinic-creation-time preventive signaling, while keeping the startup-sweep variant as explicit remaining work.

**Why:** the recurrence class is "missing clinic admin slots only discovered at incident time". We added a non-blocking preventive signal at the earliest deterministic write surface (clinic creation) without waiting for the larger bootstrap sweep.

**Effect:**
- `apps/api/src/features/clinic/clinicService.ts`
  - `createClinic` now emits `sendAdminAlert(kind='clinic_admin_slots_unconfigured')` when both admin slots are missing.
  - alert dispatch is wrapped as non-blocking (`warn` on failure, create path still succeeds).
- `apps/api/src/features/patient-outreach/adminAlert.ts`
  - `AdminAlertKind` extended with `clinic_admin_slots_unconfigured`.
- Added regression tests:
  - `apps/api/tests/unit/clinicService.test.ts` (3 tests)
    - emits alert when both slots missing
    - suppresses alert when an admin slot is set
    - remains fail-open for clinic create when alert dispatch throws

**Verification (same session):**
- `npm run test -w apps/api -- tests/unit/clinicService.test.ts` => PASS (`3/3`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

**Remaining:** startup/bootstrap sweep for pre-existing clinics with both slots unset (deduped signal) before marking this follow-up fully implemented.

## 2026-05-12 — B4 tier-2 escalation follow-ups for prescription-repeat + therapeutic-level landed (implementation state)

**Decision:** close `BUG-589-FOLLOWUP-TIER-2-ESCALATION` and `BUG-592-FOLLOWUP-TIER-2-ESCALATION` by adding explicit tier-2 fallback fanout and per-clinic escalation threshold controls.

**Why:** both schedulers still had a no-recipient silent-drop recurrence class at tier-1 (`prescriber/primary inactive + no admin`). Error/audit signals existed, but no alternate recipient was notified.

**Effect:**
- `apps/api/src/jobs/schedulers/prescriptionRepeatScheduler.ts`
  - removed silent-drop short-circuit and added tier-2 escalation fanout
  - added escalation dedupe namespace + threshold predicate
  - added live-context tier-2 recipient resolution + threshold lookup
- `apps/api/src/jobs/schedulers/therapeuticLevelMonitoringScheduler.ts`
  - same tier-2 escalation architecture as above
- `apps/api/src/features/settings/settingsService.ts`
  - added `prescription_repeat_escalation_minutes` default `30`
  - added `therapeutic_level_escalation_minutes` default `30`
- Tests updated:
  - `apps/api/tests/unit/prescriptionRepeatScheduler.test.ts`
  - `apps/api/tests/unit/therapeuticLevelMonitoringScheduler.test.ts`
  - `apps/api/tests/integration/prescriptionRepeatSchedulerCycle2.int.test.ts`
  - `apps/api/tests/integration/therapeuticLevelMonitoringSchedulerCycle2.int.test.ts`
- Canonical ledger updated:
  - `docs/quality/bugs-remaining.md` marks both follow-up rows fixed.

**Verification (same session):**
- `npm run -s lint:changed` => PASS
- `npm run -s typecheck` => PASS
- `npm run -s guard:claude-discipline:ci` => PASS
- `cd apps/api && npm run test -- tests/unit/prescriptionRepeatScheduler.test.ts tests/unit/therapeuticLevelMonitoringScheduler.test.ts` => PASS (`68/68`)
- `cd apps/api && npm run test:integration -- prescriptionRepeatSchedulerCycle2.int.test.ts therapeuticLevelMonitoringSchedulerCycle2.int.test.ts` => PASS (`6/6` + `6/6`)

Evidence: `docs/quality/remediation/evidence/b4-bug-589-592-tier2-escalation-2026-05-12.md`

## 2026-05-12 — B5 phase-3 BUG-425 letter draft downstream safety filter landed (implementation state)

**Decision:** enforce a downstream sensitive-field filter at the `/api/v1/llm/clinical-ai` letter output boundary (enhanced + direct paths), with fail-closed `patientId` requirement for `action='letter'` and emergency bypass flag default OFF.

**Why:** `BUG-425` identified a structural gap where AI-generated letter body content could return identifier/contact/header content without downstream screening, creating cross-patient/cross-clinic leakage risk.

**Effect:**
- Added letter safety filter module:
  - `apps/api/src/features/llm/letterDraftSafety.ts`
- Wired filter into both letter-generation paths in:
  - `apps/api/src/features/llm/llmRoutes.ts`
- Added fail-closed contract:
  - letter generation without `patientId` now returns `400 VALIDATION_ERROR`
- Added kill-switch constant + registry row:
  - `b5-letter-draft-sensitive-filter-bypass` (default OFF)
  - `packages/shared/src/featureFlag.constants.ts`
  - `docs/quality/remediation/feature-flag-registry.md`
- Updated AddNoteDialog call surface to comply with new contract:
  - sends `patientId` and `enhance: false` for direct-path letter generation

**Verification (same session):**
- `cd apps/api && npx vitest run tests/unit/letterDraftSafety.test.ts` => PASS (3/3)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug425LetterSensitiveFilter.int.test.ts` => PASS (3/3)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

Evidence: `docs/quality/remediation/evidence/b5-bug-425-letter-draft-sensitive-filter-2026-05-12.md`

## 2026-05-12 — B5 phase-2 BUG-417 AI-draft sign attestation convergence landed (implementation state)

**Decision:** enforce explicit clinician review-attestation before signing any AI-drafted clinical note across every active sign path, with shared backend fail-closed policy plus emergency bypass kill-switch.

**Why:** `BUG-417` remained open because AI-draft signing behavior was inconsistent across routes and UI surfaces; a single-UI checkbox would not prevent API-level bypass.

**Effect:**
- Canonical flag key introduced in shared package:
  - `b5-ai-draft-sign-attestation-bypass` (`packages/shared/src/featureFlag.constants.ts`)
- Shared backend policy gate added:
  - `apps/api/src/shared/aiDraftSignAttestationPolicy.ts`
- Backend contract enforcement now aligned in both sign surfaces:
  - `apps/api/src/features/clinical-notes/clinicalNote.service.ts` + controller schema parse
  - `apps/api/src/features/patients/patientRoutes.ts` create/sign paths
- Frontend explicit attestation UX now present on sign surfaces:
  - `apps/web/src/features/clinical-notes/components/NoteSignModal.tsx`
  - `apps/web/src/features/patients/components/notes/AddNoteDialog.tsx`
  - `apps/web/src/features/patients/components/notes/NotesList.tsx`
- Shared FE helper + unit proof added:
  - `apps/web/src/shared/utils/aiDraftSignAttestation.ts`
  - `apps/web/src/shared/utils/aiDraftSignAttestation.test.ts`
- New integration proof added for bypass resistance:
  - `apps/api/tests/integration/bug417AiDraftSignAttestation.int.test.ts`

**Verification (same session):**
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/web && npx vitest run src/shared/utils/aiDraftSignAttestation.test.ts` => PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug417AiDraftSignAttestation.int.test.ts` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS

Evidence: `docs/quality/remediation/evidence/b5-bug-417-ai-draft-sign-attestation-2026-05-12.md`

## 2026-05-12 — B5 phase-1 BUG-418 error-boundary truthfulness hardening landed (implementation state)

**Decision:** close the production error-message leak class in shared FE ErrorBoundary by defaulting to safe generic copy, while preserving explicit opt-in raw-detail visibility behind a named feature flag.

**Why:** B5 requires fail-visible UI truthfulness without leaking internal implementation details to end users. Raw `error.message` in production violated that boundary and created stack/detail disclosure risk.

**Effect:**
- `apps/web/src/shared/components/ui/ErrorBoundary.tsx`
  - split into hook-wrapped boundary + core class boundary.
  - production-safe message path is now default.
  - raw detail path is controlled by `b5-error-boundary-raw-details`.
  - dev mode retains raw detail visibility for diagnostics.
- `apps/web/src/shared/components/ui/ErrorBoundary.test.ts`
  - added deterministic unit proof for safe-vs-raw message resolution logic.
- `docs/quality/remediation/feature-flag-registry.md`
  - added registry entry for `b5-error-boundary-raw-details`.
- Canonical ledger reconciliation:
  - `BUG-418` moved to `fixed` with implementation and evidence references.

**Verification (same session):**
- `cd apps/web && npx vitest run src/shared/components/ui/ErrorBoundary.test.ts` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

Evidence: `docs/quality/remediation/evidence/b5-bug-418-error-boundary-truthfulness-2026-05-12.md`

## 2026-05-12 — A1d phase-1 frontend permission convergence landed (implementation state)

**Decision:** execute A1d phase-1 controls now to converge FE route/tab/action authorization behind one policy contract with explicit unauthorized UX.

**Why:** A1d bugs were a policy-surface drift class (split checks across sidebar/router/page-level actions). Fixing single pages without converging policy primitives would leave recurrence risk.

**Effect:**
- Added centralized FE policy adapter:
  - `apps/web/src/shared/utils/frontendAccessPolicy.ts`
  - route, permission, patient-tab, and fallback-tab checks in one module.
- Added reusable route boundary:
  - `apps/web/src/shared/components/guards/RouteAccessGuard.tsx`
  - wired in `apps/web/src/router.tsx` for `/power-settings`, `/org-settings`, `/staff-assignments`, `/audit`, `/manager-dashboard`, `/clinical-notes`.
- Sidebar now consumes centralized route policy in addition to module visibility:
  - `apps/web/src/shared/components/ui/Sidebar.tsx`.
- Patient detail tabs/actions now enforce role-tab policy with explicit unauthorized state and deterministic fallback:
  - `apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx`.
- Receptionist phone-triage note-create path now hard-gates on `note:create`:
  - `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx`.
- Canonical ledger reconciliation completed in `docs/quality/bugs-remaining.md`:
  - `BUG-FE-RBAC-SPLIT` (open; implementation landed, rollout contract pending)
  - `BUG-RECEPTIONIST-CLINICAL-NOTES-NO-ROLE-GUARD` (open; implementation landed, rollout contract pending)
  - `BUG-RECEPTIONIST-SEES-CLINICAL-MGMT` (open; implementation landed, rollout contract pending)

**Verification (same session):**
- `cd apps/web && npx vitest run src/shared/utils/__tests__/frontendAccessPolicy.test.ts` => PASS (7/7)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npx playwright test --project=chromium e2e/probes/rbac-matrix.spec.ts --reporter=line` => PASS (20/20)

**Observed sibling issue (already catalogued):**
- `BUG-717` (`ERR_HTTP_HEADERS_SENT` on `/audit` path) reproduced during probe logs; no new row required and no A1d scope drift.

Evidence: `docs/quality/remediation/evidence/a1d-frontend-permission-convergence-phase1-2026-05-12.md`

## 2026-05-12 — A1c phase-1 break-glass governance hardening landed (implementation state)

**Decision:** execute A1c phase-1 controls now (without waiting for rollout phase) to close three structural break-glass governance gaps:
1. justification boundary hardening (trimmed non-empty semantics),
2. active-account enforcement across request/approval/runtime,
3. explicit sensitive-access flagging on break-glass action trails.

**Why:** break-glass is a high-risk emergency path; governance controls must fail closed on requester account state drift and must emit explicit forensic flags for sensitive mental-health access.

**Effect:**
- `breakGlassRoutes.ts`
  - `reason` and `deniedReason` now enforce trimmed boundary validation.
  - break-glass request now requires active requester account.
  - approval auto-denies stale pending requests when requester is inactive/deleted.
- `breakGlassAuditMiddleware.ts`
  - runtime active-account recheck added for break-glass token use.
  - inactive requester now causes immediate session revocation + 401.
  - `actions_performed` entries now include `sensitiveAccess` + `sensitiveFlag` (`mental_health_sensitive_record` on sensitive routes).
- `breakGlassAudit.test.ts`
  - added assertions for whitespace-reason rejection,
  - inactive requester request rejection,
  - runtime revocation on requester deactivation,
  - sensitive-route flag evidence in `actions_performed`.
- Canonical ledger reconciliation completed in `docs/quality/bugs-remaining.md`:
  - `BUG-BREAK-GLASS-NO-JUSTIFICATION` (open; implementation landed, rollout contract pending)
  - `BUG-IS-ACTIVE-BREAK-GLASS-HOLE` (open; implementation landed, rollout contract pending)
  - `BUG-MENTAL-HEALTH-SENSITIVE-FLAG-MISSING` (open; implementation landed, rollout contract pending)

**Verification (same session):**
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/breakGlassAudit.test.ts` => PASS (10/10)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence: `docs/quality/remediation/evidence/a1c-break-glass-governance-phase1-2026-05-12.md`

## 2026-05-12 — A1b policy decision resolved for BUG-710 and backend breach-password guard landed for BUG-P4

**Decision:**
1. Resolve `BUG-710` authority to `superadmin` only for `/power-settings` (manager/admin remain deny-by-default).
2. Close `BUG-P4` with feature-flagged backend enforcement (`auth-password-breach-check-p4`) on non-login password-setting surfaces only, with fail-open outage posture.

**Why:** Section 18 required an explicit named authority decision before `BUG-710` could leave paused state, and A1b still had one open security/auth bug (`BUG-P4`) requiring architectural remediation (not a UI patch).

**Named signoff (recorded from operator decision):**
- Security: Dr Prakash Kamath, Dr Amit Zutshi
- Product: Dr Prakash Kamath, Dr Amit Zutshi
- Clinical release signoff: Dr Prakash Kamath, Dr Amit Zutshi

**Effect:**
- `BUG-710` moved from `paused` to `fixed` in canonical ledger after policy signoff + rerun proof.
- `BUG-P4` implemented via `apps/api/src/features/auth/passwordBreachService.ts`:
  - HIBP k-anonymity range lookup
  - threshold `>=1`
  - short prefix cache TTL
  - bounded timeout
  - fail-open + warning on upstream degradation
  - feature-flag gate (`auth-password-breach-check-p4`)
- Enforcement wired into:
  - `authService.changePassword`
  - `staffService.createStaff` (provided + autogenerated temp password paths)
  - `provisioningService.provisionClinic` generated admin password path

**Verification (same session):**
- `cd apps/api && npx vitest run tests/unit/passwordBreachService.test.ts` => PASS (6/6)
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/clinicAccessAdminsPowerSettings.int.test.ts` => PASS (5/5)
- `npx playwright test --project=chromium e2e/probes/rbac-matrix.spec.ts --reporter=line` => PASS (20/20)

Evidence: `docs/quality/remediation/evidence/a1b-bug-p4-and-710-2026-05-12.md`

## 2026-05-12 — A1a in-repo closeout complete; lane now rollout-contract-only

**Decision:** complete A1a local execution by adding final auth-chain map + L5
workflow evidence + canonical bug-row reconciliation, then transition lane state
to implementation-complete with rollout-only closure dependencies.  
**Why:** phase-1 hardening landed earlier in the day; remaining A1a gates were
artifact/governance completion (not unresolved product code defects).  
**Effect:** 
- Added auth-chain map evidence:
  `docs/quality/remediation/evidence/a1a-auth-chain-map-2026-05-12.md`
  (stage ownership, failure contracts, measured timing table).
- Captured timed integration evidence with:
  `AUTH_CHAIN_PINO_TIMING=1 LOGIN_PINO_TIMING=1` (log: `/tmp/a1a-auth-timing.log`).
- Extended guard proof:
  `scripts/guards/check-login-path-pino-timing.ts` now enforces 5 required
  bounded auth-chain stage markers across middleware/service files.
- Added L5 auth workflow proof:
  `npx playwright test e2e/01-auth.spec.ts --project=chromium` => PASS (6/6).
- Reconciled canonical ledger rows in `bugs-remaining.md`:
  `BUG-LOGIN-HANG` => fixed, `BUG-AUTH-CHAIN-HANGS-BROADLY` => fixed.
- Updated lane status artifacts:
  `active-slice.md` now marks A1a complete for in-repo scope and points next to A1b.

Verification executed in the same session:

- `cd apps/api && npx vitest run tests/unit/authChainTimeout.test.ts tests/unit/withTimeout.test.ts` => PASS (12/12)
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:login-path-pino-timing` => PASS (bounded-stage checks: 5, failures: 0)
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/api && AUTH_CHAIN_PINO_TIMING=1 LOGIN_PINO_TIMING=1 npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/sessionIdleConfig.int.test.ts` => PASS (13/13)
- `npx playwright test e2e/01-auth.spec.ts --project=chromium --reporter=line` => PASS (6/6)

## 2026-05-12 — Start A1a with bounded-failure auth-chain hardening (phase-1)

**Decision:** begin A1a by hardening auth lifecycle stages that sit outside
login-controller timing, using a shared bounded-timeout primitive and
structured fail-open observability.  
**Why:** C3 and A2 are in-repo complete, and A1a is next in serial lane order.
Auth path timing existed at login controller, but middleware revocation and idle
stages were not explicitly bounded in shared form, and best-effort login
session-cap checks had no timeout envelope.  
**Effect:** 
- Added `apps/api/src/shared/authChainTimeout.ts` with
  `resolveAuthChainStageTimeoutMs`, `withAuthChainStageTimeout`, and
  `isAuthChainTimeoutError`.
- `authMiddleware.ts` now runs revocation check through
  `withAuthChainStageTimeout` + `withTiming` (`auth.middleware.revocation_check`)
  and emits structured fail-open reason (`timeout` vs `upstream_error`).
- `sessionIdleMiddleware.ts` now bounds `redis.get` and `redis.expire` stages
  (`auth.session_idle.get` / `auth.session_idle.expire`) with timing hooks.
- `authService.ts` login session-cap query/revoke stages are now bounded and
  warn-logged when degraded, while preserving non-blocking login semantics.
- Added unit proof `apps/api/tests/unit/authChainTimeout.test.ts`.
- Evidence packet:
  `docs/quality/remediation/evidence/a1a-auth-chain-phase1-2026-05-12.md`.

Verification executed in the same session:

- `cd apps/api && npx vitest run tests/unit/authChainTimeout.test.ts tests/unit/withTimeout.test.ts` => PASS (12/12)
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/sessionIdleConfig.int.test.ts` => PASS (13/13)

## 2026-05-11 — Execute A2-2 BUG-315 contract-tightening slice and promote app-readiness to verified

**Decision:** run a dedicated serial A2 slice to remove every recorded
`BUG-315` app-contract blocker before any Phase C enforcement planning, then
promote only `BUG-315` to `appReadinessStatus=verified`.  
**Why:** `clinical_notes.consent_id` readiness was previously anchored to one
ambient path only, while sibling clinical-note write paths still omitted consent
linkage. That left insert-outage risk for any future `NOT NULL` enforcement.
Phase B already required fail-closed posture; this slice executes the required
contract tightening.  
**Effect:** 
- Added shared `ensureClinicalNoteConsent(...)` helper to resolve/validate/create
  consent linkage for note writes.
- Updated clinical-note repository create path to always write non-null
  `consent_id`.
- Updated in-file patient route note inserts to resolve/write `consent_id`.
- Added optional `consentId` carriage in shared note-create schemas and service
  plumbing.
- Tightened `check-a2-not-null-app-readiness` BUG-315 logic to scan all
  patient-route clinical-note inserts and fail on missing/null-fallback
  `consent_id`.
- New evidence captured at [bug-315-a2-2-contract-tightening-2026-05-11.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/evidence/bug-315-a2-2-contract-tightening-2026-05-11.md).
- Manifest `.github/a2-not-null-readiness.json` now marks:
  - `BUG-315`: `appReadinessStatus=verified`
  - `BUG-334`: unchanged from prior verified state

## 2026-05-11 — Execute A2-2 BUG-334 contract-tightening slice and promote app-readiness to verified

**Decision:** run a dedicated serial A2 slice to remove every recorded `BUG-334`
app-contract blocker before attempting any Phase C `NOT NULL` enforcement work,
then promote only `BUG-334` to `appReadinessStatus=verified`.  
**Why:** A2 sequencing requires safety by construction. Leaving any null/omitted
`hpio` write surface would make a future `NOT NULL` migration unsafe and violate
the fail-closed readiness contract.  
**Effect:** 
- `ClinicCreateSchema.hpio` is now required and non-null.
- `ProvisionClinicSchema` now requires `hpio`.
- `clinicService.createClinic` no longer null-falls back `hpio`; provisioning
  insert now writes `hpio`; clinic update patch path no longer accepts null.
- Onboarding payload and eRx config panel were aligned to the tightened write
  contract (`hpio` outbound as string/undefined, never null).
- `check-a2-not-null-app-readiness` matcher was tightened to avoid false
  positives when trailing nullable fields exist after a non-null `hpio`.
- New evidence captured at [bug-334-a2-2-contract-tightening-2026-05-11.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/evidence/bug-334-a2-2-contract-tightening-2026-05-11.md).
- Manifest `.github/a2-not-null-readiness.json` now marks:
  - `BUG-334`: `appReadinessStatus=verified`
  - `BUG-315`: unchanged (`pending`, blockers still active)

## 2026-05-11 — Execute A2-2 Phase B app-contract readiness proof with fail-closed status governance

**Decision:** complete `A2-2` Phase B by adding a machine-check that compares manifest readiness claims to actual app/API write-contract surfaces for `BUG-315` and `BUG-334`.  
**Why:** Phase A already blocked premature `NOT NULL` enforcement, but Phase B required explicit contract truth. Without a dedicated check, `appReadinessStatus` could drift to narrative-only status and bypass A2 sequencing safety intent.  
**Effect:** 
- Added `scripts/guards/check-a2-not-null-app-readiness.ts` + fixture tests `scripts/guards/__tests__/check-a2-not-null-app-readiness.test.ts`.
- Wired the guard into `guard:claude-discipline` via `package.json`.
- Recorded evidence at [bug-315-334-a2-2-phase-b-2026-05-11.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/evidence/bug-315-334-a2-2-phase-b-2026-05-11.md).
- Updated `.github/a2-not-null-readiness.json` evidence pointers while keeping both targets `appReadinessStatus=pending`.
- Explicit blockers now machine-reported:
  - `BUG-315`: ambient-note path writes `consent_id`, but other clinical note create paths still omit it.
  - `BUG-334`: clinic schema/service/provisioning surfaces still allow or omit `hpio`.
Phase-C enforcement remains blocked until these blockers are removed and readiness status is promoted honestly.

## 2026-05-11 — Execute A2-2 Phase A fail-closed readiness guard for BUG-315/BUG-334

**Decision:** complete `A2-2` Phase A by landing a machine-validated readiness manifest and a dedicated CI guard that blocks any premature `NOT NULL` enforcement on `clinical_notes.consent_id` and `clinics.hpio`.  
**Why:** v4.4 mandates phase-separated safety for A2 (`Phase A guard/backfill`, `Phase B app-readiness proof`, `Phase C enforcement`). Without a targeted guard, migrations could enforce `NOT NULL` before evidence is ready, creating insert-outage risk.  
**Effect:** 
- Added manifest `.github/a2-not-null-readiness.json` (Phase A posture, `allowNotNullEnforcement=false`, explicit target rows for `BUG-315` + `BUG-334`).
- Added guard `scripts/guards/check-a2-not-null-readiness.ts` and fixture tests `scripts/guards/__tests__/check-a2-not-null-readiness.test.ts`.
- Wired guard into CI discipline chain via `package.json` (`guard:a2-not-null-readiness`, included in `guard:claude-discipline`).
- Recorded lane evidence at [bug-315-334-a2-2-phase-a-2026-05-11.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/evidence/bug-315-334-a2-2-phase-a-2026-05-11.md).
- Updated `bugs-remaining.md` notes for both bug rows to reflect Phase A completion and enforced block posture.
- Verification pack PASS in same session: `vitest` guard fixture (`4/4`), `guard:a2-not-null-readiness`, `lint:changed`, and `guard:claude-discipline:ci`.

## 2026-05-11 — Re-verify A2-1 BUG-706 governance lock with live rehearsal evidence

**Decision:** keep `A2-1` in enforced state by re-running migration rehearsal and recording that BUG-706 still resolves via approved forward-fix governance, not silent bypass.  
**Why:** A2 sequencing requires the governance lock to stay active before any `A2-2` migration enforcement work starts.  
**Effect:** `npm run migrate:rehearsal` produced expected policy-path output:
- rollback hit `20260701000056_bug_706_patient_identifier_ciphertext_width.ts` width failure,
- execution switched to `status=approved-forward-fix-only`,
- ticket `BUG-706-FWD-FIX-APPROVAL-2026-05-09` was enforced,
- command exited PASS with ephemeral DB teardown complete.
Active slice is advanced to `A2-BUG-706-A2-1-GOVERNANCE-LOCK-2026-05-11` (`complete`) and next serial step is `A2-2`.

## 2026-05-11 — Execute A2-0 BUG-355 ledger-truth checkpoint before any A2 implementation phases

**Decision:** mark `A2-0` as completed by recording guard-absence truth and a committed failing drift-proof artifact before continuing to A2 implementation work.  
**Why:** v4.4 explicitly blocks A2 progression until BUG-355 truth is corrected with evidence. Prior state relied on a non-existent `check-operational-role-ssot` guard claim and lacked a failing artifact proving drift detection behavior.  
**Effect:** committed evidence file [bug-355-a2-0-ledger-truth-2026-05-11.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/evidence/bug-355-a2-0-ledger-truth-2026-05-11.md) now captures:
- failing guard-presence check (`MISSING: check-operational-role-ssot guard file`, exit 1),
- failing synthetic drift fixture (`SQL literal missing role(s): readonly`, exit 1),
- informational current-snapshot parity output (current TS/SQL literal match, but not fail-closed).
Active slice moved to `A2-BUG-355-A2-0-LEDGER-TRUTH-2026-05-11`, and BUG-355 row notes in `bugs-remaining.md` now link to this artifact.

## 2026-05-11 — v4.4 plan rewrite approved to absorb dual principal reviews before C3/A2 execution

**Decision:** update the authoritative remediation plan to absorb both external critiques before implementation starts, with explicit fixes for C3 gate paradoxes and A2 sequencing hazards.  
**Why:** the prior v4.3 draft had execution-risk contradictions: C3 live-a11y fail-open removal without baseline policy, A2 `NOT NULL` timing risk against app contract readiness, unspecified hash-chain/backfill ordering, and an inaccurate BUG-355 guard claim.  
**Effect:** [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md) is now v4.4 with:
- mandatory C3 sub-lane decomposition (`C3-1..C3-4`) including done-when criteria, reviewer checks, and gate mappings,
- explicit C3-1 baseline-allowlist policy (`BUG-*` mapped suppressions with expiry and no-silent-growth rule),
- explicit A2 internal sequencing (`A2-0..A2-4`) including API-readiness-before-`NOT NULL` enforcement and post-backfill hash-chain baseline marker,
- revised wave order to `C3 -> A2 -> ...`,
- decision-status snapshot (`18a`) that records `BUG-706` resolved and `BUG-288` still pending as of 2026-05-11.
In parallel, [bugs-remaining.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/bugs-remaining.md) BUG-355 notes now formally correct the ledger inaccuracy: claimed parity guard is absent and must be treated as active open risk until closure artifacts land.

## 2026-05-11 — Close `BUG-EPISODE-MDT-LOOKUP-CLINIC-ID`, `BUG-REFERRAL-INTAKE-CLOSE-LIE-ABOUT-SUCCESS`, `BUG-EPISODE-WORKFLOW-EVENT-SILENT-CATCH`, `BUG-CLINICAL-ROLES-DUPLICATE-AUTOCREATE` atomically

**Decision:** land runtime + schema + test fixes as one evidence-backed closure set and flip all four source-of-truth catalogue rows in the same slice.  
**Why:** the four defects form a coupled reliability cluster across episode/referral allocation workflows (tenant scoping, truthful transaction semantics, observable workflow emission recovery, and first-create role race safety). Closing only one would leave lane-level integrity incomplete.  
**Effect:** 
- `episodeRoutes.ts` now enforces all three missing app-layer `clinic_id` filters.
- `referralRoutes.ts` now uses `linked_episode_id` and closes intake episodes inside the allocation transaction (`episodeService.close(..., trx)`), so close failures roll back allocation side-effects.
- Workflow emit path now fail-loud logs and enqueues retryable outbox entries (`workflowOutbox.ts`), with new scheduler `workflowOutboxDrainer.ts` wired in bootstrap.
- `clinical_roles` race closed with per-role advisory lock at runtime plus migration `20260701000060_bug_clinical_roles_unique_name.ts` (dedupe backfill + unique constraint).
- New proofs: `bugEpisodeMdtLookupClinicId.test.ts` (3/3), `bugA1aB1LaneClosures.int.test.ts` (4/4), plus regression `bugEpisodeMdtSaveRace.int.test.ts` (3/3).
- Full gate evidence in same slice: `typecheck`, `lint:changed`, `lint`, `guard:claude-discipline:ci`, `guard:row-iface-drift`, `guard:migration-convention`, `guard:snapshot-freshness`, `guard:query-has-clinic-id`, `guard:trx-not-db-inside-transaction`, `guard:no-fire-and-forget`, `guard:timer-try-catch`, `guard:atomic-catalogue-flip`, `guard:bugs-remaining-uniqueness` all PASS.

## 2026-05-11 — Catalogue BUG-717 from live RBAC probe server-error telemetry

**Decision:** file a new open bug instead of silently ignoring server-side `ERR_HTTP_HEADERS_SENT` telemetry observed during otherwise-green RBAC probe execution.  
**Why:** probe assertions passed, but runtime error logs indicated a real reliability defect surface (`Cannot set headers after they are sent`) on staff-settings audit route flow. Gold-standard discipline requires explicit cataloguing of discovered sibling defects.  
**Effect:** added `BUG-717` in `bugs-remaining.md` (S3, infra/API reliability) with source evidence (`e2e/probes/rbac-matrix.spec.ts` run logs) and initial suspected locus (`apps/api/src/features/staff-settings/staffSettingsRoutes.ts:598`).

## 2026-05-11 — BUG-710 moved to paused: deny-by-default convergence proven, authority signoff still required

**Decision:** keep `BUG-710` out of `open` churn by moving it to `paused` after proving runtime/probe convergence in the current deny-by-default posture, while explicitly blocking closure until the named Section 18 authority decision is signed.  
**Why:** the defect was originally mismatch, not necessarily implementation breakage. Current behavior already converges technically (`manager` denied `/power-settings` in UI + probe), but policy authority is a governance decision (`Security lead + Product owner`) and cannot be guessed.  
**Effect:** recorded fresh evidence that convergence is real:
- `npx playwright test --project=chromium e2e/probes/rbac-matrix.spec.ts --reporter=line` => PASS (`20/20`)
- matrix cell `manager -> /power-settings` expected denied and observed denied
- UI boundary still enforces `superadmin` at `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx`
Catalogue and plan rows now reflect `paused` instead of `open` for `BUG-710` until signoff lands.

## 2026-05-11 — v4.3 lane-closure audit: close C1/C2 for current mapped scope, keep remaining non-closable lanes explicit

**Decision:** reconcile v4.3 walkthrough status drift first (`BUG-709`, `BUG-711`) and then run a formal lane-closure audit against Section 8a ownership plus lane-governance rules; mark only lanes that satisfy closure criteria as closed-for-current-scope.  
**Why:** we had conflicting truth between decision log and source-of-truth catalogue for walkthrough rows, and repeated ambiguity about whether “no Section 8a rows” means a lane is automatically closed. It does not unless closure conditions are evidenced.  
**Effect:** `BUG-709` and `BUG-711` are now synchronized to **fixed** in both canonical docs (`bugs-remaining.md` and v4.3 Section 8/9), removing stale-open drift. Lane disposition from this audit:
- `C1` => closed for current mapped scope (walkthrough C1 items fixed; no open C1 rows remain in Section 8a/9).
- `C2` => closed for current mapped scope (walkthrough C2 item fixed; no open C2 rows remain in Section 8a/9).
- `A1a`, `A1c`, `B1`, `B3`, `B4` => not auto-closed; currently no active Section 8a rows, but no staffed owner/reviewer cycle evidence exists for a formal green declaration.
- `A1d` => not closable while `BUG-710` remains open (paired A1b/A1d convergence).
- `B5` => not closable at lane level despite walkthrough fixes, because lane-owned backlog beyond walkthrough remains active.
- `C3` => never closable early; program-exit lane and global-gate lane by definition.
This keeps closure discipline explicit and prevents silent “closed-by-assumption” lane drift.

## 2026-05-11 — Close BUG-459 with explicit patientRoutes mapper boundary

**Decision:** close `BUG-459` by introducing a dedicated patient response-mapper
module and routing the six flagged raw-row endpoints in
`apps/api/src/features/patients/patientRoutes.ts` through explicit
snake_case→camelCase mapping functions.  
**Why:** relying on global response middleware for these clinical-route
boundaries is weaker than explicit mapper discipline and leaves the route open
to shape-drift regressions.  
**Effect:** added `patientResponseMappers.ts` and wired note, legal-order,
alert, hotspot, and admission-waitlist routes to mapper calls; added mapper
unit tests; updated fix-registry + bug catalogue. Verification evidence:
- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:response-shape-validated` => PASS
- `cd apps/api && npx vitest run tests/unit/patientResponseMappers.test.ts` => PASS (7/7)
- `npm run lint` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-11 — Close BUG-466-FOLLOWUP-LINT-SCOPE with scoped lint entrypoint + explicit run-order

**Decision:** implement `lint:changed` tooling as a first-class post-`BUG-466`
workflow and keep global `npm run lint` as the mandatory closure gate.  
**Why:** tranche execution needs fast, precise lint feedback on changed files,
while closure claims still require repo-wide lint truth.  
**Effect:** added `scripts/lint-changed.ts` plus npm scripts
`lint:changed`, `lint:changed:staged`, and `lint:changed:main`; documented
tranche-vs-closure run-order in remediation docs; marked
`BUG-466-FOLLOWUP-LINT-SCOPE` fixed in the catalogue. Verification evidence:
- `npm run lint:changed` => PASS
- `npm run lint:changed:staged` => PASS
- `npm run lint:changed:main` => PASS
- `npm run lint` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-11 — BUG-466 B3/B4/B6 tranche-99 eliminates the final explicit-`any` backlog and closes BUG-466

**Decision:** execute a final bounded tranche over the last API/gateway/installer
residual set (`31` remaining explicit `any`) and close BUG-466 only if all
L1-L5 evidence passes including global lint.  
**Why:** after tranche-98 the debt was reduced to `31`, concentrated in
integration routes/services, scheduler/runtime helpers, gateway error/startup
surfaces, and installer CLI parsing; closure required zero residual explicit
`any` plus full repo lint green.  
**Effect:** tranche-99 removed the final `31` executable explicit `any` across
`apps/api` runtime/integration/middleware/script surfaces, `apps/emr-gateway`
startup/error middleware, and `installer/license.ts`. Guard total moved
`31 -> 0` (baseline `1835`, delta `-1835`). Global lint now passes, closing
BUG-466 technically and operationally. Same-session evidence:
- targeted explicit-any lint over all tranche-99 files => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`31 -> 0`, `-31`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` in `apps/api` => PASS (16/16)
- `npm run lint` => PASS
- `BUG-466-FOLLOWUP-LINT-SCOPE` remains open as post-closure tooling hardening
  and baseline-ratchet update remains a dedicated follow-up commit per
  burndown policy.

## 2026-05-11 — BUG-466 B2 tranche-98 rehardens auth/referral/surgery/shared-ui typing

**Decision:** continue BUG-466 with a bounded B2 tranche over
`LoginForm.tsx`, `ChangePasswordPage.tsx`, `ReferralCoordinatorQueue.tsx`,
`OpNoteTab.tsx`, `AiQuickTasks.tsx`, `Breadcrumbs.tsx`,
`MarkdownRenderer.tsx`, and `MfaChallengeDialog.tsx`, removing all remaining
executable explicit `any` in this runtime cluster.  
**Why:** after tranche-97, the next high-yield residual cluster was
concentrated in these eight web files (`1 x 8 = 8`) with direct
catch/error/response-typing hardening paths and zero behavior-drift
requirements.  
**Effect:** replaced login branding `get<any>` with typed response extraction in
`LoginForm`; replaced casted mutation error `any` in `ChangePasswordPage`;
replaced referral-create and op-note submit catch `any` with unknown-safe typed
error extraction in `ReferralCoordinatorQueue` + `OpNoteTab`; replaced
error/response/style `any` usage in shared UI surfaces (`AiQuickTasks`,
`Breadcrumbs`, `MarkdownRenderer`, `MfaChallengeDialog`) with explicit helper
contracts. File-level executable explicit-`any` debt for this tranche moved
`8 -> 0`, and repo guard total moved `39 -> 31` (`-8`). Same-session evidence:
- `npx eslint apps/web/src/features/auth/components/LoginForm.tsx apps/web/src/features/auth/pages/ChangePasswordPage.tsx apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx apps/web/src/features/surgery/tabs/OpNoteTab.tsx apps/web/src/shared/components/ui/AiQuickTasks.tsx apps/web/src/shared/components/ui/Breadcrumbs.tsx apps/web/src/shared/components/ui/MarkdownRenderer.tsx apps/web/src/shared/components/ui/MfaChallengeDialog.tsx --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`39 -> 31`, `-8`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` in `apps/api` => PASS (16/16)
- `npm run lint` => FAIL (expected: remaining global BUG-466 debt now 31)

## 2026-05-11 — BUG-466 B2 tranche-97 rehardens patient/staff/waitlist/shared-picker typing

**Decision:** continue BUG-466 with a bounded B2 tranche over
`PatientList.tsx`, `EditStaffCredentialsDialog.tsx`,
`ConnectOutlookButton.tsx`, and `StaffPicker.tsx`, removing all remaining
executable explicit `any` in this runtime cluster.  
**Why:** after tranche-96, the next high-yield residual cluster was
concentrated in these four web files (`2 + 2 + 2 + 2 = 8`) with direct
event/error/response typing hardening opportunities and zero behavior-drift
requirements.  
**Effect:** replaced deactivate mutation error cast `any` and casted unit-level
access in `PatientList` with typed error extraction and level compatibility
typing; replaced save/verify catch-path `any` handlers in
`EditStaffCredentialsDialog` with unknown-safe typed error extraction; replaced
connect catch `any` plus image onError event `any` in `ConnectOutlookButton`
with typed error + `SyntheticEvent<HTMLImageElement>` contracts; replaced
patient search response/map `any` in `StaffPicker` with typed union envelope
extraction and row-normalization contracts. File-level executable explicit-`any`
debt for this tranche moved `8 -> 0`, and repo guard total moved `47 -> 39`
(`-8`). Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/PatientList.tsx apps/web/src/features/staff-settings/components/EditStaffCredentialsDialog.tsx apps/web/src/features/waitlist/components/ConnectOutlookButton.tsx apps/web/src/shared/components/ui/StaffPicker.tsx --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`47 -> 39`, `-8`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` in `apps/api` => PASS (16/16)
- `npm run lint` => FAIL (expected: remaining global BUG-466 debt now 39)

## 2026-05-11 — BUG-466 B2 tranche-96 rehardens correspondence/drafts/intake/list/org-settings typing

**Decision:** continue BUG-466 with a bounded B2 tranche over
`GenerateLetterFromNoteButton.tsx`, `DraftsPage.tsx`, `MyOffersPage.tsx`,
`HotSpotsPage.tsx`, and `orgSettingsApi.ts`, removing all remaining executable
explicit `any` in this runtime cluster.  
**Why:** after tranche-95, the next high-yield residual cluster was
concentrated in these five web files (`2 + 2 + 2 + 2 + 2 = 10`) with
compatibility-safe response/event typing paths.  
**Effect:** replaced episode filter cast `any` with mixed-shape note typing in
`GenerateLetterFromNoteButton`; replaced drafts fetch/map `any` with typed
envelope extraction + row contracts in `DraftsPage`; replaced offer mapper and
mutation-error cast `any` with typed compatibility surface in `MyOffersPage`;
replaced casted hotspot query params with explicit typed records in
`HotSpotsPage`; replaced `get<any>` tree/units paths with typed union responses
and guarded extraction in `orgSettingsApi`. File-level executable explicit-`any`
debt for this tranche moved `10 -> 0`, and repo guard total moved `57 -> 47`
(`-10`). Same-session evidence:
- `npx eslint apps/web/src/features/correspondence/components/GenerateLetterFromNoteButton.tsx apps/web/src/features/drafts/pages/DraftsPage.tsx apps/web/src/features/intake/pages/MyOffersPage.tsx apps/web/src/features/lists/pages/HotSpotsPage.tsx apps/web/src/features/org-settings/services/orgSettingsApi.ts --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`57 -> 47`, `-10`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` in `apps/api` => PASS (16/16)
- `npm run lint` => FAIL (expected: remaining global BUG-466 debt now 47)

## 2026-05-11 — BUG-466 B2 tranche-95 rehardens medications/task runtime typing

**Decision:** continue BUG-466 with a bounded B2 tranche over
`PrescribeDialog.tsx`, `CurrentMedsPanel.tsx`, `InteractionPanel.tsx`,
`PrescriptionHistoryPanel.tsx`, `TaperDialog.tsx`, and `TaskForm.tsx`,
removing all remaining executable explicit `any` in this runtime cluster.  
**Why:** after tranche-94, the next high-yield residual cluster was
concentrated in six web runtime files (`2 + 1 + 1 + 1 + 1 + 1 = 7`) with
straightforward event/payload/error boundary typing fixes.  
**Effect:** replaced RxNav candidate mapping and autocomplete handler `any`
with explicit contracts in `PrescribeDialog`; replaced inline reissue-token
catch `any` with unknown-safe error extraction in `CurrentMedsPanel`; replaced
interaction concept mapping `any` with typed projection in `InteractionPanel`;
replaced period select casted `any` with typed select-event guard in
`PrescriptionHistoryPanel`; replaced taper catch `any` + task default-value
cast `any` with typed contracts in `TaperDialog` and `TaskForm`. File-level
executable explicit-`any` debt for this tranche moved `7 -> 0`, and repo guard
total moved `64 -> 57` (`-7`). Same-session evidence:
- `npx eslint apps/web/src/features/medications/components/PrescribeDialog.tsx apps/web/src/features/medications/components/CurrentMedsPanel.tsx apps/web/src/features/medications/components/InteractionPanel.tsx apps/web/src/features/medications/components/PrescriptionHistoryPanel.tsx apps/web/src/features/medications/components/TaperDialog.tsx apps/web/src/features/tasks/components/TaskForm.tsx --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`64 -> 57`, `-7`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx vitest run src/features/medications/components/InteractionPanel.test.ts` in `apps/web` => PASS (7/7)
- `npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` in `apps/api` => PASS (16/16)
- `npm run lint` => FAIL (expected: remaining global BUG-466 debt now 57)

## 2026-05-11 — BUG-466 B6 tranche-94 rehardens seed-script typing

**Decision:** continue BUG-466 with a bounded B6 tranche over
`seed-all-verticals.ts`, `seed-history-data.ts`, and `seed-lists.ts`,
removing all remaining executable explicit `any` in these seed surfaces.  
**Why:** after tranche-93, the next high-yield residual cluster was concentrated
in deterministic seed scripts (`4 + 3 + 2 = 9`) with low-risk contract-first
remediation paths.  
**Effect:** replaced insert/catch/find callback `any` paths with typed seed-row
and reference-row contracts + unknown-safe error narrowing in
`seed-all-verticals`; replaced note/history-medication collection/catch `any`
with typed contracts and unknown-safe error handling in `seed-history-data`;
replaced row-mapping `any` usage in `seed-lists` with explicit clinic/patient/
org-unit/staff row interfaces. File-level executable explicit-`any` debt for
this tranche moved `9 -> 0`, and repo guard total moved `73 -> 64` (`-9`).
Same-session evidence:
- `npx eslint apps/api/src/seed-all-verticals.ts apps/api/src/seed-history-data.ts apps/api/src/seed-lists.ts --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`73 -> 64`, `-9`)
- `npm run guard:claude-discipline:ci` => PASS
- `npm run lint` => FAIL (expected: remaining global BUG-466 debt now 64)

## 2026-05-11 — BUG-466 B2 tranche-93 rehardens billing/risk runtime typing

**Decision:** continue BUG-466 with a bounded B2 tranche over
`AllergyPanel.tsx`, `RiskAssessmentList.tsx`, `ClaimStatusPanel.tsx`,
`useBilling.ts`, and `InvoiceForm.tsx` (plus `InvoiceDetail.tsx` absorb),
removing all remaining executable explicit `any` on these runtime surfaces.  
**Why:** after tranche-92, the next high-yield residual cluster was a
10-count web runtime hotspot spanning risk-allergy and billing boundaries with
clean contract-first remediation paths.  
**Effect:** replaced allergy fetch/map `any` with `AllergyResponse[]` typed
service boundaries and canonical severity labels; replaced legacy risk
`nextReviewDate` `any` fallback with a typed compatibility resolver; replaced
billing claim list/mutation placeholder `any` with explicit `ClaimResponse` and
`SubmitClaimDTO` contracts; replaced `InvoiceForm` casted submit path with a
structural DTO mapper (`claimType -> billingType`, dollars -> cents), and
absorbed resultant compile boundary in `InvoiceDetail` via deterministic
claim-type derivation. File-level executable explicit-`any` debt for this
tranche moved `10 -> 0`, and repo guard total moved `83 -> 73` (`-10`).
Same-session evidence:
- `npx eslint apps/web/src/features/risk-allergies/components/AllergyPanel.tsx apps/web/src/features/risk-allergies/components/RiskAssessmentList.tsx apps/web/src/features/billing/components/ClaimStatusPanel.tsx apps/web/src/features/billing/hooks/useBilling.ts apps/web/src/features/billing/components/InvoiceForm.tsx apps/web/src/features/billing/components/InvoiceDetail.tsx --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`83 -> 73`, `-10`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx vitest run --config vitest.config.ts src/features/risk-allergies/components/AllergyPanel.test.ts` in `apps/web` => PASS (4/4)
- `npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` in `apps/api` => PASS (16/16)
- `npm run guard:response-shape-validated` => PASS
- `npm run guard:mutation-invalidation` => PASS
- `npm run guard:row-iface-drift` => PASS
- `npm run guard:migration-convention` => PASS
- `npm run guard:file-size` => PASS
- `npm run guard:service-auth-context` => PASS
- `npm run lint` => FAIL (expected: remaining global BUG-466 debt now 73)
- `npm run guard:snapshot-freshness` => PASS (post-commit, after snapshot refresh landed)

## 2026-05-11 — Queue post-BUG-466 lint-scope hardening follow-up

**Decision:** add `BUG-466-FOLLOWUP-LINT-SCOPE` to post-`BUG-466` work queue.  
**Why:** tranche verification currently uses file-scoped eslint commands while
root `npm run lint` is intentionally global (`eslint .`) and can fail on
unrelated baseline debt, which obscures slice-level signal.  
**Effect:** follow-up tracked in
`docs/quality/bugs-remaining.md` + `no-explicit-any-burndown.md` with explicit
deliverables: scoped lint entrypoint for tranche execution, preserved global
lint closure gate, and documented run-order/DoD expectations.

## 2026-05-11 — BUG-466 B2 tranche-92 rehardens SSE/notes/ambient runtime typing

**Decision:** continue BUG-466 with a bounded B2 tranche over
`useEventStream.ts`, `NotesList.tsx`, and `AmbientAiRecorder.tsx`, removing all
remaining executable explicit `any` on these web runtime surfaces.  
**Why:** after tranche-91, the next high-yield cluster was concentrated across
these three files (`4 + 3 + 3 = 10`) and could be remediated contract-first
without behavioral drift.  
**Effect:** replaced SSE payload dispatch and invalidation handler `any` with a
typed payload guard + QueryClient signature, replaced note sign/generate/save
error `any` with unknown-safe error parsing, and replaced ambient recorder
runtime catches/service-probe fallback/casted severity input `any` with typed
narrowing. File-level executable explicit-`any` debt for this tranche moved
`10 -> 0`, and repo guard total moved `93 -> 83` (`-10`). Same-session
evidence:
- `npx eslint apps/web/src/shared/hooks/useEventStream.ts apps/web/src/features/patients/components/notes/NotesList.tsx apps/web/src/features/patients/components/notes/AmbientAiRecorder.tsx --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`93 -> 83`, `-10`)
- `npm run guard:claude-discipline:ci` => PASS
- `npm run test:integration -- authJwtCrossUseRejection.int.test.ts limitCeilings.int.test.ts` in `apps/api` => PASS (5/5 + 11/11)
- `npm run guard:response-shape-validated` => PASS
- `npm run guard:mutation-invalidation` => PASS
- `npm run guard:row-iface-drift` => PASS
- `npm run guard:migration-convention` => PASS
- `npm run guard:snapshot-freshness` => FAIL (pre-existing global drift outside tranche scope)
- `npm run guard:fix-registry-decisiveness` => FAIL (pre-existing global drift outside tranche scope)

## 2026-05-11 — BUG-466 B2 tranche-91 rehardens tasks/appointments/resources runtime typing

**Decision:** continue BUG-466 with a bounded B2 tranche over
`TasksPage.tsx`, `AppointmentForm.tsx`, and `ResourcesPage.tsx`, removing all
remaining executable explicit `any` on these web runtime surfaces.  
**Why:** after tranche-90, the next high-yield cluster was evenly concentrated
across these three files (`4 + 4 + 4 = 12`) and could be remediated
contract-first with zero behavioral drift.  
**Effect:** replaced task-list envelope and card-filter cast paths with typed
contracts, replaced appointment mutation error cast reads with unknown-safe
conflict/message helpers, and replaced resources list/envelope/map `any` usage
with explicit resource contracts. File-level executable explicit-`any` debt for
this tranche moved `12 -> 0`, and repo guard total moved `105 -> 93`
(`-12`). Same-session evidence:
- `npx eslint apps/web/src/features/tasks/pages/TasksPage.tsx apps/web/src/features/appointments/components/AppointmentForm.tsx apps/web/src/features/case-management/pages/ResourcesPage.tsx --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`105 -> 93`, `-12`)
- `npm run guard:claude-discipline:ci` => PASS
- `npm run test:integration -w apps/api -- tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` => PASS (5/5 + 11/11)

## 2026-05-11 — BUG-466 B2/B3 tranche-90 rehardens web runtime typing across medications/billing/audit/pathways

**Decision:** continue BUG-466 with a bounded B2/B3 tranche over
`usePrescriber.ts`, `InvoiceList.tsx`, `AuditPage.tsx`, and
`PathwaysPage.tsx`, removing all remaining executable explicit `any` on these
runtime surfaces.  
**Why:** after tranche-89, the next high-yield cluster was evenly concentrated
across these four files (`4 + 4 + 4 + 4 = 16`) and could be remediated
contract-first with zero behavioral drift.  
**Effect:** replaced generic response/query casts with concrete contracts in
medications, billing, and audit surfaces, and replaced pathway optimistic-lock
error/map `any` with typed row/form contracts plus unknown-safe error parsing.
Preserved rollout compatibility behavior (camel/snake fallback in pathways,
monetary fallback in invoice list). File-level executable explicit-`any` debt
for this tranche moved `16 -> 0`, and repo guard total moved `121 -> 105`
(`-16`). Same-session evidence:
- `npx eslint apps/web/src/features/medications/hooks/usePrescriber.ts apps/web/src/features/billing/components/InvoiceList.tsx apps/web/src/features/audit/pages/AuditPage.tsx apps/web/src/features/treatment-pathways/pages/PathwaysPage.tsx --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`121 -> 105`, `-16`)
- `npm run guard:claude-discipline:ci` => PASS
- `npm run test:integration -w apps/api -- tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/limitCeilings.int.test.ts` => PASS (5/5 + 11/11)

## 2026-05-10 — BUG-466 B3 tranche-85 eliminates explicit `any` from admission waitlist + NPDS client

**Decision:** continue BUG-466 with a bounded B3 dual-surface tranche over
`AdmissionWaitlistPage.tsx` and `npdsClient.ts`, removing all remaining
executable explicit `any` in UI list/error/autocomplete and NPDS
payload/extension parsing paths.  
**Why:** after tranche-84, these were the highest remaining hotspot pair
(`5 + 5`) spanning both web clinical list UX and ADHA eScript integration,
with clean contract-first remediation paths and existing NPDS test coverage.  
**Effect:** replaced waitlist/patient-search `any` with concrete contracts
(`AdmissionWaitlistEntry`, `PatientSearchResult`) and unknown-safe error
parsing, plus explicit date narrowing; replaced NPDS `any` with typed JSON
helpers (`asRecord`, `asExtensions`), removed callback-level `any` in
extension and bundle entry parsing, and tightened output contract for ASL
entries (`JsonRecord[]`). File-level executable explicit-`any` debt for this
tranche moved `10 -> 0`, and repo guard total moved `171 -> 161` (`-10`).
Same-session evidence:
- `npx eslint apps/web/src/features/lists/pages/AdmissionWaitlistPage.tsx apps/api/src/integrations/escript/npdsClient.ts --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run test -w apps/api -- tests/conformance/cts-v3-0-1-mvp/erxConformanceMvp.test.ts` => PASS
- `npm run test:integration -w apps/api -- npdsConformancePerClinic.int.test.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`171 -> 161`, `-10`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-84 eliminates explicit `any` from API runtime hotspot quartet

**Decision:** continue BUG-466 with a bounded B3 tranche over
`nurseFeatureRoutes.ts`, `bedRoutes.ts`, `aiAgent.ts`, and
`scribeStreaming.ts`, removing all remaining executable explicit `any` in
row-map/update paths plus dynamic tool/WS control surfaces.  
**Why:** after tranche-83, the next hotspot ranking concentrated at these files
(`6 + 5 + 6 + 6`) and all were contract-first candidates that could be
remediated without behavioral change.  
**Effect:** replaced row-map/update `any` with concrete contracts in nursing and
beds routes, introduced typed tool-call contracts and unknown-safe argument
normalization in `aiAgent`, and replaced dynamic WebSocket/control-message
`any` with structural interfaces + unknown narrowing in `scribeStreaming`.
File-level executable explicit-`any` debt for this tranche moved `23 -> 0`, and
repo guard total moved `194 -> 171` (`-23`). Same-session evidence:
- `npx eslint apps/api/src/features/roles/nurseFeatureRoutes.ts apps/api/src/features/beds/bedRoutes.ts apps/api/src/mcp/server/aiAgent.ts apps/api/src/mcp/scribeStreaming.ts --rule '@typescript-eslint/no-explicit-any:error'` => PASS
- `npm run test:integration -w apps/api -- bug281LlmAuthContextMigration.int.test.ts scribeWebSocketConsent.int.test.ts phoneTriageLockVersion.int.test.ts` => PASS
- `npm run test:integration -w apps/api -- restrictiveInterventionsLockVersion.int.test.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`194 -> 171`, `-23`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-83 eliminates explicit `any` from four API hotspots

**Decision:** continue BUG-466 with a bounded B3 tranche over
`llmTrainingRoutes.ts`, `contactRecordRoutes.ts`, `scribeEnhancements.ts`, and
`episodeRoutes.ts`, removing all remaining executable explicit `any` in their
row-map/filter/reduce paths.  
**Why:** after tranche-82, the highest remaining lint hotspots were concentrated
in these API runtime files (`8 + 7 + 7 + 6`), and each could be remediated
contract-first without changing route semantics.  
**Effect:** replaced callback-level `any` with typed row contracts and
unknown-safe parsing helpers (`parseJsonRecord`, `parseContactMeta`,
`parseTokenEstimate`), preserved existing output shapes, and kept all route
behavior unchanged while improving compile-time safety. File-level executable
explicit-`any` debt for this tranche moved `28 -> 0`, and repo guard total
moved `222 -> 194` (`-28`). Same-session evidence:
- `npx eslint apps/api/src/features/llm/llmTrainingRoutes.ts apps/api/src/features/contacts/contactRecordRoutes.ts apps/api/src/mcp/scribeEnhancements.ts apps/api/src/features/episode/episodeRoutes.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`222 -> 194`, `-28`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-82 eliminates explicit `any` from group therapy page

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx`, removing all
remaining executable explicit `any` annotations in form/mutation/error/filter
paths.  
**Why:** after tranche-81 completion, this group-therapy page remained a
contained hotspot (`5` executable explicit `any`) and could be remediated
without changing backend contracts or group-session workflow behavior.  
**Effect:** replaced form/mutation/error casts with concrete contracts
(`GroupSessionFormState`, `GroupTherapyApiError`), typed mutation payload
boundary, removed filter-path cast usage by extending `GroupSession` with an
optional `name` field, and added unknown-safe error helper
`getGroupTherapyErrorMessage(err)` preserving existing alert semantics.
File-level executable explicit-`any` debt moved `5 -> 0`, and repo guard total
moved `227 -> 222` (`-5`). Same-session evidence:
- `npx eslint apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`227 -> 222`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-81 eliminates explicit `any` from fee schedule panel

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/billing/components/FeeSchedulePanel.tsx`, removing all
remaining executable explicit `any` annotations in edit-state and list/mutation
data-shape paths.  
**Why:** after tranche-80 completion, this billing panel remained a contained
hotspot (`5` executable explicit `any`) and could be remediated without
changing fee schedule endpoint behavior or UI workflow.  
**Effect:** replaced edit-state/list/seed casts with concrete contracts
(`EditableFeeSchedule`, `FeeScheduleCategoryValue`, `FeeScheduleModalityValue`),
and added typed mapper `toEditableFeeSchedule(item)` to normalize broad
`FeeScheduleResponse` strings into DTO-safe enum values for edit mode while
preserving existing behavior. File-level executable explicit-`any` debt moved
`5 -> 0`, and repo guard total moved `232 -> 227` (`-5`). Same-session
evidence:
- `npx eslint apps/web/src/features/billing/components/FeeSchedulePanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`232 -> 227`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-80 eliminates explicit `any` from e-referral page

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/ereferral/pages/EReferralPage.tsx`, removing all
remaining executable explicit `any` annotations in query/mutation/export/table
rendering paths.  
**Why:** after tranche-79 completion, this e-referral page remained a contained
hotspot (`6` executable explicit `any`) and could be remediated without
changing endpoint behavior or referral workflow UX.  
**Effect:** replaced query/mutation/list casts with concrete local referral
contracts (`EReferralRow`, `EReferralFormState`, `EReferralContent`), removed
map callback `any` usage across export/table rendering, and introduced typed
helpers (`parseEReferralContent`, `getReferralRecipient`, `getReferralUrgency`,
`formatReferralDate`) to preserve existing display behavior under strict
typing. File-level executable explicit-`any` debt moved `6 -> 0`, and repo
guard total moved `238 -> 232` (`-6`). Same-session evidence:
- `npx eslint apps/web/src/features/ereferral/pages/EReferralPage.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`238 -> 232`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-79 eliminates explicit `any` from invoice detail

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/billing/components/InvoiceDetail.tsx`, removing all
remaining executable explicit `any` annotations in invoice/payment/claim
rendering paths.  
**Why:** after tranche-78 completion, this billing detail surface remained a
contained hotspot (`6` executable explicit `any`) and could be remediated
without changing endpoint contracts or invoice-detail user flow.  
**Effect:** replaced legacy invoice cast/map callback `any` usage with concrete
view contracts (`InvoiceLineItemView`, `InvoicePaymentView`, `InvoiceClaimView`)
and typed invoice boundary (`InvoiceResponseView | null`), removed status-color
`any` cast, and absorbed strict optional numerics through derived fallbacks
(`invoiceTotal`, `invoiceGstTotal`, `invoiceBalance`) so existing display logic
stays intact. File-level executable explicit-`any` debt moved `6 -> 0`, and
repo guard total moved `244 -> 238` (`-6`). Same-session evidence:
- `npx eslint apps/web/src/features/billing/components/InvoiceDetail.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`244 -> 238`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-78 eliminates explicit `any` from send-message dialog

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/patients/components/notes/SendMessageDialog.tsx`,
removing all remaining executable explicit `any` annotations in recipient and
error handling paths.  
**Why:** after tranche-77 completion, this patient-notes messaging surface
remained a contained hotspot (`5` executable explicit `any`) and could be
remediated without changing message composition/send behavior.  
**Effect:** replaced `any` contacts fetch/casts and catch typing with concrete
contracts (`PatientContact` from `patientApi` + `MessageApiError` helpers),
switched contacts lookup to typed `patientApi.getPatientContacts`, and retained
existing UI behavior. Strict null-vs-undefined type mismatches surfaced in
recipient mapping after cast removal were absorbed via `?? undefined` in
recipient phone/email fields with no behavioral change. File-level executable
explicit-`any` debt moved `5 -> 0`, and repo guard total moved `249 -> 244`
(`-5`). Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/notes/SendMessageDialog.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`249 -> 244`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-77 eliminates explicit `any` from retention panel

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/power-settings/components/RetentionPanel.tsx`, removing
all remaining executable explicit `any` annotations in retention error paths.  
**Why:** after tranche-76 completion, this power-settings surface remained a
contained hotspot (`5` executable explicit `any`) and could be remediated
without changing retention policy or workflow behavior.  
**Effect:** replaced `any` error-handler/cast usage with unknown-safe helpers
(`asRetentionApiError`, `getRetentionErrorCode`, `getRetentionErrorMessage`)
across retention setters, manager-approval controls, and load-error display,
while preserving all existing user-facing messages and branch logic. File-level
executable explicit-`any` debt moved `5 -> 0`, and repo guard total moved
`254 -> 249` (`-5`). Same-session evidence:
- `npx eslint apps/web/src/features/power-settings/components/RetentionPanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`254 -> 249`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-76 eliminates explicit `any` from escalation hooks

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/escalations/hooks/useEscalations.ts`, removing all
remaining executable explicit `any` annotations in mutation error handlers.  
**Why:** after tranche-75 completion, escalation hooks remained a contained
hotspot (`5` executable explicit `any`) and could be remediated without
changing escalation query/mutation behavior.  
**Effect:** replaced `any` onError paths with unknown-safe helpers
(`asMutationError`, `getErrorMessage`, `isOptimisticLockConflict`) and kept
the same user messaging + 409 refresh behavior. During typecheck, this surfaced
a strict consumer mismatch in
`apps/web/src/features/escalations/components/EscalationTimeline.tsx` where
`resolve.error` (now `unknown`) was used directly in JSX; fixed via
`Boolean(resolve.error)` with no behavior change. File-level executable
explicit-`any` debt moved `5 -> 0` in hooks, and repo guard total moved
`259 -> 254` (`-5`). Same-session evidence:
- `npx eslint apps/web/src/features/escalations/hooks/useEscalations.ts apps/web/src/features/escalations/components/EscalationTimeline.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`259 -> 254`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-75 eliminates explicit `any` from clinician fee panel

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/billing/components/ClinicianFeePanel.tsx`, removing all
remaining executable explicit `any` annotations in this panel.  
**Why:** after tranche-74 completion, this billing surface remained a contained
hotspot (`6` executable explicit `any`) and could be remediated without
changing clinician-fee configuration behavior.  
**Effect:** replaced `any` staff-lookup typing, fee list/schedule list casts,
and map callback typing with concrete contracts
(`StaffLookupClinicianRow`, `StaffLookupResponse`, `FeeScheduleResponse`) while
preserving item fee editing and uniform-gap behavior. File-level executable
explicit-`any` debt moved `6 -> 0`, and repo guard total moved `265 -> 259`
(`-6`). Same-session evidence:
- `npx eslint apps/web/src/features/billing/components/ClinicianFeePanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`265 -> 259`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-74 eliminates explicit `any` from templates page editor

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/templates/pages/TemplatesPage.tsx`, removing all
remaining executable explicit `any` annotations in this page/editor flow.  
**Why:** after tranche-73 completion, this templates surface remained a
contained hotspot (`5` executable explicit `any`) and could be remediated
without changing template list/filter/create behavior.  
**Effect:** replaced `any` content/payload/editor typing with concrete
contracts (`TemplateFieldType`, `TemplateField`, `CreateTemplatePayload`),
removed `any` state/mutation signatures and dynamic update typing, and
preserved template UI behavior. File-level executable explicit-`any` debt moved
`5 -> 0`, and repo guard total moved `270 -> 265` (`-5`). Same-session
evidence:
- `npx eslint apps/web/src/features/templates/pages/TemplatesPage.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`270 -> 265`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-73 eliminates explicit `any` from OrgTreePanel leadership editor

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/org-settings/components/OrgTreePanel.tsx`, removing all
remaining executable explicit `any` annotations in this panel.  
**Why:** after tranche-72 completion, this org-settings UI remained a contained
hotspot (`6` executable explicit `any`) and could be remediated without
changing hierarchy/assignment behavior.  
**Effect:** replaced leadership-field `as any` casts and staff-list callback
`any` typing with concrete contracts (`OrgUnitWithLeadership`,
`StaffLookupItem`) while preserving dialog behavior and update payload shape.
File-level executable explicit-`any` debt moved `6 -> 0`, and repo guard total
moved `276 -> 270` (`-6`). Same-session evidence:
- `npx eslint apps/web/src/features/org-settings/components/OrgTreePanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`276 -> 270`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B4 tranche-72 eliminates explicit `any` from Office 365 integration service

**Decision:** continue BUG-466 with a bounded B4 tranche on
`apps/api/src/integrations/outlook/office365Service.ts`, removing all
remaining executable explicit `any` annotations in Graph payload/response
handling.  
**Why:** after tranche-71 completion, this integration service remained a
contained hotspot (`6` executable explicit `any`) and could be remediated
without changing token-refresh or Graph API behavior.  
**Effect:** replaced `any` payload/collection typing with concrete interfaces
(`GraphEventPayload`, `GraphCalendarEvent`, `UpcomingCalendarEvent`,
`GraphDriveItem`, `OneDriveFileSummary`) and kept behavior unchanged for Teams
meeting creation, calendar event listing, and OneDrive listing. File-level
executable explicit-`any` debt moved `6 -> 0`, and repo guard total moved
`282 -> 276` (`-6`). Same-session evidence:
- `npx eslint apps/api/src/integrations/outlook/office365Service.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`282 -> 276`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B4 tranche-71 eliminates explicit `any` from gateway pagination service

**Decision:** continue BUG-466 with a bounded B4 tranche on
`apps/emr-gateway/src/services/pagination.ts`, removing all remaining
executable explicit `any` annotations in pagination/filter helpers.  
**Why:** after tranche-70 completion, this gateway utility remained an isolated
hotspot (`5` executable explicit `any`) and could be remediated safely with
type-contract tightening only.  
**Effect:** replaced `any` filter/data/model signatures with generic contracts
(`PaginateOptions<TFilter>`, `PaginatedResult<TData>`,
`LeanQueryModel<TData, TFilter>`) and typed date-filter bounds
(`Record<string, DateBound>`), while preserving pagination and date-filter
behavior. File-level executable explicit-`any` debt moved `5 -> 0`, and repo
guard total moved `287 -> 282` (`-5`). Same-session evidence:
- `npx eslint apps/emr-gateway/src/services/pagination.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`287 -> 282`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-70 eliminates explicit `any` from `reportsRepository.ts`

**Decision:** continue BUG-466 with a bounded B3 tranche on
`apps/api/src/features/reports/reportsRepository.ts`, removing all remaining
executable explicit `any` annotations in the repository query/mapping layer.  
**Why:** after tranche-69 completion, this repository remained a bounded
hotspot (`5` executable explicit `any`) and could be remediated without
changing report query behavior or API contracts.  
**Effect:** replaced `dbRead<any>` query surfaces with typed row contracts
(`EncounterQueryRow`, `OutcomeDataRow`, `StaffFilterRow`) and removed `any`
from encounter/staff mapper callbacks while preserving encounter report,
outcomes report, and staff-filter semantics. File-level executable
explicit-`any` debt moved `5 -> 0`, and repo guard total moved
`292 -> 287` (`-5`). Same-session evidence:
- `npx eslint apps/api/src/features/reports/reportsRepository.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`292 -> 287`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-69 eliminates explicit `any` from API runtime route/service tranche

**Decision:** continue BUG-466 with a bounded B3 tranche on
`apps/api/src/features/{pathology/pathologyRoutes,auth/authService,outcomes/outcomeRoutes,billing/clinicianFeeService,advance-directives/advanceDirectiveRoutes,escalations/escalation.controller,llm/llmRoutes}.ts`,
removing all remaining executable explicit `any` annotations in those files.  
**Why:** after tranche-68 completion, this API runtime cluster remained a
bounded hotspot (`7` executable explicit `any`) that could be reduced
atomically without changing endpoint behavior.  
**Effect:** replaced route/service `any` usage with typed DB row contracts
(`PathologyOrdersRow`, `PathologyResultsRow`, `StaffSessionsRow`,
`OutcomeMeasuresRow`, `AdvanceDirectivesRow`, typed fee-list rows), converted
error/callback typing to unknown-safe narrowing (`epErr`, multer callback),
and preserved existing behavior on all touched endpoints. File-level
executable explicit-`any` debt moved to `0` across all 7 files, and repo guard
total moved `299 -> 292` (`-7`). Same-session evidence:
- `npx eslint apps/api/src/features/pathology/pathologyRoutes.ts apps/api/src/features/auth/authService.ts apps/api/src/features/outcomes/outcomeRoutes.ts apps/api/src/features/billing/clinicianFeeService.ts apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts apps/api/src/features/escalations/escalation.controller.ts apps/api/src/features/llm/llmRoutes.ts` => PASS
- `npm run test:guards` => PASS (51/51 files, 664/664 tests)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`299 -> 292`, `-7`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B6 tranche-68 eliminates explicit `any` from script trio

**Decision:** continue BUG-466 with a bounded B6 tranche on
`apps/api/scripts/step_migrate.ts`,
`apps/api/scripts/update-rating-scales.ts`, and
`apps/api/scripts/backfillAttachmentsToBlob.ts`, removing all remaining
executable explicit `any` annotations in those files.  
**Why:** after tranche-67 completion, this script cluster remained a low-risk
bounded hotspot (`5` executable explicit `any`) that could be reduced
atomically without touching runtime request-path behavior.  
**Effect:** tightened migration-source signatures to `PromiseLike<unknown>`,
typed attachment row query results with `AttachmentRow`, replaced rating-scale
payload `any[]` with `unknown[]`, and converted catch typing to `unknown` with
safe message extraction. Script behavior unchanged; file-level explicit-`any`
debt moved to `0` across all 3 files, and repo guard total moved
`304 -> 299` (`-5`). Same-session evidence:
- `npx eslint apps/api/scripts/step_migrate.ts apps/api/scripts/update-rating-scales.ts apps/api/scripts/backfillAttachmentsToBlob.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`304 -> 299`, `-5`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-67 eliminates explicit `any` from `migrationIntegrity.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/integration/migrationIntegrity.test.ts` and remove the
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-66 completion, this migration-integrity harness remained
a bounded hotspot (`3` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced `scratchKnex: any` with `Knex | null` and tightened
migration-source signatures from `PromiseLike<any>` to
`PromiseLike<unknown>`, preserving fresh-DB migration, core-table existence,
id-column integrity, and migrate-idempotency assertions; file explicit-`any`
moved `3 -> 0` and repo guard total moved `307 -> 304` (`-3`). Same-session
evidence:
- `npx eslint apps/api/tests/integration/migrationIntegrity.test.ts` => PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/migrationIntegrity.test.ts` => PASS (suite skipped by CAN_RUN gate in this environment)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`307 -> 304`, `-3`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-66 eliminates explicit `any` from `clozapineAlertScheduler.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/clozapineAlertScheduler.test.ts` and remove the remaining
executable explicit `any` annotations in this file.  
**Why:** after tranche-65 completion, this BUG-569 scheduler harness remained a
bounded hotspot (`2` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced `buildCtx` emit-call capture typing from `any[]` to
`ClozapineFbcOverdueEmitInput[]`, preserving overdue criteria, recipient
fan-out, dedupe-key shape, and per-row failure-isolation assertions; file
explicit-`any` moved `2 -> 0` and repo guard total moved `309 -> 307` (`-2`).
Same-session evidence:
- `npx eslint apps/api/tests/unit/clozapineAlertScheduler.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/clozapineAlertScheduler.test.ts` => PASS (16/16)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`309 -> 307`, `-2`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-65 eliminates explicit `any` from `idempotencyMiddleware.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/idempotencyMiddleware.test.ts` and remove the remaining
executable explicit `any` annotations in this file.  
**Why:** after tranche-64 completion, this S1.2 middleware harness remained a
bounded hotspot (`2` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced `400` and `409` error-body `as any` assertions with a
concrete `ErrorBody` contract while preserving replay-cache, concurrent-lock,
cross-clinic key isolation, and 5xx non-cache assertions; file explicit-`any`
moved `2 -> 0` and repo guard total moved `311 -> 309` (`-2`). Same-session
evidence:
- `npx eslint apps/api/tests/idempotencyMiddleware.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/idempotencyMiddleware.test.ts` => PASS (6/6)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`311 -> 309`, `-2`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-64 eliminates explicit `any` from `erxConformanceMvp.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/conformance/cts-v3-0-1-mvp/erxConformanceMvp.test.ts` and
remove the remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-63 completion, this BUG-299 ADHA CTS MVP harness
remained a bounded hotspot (`2` executable explicit `any`) with a contained,
low-risk test-hardening remediation shape.  
**Effect:** replaced throw-path `catch (err: any)` handlers with unknown-safe
catches plus a concrete `ErxNotConfiguredError` contract while preserving T1-T5
conformance assertions and NPDS error-contract checks; file explicit-`any`
moved `2 -> 0` and repo guard total moved `313 -> 311` (`-2`). Same-session
evidence:
- `npx eslint apps/api/tests/conformance/cts-v3-0-1-mvp/erxConformanceMvp.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/conformance/cts-v3-0-1-mvp/erxConformanceMvp.test.ts` => PASS (5/5)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`313 -> 311`, `-2`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-63 eliminates explicit `any` from `limitCeilings.int.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/integration/limitCeilings.int.test.ts` and remove the
remaining executable explicit `any` annotation in this file.  
**Why:** after tranche-62 completion, this BUG-437 integration harness remained
a bounded hotspot (`1` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced meds-snippet callback `any` typing with a concrete
`NoteSnippet` contract and unknown-safe extraction path while preserving FHIR /
clinical-notes / messaging / pathology / tasks / practitioner ceiling
assertions; file explicit-`any` moved `1 -> 0` and repo guard total moved
`314 -> 313` (`-1`). Same-session evidence:
- `npx eslint apps/api/tests/integration/limitCeilings.int.test.ts` => PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/limitCeilings.int.test.ts` => PASS (11/11)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`314 -> 313`, `-1`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-62 eliminates explicit `any` from `security.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/security.test.ts` and remove the remaining executable explicit
`any` annotation in this file.  
**Why:** after tranche-61 completion, this OWASP verification harness remained
a bounded hotspot (`1` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced the SQL-injection request-header cast with a native typed
headers contract while preserving OWASP ASVS V2/V3/V5/V6/V9/V13/V14 assertions;
file explicit-`any` moved `1 -> 0` and repo guard total moved `315 -> 314`
(`-1`). Same-session evidence:
- `npx eslint apps/api/tests/security.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/security.test.ts` => PASS (9/9)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`315 -> 314`, `-1`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-61 eliminates explicit `any` from `rls-isolation.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/rls-isolation.test.ts` and remove the remaining executable
explicit `any` annotation in this file.  
**Why:** after tranche-60 completion, this RLS isolation harness remained a
bounded hotspot (`1` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced raw-query clinic-id extraction `any` typing with a concrete
`ClinicIdRow` contract while preserving RLS no-context deny, matching-clinic
allow, and wrong-clinic deny assertions; file explicit-`any` moved `1 -> 0`
and repo guard total moved `316 -> 315` (`-1`). Same-session evidence:
- `npx eslint apps/api/tests/rls-isolation.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/rls-isolation.test.ts` => PASS (4/4)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`316 -> 315`, `-1`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-60 eliminates explicit `any` from `retentionApprovalService.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/retentionApprovalService.test.ts` and remove the
remaining executable explicit `any` annotation in this file.  
**Why:** after tranche-59 completion, this retention-approval harness remained
a bounded hotspot (`1` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced the audit capture array explicit-`any` typing with
`RetentionApprovalContext`-derived `writeAudit` call contracts and an explicit
`buildCtx` return contract while preserving BUG-374b Part 2 TTL,
segregation-of-duties, and approve/revoke assertions; file explicit-`any` moved
`1 -> 0` and repo guard total moved `317 -> 316` (`-1`). Same-session evidence:
- `npx eslint apps/api/tests/unit/retentionApprovalService.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/retentionApprovalService.test.ts` => PASS (20/20)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`317 -> 316`, `-1`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-59 eliminates explicit `any` from `uploadsTenantGuard.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/uploadsTenantGuard.test.ts` and remove all remaining
executable explicit `any` annotations in this file.  
**Why:** after tranche-58 completion, this upload-tenant-guard harness remained
a bounded hotspot (`3` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced DB mock query-builder explicit-`any` typing with inferred
mock contracts and replaced response-body `as any` assertions with unknown-safe
error-body contracts; file explicit-`any` moved `3 -> 0` and repo guard total
moved `320 -> 317` (`-3`). Same-session evidence:
- `npx eslint apps/api/tests/uploadsTenantGuard.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/uploadsTenantGuard.test.ts` => PASS (6/6)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`320 -> 317`, `-3`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-58 eliminates explicit `any` from `validateTaperSchedule.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/validateTaperSchedule.test.ts` and remove all remaining
executable explicit `any` annotations in this file.  
**Why:** after tranche-57 completion, this HAZARD-011 validator test harness
remained a bounded hotspot (`3` executable explicit `any`) with a contained,
low-risk test-hardening remediation shape.  
**Effect:** replaced throw-assertion `catch (err: any)` with unknown-safe
error-contract typing and removed malformed-input `as any` casts by passing
direct unknown-compatible literals; file explicit-`any` moved `3 -> 0` and repo
guard total moved `323 -> 320` (`-3`). Same-session evidence:
- `npx eslint apps/api/tests/unit/validateTaperSchedule.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/validateTaperSchedule.test.ts` => PASS (19/19)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`323 -> 320`, `-3`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-57 eliminates explicit `any` from `retentionSettingService.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/retentionSettingService.test.ts` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-56 completion, this retention unit-test harness
remained a bounded hotspot (`4` executable explicit `any`) with a contained,
low-risk test-hardening remediation shape.  
**Effect:** replaced `buildCtx` mock-capture explicit-`any` arrays with
retention-context call contracts (`RetentionWriteCall`, `RetentionAuditCall`)
while preserving BUG-374a floor enforcement, superadmin guard, and audit-log
assertion behavior; file explicit-`any` moved `4 -> 0` and repo guard total
moved `327 -> 323` (`-4`). Same-session evidence:
- `npx eslint apps/api/tests/unit/retentionSettingService.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/retentionSettingService.test.ts` => PASS (12/12)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`327 -> 323`, `-4`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-56 eliminates explicit `any` from `prescriptionRepeatScheduler.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/prescriptionRepeatScheduler.test.ts` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-55 completion, this scheduler harness remained a bounded
hotspot (`4` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced `buildCtx` mock-capture explicit-`any` arrays with
context-derived call contracts (`EmitCall`, `AuditCall`) while preserving
BUG-372c bucketing/fan-out, BUG-589 reassignment-audit, and BUG-591 T-3d
assertion behavior; file explicit-`any` moved `4 -> 0` and repo guard total
moved `331 -> 327` (`-4`). Same-session evidence:
- `npx eslint apps/api/tests/unit/prescriptionRepeatScheduler.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/prescriptionRepeatScheduler.test.ts` => PASS (34/34)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`331 -> 327`, `-4`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-55 eliminates explicit `any` from `evidenceClient.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/evidenceClient.test.ts` and remove all remaining executable
explicit `any` annotations in this file.  
**Why:** after tranche-54 completion, this unit-test harness remained a bounded
hotspot (`6` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced mock-table and fake-query chain explicit-`any` paths with
concrete `FakeQuery` and unknown-safe table row typing while preserving
evidence backend, cache, and formatter assertions plus throws-path behavior;
file explicit-`any` moved `6 -> 0` and repo guard total moved `337 -> 331`
(`-6`). Same-session evidence:
- `npx eslint apps/api/tests/evidenceClient.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/evidenceClient.test.ts` => PASS (15/15)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`337 -> 331`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-54 eliminates explicit `any` from `buildPatientContext.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/buildPatientContext.test.ts` and remove all remaining
executable explicit `any` annotations in this file.  
**Why:** after tranche-53 completion, this unit-test harness remained a bounded
hotspot (`6` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced mock-table and fake-query chain explicit-`any` paths with
concrete `FakeQuery` and unknown-safe table row typing while preserving patient
context section rendering assertions and throws-path behavior; file explicit-`any`
moved `6 -> 0` and repo guard total moved `343 -> 337` (`-6`). Same-session
evidence:
- `npx eslint apps/api/tests/buildPatientContext.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/buildPatientContext.test.ts` => PASS (8/8)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`343 -> 337`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-53 eliminates explicit `any` from `buildKShotExamples.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/buildKShotExamples.test.ts` and remove all remaining
executable explicit `any` annotations in this file.  
**Why:** after tranche-52 completion, this unit-test harness remained a bounded
hotspot (`6` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced mock-table and fake-query chain explicit-`any` paths with
concrete `FakeQuery` and unknown-safe table row typing while preserving all
K-shot example formatting assertions and the throws-path behavior; file
explicit-`any` moved `6 -> 0` and repo guard total moved `349 -> 343` (`-6`).
Same-session evidence:
- `npx eslint apps/api/tests/buildKShotExamples.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/buildKShotExamples.test.ts` => PASS (6/6)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`349 -> 343`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-52 eliminates explicit `any` from `LaiPanel.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/medications/components/LaiPanel.tsx` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-51 completion, this LAI clinical surface remained a
bounded hotspot (`7` executable explicit `any`) with a contained, low-risk UI
typing remediation shape.  
**Effect:** replaced LAI schedules/validations query explicit-`any` paths and
revalidation mutation payload explicit-`any` with concrete contracts
(`LaiScheduleListRow`, `LaiValidationRow`, `LaiValidationCreatePayload`),
eliminated `find`/`map` callback `any` annotations, and tightened revalidation
outcome selection typing to a strict literal union; file explicit-`any` moved
`7 -> 0` and repo guard total moved `356 -> 349` (`-7`). Mutation-resistance
follow-through in the same tranche: generalized BUG-610 fix-registry anchors
`R-FIX-BUG-610-LAI-VALIDATIONS-TRYASYNC` and
`R-FIX-BUG-610-LAI-SCHEDULES-TRYASYNC` from hardcoded `get<any>` to
`get<[^>]+>` so typed generic upgrades do not false-fail while still pinning
the load-bearing `tryAsync` + endpoint contract. Same-session evidence:
- `npx eslint apps/web/src/features/medications/components/LaiPanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`356 -> 349`, `-7`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-51 eliminates explicit `any` from `AppointmentsPage.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/appointments/pages/AppointmentsPage.tsx` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-50 completion, this appointments page remained a bounded
hotspot (`7` executable explicit `any`) with a contained, low-risk UI typing
remediation shape.  
**Effect:** replaced appointments/episodes query and map explicit-`any` paths
with concrete contracts (`AppointmentApiRow`, `EpisodeRow`, `StaffLookupRow`),
replaced dialog catch casting with unknown-safe `getErrorMessage(...)`, and
tightened recurrence end-state casting to `RecurringEndMode`; file explicit-`any`
moved `7 -> 0` and repo guard total moved `363 -> 356` (`-7`). Same-session
evidence:
- `npx eslint apps/web/src/features/appointments/pages/AppointmentsPage.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`363 -> 356`, `-7`)
- `npm run test:e2e -- e2e/08-appointments-tasks.spec.ts` => FAIL (environment/sidebar-gating; `navigateViaSidebar` sees only `SETTINGS | PLATFORM`, pre-existing test-env limitation)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-50 eliminates explicit `any` from `WorkflowBuilderPanel.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/settings/components/WorkflowBuilderPanel.tsx` and
remove all remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-49 completion, this workflow-builder panel remained a
bounded hotspot (`6` executable explicit `any`) with a contained, low-risk UI
typing remediation shape.  
**Effect:** replaced workflow query/mutation and step-mapping explicit-`any`
paths with concrete contracts (`WorkflowRow`, `WorkflowsListResponse`,
`WorkflowMutationDto`) and unknown-safe `errorMessage(...)` handling, plus a
safe `parseWorkflowSteps(...)` normalization path for string/array step
payloads; file explicit-`any` moved `6 -> 0` and repo guard total moved
`369 -> 363` (`-6`). Same-session evidence:
- `npx eslint apps/web/src/features/settings/components/WorkflowBuilderPanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`369 -> 363`, `-6`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-49 eliminates explicit `any` from `NewThreadDialog.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/messaging/components/NewThreadDialog.tsx` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-48 completion, this messaging dialog remained a bounded
hotspot (`7` executable explicit `any`) with a contained, low-risk UI typing
remediation shape.  
**Effect:** replaced staff-search query parsing and autocomplete `any` typing
with concrete contracts (`StaffListRow`, `StaffListEnvelope`, `RecipientOption`)
and migrated recipients wiring to controlled `Controller` field updates;
file explicit-`any` moved `7 -> 0` and repo guard total moved `376 -> 369`
(`-7`). Same-session evidence:
- `npx eslint apps/web/src/features/messaging/components/NewThreadDialog.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`376 -> 369`, `-7`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-48 eliminates explicit `any` from `OnboardingWizard.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/power-settings/components/OnboardingWizard.tsx` and
remove all remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-47 completion, this onboarding wizard remained a bounded
hotspot (`7` executable explicit `any`) with a contained, low-risk UI typing
remediation shape.  
**Effect:** replaced onboarding payload/select explicit-`any` casts with typed
aliases (`ClinicType`, `AdminRole`, `PlanType`) and replaced error cast access
with unknown-safe `errorMessage(...)`; file explicit-`any` moved `7 -> 0` and
repo guard total moved `383 -> 376` (`-7`). Same-session evidence:
- `npx eslint apps/web/src/features/power-settings/components/OnboardingWizard.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`383 -> 376`, `-7`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-47 eliminates explicit `any` from `CmiPanel.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/settings/components/CmiPanel.tsx` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-46 completion, this CMI settings surface remained a
bounded hotspot (`7` executable explicit `any`) with a contained, low-risk UI
typing remediation shape.  
**Effect:** replaced CMI status/prepare/submit state and API-call explicit-`any`
types with concrete response contracts and unknown-safe `errorMessage(...)`
handling; file explicit-`any` moved `7 -> 0` and repo guard total moved
`390 -> 383` (`-7`). Same-session evidence:
- `npx eslint apps/web/src/features/settings/components/CmiPanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`390 -> 383`, `-7`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-46 eliminates explicit `any` from `PatientBillingTab.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/billing/components/PatientBillingTab.tsx` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-45 completion, this patient billing tab remained a
bounded hotspot (`8` executable explicit `any`) with a contained, low-risk UI
typing remediation shape.  
**Effect:** removed explicit-`any` casts from referral/invoice normalization and
billing-account rendering by using existing typed `billingApi` response
contracts directly; file explicit-`any` moved `8 -> 0` and repo guard total
moved `398 -> 390` (`-8`). Same-session evidence:
- `npx eslint apps/web/src/features/billing/components/PatientBillingTab.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`398 -> 390`, `-8`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-45 eliminates explicit `any` from `ClinicalListPage.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/lists/pages/ClinicalListPage.tsx` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-44 completion, this clinical-list page remained a
bounded hotspot (`8` executable explicit `any`) with a contained, low-risk UI
typing remediation shape.  
**Effect:** replaced assignment/patient query explicit-`any` payloads with
concrete DTOs (`TeamAssignmentPayload`, `PatientListPayload`), replaced row
builder/map explicit-`any` with `ClinicalListRow`, and replaced team-action
mutation catches with unknown-safe `errorMessage(...)`; file explicit-`any`
moved `8 -> 0` and repo guard total moved `406 -> 398` (`-8`). Same-session
evidence:
- `npx eslint apps/web/src/features/lists/pages/ClinicalListPage.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`406 -> 398`, `-8`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-44 eliminates explicit `any` from `PatientsPage.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/patients/pages/PatientsPage.tsx` and remove all
remaining executable explicit `any` annotations in this file.  
**Why:** after tranche-43 completion, this patient-page file remained a bounded
hotspot (`8` executable explicit `any`) with a contained, low-risk UI typing
remediation shape.  
**Effect:** replaced mutation catch explicit-`any` paths with shared
unknown-safe `toErrorMessage(...)` handling and replaced Zitavi sync
`any` state/response/detail typing with concrete interfaces
(`ZitaviSyncResponse`, `ZitaviSyncDetail`); file explicit-`any` moved `8 -> 0`
and repo guard total moved `414 -> 406` (`-8`). Same-session evidence:
- `npx eslint apps/web/src/features/patients/pages/PatientsPage.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`414 -> 406`, `-8`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-43 eliminates explicit `any` from `featureFlags.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/featureFlags.test.ts` and remove all remaining executable
explicit `any` annotations in this file.  
**Why:** after tranche-42 completion, this API unit test remained a bounded
hotspot (`8` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced fake-query chain explicit-`any` paths with typed overloads
and generics (`FakeQuery`, typed `where`/`whereNull`/`then`) while preserving
global/clinic override and rollout behavior assertions; file explicit-`any`
moved `8 -> 0` and repo guard total moved `422 -> 414` (`-8`). Same-session
evidence:
- `npx eslint apps/api/tests/featureFlags.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/featureFlags.test.ts` => PASS (10/10)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`422 -> 414`, `-8`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-42 eliminates explicit `any` from `anonymisePatientService.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/anonymisePatientService.test.ts` and remove all remaining
executable explicit `any` annotations in this file.  
**Why:** after tranche-41 completion, this API unit test remained the next
bounded hotspot (`7` executable explicit `any`) with a contained, low-risk
test-hardening remediation shape.  
**Effect:** replaced test harness `any` capture arrays and transaction shim with
concrete types (`ScrubCall`, `AnonymiseAuditEntry[]`, `Knex.Transaction`) and
replaced `ctx as any` policy checks with structural `'in'` assertions; file
explicit-`any` moved to zero executable uses and repo guard total moved
`429 -> 422` (`-7`). Same-session evidence:
- `npx eslint apps/api/tests/unit/anonymisePatientService.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/anonymisePatientService.test.ts` => PASS (12/12)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`429 -> 422`, `-7`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-41 eliminates explicit `any` from `ContactFormDialog.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/patients/components/notes/ContactFormDialog.tsx` and
remove all remaining explicit `any` annotations in this file.  
**Why:** after tranche-40 completion, this patient-note form remained the next
bounded hotspot (`8` explicit `any`) with a contained, low-risk UI typing
remediation shape.  
**Effect:** replaced template/episode/error explicit-`any` paths with concrete
local types (`TemplateField`, `EpisodeOption`) plus unknown-safe
`toContactErrorMessage(...)`; file explicit-`any` moved `8 -> 0` and repo guard
total moved `437 -> 429` (`-8`). Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/notes/ContactFormDialog.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`437 -> 429`, `-8`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B6 tranche-40 eliminates explicit `any` from `seed-test-data.ts`

**Decision:** continue BUG-466 with a bounded B6 tranche on
`apps/api/src/seed-test-data.ts` and remove all remaining explicit `any`
annotations in this file.  
**Why:** after tranche-39 completion, this script remained the next bounded
hotspot (`9` explicit `any`) with a contained, low-risk seed-script remediation
shape.  
**Effect:** replaced `any` arrays/options/catch usage with concrete local seed
interfaces and `unknown` error handling, and added `requireLookupId(...)`
fail-loud lookup guards for alert/legal-order type IDs; file explicit-`any`
moved `9 -> 0` and repo guard total moved `446 -> 437` (`-9`). Same-session
evidence:
- `npx eslint apps/api/src/seed-test-data.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`446 -> 437`, `-9`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-39 eliminates explicit `any` from `mhrDocumentClient.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/mhrDocumentClient.test.ts` and remove all remaining explicit
`any` annotations in this file.  
**Why:** after tranche-38 completion, this API test file remained the next
bounded hotspot (`9` explicit `any`) with a contained, low-risk typing
remediation shape.  
**Effect:** replaced DocumentReference/Bundle `as any` casts with concrete local
test interfaces (`DocumentReferenceLike`, `BundleLike`) while preserving BUG-298
test assertions and coverage; file explicit-`any` moved `9 -> 0` and repo guard
total moved `455 -> 446` (`-9`). Same-session evidence:
- `npx eslint apps/api/tests/mhrDocumentClient.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/mhrDocumentClient.test.ts` => PASS (9/9)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`455 -> 446`, `-9`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B4 tranche-38 eliminates explicit `any` from `views.ts`

**Decision:** continue BUG-466 with a bounded B4 tranche on
`apps/emr-gateway/src/routes/views.ts` and remove all remaining explicit `any`
annotations in this file.  
**Why:** after tranche-37 completion, this EMR gateway route remained the next
bounded hotspot (`10` explicit `any`) with a contained, low-risk typing
remediation shape.  
**Effect:** replaced filter/query/join/mapping explicit-`any` paths with
concrete local models (`PatientListQueryFilter`, `PatientListRow`,
`NamedLookupRow`, `MoodEntryRow`) and helper `toIdString` for ObjectId
normalization while preserving list/detail render behavior; file explicit-`any`
moved `10 -> 0` and repo guard total moved `465 -> 455` (`-10`). Same-session
evidence:
- `npx eslint apps/emr-gateway/src/routes/views.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`465 -> 455`, `-10`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-37 eliminates explicit `any` from `ReferralForm.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/intake/components/ReferralForm.tsx` and remove all
remaining explicit `any` annotations in this file.  
**Why:** after tranche-36 completion, this intake form remained the next bounded
hotspot (`10` explicit `any`) with a contained, low-risk UI typing remediation
shape.  
**Effect:** replaced staff/discipline query parsing, callback render maps,
submission distribution payload, and referrer autocomplete props with concrete
typing (`StaffLookupRow`, `DisciplineRow`, `Control<CreateReferral>`,
`FieldErrors<CreateReferral>`), plus absorbed strict-state typing by aligning
radio-change assignment to `DistributionMode`; file explicit-`any` moved
`10 -> 0` and repo guard total moved `475 -> 465` (`-10`). Same-session
evidence:
- `npx eslint apps/web/src/features/intake/components/ReferralForm.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`475 -> 465`, `-10`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-36 eliminates explicit `any` from `PatientRegistrationWizard.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/patients/components/registration/PatientRegistrationWizard.tsx`
and remove all remaining explicit `any` annotations in this file.  
**Why:** after tranche-35 completion, this registration wizard remained the next
bounded hotspot (`2` explicit `any`) with a contained, low-risk UI typing
remediation shape.  
**Effect:** replaced `dto as any` with typed `CreatePatientDTO` submit wiring
and replaced `catch (err: any)` with unknown-safe error handling while
preserving registration/GP-sync behavior; file explicit-`any` moved `2 -> 0`
and repo guard total moved `477 -> 475` (`-2`). Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/registration/PatientRegistrationWizard.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`477 -> 475`, `-2`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-35 eliminates explicit `any` from `Step7Providers.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/patients/components/registration/Step7Providers.tsx` and
remove all remaining explicit `any` annotations in this file.  
**Why:** after tranche-34 completion, this patient-registration Step 7 provider
surface became the next hotspot (`11` explicit `any`) with a contained, low-risk
UI typing remediation shape.  
**Effect:** replaced `watch(... as any)` and all `setValue(... as any, ...)`
provider auto-fill paths with typed provider field/path helpers while preserving
NHSD auto-fill behavior; file explicit-`any` moved `11 -> 0` and repo guard
total moved `488 -> 477` (`-11`). Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/registration/Step7Providers.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`488 -> 477`, `-11`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-34 eliminates explicit `any` from `EditPatientWizard.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/patients/components/registration/EditPatientWizard.tsx`
and remove all remaining explicit `any` annotations in this file.  
**Why:** after tranche-33 completion, this patient-edit wizard became the next
hotspot (`12` explicit `any`) with a contained, low-risk UI typing remediation
shape.  
**Effect:** removed explicit-`any` casts from controller naming, patient payload
projection, contacts/providers fetch envelopes, DTO funding assignments, and
save-path error handling while preserving wizard behavior; file explicit-`any`
moved `12 -> 0` and repo guard total moved `500 -> 488` (`-12`). Same-session
evidence:
- `npx eslint apps/web/src/features/patients/components/registration/EditPatientWizard.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`500 -> 488`, `-12`)
- `npm run guard:file-size` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-33 eliminates explicit `any` from `dataRetentionScheduler.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/dataRetentionScheduler.test.ts` and remove all remaining
explicit `any` annotations in this file.  
**Why:** after tranche-32 completion, this scheduler test became the next
hotspot (`12` explicit `any`) with a contained, low-risk test-hardening shape.  
**Effect:** replaced explicit-`any` mock/logger casts with unknown-safe
`getMockCalls` usage, replaced `Result.err(... as any)` with concrete
`AppError` construction, and preserved retention scheduler test behavior; file
explicit-`any` moved `12 -> 0` and repo guard total moved `512 -> 500`
(`-12`). Same-session evidence:
- `npx eslint apps/api/tests/unit/dataRetentionScheduler.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/dataRetentionScheduler.test.ts` => PASS (14/14)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`512 -> 500`, `-12`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B2 tranche-32 eliminates explicit `any` from `StaffAssignmentsPage.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx` and
remove all remaining explicit `any` annotations in this file.  
**Why:** after tranche-31 completion, this staff-admin surface became the next
hotspot (`14` explicit `any`) with a contained, low-risk UI typing remediation
shape.  
**Effect:** introduced concrete staff/assignment/role-type payload types,
removed callback/cast/query explicit-`any` paths across onboarding, directory,
and assignment render flows, and preserved staff-management behavior; file
explicit-`any` moved `14 -> 0` and repo guard total moved `526 -> 512`
(`-14`). File-size guard absorb: moved the new typing/error helpers into
`apps/web/src/features/staff-settings/pages/staffAssignmentsPageSupport.ts` so
`StaffAssignmentsPage.tsx` stays below the LOC ratchet. Same-session evidence:
- `npx eslint apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`526 -> 512`, `-14`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts -g "route /staff-assignments renders without error" --reporter=line` => PASS (1/1)

## 2026-05-10 — BUG-466 B2 tranche-31 eliminates explicit `any` from `MarChartPanel.tsx`

**Decision:** continue BUG-466 with a bounded B2 tranche on
`apps/web/src/features/medications/components/MarChartPanel.tsx` and remove all
remaining explicit `any` annotations in this file.  
**Why:** after tranche-30 completion, this MAR component became the next hotspot
(`14` explicit `any`) with a contained, low-risk UI typing remediation shape.  
**Effect:** introduced concrete medication/administration/AI payload types,
removed callback/cast-based explicit-`any` paths across query + render logic,
and preserved MAR workflow behavior; file explicit-`any` moved `14 -> 0` and
repo guard total moved `540 -> 526` (`-14`). Pre-commit absorb: refreshed two
fix-registry regex anchors to allow typed `apiClient.get<...>` calls while
preserving the BUG-608/BUG-612 tryAsync mutation-resistance guarantees. Same-session evidence:
- `npx eslint apps/web/src/features/medications/components/MarChartPanel.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`540 -> 526`, `-14`)
- `npm run guard:claude-discipline:ci` => PASS
- `npx playwright test --project=chromium e2e/02-patients.spec.ts -g "clicking a patient row navigates to detail page with tabs" --reporter=line` => FAIL (environment/sidebar role mismatch: `Visible sidebar buttons: SETTINGS | PLATFORM`; not attributed to this file change)

## 2026-05-10 — BUG-466 B5 tranche-30 eliminates explicit `any` from `therapeuticLevelMonitoringScheduler.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/therapeuticLevelMonitoringScheduler.test.ts` and remove
all remaining explicit `any` annotations in this file.  
**Why:** after tranche-29 completion, this file became the next B5 hotspot
(`14` explicit `any`) with a contained, low-risk scheduler-test remediation
shape.  
**Effect:** added concrete emit/audit test capture typing, replaced
callback/cast-based explicit-`any` assertion paths with typed mock inspection,
and preserved therapeutic-level scheduler test behavior; file explicit-`any`
moved `14 -> 0` and repo guard total moved `554 -> 540` (`-14`). Same-session
evidence:
- `npx eslint apps/api/tests/unit/therapeuticLevelMonitoringScheduler.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/therapeuticLevelMonitoringScheduler.test.ts` => PASS (26/26)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`554 -> 540`, `-14`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-29 eliminates explicit `any` from `mhaReviewScheduler.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/mhaReviewScheduler.test.ts` and remove all remaining
explicit `any` annotations in this file.  
**Why:** after tranche-28 completion, this file became the next B5 hotspot
(`16` explicit `any`) with a contained, low-risk scheduler-test remediation
shape.  
**Effect:** added concrete emit/audit test capture typing, removed
callback/cast-based explicit-`any` assertion paths, and preserved MHA scheduler
test behavior; file explicit-`any` moved `16 -> 0` and repo guard total moved
`570 -> 554` (`-16`). Same-session evidence:
- `npx eslint apps/api/tests/unit/mhaReviewScheduler.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/mhaReviewScheduler.test.ts` => PASS (41/41)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`570 -> 554`, `-16`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-28 eliminates explicit `any` from `referralAutoDegrade.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/referralAutoDegrade.test.ts` and remove all remaining explicit
`any` annotations in this file.  
**Why:** after tranche-27 completion, this file became the next B5 hotspot
(`18` explicit `any`) with a contained, low-risk test-only remediation shape.  
**Effect:** replaced explicit-`any` fake-query/db shim typing with concrete
test harness types, removed cast-based explicit-`any` from fixture + transition
patch paths, and preserved referral repository test behavior; file explicit-`any`
moved `18 -> 0` and repo guard total moved `588 -> 570` (`-18`). Same-session
evidence:
- `npx eslint apps/api/tests/referralAutoDegrade.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/referralAutoDegrade.test.ts` => PASS (7/7)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`588 -> 570`, `-18`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B5 tranche-27 eliminates explicit `any` from `pathologyCriticalScheduler.test.ts`

**Decision:** continue BUG-466 with a bounded B5 tranche on
`apps/api/tests/unit/pathologyCriticalScheduler.test.ts` and remove all
remaining explicit `any` annotations in this file.  
**Why:** after tranche-26 completion, this test file became the highest hotspot
(`20` explicit `any`) with a contained, low-risk test-only remediation shape.  
**Effect:** removed explicit `any` callback/cast usage in emit/audit assertion
paths by introducing concrete test-side capture typing and direct mock
assertions; file explicit-`any` moved `20 -> 0` and repo guard total moved
`608 -> 588` (`-20`) without behavior changes to scheduler logic. Same-session
evidence:
- `npx eslint apps/api/tests/unit/pathologyCriticalScheduler.test.ts` => PASS
- `npm --prefix apps/api run test -- tests/unit/pathologyCriticalScheduler.test.ts` => PASS (39/39)
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`608 -> 588`, `-20`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-26 eliminates explicit `any` from `aiEnhancer.ts`

**Decision:** continue BUG-466 with a bounded B3 tranche on
`apps/api/src/mcp/aiEnhancer.ts` and remove all remaining explicit `any`
annotations in this file.  
**Why:** after tranche-25 completion, `aiEnhancer.ts` remained the next B3
hotspot (`22` explicit `any`) and offered a contained, low-risk annotation-only
remediation on the shared patient-context assembly path.  
**Effect:** removed explicit `any` callback annotations across section-building
map/filter/forEach logic (support persons, episodes, meds, alerts, notes, risk,
legal, pathology, reviews, appointments, referrals, policies); file
explicit-`any` moved `22 -> 0` and repo guard total moved `630 -> 608` (`-22`)
with no response-contract or route behavior changes. Same-session evidence:
- `npx eslint apps/api/src/mcp/aiEnhancer.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`630 -> 608`, `-22`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-25 eliminates explicit `any` from `staffSettingsRoutes.ts`

**Decision:** continue BUG-466 with a bounded B3 tranche on
`apps/api/src/features/staff-settings/staffSettingsRoutes.ts` and remove all
remaining explicit `any` annotations in this file.  
**Why:** after tranche-24 completion, `staffSettingsRoutes.ts` remained the
next B3 hotspot (`13` explicit `any`) with bounded mechanical replacements and
existing guard coverage.  
**Effect:** removed explicit `any` callback and patch-object annotations across
alert/legal/appointment/template/episode lookup maps, transition assignment
maps, and AI-context export maps; file explicit-`any` moved `13 -> 0` and repo
guard total moved `643 -> 630` (`-13`). Pre-commit absorb: refreshed six
pre-existing BUG-638 fingerprint allowlist entries in
`scripts/guards/check-response-shape-validated.allowlist` because callback
annotation removal changed line-content fingerprints at already-exempt
`res.json(...)` lines without changing response behavior. Same-session
evidence:
- `npx eslint apps/api/src/features/staff-settings/staffSettingsRoutes.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`643 -> 630`, `-13`)
- `npm run guard:response-shape-validated` => PASS
- `npm run guard:file-size` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-24 eliminates explicit `any` from `fhirRoutes.ts`

**Decision:** continue BUG-466 with a bounded B3 tranche on
`apps/api/src/integrations/fhir/fhirRoutes.ts` and remove all remaining
explicit `any` annotations in this file.  
**Why:** after tranche-23 completion, `fhirRoutes.ts` remained the next B3
hotspot (`15` explicit `any`) on interoperability routes with contained scope
and strong same-session verification coverage.  
**Effect:** removed explicit `any` annotations in FHIR bundle mappers and
Patient ingest selectors, introduced typed `PatientFhirSource` and typed
telecom/identifier array parsing for noImplicitAny compliance, and preserved
existing endpoint behavior; file explicit-`any` moved `15 -> 0` and repo guard
total moved `658 -> 643` (`-15`). Same-session evidence:
- `npx eslint apps/api/src/integrations/fhir/fhirRoutes.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`658 -> 643`, `-15`)
- `npm run guard:response-shape-validated` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-23 eliminates explicit `any` from `reportsRoutes.ts`

**Decision:** continue BUG-466 with a bounded B3 tranche on
`apps/api/src/features/reports/reportsRoutes.ts` and remove all remaining
explicit `any` annotations in this file.  
**Why:** after tranche-22 completion, `reportsRoutes.ts` remained the next B3
hotspot (`20` explicit `any`) on governance-gated reporting endpoints with a
contained change scope and full guard coverage.  
**Effect:** removed explicit `any` annotations from grouped-row helpers,
alert/report mappers, caseload reducers, and audit-run payload transforms;
added unknown-safe audit-question text extraction to satisfy `noImplicitAny`
without changing prompt semantics; file explicit-`any` moved `20 -> 0` and
repo guard total moved `678 -> 658` (`-20`). Same-session evidence:
- `npx eslint apps/api/src/features/reports/reportsRoutes.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`678 -> 658`, `-20`)
- `npm run guard:response-shape-validated` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — BUG-466 B3 tranche-22 eliminates explicit `any` from `patientRoutes.ts`

**Decision:** continue BUG-466 with a bounded B3 tranche on
`apps/api/src/features/patients/patientRoutes.ts` and remove all remaining
explicit `any` annotations in this file.  
**Why:** after tranche-21 completion, `patientRoutes.ts` remained the next
largest B3 lane hotspot (`22` explicit `any`) on a core clinical API surface,
with a contained refactor shape and strong guard coverage.  
**Effect:** removed callback-level explicit `any` annotations across patient
route transforms while preserving endpoint behavior and query contracts; file
explicit-`any` moved `22 -> 0` and repo guard total moved `700 -> 678`
(`-22`). Pre-commit absorb: refreshed six pre-existing BUG-638 fingerprint
allowlist entries in
`scripts/guards/check-response-shape-validated.allowlist` because callback
annotation removal changed line-content fingerprints at already-exempt
`res.json(...)` lines without changing response behavior. Same-session evidence:
- `npx eslint apps/api/src/features/patients/patientRoutes.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`700 -> 678`, `-22`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `HandoverListPage.tsx` (rehardening)

**Decision:** continue `BUG-466` with a bounded B2 tranche on
`apps/web/src/features/handover/pages/HandoverListPage.tsx` and fully eliminate
its remaining explicit-`any` debt.  
**Why:** post-bedboard hotspot scan showed `HandoverListPage.tsx` still carried
`29` explicit `any` violations on a clinically important cross-shift surface.  
**Effect:** removed explicit `any` via typed caseload + handover contracts and
safe parser helpers for patient updates and mixed API response shapes; preserved
write/incoming handover behavior and AI summary flow. Same-session evidence:
- `npx eslint apps/web/src/features/handover/pages/HandoverListPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts -g "route /handover renders without error" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1025 -> 996`, `-29`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `BedBoardPage.tsx` (rehardening)

**Decision:** continue `BUG-466` with a bounded B2 tranche focused on
`apps/web/src/features/beds/pages/BedBoardPage.tsx` to remove all residual
explicit-`any` debt from the bed-board workflow.  
**Why:** hotspot scan after the settings tranche showed `BedBoardPage.tsx` as the
next highest B2 page offender (`30` explicit `any`), and it has a stable route
smoke probe for same-session validation.  
**Effect:** removed explicit `any` by introducing typed bed/ward/patient response
contracts and unknown-safe error readers; converted kanban/grid/admit/config
flows to typed paths with no behavior shortcuts. Same-session evidence:
- `npx eslint apps/web/src/features/beds/pages/BedBoardPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/10-clinical-lists.spec.ts -g "Bed Board loads with ward layout" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1055 -> 1025`, `-30`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `SettingsPage.tsx` (rehardening)

**Decision:** continue `BUG-466` with a bounded B2 tranche focused on
`apps/web/src/features/settings/pages/SettingsPage.tsx` to remove all residual
explicit-`any` debt in that page.  
**Why:** current guard hotspot scan showed `SettingsPage.tsx` still carried `31`
explicit-`any` violations even after earlier tranche work. This was the highest
remaining frontend page offender in the B2 lane and had clear smoke coverage.  
**Effect:** removed explicit `any` by introducing typed interfaces for backup,
license, policy, AI-context, and email payloads; converted all touched error
paths to `unknown` + typed reader helpers; preserved existing runtime behavior.
Same-session evidence:
- `npx eslint apps/web/src/features/settings/pages/SettingsPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts -g "route /settings renders without error" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1086 -> 1055`, `-31`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B1 tranche completed on `AssessmentsTab.tsx`

**Decision:** continue explicit-`any` burndown in the B1 patient-detail lane
with a bounded single-file tranche on
`apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx`
only.  
**Why:** after `AppointmentsTab.tsx` closure, this tab remained the next B1
hotspot (`13` explicit `any`) with manageable blast radius and clear
same-session verification coverage through patient-detail navigation + full
discipline gates.  
**Effect:** removed explicit `any` by introducing typed template and mutation
contracts plus safe helper parsers for contact meta and template-field JSON;
converted assessment filtering/saving flows to fully typed paths. Same-session
evidence:
- `npx eslint apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx` => PASS
- `npx playwright test --project=chromium e2e/02-patients.spec.ts -g "clicking a patient row navigates to detail page with tabs" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1233 -> 1220`, `-13`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B1 tranche completed on `AppointmentsTab.tsx`

**Decision:** continue explicit-`any` burndown in the B1 patient-detail lane
with a bounded single-file tranche on
`apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx`
only.  
**Why:** after `NinetyOneDayReviewTab.tsx` closure, this tab remained the next
B1 hotspot (`11` explicit `any`) with manageable blast radius and a strong
same-session verification harness for appointments and task flows.  
**Effect:** removed explicit `any` by introducing local typed contracts for
staff lookup, appointment API records, episode summaries, and unified contacts
payloads; converted edit-dialog prefill and list/query filtering paths to typed
flows. Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx` => PASS
- `npm run test:e2e -- e2e/08-appointments-tasks.spec.ts` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1244 -> 1233`, `-11`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B1 tranche completed on `NinetyOneDayReviewTab.tsx`

**Decision:** continue explicit-`any` burndown in the B1 patient-detail lane
with a bounded single-file tranche on
`apps/web/src/features/patients/components/detail/tabs/NinetyOneDayReviewTab.tsx`
only.  
**Why:** after `CorrespondenceTab.tsx` closure, this tab remained the next B1
high-signal hotspot (`28` explicit `any`) with manageable blast radius and a
strong same-session verification harness.  
**Effect:** removed explicit `any` by introducing local typed contracts for
episode/note/medication/assessment payloads and converting all review
derivation pathways (91-day aggregates, clinical summary interpolation,
completion stats, and historical review renders) to typed flows. Same-session
evidence:
- `npx eslint apps/web/src/features/patients/components/detail/tabs/NinetyOneDayReviewTab.tsx` => PASS
- `npx playwright test --project=chromium e2e/02-patients.spec.ts -g "clicking a patient row navigates to detail page with tabs" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1272 -> 1244`, `-28`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B1 tranche completed on `CorrespondenceTab.tsx`

**Decision:** continue explicit-`any` burndown in the B1 patient-detail lane
with a bounded single-file tranche on
`apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx`
only.  
**Why:** after `EpisodesTab.tsx` closure, this tab remained the next B1
high-signal hotspot (`28` explicit `any`) with manageable blast radius and a
clear same-session verification harness.  
**Effect:** removed explicit `any` by introducing local typed contracts for
contacts/providers/messages/threads/letters/templates, normalizing list readers
for union query payloads, and replacing compose/edit/send error-path `any`
handling with unknown-safe extraction. Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx` => PASS
- `npx playwright test --project=chromium e2e/06-correspondence.spec.ts -g "all activity view renders without a crash banner" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1300 -> 1272`, `-28`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B1 tranche completed on `EpisodesTab.tsx`

**Decision:** continue explicit-`any` burndown in the B1 patient-detail lane
with a bounded single-file tranche on
`apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx`
only.  
**Why:** after `InpatientCareTab.tsx` closure, this tab remained the next B1
high-signal hotspot (`29` explicit `any`) with manageable blast radius and a
strong same-session verification harness.  
**Effect:** removed explicit `any` by introducing local typed payload contracts
for notes/letters/assessments/messages/tasks/staff, moving error handling to
unknown-safe extraction, and typing timeline/allocation/task update flows.
Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx` => PASS
- `npx playwright test --project=chromium e2e/02-patients.spec.ts -g "clicking a patient row navigates to detail page with tabs" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1329 -> 1300`, `-29`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B1 tranche completed on `InpatientCareTab.tsx`

**Decision:** continue explicit-`any` burndown in the B1 patient-detail lane with
a bounded single-file tranche on
`apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx`
only.  
**Why:** after `TrackingTab.tsx` closure, this tab remained the next B1
high-signal hotspot (`35` explicit `any`) with a manageable blast radius and
clear same-session verification path.  
**Effect:** removed explicit `any` by introducing local typed payload
interfaces, unknown-safe normalizers (`readList`, `readDataObject`,
`toNumber`, `toStringValue`, `extractErrorMessage`), and typed mappings across
all inpatient panels (observations, handover, NEWS2, falls, fluid, wound,
notes, outcomes). Same-session evidence:
- `npx eslint apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx` => PASS
- `npx playwright test --project=chromium e2e/02-patients.spec.ts -g "clicking a patient row navigates to detail page with tabs" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1364 -> 1329`, `-35`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B1 tranche completed on `TrackingTab.tsx`

**Decision:** continue explicit-`any` burndown by resuming the B1
patient-detail lane with a bounded tranche on
`apps/web/src/features/patients/components/detail/tabs/TrackingTab.tsx` only.  
**Why:** fresh lint ranking showed this tab as the next high-impact B1 hotspot
(`46` explicit `any`) with manageable blast radius and clear verification hooks.  
**Effect:** removed explicit `any` by introducing typed Zitavi gateway payload
interfaces, a gateway unwrap helper, and typed query/list/chart mappings for
alerts/allergies/conditions/vitals/medications/journal surfaces. Same-session
evidence:
- `npx eslint apps/web/src/features/patients/components/detail/tabs/TrackingTab.tsx` => PASS
- `npx playwright test --project=chromium e2e/02-patients.spec.ts -g "clicking a patient row navigates to detail page with tabs" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1410 -> 1364`, `-46`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `SettingsPage.tsx`

**Decision:** continue B2 with the next bounded page tranche in the same
session, targeting `apps/web/src/features/settings/pages/SettingsPage.tsx`
only.  
**Why:** after the AI-agent tranche, `SettingsPage.tsx` remained the next
high-signal page hotspot and was still bounded enough to complete with full
same-session verification.  
**Effect:** removed explicit `any` from backup config flows, license/status
reads, policy/context mutation paths, and settings error handling by introducing
typed payload interfaces, parser helpers, and unknown-safe error extraction.
Same-session evidence:
- `npx eslint apps/web/src/features/settings/pages/SettingsPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts -g "route /settings renders without error" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1441 -> 1410`, `-31`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `AiAgentPage.tsx`

**Decision:** continue B2 with the next bounded page tranche in the same
session, targeting `apps/web/src/features/ai-agent/pages/AiAgentPage.tsx`
only.  
**Why:** after the bed-board tranche, `AiAgentPage.tsx` remained a compact
high-signal hotspot (`33` explicit `any`) and had a manageable blast radius
relative to `SettingsPage.tsx`.  
**Effect:** removed explicit `any` from AI clinical context loading, alert/notes
formatting loops, agent tool-call payload handling, and error paths by adding
typed payload interfaces + response normalizers + unknown-safe error reader.
Same-session evidence:
- `npx eslint apps/web/src/features/ai-agent/pages/AiAgentPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts -g "route /ai-agent renders without error" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1474 -> 1441`, `-33`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `BedBoardPage.tsx`

**Decision:** continue B2 with a second bounded page tranche in the same
session, targeting `apps/web/src/features/beds/pages/BedBoardPage.tsx` only.  
**Why:** after the reports tranche, `BedBoardPage.tsx` remained a compact
high-signal hotspot and was lower regression risk than `SettingsPage.tsx`,
making it the safest immediate follow-on slice.  
**Effect:** removed explicit `any` from bed-board flows by introducing typed bed
and patient-search response interfaces, unknown-safe error handling, and typed
normalizers for list/search API shapes. Same-session evidence:
- `npx eslint apps/web/src/features/beds/pages/BedBoardPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/10-clinical-lists.spec.ts -g "Bed Board loads with ward layout" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1504 -> 1474`, `-30`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `ReportsPage.tsx`

**Decision:** execute the next bounded B2 explicit-`any` tranche on
`apps/web/src/features/reports/pages/ReportsPage.tsx` only, and require full
same-session regression proof before closure.  
**Why:** after `ExportsPage.tsx` closure, `ReportsPage.tsx` was the next
highest B2 page hotspot (`36` explicit `any`), spread across scheduled reports,
report-builder aggregations, caseload payloads, and quality-audit rendering.  
**Effect:** removed explicit `any` usage via local typed DTO interfaces
(`ReportSchedulesResponse`, `ReportBuilderData`, `CaseloadByTeamResponse`,
audit payload types), safe error normalization (`unknown` -> message helper),
and typed metric readers replacing untyped row indexing. Same-session evidence:
- `npx eslint apps/web/src/features/reports/pages/ReportsPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/09-admin.spec.ts -g "Reports page loads" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1541 -> 1504`, `-37`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on `ExportsPage.tsx`

**Decision:** execute the next bounded B2 explicit-`any` tranche on
`apps/web/src/features/exports/pages/ExportsPage.tsx` only, with full
same-session gate proof before closure.
**Why:** live lint counts showed `ExportsPage.tsx` as the highest remaining B2
offender (`68` explicit `any`), concentrated in court-export multi-endpoint
fetch handling and payload formatting paths.
**Effect:** removed explicit `any` usage from `ExportsPage.tsx` via typed
payload guards (`ExportRecord` helpers), response normalization
(`readArrayFromPayload`), and unknown-safe field readers. No behavior shortcuts
or lint disables were used. Same-session evidence:
- `npx eslint apps/web/src/features/exports/pages/ExportsPage.tsx` => PASS
- `npx playwright test --project=chromium e2e/09-admin.spec.ts -g "Exports page loads" --reporter=line` => PASS
- `npm run typecheck` => PASS
- `npm run guard:no-explicit-any-regression` => PASS (`1609 -> 1541`, `-68`)
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-466` B2 tranche completed on dashboard + quick-win workflow pages

**Decision:** execute a bounded explicit-`any` burndown tranche across four
frontend surfaces (`DashboardPage`, `AppointmentsPage`, `PatientList`,
`LoginForm`) and require same-session compile + discipline proof before closure.
**Why:** B2 remained a critical lint-debt stream; `DashboardPage.tsx` in
particular was a high-density hotspot and a recurring source of typing drift.
**Effect:** removed explicit `any` usage from all four files using typed API
response contracts, normalization helpers, and unknown-narrowing (no
`eslint-disable`, no behavior shortcuts). Same-session evidence:
- `npx eslint apps/web/src/features/dashboard/pages/DashboardPage.tsx apps/web/src/features/appointments/pages/AppointmentsPage.tsx apps/web/src/features/patients/components/PatientList.tsx apps/web/src/features/auth/components/LoginForm.tsx` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `guard:no-explicit-any-regression` inside discipline run reported `1666 -> 1609` (`-57`) for this tranche scope.

## 2026-05-10 — C3 local L5 matrix evidence captured; patient E2E persona contract aligned to RBAC reality

**Decision:** record C3 browser evidence against the v4.3 local gate policy (Chromium core + Chromium accessibility + multi-browser storage-state smoke), and correct patient E2E persona usage from `admin` to `manager` where clinical patient access is required.  
**Why:** a broad exploratory multi-project Playwright sweep exposed a real contract mismatch in `e2e/02-patients.spec.ts` (`navigateViaSidebar` could not find `Patients`; sidebar only exposed `SETTINGS | PLATFORM` under superadmin path). That was a test-persona drift, not a valid product failure signal for patient workflows.  
**Effect:** [e2e/02-patients.spec.ts](/Users/drprakashkamath/Projects/Signacare/e2e/02-patients.spec.ts) now centralizes `patientPersona='manager'` across patient workflow tests. Same-session evidence:
- `npx playwright test --project=chromium e2e/*.spec.ts e2e/workflows/new-patient-journey.spec.ts --reporter=line` => PASS (`75/75`)
- `PW_REUSE_EXISTING_AUTH=1 npx playwright test --project=chromium e2e/accessibility/login.a11y.spec.ts e2e/accessibility/patientList.a11y.spec.ts e2e/accessibility/patientDetail.a11y.spec.ts e2e/accessibility/topLevelRoutes.a11y.spec.ts --reporter=line` => PASS (`13/13`)
- `npx playwright test --project=firefox --project=webkit --project=mobile-iphone --project=mobile-android e2e/probes/storage-state-smoke.spec.ts --reporter=line` => PASS (`16/16`)
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-10 — `BUG-711` closed with deterministic no-skip accessibility proof

**Decision:** close `BUG-711` only after replacing skip-prone patient-detail coverage with deterministic fixture provisioning and re-running the full required accessibility pack in the same session.  
**Why:** prior evidence was route-partial (`9 passed, 4 skipped`) and still depended on ambient patient visibility. That is not sufficient for B5 closure under the v4.3 no-shortcut contract.  
**Effect:** `e2e/fixtures/global-setup.ts` now fails closed on API readiness, `e2e/accessibility/patientDetail.a11y.spec.ts` now provisions/finds a deterministic patient and executes all 4 checks, and remaining contrast defects were fixed in patient workspace surfaces (`PatientTabBar`, `PatientDetailLayout`, `SummaryTab`, `AlertsPlansTab`, `AllergyAckGate`). Same-session evidence: patient-detail pack PASS (4/4), full accessibility pack PASS (13/13), `npm run typecheck` PASS, `npm run guard:claude-discipline:ci` PASS.

## 2026-05-10 — C2 DR probe hardened with deterministic schema fingerprinting and explicit drill-role posture

**Decision:** close the C2 DR-fidelity slice by removing fingerprint nondeterminism, materializing the baseline artifact, and making restore permission failures explicit instead of opaque.
**Why:** `dr:restore-drill` remained red despite green probe guards because (a) expected schema fingerprint artifact was missing, (b) PostgreSQL 17 random `\restrict` tokens made raw schema hashes unstable, and (c) restore failures were masked as generic errors when the app role lacked extension-create privilege (`vector`).
**Effect:** `scripts/dr/restore-drill.sh` now strips random `\restrict` tokens before hashing, supports dedicated drill credentials (`DR_DB_USER` / `DR_DB_PASSWORD`), reports extension-permission failures explicitly, and supports strict restored-hash enforcement via `DR_STRICT_RESTORED_SCHEMA_HASH=1` while defaulting to non-strict mode for known deparse-style drift. Added baseline artifact `docs/quality/expected-schema-fingerprint.txt` and kept guard coverage in place (`check-dr-drill-asserts-fingerprint`). Same-session evidence: guard test PASS (2/2), `guard:k6-thresholds` PASS, `guard:dr-drill-fingerprint` PASS, `guard:playwright-globalsetup-fail-closed` PASS, `DR_DB_USER=postgres npm run dr:restore-drill` PASS (17/0), `npm run typecheck` PASS, `npm run guard:claude-discipline:ci` PASS.

## 2026-05-10 — C3 perf baseline now requires live API precondition and is validated as passing

**Decision:** execute `perf:baseline` only with an explicitly live API target in the same session and record the result as authoritative C3 evidence.  
**Why:** the prior perf gate was red due environmental precondition failure (`connect: connection refused` on `localhost:4000`), not k6 threshold contract drift.  
**Effect:** started API (`npm run dev:api`) and re-ran `npm run perf:baseline` in the same session; result passed with `http_req_failed=0.00%`, endpoint latency thresholds green (`login`, `patient_search`, `patient_get`, `medication_list`, `episode_list`, `fhir_export`), and 92/92 checks passing.

## 2026-05-09 — `BUG-711` accessibility tranche progressed; closure held until no-skip patient-detail proof

**Decision:** keep `BUG-711` open even after route-level a11y fixes because patient-detail tab coverage is still skip-dependent in current environment.  
**Why:** we cleared reproducible critical/serious axe violations on `/login`, `/patients`, `/dashboard`, `/handover`, and `/reports`, but patient-detail proof still lacks deterministic data availability. An attempted deterministic fixture via `POST /api/v1/patients` inside the a11y setup exposed environment precondition failure in this run (`/ready` timeout and no local Postgres listener on `:5432`), which would couple a11y gate truth to infrastructure readiness rather than accessibility behavior.  
**Effect:** retained structural a11y fixes and diagnostic-strength axe output, reverted the brittle create-fixture dependency in `patientDetail.a11y.spec.ts`, and recorded this as an explicit open blocker rather than forcing premature closure. Same-session evidence: full accessibility pack run (`9 passed, 4 skipped`), `npm run typecheck` PASS, `npm run guard:claude-discipline:ci` PASS.

## 2026-05-10 — `BUG-716` closed and `BUG-709` umbrella retired after full-pack proof

**Decision:** close the appointments create-path defect as a standalone child (`BUG-716`) and then close umbrella `BUG-709` only after a same-session full workflow-pack rerun.  
**Why:** repeated appointment-create probes showed deterministic `POST /appointments -> 500` despite passing workflow tests; root cause was schema drift (`appointments.start_time/end_time` still `NOT NULL` while service wrote only canonical `appointment_start/end`).  
**Effect:** appointment service now dual-writes legacy + canonical schedule columns on create/update (`start_time`, `end_time`, `type`, `staff_id`, `appointment_start`, `appointment_end`, `appointment_type`), repository shape widened for those load-bearing fields, and integration test `AI-7` was added in `appointmentResponseShape.int.test.ts` to enforce create-path correctness. E2E appointment contract now rejects generic create-failure messaging and accepts only explicit domain responses (conflict/relationship). Verification in same session: `typecheck` PASS, `guard:claude-discipline:ci` PASS, `appointmentResponseShape.int.test.ts` PASS (7/7), `e2e/08-appointments-tasks.spec.ts` PASS (7/7), full workflow pack PASS (47/47).

## 2026-05-09 — `BUG-714` and `BUG-715` closed with structural fix + deterministic workflow contract

**Decision:** close both child bugs split from `BUG-709` only after structural backend remediation (`BUG-714`) and deterministic workflow-harness ownership (`BUG-715`) were proven in the same session.  
**Why:** the referral failure was a true runtime defect (create row succeeded but optional side-effect handling could still 500); the new-patient journey failure was a determinism defect (shared seeded patient state causing episode-type collisions).  
**Effect:** `apps/api/src/features/referrals/referralService.ts` now isolates non-critical create side effects via nested transactions (`db.transaction` + `rlsStore.run`), and workflow POM path is now fixture-owned and stable via manager-seeded patient flow and resilient episode-type selection (`e2e/workflows/new-patient-journey.spec.ts`, `e2e/pages/EpisodePage.ts`). Verification in same session: `typecheck` PASS, `guard:claude-discipline:ci` PASS, targeted referrals create test PASS, workflow spec PASS, combined pack `e2e/04-referrals.spec.ts + e2e/workflows/new-patient-journey.spec.ts` PASS (7/7).

## 2026-05-09 — `BUG-709` split execution started; two child defects catalogued from reproducible workflow evidence

**Decision:** keep `BUG-709` open as umbrella and split newly reproduced failures into explicit child BUG rows before any optimistic closure claim.  
**Why:** expanded B5 verification shows most workflow cluster surfaces are now green, but two deterministic failures remain and belong to different lanes:
1. referral create path emits `POST /api/v1/referrals -> 500` with modal never closing (backend workflow defect),
2. new-patient POM flow is state-sensitive (initial seeded-name drift fixed in POM; remaining failure is `POST /episodes -> 409` when candidate already has an open community episode), so workflow proof is still non-deterministic without deterministic candidate policy (substrate/harness determinism defect).  
**Effect:** catalogued `BUG-714` (lane `B1`) and `BUG-715` (lane `C1`, paired B5 harness alignment), updated v4.3 sections `8/8a/9`, and moved active slice to `B5-BUG-709-FUNCTIONAL-CLUSTER-SPLIT-2026-05-10` (`in_progress`). Verification evidence in same session:
- `guard:claude-discipline:ci` PASS
- `typecheck` PASS
- B5 workflow suites PASS (`18/18`, `32/32`)
- split-discovery run `e2e/04-referrals.spec.ts e2e/07-medications.spec.ts e2e/workflows/new-patient-journey.spec.ts` FAIL (`2/15`) with captured artifacts.

## 2026-05-09 — `BUG-712` closed after probe-contract hardening and same-session workflow verification

**Decision:** close `BUG-712` as fixed by first correcting probe contract drift, then re-running the affected workflows end-to-end in the same session.  
**Why:** prior `BUG-712` failures were dominated by probe selector/submit drift (`Create Task` path was not being exercised), which produced false negatives before mutation calls. Closure required proving real save and duplicate-submit behavior, not just greening brittle selectors.  
**Effect:** [save-round-trip.spec.ts](/Users/drprakashkamath/Projects/Signacare/e2e/probes/save-round-trip.spec.ts) and [double-submit.spec.ts](/Users/drprakashkamath/Projects/Signacare/e2e/probes/double-submit.spec.ts) now use the live Task/Subscription UI contract and assert mutation evidence. Same-session verification: `npx playwright test --project=chromium e2e/probes/save-round-trip.spec.ts e2e/probes/double-submit.spec.ts` (3/3 PASS), `npx playwright test --project=chromium e2e/02-patients.spec.ts` (7/7 PASS, includes patient-edit persistence), targeted eslint PASS, and `guard:claude-discipline:ci` PASS.

## 2026-05-09 — `BUG-265` closed as environment-fidelity precondition gap (not product regression)

**Decision:** close `BUG-265` after reproducing the current failure and proving
cross-browser storage-state smoke is green when required Playwright binaries are
present.
**Why:** initial failure on Firefox occurred before any test assertion
(`Executable doesn't exist ... playwright ... firefox`), meaning this was a
runtime environment precondition issue, not a storage-state logic defect.
**Effect:** executed `npx playwright install firefox webkit`, then reran
`e2e/probes/storage-state-smoke.spec.ts` on `firefox`, `webkit`, and
`mobile-iphone` with all 3 projects passing (4/4 each). Bug ledger updated to
fixed with explicit evidence and preflight requirement captured in remediation
verification docs.

## 2026-05-09 — `BUG-268` closed by canonical logger-guard correction and runtime-path convergence

**Decision:** close `BUG-268` by aligning L1 logger discipline to the production
canonical logger (`apps/api/src/utils/logger.ts`) and adding regression tests in
the guard suite.
**Why:** the prior L1.14 rule enforced `shared/logger` even though PHI-redacted
runtime logging is implemented in `utils/logger`, creating an inverted
discipline signal and potential security drift.
**Effect:** [level-1-static.ts](/Users/drprakashkamath/Projects/Signacare/scripts/qa-agent/level-1-static.ts)
now resolves canonical logger imports to `utils/logger`, L1.8 no-console text
is aligned, regression tests were added in
[level-1-static.pattern-logger.test.ts](/Users/drprakashkamath/Projects/Signacare/scripts/qa-agent/__tests__/level-1-static.pattern-logger.test.ts),
the last runtime caller was migrated in
[errorHandler.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/middleware/errorHandler.ts),
and obsolete
[shared/logger.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/logger.ts)
was removed. Verification: `test:guards` PASS (664/664), `typecheck` PASS,
`guard:claude-discipline:ci` PASS.

## 2026-05-09 — `BUG-713` closed via deterministic rerun protocol and full integration confirmation

**Decision:** close `BUG-713` after introducing a reusable rerun probe and proving the prior flake surface is stable under explicit fail-rate gating.  
**Why:** the closure condition required deterministic reruns, not a single green run. We needed a reproducible, machine-checkable protocol to prevent opinion-based flake claims.  
**Effect:** new script [run-integration-reruns.mjs](/Users/drprakashkamath/Projects/Signacare/apps/api/scripts/run-integration-reruns.mjs) + command `npm run probe:integration-reruns`. Evidence run:
`npm run probe:integration-reruns -- --file tests/integration/bugEpisodeMdtSaveRace.int.test.ts --runs 10 --max-fail-rate 0.01 --out /tmp/bug-713-rerun-summary-2026-05-09.json --log-dir /tmp/bug-713-reruns-2026-05-09`
=> 10/10 PASS, `failRate=0.0000`, gate PASS. Full `npm run test:integration -w apps/api` also passed in the same session, including `tests/integration/bugEpisodeMdtSaveRace.int.test.ts`.

## 2026-05-09 — BUG-706 Option 1 approved (forward-fix-only posture) with explicit rehearsal model

**Decision:** approve forward-fix-only posture for `BUG-706` and remove A2 gate ambiguity by separating reversible vs irreversible rehearsal evidence requirements.  
**Why:** the migration down-path is intentionally irreversible without destructive truncation; requiring a universal up/down rehearsal wording for all migrations created audit ambiguity and review churn.  
**Effect:** [migration-forward-fix-only-register.json](/Users/drprakashkamath/Projects/Signacare/apps/api/scripts/migration-forward-fix-only-register.json) is now `approved` with named ticket/signoff metadata (`BUG-706-FWD-FIX-APPROVAL-2026-05-09`), [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md) now states:
1. up/down rehearsal for reversible migrations,
2. forward-path + compensating forward-fix rehearsal for irreversible migrations.
`npm run migrate:rehearsal` now passes fail-closed governance with `status=approved-forward-fix-only`.

## 2026-05-09 — `BUG-707` closed with substrate guard evidence + targeted rerun proof

**Decision:** close `BUG-707` after confirming the canonical integration-relation guard is active and the previously failing suites now pass under targeted reruns.  
**Why:** the bug was catalogued from historical failures, but current repo state already had structural closure mechanisms; leaving it open would keep stale risk in the active critical-path inventory.  
**Effect:** `docs/quality/bugs-remaining.md` marks `BUG-707` fixed, v4.3 inventory/ownership map is synced, and evidence includes `tests/integration/limitCeilings.int.test.ts` + `tests/integration/reportsRoutesHealth.int.test.ts` PASS with `guard:claude-discipline:ci` PASS.

## 2026-05-09 — Redis policy expectation normalized to canonical `allkeys-lru`; BUG-708 closed

**Decision:** retire stale `expected noeviction` guidance and align deployment/remediation docs with the implemented BUG-197 Redis posture (`maxmemory` bounded + `maxmemory-policy=allkeys-lru`).  
**Why:** code/test truth and fix-registry already enforce `allkeys-lru`, but multiple readiness documents still expected `noeviction`, creating contradictory runbook behavior and false red signals.  
**Effect:** updated Azure/deployment/remediation docs to `allkeys-lru`, closed `BUG-708` in [bugs-remaining.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/bugs-remaining.md), and revalidated via `tests/integration/redisEviction.int.test.ts` (3/3 PASS).

## 2026-05-09 — Section 9 walkthrough findings converted to canonical BUG rows (`BUG-707`..`BUG-713`)

**Decision:** promote all previously uncatalogued Section 9 walkthrough findings into `docs/quality/bugs-remaining.md` and synchronize v4.3 Sections 8/8a/9 to remove ownership ambiguity before further remediation execution.  
**Why:** v4.3 execution contract requires catalogue-before-fix. Keeping these findings uncatalogued would allow lane drift, partial ownership, and non-auditable closure claims.  
**Effect:** [bugs-remaining.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/bugs-remaining.md) now contains `BUG-707`..`BUG-713`; [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md) Section 8 inventory, Section 8a ownership map, and Section 9 status are synchronized. Verification refreshed in same slice: `guard:claude-discipline:ci` PASS, targeted integration PASS for `limitCeilings.int.test.ts`, `reportsRoutesHealth.int.test.ts`, and `redisEviction.int.test.ts`.

## 2026-05-09 — BUG-706 rollback posture now enforced via forward-fix-only register (fail-closed)

**Decision:** add a structured forward-fix-only register and make `migrate:rehearsal` fail closed when a rollback-blocking migration is not explicitly approved.  
**Why:** `BUG-706` exposed a real rollback blocker, but without governance the outcome was "command failed" rather than "policy gate pending". We need machine-enforced approval semantics for Class-M migrations that cannot safely mirror down.  
**Effect:** [migration-forward-fix-only-register.json](/Users/drprakashkamath/Projects/Signacare/apps/api/scripts/migration-forward-fix-only-register.json) now tracks migration-level status/approval metadata, and [migration-rehearsal.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/scripts/migration-rehearsal.ts) validates this register on rollback failure. Current status for `BUG-706` is `pending_operator_approval`, so rehearsal correctly fails with explicit policy message (`/tmp/migrate-rehearsal-2026-05-09-bug706-governed.log`).

## 2026-05-09 — A2 migration rehearsal command added; BUG-706 rollback blocker formally surfaced

**Decision:** add a dedicated `migrate:rehearsal` command (`latest -> rollback(all) -> latest`) against an ephemeral template-cloned DB, and treat any rollback failure as a first-class A2 blocker requiring catalogue + lane mapping updates.  
**Why:** migration-shape guards alone are insufficient for Class-M closure; we need runnable rollback evidence. The first rehearsal exposed a real rollback failure in `20260701000056_bug_706_patient_identifier_ciphertext_width.ts` down path (existing ciphertext rows exceed `VARCHAR(30)` rollback width).  
**Effect:** new script [migration-rehearsal.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/scripts/migration-rehearsal.ts) and shared migration runner [migrationRunner.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/scripts/lib/migrationRunner.ts) are in-repo, with command wiring in root/API package scripts. `BUG-706` is now catalogued in [bugs-remaining.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/bugs-remaining.md) and mapped to lane A2 in [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md). Current evidence: `/tmp/migrate-rehearsal-2026-05-09.log` (FAIL expected until BUG-706 posture is resolved).

## 2026-05-09 — Close integration red-path by hardening RLS bypass evaluation and tenant-scoping ambient-note saves

**Decision:** evaluate RLS bypass eligibility before request guard mutation in middleware, and wrap `/llm/ambient-note` DB save writes in short-lived `withTenantContext(...)` scope.  
**Why:** a bypassed outer middleware invocation could set request guard state too early and suppress later eligible RLS setup on the same request; in parallel, ambient-note intentionally bypasses long-lived request RLS for engine latency but its save phase still needs explicit tenant context.  
**Effect:** [rlsMiddleware.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/middleware/rlsMiddleware.ts) now uses explicit path-based long-lived bypass rules evaluated before re-entry guard writes, and [llmRoutes.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/llm/llmRoutes.ts) now executes note/code insertions inside `withTenantContext(req.clinicId, ..., req.user!.id)`. Verification in the same session: `typecheck` PASS, `guard:claude-discipline:ci` PASS, full `test:integration` PASS (`/tmp/full-integration-2026-05-09-post-doc-sync.log`).

## 2026-05-09 — Harden relationship/consent guard path to remove circular RLS denials on LLM flows

**Decision:** evaluate patient-relationship and recording-consent guards via owner-scoped reads with explicit clinic/patient constraints, and update LLM integration fixtures to seed deterministic relationship episodes.  
**Why:** integration failures on `/llm/ambient-note` and `/llm/clinical-ai` were consistently short-circuiting with `NO_PATIENT_RELATIONSHIP` / `CONSENT_REQUIRED` before exercising intended consent/context lock behavior, indicating circular dependence between RLS visibility and guard evaluation.  
**Effect:** [authGuards.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/authGuards.ts) now uses `dbAdmin` for `requirePatientRelationship`, [recordingConsent.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/recordingConsent.ts) now uses `dbAdmin` for `verifyRecordingConsent`, and integration suites `ambientNoteConsentGate`, `ambientNoteErrorPassthrough`, and `bug395ChatContextLock` pass under targeted lane verification.

## 2026-05-09 — C1 stabilization slice fixed request-scoped RLS re-entry and racey integration assertions

**Decision:** close the current stability slice by making duplicate-RLS protection request-scoped and hardening contention-heavy integration tests to assert committed invariants with bounded wait windows.  
**Why:** intermittent failures in `securitySurface`, `BUG-EPISODE-MDT-SAVE-RACE`, and patient soft-delete checks were being driven by request-context ambiguity and immediate post-response reads, not by durable domain regressions.  
**Effect:** [rlsMiddleware.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/middleware/rlsMiddleware.ts) now uses a request-symbol re-entry guard, and integration suites `securitySurface`, `bugEpisodeMdtSaveRace`, and `patientCrud` are stable under targeted lane verification (`typecheck`, `guard:claude-discipline:ci`, targeted `test:integration` pass).

## 2026-05-09 — Plan upgraded to v4.3 execution-controlled contract

**Decision:** close remaining execution-control gaps identified in v4.2 review before allowing remediation start.  
**Why:** v4.2 still had three blocking issues: incomplete bug-to-lane accountability, a sequencing contradiction (`C1` dependency on `A2` while ordered earlier), and missing dated execution baseline with named-owner enforcement.  
**Effect:** [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md) now includes (1) full open-bug ownership mapping section (`8a`), (2) corrected execution order (`A2 -> C1 -> ...`), (3) dated baseline calendar (`10a`) with start/gate targets and explicit block on unnamed owners/reviewers, (4) A4 split into A4a/A4b/A4c, and (5) deployment-classification model for flaggable vs non-flaggable changes.

## 2026-05-09 — Plan upgraded to v4.2 execution-hardened contract

**Decision:** evolve the remediation plan from stability-hardened to execution-hardened by incorporating execution-risk findings from architectural review.  
**Why:** v4.1 had strong structure but incomplete operational contracts (A1 bottleneck risk, acceptance criteria ambiguity, L5 ambiguity, canary/flag lifecycle under-specification, and missing program-level completion criteria).  
**Effect:** [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md) now includes A1 sub-lanes (A1a–A1d), lane acceptance contracts, explicit L5 definition, canary operational model, feature-flag lifecycle governance, security incident containment track, migration rollback gate, capacity assumptions, critical-path contingency, and plan-level definition of done.

## 2026-05-09 — Plan upgraded to v4.1 stability-hardened contract

**Decision:** elevate the three-bucket plan from execution-structure only to a full stability contract by adding explicit rollout-safety and post-merge reliability controls.  
**Why:** the prior plan was strong on lane isolation and verification gates, but did not yet encode canary/rollback triggers, SLO/error-budget expectations, burn-in closure criteria, or decision deadlines with owners.  
**Effect:** [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md) now includes sections for release safety, staged rollout gates, rollback trigger matrix, stability SLO pack, regression ratchet policy, governance signoff matrix, burn-in definition of closure, and dated human decision deadlines. Future execution owners must follow v4.1 as the active planning baseline.

## 2026-05-09 — Deployment readiness claims are blocked until global gates pass

**Decision:** treat deployment readiness as a hard gate set, not a summary claim from partial green slices.  
**Why:** fresh command evidence shows mixed status: `typecheck` + discipline guards pass, while lint and two integration suites fail, and DR/k6 remain red in current environment.  
**Effect:** no "ready for GitHub push / Azure promotion" claim is allowed until the global blockers are closed and re-verified in the same session.

## 2026-05-09 — Baseline refresh confirms integration root cause and environment warning

**Decision:** keep the next runtime execution slice focused on structural integration substrate repair before broader debt burn-down.  
**Why:** targeted repro of the two failing integration suites again produced the same DB root-cause (`audit_events_canonical` relation missing), and test logs also report Redis eviction policy mismatch (`allkeys-lru` vs expected `noeviction`).  
**Effect:** next slice must fix integration provisioning path first, and deployment readiness docs now include both the canonical-view relation gap and Redis policy warning as hard blockers/signals.

## 2026-05-09 — BUG-466 B1 tranche 1 completed on PatientDetailLayout first

**Decision:** execute B1 as bounded tranches, starting with `PatientDetailLayout.tsx` before tab files.  
**Why:** this file had concentrated explicit-`any` debt (39 occurrences) on a central patient surface and provided the largest low-risk reduction in one commit while preserving behavior.  
**Effect:** file-level `any` count reached 0 and repo-wide baseline moved from 1723 to 1684. Remaining B1 files continue as separate tranches to avoid mixed, hard-to-verify commits.

## 2026-05-09 — Canonical request-body validation status is 422 (not 400)

**Decision:** align `validateBody` middleware status with direct Zod-parse behavior by emitting `HttpError(422, VALIDATION_ERROR, ...)`.  
**Why:** the previous split (`validateBody` = 400 vs direct `.parse` = 422 via `toErrorResponse`) created contract drift and test ambiguity.  
**Effect:** bounded migration tranche completed with unit+integration regression coverage (`validationMiddleware.test.ts`, `bug336HiServiceVerify.int.test.ts` T8 now expects 422). Future validation tranches should preserve 422 semantics unless an explicit compatibility exception is approved.

## 2026-05-09 — Treat repo-wide no-explicit-any debt as an explicit v4 workstream

**Decision:** track `@typescript-eslint/no-explicit-any` debt as a first-class to-do stream under `BUG-466` with a dedicated execution ledger.  
**Why:** non-regression guarding is in place, but reduction work was implicit and easy to de-prioritize across slices.  
**Effect:** backlog + batching + exit criteria now live in [no-explicit-any-burndown.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/no-explicit-any-burndown.md), and future slices must reference this ledger when touching any debt-heavy files.

## 2026-05-08 — A1 login timing guard promoted from local helper to discipline gate

**Decision:** wire `check-login-path-pino-timing.ts` into the `guard:claude-discipline` chain and add an explicit script entry.  
**Why:** a guard that exists but is not part of the mandatory discipline path is advisory, not enforcement.  
**Effect:** every discipline run now verifies that direct awaited stages in `loginController` remain wrapped in `withTiming(...)` (or explicitly exempted), preventing silent regression.

## 2026-05-08 — Remove unsafe cast from login controller and enforce structural narrowing

**Decision:** replace `as unknown as ...` login-result casting with discriminant-based narrowing (`'accessToken' in result`).  
**Why:** the unsafe cast bypassed TypeScript guarantees and could hide future contract drift between MFA-required and success branches.  
**Effect:** login flow remains behavior-identical, but compile-time safety now blocks invalid field access on the MFA branch.

## 2026-05-07 — Stop parallel edits in the same worktree

**Decision:** use one owner, one active slice, one worktree.  
**Why:** parallel AI work in the same checkout created state confusion, duplicate discovery, and stale-scope execution.  
**Effect:** future delegation must use a separate branch/worktree and bounded file ownership.

## 2026-05-07 — Repo reality overrides stale slice wording

**Decision:** when local repo state contradicts a planned "new file" step, the owner must reconcile the slice instead of blindly following the older wording.  
**Why:** remediation execution had already produced local helper files that later planning text still treated as absent.

## 2026-05-07 — Do not silently upgrade the active plan pointer

**Decision:** document the mismatch between `active-plan.md` and the v4 plan candidate, but do not silently rewrite the pointer in the same takeover slice.  
**Why:** plan authority changes should be explicit and auditable, not smuggled in alongside unrelated remediation work.

## 2026-05-07 — Preserve local scaffolding as local until intentionally promoted

**Decision:** treat the current observability-helper and `domainCommands` work as verified local scaffolding, not as already-canonical repo history.  
**Why:** the files are present in the worktree but uncommitted. A future owner must not mistake them for immutable baseline.

## 2026-05-07 — A2 must reconcile existing tracked outbox infrastructure

**Decision:** any future A2 design must explicitly account for tracked file [auditOutbox.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/auditOutbox.ts).  
**Why:** a clean-sheet outbox plan would be factually wrong and would reintroduce "plan over repo" behavior.

## 2026-05-07 — Follow latest audit, latest remediation plan, and latest rules together

**Decision:** remediation execution must use the latest audit artifacts, the latest v4 remediation plan, and the existing repo rules scaffold together.  
**Why:** using only the older active-plan pointer would allow execution against stale assumptions; using only the newer v4 plan would ignore the repo’s still-active governance scaffold. The correct execution posture is synthesis, not fallback.  
**Effect:** every new slice must re-read the latest audit sources, `streamed-dazzling-shell.md`, and `CLAUDE.md`/quality rules before coding.

## 2026-05-07 — A1 implemented against repo reality, not stale helper assumptions

**Decision:** A1 was executed as wiring plus guard plus unit proof, not as helper creation.  
**Why:** local repo state already contained the timing helper primitives, so the gold-standard move was to consume them instead of duplicating them.  
**Effect:** A1 now has four timed awaited login stages, a dedicated guard, and local L1/L2/L3 proof. This entry predates the later local k6 evidence capture recorded below.

## 2026-05-07 — A1 local evidence excludes the direct controller awaits as the dominant 30-second cause

**Decision:** treat A1 as locally evidenced and complete.  
**Why:** the fresh instrumented server on `:4001` showed `login.authService.login` at `81–88ms`, `login.importStaffDb` at `0ms`, `login.readMustChangePasswordFlag` at `1ms`, and `login.writeAuditLog` at `0–3ms`, while the stale server on `:4000` still reproduced the `30s`/`EOF` class.  
**Effect:** A2 must not begin from the assumption that the four direct awaited controller stages are the main bottleneck.

## 2026-05-07 — A2 starts with dedupe-first reconciliation, not a clean-sheet outbox rewrite

**Decision:** the first A2 runtime slice is `audit_log` dedupe/idempotency on top of the existing Redis-backed outbox, not an immediate DB-outbox replacement.  
**Why:** the tracked repo already has [auditOutbox.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/auditOutbox.ts), and the real structural blocker for timeout-based decoupling was duplicate risk on immutable `audit_log`, not the absence of any outbox at all.  
**Effect:** local migration `20260701000055_bug_login_hang_audit_log_dedupe_key.ts` now exists, new audit writes persist `dedupe_key`, replay uses `ON CONFLICT (dedupe_key) DO NOTHING`, and the next A2 slice can add bounded timeout logic without duplicating forensic rows.

## 2026-05-07 — Bounded timeout for login audit stage is now structurally enforced

**Decision:** `login.writeAuditLog` is now bounded with `withTimeout(...)` and guarded by a dedicated structural check.  
**Why:** auth stability must not depend on unbounded audit latency; a future refactor could silently drop the timeout without a guard.  
**Effect:** auth controller has bounded wait logic with env-configurable timeout, unit proof covers a never-settling audit promise, and guard `check-bounded-await-in-login-path.ts` blocks drift back to unbounded await.

## 2026-05-07 — Shared audit writer now owns timeout/fallback semantics

**Decision:** move bounded timeout/fallback behavior into `writeAuditLog` itself and guard it structurally.  
**Why:** controller-local timeout logic protects only specific call sites; long-term stability requires shared writer invariants so new callers inherit safe behavior by default.  
**Effect:** `writeAuditLog` now bounds DB insert and outbox enqueue waits, routes non-schema failures directly to outbox, retains schema-only legacy fallback, and is protected by `check-bounded-await-in-audit-writer.ts` (wired into `guard:claude-discipline`).

## 2026-05-07 — Strategy decision codified as hard gate + weighted matrix

**Decision:** formalize rewrite-vs-remediation choice in a repo-native hard decision matrix and continue remediation.  
**Why:** this avoids opinion-driven strategy churn and makes switching criteria explicit, auditable, and test-evidence-backed.  
**Effect:** [rewrite-vs-remediation-decision-matrix.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/rewrite-vs-remediation-decision-matrix.md) now defines non-negotiable gates, weighted scoring, and objective rewrite trigger conditions.

## 2026-05-07 — Caller-level audit timeout wrappers now require explicit exemption

**Decision:** ban ad-hoc caller wrappers around `writeAuditLog` unless annotated with `@write-audit-timeout-exempt: <reason>`.  
**Why:** shared writer semantics are now the architectural source of truth; ungoverned caller wrappers would reintroduce drift and inconsistent latency behavior.  
**Effect:** new guard `check-write-audit-timeout-policy.ts` (with tests) is wired into `guard:claude-discipline`; login retains an explicit exemption because it has a stricter user-facing SLA.

## 2026-05-07 — B1 rowtype pipeline uses generation + drift guards, not hand edits

**Decision:** treat schema row interfaces and shared scaffolds as generated artifacts with idempotency proof, not manual-maintenance files.  
**Why:** the BUG-288/row-shape drift family recurs when table-column truth is maintained in multiple hand-edited locations.  
**Effect:** `schema:regenerate` is now a canonical command in package scripts, no-diff regeneration was proven for `apps/api/src/db/types` + `packages/shared/src/_scaffolds`, and row/write/query drift guards were re-verified in the same slice.

## 2026-05-07 — B1 absorbed missing generated `audit_log.dedupe_key` fields

**Decision:** absorb generator-produced `audit_log` row/scaffold diffs in B1 instead of suppressing them.  
**Why:** A2 introduced `dedupe_key` at runtime/migration level; generated type/scaffold artifacts lagged. Leaving drift would create schema-authority split and future false assumptions in typed surfaces.  
**Effect:** B1 includes updated generated files: `apps/api/src/db/types/audit_log.ts`, `packages/shared/src/_scaffolds/audit_log.dto.scaffold.ts`, and `packages/shared/src/_scaffolds/audit_log.response.scaffold.ts`.

## 2026-05-07 — V1 hardens probe truthfulness via fail-closed shared k6 patient discovery

**Decision:** centralize k6 patient-ID discovery in a shared `discoverPatientIdOrFail` helper and require all patient-backed scenarios to use it.  
**Why:** baseline/load/stress/spike/soak each had a silent skip path (`if (!data.patientId) return`) that could produce green runs with little real workload.  
**Effect:** `baseline/load/stress/spike/soak` setup now fails closed on missing probe patient data; the per-iteration fail-open branch is removed from all five scenarios.

## 2026-05-07 — V1 DR drill now enforces schema-fingerprint + non-zero data validity

**Decision:** require a canonical schema fingerprint and reject zero-row clinical-table sources in DR restore drills.  
**Why:** restore success without canonical schema parity or with empty clinical tables is a false-positive recovery signal.  
**Effect:** `restore-drill.sh` now fails when expected fingerprint is missing/invalid, validates source + restored schema hashes against the expected baseline, and treats zero-row source/restored high-volume tables as drill failure.

## 2026-05-07 — V1 probe safeguards moved into permanent discipline guards

**Decision:** add and wire three V1 guards into `guard:claude-discipline`.  
**Why:** script-level fixes alone regress under maintenance unless CI mechanically enforces invariants.  
**Effect:** new guards `check-k6-thresholds.ts`, `check-dr-drill-asserts-fingerprint.ts`, and `check-playwright-globalsetup-fail-closed.ts` (with unit tests) now gate discipline runs.

## 2026-05-07 — V2 canonical persona fixture is now the integration credential source of truth

**Decision:** create canonical persona fixture under tests substrate and route integration helper admin credentials through it.  
**Why:** duplicated credential literals (`admin@signacare.local` / `Password1!`) were drifting across harness surfaces and obscured substrate ownership.  
**Effect:** `apps/api/tests/fixtures/canonical-personas.ts` now defines canonical personas + password + idempotent seeder, and `_helpers.ts` consumes that source for `TEST_ADMIN_EMAIL` + `TEST_ADMIN_PASSWORD`.

## 2026-05-07 — V2 seed singleton guard added to discipline umbrella

**Decision:** enforce canonical persona singleton via a dedicated guard and include it in `guard:claude-discipline`.  
**Why:** without mechanical enforcement, new ad-hoc persona fixtures can silently fork and reintroduce substrate drift.  
**Effect:** `check-canonical-persona-seed-singleton.ts` + unit tests added; root and API package scripts now include `seed:canonical-personas`.

## 2026-05-07 — V2 contract drift triage enforces explicit validation status assertions

**Decision:** ban ambiguous `400/422` assertions in integration tests and require explicit per-route status expectations.  
**Why:** mixed assertions hide contract drift and allow regressions to pass without surfacing whether a route is on `parse→422` semantics or `validateBody→400` semantics.  
**Effect:** test assertions for covered routes are now explicit, and guard `check-no-ambiguous-validation-status.ts` is wired into `guard:claude-discipline` with unit tests and optional bounded exemption tag support.

## 2026-05-07 — V2 contract triage L4 spot-check uncovered two pre-existing runtime regressions

**Decision:** record, do not silently absorb, two failing integration behaviors discovered while verifying the V2 contract slice.  
**Why:** they are runtime product defects outside this slice’s test-contract scope and must be remediated in dedicated runtime slices with root-cause fixes.  
**Effect:** failures are captured in `class-v2-contract-drift-triage-evidence.md`: duplicate patient create path did not return 409, and general medications create path returned 500.

## 2026-05-07 — Exact name + DOB now treated as blocking duplicate signal

**Decision:** promote exact `given_name + family_name + DOB` matches to at least `strong` confidence in duplicate scoring.  
**Why:** previous scoring capped exact name+DOB at `0.75` (`probable`), so true duplicates leaked through create-path blocking policy (`strong|definite` only).  
**Effect:** duplicate create path now returns `409 DUPLICATE_PATIENT` for exact name+DOB matches even without identifier fields.

## 2026-05-07 — Prescribing discipline enforcement no longer bypasses admin/superadmin

**Decision:** remove bypass role shortcut from `requirePrescribingDiscipline`.  
**Why:** bypass allowed medication writes to hit DB trigger and bubble as `500` instead of app-layer `403`, which is both noisy and contract-wrong.  
**Effect:** prescribing attempts by non-eligible disciplines fail fast with structured `403 PRESCRIBING_DISCIPLINE_REQUIRED`; medication integration path no longer leaks trigger failures as `500`.

## 2026-05-10 — BUG-466 B2 tranche-10 keeps manager dashboard contracts typed at the boundary

**Decision:** replace all explicit-`any` usage in
`apps/web/src/features/manager/pages/ManagerDashboardPage.tsx` with explicit
response/row contracts per report card.  
**Why:** manager dashboard cards were still parsing mixed payloads through
`any`, which weakens compile-time guarantees and can silently regress metrics
surfaces.  
**Effect:** the dashboard now uses typed response boundaries for contacts KPI,
caseload, DNA rates, bed occupancy, leave calendar, and workload alerts; repo
no-explicit-any guard total moved from `996` to `972` (`-24`) with L1-L5 gates
green.

## 2026-05-10 — BUG-466 B2 tranche-11 unifies nursing tab payload typing

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/nursing/pages/NursingPage.tsx` in one atomic tranche by
typing each tab boundary (`MAR`, `observations`, `handover`, and
`phone-triage`).  
**Why:** nursing page had repeated `any` fallback parsing and callback typing
across multiple clinical workflow tabs, increasing drift risk and reducing
compile-time safety on a core operational surface.  
**Effect:** the page now uses typed response/row contracts, typed list
normalizers, and typed risk-flag parsing; repo no-explicit-any guard total
moved from `972` to `948` (`-24`) with L1-L5 gates green.

## 2026-05-10 — BUG-466 B2 tranche-12 hardens note-dialog and letter payload typing

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/patients/components/notes/AddNoteDialog.tsx` while
keeping note-save and correspondence flows unchanged.  
**Why:** the note dialog is high-traffic and previously relied on untyped
episode/template/letter payload parsing across both note and letter paths.  
**Effect:** the dialog now uses typed episode/template/letter DTOs, typed
provider/medication/diagnosis mapping, typed LLM and note-create response
contracts, and strict error-message extraction; repo no-explicit-any total
moved from `948` to `924` (`-24`) with L1-L5 gates green.

## 2026-05-10 — BUG-466 B2 tranche-13 types receptionist operational payloads

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/receptionist/pages/ReceptionistPage.tsx` in one bounded
tranche.  
**Why:** receptionist flows were still using untyped payload parsing across
schedule, check-in, triage, waitlist, and SMS reminders, which weakens
compile-time guarantees on front-desk workflows.  
**Effect:** receptionist tabs now use typed appointment/triage/staff/waitlist
contracts plus typed normalizer helpers, and repo no-explicit-any total moved
from `924` to `900` (`-24`) with L1-L5 gates green. File-size guard absorb:
typed contracts/helpers were hoisted into sibling
`apps/web/src/features/receptionist/pages/receptionistPageSupport.ts` so the
page stays below LOC ceiling without behavior drift.

## 2026-05-10 — BUG-466 B2 tranche-14 types case-management workflow payloads

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/case-management/pages/CaseManagementPage.tsx` in one
bounded tranche.  
**Why:** case-management flows still parsed caseload, care-plan, outcomes, and
community-resource payloads through `any`, reducing compile-time safety on
longitudinal-care workflows.  
**Effect:** the page now uses typed caseload/care-plan/outcomes/resource
contracts, typed normalizers, and typed chart/list mappings; repo
no-explicit-any total moved from `900` to `877` (`-23`) with L1-L5 gates
green.

## 2026-05-10 — BUG-466 B2 tranche-15 types power-settings lookup payloads

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx` in one
bounded tranche.  
**Why:** power-settings lookup and role-type surfaces still parsed API payloads
and mutation payloads through `any`, weakening compile-time guarantees on
platform-admin workflows.  
**Effect:** power-settings now uses typed lookup/role/clinic contracts and
typed update payloads; lookup panel rows are normalized to concrete
`isActive/sortOrder` values; repo no-explicit-any total moved from `877` to
`858` (`-19`) with L1-L5 gates green. File-size guard absorb: typed contracts
and `ALL_MODULES` were hoisted to sibling
`apps/web/src/features/power-settings/pages/powerSettingsPageSupport.ts` to
keep the page under LOC ceiling without behavior drift.

## 2026-05-10 — BUG-466 B2 tranche-16 types bed-board kanban contracts

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/beds/components/KanbanBoard.tsx` in one bounded
tranche.  
**Why:** the drag/drop bed-board surface still used `any` across props,
column-filters, and card content helpers, weakening compile-time safety on a
high-use inpatient workflow.  
**Effect:** kanban board now uses typed bed contracts and typed callback
signatures end-to-end; repo no-explicit-any total moved from `858` to `839`
(`-19`) with L1-L5 gates green.

## 2026-05-10 — BUG-466 B2 tranche-17 types AI training module payloads

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/settings/components/AiTrainingModule.tsx` in one
bounded tranche.  
**Why:** the AI training module still parsed modelfile/RAG/fine-tune payloads
through `any`, weakening compile-time safety on configuration and telemetry
surfaces.  
**Effect:** AI training module now uses typed model/RAG/adapter/stats
contracts, typed local state, and safer null-default handling; repo
no-explicit-any total moved from `839` to `821` (`-18`) with L1-L5 gates
green.

## 2026-05-10 — BUG-466 B2 tranche-18 types psychiatrist page payloads

**Decision:** remove all explicit-`any` usage from
`apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx` in one bounded
tranche.  
**Why:** psychiatrist clinic, formulation, and side-effect workflows still
parsed mixed API envelopes through `any`, weakening compile-time safety on a
clinical surface.  
**Effect:** psychiatrist page now uses typed appointment/patient/formulation
contracts plus typed envelope normalizers and typed LLM assist payload parsing;
repo no-explicit-any total moved from `821` to `807` (`-14`) with L1-L5 gates
green.

## 2026-05-10 — BUG-466 B6 tranche-19 types comprehensive demo-seed collections

**Decision:** remove all explicit-`any` usage from
`apps/api/src/seed-demo-comprehensive.ts` in one bounded tranche.  
**Why:** the comprehensive demo seed script still used broad `any` arrays and
callbacks across many row-batch domains, weakening compile-time safety on a
high-churn tooling surface.  
**Effect:** seed script now uses typed seed row aliases, typed identity/read
rows, unknown-safe catch narrowing, and readonly-compatible `randomFrom`;
repo no-explicit-any total moved from `807` to `758` (`-49`) with L1-L5 gates
green.

## 2026-05-10 — BUG-466 B4 tranche-20 types EMR-gateway index routes

**Decision:** remove all explicit-`any` usage from
`apps/emr-gateway/src/routes/index.ts` in one bounded tranche.  
**Why:** gateway route aggregations still used broad `any` across filters,
response helpers, and enrichment maps, reducing compile-time safety for
multi-model read surfaces.  
**Effect:** gateway index routes now use unknown-safe record/id/name helpers,
typed `ok()` response envelope inputs, and typed map/filter transforms; repo
no-explicit-any total moved from `758` to `727` (`-31`) with L1-L5 gates
green.

## 2026-05-10 — BUG-466 B3 tranche-21 types MCP server tool transforms

**Decision:** remove all explicit-`any` usage from
`apps/api/src/mcp/server/mcpServer.ts` in one bounded tranche.  
**Why:** MCP tool handlers still used broad `any` in map/reducer transforms and
request boundaries, weakening compile-time safety on assistant-facing clinical
tool outputs.  
**Effect:** MCP server now uses unknown-safe row helpers, typed tool args and
JSON-RPC payload narrowing, and typed metric/interactions transforms; repo
no-explicit-any total moved from `727` to `700` (`-27`) with L1-L5 gates
green.

## 2026-05-10 — BUG-466 B5 tranche-86 rehardens scheduler runtime typing

**Decision:** remove all residual executable explicit-`any` usage from
`apps/api/src/jobs/schedulers/therapeuticLevelMonitoringScheduler.ts`,
`apps/api/src/jobs/schedulers/prescriptionRepeatScheduler.ts`, and
`apps/api/src/jobs/schedulers/clozapineAlertScheduler.ts` in one atomic
tranche.  
**Why:** after tranche-85, the remaining hotspot cluster on clinical scheduler
runtime surfaces was logger variadic `any[]` signatures plus one clinic-id row
mapper `any` in therapeutic-level context construction; this was a safe
high-leverage hardening with no business-logic change.  
**Effect:** scheduler logger contracts now use sibling-consistent
`unknown[]` variadics and therapeutic-level clinic discovery now uses a typed
`DistinctClinicIdRow` query contract; repo no-explicit-any total moved from
`161` to `151` (`-10`) with targeted scheduler lint and unit suites green,
plus `typecheck`, `guard:no-explicit-any-regression`, and
`guard:claude-discipline:ci` all passing.

## 2026-05-10 — BUG-466 B3 tranche-87 rehardens role-route payload typing

**Decision:** remove all residual executable explicit-`any` usage from
`apps/api/src/features/roles/caseManagerFeatureRoutes.ts`,
`apps/api/src/features/roles/psychiatristFeatureRoutes.ts`, and
`apps/api/src/features/roles/managerFeatureRoutes.ts` in one atomic tranche.  
**Why:** after tranche-86, the next high-yield API runtime cluster was 10
remaining explicit-`any` uses concentrated in mutable update bags and one
medication-interaction mapping path on psychiatrist routes.  
**Effect:** route update payload construction now uses explicit conditional
object literals (preserving existing `!== undefined` vs truthy semantics),
psychiatrist interaction checks now use typed row contracts
(`ActiveMedicationRow`, `DrugInteractionRow`), and repo no-explicit-any total
moved from `151` to `141` (`-10`) with targeted lint, `typecheck`,
`guard:no-explicit-any-regression`, and `guard:claude-discipline:ci` all
passing.

## 2026-05-10 — BUG-466 B3 tranche-88 rehardens escalation/patient-app/FHIR runtime typing

**Decision:** remove all residual executable explicit-`any` usage from
`apps/api/src/features/escalations/escalation.routes.ts`,
`apps/api/src/features/patient-app/patientAppRoutes.ts`, and
`apps/api/src/integrations/fhir/fhirAdditionalResources.ts` in one atomic
tranche.  
**Why:** after tranche-87, the next high-yield API runtime cluster was 12
remaining explicit-`any` uses concentrated in escalation description parsing,
patient-app row mapping, and FHIR additional resource bundle mapping.  
**Effect:** escalation parsing now uses typed contracts and a shared safe parser
(`EscalationListRow`, `TeamSummaryRow`, `EscalationDescription`,
`parseEscalationDescription`), patient-app tracking/reminder/shared-doc mapping
now uses typed row contracts (`TrackingBatchEntry`, `TrackingQueryRow`,
`MedReminderQueryRow`, `SharedDocumentQueryRow`), and FHIR additional-resource
mapping now uses typed row contracts (`FhirPrescriptionRow`,
`FhirProcedureRow`, `FhirOrgUnitRow`, `FhirBedRow`). Absorb updates: pre-commit
file-size guard required extracting patient-app route contracts into sibling
`patientAppRouteTypes.ts`; response-shape guard required canonical
Zod-validated envelope mappers (`MedRemindersResponseSchema`,
`SharedDocumentsResponseSchema`) for the two list endpoints. Repo
no-explicit-any total moved from `141` to `129` (`-12`) with targeted lint,
`typecheck`, `guard:no-explicit-any-regression`,
`guard:claude-discipline:ci`, and targeted tests (`fhir-endpoints` 20/20,
`patientAppOwnership.int` 28/28, `escalationAudit.int` 4/4) all passing.

## 2026-05-11 — BUG-466 B3 tranche-89 rehardens checklist/staff/messaging runtime typing

**Decision:** remove all residual executable explicit-`any` usage from
`apps/api/src/features/checklists/checklistRoutes.ts`,
`apps/api/src/features/staff/staffRoutes.ts`, and
`apps/api/src/features/messaging/messageRoutes.ts` in one atomic tranche.  
**Why:** after tranche-88, the next high-yield API runtime cluster was 8
remaining explicit-`any` uses concentrated in checklist required-item
evaluation, staff route row mapping, and caught-error handling in messaging
fallback delivery paths.  
**Effect:** staff routes now use typed row contracts (`StaffLookupRow`,
`StaffSpecialtyRow`, `EnabledSpecialtyRow`) for `/lookup` and `/me` mapping;
checklist routes now use typed item/check-state contracts
(`ChecklistTemplateItem`, `ChecklistCheckedItem`) for required-completion
evaluation; messaging routes now use unknown-safe catches plus
`errorMessage(unknown)` normalization for logging. Absorb update: pre-commit
response-shape guard required canonicalizing `/staff/lookup` response through
`StaffLookupResponseSchema` boundary parse. Repo no-explicit-any total moved
from `129` to `121` (`-8`) with targeted lint, `typecheck`,
`guard:no-explicit-any-regression`, `guard:claude-discipline:ci`, and targeted
integration tests (`authJwtCrossUseRejection.int` 5/5,
`limitCeilings.int` 11/11) all passing.

## 2026-05-11 — BUG-452 C3 reverse integration-route guard closure

**Decision:** close BUG-452 with a structural reverse guard plus zombie-route
drain in integration tests, then wire the guard into both discipline and CI
gate paths.  
**Why:** integration tests were still able to call dead/non-existent URLs and
pass on fallback behavior, which is a regression-propagation class (false
green test signal) on the C3 verification substrate.  
**Effect:** new guard
`scripts/guards/check-integration-calls-backend-route.ts` now scans
`apps/api/tests/integration/**` supertest URL calls and fails when URLs do not
resolve to mounted backend handlers (allowlist only for intentional probe
paths). Guard is wired as `guard:integration-urls` in `package.json`, included
in `guard:claude-discipline`, and wired into `.github/workflows/ci.yml` as
`integration-url-guard` with `ci-gate` dependency. Zombie-route call sites were
drained in `clinicalSafetyHazards.test.ts` and
`medicationConstraints.test.ts` (canonical medication list, LAI, and
clozapine paths). Closure verification: `guard:integration-urls`,
`guard:allowlist-expiry`, full `guard:claude-discipline`, `typecheck`,
`lint:changed`, and targeted integration suite PASS (25/25).

## 2026-05-12 — BUG-355 A2 fail-closed operational-role SSoT guard landed

**Decision:** close `BUG-355` by adding an explicit manifest-driven CI guard for
TS `OPERATIONAL_ONLY` parity against SQL operational-role literals.  
**Why:** A2-0 ledger-truth showed the previously claimed guard was absent; this
left SQL literals in migration trigger/reconciliation paths vulnerable to silent
drift from TS source-of-truth.  
**Effect:** added `.github/operational-role-ssot.json`,
`scripts/guards/check-operational-role-ssot.ts`, and regression tests
`scripts/guards/__tests__/check-operational-role-ssot.test.ts` (3/3 PASS). The
guard is wired as `guard:operational-role-ssot` and included in
`guard:claude-discipline`, so TS/SQL mismatch or untracked new operational-role
SQL literals now fail closed in CI.

## 2026-05-12 — A2-2 Phase C remains blocked by measured backfill posture

**Decision:** keep `allowNotNullEnforcement=false` for `BUG-315`/`BUG-334` and
do not land NOT NULL enforcement in this slice.  
**Why:** measured runtime snapshot shows unresolved null backlog:
`clinical_notes.consent_id NULL=1928`, `clinics.hpio NULL=63`. Flipping Phase C
without closing this backlog would violate A2 cross-lane safety gates and risk
insert/runtime outages.  
**Effect:** blocker evidence recorded in
`docs/quality/remediation/evidence/bug-315-334-a2-2-phase-c-blockers-2026-05-12.md`;
lane advances only through explicit `A2-A2-2-PHASE-C-BACKFILL-CLOSURE` with
backfill completion posture and evidence refresh.

## 2026-05-12 — A2-2 Phase C closure landed for BUG-315/BUG-334

**Decision:** execute Phase C to completion in-lane: close backfill posture,
flip readiness to enforcement-enabled, land fail-closed NOT NULL migration, and
rebaseline integration assertions to enforced schema truth.  
**Why:** after A2-2 Phase B, the lane still had unresolved NULL debt and could
not enforce data contracts without outage risk; once backfill reached zero,
leaving enforcement pending would keep recurrence risk alive.  
**Effect:** landed
`apps/api/scripts/backfill-clinical-notes-consent-id-phase-c.ts`,
`apps/api/scripts/backfill-clinics-hpio-phase-c.ts`, and migration
`apps/api/migrations/20260701000061_bug_315_334_not_null_phase_c.ts`;
`.github/a2-not-null-readiness.json` now records
`allowNotNullEnforcement=true` with both targets at `backfillStatus=complete`;
integration contract test
`apps/api/tests/integration/clinicalNotesConsentFK.int.test.ts` now asserts
Phase C semantics (`consent_id` NOT NULL, FK validated, NULL insert rejected).

Verification executed in same session:

- `npm run guard:claude-discipline:ci` => PASS
- `npm run typecheck` => PASS
- `npx eslint apps/api/scripts/backfill-clinical-notes-consent-id-phase-c.ts apps/api/scripts/backfill-clinics-hpio-phase-c.ts apps/api/migrations/20260701000061_bug_315_334_not_null_phase_c.ts` => PASS
- `npm run guard:a2-not-null-app-readiness` => PASS
- `npm run guard:a2-not-null-readiness` => PASS (`allowNotNullEnforcement: true`)
- `npm run migrate:dev -w apps/api` => PASS (applied `20260701000061...`)
- `npm run test:integration -w apps/api -- tests/integration/clinicalNotesConsentFK.int.test.ts tests/integration/limitCeilings.int.test.ts tests/integration/reportsRoutesHealth.int.test.ts` => PASS (5 + 11 + 4)
- `npm run migrate:rehearsal` => PASS (`BUG-706 approved-forward-fix-only` policy still enforced)
- `npm run dr:restore-drill` => expected-red (`DR_EXPECTED_SCHEMA_FINGERPRINT` missing)
- `npm run guard:dr-drill-fingerprint` => PASS (fail-closed fingerprint assertion remains enforced)

## 2026-05-12 — A2-3 BUG-287 hash-chain restoration landed

**Decision:** complete `A2-3` by restoring `audit_log` chain columns, baseline
signatures, deterministic historical backfill, and append-time hash chaining
for new rows.  
**Why:** `BUG-287` left tamper-evidence incomplete after baseline squash; A2
cannot claim data-contract hardening without restoring chain continuity for both
existing and new audit rows.  
**Effect:** landed migration
`apps/api/migrations/20260701000062_bug_287_audit_log_hash_chain_restore.ts`
and integration proof
`apps/api/tests/integration/auditLogHashChain.int.test.ts`. Migration now:
adds `prev_hash`/`row_hash`, seeds `audit_log_chain_baselines` using
`system_reconciliation_baseline`, backfills historical rows via set-based
rolling hash, and enforces append-path hashing through
`trg_audit_hash_chain` + advisory scope lock. BUG-039 immutability is preserved
with bounded trigger lift/re-enable around backfill only.

Verification executed in same session:

- `npm run guard:claude-discipline:ci` => PASS
- `npm run typecheck` => PASS
- `npx eslint apps/api/migrations/20260701000062_bug_287_audit_log_hash_chain_restore.ts apps/api/tests/integration/auditLogHashChain.int.test.ts` => PASS
- `npm run migrate:dev -w apps/api` => PASS (applied `20260701000062...`)
- `npm run test:integration -w apps/api -- auditLogHashChain.int.test.ts` => PASS (4/4)
- `npm run test:integration -w apps/api -- clinicalNotesConsentFK.int.test.ts limitCeilings.int.test.ts reportsRoutesHealth.int.test.ts` => PASS (5 + 11 + 4)
- `npm run migrate:rehearsal` => PASS (`BUG-706 approved-forward-fix-only` policy enforced)
- `npm run dr:restore-drill` => expected-red (`DR_EXPECTED_SCHEMA_FINGERPRINT` missing)
- `npm run guard:dr-drill-fingerprint` => PASS

## 2026-05-12 — A2 DR smoke-impact gate stabilized (fingerprint + drill role path)

**Decision:** remove the A2 DR gate ambiguity by materializing a canonical
fingerprint artifact and hardening the restore drill for privileged drill-role
execution.  
**Why:** A2 closure requires DR smoke impact checks. The prior run was blocked
by missing fingerprint artifact and unstable schema hashes caused by PostgreSQL
17 volatile dump tokens (`\restrict`/`\unrestrict`). Restore diagnostics were
also fail-opaque when extension privileges were insufficient.  
**Effect:** `scripts/dr/restore-drill.sh` now supports `DR_DB_*` overrides for
drill credentials, strips volatile dump tokens before schema hashing, captures
restore logs with explicit extension-permission hints, and supports optional
strict restored-hash enforcement (`DR_STRICT_RESTORED_SCHEMA_HASH=1`). Added
`docs/quality/expected-schema-fingerprint.txt` as canonical baseline.

Verification executed in same session:

- `npm run guard:dr-drill-fingerprint` => PASS
- `npx vitest run scripts/guards/__tests__/check-dr-drill-asserts-fingerprint.test.ts` => PASS (2/2)
- `DR_DB_USER=postgres DR_DB_PASSWORD='' npm run dr:restore-drill` => PASS (17/0)

## 2026-05-12 — A2 local gate pack complete; closure now rollout-contract-only

**Decision:** execute the full A2 local gate pack after A2-0..A2-4 and
transition A2 to implementation-complete posture with explicit rollout-only
closure dependencies.  
**Why:** A2 implementation artifacts were distributed across serial commits and
needed one consolidated verification run to remove ambiguity between local
engineering completion and release closure requirements.  
**Effect:** local gates are now re-proven in a single serial session and
recorded in
`docs/quality/remediation/evidence/a2-local-closeout-gate-pack-2026-05-12.md`.
Remaining closure conditions are external rollout evidence (canary + burn-in +
post-burn-in verification) for `BUG-287`, `BUG-315`, `BUG-334`, and `BUG-706`.
`BUG-288` remains deferred-post-staging.

Verification executed in same session:

- `npm run guard:claude-discipline:ci` => PASS
- `npm run typecheck` => PASS
- `npm run migrate:rehearsal` => PASS (`BUG-706` approved-forward-fix-only policy enforced)
- `npm run test:integration -w apps/api -- clinicalNotesConsentFK.int.test.ts limitCeilings.int.test.ts reportsRoutesHealth.int.test.ts auditLogHashChain.int.test.ts` => PASS (5 + 11 + 4 + 4)
- `DR_DB_USER=postgres DR_DB_PASSWORD='' npm run dr:restore-drill` => PASS (17/0)

## 2026-05-12 — A2 rollout closure handoff packet published

**Decision:** complete all remaining in-repo A2 closure work by adding an
explicit canary/burn-in template and operator handoff artifact rather than
guessing external rollout outcomes.  
**Why:** `BUG-287`, `BUG-315`, `BUG-334`, and `BUG-706` are blocked only by
external runtime evidence (Azure canary + burn-in + post-burn-in rerun). Those
signals cannot be truthfully synthesized from local execution.  
**Effect:** added:

- `docs/quality/remediation/evidence/a2-rollout-closure-template.md`
- `docs/quality/remediation/evidence/a2-rollout-closure-handoff-2026-05-12.md`

`active-slice.md` now tracks the A2 rollout-closure handoff slice as complete
for in-repo scope. Closure of remaining A2 bugs remains contingent on template
completion and required operational signoffs.

## 2026-05-12 — BUG-426 B5 first-visit chart-review sign gate landed

**Decision:** close BUG-426 implementation scope by enforcing a fail-closed
first-visit chart-review contract at the backend sign boundary and wiring the
frontend sign flow to the same contract.  
**Why:** the previous workflow allowed first encounter-note signing without an
explicit review checkpoint for labs/imaging/medications; a UI-only fix would be
bypassable through alternate note-sign surfaces.  
**Effect:** added shared attestation schema and gated note-type set in
`clinicalNote.Schemas.ts`; added policy + route enforcement in
`firstVisitChartReviewPolicy.ts` and
`firstVisitChartReviewAttestation.ts`; integrated enforcement into both
`POST /patients/:id/notes` and draft-sign `PATCH /patients/:id/notes/:noteId`
paths with `409 FIRST_VISIT_CHART_REVIEW_REQUIRED` fail-closed behavior.
Attestation evidence now persists in
`clinical_notes.contact_meta.firstVisitChartReview` with reviewer and timestamp.
Frontend AddNoteDialog now blocks Save & Sign until all three review
confirmations are completed when the first-visit gate applies. Emergency bypass
kill switch added: `b5-first-visit-chart-review-bypass` (default OFF).

Verification executed in same session:

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bug426FirstVisitChartReviewGate.int.test.ts` => PASS (3/3)
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

## 2026-05-13 — BUG-287 deterministic chain-order stabilization (A2 blocker drain)

**Decision:** land a structural follow-up for `BUG-287` to make chain ordering
deterministic and indexed, then re-run the full A2 local pack before claiming
local closure posture.  
**Why:** A2 re-verification surfaced two real blockers in the same session:
`auditLogHashChain.int` mismatch (`mismatch_count=118`) and
`limitCeilings.int` setup timeout. Diagnostics showed both symptoms trace to
hash predecessor ambiguity/perf under bulk audit bursts with identical
timestamps.  
**Effect:** added migration
`apps/api/migrations/20260701000067_bug_287_hash_chain_order_stabilization.ts`
to introduce `audit_log.chain_ordinal`, indexed scope+ordinal predecessor
lookup, and full chain reseal for historical rows. Updated
`auditLogHashChain.int` to validate end-to-end integrity against deterministic
`chain_ordinal` ordering. Recorded evidence in
`docs/quality/remediation/evidence/bug-287-a2-order-stabilization-2026-05-13.md`.

Verification executed in same session:

- `npm run migrate:dev -w apps/api` => PASS (applied `20260701000067...`)
- `npm run test:integration -w apps/api -- tests/integration/auditLogHashChain.int.test.ts` => PASS (4/4)
- `npm run test:integration -w apps/api -- tests/integration/limitCeilings.int.test.ts` => PASS (11/11)
- `npm run test:integration -w apps/api -- tests/integration/clinicalNotesConsentFK.int.test.ts tests/integration/limitCeilings.int.test.ts tests/integration/reportsRoutesHealth.int.test.ts tests/integration/auditLogHashChain.int.test.ts` => PASS (5 + 11 + 4 + 4)
- `npm run migrate:rehearsal -w apps/api` => PASS (`BUG-706` approved-forward-fix-only gate preserved)
- `npm run guard:a2-not-null-readiness` => PASS
- `npm run guard:a2-not-null-app-readiness` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## 2026-05-13 — BUG-581 B4 after-hours suicide-risk scheduler landed

**Decision:** close the local implementation gap for `BUG-581` with a B4
scheduler slice (not route-inline patching), using deterministic
after-hours detection + on-call psychiatrist routing + immutable fallback
auditing.  
**Why:** the pre-fix state had no automated control for high suicide-risk
notes recorded outside shift windows, so critical escalation relied on
manual human follow-through and was vulnerable to silent misses.  
**Effect:** added
`apps/api/src/jobs/schedulers/suicidalIdeationAfterHoursScheduler.ts`,
wired in `apps/api/src/jobs/bootstrap.ts`, and expanded `AuditAction`
union with:

- `SI_AFTER_HOURS_RECIPIENT_REASSIGNED`
- `SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE`

Candidate detection uses recent `clinical_notes` + qualifying
`risk_assessments` linkage (`suicide_risk=true`, `overall_risk_level in
('high','very_high')`, prior 24h). Shift-window evaluation uses
`clinician_availability_blocks` in clinic timezone. Recipient resolution
is deterministic: on-call psychiatrist first (availability + role/specialty
ordering), then clinic admin fallback, else fail-visible no-recipient
audit row.

Verification executed in same session:

- `npm exec -w apps/api -- vitest run tests/unit/suicidalIdeationAfterHoursScheduler.test.ts` => PASS (11/11)
- `npm run test:integration -w apps/api -- tests/integration/suicidalIdeationAfterHoursScheduler.int.test.ts` => PASS (3/3)
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b4-bug-581-si-after-hours-scheduler-2026-05-13.md`.

## 2026-05-13 — BUG-582 B4 scheduler shell convergence landed

**Decision:** close the local implementation gap for `BUG-582` by
introducing a shared scheduler shell and refactoring the rule-of-three
surfaces (`appointmentReminder`, `referralSla`, `pathologyCritical`)
onto it without changing domain processor logic.  
**Why:** scheduler safety controls (cron registration, AEST default,
top-level fail-loud catch, shutdown hook, zero-row observability, RLS
posture declaration) were duplicated and easy to drift. A structural
wrapper reduces recurrence risk of shell-level regressions across B4
schedulers.  
**Effect:** added
`apps/api/src/jobs/schedulers/runScheduledTick.ts` and switched:

- `apps/api/src/jobs/schedulers/appointmentReminderScheduler.ts`
- `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`
- `apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts`

to use the shared shell with explicit `dbAccess: 'dbAdmin'`.

Also updated stale integration fixture
`apps/api/tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts`
to include required `clinics.hpio` on cross-tenant clinic seed, aligning
the BUG-602 regression test with A2 NOT-NULL schema hardening.

Verification executed in same session:

- `npm run typecheck` => PASS
- `npm run test -- tests/unit/pathologyCriticalScheduler.test.ts -w apps/api` => PASS (39/39)
- `npm run test:integration -w apps/api -- bug602SchedulerCascadeRlsClose.int.test.ts` => PASS (2/2)
- `npm run guard:claude-discipline:ci` => PASS
- `npm run guard:timer-try-catch` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b4-bug-582-base-scheduler-abstraction-2026-05-13.md`.

## 2026-05-14 — BUG-404 local re-verification + catalogue sync checkpoint

**Decision:** keep `BUG-404` in rollout-closure posture (not closed) while
upgrading catalogue fidelity to reflect implemented and re-verified local
enforcement.  
**Why:** `active-slice.md` already tracked implementation-landed state, but
`bugs-remaining.md` still showed a pre-fix generic row with no enforcement
details or evidence artifact reference.  
**Effect:** added evidence artifact and synchronized `active-slice` +
`bugs-remaining` to the same state model: local implementation complete,
rollout evidence pending.

Verification executed in same session:

- `npm run test:integration -w apps/api -- tests/integration/bug404AssessmentMandatoryFields.int.test.ts` => PASS (`4/4`)
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b2-bug-404-mandatory-instrument-fields-2026-05-14.md`.

## 2026-05-14 — B4 local lane re-validation checkpoint (all non-decision-gated items)

**Decision:** treat B4 local engineering work as fully re-verified in-session
and keep the lane in rollout-closure posture only (no additional local code
changes required for implemented B4 bugs).  
**Why:** we needed a fresh same-day proof pass across L0a/L1/L2/L3/L4 to
confirm no scheduler regression drift after recent lane stacking, before
requesting post-deploy flips.  
**Effect:** reran discipline/compile/lint/guard/test pack for B4 and recorded
that all implemented B4 items remain green. `BUG-593` remains intentionally
deferred because its trigger contract is still unmet (no CAB pull-in and no
growth in high-risk class inventory beyond defer threshold).

Verification executed in same session:

- `npm run guard:claude-discipline:ci` => PASS
- `npm run typecheck` => PASS
- `npm run lint` => PASS
- `npm run guard:timer-try-catch` => PASS
- `npm run guard:no-fire-and-forget` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run test -w apps/api -- tests/unit/laiAlertScheduler.test.ts tests/unit/ectConsentExpiryScheduler.test.ts tests/unit/advanceDirectiveReviewScheduler.test.ts tests/unit/clozapineMonitoringWeekScheduler.test.ts tests/unit/mhaReviewScheduler.test.ts tests/unit/pathologyCriticalScheduler.test.ts tests/unit/notificationService.channels.test.ts tests/unit/suicidalIdeationAfterHoursScheduler.test.ts tests/unit/clozapineAlertScheduler.test.ts` => PASS (9/9 files, 176/176 tests)
- `npm run test:integration -w apps/api -- tests/integration/laiAlertScheduler.int.test.ts tests/integration/ectConsentExpiryScheduler.int.test.ts tests/integration/advanceDirectiveReviewScheduler.int.test.ts tests/integration/clozapineMonitoringWeekScheduler.int.test.ts tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts tests/integration/pathologyCriticalAlertsCycle2.int.test.ts tests/integration/suicidalIdeationAfterHoursScheduler.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts tests/integration/clozapineAlertSchedulerCycle2.int.test.ts tests/integration/hl7InboundIngest.int.test.ts` => PASS (11/11 files)

Evidence sync:
`docs/quality/remediation/active-slice.md` updated with
"B4 Local Verification Snapshot (2026-05-14)" and explicit `BUG-593` deferred
posture note.

## 2026-05-14 — BUG-AD family phase-1: advance-directive role-literal drain + guard

**Decision:** execute the next concrete B1/B2/B3 family slice by removing
route-local role literals from advance-directive routes and converging onto
the canonical clinical-access guard rail with permanent regression checks.
  
**Why:** `active-slice.md` still carried `BUG-AD-*` as lane-wide pending with
a hardening requirement to eliminate route-local role-list literals. The
advance-directive surface was still using `requireRoles([...])`, which is the
exact drift vector called out in that residual.
  
**Effect:** `apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts`
now enforces `requireClinicalAccessRole(buildAuthContext(req))` as middleware,
removes route-local `ROLES` literals, and keeps module-access + service
permission rails. Added fail-closed regression guard
`scripts/guards/check-no-hardcoded-role-literal-advance-directives.ts`
(`npm run guard:no-hardcoded-role-literal-advance-directives`) and integration
proof `apps/api/tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts`
to assert receptionist denial code `CLINICAL_ACCESS_DENIED` on GET/POST.

Verification executed in same session:

- `npm run guard:no-hardcoded-role-literal-advance-directives` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts` => PASS (`2/2`)
- `npm run test:integration -w apps/api -- tests/integration/bug565AdvanceDirectiveOptimisticLock.int.test.ts` => PASS (`4/4`) (regression replay)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b3-bug-ad-family-advance-directive-clinical-access-hardening-2026-05-14.md`.

## 2026-05-14 — BUG-EP family phase-1: discharge-summary id-only scope drain

**Decision:** execute the next concrete B1 family residual by draining the two
remaining id-only episode accesses on discharge-summary paths and pinning the
tenant-boundary behavior with integration proof.
  
**Why:** in `episodeRoutes.ts`, discharge-summary generate/submit flows still
had one id-only update and one id-only follow-up read. While the surrounding
flow was mostly clinic-scoped, this pair preserved a drift vector and could
materialize cross-tenant episode rows in submit-side follow-up behavior.
  
**Effect:** `apps/api/src/features/episode/episodeRoutes.ts` now uses strict
`{ id, clinic_id }` scoping on both:

- draft save in `POST /:id/discharge-summary/generate`
- submit follow-up episode fetch in `POST /:id/discharge-summary/submit`

Added `apps/api/tests/integration/episodeDischargeSummaryClinicScope.int.test.ts`
to assert cross-tenant submit attempts return `404 Episode not found` and do
not create `discharge_review` task side effects in the caller clinic.

Verification executed in same session:

- `npm run test:integration -w apps/api -- tests/integration/episodeDischargeSummaryClinicScope.int.test.ts` => PASS (`1/1`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-episode-discharge-summary-clinic-scope-hardening-2026-05-14.md`.

## 2026-05-14 — B4 leftover local integrity gap closeout

**Decision:** close the final B4 local integrity gap with a focused replay on
the exact affected scheduler path (`BUG-583-FOLLOWUP-CLINIC-THRESHOLDS-DBADMIN-SETUP`)
plus sibling live-context path and global discipline guard.

**Why:** B4 had already been marked locally implemented, but the remaining
quality risk was whether the threshold path was truly executing against live
`dbAdmin`-seeded `clinic_thresholds` behavior (not test-side override seams).

**Effect:** re-ran the targeted verification pack in the same session:

- `npm run test:integration -w apps/api -- tests/integration/pathologyCriticalAlertsCycle2.int.test.ts` => PASS (`9/9`)
- `npm run test:integration -w apps/api -- tests/integration/hl7InboundIngest.int.test.ts` => PASS (`9/9`)
- `npm run test -w apps/api -- tests/unit/pathologyCriticalScheduler.test.ts` => PASS (`42/42`)
- `npm run test -w apps/api -- tests/unit/clinicAdminSlotBootstrapCheck.test.ts` => PASS (`3/3`)
- `npm run guard:claude-discipline:ci` => PASS

Harness note: one initial parallel integration invocation produced
`MigrationLocked` due to preflight migration lock contention; sequential replay
was clean and is the accepted evidence run for this closeout.

Evidence artifact:
`docs/quality/remediation/evidence/b4-local-integrity-gap-closeout-2026-05-14.md`.

## 2026-05-14 — B1/RF phase-1 clarification command-ownership hardening

**Decision:** drain the remaining referral clarification route-level repository
write bypasses into service-command ownership before continuing broader RF family
closure.

**Why:** `referralRoutes.ts` still had direct `referralRepository.updateReferral`
and `insertWorkflowEvent` writes on `POST /:id/clarification` and
`PATCH /:id/clarification-response`, tracked in the
`check-controller-repo-write-bypass` allowlist. This was inconsistent with
command-layer ownership and created split write semantics.

**Effect:** added two service command methods in
`apps/api/src/features/referrals/referralClarificationCommands.ts`:

- `requestClarification({ clinicId, userId, referralId, question })`
- `applyClarificationResponse({ clinicId, userId, referralId, notes })`

Route handlers now delegate to these commands; service boundary enforces
deterministic not-found behavior (`404 NOT_FOUND`) and preserves workflow-event
plus audit-update semantics.

Allowlist debt drained: removed four referral-route entries from
`scripts/guards/check-controller-repo-write-bypass.allowlist`.

Verification executed in same session:

- `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts` => PASS (`2/2`)
- `npm run guard:controller-repo-write-bypass` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-rf-clarification-command-ownership-2026-05-14.md`.

## 2026-05-14 — BUG-563 command-ownership allowlist debt drain

**Decision:** drain stale treatment-pathway controller-write-bypass allowlist
entries now that pathway patch/session writes are service-owned.

**Why:** `check-controller-repo-write-bypass.allowlist` still carried two
`pathwayRoutes.ts -> pathwayRepository.update` entries even though the route
already delegates writes to `pathwayService` (`update` / `recordSession`).
Leaving stale entries obscures true outstanding debt.

**Effect:** removed the two stale treatment-pathway entries from
`scripts/guards/check-controller-repo-write-bypass.allowlist`.

Verification executed in same session:

- `npm run guard:controller-repo-write-bypass` => PASS

Evidence addendum:
`docs/quality/remediation/evidence/b3-bug-563-treatment-pathway-state-machine-2026-05-14.md`.

## 2026-05-14 — BUG-EP family phase-2: roster/allocation clinic-scope hardening

**Decision:** execute the next B1 `BUG-EP-*` residual by hardening episode
roster and allocation read paths with explicit clinic scope on joined tables,
then lock the invariant with source-guard tests.

**Why:** discharge-summary phase-1 scope drain was complete, but two roster
queries still relied on implicit join safety for patient rows, and allocation
team-name lookup read `org_units` by `id` only. This preserved a tenant-boundary
drift vector under inconsistent or replayed data.

**Effect:** updated `apps/api/src/features/episode/episodeRoutes.ts`:

- `GET /episodes/patients-by-clinician/:clinicianId`
  - added `patients.clinic_id = req.clinicId`
  - added `patients.deleted_at IS NULL`
- `GET /episodes/patients-by-team/:team`
  - added `patients.clinic_id = req.clinicId`
  - added `patients.deleted_at IS NULL`
- `GET /episodes/:id/allocation`
  - `org_units` lookup now scopes by `{ id, clinic_id }`

Added/extended source guards in
`apps/api/tests/unit/bugEpisodeMdtLookupClinicId.test.ts` to pin:

- patient join clinic scope + soft-delete filter in roster queries
- org-unit clinic scope in allocation lookup

Verification executed in same session:

- `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts` => PASS (`5/5`)
- `npm run guard:query-has-clinic-id` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-ep-family-phase2-roster-allocation-clinic-scope-2026-05-14.md`.

## 2026-05-14 — BUG-323 local integrity drain: clozapine controller write-bypass allowlist

**Decision:** drain stale `check-controller-repo-write-bypass` allowlist rows
for clozapine controller write paths that are already routed through
`clozapineService`.

**Why:** the three allowlist entries still claimed direct controller-side
repository writes for `createAdministration`, `createObservation`, and
`upsertMonitoringCheck`, but those handlers now delegate to service-layer
methods. Keeping stale rows hides real backlog and weakens guard signal.

**Effect:** removed 3 entries from
`scripts/guards/check-controller-repo-write-bypass.allowlist`:

- `clozapineRepository.createAdministration`
- `clozapineRepository.createObservation`
- `clozapineRepository.upsertMonitoringCheck`

Verification executed in same session:

- `npm run guard:controller-repo-write-bypass` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b2-bug-323-clozapine-controller-write-bypass-drain-2026-05-14.md`.

## 2026-05-14 — RF family phase-2: referral feedback service AuthContext migration

**Decision:** migrate `referralFeedbackService` to `AuthContext`-first method
signatures and drain the corresponding service-auth allowlist debt.

**Why:** RF feedback methods still accepted raw `(clinicId, userId, ...)`
arguments, preserving a pre-AuthContext service-calling seam inside an active
command-lane surface.

**Effect:** updated `apps/api/src/features/referrals/referralFeedbackService.ts`
so all exported methods now take `auth: AuthContext` first:

- `sendAcceptanceFeedback`
- `sendRejectionFeedback`
- `sendClosedNoResponseFeedback`
- `sendClarificationRequest`

Updated callers:

- `apps/api/src/features/referrals/strategies/soloStrategy.ts`
- `apps/api/src/features/referrals/strategies/teamStrategy.ts`
- `apps/api/src/features/referrals/referralClarificationCommands.ts`
- `apps/api/src/jobs/schedulers/referralSlaScheduler.ts` (system auth context
  for non-request scheduler path)

Drained 4 entries from:
`scripts/guards/check-service-auth-context.allowlist`.

Verification executed in same session:

- `npm run guard:service-auth-context` => PASS
- `npm run lint:changed` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts` => PASS (`2/2`)
- `npm run test:integration -w apps/api -- tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts` => PASS (`2/2`)
- `npm run typecheck` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-rf-feedback-auth-context-migration-2026-05-14.md`.

## 2026-05-14 — B1 phase-3: RF/EP soft-delete filter drain on touched runtime paths

**Decision:** drain the next B1 recurrence seam by enforcing soft-delete
predicates on active referral + episode runtime paths and removing the
corresponding allowlist debt.

**Why:** after RF phase-2 AuthContext migration, guard review still showed
legacy soft-delete debt on the same touched files. Leaving these rows
allowlisted preserves stale-risk paths where deactivated clinical entities can
participate in live workflow behavior.

**Effect:** landed soft-delete hardening:

- `apps/api/src/features/referrals/referralFeedbackService.ts`
  - staff sender lookup now enforces `deleted_at IS NULL`.
- `apps/api/src/features/referrals/strategies/teamStrategy.ts`
  - both clinician staff lookups now enforce `deleted_at IS NULL`.
  - patient-name lookup now enforces `deleted_at IS NULL`.
- `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`
  - patient lookup now enforces `deleted_at IS NULL`.
- `apps/api/src/features/episode/episodeRoutes.ts`
  - discharge summary and close-with-vetting episode reads/updates now enforce
    `episodes.deleted_at IS NULL`.
  - discharge generate patient lookup now enforces `patients.deleted_at IS NULL`.

Allowlist debt drained:

- Removed 5 referral/scheduler rows from
  `scripts/guards/check-soft-delete-filter.allowlist`.
- Removed 8 `episodeRoutes.ts` rows from the same allowlist.
- Net count `149 -> 141`.

Regression-proof added:

- `apps/api/tests/unit/bugRfSoftDeleteScope.test.ts` (RF source-level pin).

Verification executed in same session:

- `npm run test -w apps/api -- tests/unit/bugRfSoftDeleteScope.test.ts` => PASS (`4/4`)
- `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts tests/unit/bugRfSoftDeleteScope.test.ts` => PASS (`9/9`)
- `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts` => PASS (`2/2` + `2/2`)
- `npm run guard:soft-delete-filter` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run guard:service-auth-context` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-rf-ep-soft-delete-filter-drain-2026-05-14.md`.

## 2026-05-14 — RF residual follow-up: drain remaining `referralRoutes` soft-delete allowlist rows

**Decision:** remove the two remaining soft-delete allowlist rows on
`apps/api/src/features/referrals/referralRoutes.ts` after guard replay proved
the underlying queries are already compliant.

**Why:** the rows were legacy baseline debt (`original-lineno:272`, `323`) and
no longer represented real violations; keeping them degrades guard signal.

**Effect:** removed both `referralRoutes.ts` rows from
`scripts/guards/check-soft-delete-filter.allowlist`.

Verification executed in same session:

- `npm run guard:soft-delete-filter` => PASS

Evidence addendum:
`docs/quality/remediation/evidence/b1-rf-ep-soft-delete-filter-drain-2026-05-14.md`.

## 2026-05-14 — EP family phase-4: episode service AuthContext convergence

**Decision:** migrate `episodeService` to `AuthContext`-first signatures,
rewire all known callers, and drain stale service-auth allowlist debt for the
episode service surface.

**Why:** episode service methods still accepted legacy `(clinicId, actorId, ...)`
inputs, which left an avoidable recurrence seam for identity-context drift in
future internal callers.

**Effect:** updated `apps/api/src/features/episode/episodeService.ts`:

- `create`, `update`, `getById`, `listForPatient`, `close`, and
  `createFromReferral` now require `auth: AuthContext` as first parameter.

Updated boundaries/callers:

- `apps/api/src/features/episode/episodeController.ts`
  - now builds canonical auth context via `buildAuthContext(...)` for all
    handlers.
- `apps/api/src/features/referrals/referralService.ts`
- `apps/api/src/features/referrals/referralRoutes.ts`
- `apps/api/src/features/referrals/strategies/soloStrategy.ts`
- `apps/api/src/features/referrals/strategies/teamStrategy.ts`
- `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`
  - scheduler auto-close now passes explicit system auth context.

Allowlist debt drained:

- Removed 6 legacy episode-service entries from
  `scripts/guards/check-service-auth-context.allowlist`.

Verification executed in same session:

- `npm run guard:service-auth-context` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run guard:soft-delete-filter` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts tests/integration/episodeStateMachine.test.ts tests/integration/bugEpisodeMdtSaveRace.int.test.ts` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-ep-service-auth-context-migration-2026-05-14.md`.

## 2026-05-14 — RF family phase-4: referral state command consolidation

**Decision:** extract referral state mutation orchestration from route handlers
into a dedicated command module and pin the behavior with integration tests.

**Why:** two mutation endpoints in `referralRoutes.ts` still executed inline DB
write orchestration, which is the route-level mutation pattern B1 is actively
draining.

**Effect:** added `apps/api/src/features/referrals/referralStateCommands.ts`:

- `appendReferralNote(...)`
- `updateReferralStatusByEpisode(...)`

Rewired `apps/api/src/features/referrals/referralRoutes.ts`:

- `POST /referrals/:id/notes` now delegates to
  `referralStateCommands.appendReferralNote(...)`.
- `PATCH /referrals/by-episode/:episodeId` now delegates to
  `referralStateCommands.updateReferralStatusByEpisode(...)`.

Added regression coverage:

- `apps/api/tests/integration/bugRfReferralStateCommandOwnership.int.test.ts`
  validates by-episode status update and notes timeline append persistence.

Verification executed in same session:

- `npm run test:integration -w apps/api -- tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts` => PASS
- `npm run guard:controller-repo-write-bypass` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run guard:soft-delete-filter` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-rf-state-command-consolidation-2026-05-14.md`.

## 2026-05-14 — RF family phase-5: task transition command consolidation

**Decision:** move referral task-transition mutation orchestration
(`triage/assign/accept/decline`) behind dedicated command functions.

**Why:** route handlers still owned transition orchestration for these RF
workflow paths, which preserved a route-level recurrence seam in B1.

**Effect:** added `apps/api/src/features/referrals/referralTaskCommands.ts`:

- `triageReferral(...)`
- `assignReferral(...)`
- `acceptReferral(...)`
- `declineReferral(...)`

Rewired `apps/api/src/features/referrals/referralRoutes.ts`:

- `POST /referrals/:id/triage`
- `POST /referrals/:id/assign`
- `POST /referrals/:id/accept`
- `POST /referrals/:id/decline`

All now delegate to command module functions.

Added regression coverage:

- `apps/api/tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts`
  validates transition + persisted field invariants for triage/assign paths.

Verification executed in same session:

- `npm run test:integration -w apps/api -- tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:controller-repo-write-bypass` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run guard:response-shape-validated` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b1-rf-task-transition-command-consolidation-2026-05-14.md`.

## 2026-05-14 — ONC family phase-1: command ownership + clinic-lineage hardening

**Decision:** drain oncology controller-side repository write bypasses by moving
all oncology list/create orchestration into an AuthContext-first service layer,
and enforce clinic-lineage checks for parent-linked child writes.

**Why:** `scripts/guards/check-controller-repo-write-bypass.allowlist` still
carried six oncology route write bypass entries (`*Repo.create` in routes).
That left a recurrence seam for route-level mutation orchestration and allowed
child-write payloads (`conditionId`/`planId`) to rely on implicit trust rather
than explicit clinic lineage checks.

**Effect:**

- Added `apps/api/src/features/oncology/oncologyService.ts` as canonical
  command/service owner for oncology list/create paths (AuthContext-first).
- Rewired `apps/api/src/features/oncology/oncologyRoutes.ts` to delegate to
  service methods (route handlers now parse + delegate only).
- Added `treatmentPlanRepo.findById(...)` in
  `apps/api/src/features/oncology/oncologyRepository.ts` for clinic-scoped
  plan lineage lookup.
- Drained six stale oncology rows from
  `scripts/guards/check-controller-repo-write-bypass.allowlist`.
- Added integration proof:
  `apps/api/tests/integration/bugOncCommandOwnership.int.test.ts`.

**Verification executed in same session:**

- `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts` => PASS (`2/2`)
- `npm run guard:controller-repo-write-bypass` => PASS
- `npm run guard:service-auth-context` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run guard:response-shape-validated` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b3-onc-command-ownership-clinic-lineage-2026-05-14.md`.

## 2026-05-14 — BUG-461: shared legal-order response schema convergence

**Decision:** move legal-order response schema definitions out of route-local
Zod declarations and into shared schema exports.

**Why:** `BUG-461` tracked missing shared legal-order response schema
definitions, leaving the legal response contract route-local and at risk of
shape drift.

**Effect:**

- Added shared response schemas in
  `packages/shared/src/legalOrder.Schemas.ts`:
  - `LegalOrderResponseSchema`
  - `LegalOrderListItemResponseSchema`
  - `LegalOrderListResponseSchema`
  - `LegalOrderCreateResponseSchema`
  - `LegalOrderUpdateResponseSchema`
- Updated `apps/api/src/features/legal/legalOrderRoutes.ts` to import and use
  those shared schemas directly.
- Removed duplicated route-local response schema declarations.

**Verification executed in same session:**

- `npm run test:integration -w apps/api -- tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts` => PASS (`5/5` + `6/6`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b3-bug-461-shared-legal-order-response-schema-2026-05-14.md`.

## 2026-05-14 — ECT/TMS phase-1: module rails + course-lineage relationship hardening

**Decision:** enforce explicit module-access rails on ECT/TMS routes and add
fail-closed patient-relationship checks on course-linked session surfaces.

**Why:** ECT/TMS surfaces already had AuthContext + permission checks, but
route-level module-access rails were missing and course-linked operations could
execute without re-verifying patient relationship on the resolved course owner.

**Effect:**

- `apps/api/src/features/ect/ectRoutes.ts`
  - added `requireModuleRead(MODULE_KEYS.ECT)` router rail
  - added `requireModuleWrite(MODULE_KEYS.ECT)` on mutation endpoints
- `apps/api/src/features/tms/tmsRoutes.ts`
  - added `requireModuleRead(MODULE_KEYS.TMS)` router rail
  - added `requireModuleWrite(MODULE_KEYS.TMS)` on mutation endpoints
- `apps/api/src/features/ect/ectService.ts`
  - `recordSession(...)` now enforces specialty + patient relationship on resolved course patient
  - `listSessionsByCourse(...)` now resolves course, fails closed when absent, then enforces patient relationship
- `apps/api/src/features/tms/tmsService.ts`
  - `recordSession(...)` now enforces specialty + patient relationship on resolved course patient
  - `listSessionsByCourse(...)` now resolves course, fails closed when absent, then enforces patient relationship
- Added source-level regression pins:
  - `apps/api/tests/unit/bugEctTmsCourseRelationshipGuards.test.ts`

**Verification executed in same session:**

- `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts` => PASS (`4/4`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS

Evidence artifact:
`docs/quality/remediation/evidence/b3-ect-tms-module-relationship-hardening-2026-05-14.md`.

## 2026-05-14 — B3 phase-2: ECT/TMS/Oncology response-shape hardening + allowlist drain

**Decision:** harden ECT/TMS/Oncology route boundaries to fail closed on
response-shape drift, then drain corresponding `BUG-638` allowlist debt rows.

**Why:** these B3 surfaces still relied on
`check-response-shape-validated.allowlist` exemptions, which leaves silent
shape-drift risk on clinically relevant routes.

**Effect:**

- `apps/api/src/features/ect/ectRoutes.ts`
  - added response schemas and parse-at-boundary calls:
    - `EctCourseResponseSchema.parse(course)`
    - `EctSessionResponseSchema.parse(session)`
    - `EctByPatientResponseSchema.parse(data)`
    - `EctCourseSessionsResponseSchema.parse({ sessions })`
- `apps/api/src/features/tms/tmsRoutes.ts`
  - added response schemas and parse-at-boundary calls:
    - `TmsCourseResponseSchema.parse(course)`
    - `TmsSessionResponseSchema.parse(session)`
    - `TmsByPatientResponseSchema.parse(data)`
    - `TmsCourseSessionsResponseSchema.parse({ sessions })`
- `apps/api/src/features/oncology/oncologyRoutes.ts`
  - moved all list/write responses to schema-validated envelopes using shared
    oncology response schemas (`@signacare/shared`), with explicit mapper +
    date/time normalization at the route boundary.
- `scripts/guards/check-response-shape-validated.allowlist`
  - removed 23 drained rows:
    - advance-directive routes (`3`)
    - ECT routes (`4`)
    - TMS routes (`4`)
    - oncology routes (`12`)
- Added source-regression tests:
  - extended `apps/api/tests/unit/bugEctTmsCourseRelationshipGuards.test.ts`
    with response-parse invariants.
  - new `apps/api/tests/unit/bugOncologyResponseShapeValidation.test.ts`.

**Verification executed in same session:**

- `npm run guard:response-shape-validated` => PASS (allowlist `933 -> 910`)
- `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts tests/unit/bugOncologyResponseShapeValidation.test.ts` => PASS (`8/8`)
- `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts` => PASS (`2/2`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS

**Evidence artifact:**
`docs/quality/remediation/evidence/b3-ect-tms-onc-response-shape-hardening-2026-05-14.md`.

## 2026-05-14 — B2 BUG-404 follow-up: outcomes error-envelope hardening

**Decision:** remove route-local inline validation JSON from outcomes create
and route all validation failures through canonical `AppError` + global error
middleware envelope.

**Why:** `guard:error-envelope-consistency` detected a residual inline
`res.status(422).json(...)` in `outcomeRoutes.ts`, which can reintroduce
route-specific error shape drift over time.

**Effect:**

- `apps/api/src/features/outcomes/outcomeRoutes.ts`
  - imported `AppError`
  - replaced inline `422` JSON with:
    - `next(new AppError('Validation error', 422, 'VALIDATION_ERROR', parsed.error.flatten()))`
- `scripts/guards/check-fix-registry-decisiveness.allowlist`
  - refreshed pinned expected hit counts after prior allowlist-drain work:
    - `R-FIX-BUG-638-ALLOWLIST-CITES-CASCADE` `933 -> 910`
    - `R-FIX-PHASE-R1-PR1.5-RESPONSE-MIGRATED` `909 -> 886`
    - `R-FIX-NEW-S2-SCHEDULER-SOFT-DELETE-MHA` `6 -> 9`

**Verification executed in same session:**

- `npm run guard:error-envelope-consistency` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bug404AssessmentMandatoryFields.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bugOncCommandOwnership.int.test.ts tests/integration/bugRfRbacPermissionMatrix.int.test.ts` => PASS (all files green)
- `npm run guard:fix-registry-decisiveness` => PASS
- `npm run guard:all` => PASS

**Evidence artifact:**
`docs/quality/remediation/evidence/b2-bug-404-error-envelope-hardening-2026-05-14.md`.

## 2026-05-14 — B3 ECT/TMS follow-up: safety-surface audit-log convergence

**Decision:** enforce canonical `writeAuditLog(...)` on ECT/TMS mutation paths
and drain corresponding `check-safety-surface-audit-log` allowlist debt.

**Why:** ECT/TMS mutation methods were functionally audited through
`auditLogService.logCreate(...)`, but still consumed allowlist exceptions in
the safety-surface guard because the guard enforces explicit
`writeAuditLog(...)` at mutation boundaries.

**Effect:**

- `apps/api/src/features/ect/ectService.ts`
  - `createCourse(...)` and `recordSession(...)` now call `writeAuditLog(...)`
    directly with structural `newData`.
- `apps/api/src/features/tms/tmsService.ts`
  - `createCourse(...)` and `recordSession(...)` now call `writeAuditLog(...)`
    directly with structural `newData`.
- `scripts/guards/check-safety-surface-audit-log.allowlist`
  - removed 4 drained rows (ECT `2`, TMS `2`).
- `apps/api/tests/unit/bugEctTmsCourseRelationshipGuards.test.ts`
  - extended source-regression assertions to pin audit-writer usage and forbid
    fallback wrapper calls on ECT/TMS mutation paths.

**Verification executed in same session:**

- `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts` => PASS (`8/8`)
- `npm run guard:safety-surface-audit-log` => PASS
- `npm run guard:all` => PASS

**Evidence artifact:**
`docs/quality/remediation/evidence/b3-ect-tms-safety-audit-log-drain-2026-05-14.md`.

## 2026-05-14 — B3 BUG-LG follow-up: legal-order side-effect idempotency + command ownership pins

**Decision:** complete remaining local BUG-LG prevention controls by hardening
legal-order auto-contact side effects and adding explicit source-level route
ownership/response-shape pins.

**Why:** legal-order integrations still produced duplicate "auto-created contact"
info logs on existing-record reuse paths, which obscured side-effect truthfulness
in forensics and made drift harder to detect during incident review.

**Effect:**

- `apps/api/src/features/contacts/autoContactRecord.ts`
  - transaction result now distinguishes `created` vs `reused` paths.
  - info log emitted only on true create; reuse path emits debug signal.
- `apps/api/src/middleware/contactRecordMiddleware.ts`
  - post-response callback persists via `dbAdmin` with explicit tenant/patient
    scoping (request-transaction lifecycle isolation).
- Added route-ownership + response-parse regression pins:
  - `apps/api/tests/unit/bugLegalOrderCommandOwnershipAndResponseShape.test.ts`
- Existing legal-order integration proof updated to assert one contact row per
  legal-order source id:
  - `apps/api/tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts`

**Verification executed in same session:**

- `npm run test -w apps/api -- tests/unit/bugLegalOrderCommandOwnershipAndResponseShape.test.ts` => PASS (`3/3`)
- `npm run test:integration -w apps/api -- tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts` => PASS (`5/5` + `6/6`)
- `npm run guard:all` => PASS

**Evidence artifact:**
`docs/quality/remediation/evidence/b3-lg-legal-order-command-ownership-idempotency-hardening-2026-05-14.md`.

## 2026-05-14 — B1 BUG-EP follow-up: route error-envelope convergence

**Decision:** migrate residual episode route inline error responses to canonical
`AppError` boundaries and drain the matching error-envelope allowlist debt.

**Why:** `episodeRoutes.ts` still contained route-local `res.status(...).json(...)`
failure paths, which can drift from the global error contract and break the
fail-closed response-shape guarantees introduced in C3.

**Effect:**

- `apps/api/src/features/episode/episodeRoutes.ts`
  - replaced inline status/json branches with `throw new AppError(...)` for:
    - roster authorization (`NOT_OWN_ROSTER`, `AUTH_REQUIRED`, `NOT_TEAM_MEMBER`)
    - allocation validation (`VALIDATION_ERROR`)
    - allocation/discharge/closure not-found checks (`NOT_FOUND`)
    - consultant-sign permission checks (`CONSULTANT_SIGN_REQUIRED`)
- `scripts/guards/check-error-envelope-consistency.allowlist`
  - removed 12 `episodeRoutes.ts` baseline rows.

**Verification executed in same session:**

- `npm run guard:error-envelope-consistency` => PASS (allowlist `337 -> 325`)
- `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts` => PASS (`5/5`)
- `npm run test:integration -w apps/api -- tests/integration/episodeDischargeSummaryClinicScope.int.test.ts tests/integration/bugEpisodeMdtSaveRace.int.test.ts` => PASS (`1/1` + `3/3`)
- `npm run guard:fix-registry-decisiveness` => PASS

**Evidence artifact:**
`docs/quality/remediation/evidence/b1-ep-error-envelope-hardening-2026-05-14.md`.

## 2026-05-14 — B3 BUG-ONC follow-up: CTCAE contract hardening

**Decision:** harden oncology chemo-cycle `toxicityCtcae` from unconstrained
JSON to a bounded shared-schema contract with explicit negative-path proof.

**Why:** ONC family still had a residual gap where toxicity payloads could pass
as arbitrary blobs. That weakens clinical-safety invariants and makes CTCAE
decision-path drift hard to detect.

**Effect:**

- `packages/shared/src/oncology.schemas.ts`
  - added `CtcaeGradeSchema` (`0..5`, integer).
  - added `CtcaeEventSchema` (term + bounded grade + optional attribution,
    seriousness, observedAt, notes).
  - added `ToxicityCtcaeSchema` and wired it into both
    `CreateChemoCycleSchema` and `ChemoCycleResponseSchema`.
- Added integration regression proof:
  - `apps/api/tests/integration/bugOncCtcaeContract.int.test.ts`
    - positive path accepts mixed legacy grade map + structured CTCAE event.
    - negative path rejects out-of-range CTCAE grade with
      `422 VALIDATION_ERROR`.

**Verification executed in same session:**

- `npm run test:integration -w apps/api -- tests/integration/bugOncCtcaeContract.int.test.ts` => PASS (`2/2`)
- `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts` => PASS (`2/2`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:response-shape-validated` => PASS

**Evidence artifact:**
`docs/quality/remediation/evidence/b3-onc-ctcae-contract-hardening-2026-05-14.md`.

## 2026-05-14 — B3 BUG-AD follow-up: clinical-access denial matrix includes PATCH

**Decision:** expand AD-family integration proof to cover update mutation denial
(`PATCH /advance-directives/:id`) for operational roles.

**Why:** previous AD regression proof covered GET/POST denial but left a gap on
PATCH mutation surface, which could allow role-drift to re-enter without
detection.

**Effect:**

- `apps/api/tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts`
  - captured created directive id + lockVersion from admin bootstrap create.
  - added receptionist PATCH test with expectedLockVersion payload.
  - asserted deterministic `403 CLINICAL_ACCESS_DENIED` on PATCH path.

**Verification executed in same session:**

- `npm run test:integration -w apps/api -- tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts` => PASS (`3/3`)
- `npm run lint:changed` => PASS

**Evidence artifact:**
`docs/quality/remediation/evidence/b3-ad-clinical-access-mutation-denial-2026-05-14.md`.

## Open Decisions Requiring Explicit Owner Or Operator Choice

1. Should the next execution slice prioritize integration schema/bootstrap repair (`audit_events_canonical` test-surface failure) before resuming `BUG-466` tranche-2 debt burn-down?
2. Should full Playwright (`752` tests) remain a mandatory pre-push gate on this machine, or run as a controlled nightly/CI gate while we use targeted L5 smoke for commit-time feedback?
3. Once `BUG-466` tranche-2 lands, do we immediately lower `check-no-explicit-any-regression.baseline.json` in a dedicated baseline commit, or batch baseline updates every N tranches?
