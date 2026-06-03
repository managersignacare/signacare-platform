# D5 AI Prompt Governance + Portability (Enterprise Prompt Library)

**Date:** 2026-05-20  
**Scope:** Critical evaluation of three enterprise prompt documents and direct integration into Signacare AI training controls.

## 1) Source Documents Reviewed

1. `ollama_dsm5_multiaxial_diagnostic_synthesis_prompt.pdf`
2. `ollama_longitudinal_clinical_summary_master_prompt.pdf`
3. `enterprise_medical_ai_scribe_prompt_whispersync_ollama.pdf`

## 2) Critical Evaluation (What is Strong vs What Needed Hardening)

### Strong architectural intent
- Explicit zero-hallucination, uncertainty preservation, and contradiction surfacing.
- Evidence-bound longitudinal synthesis orientation (not single-note summarization).
- Clear risk/safeguarding prioritization and clinician-review boundary.
- Structured-output mindset suitable for deterministic downstream rendering.

### Gaps that needed implementation hardening
- Prompt changes were not consistently applied in enhanced-generation path.
- No first-class, versioned prompt profile library in shared SSoT.
- No explicit model-agnostic portability layer for deployment migration.
- No manifest trail proving which prompt profile set was applied to a clinic.

## 3) Implemented Integration (Code)

### A) Shared, versioned, model-agnostic prompt library
- Added `packages/shared/src/llmPromptProfiles.schemas.ts`.
- Added canonical profiles:
  - `enterprise_dsm5_diagnostic_synthesis_v1` (targets `report-insight`)
  - `enterprise_longitudinal_summary_v1` (targets `maudsley`, `formulation`)
  - `enterprise_91_day_review_v1` (targets `91day`)
  - `enterprise_psychiatric_scribe_v1` (targets `ambient`)
- Added governance metadata/checklists per profile.
- Exported via `packages/shared/src/index.ts`.

### B) Training API support for profile application
- Added `GET /api/v1/llm/prompt-profiles` (discover profile catalog).
- Added `POST /api/v1/llm/prompt-profiles/apply` (admin apply workflow).
- Application writes system prompts into `ai_modelfiles` per action.
- Application writes non-RAG manifest rows into `ai_context_files` (`category=prompt_profile`) for export/import portability trace.

### C) Structural fix: enhanced path now honors clinic prompt configuration
- Updated `apps/api/src/mcp/aiEnhancer.ts` so `callLocalLlm(...)` receives `clinicId` + `action`.
- This ensures enhanced flows (diagnosis/longitudinal/formulation/91-day/scribe where applicable) consume the same per-clinic prompt governance as direct paths.

### D) Admin UI wiring
- Updated `apps/web/src/features/settings/components/AiTrainingModule.tsx`:
  - Displays enterprise prompt profiles.
  - Adds “Apply Enterprise Profiles” action.
  - Surfaces applied counts + manifest write counts.
- Added key factory entry in `apps/web/src/features/settings/queryKeys.ts`.

## 4) Portability Outcome

Portability now works on three layers:

1. **Code SSoT portability:** profiles are in `@signacare/shared`, independent of a specific model.
2. **Runtime portability:** applied profiles become clinic configuration (`ai_modelfiles`) used by generation.
3. **Deployment portability:** manifests and prompt config are exportable/importable through existing AI context bundle workflows.

## 5) Residual / Next Upgrade

- Add profile-drift guard to enforce action coverage for diagnosis/longitudinal/91-day/scribe profiles.
- Add integration test coverage for `POST /llm/prompt-profiles/apply`.
- Add optional cryptographic hash of applied profile content into manifest for stronger audit attestation.

