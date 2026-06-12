# AI Model Governance

Phase 9 makes model changes a governed promotion path, not an environment-variable change.

## Non-Negotiables

- Model aliases (`fast_clinical`, `best_clinical`, `local_sovereign`, `court_report_reasoning`) are promoted by evidence, not by direct provider-name edits.
- Shadow-mode challengers are scored against the active backend before promotion.
- Shadow-mode execution is opt-in by policy: deterministic sampling, clinician-consent checks, citation-scoring availability, daily cost caps, and latency caps must pass before a challenger run is admitted.
- Promotion evidence must include edit-distance, citation coverage, hallucination flags, safety-refusal mismatches, latency regression, and cost regression.
- The code provides `buildShadowRunEvidenceBundle(...)` and `aggregateShadowRunQualityMetrics(...)` to bind raw shadow-run metrics to a hash-backed evidence bundle. The production validator recomputes the aggregate from that bundle before accepting a promotion record.
- Clinician local style adapters are reviewed separately from runtime model aliases. A model swap is blocked if any adapter is incompatible or requires retraining.
- Every promotion record must name an evidence artefact, approver, approval time, rollback plan, baseline deployment, candidate deployment, and policy version.

## Control Plane

The shared contracts live in `packages/shared/src/aiModelGovernance.schemas.ts`.

The pure API evaluator lives in `apps/api/src/features/llm/modelRouter/modelGovernance.ts`.

The opt-in runtime observer lives in
`apps/api/src/features/llm/modelRouter/modelShadowRuntime.ts`. It runs only
after the primary model has produced the clinician-visible output, never
changes that output, and writes derived quality evidence only. Raw prompts and
raw challenger output are not stored in `llm_interactions.metadata`.

The pure governance functions are:

- `evaluateShadowRunEligibility(...)` — fail-closed admission control for a challenger run.
- `scoreShadowCandidate(...)` — per-run output comparison, citation, hallucination, latency, and cost evidence.
- `buildShadowRunEvidenceBundle(...)` — hash-bound bundle over individual shadow-run metrics.
- `aggregateShadowRunQualityMetrics(...)` — promotion-record aggregate quality builder.
- `assertModelPromotionEvidenceBundleAllowed(...)` — verifies record aggregate and hash provenance against raw shadow metrics.
- `assertModelPromotionAllowed(...)` — final promotion gate.
- `runShadowTextGenerationOnce(...)` — policy-gated challenger execution used by the runtime observer.

The checked promotion entrypoint is:

```bash
npm run ai:model-promotion:validate -- --alias best_clinical --record docs/quality/ai-model-governance/best-clinical-20260606.json
```

The validator consumes the model policy manifest and the typed governance record. The operational release standard is that production alias changes are not made by direct environment edits or portal changes; the GitHub production deploy gate enforces a checked record before every production promotion. For a non-model release, operators provide a reviewed `decision: "no_change"` record proving the active alias remains pinned to the current deployment (`fromDeploymentRef === toDeploymentRef`) and backed by same-deployment evidence.

The structural guard is `npm run guard:ai-model-governance-contract`.

## Production Deployment Gate

The canonical Azure production deploy workflow exposes two inputs that become
mandatory for production promotions:

- `ai_model_promotion_alias`
- `ai_model_promotion_record`

The workflow fails closed unless both are supplied and the validator passes:

```bash
npm run ai:model-promotion:validate -- --alias "$AI_MODEL_PROMOTION_ALIAS" --record "$AI_MODEL_PROMOTION_RECORD"
```

The record path must live under `docs/quality/ai-model-governance/*.json`.
That keeps production model governance coupled to reviewed quality evidence
before the production deploy can proceed. The governance record must also name
a shadow evidence bundle under the same directory and carry its SHA-256. This
hash-bound shadow evidence is the promotion source of truth: the validator
loads that bundle and recomputes the aggregate metrics before the workflow
uploads the record as a run artifact and stamps its SHA-256 in
`SIGNACARE_AI_MODEL_PROMOTION_RECORD_SHA256`. The workflow cannot detect an
undeclared out-of-band provider/portal model change; portal edits remain
break-glass incidents.

## Runtime Shadow Mode

Runtime shadow mode is disabled by default. Operators must explicitly enable it
with policy env vars such as:

- `AI_SHADOW_MODE_ENABLED=true`
- `AI_SHADOW_MODE_SAMPLE_RATE_PCT=1`
- `AI_SHADOW_MODE_CHALLENGER_BACKEND=local_ollama`
- `AI_SHADOW_MODE_CHALLENGER_LOCAL_MODEL=llama3.2:style-candidate`

Admission remains fail-closed: clinician consent, citation-scoring
availability, deterministic sampling, cost caps, and latency caps must pass
before a challenger run is admitted. The primary model remains the only
clinician-visible output. Challenger evidence is used for governance and
future alias-promotion decisions only.
