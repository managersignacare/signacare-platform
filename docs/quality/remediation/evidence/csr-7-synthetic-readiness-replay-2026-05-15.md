# CSR-7 Synthetic Readiness Replay Evidence (2026-05-15)

## Scope

- Phase-A `CSR-7` synthetic readiness replay across:
  - `B4` scheduler reliability pack
  - `B1/B2/B3` command-family residual pack
  - `A4b/A4c` security/observability/runtime hygiene pack

## Parallel Replay Tracks

1. **B4 replay track**
   - `npm run test -w apps/api -- tests/unit/laiAlertScheduler.test.ts tests/unit/ectConsentExpiryScheduler.test.ts tests/unit/advanceDirectiveReviewScheduler.test.ts tests/unit/clozapineMonitoringWeekScheduler.test.ts tests/unit/mhaReviewScheduler.test.ts tests/unit/pathologyCriticalScheduler.test.ts tests/unit/notificationService.channels.test.ts tests/unit/suicidalIdeationAfterHoursScheduler.test.ts tests/unit/clozapineAlertScheduler.test.ts`
   - `npm run test:integration -w apps/api -- tests/integration/laiAlertScheduler.int.test.ts tests/integration/ectConsentExpiryScheduler.int.test.ts tests/integration/advanceDirectiveReviewScheduler.int.test.ts tests/integration/clozapineMonitoringWeekScheduler.int.test.ts tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts tests/integration/pathologyCriticalAlertsCycle2.int.test.ts tests/integration/suicidalIdeationAfterHoursScheduler.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts tests/integration/clozapineAlertSchedulerCycle2.int.test.ts tests/integration/hl7InboundIngest.int.test.ts`
   - `npm run guard:timer-try-catch`
   - `npm run guard:no-fire-and-forget`
   - Result: PASS (`176/176` unit tests, `11/11` integration files, guards PASS)

2. **B1/B2/B3 replay track**
   - Initial replay surfaced a blocker in `bugAdFamilyClinicalAccessGuard.int.test.ts`:
     - expected `201`, observed `403 NO_PATIENT_RELATIONSHIP`
     - root cause: test setup relied on superadmin nominated-admin bypass (order-dependent in multi-suite runs)
   - Structural fix applied:
     - create fixture directive using clinician token
     - explicit episode relationship seed (`primary_clinician_id`) before create path
   - Full replay command:
     - `npm run test:integration -w apps/api -- tests/integration/bug404AssessmentMandatoryFields.int.test.ts tests/integration/bug415ReferralStateMachine.int.test.ts tests/integration/bugRfRbacPermissionMatrix.int.test.ts tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts tests/integration/bugOncCtcaeContract.int.test.ts tests/integration/bugOncCommandOwnership.int.test.ts tests/integration/bugEctTmsSessionRelationshipScope.int.test.ts tests/integration/episodeCreateConflict.int.test.ts tests/integration/episodeDischargeSummaryClinicScope.int.test.ts`
     - `npm run test -w apps/api -- tests/unit/bugOncologyResponseShapeValidation.test.ts tests/unit/bugEctTmsCourseRelationshipGuards.test.ts tests/unit/bugRfSoftDeleteScope.test.ts tests/unit/bugEpisodeMdtLookupClinicId.test.ts`
     - `cd apps/web && npx vitest run src/features/medications/hooks/usePrescriber.test.ts`
   - Result: PASS after fix (`12/12` integration files, `19/19` API unit tests, `3/3` web tests)

3. **A4b/A4c replay track**
   - Guards:
     - `guard:non-pino-error-paths`
     - `guard:third-party-error-audit`
     - `guard:ollama-log-hygiene-contract`
     - `guard:llm-disclaimer-envelope`
     - `guard:error-envelope-consistency`
     - `guard:stream-error-handler`
     - `guard:mutation-invalidation`
   - Tests:
     - `npm run test:integration -w apps/api -- tests/integration/llmInteractionsImmutability.int.test.ts tests/integration/llmDisclaimerEnvelope.int.test.ts tests/integration/llmInteractionShape.int.test.ts tests/integration/llmInteractionsAuditFields.int.test.ts tests/integration/llmAccessBypassAudit.int.test.ts tests/integration/llmPromptsOutputs.int.test.ts tests/integration/llmRoutesPatientRelationshipGate.int.test.ts tests/integration/llmCallerMigration.int.test.ts`
     - `npm run test -w apps/api -- tests/unit/llmPromptInjection.test.ts`
   - Result: PASS

4. **Post-fix global replay**
   - `npm run guard:all`
   - Result: PASS

## Files Changed For Blocker Drain

- `apps/api/tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts`

## Verdict

- CSR-7 synthetic readiness is **GREEN** after deterministic blocker drain.
- Remaining closure state for covered bug families remains Phase-B operational evidence (`R1`) only.
