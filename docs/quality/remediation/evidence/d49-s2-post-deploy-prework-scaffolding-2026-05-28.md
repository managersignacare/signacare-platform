# D49 — S2 Deferred Hardening Pre-Work Scaffolding

**Date:** 2026-05-28  
**Scope:** Option-1 pre-work for deferred S2 rows (remain `deferred/post`, not closed)

## 1) Why this slice exists

These bugs stay post-deployment by policy, but we added durable scaffolding now so they cannot silently regress before GA hardening:

- `BUG-SA-109`, `BUG-SA-110`, `BUG-SA-111`
- `BUG-SCRIBE25-101`, `BUG-SCRIBE25-102`, `BUG-SCRIBE25-103`, `BUG-SCRIBE25-104`

## 2) Scaffolding added (pre-work only)

### Shared contracts (SSoT)
- Added [postDeployHardening.schemas.ts](../../../../packages/shared/src/postDeployHardening.schemas.ts)
  - Calibration signal contracts (clinical-intelligence summary outcomes)
  - Readability signal contracts
  - AI edit-tracking privacy contract
  - Speaker-attribution contract for multi-speaker pathway
  - Alert-calibration feedback contract

### Telemetry + routing hooks
- Added [postDeployTelemetry.ts](../../../../apps/api/src/shared/postDeployTelemetry.ts)
  - Diagnosis/program bucketing helpers
  - Readability classification + score banding
  - Metric emitters for deferred S2 observability
- Extended [metrics.ts](../../../../apps/api/src/observability/metrics.ts)
  - `signacare_clinical_intelligence_summary_state_total`
  - `signacare_clinical_intelligence_source_failure_total`
  - `signacare_ai_summary_readability_total`
  - `signacare_ai_alert_calibration_feedback_total`
- Wired summary telemetry in [patientRoutes.ts](../../../../apps/api/src/features/patients/patientRoutes.ts) clinical-intelligence endpoint (`calibrationContext` + summary-state recording).
- Wired readability telemetry in:
  - [llmRoutes.ts](../../../../apps/api/src/features/llm/llmRoutes.ts) (`/llm/clinical-ai`)
  - [scribeRoutes.ts](../../../../apps/api/src/features/llm/scribeRoutes.ts) (`/scribe/patient-summary`)
- Added clinician feedback intake endpoint:
  - `POST /api/v1/llm/telemetry/alert-feedback` in [llmRoutes.ts](../../../../apps/api/src/features/llm/llmRoutes.ts)

### Pre-GA safety gate
- Added `SCRIBE_MULTISPEAKER_MDT_GA_FLAG` and `AI_EDIT_TRACKING_FLAG` in [featureFlag.constants.ts](../../../../packages/shared/src/featureFlag.constants.ts)
- Added ambient pre-GA check for `multiSpeakerMode` in [llmRoutes.ts](../../../../apps/api/src/features/llm/llmRoutes.ts); fails closed with `FEATURE_DISABLED` when GA flag is off.

### Regression-proof guard
- Added contract file [.github/post-deploy-s2-readiness-contract.json](../../../../.github/post-deploy-s2-readiness-contract.json)
- Added executable guard [check-post-deploy-s2-readiness-contract.ts](../../../../scripts/guards/check-post-deploy-s2-readiness-contract.ts)
- Wired script in root [package.json](../../../../package.json):
  - `guard:post-deploy-s2-readiness-contract`
  - Included in `guard:claude-discipline`

### Unit test coverage
- Added [postDeployTelemetry.test.ts](../../../../apps/api/tests/unit/postDeployTelemetry.test.ts) for deterministic classification/bucketing/readability signal behavior.

## 3) Status statement

All seven rows above remain `deferred/post` intentionally.  
This slice only installs the contracts, telemetry, and gates required so post-deployment hardening can be executed safely with production signals.
