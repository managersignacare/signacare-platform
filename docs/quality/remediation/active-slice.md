# Active Slice Contract

## Current Slice

**Slice ID:** `CSR-8-CONTROLLED-RESET-SMOKE-REPLAY-2026-05-15`  
**Status:** complete  
**Owner model:** single owner, serial execution  
**Purpose:** execute CSR-8 controlled demo-data reset and smoke replay after CSR-1..CSR-7 readiness completion.

## Deployment State Lock (As Of 2026-05-15)

1. Deployment to Azure/canary is **not started**.
2. Phase B (`PD-1` .. `PD-7`) is **not open** yet.
3. No `R1 rollout-closure pending` bug may be flipped to `closed/fixed` until deployed evidence exists:
   - canary,
   - burn-in,
   - post-burn-in rerun.
4. Allowed updates pre-deploy are limited to:
   - `R0` readiness evidence,
   - `R2` implementation progress,
   - `R3` decision/defer governance updates.

## Execution Goals And Approach (Refreshed)

1. Keep strict serial order: CSR-1 → CSR-2 → CSR-3 → CSR-4 → CSR-5 → CSR-6 → CSR-7 (complete) → CSR-8.
2. Run controlled reset with deterministic seed path (`DEMO_SEED=good-health`, canonical personas, e2e fixtures).
3. Resolve seed collision root-cause structurally (natural-key-safe reference data upsert).
4. Prove post-reset smoke readiness across onboarding/staff/patient/episode/referral/prescribing/scheduler/correspondence/notes.

## Build/Test Rules For This Slice (Refreshed)

1. `L1`: `npm run typecheck`.
2. `L2`: `npm run guard:all`.
3. `L3`: deterministic reset/seed replay:
   - `DEMO_SEED=good-health DEMO_WIPE=1 npm run seed:good-health -w apps/api`
   - `npm run seed:canonical-personas -w apps/api`
   - `npm run seed:e2e-fixtures -w apps/api`
4. `L4`: post-reset smoke replay:
   - `npm run test:integration -w apps/api -- tests/integration/clinicAccessAdminsPowerSettings.int.test.ts tests/integration/clinicAccessAdminsSchema.int.test.ts tests/integration/patientCrud.test.ts tests/integration/episodeStateMachine.test.ts tests/integration/bug415ReferralStateMachine.int.test.ts tests/integration/prescribingSafety.test.ts tests/integration/laiAlertScheduler.int.test.ts tests/integration/bug425LetterSensitiveFilter.int.test.ts tests/integration/clinicalNotesConsentFK.int.test.ts`
5. `L5`: seed-collision regression proof:
   - `npm run test:integration -w apps/api -- tests/integration/seedGoodHealthReferenceDataNaturalKey.int.test.ts`

## Files Allowed In This Slice

- `docs/quality/remediation/active-slice.md`
- `docs/quality/remediation/remaining-work-gold-standard-plan-2026-05-15.md`
- `docs/quality/remediation/evidence/a2-csr-4-predeploy-readiness-2026-05-15.md`
- `package.json`
- `.github/CODEOWNERS`
- `.github/bug-closure-records.json`
- `.github/guard-ratchet.json`
- `.github/workflows/weekly-integrity.yml`
- `docs/quality/remediation/schemas/bug-closure-record.schema.json`
- `apps/api/migrations/20260701000068_bug_287_hash_chain_scope_state_fix.ts`
- `apps/api/tests/integration/auditLogHashChain.int.test.ts`
- `scripts/guards/check-guard-count-ratchet.ts`
- `scripts/guards/run-all-guards.ts`
- `scripts/guards/check-bug-closure-record-schema.ts`
- `scripts/guards/__tests__/check-bug-closure-record-schema.test.ts`
- `apps/api/tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts`
- `docs/quality/remediation/evidence/a1-csr-6-predeploy-readiness-2026-05-15.md`
- `docs/quality/remediation/evidence/csr-7-synthetic-readiness-replay-2026-05-15.md`
- `apps/api/src/seed-good-health/generators/00_reference_data.ts`
- `apps/api/tests/integration/seedGoodHealthReferenceDataNaturalKey.int.test.ts`
- `docs/quality/remediation/evidence/csr-8-controlled-reset-smoke-replay-2026-05-15.md`

## Files Explicitly Not In Scope

- Domain lane feature logic (`A*`, `B*`, `A3`) outside mechanical regression controls
- Product workflow behavior changes
- ADHA/eRx conformance scope

## Root Cause This Slice Addresses

1. CSR-8 reset path failed on legacy `clinical_roles` rows because reference-data upsert matched only by deterministic ID, not natural key.
2. The failure blocked deterministic reset/seed replay in pre-deployment readiness mode.
3. The lane needed structural hardening plus a permanent regression test around legacy-ID collision behavior.

## Gold-Standard Outcome

1. CSR-8 controlled reset completes without natural-key collision failures.
2. Seed path is deterministic across legacy and deterministic IDs (no duplicate-key regression).
3. Post-reset smoke replay is green across critical workflow surfaces.
4. Phase-A serial chain is complete through CSR-8 and ready for PD-1 handoff.

## Verification For This Slice

1. CSR-2 complete: `docs/quality/remediation/evidence/c3-csr-2-predeploy-readiness-2026-05-15.md`.
2. CSR-3 complete: `docs/quality/remediation/evidence/a3-csr-3-discovery-gate-2026-05-15.md`.
3. CSR-4 complete (2026-05-15):
   - `BUG-287` structural fix migration landed: `20260701000068_bug_287_hash_chain_scope_state_fix.ts`.
   - `auditLogHashChain.int` PASS with strengthened same-batch linearity assertion (`5/5`).
   - A2 replay quartet PASS (`clinicalNotesConsentFK`, `limitCeilings`, `reportsRoutesHealth`, `auditLogHashChain`).
   - `migrate:rehearsal` PASS (approved-forward-fix-only `BUG-706` posture preserved).
   - `typecheck` PASS, `guard:all` PASS.
   - evidence: `docs/quality/remediation/evidence/a2-csr-4-predeploy-readiness-2026-05-15.md`.
4. CSR-5 guard activation complete (mechanical entrypoints active and passing):
   - `guard:frontend-route-contract` PASS
   - `guard:policy-matrix-surface` PASS
   - `guard:response-adapter-required` PASS
   - `guard:e2e-selector-stability` PASS
   - `guard:all` PASS with these guards included.
5. CSR-6 A1 synthetic readiness complete (2026-05-15):
   - `breakGlassAudit.test.ts` PASS (`10/10`).
   - `clinicAccessAdminsPowerSettings.int.test.ts` PASS (`5/5`).
   - `passwordBreachService.test.ts` PASS (`6/6`).
   - `frontendAccessPolicy.test.ts` PASS (`7/7`).
   - `rbac-matrix.spec.ts` PASS (`20/20`).
   - `guard:all` PASS and `typecheck` PASS.
   - evidence: `docs/quality/remediation/evidence/a1-csr-6-predeploy-readiness-2026-05-15.md`.
6. CSR-7 synthetic readiness replay complete (2026-05-15):
   - B4 replay pack PASS (unit `176/176`, integration `11/11 files`, scheduler guards PASS).
   - B1/B2/B3 replay pack PASS after fixture hardening:
     - fixed `bugAdFamilyClinicalAccessGuard.int.test.ts` to seed explicit episode relationship for clinician setup;
       replay now PASS (`12/12` integration files + supporting unit/web packs PASS).
   - A4b/A4c replay pack PASS (security/observability guards + 8 LLM integration files + LLM unit pack).
   - `guard:all` PASS after patch.
   - evidence: `docs/quality/remediation/evidence/csr-7-synthetic-readiness-replay-2026-05-15.md`.
7. CSR-8 controlled reset + smoke replay complete (2026-05-15):
   - Fixed seed blocker in `apps/api/src/seed-good-health/generators/00_reference_data.ts` by natural-key-first reconciliation with deterministic-ID fallback.
   - `DEMO_SEED=good-health DEMO_WIPE=1` PASS (`inserted=11525`, `updated=4887`).
   - `seed:canonical-personas` PASS (`9 personas upserted`).
   - `seed:e2e-fixtures` PASS.
   - `typecheck` PASS and `guard:all` PASS.
   - smoke integration pack PASS (`9/9` files).
   - provisioning onboarding regression proof PASS (`provisioningOnboarding.int`) with strict HPI-O validation preserved and duplicate-admin-email mapped to `409 CONFLICT` (not `500`).
   - new regression proof PASS: `seedGoodHealthReferenceDataNaturalKey.int.test.ts`.
   - evidence: `docs/quality/remediation/evidence/csr-8-controlled-reset-smoke-replay-2026-05-15.md`.

## Next Step In Lane

1. Open **PD-1** (C3 operational closure evidence chain) when deployment window starts.
2. Keep A2/A1/B/A4 rows as `R1` rollout-closure pending until Phase-B canary/burn-in evidence.
3. Execute PD-1..PD-7 handoff packet in strict serial order (`docs/quality/remediation/pd-handoff-packet-2026-05-15.md`).

## Local Completion Snapshot (Pre-Deploy, 2026-05-15)

1. Remaining local work for deployment-pending (`R1`) lanes is **complete**:
   - C3, A2, A1b/A1d/A1c, A4a(R1 surfaces), B4 (non-decision-gated), B1/B2/B3 families, A4b, A4c.
2. Remaining items in these lanes are Phase-B operational closure only:
   - canary,
   - burn-in,
   - post-burn-in rerun,
   - catalogue flip with closure schema validation.
3. A3 local implementation update (2026-05-15): `BUG-N4`, `BUG-P5`, `BUG-A5.3`, `BUG-A5.4`, `BUG-A5.7` plus `BUG-344`, `BUG-N1`, `BUG-N5`, `BUG-303`, `BUG-304`, `BUG-305` now have local implementation + regression proof (`docs/quality/remediation/evidence/a3-bug-a5-3-n4-p5-a5-4-a5-7-2026-05-15.md`, `docs/quality/remediation/evidence/a3-bug-344-n1-n5-303-304-305-2026-05-15.md`).
4. Pre-deployment `R2` backlog in active scope is currently drained; remaining open items across these lanes are `R1` rollout-closure pending or explicit `R3` deferred/blocked rows.

## Future Work To-Do (Detected, Not Fully Fixed)

- Wire C3 post-deployment evidence capture and final catalogue flips after local closure.
- Continue rollout-closure rows that remain deployment-evidence dependent.
- Execute canary + burn-in + post-burn-in evidence pack for A2 closure-contract bugs.

---

## Regression Prevention Layers (Implemented First)

- Scope note: these controls are runtime/tool-agnostic and apply equally when work is executed via Claude or Codex.
- [x] Layer 1 — Mechanical global entrypoint (`guard:all`) with explicit context-only skip reasons
- [x] Layer 1 — Repo-global lane boundary enforcement scaffold (`.github/CODEOWNERS`)
- [x] Layer 4 — Guard-count ratchet (`guard:guard-count-ratchet` + `.github/guard-ratchet.json`)
- [x] Layer 6 — Weekly cold-start integrity workflow (`.github/workflows/weekly-integrity.yml`)
- [x] Layer 2/3/5 closure-schema enforcement baseline (`bug-closure-record.schema.json` + registry + guard + guard tests)

## C3 Local Verification Snapshot (2026-05-13)

- PASS — `npm run guard:a11y-ci-no-dryrun` (`BUG-450` local fail-closed dry-run guard)
- PASS — `npm run guard:a11y-baseline-allowlist` (`BUG-450` baseline BUG-mapping + expiry contract)
- PASS — `npm run guard:a11y-playwright-report -- a11y-playwright-report.json` (`BUG-450` execution-proof contract)
- PASS — `npm run guard:safety-route-integration-coverage` (`BUG-451` required safety-route manifest enforcement)
- PASS — `npm run guard:c3-noncritical-backfill-batches` (`BUG-453` batch boundary + hard-stop contract)
- PASS — `npm run guard:claude-discipline:ci` (includes integration URL + safety-route + C3 batch + A2 readiness pack)
- PASS — `npm run ci:generate-c3-coverage-artifact` with explicit gate verdicts + `npm run guard:c3-coverage-artifact -- artifacts/c3/c3-coverage-evidence.json` (`BUG-429` producer/consumer artifact contract)

## B4 Local Verification Snapshot (2026-05-14)

- PASS — `npm run guard:claude-discipline:ci` (L0a discipline + cross-lane structural guards)
- PASS — `npm run typecheck` (L1 compile across `apps/api`, `apps/web`, `packages/shared`, `packages/ui-components`, `apps/emr-gateway`)
- PASS — `npm run lint` (repo-wide lint contract)
- PASS — `npm run guard:timer-try-catch`
- PASS — `npm run guard:no-fire-and-forget`
- PASS — `npm run guard:query-has-clinic-id`
- PASS — `npm run test -w apps/api -- tests/unit/laiAlertScheduler.test.ts tests/unit/ectConsentExpiryScheduler.test.ts tests/unit/advanceDirectiveReviewScheduler.test.ts tests/unit/clozapineMonitoringWeekScheduler.test.ts tests/unit/mhaReviewScheduler.test.ts tests/unit/pathologyCriticalScheduler.test.ts tests/unit/notificationService.channels.test.ts tests/unit/suicidalIdeationAfterHoursScheduler.test.ts tests/unit/clozapineAlertScheduler.test.ts` (`9/9` files, `176/176` tests)
- PASS — `npm run test:integration -w apps/api -- tests/integration/laiAlertScheduler.int.test.ts tests/integration/ectConsentExpiryScheduler.int.test.ts tests/integration/advanceDirectiveReviewScheduler.int.test.ts tests/integration/clozapineMonitoringWeekScheduler.int.test.ts tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts tests/integration/pathologyCriticalAlertsCycle2.int.test.ts tests/integration/suicidalIdeationAfterHoursScheduler.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts tests/integration/clozapineAlertSchedulerCycle2.int.test.ts tests/integration/hl7InboundIngest.int.test.ts` (`11/11` files PASS)
- PASS — targeted leftover-gap closeout replay (`BUG-583-FOLLOWUP-CLINIC-THRESHOLDS-DBADMIN-SETUP`): `pathologyCriticalAlertsCycle2.int` (`9/9`), `hl7InboundIngest.int` (`9/9`), `pathologyCriticalScheduler.unit` (`42/42`), `clinicAdminSlotBootstrapCheck.unit` (`3/3`), and `guard:claude-discipline:ci` PASS. Evidence: `docs/quality/remediation/evidence/b4-local-integrity-gap-closeout-2026-05-14.md`.

B4 local closure posture: all non-decision-gated B4 items are locally implemented and re-verified; only rollout/post-deploy evidence remains for closure-state flips. `BUG-593` remains intentionally deferred by trigger contract (execute only when high-risk drug-class inventory grows beyond deferral threshold or CAB explicitly pulls it in).

## Propagation-Prevention Ordered Status (Reviewed 2026-05-14)

## C3 — Global Gate + Coverage Closure

- [ ] `BUG-450` — Gate truthfulness hardening
  - Local: ✅ Completed in current slice (`guard:a11y-ci-no-dryrun`, `guard:a11y-baseline-allowlist`, `guard:a11y-playwright-report` all PASS).
  - Post-deploy: Confirm protected-branch gate is fail-closed with committed a11y evidence pack (spec list + rule IDs + route map).
- [ ] `BUG-429` — Coverage roll-up hardening
  - Local: ✅ Completed in current slice (risk-tiered guard model + strict allowlist metadata + machine-readable artifact generation and consumer validation PASS).
  - Post-deploy: Confirm artifact is present in release evidence bundle and allowlist debt is bounded/no indefinite rows.
- [ ] `BUG-451` — Clinical-safety integration residual
  - Local: ✅ Completed for current residual posture (`guard:safety-route-integration-coverage` fail-closed PASS; residual remains open by scope policy).
  - Post-deploy: CI consumes required safety manifest and full L1-L5 evidence is green in one session.
- [ ] `BUG-453` — Broad backfill closure
  - Local: ✅ Completed for current batch contract posture (`guard:c3-noncritical-backfill-batches` PASS; inventoryStatus=`ready_for_closure`; no batch-5 spillover).
  - Post-deploy: Release evidence bundle complete (guard outputs + route matrix + pass logs linked).

## A2 — DB Contract + Immutability

- [x] `BUG-355` — Operational-role SSoT
- [ ] `BUG-287` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Re-hardened 2026-05-15 via migration `20260701000068_bug_287_hash_chain_scope_state_fix.ts` (scope-tail state table + trigger-linearized ordinals + deterministic predecessor chaining under same-batch inserts). Verification PASS: `auditLogHashChain.int` (5/5), `limitCeilings.int` (11/11), `reportsRoutesHealth.int` (4/4), `clinicalNotesConsentFK.int` (5/5), `migrate:rehearsal` PASS.
  - Post-deploy: Commit verifier report + post-burn-in proof and flip catalogue with evidence hash.
- [ ] `BUG-315` *(implementation landed; rollout-closure pending)*
  - Local: ✅ A2-2 Phase C closed on 2026-05-12: `clinical_notes.consent_id` null reconciliation completed (`NULL (non-deleted)=0`), readiness guard enabled, and `NOT NULL + validated FK` enforcement landed in `20260701000061_bug_315_334_not_null_phase_c.ts`. Local closeout evidence pack PASS (`a2-local-closeout-gate-pack-2026-05-12.md` + `a2-rollout-closure-handoff-2026-05-12.md`).
  - Post-deploy: Commit reconciliation + staging constraint verification evidence.
- [ ] `BUG-334` *(implementation landed; rollout-closure pending)*
  - Local: ✅ A2-2 Phase C closed on 2026-05-12: `clinics.hpio` readiness reconciled (`NULL=0`) and `NOT NULL` enforcement landed in `20260701000061_bug_315_334_not_null_phase_c.ts`. Local closeout evidence pack PASS (`a2-local-closeout-gate-pack-2026-05-12.md` + `a2-rollout-closure-handoff-2026-05-12.md`).
  - Post-deploy: Commit readiness + staging enforcement proof.
- [ ] `BUG-706` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Forward-fix-only posture is approved and re-verified (`approved-forward-fix-only`), and `migrate:rehearsal` passes under fail-closed governance with named approval metadata. Local closeout evidence pack PASS (`a2-local-closeout-gate-pack-2026-05-12.md` + `a2-rollout-closure-handoff-2026-05-12.md`).
  - Post-deploy: Attach signed decision artifact to rollout gate evidence.
- [ ] `BUG-288` *(deferred-post-staging)*
  - Local: No pre-staging work unless explicit operator decision changes scope.
  - Post-deploy: Separate gated sub-lane with explicit risk/rollback assessment if activated.

## A1b + A1d — RBAC Backend SSoT + FE Convergence

- [x] `BUG-P4` — HaveIBeenPwned password breach checking
- [x] `BUG-710` — `/power-settings` RBAC authority convergence
- [ ] `BUG-FE-RBAC-SPLIT` *(implementation landed; rollout-closure pending)*
  - Local: ✅ A1d phase-1 landed (2026-05-12): centralized FE policy adapter and route/tab gating are wired and locally verified; evidence captured in `a1d-frontend-permission-convergence-phase1-2026-05-12.md`.
  - Post-deploy: Persona walkthrough evidence committed and catalogue flipped.
- [ ] `BUG-RECEPTIONIST-CLINICAL-NOTES-NO-ROLE-GUARD` *(implementation landed; rollout-closure pending)*
  - Local: ✅ A1d phase-1 landed (2026-05-12): receptionist note-create path is gated via centralized `note:create` policy check with negative-path local verification in the A1d evidence packet.
  - Post-deploy: Replay receptionist denial evidence (API + UI) and commit proof.
- [ ] `BUG-RECEPTIONIST-SEES-CLINICAL-MGMT` *(implementation landed; rollout-closure pending)*
  - Local: ✅ A1d phase-1 landed (2026-05-12): receptionist route/tab suppression and unauthorized fallback behavior are implemented and locally verified in the A1d evidence packet.
  - Post-deploy: Commit persona walkthrough evidence and flip catalogue.

## A4a — External Integration Transport and Interop

- [ ] `BUG-263` *(implementation landed; rollout-closure pending)*
  - Local: ✅ STAT-urgency retry-profile divergence landed on 2026-05-14 with canonical SSoT:
    - Added `apps/api/src/integrations/hl7/hl7OutboundRetryProfile.ts` with explicit urgency profiles:
      - `routine` / `urgent`: `attempts=5`, exponential `delay=30_000`, no early alert
      - `stat`: `attempts=3`, exponential `delay=10_000`, `alertAtAttempt=2`
    - `apps/api/src/features/pathology/pathologyService.ts` `placeOrder(...)` now applies urgency-derived attempts/backoff and includes `urgency` in HL7 outbound job payload.
  - Local: ✅ STAT early-alert failure handling landed in `apps/api/src/jobs/workers/hl7Worker.ts`:
    - failed-handler logic now treats only true inline-unrecoverables (`NOT_CONFIGURED`, `PROTOCOL_UNSUPPORTED`) as skip paths,
    - STAT retryable failures emit `integration_unreachable` alert at failed attempt 2 with structured payload (`retryProfile: stat`, `alertReason: retry-threshold-breached`) while allowing remaining retries.
  - Local: ✅ Regression proof added:
    - `apps/api/tests/unit/bug263Hl7RetryProfile.test.ts` pins urgency-profile constants (`2/2` PASS),
    - `apps/api/tests/integration/hl7Transport.int.test.ts` now asserts STAT attempt-2 early alert contract (`4/4` PASS).
  - Local proof: ✅ targeted unit + integration tests PASS + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4a-bug-263-stat-hl7-retry-profile-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in + post-burn-in evidence and flip catalogue.
- [ ] `BUG-300` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Canonical HL7 pharmacy outbound builder/parser module landed on 2026-05-14:
    - Added `apps/api/src/integrations/hl7/hl7OrmBuilder.ts`.
    - `buildPharmacyOrmO01(...)` now emits `MSH`, `PID`, `ORC`, `RXO`, and `RXE` segments for pharmacy order messages.
    - `dispatchPharmacyOrmO01(...)` routes the generated message through existing transport SSoT (`dispatchHl7`), avoiding transport fork logic.
    - `parseRdeO11DispenseConfirmation(...)` parses `RDE^O11` acknowledgement/dispense fields (message control id, order number, order status, ack code, dispense datetime/amount/unit) with fail-closed message-type validation.
  - Local: ✅ Parser hardening includes partner-dialect fallback for ORC status position (`ORC-5` primary, `ORC-4` fallback) while still rejecting structurally invalid payloads.
  - Local: ✅ Regression proof added:
    - `apps/api/tests/unit/bug300Hl7OrmOutboundBuilder.test.ts` (`4/4`) for builder shape, dispatch seam, parser success, parser fail-closed contract.
    - `apps/api/tests/unit/hl7Transport.test.ts` (`5/5`) replayed to ensure outbound transport semantics remain stable under new builder usage.
  - Local proof: ✅ targeted unit suites PASS + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4a-bug-300-hl7-orm-outbound-builder-2026-05-14.md`.
  - Post-deploy: Replay canary pharmacy-partner dialect sample messages + burn-in + post-burn-in evidence before catalogue flip.
- [ ] `BUG-333` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Added canonical shutdown drain for outbound mTLS keep-alive agents on 2026-05-14:
    - `apps/api/src/shared/mtls.ts` now exports `drainMtlsAgentCacheForShutdown()` to destroy/clear cached agents.
    - `apps/api/src/server.ts` now registers shutdown hook `mtls-agent-drain` (priority `45`) so cache drain happens before DB/Redis teardown.
  - Local: ✅ Converged eRx Adapter mTLS construction to shared cache path:
    - `apps/api/src/integrations/escript/erxAdapterClient.ts` now uses `createMtlsAgent(...)` with integration key `eRx Adapter`.
    - This removes the last standalone adapter keep-alive cache and makes shutdown drain SSoT complete across mTLS integrations.
  - Local: ✅ Regression proof in `apps/api/tests/mtlsHelper.test.ts`:
    - New `T6` seeds two cached agents, runs `drainMtlsAgentCacheForShutdown()`, and asserts both destruction + zero cache size.
  - Local proof: ✅ `npm run test -w apps/api -- tests/mtlsHelper.test.ts` PASS + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4a-bug-333-mtls-keepalive-shutdown-drain-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in + post-burn-in evidence and flip catalogue.
- [ ] `BUG-335` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Frontend ERX_NOT_CONFIGURED branching landed on 2026-05-14 via canonical helper `apps/web/src/features/medications/services/erxErrorMessage.ts`.
  - Local: ✅ Field-aware remediation messaging is now deterministic:
    - `clinics.hpio` -> HPI-O setup guidance
    - `clinics.npds_conformance_id` -> NPDS conformance setup guidance
    - both paths direct operators to `Org Settings -> eRx Setup`.
  - Local: ✅ Active eRx user surfaces now consume the canonical branch helper:
    - `apps/web/src/features/medications/components/CurrentMedsPanel.tsx` (token reissue + cancel error path),
    - `apps/web/src/features/medications/components/PrescriptionForm.tsx` (create-error surface).
  - Local proof: ✅ `apps/web/src/features/medications/services/erxErrorMessage.test.ts` PASS (`4/4`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4a-bug-335-erx-not-configured-frontend-branching-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in + post-burn-in evidence and flip catalogue.
- [ ] `BUG-337` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Consolidated eRx HPI-O validation to canonical HI-number SSoT on 2026-05-14:
    - `apps/api/src/integrations/escript/erxRestPayloads.ts` now validates with `validateHiNumber(c.hpio, HI_PREFIX.HPI_O)` from `shared/hiNumbers`.
    - Local `HPIO_FORMAT` regex drift surface removed.
  - Local: ✅ Regression-proof tightened in `apps/api/tests/integration/erxHpioValidation.int.test.ts`:
    - Added bad-Luhn rejection (`T6b`),
    - Updated `T9` to assert current A2 Phase-C `clinics.hpio NOT NULL` contract.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/erxHpioValidation.int.test.ts` PASS (`10/10`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4a-bug-337-hpio-validator-ssot-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in + post-burn-in evidence and flip catalogue.
- [ ] `BUG-341` *(implementation landed; rollout-closure pending)*
  - Local: ✅ NPDS client DB dependency posture pinned on 2026-05-14:
    - `apps/api/src/integrations/escript/npdsClient.ts` `resolveNpdsConformanceId` explicitly preserves lazy dynamic import (`await import('../../db/db')`) with BUG-341 annotation.
    - no static top-level `../../db/db` import remains on NPDS client module.
  - Local: ✅ Regression-proof added via source-contract unit test:
    - `apps/api/tests/unit/bug341NpdsClientDynamicDbImport.test.ts` fails if static db import reappears and asserts dynamic import anchor remains present.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/bug341NpdsClientDynamicDbImport.test.ts` PASS (`1/1`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4a-bug-341-npds-client-dynamic-db-import-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in + post-burn-in evidence and flip catalogue.
- [ ] `BUG-340` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Hardened NPDS conformance resolution for rename/merge continuity on 2026-05-14:
    - `apps/api/src/integrations/escript/npdsClient.ts` now resolves in order:
      1. active-clinic `npds_conformance_id`,
      2. unique live sibling clinic with shared HPI-O (`BUG-340` fallback),
      3. env fallback (`NPDS_CONFORMANCE_ID`) as transitional last-resort.
  - Local: ✅ Ambiguous sibling resolution now fails-visible (explicit error log) before env fallback, preventing silent conformance mis-attribution.
  - Local: ✅ Regression suite expanded in `apps/api/tests/integration/npdsConformancePerClinic.int.test.ts`:
    - `T8` proves shared-HPI-O sibling fallback.
    - `T9` proves ambiguous siblings route to env fallback.
    - seed rows updated to include HPI-O under current A2 constraints.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/npdsConformancePerClinic.int.test.ts` PASS (`9/9`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4a-bug-340-npds-conformance-rename-merge-fallback-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in + post-burn-in evidence and flip catalogue.

## B4 — Scheduler + Alert Reliability

- [x] `BUG-569`
- [x] `BUG-571`
- [x] `BUG-577`
- [x] `BUG-578`
- [x] `BUG-579`
- [x] `BUG-580`
- [x] `BUG-583`
- [x] `BUG-584`
- [x] `BUG-585`
- [x] `BUG-589`
- [x] `BUG-590`
- [x] `BUG-591`
- [x] `BUG-592`
- [x] `BUG-602`
- [ ] `BUG-570` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/laiAlertScheduler.test.ts` + `apps/api/tests/integration/laiAlertScheduler.int.test.ts` both PASS.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-572` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/ectConsentExpiryScheduler.test.ts` + `apps/api/tests/integration/ectConsentExpiryScheduler.int.test.ts` both PASS.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-573` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/advanceDirectiveReviewScheduler.test.ts` + `apps/api/tests/integration/advanceDirectiveReviewScheduler.int.test.ts` both PASS.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-574` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/clozapineMonitoringWeekScheduler.test.ts` + `apps/api/tests/integration/clozapineMonitoringWeekScheduler.int.test.ts` both PASS.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-575` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/notificationService.channels.test.ts` PASS (email-channel fanout + fail-open enqueue behavior).
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-576` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts` PASS (legal CRUD + audit invariants).
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-586` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/mhaReviewScheduler.test.ts` + `apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts` PASS (current-episode fallback branch remains green).
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-587` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/mhaReviewScheduler.test.ts` + `apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts` PASS (sub-day `T-12h`/`T-4h` behavior intact).
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-588` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/mhaReviewScheduler.test.ts` + `apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts` PASS (missing-`review_date` data-quality path intact).
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-581` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/unit/suicidalIdeationAfterHoursScheduler.test.ts` + `apps/api/tests/integration/suicidalIdeationAfterHoursScheduler.int.test.ts` PASS.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-582` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: shared `runScheduledTick` abstraction remains active on refactored scheduler paths with PASS evidence from `apps/api/tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts` + `apps/api/tests/integration/pathologyCriticalAlertsCycle2.int.test.ts`.
  - Post-deploy: Commit canary + burn-in evidence (appointment + referral + pathology scheduler shells running via abstraction) and flip catalogue.
- [ ] `BUG-593` *(decision-gated backlog)*
  - Local: ✅ Deferred posture re-verified on 2026-05-14. Trigger condition remains unmet (no CAB pull-in recorded; current high-risk class set is still below defer-threshold), so this item remains intentionally out of active implementation scope.
  - Post-deploy: If executed, evidence committed and catalogue flipped.
- [ ] `BUG-577-FOLLOWUP-CONSOLIDATE-RESOLVERS` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Shared resolver SSoT landed at `apps/api/src/shared/staffActivenessResolver.ts`; both `pathologyService.resolveCriticalAssigneeAdmin` (HL7 ingest path) and `pathologyCriticalScheduler.buildLiveContext.resolveActiveRecipients` now consume it. HL7 path now emits immutable audit rows (`CRITICAL_RECIPIENT_REASSIGNED` / `CRITICAL_NO_RECIPIENT_AVAILABLE`) through the shared helper.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-577-FOLLOWUP-CLINIC-BOOTSTRAP-ADMIN-CHECK` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Complete — preventive signaling now covers both paths: (1) clinic creation path in `clinicService.createClinic` and (2) startup/bootstrap sweep for pre-existing clinics via `clinicAdminSlotBootstrapCheck` (deduped by prior 24h `ADMIN_ALERT` audit rows).
  - Local proof: `apps/api/tests/unit/clinicService.test.ts` + `apps/api/tests/unit/clinicAdminSlotBootstrapCheck.test.ts`; startup hook wired in `apps/api/src/jobs/bootstrap.ts`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-578-FOLLOWUP-UI-TIER-DISCRIMINATOR` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Notification bell now renders escalation badge from `payload.tier` via `getNotificationTierBadge()` (`apps/web/src/features/notifications/notificationTier.ts`) instead of title-prefix parsing; tier-2 renders `Escalation` (error tone), tier-3+ renders `Escalation Tn` (warning tone).
  - Local proof: `apps/web/src/features/notifications/notificationTier.test.ts` (`5/5`).
  - Post-deploy: UI evidence + catalogue close.
- [ ] `BUG-578-FOLLOWUP-TIER-PREFIX-CONVENTION` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Escalation title-prefix convention documented at `docs/quality/remediation/notification-escalation-title-convention.md` with explicit authority order (`payload.tier` canonical; title prefix human-readable fallback) and tier-specific prefix semantics.
  - Post-deploy: Documentation/lint proof + catalogue close.
- [ ] `BUG-583-FOLLOWUP-CLINIC-THRESHOLDS-DBADMIN-SETUP` *(implementation landed; rollout-closure pending)*
  - Local: ✅ TP-PA-INT-578-1 now seeds `clinic_thresholds.pathology_escalation_minutes=30` through `dbAdmin` and restores prior row state in `finally`; removed the test-side `getEscalationThreshold` override wrapper so the test exercises live `buildLiveContext()` behavior end-to-end.
  - Local proof: `apps/api/tests/integration/pathologyCriticalAlertsCycle2.int.test.ts` + sibling parity re-run `apps/api/tests/integration/hl7InboundIngest.int.test.ts`.
  - Post-deploy: Updated integration evidence + catalogue close.
- [ ] `BUG-584-FOLLOWUP-CLINIC-BOOTSTRAP-ADMIN-CHECK` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Covered by shared clinic-admin bootstrap prevention shipped for BUG-577 follow-up (`clinicService` create-time alert + startup `clinicAdminSlotBootstrapCheck` sweep with 24h dedupe).
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-585-FOLLOWUP-MULTI-TIER-CASCADE` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Implemented tiered escalation chain (`tier=2/3/4`) on BOTH schedulers named in catalogue scope:
    - `apps/api/src/jobs/schedulers/mhaReviewScheduler.ts`
    - `apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts`
  - Local: ✅ Added tier-specific dedupe namespaces + thresholds + recipient resolvers:
    - Dedupes: `mha-review-escalation` / `mha-review-governance-escalation` / `mha-review-regulatory-escalation`
    - Dedupes: `pathology-critical-escalation` / `pathology-critical-governance-escalation` / `pathology-critical-regulatory-escalation`
    - Threshold keys: `mha_review_escalation_tier3_minutes`, `mha_review_escalation_tier4_minutes`, `pathology_escalation_tier3_minutes`, `pathology_escalation_tier4_minutes`
    - Recipient tiers: team-leads+admin (tier-2), manager/admin+admin (tier-3), superadmin+admin (tier-4)
  - Local proof: `apps/api/tests/unit/mhaReviewScheduler.test.ts` + `apps/api/tests/unit/pathologyCriticalScheduler.test.ts` + `apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts` + `apps/api/tests/integration/pathologyCriticalAlertsCycle2.int.test.ts`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-569-FOLLOWUP-ORPHAN-PRESCRIBER-FALLBACK` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Added orphan-prescriber alert class in `clozapineAlertScheduler`: active registrations with `prescriber_staff_id IS NULL` now emit critical alerts to active current primary clinician + active clinic governance admin recipients (nominated/delegated), with explicit fail-visible error logging when no active recipient exists.
  - Local proof: `apps/api/tests/unit/clozapineAlertScheduler.test.ts` + `apps/api/tests/integration/clozapineAlertSchedulerCycle2.int.test.ts`.
  - Post-deploy: Integration proof + catalogue close.
- [x] `BUG-451-FOLLOWUP-MIGRATE-OLDER-PATHOLOGY-INT-TEST`
  - Local: ✅ Migrated legacy pathology integration test to production live context (`await buildLiveContext()`) and removed in-test parallel-SQL `buildLiveCtx` clone path.
  - Local: ✅ Kept determinism by asserting seeded-`resultId` notification deltas instead of test-side SQL filtering wrappers.
  - Local proof: `npm run test:integration -w apps/api -- tests/integration/pathologyCriticalAlerts.int.test.ts` PASS (`4/4`).
  - Evidence: `docs/quality/remediation/evidence/b4-bug-451-followup-migrate-older-pathology-int-test-2026-05-14.md`.

## B1 / B2 / B3 — Command Consolidation Lanes

- [x] `BUG-REFERRAL-INTAKE-CLOSE-LIE-ABOUT-SUCCESS`
- [x] `BUG-291`
- [x] `BUG-565`
- [x] `BUG-566`
- [x] `BUG-568`
- [ ] `BUG-567` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Centralized optimistic-lock conflict detail redaction in `apps/api/src/shared/db/optimisticLock.ts`:
    - Added `redactOptimisticLockWhereForClient(where)` to strip tenant scope identifiers from client payload.
    - Added `buildOptimisticLockConflictDetails(...)` and routed all helper-thrown `OPTIMISTIC_LOCK_CONFLICT` payloads through it.
    - Client conflict details now return `where.id` + `expectedLockVersion` + `scope: 'clinic_scoped'` and no longer echo `where.clinic_id`.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/optimisticLock.test.ts` PASS (`10/10`) with `OL-VAL-10` pinning redaction behavior + `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` PASS (`7/7`) with explicit assertion that conflict payload excludes `clinic_id`.
  - Evidence: `docs/quality/remediation/evidence/b3-bug-567-optimistic-lock-conflict-redaction-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-563` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Added canonical treatment-pathway state machine in `apps/api/src/features/treatment-pathways/pathwayStatusStateMachine.ts` and enforced it in `apps/api/src/features/treatment-pathways/pathwayService.ts` for both mutable surfaces:
    - `PATCH /pathways/:id` now validates status transitions and blocks terminal reopen (`completed/discontinued -> active`) with `422 INVALID_STATE_TRANSITION`.
    - `POST /pathways/:id/session` now requires `existing.status === 'active'`, blocking session writes against closed pathways.
  - Local: ✅ Controller-write bypass allowlist debt drained for treatment-pathway route patch/session mutation paths (removed stale `pathwayRoutes.ts -> pathwayRepository.update` entries from `check-controller-repo-write-bypass.allowlist`; guard replay PASS).
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/pathwayStatusStateMachine.test.ts` PASS (`4/4`) + `npm run test:integration -w apps/api -- tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts` PASS (`4/4`) + sibling lock-path replay `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` PASS (`7/7`) + `npm run typecheck` PASS + `npm run lint:changed` PASS + `npm run guard:claude-discipline:ci` PASS.
  - Evidence: `docs/quality/remediation/evidence/b3-bug-563-treatment-pathway-state-machine-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-561` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Closed snake_case/camelCase drift on treatment-pathway response contract:
    - `apps/web/src/features/treatment-pathways/pages/PathwaysPage.tsx` now consumes canonical camelCase-only fields (`pathwayType`, `pathwayName`, `totalSessions`, `completedSessions`, `startDate`, `lockVersion`) with no snake_case fallback path.
    - Pathway creation payload from the same page now emits canonical API fields (`name`, `pathwayName`, `totalSessions`) so UI and backend share one contract.
  - Local: ✅ Backend response mapping hardening in `apps/api/src/features/treatment-pathways/pathwayRoutes.ts`:
    - removed temporary fallback defaults that masked shape drift (`pathwayType ?? r.name`, `totalSessions ?? 0`, `completedSessions ?? 0`);
    - mapper now fails closed with explicit `PATHWAY_RESPONSE_SHAPE_INVALID` when canonical milestone fields are missing.
  - Local: ✅ Regression-proof extended in `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` (`TP-OL-7`) to assert response contains canonical camelCase fields and excludes snake_case siblings (`pathway_type`, `pathway_name`, `total_sessions`, `completed_sessions`).
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts` PASS (`7/7` + `4/4`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:claude-discipline:ci` PASS.
  - Evidence: `docs/quality/remediation/evidence/b3-bug-561-treatment-pathway-response-shape-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-289` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/integration/prescriberDisciplineBarrier.int.test.ts` PASS (`17/17`) including expanded allow-list discipline coverage.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-322` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/integration/clozapineDisciplineBarrier.int.test.ts` PASS (`12/12`) including denied-attempt audit path assertions.
  - Post-deploy: Commit rollout evidence and flip catalogue.
- [ ] `BUG-323` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/api/tests/integration/clozapineDisciplineBarrier.int.test.ts` PASS (`12/12`) including source-level service-routing assertion for non-prescribing handlers.
  - Local: ✅ Drained stale controller-write bypass allowlist debt for service-owned clozapine write paths (`createAdministration`, `createObservation`, `upsertMonitoringCheck`) from `scripts/guards/check-controller-repo-write-bypass.allowlist`.
  - Local: ✅ Response-boundary hardening + allowlist drain completed on 2026-05-14 for clozapine registration/blood-result controller surfaces:
    - `apps/api/src/features/clozapine/clozapineController.ts` now enforces explicit controller-boundary Zod parses on registration and blood-result list/single responses (`ClozapineRegistration*` / `ClozapineBloodResult*` response schemas).
    - `scripts/guards/check-response-shape-validated.allowlist` clozapine rows drained (`6` controller rows + `1` stale mapper-comment row removed).
  - Local proof: ✅ `npm run guard:controller-repo-write-bypass` PASS after drain.
  - Local proof: ✅ `npm run guard:response-shape-validated` PASS after clozapine allowlist drain + `npm run test:integration -w apps/api -- tests/integration/clozapineDisciplineBarrier.int.test.ts tests/integration/clozapineAncThresholdGuards.int.test.ts` PASS (`12/12` + `7/7`).
  - Evidence: `docs/quality/remediation/evidence/b2-clozapine-response-shape-allowlist-drain-2026-05-14.md`.
  - Post-deploy: Commit rollout evidence and flip catalogue.
- [ ] `BUG-324` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Reconfirmed on 2026-05-13: `apps/web/src/features/medications/hooks/usePrescriber.test.ts` PASS (`3/3`) for dual-gate FE eligibility (`prescriberNumber` + discipline eligibility).
  - Post-deploy: Commit rollout evidence and flip catalogue.
- [ ] `BUG-404` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Enforced mandatory instrument completeness at shared contract boundaries:
    - `packages/shared/src/outcome.Schemas.ts`: HoNOS/HoNOS65/HoNOSCA now require full item maps (`1..N`) with integer range checks; optional `totalScore` must match derived item total.
    - `packages/shared/src/risk.schemas.ts`: formal instrument risk assessments (`C-SSRS`/`CSSRS`/`Columbia`/`HoNOS`) now require `totalScore`, `scoreBand`, `riskNarrative`, `riskManagementPlan`, and `reviewDate`.
    - FE submit-path alignment so required items are always structurally present before save (`AssessmentsTab`, `InpatientOutcomesPanel`).
  - Local: ✅ Follow-up error-envelope hardening (2026-05-14) on `apps/api/src/features/outcomes/outcomeRoutes.ts`:
    - removed inline `res.status(422).json(...)` validation response on outcomes create;
    - migrated to canonical `next(new AppError(...))` envelope path so route-level validation failures are globally uniform and fail-closed under `guard:error-envelope-consistency`.
  - Local proof: ✅ Reconfirmed on 2026-05-14 — `npm run test:integration -w apps/api -- tests/integration/bug404AssessmentMandatoryFields.int.test.ts` PASS (`4/4`) + `npm run guard:error-envelope-consistency` PASS + `npm run guard:all` PASS. Evidence: `docs/quality/remediation/evidence/b2-bug-404-mandatory-instrument-fields-2026-05-14.md`, `docs/quality/remediation/evidence/b2-bug-404-error-envelope-hardening-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-461` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Shared legal-order response schema contract added in `packages/shared/src/legalOrder.Schemas.ts`:
    - `LegalOrderResponseSchema`
    - `LegalOrderListItemResponseSchema`
    - `LegalOrderListResponseSchema`
    - `LegalOrderCreateResponseSchema`
    - `LegalOrderUpdateResponseSchema`
  - Local: ✅ `apps/api/src/features/legal/legalOrderRoutes.ts` now imports and uses shared schemas directly (route-local duplicated response schema definitions removed).
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts` PASS (`5/5` + `6/6`) + `npm run lint:changed` PASS + `npm run typecheck` PASS.
  - Evidence: `docs/quality/remediation/evidence/b3-bug-461-shared-legal-order-response-schema-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-415` *(implementation landed; rollout-closure pending)*
  - Local: ✅ Added canonical referral transition SSoT `apps/api/src/features/referrals/referralStatusStateMachine.ts` and enforced it on both mutable surfaces:
    - `apps/api/src/features/referrals/referralRepository.ts` (`updateReferral` now applies transition guard with row-locking on status updates).
    - `apps/api/src/features/referrals/referralRoutes.ts` (`PATCH /by-episode/:episodeId` now validates current→next transition before update).
  - Local: ✅ Legacy status normalization is explicit (`draft/sent/pending/acknowledged/in_review/closed/completed`) so historical labels cannot bypass guard logic.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/referralStatusStateMachine.test.ts` PASS (`5/5`) + `npm run test:integration -w apps/api -- tests/integration/bug415ReferralStateMachine.int.test.ts` PASS (`4/4`) + `npm run typecheck` PASS + `npm run lint:changed` PASS + `npm run guard:claude-discipline:ci` PASS. Evidence: `docs/quality/remediation/evidence/b1-bug-415-referral-state-machine-2026-05-14.md`.
  - Post-deploy: Commit canary + burn-in evidence and flip catalogue.
- [ ] `BUG-EP-*` family *(lane-wide closure pending)*
  - Local: ✅ Phase-1 discharge-summary clinic-scope hardening landed in `apps/api/src/features/episode/episodeRoutes.ts`: drained id-only episode mutation/read pair on discharge-summary paths (`PATCH draft-save update` + `submit fetch`) to strict `{ id, clinic_id }` scoping.
  - Local: ✅ Cross-tenant negative-path proof added in `apps/api/tests/integration/episodeDischargeSummaryClinicScope.int.test.ts` (`404 Episode not found` + no discharge-review task side effect on foreign episode id).
  - Local: ✅ Phase-2 roster/allocation clinic-scope hardening landed in `apps/api/src/features/episode/episodeRoutes.ts`:
    - `GET /episodes/patients-by-clinician/:clinicianId` and `GET /episodes/patients-by-team/:team` now scope joined `patients` rows by clinic and soft-delete (`patients.clinic_id = req.clinicId` + `patients.deleted_at IS NULL`) in addition to episode scoping.
    - `GET /episodes/:id/allocation` team-name lookup now scopes `org_units` by both `id` and `clinic_id` (defense-in-depth against cross-clinic org-unit id drift).
  - Local: ✅ Phase-3 soft-delete hardening landed on discharge/closure episode surfaces in `apps/api/src/features/episode/episodeRoutes.ts`:
    - discharge generate/submit/sign/get and close-with-vetting/close-sign episode reads/updates now require `episodes.deleted_at IS NULL`.
    - discharge generate patient lookup now requires `patients.deleted_at IS NULL`.
  - Local: ✅ Phase-4 `AuthContext` convergence landed for `apps/api/src/features/episode/episodeService.ts` + controller boundary:
    - episode service methods (`create`, `update`, `getById`, `listForPatient`, `close`, `createFromReferral`) now require `auth: AuthContext` as first parameter.
    - `apps/api/src/features/episode/episodeController.ts` now builds canonical auth context (`buildAuthContext`) for all episode route handlers.
    - non-controller callers (`referralService`, `referralRoutes`, referral strategies, scheduler auto-close) now pass explicit auth context, including system context for scheduler paths.
  - Local: ✅ Phase-5 route error-envelope convergence landed for `apps/api/src/features/episode/episodeRoutes.ts`:
    - all inline `res.status(...).json(...)` error paths were migrated to canonical `throw new AppError(...)` boundaries (roster authorization, allocation validation, discharge/closure not-found, consultant-sign authorization).
    - `scripts/guards/check-error-envelope-consistency.allowlist` episode rows drained (`12` entries removed for `episodeRoutes.ts`).
  - Local: ✅ Phase-6 response-boundary + column SSoT residual drain landed:
    - `apps/api/src/features/episode/episodeController.ts` and `apps/api/src/features/episode/episodeRoutes.ts` now parse all key response envelopes at boundary, including discharge-summary branches.
    - `apps/api/src/features/episode/episodeRoutes.ts` now uses canonical JSONB extraction mappers for discharge-summary note/medication payloads.
    - `apps/api/src/features/episode/episodeRepository.ts` now uses generated `EPISODES_COLUMNS` (hand-written column-list drift point removed).
    - EP rows drained from `check-response-shape-validated`, `check-jsonb-extraction`, and `check-no-hardcoded-column-lists` allowlists.
  - Local: ✅ `check-service-auth-context.allowlist` debt drained for 6 legacy `episodeService.ts` signatures.
  - Local: ✅ `check-soft-delete-filter` allowlist debt drained for `episodeRoutes.ts` (`8` entries removed).
  - Local proof: ✅ `apps/api/tests/unit/bugEpisodeMdtLookupClinicId.test.ts` PASS (`5/5`) with new source guards pinning patient-join clinic scope and org-unit lookup clinic scope.
  - Local proof: ✅ `npm run guard:service-auth-context` PASS (`0` violations), `npm run typecheck` PASS, `npm run lint:changed` PASS, and
    `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts tests/integration/episodeStateMachine.test.ts tests/integration/bugEpisodeMdtSaveRace.int.test.ts` PASS (`2/2`, `2/2`, `5/5`, `3/3`).
  - Local proof: ✅ `npm run guard:soft-delete-filter` PASS after phase-3 drain + `npm run guard:error-envelope-consistency` PASS after phase-5 drain.
  - Local proof: ✅ EP residual replay PASS — `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts` (`5/5`) + `npm run test:integration -w apps/api -- tests/integration/episodeDischargeSummaryClinicScope.int.test.ts` (`1/1`) + `npm run guard:response-shape-validated` PASS + `npm run guard:jsonb-extraction` PASS + `npm run guard:no-hardcoded-column-lists` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/b1-ep-family-phase2-roster-allocation-clinic-scope-2026-05-14.md`, `docs/quality/remediation/evidence/b1-rf-ep-soft-delete-filter-drain-2026-05-14.md`, `docs/quality/remediation/evidence/b1-ep-service-auth-context-migration-2026-05-14.md`, `docs/quality/remediation/evidence/b1-ep-error-envelope-hardening-2026-05-14.md`, `docs/quality/remediation/evidence/b1-ep-response-boundary-and-column-ssot-2026-05-14.md`.
  - Local: ✅ EP-family local engineering residuals are complete for current B1 scope; remaining work is rollout closure evidence.
  - Post-deploy: Lane-wide evidence committed; per-bug catalogue flips.
- [ ] `BUG-RF-*` family *(lane-wide closure pending)*
  - Local: ✅ Phase-1 command-ownership hardening landed for clarification mutation paths (`apps/api/src/features/referrals/referralRoutes.ts`): drained route-level repository writes for `POST /:id/clarification` and `PATCH /:id/clarification-response` into dedicated command module `referralClarificationCommands.ts` (`requestClarification`, `applyClarificationResponse`) with deterministic 404-not-found handling + audit/workflow event consistency.
  - Local: ✅ Regression-proof added in `apps/api/tests/integration/bugRfClarificationCommandOwnership.int.test.ts` (`2/2` PASS) and `check-controller-repo-write-bypass.allowlist` entries drained for the four prior referral route write bypasses.
  - Local: ✅ Phase-2 `AuthContext` migration landed for `apps/api/src/features/referrals/referralFeedbackService.ts`:
    - `sendAcceptanceFeedback`, `sendRejectionFeedback`, `sendClosedNoResponseFeedback`, and `sendClarificationRequest` now require `auth: AuthContext` as first parameter (no raw `(clinicId, userId, ...)` service signature).
    - Callers updated across solo/team strategy paths and clarification command path.
    - Scheduler closure-feedback path now supplies explicit synthesized system auth context for non-request execution.
  - Local: ✅ `check-service-auth-context.allowlist` debt drained for 4 referral-feedback entries.
  - Local: ✅ Phase-3 soft-delete hardening landed across RF runtime paths:
    - `apps/api/src/features/referrals/referralFeedbackService.ts` staff lookup now requires `staff.deleted_at IS NULL`.
    - `apps/api/src/features/referrals/strategies/teamStrategy.ts` both clinician lookups now require `staff.deleted_at IS NULL`; patient-name lookup now requires `patients.deleted_at IS NULL`.
    - `apps/api/src/jobs/schedulers/referralSlaScheduler.ts` patient lookup now requires `patients.deleted_at IS NULL`.
  - Local: ✅ `check-soft-delete-filter.allowlist` debt drained for RF surfaces (`7` entries removed total: feedback/team-strategy/scheduler + residual referralRoutes rows).
  - Local: ✅ Phase-4 command consolidation landed for referral state mutations in `apps/api/src/features/referrals/referralRoutes.ts`:
    - `PATCH /referrals/by-episode/:episodeId` write path extracted into `referralStateCommands.updateReferralStatusByEpisode(...)`.
    - `POST /referrals/:id/notes` write path extracted into `referralStateCommands.appendReferralNote(...)`.
    - Route handlers now orchestrate validation + command invocation only; inline mutation orchestration removed from route surface.
  - Local: ✅ Phase-5 command consolidation landed for referral task transitions:
    - Added `apps/api/src/features/referrals/referralTaskCommands.ts` with command surfaces for `triageReferral`, `assignReferral`, `acceptReferral`, `declineReferral`.
    - `POST /referrals/:id/triage`, `POST /referrals/:id/assign`, `POST /referrals/:id/accept`, and `POST /referrals/:id/decline` now delegate to command functions (no route-level transition orchestration).
  - Local: ✅ Phase-6 RBAC closure landed for referral mutation surfaces in `apps/api/src/features/referrals/referralRoutes.ts`:
    - Added centralized permission middleware constants:
      - `canCreateReferral = requirePermission('referral:create')`
      - `canUpdateReferral = requirePermission('referral:update')`
      - `canTriageReferral = requirePermission('referral:triage')`
      - `canAssignReferral = requirePermission('referral:assign')`
    - Applied these gates to mutation endpoints (`POST /`, `PATCH /:id`, `PATCH /by-episode/:episodeId`, task transition routes, note routes, decision/attachment/OCR/allocate/offers-respond routes) to eliminate residual role/permission drift risk on RF write paths.
  - Local: ✅ Regression-proof RBAC matrix added in `apps/api/tests/integration/bugRfRbacPermissionMatrix.int.test.ts`:
    - receptionist denied `triage` (`403`) while clinician allowed (`200`),
    - clinician denied `assign` (`403`) while referral coordinator allowed (`200`).
  - Local proof: ✅ `npm run guard:service-auth-context` PASS (`0` violations), `bugRfClarificationCommandOwnership.int.test.ts` PASS (`2/2`), `bug602SchedulerCascadeRlsClose.int.test.ts` PASS (`2/2`), `npm run lint:changed` PASS, `npm run typecheck` PASS.
  - Local proof: ✅ `apps/api/tests/unit/bugRfSoftDeleteScope.test.ts` PASS (`4/4`) + `npm run guard:soft-delete-filter` PASS.
  - Local proof: ✅ `apps/api/tests/integration/bugRfReferralStateCommandOwnership.int.test.ts` PASS (`2/2`) + `apps/api/tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts` PASS (`2/2`) + `apps/api/tests/integration/bugRfClarificationCommandOwnership.int.test.ts` PASS (`2/2`) + `npm run guard:controller-repo-write-bypass` PASS + `npm run guard:query-has-clinic-id` PASS + `npm run guard:response-shape-validated` PASS.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/bugRfRbacPermissionMatrix.int.test.ts tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts` PASS (all `4/4` files green) + sibling replay `tests/integration/bug415ReferralStateMachine.int.test.ts` PASS (`4/4`) + `npm run guard:claude-discipline:ci` PASS.
  - Evidence: `docs/quality/remediation/evidence/b1-rf-feedback-auth-context-migration-2026-05-14.md`, `docs/quality/remediation/evidence/b1-rf-ep-soft-delete-filter-drain-2026-05-14.md`, `docs/quality/remediation/evidence/b1-rf-state-command-consolidation-2026-05-14.md`, `docs/quality/remediation/evidence/b1-rf-task-transition-command-consolidation-2026-05-14.md`, `docs/quality/remediation/evidence/b1-rf-rbac-matrix-closure-2026-05-14.md`.
  - Local: ✅ RF-family local RBAC/cross-tenant matrix residual for current B1 scope is complete; remaining work is rollout/post-deploy evidence and broader non-RF family backlog.
  - Post-deploy: Endpoint matrix evidence + per-bug flips.
- [ ] `BUG-ECT-*` family *(lane-wide closure pending)*
  - Local: ✅ Phase-1 module-access rail convergence + course-lineage relationship hardening:
    - `apps/api/src/features/ect/ectRoutes.ts` now enforces `requireModuleRead(MODULE_KEYS.ECT)` at router level and `requireModuleWrite(MODULE_KEYS.ECT)` on both mutation endpoints.
    - `apps/api/src/features/ect/ectService.ts` course-linked session surfaces now require specialty + relationship on the resolved course patient:
      - `recordSession(...)` adds `requireSpecialty(...)` and `requirePatientRelationship(auth, course.patient_id)`
      - `listSessionsByCourse(...)` resolves course with clinic scope, fails closed on not-found, then enforces `requirePatientRelationship(...)`.
  - Local: ✅ Phase-2 response-shape hardening landed for ECT route boundary:
    - `apps/api/src/features/ect/ectRoutes.ts` now validates every response payload before `res.json(...)` (`EctCourseResponseSchema`, `EctSessionResponseSchema`, `EctByPatientResponseSchema`, `EctCourseSessionsResponseSchema`).
    - `scripts/guards/check-response-shape-validated.allowlist` ECT rows drained (`4` entries removed for `ectRoutes.ts`).
  - Local: ✅ Phase-3 safety-surface audit-log convergence landed for ECT service mutations:
    - `apps/api/src/features/ect/ectService.ts` now emits canonical `writeAuditLog(...)` on both mutation paths (`createCourse`, `recordSession`) instead of non-canonical wrapper calls.
    - `scripts/guards/check-safety-surface-audit-log.allowlist` ECT entries drained (`2` rows removed), making ECT mutation audit enforcement fail-closed under global guard.
  - Local: ✅ Phase-4 live matrix proof landed for session-lineage and clinic-scope denial:
    - Added `apps/api/tests/integration/bugEctTmsSessionRelationshipScope.int.test.ts`.
    - Matrix asserts own-clinic positive (`201`) and foreign-course by-id denial (`404`) on ECT session create/read surfaces.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts` PASS (`8/8`) + `npm run test:integration -w apps/api -- tests/integration/bugEctTmsSessionRelationshipScope.int.test.ts` PASS (`6/6`) + `npm run guard:response-shape-validated` PASS + `npm run guard:safety-surface-audit-log` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/b3-ect-tms-module-relationship-hardening-2026-05-14.md`, `docs/quality/remediation/evidence/b3-ect-tms-safety-audit-log-drain-2026-05-14.md`, `docs/quality/remediation/evidence/b3-ect-tms-session-lineage-matrix-2026-05-14.md`.
  - Local: ✅ ECT-family local engineering residuals are complete for current B3 scope; remaining work is rollout closure evidence.
  - Post-deploy: Lane evidence + per-bug flips.
- [ ] `BUG-TMS-*` family *(lane-wide closure pending)*
  - Local: ✅ Phase-1 module-access rail convergence + course-lineage relationship hardening:
    - `apps/api/src/features/tms/tmsRoutes.ts` now enforces `requireModuleRead(MODULE_KEYS.TMS)` at router level and `requireModuleWrite(MODULE_KEYS.TMS)` on both mutation endpoints.
    - `apps/api/src/features/tms/tmsService.ts` course-linked session surfaces now require specialty + relationship on the resolved course patient:
      - `recordSession(...)` adds `requireSpecialty(...)` and `requirePatientRelationship(auth, course.patient_id)`
      - `listSessionsByCourse(...)` resolves course with clinic scope, fails closed on not-found, then enforces `requirePatientRelationship(...)`.
  - Local: ✅ Phase-2 response-shape hardening landed for TMS route boundary:
    - `apps/api/src/features/tms/tmsRoutes.ts` now validates every response payload before `res.json(...)` (`TmsCourseResponseSchema`, `TmsSessionResponseSchema`, `TmsByPatientResponseSchema`, `TmsCourseSessionsResponseSchema`).
    - `scripts/guards/check-response-shape-validated.allowlist` TMS rows drained (`4` entries removed for `tmsRoutes.ts`).
  - Local: ✅ Phase-3 safety-surface audit-log convergence landed for TMS service mutations:
    - `apps/api/src/features/tms/tmsService.ts` now emits canonical `writeAuditLog(...)` on both mutation paths (`createCourse`, `recordSession`) instead of non-canonical wrapper calls.
    - `scripts/guards/check-safety-surface-audit-log.allowlist` TMS entries drained (`2` rows removed), making TMS mutation audit enforcement fail-closed under global guard.
  - Local: ✅ Phase-4 live matrix proof landed for session-lineage and clinic-scope denial:
    - Added `apps/api/tests/integration/bugEctTmsSessionRelationshipScope.int.test.ts`.
    - Matrix asserts own-clinic positive (`201`) and foreign-course by-id denial (`404`) on TMS session create/read surfaces.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts` PASS (`8/8`) + `npm run test:integration -w apps/api -- tests/integration/bugEctTmsSessionRelationshipScope.int.test.ts` PASS (`6/6`) + `npm run guard:response-shape-validated` PASS + `npm run guard:safety-surface-audit-log` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/b3-ect-tms-module-relationship-hardening-2026-05-14.md`, `docs/quality/remediation/evidence/b3-ect-tms-safety-audit-log-drain-2026-05-14.md`, `docs/quality/remediation/evidence/b3-ect-tms-session-lineage-matrix-2026-05-14.md`.
  - Local: ✅ TMS-family local engineering residuals are complete for current B3 scope; remaining work is rollout closure evidence.
  - Post-deploy: Lane evidence + per-bug flips.
- [ ] `BUG-ONC-*` family *(lane-wide closure pending)*
  - Local: ✅ Phase-1 controller-write bypass drain + clinic-lineage command hardening landed on oncology routes:
    - Added `apps/api/src/features/oncology/oncologyService.ts` as canonical service-owner surface (AuthContext-first methods for all list/create oncology endpoints).
    - Rewired `apps/api/src/features/oncology/oncologyRoutes.ts` to route through service methods; route-level direct repository writes removed.
    - Added parent-lineage checks before child writes (condition/plan ownership must resolve within caller clinic, with patient relationship enforcement before writes).
    - Added `treatmentPlanRepo.findById(...)` in `apps/api/src/features/oncology/oncologyRepository.ts` for clinic-scoped plan lineage checks.
  - Local: ✅ Drained stale controller-write allowlist debt for oncology route write paths (removed six `oncologyRoutes.ts -> *Repo.create` rows from `scripts/guards/check-controller-repo-write-bypass.allowlist`).
  - Local: ✅ Phase-2 response-shape hardening landed for oncology route boundary:
    - `apps/api/src/features/oncology/oncologyRoutes.ts` now uses schema-validated response envelopes for all list/write surfaces:
      - list: `ConditionsListResponseSchema`, `TnmListResponseSchema`, `EcogListResponseSchema`, `TreatmentPlansListResponseSchema`, `ChemoCyclesListResponseSchema`, `TumourBoardListResponseSchema`
      - write: `ConditionWriteResponseSchema`, `TnmWriteResponseSchema`, `EcogWriteResponseSchema`, `TreatmentPlanWriteResponseSchema`, `ChemoCycleWriteResponseSchema`, `TumourBoardWriteResponseSchema`
    - shared response SSoT consumption enforced via `@signacare/shared` oncology response schemas at parse boundary.
    - `scripts/guards/check-response-shape-validated.allowlist` oncology rows drained (`12` entries removed for `oncologyRoutes.ts`).
  - Local: ✅ Phase-3 CTCAE contract hardening landed for chemo-cycle toxicity payloads:
    - `packages/shared/src/oncology.schemas.ts` now treats `toxicityCtcae` as bounded clinical contract instead of unconstrained JSON:
      - accepted value shapes are `0..5` grade map values (legacy-compat bridge), or structured CTCAE event objects (`term`, bounded `grade`, optional attribution/seriousness/observedAt/notes).
      - out-of-range or structurally invalid toxicity payloads now fail at route boundary parse (fail-closed).
    - `ChemoCycleResponseSchema` now validates response-side `toxicityCtcae` against the same contract.
  - Local: ✅ Phase-4 JSONB extraction mapper convergence landed for chemo-cycle response mapping:
    - `apps/api/src/features/oncology/oncologyRepository.ts` now exports canonical `mapChemoCycleToResponse(...)` with deterministic JSONB extraction for `dose_modifications` and `toxicity_ctcae`.
    - `apps/api/src/features/oncology/oncologyRoutes.ts` now consumes the canonical mapper for list/write cycle responses (route-local duplicate JSONB parse path removed).
    - `scripts/guards/check-jsonb-extraction.allowlist` oncology entry drained (`apps/api/src/features/oncology/oncologyRepository.ts` removed).
  - Local proof: ✅ `apps/api/tests/integration/bugOncCtcaeContract.int.test.ts` PASS (`2/2`) with positive create-path acceptance and negative `grade > 5` validation rejection (`422 VALIDATION_ERROR`).
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts` PASS (`2/2`) with cross-tenant negative-path assertions:
    - stage-group create rejects foreign-clinic `conditionId` (`404 NOT_FOUND`)
    - chemo-cycle create rejects foreign-clinic `planId` (`404 NOT_FOUND`)
  - Local proof: ✅ `npm run guard:jsonb-extraction` PASS after ONC allowlist drain (no file-level exemption remains for `oncologyRepository.ts`).
  - Local proof: ✅ `npm run guard:controller-repo-write-bypass` PASS + `npm run guard:service-auth-context` PASS + `npm run guard:query-has-clinic-id` PASS + `npm run guard:response-shape-validated` PASS + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:claude-discipline:ci` PASS + source-regression pins `apps/api/tests/unit/bugOncologyResponseShapeValidation.test.ts` PASS (`2/2`).
  - Evidence: `docs/quality/remediation/evidence/b3-onc-command-ownership-clinic-lineage-2026-05-14.md`, `docs/quality/remediation/evidence/b3-ect-tms-onc-response-shape-hardening-2026-05-14.md`, `docs/quality/remediation/evidence/b3-onc-ctcae-contract-hardening-2026-05-14.md`.
  - Local: ✅ ONC-family local engineering residuals are complete for current B3 scope (including CTCAE contract + clinic-lineage matrix + mapper source-guard replay); remaining work is rollout closure evidence.
  - Post-deploy: Lane evidence + per-bug flips.
- [ ] `BUG-LG-*` family *(lane-wide closure pending)*
  - Local: ✅ Legal-order command ownership + response-boundary convergence is active on dedicated module `apps/api/src/features/legal/legalOrderRoutes.ts` + `legalOrderCrudService.ts` (schema-validated responses, AuthContext-first command surface, canonical legal-order audit actions).
  - Local: ✅ Contact side-effect idempotency hardening landed for legal-order-driven auto-contact creation:
    - `apps/api/src/features/contacts/autoContactRecord.ts` now uses transaction-scoped advisory locking + deterministic existing-row reuse for `(clinicId, sourceId)`.
    - Reuse path now emits debug-level reuse log instead of duplicate "Auto-created" info rows.
    - `apps/api/src/middleware/contactRecordMiddleware.ts` post-response write path now uses `dbAdmin` + explicit tenant scoping to avoid completed-request transaction reuse.
  - Local: ✅ Regression-proof extended:
    - `apps/api/tests/unit/bugLegalOrderCommandOwnershipAndResponseShape.test.ts` (`3/3`) pins legal-order command ownership + response parse boundaries.
    - `apps/api/tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts` now verifies one-and-only-one contact record per legal-order source id.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/bugLegalOrderCommandOwnershipAndResponseShape.test.ts` PASS (`3/3`) + `npm run test:integration -w apps/api -- tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts` PASS (`5/5` + `6/6`) + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/b3-bug-461-shared-legal-order-response-schema-2026-05-14.md`, `docs/quality/remediation/evidence/b3-lg-legal-order-command-ownership-idempotency-hardening-2026-05-14.md`.
  - Post-deploy: Lane evidence + per-bug flips.
- [ ] `BUG-AD-*` family *(lane-wide closure pending)*
  - Local: ✅ Phase-1 role-literal drain landed on advance-directive surface (`apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts`): route-local `requireRoles([...])` removed, replaced with canonical `requireClinicalAccessRole(buildAuthContext(req))` middleware + existing module/read and service-permission rails.
  - Local: ✅ Regression prevention guard added: `scripts/guards/check-no-hardcoded-role-literal-advance-directives.ts` (`npm run guard:no-hardcoded-role-literal-advance-directives`) and wired into global guard pack.
  - Local: ✅ BUG-638 cascade debt drain confirmed for advance-directive response boundary:
    - removed `3` stale allowlist rows for `apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts` from `scripts/guards/check-response-shape-validated.allowlist`.
    - guard now accepts this surface as canonical mapper usage with no file-level exemption.
  - Local: ✅ Phase-2 mutation-surface denial proof extended:
    - `apps/api/tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts` now asserts receptionist is denied with deterministic `403 CLINICAL_ACCESS_DENIED` on all critical AD surfaces: GET list, POST create, and PATCH update.
  - Local: ✅ Phase-3 JSONB extraction guard debt drained for AD route surface:
    - Removed stale `check-jsonb-extraction` allowlist row for `apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts`.
    - AD route/repository pair already uses canonical response mapper (`mapAdvanceDirectiveRowToResponse`) for JSONB-bearing directive content extraction; no route-level exemption remains for this file.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts` PASS (`3/3`) for GET/POST/PATCH denial matrix.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/bug565AdvanceDirectiveOptimisticLock.int.test.ts` PASS (`4/4`) and `npm run guard:jsonb-extraction` PASS after AD allowlist drain.
  - Local proof: ✅ `npm run guard:response-shape-validated` PASS after allowlist drain.
  - Evidence: `docs/quality/remediation/evidence/b3-ad-clinical-access-mutation-denial-2026-05-14.md`, `docs/quality/remediation/evidence/b3-ad-jsonb-extraction-allowlist-drain-2026-05-14.md`.
  - Local: ✅ AD-family local engineering residuals are complete for current B3 scope; remaining work is rollout closure evidence.
  - Post-deploy: Attach canary/burn-in evidence before per-bug catalogue flips.

## A4b — Security / Privacy / Observability Hardening

- [ ] `BUG-278`
  - Local: ✅ Deploy-time verification contract landed (2026-05-13): host-side fail-closed probe `apps/api/scripts/verify-ollama-log-hygiene.mjs` + npm entrypoint `probe:ollama-log-hygiene`, production template safety default `OLLAMA_DEBUG=false` in `deploy/env.production.example`, and runbook wiring in `docs/guides/deployment-guide.md` + `docs/archive/audit-2026-04-19/follow-up-on-cloud-deploy.md`. Evidence: `docs/quality/remediation/evidence/a4b-bug-278-ollama-log-hygiene-2026-05-13.md`.
  - Post-deploy: Execute probe on canary/prod host with real Ollama log paths, attach PASS evidence, and record required security/compliance signoff before catalogue flip.
- [ ] `BUG-306`
  - Local: ✅ Synchronous shutdown flush landed (2026-05-13): logger now owns explicit pino destination + exported `flushLoggerSync()`, and server registers priority-5 `pino-sync-flush` hook in canonical graceful-shutdown registry. Regression pins added (`pinoFlushSync.test.ts` + gracefulShutdown T11). Evidence: `docs/quality/remediation/evidence/a4b-bug-306-pino-shutdown-flush-2026-05-13.md`.
  - Post-deploy: Execute canary shutdown drill, attach durability evidence, and flip catalogue after burn-in contract.
- [ ] `BUG-310`
  - Local: ✅ Per-clinic integration-config drift detection landed (2026-05-14) via `apps/api/src/shared/perClinicIntegrationConfigDrift.ts` and auth-chain wiring in `apps/api/src/middleware/authMiddleware.ts`.
  - Local: ✅ Drift checks now execute once-per-clinic (admin/superadmin-only) and fail-visible on mismatch for feature/runtime contract and clinic-scoped identifiers:
    - feature flag ON without required runtime env (`integration-mhr-docref`, `integration-radiology-hl7`, `integration-healthlink`),
    - clinic `hpio` missing when eRx runtime is configured,
    - clinic `npds_conformance_id` missing when NPDS runtime is configured.
  - Local: ✅ Drift event now emits authoritative evidence on detection:
    - audit action `CLINIC_INTEGRATION_CONFIG_DRIFT`,
    - admin alert kind `integration_config_drift`,
    - warning notification fanout (`sse` + `bell`) to admin channel.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/bug310PerClinicIntegrationConfigDrift.test.ts` PASS (`5/5`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4b-bug-310-per-clinic-integration-config-drift-2026-05-14.md`.
  - Post-deploy: Execute canary drift probe walk (intentional mismatch + recovery), attach alert/audit evidence and burn-in packet, then flip catalogue.
- [ ] `BUG-312`
  - Local: ✅ Non-pino runtime error/warn hardening landed (2026-05-14):
    - migrated residual runtime console paths on active clinical surfaces to structured pino:
      - `apps/api/src/mcp/localLlmAgent.ts` (`local_llm_generate_failed`, `local_llm_generate_fallback`)
      - `apps/api/src/features/patients/zitaviSyncRoutes.ts` (`zitavi_integration_disabled`)
    - added fail-closed structural guard `scripts/guards/check-non-pino-error-paths.ts`, wired as `npm run guard:non-pino-error-paths` and enforced in global `guard:all`.
  - Local: ✅ Guard contract blocks `console.error`/`console.warn` in runtime app paths outside explicit bootstrap allowlist (boot-time/system boundaries only).
  - Local proof: ✅ `npm run guard:non-pino-error-paths` PASS + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4b-bug-312-non-pino-error-path-hardening-2026-05-14.md`.
  - Post-deploy: canary log review confirms no new raw runtime console error/warn signatures on clinical request paths; attach evidence and burn-in packet before catalogue flip.
- [ ] `BUG-313`
  - Local: ✅ Third-party logger PHI hardening landed (2026-05-14):
    - added shared third-party audit hooks `apps/api/src/shared/thirdPartyErrorAudit.ts` and wired them in `apps/api/src/db/db.ts` across app-user/read-replica/admin pools:
      - knex `query-error` emits fail-visible pino error with structural metadata (`sqlVerb`, connection/query ids) and raw `err` object,
      - pg client `error` events are captured on connection create (`afterCreate`) with pool-role tagging.
    - hardened BullMQ/worker-adjacent paths so logger receives raw `err` objects (no `err.message` interpolation) on failure channels:
      - `patientOutreachWorker.ts`, `ocrQueue.ts`, `hl7Worker.ts`, `aiWorker.ts`, `jobs/bootstrap.ts`, `adminAlert.ts`.
    - added fail-closed structural guard `scripts/guards/check-third-party-error-audit.ts` (`npm run guard:third-party-error-audit`) and integrated it into global `guard:all`.
    - added regression tests:
      - `apps/api/tests/unit/bug313ThirdPartyErrorAudit.test.ts` (`3/3`),
      - `scripts/guards/__tests__/check-third-party-error-audit.test.ts` (`3/3`).
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/bug313ThirdPartyErrorAudit.test.ts` PASS + `npm run test:guards -- --run scripts/guards/__tests__/check-third-party-error-audit.test.ts` PASS + `npm run guard:third-party-error-audit` PASS + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4b-bug-313-third-party-logger-phi-audit-2026-05-14.md`.
  - Post-deploy: run canary log replay on knex/pg/BullMQ failure signatures, attach burn-in and post-burn-in evidence, then flip catalogue.
- [ ] `BUG-326`
  - Local: ✅ Governance dashboard surface landed (2026-05-14):
    - compliance summary now includes governance counters from canonical bypass audit events:
      - `governance.llmBypassLast30Days`
      - `governance.llmBypassLast90Days`
    - new tenant-scoped audit endpoint mounted:
      - `GET /api/v1/reports/llm-bypass-audit`
      - filters: `startDate`, `endDate`, `staffId`, `endpoint`, `limit`
      - payload: rolling counts + per-staff breakdown + per-endpoint breakdown + event feed
    - fail-closed API contract enforced with `LlmBypassAuditResponseSchema.parse(...)`
      and `AppError` validation envelope behavior for invalid query inputs.
    - compliance dashboard UI now renders both bypass counters as first-class governance cards.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/bug326LlmBypassGovernanceDashboard.int.test.ts` PASS (`3/3`) + `npm run test:integration -w apps/api -- tests/integration/reportsRoutesHealth.int.test.ts` PASS (`5/5`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4b-bug-326-llm-bypass-governance-dashboard-2026-05-14.md`.
  - Post-deploy: run canary governance replay (known bypass audit sample + summary rollover check), attach burn-in and post-burn-in verification packet, then flip catalogue.
- [ ] `BUG-328`
  - Local: ✅ LLM bypass audit write-failure alert signal landed (2026-05-14):
    - `writeAuditLog` now emits alert-ready structured metadata when the failing action is `LLM_ACCESS_BYPASS_ROLE`:
      - `alertKind: llm_access_bypass_audit_write_failed`
      - `bugId: BUG-328`
      - `action: LLM_ACCESS_BYPASS_ROLE`
    - signal is attached across all audit write-failure branches (primary insert failure, legacy-retry failure, non-staff retry failure, and outer fallback catch), preserving current bounded-failure/outbox behavior.
    - regression pin added in `apps/api/tests/unit/auditWriteTimeoutFallback.test.ts` (`BUG-328-1`) to assert error logs carry the exact alert-ready metadata for bypass-audit failures.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/auditWriteTimeoutFallback.test.ts` PASS (`6/6`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4b-bug-328-llm-bypass-audit-write-failure-alert-2026-05-14.md`.
  - Post-deploy: confirm log pipeline alert binding for `alertKind=llm_access_bypass_audit_write_failed` fires in canary replay; attach burn-in and post-burn-in verification before catalogue flip.
- [ ] `BUG-338`
  - Local: ✅ BUG-296 WARN-mode Sentry signal landed (2026-05-14):
    - added dedicated signal helper `apps/api/src/shared/prescriberHpiiWarnSignal.ts` with explicit `BUG-338` semantics:
      - emits warning-level Sentry signal for BUG-296 WARN-mode HPI-I gate degradations,
      - stable signal tags/fingerprint for alert routing,
      - bounded in-process throttling (15-minute window per clinic+staff+shape) to prevent alert storms.
    - wired `requireValidHpii` WARN branch to call `emitPrescriberHpiiWarnModeSignal(...)` after structured WARN logging (preserves existing WARN-before-FAIL rollout contract).
    - capture-failure path is fail-open (clinical flow unaffected) with structured warn context for observability.
    - regression proof added in `apps/api/tests/unit/prescriberHpiiWarnSignal.test.ts`:
      - no-DSN skip,
      - DSN-enabled emit,
      - duplicate throttling,
      - post-window re-emit.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/prescriberHpiiWarnSignal.test.ts` PASS (`4/4`) + `npm run test:integration -w apps/api -- tests/integration/hpiiValidation.int.test.ts` PASS (`12/12`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4b-bug-338-bug296-warn-mode-sentry-signal-2026-05-14.md`.
  - Post-deploy: validate alert rule wiring for BUG-338 fingerprint/tags in canary Sentry project, attach burn-in/post-burn-in evidence, then flip catalogue.

## A4c — Platform Hygiene + LLM Runtime Governance

- [ ] `BUG-270`
  - Local: ✅ redactPhi traversal hardening landed (2026-05-14):
    - replaced full-tree clone behavior with cycle-safe copy-on-write traversal in `apps/api/src/utils/phiFields.ts`:
      - untouched non-PHI branches now preserve reference identity (no unnecessary cloning on large operational payloads),
      - only PHI-affected branches are cloned and redacted,
      - WeakMap memoization prevents recursion blowups on self-referential debug payloads.
    - runtime contract preserved:
      - PHI field-name taxonomy and redaction semantics unchanged (`[REDACTED]`),
      - no mutation of source payload,
      - existing logger formatters/redact.paths behavior unaffected.
    - regression pins added in `apps/api/tests/unit/loggerRedaction.test.ts`:
      - BUG-270 copy-on-write fast-path reference stability,
      - touched-branch-only clone behavior,
      - cycle-safe traversal proof (self-reference preserved after redaction, no source mutation).
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/loggerRedaction.test.ts` PASS (`12/12`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-270-redactphi-traversal-hardening-2026-05-14.md`.
  - Post-deploy: validate canary log-volume/latency delta on high-throughput scheduler + scribe paths, attach burn-in and post-burn-in verification packet, then flip catalogue.
- [ ] `BUG-285`
  - Local: ✅ fail-closed disclaimer-envelope guard landed (2026-05-14):
    - added new structural CI guard `scripts/guards/check-llm-disclaimer-envelope.ts` and wired it into global guard execution via `guard:llm-disclaimer-envelope`.
    - guard enforces canonical `disclaimer: CLINICAL_AI_DISCLAIMER` envelope on all sanctioned clinical-AI response surfaces:
      - `POST /llm/suggest` (via `llmController.suggest`),
      - `POST /llm/clinical-ai`,
      - `POST /llm/agent`,
      - `POST /scribe/patient-summary`,
      - `POST /scribe/referral-letter`.
    - guard is fail-closed on drift:
      - route removed/renamed,
      - route handler rewired away from sanctioned handler,
      - disclaimer field removed from response envelope.
    - added regression tests `scripts/guards/__tests__/check-llm-disclaimer-envelope.test.ts`:
      - passing fixture,
      - `/clinical-ai` disclaimer removal failure,
      - `/suggest` disclaimer removal failure.
  - Local proof: ✅ `npx vitest run --config ./vitest.config.ts scripts/guards/__tests__/check-llm-disclaimer-envelope.test.ts` PASS (`3/3`) + `npm run guard:llm-disclaimer-envelope` PASS + `npm run lint:changed` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-285-llm-disclaimer-envelope-guard-2026-05-14.md`.
  - Post-deploy: verify protected-branch CI enforces the new guard in the release gate and attach burn-in/post-burn-in evidence before catalogue flip.
- [ ] `BUG-308`
  - Local: ✅ shutdown observability dashboard plumbing landed (2026-05-14):
    - canonical graceful-shutdown registry now emits bounded run telemetry in `apps/api/src/shared/gracefulShutdown.ts`:
      - per-hook metrics: `durationMs`, `timeoutMs`, `priority`, and outcome (`completed` / `failed` / `timed_out` / `skipped_budget`),
      - run-level summary counters + budget-exhaustion signal,
      - rolling 24-hour aggregate snapshot (`getGracefulShutdownObservabilitySnapshot()`).
    - compliance reporting surfaces now expose shutdown reliability metrics:
      - `GET /api/v1/reports/compliance/summary` includes `platformReliability` rollups,
      - new fail-closed endpoint `GET /api/v1/reports/compliance/shutdown-observability` (Zod-validated payload) exposes per-hook metrics for dashboard consumption.
    - compliance dashboard UI now renders a dedicated Platform Reliability section with:
      - shutdown cards (runs/timeouts/failures/max duration/last total duration),
      - per-hook table (invocations, timed-out/failed counts, avg/max duration, max timeout).
    - regression pins:
      - `apps/api/tests/unit/gracefulShutdownObservability.test.ts` (`BUG-308-1/2`) for empty-snapshot and per-hook outcome metrics,
      - `apps/api/tests/integration/reportsRoutesHealth.int.test.ts` now asserts summary+detail shutdown payload shape.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/gracefulShutdownObservability.test.ts` PASS (`2/2`) + `npm run test:integration -w apps/api -- tests/integration/reportsRoutesHealth.int.test.ts` PASS (`6/6`) + `npm run test:integration -w apps/api -- tests/integration/gracefulShutdown.int.test.ts` PASS (`11/11`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-308-shutdown-observability-dashboard-2026-05-14.md`.
  - Post-deploy: run canary shutdown drill, attach burn-in + post-burn-in telemetry packet, then flip catalogue.
- [ ] `BUG-311`
  - Local: ✅ SafeScript `.checked` persistence + typed contract hardening landed (2026-05-14):
    - moved SafeScript request/result schemas into shared SSoT (`packages/shared/src/safeScript.schemas.ts`) and exported via `@signacare/shared`;
    - `prescriptionController.runSafeScriptCheck` now parses request body with shared `SafeScriptPatientIdentifierSchema` (single contract surface);
    - `safeScriptService.checkPatient` now returns only `SafeScriptCheckResultSchema`-validated payloads across configured and error paths;
    - `prescriptionRepository.updateSafescriptResult(...)` is now a real persistence path (no-op stub removed): writes `safescript_checked`, `safescript_checked_at`, `safescript_result` and fails loudly on not-found rows;
    - response mapping now normalizes persisted payloads through `SafeScriptCheckResultSchema.safeParse(...)`, dropping drifted payloads with structured warning signal instead of leaking unknown shapes to clients.
    - regression pin: `apps/api/tests/integration/bug311SafeScriptCheckedContract.int.test.ts`
      - persists checked=true result to DB + API response contract,
      - malformed SafeScript payload returns `422 VALIDATION_ERROR` and leaves persisted state unchanged.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/bug311SafeScriptCheckedContract.int.test.ts` PASS (`2/2`) + `npm run test:integration -w apps/api -- tests/integration/prescriptionsDisciplineBarrier.int.test.ts` PASS (`9/9`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-311-safescript-checked-contract-2026-05-14.md`.
  - Post-deploy: replay canary SafeScript-check workflow + burn-in + post-burn-in verification before catalogue flip.
- [ ] `BUG-314`
  - Local: ✅ WebSocket heartbeat liveness controller landed (2026-05-14):
    - added shared heartbeat controller `apps/api/src/mcp/scribeWebSocketHeartbeat.ts` with fail-closed timeout semantics:
      - tracks per-socket pong freshness,
      - sends periodic ping,
      - closes + terminates stale/dead sockets with `SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT` (`4410`) and reason `HEARTBEAT_TIMEOUT`,
      - invokes cleanup callback so stale sessions are removed from in-memory registries.
    - integrated heartbeat loop into `apps/api/src/mcp/scribeStreaming.ts`:
      - interval-driven liveness tick (`SCRIBE_WS_HEARTBEAT_INTERVAL_MS`, `SCRIBE_WS_HEARTBEAT_TIMEOUT_MS`),
      - WS lifecycle wiring (`register` on connection, `markPong` on pong, `unregister` on close),
      - safe interval cleanup on server close,
      - heartbeat-termination path drains `sessions` + `wsSessionIndex` to prevent ghost sessions.
    - added regression pin `apps/api/tests/unit/scribeWebSocketHeartbeat.test.ts`:
      - healthy client ping path,
      - stale timeout close/terminate path,
      - pong freshness refresh path,
      - ping-write failure fail-closed path.
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/scribeWebSocketHeartbeat.test.ts` PASS (`4/4`) + `npm run test:integration -w apps/api -- tests/integration/scribeWebSocketConsent.int.test.ts` PASS (`10/10`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-314-scribe-websocket-heartbeat-2026-05-14.md`.
  - Post-deploy: replay canary long-lived scribe WebSocket sessions + burn-in + post-burn-in verification before catalogue flip.
- [ ] `BUG-325`
  - Local: ✅ dead `llm_interactions` updated_at trigger cleanup landed (2026-05-14):
    - added migration `apps/api/migrations/20260701000068_bug_325_drop_dead_llm_interactions_updated_at_trigger.ts`:
      - `up`: drops `trg_llm_interactions_updated_at` from `llm_interactions`,
      - `down`: restores trigger via `set_updated_at()` for deterministic rollback.
    - rationale: BUG-286 made `llm_interactions` append-only via immutable UPDATE/DELETE triggers + revoked app-user mutation grants, so the legacy updated_at trigger is unreachable dead code and operationally misleading.
    - regression pin extended in `apps/api/tests/integration/llmInteractionsImmutability.int.test.ts`:
      - new `T7` asserts `trg_llm_interactions_updated_at` is absent in `pg_trigger`.
  - Local proof: ✅ `npm run test:integration -w apps/api -- tests/integration/llmInteractionsImmutability.int.test.ts` PASS (`7/7`) + `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:all` PASS.
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-325-drop-dead-llm-updated-trigger-2026-05-14.md`.
  - Post-deploy: replay migration rehearsal + canary schema-fingerprint proof + burn-in/post-burn-in verification before catalogue flip.
- [ ] `BUG-329`
  - Local: ✅ Redis pub/sub cross-process revoke-cache invalidation landed (2026-05-14):
    - added canonical bridge module `apps/api/src/shared/scribeConsentRevokePubSub.ts`:
      - publisher emits signed-structure invalidation payloads on channel `scribe-consent-revoke-cache-invalidation:v1`,
      - subscriber validates payload shape (`consentId` UUID + `clinicId` + `source` + `revokedAt`) and fail-closes malformed messages,
      - subscriber startup degrades to TTL-only fallback if Redis pub/sub is unavailable (warn-level observability),
      - shutdown hook drains subscriber cleanly outside test runtime.
    - recording-consent SSoT (`apps/api/src/shared/recordingConsent.ts`) now owns:
      - `startConsentRevokeCachePubSubBridge()` (bridge bootstrap),
      - `publishConsentRevokedCacheInvalidation(consentId, clinicId)` (single publish API),
      - test hook `__stopConsentRevokeCachePubSubBridgeForTests()`.
    - revoke endpoint wiring (`apps/api/src/features/llm/scribeRoutes.ts`):
      - success, idempotent-already-revoked, and concurrent-race paths now all force local cache revoke + publish pub/sub invalidation.
    - startup wiring (`apps/api/src/server.ts`):
      - after Redis readiness, starts revoke-cache pub/sub bridge with bounded-failure fallback logging.
    - regression pins:
      - `apps/api/tests/unit/scribeConsentRevokePubSub.test.ts` (`BUG-329-1/2`) payload decode + malformed fail-closed behavior,
      - `apps/api/tests/integration/scribeConsentRevocation.int.test.ts` extended with `T9` proving stale false-cache flips true via published invalidation (no TTL wait).
  - Local proof: ✅ `npm run test -w apps/api -- tests/unit/scribeConsentRevokePubSub.test.ts` PASS (`2/2`) + `npm run test:integration -w apps/api -- tests/integration/scribeConsentRevocation.int.test.ts` PASS (`9/9`) + `npm run lint:changed` PASS + `npm run typecheck` PASS.
  - Guard note: `guard:all` snapshot-freshness ratchet requires snapshot commit-time >= latest migration commit-time. Regenerated `apps/api/src/db/schema-snapshot.json` is included in this slice commit so the ratchet can pass post-commit.
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-329-scribe-revoke-cache-pubsub-2026-05-14.md`.
  - Post-deploy: replay canary multi-instance revoke path + burn-in + post-burn-in verification before catalogue flip.
- [ ] `BUG-330`
  - Local: ✅ scribe route modular split landed (2026-05-14):
    - decomposed monolith `apps/api/src/features/llm/scribeRoutes.ts` (1344 LOC pre-split) into bounded modules:
      - `apps/api/src/features/llm/scribeConsentRoutes.ts`
      - `apps/api/src/features/llm/scribeSessionRoutes.ts`
      - `apps/api/src/features/llm/scribeCatalogRoutes.ts`
    - parent `scribeRoutes.ts` now acts as orchestration shell:
      - retains single middleware envelope (`authMiddleware` + module gate + feature flag gate),
      - mounts subrouters to preserve existing endpoint contracts and role gates.
    - split boundaries:
      - consent lifecycle (+ revoke invariants) isolated from generation routes,
      - session/stateful workflow surfaces isolated from catalog/search surfaces,
      - shared LLM generation endpoints remain in parent route for now.
    - objective achieved: removed god-file single-surface ownership and reduced blast radius for future scribe changes.
  - Local proof: ✅ `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:response-shape-validated` PASS + `npm run guard:error-envelope-consistency` PASS + `npm run guard:jsonb-extraction` PASS + `npm run test:integration -w apps/api -- tests/integration/scribeConsentRevocation.int.test.ts` PASS (`9/9`) + `npm run test:integration -w apps/api -- tests/integration/scribeWebSocketConsent.int.test.ts` PASS (`10/10`).
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-330-scribe-routes-modular-split-2026-05-14.md`.
  - Post-deploy: replay canary scribe end-to-end routes (consent/session/catalog/search) + burn-in + post-burn-in verification before catalogue flip.
- [ ] `BUG-331`
  - Local: ✅ ambient worker pickup-time relationship re-check landed (2026-05-14):
    - added canonical pickup gate `recheckAmbientPatientRelationshipAtPickup(...)` in `apps/api/src/jobs/workers/aiWorker.ts`:
      - fail-closed context contract for ambient jobs (`patientId` + `staffId` + `clinicId` required),
      - live staff-state verification at pickup (`staff` must exist, be active, and be non-soft-deleted in the same clinic),
      - clinical-role guard + `requirePatientRelationship(...)` run immediately before LLM processing.
    - worker processing path now enforces the gate before any ambient generation work begins.
    - enqueue-time defense-in-depth (`apps/api/src/features/llm/aiJobRoutes.ts`):
      - `action='ambient'` now requires `patientId`,
      - ambient submissions are relationship-gated at request time, while worker re-check covers queue-delay drift.
    - regression pin: `apps/api/tests/integration/bug331AmbientWorkerPickupRelationship.int.test.ts` (`4/4`) proves:
      - missing ambient context fails (`AMBIENT_JOB_CONTEXT_INVALID`),
      - no relationship fails (`NO_PATIENT_RELATIONSHIP`),
      - valid relationship passes,
      - deactivated staff fails (`AMBIENT_STAFF_CONTEXT_INVALID`).
  - Local proof: ✅ `npm run lint:changed` PASS + `npm run typecheck` PASS + `npm run guard:fix-registry-decisiveness` PASS + `npm run guard:soft-delete-filter` PASS + `npm run test:integration -w apps/api -- tests/integration/bug331AmbientWorkerPickupRelationship.int.test.ts` PASS (`4/4`).
  - Evidence: `docs/quality/remediation/evidence/a4c-bug-331-ambient-worker-pickup-relationship-2026-05-14.md`.
  - Post-deploy: replay canary ambient queue jobs with delayed pickup + burn-in + post-burn-in verification before catalogue flip.
