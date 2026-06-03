# A4c BUG-285 Local Evidence — LLM Disclaimer Envelope Guard

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-285`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added new fail-closed structural guard:
   - `scripts/guards/check-llm-disclaimer-envelope.ts`
   - npm script: `guard:llm-disclaimer-envelope`
2. Guard contract:
   - verifies canonical `disclaimer: CLINICAL_AI_DISCLAIMER` envelope on sanctioned clinical AI response surfaces:
     - `POST /llm/suggest` (via `llmController.suggest`)
     - `POST /llm/clinical-ai`
     - `POST /llm/agent`
     - `POST /scribe/patient-summary`
     - `POST /scribe/referral-letter`
   - fails closed if:
     - required route is missing/renamed,
     - route handler is rewired away from sanctioned contract,
     - canonical disclaimer envelope pair is removed.
3. Added regression tests:
   - `scripts/guards/__tests__/check-llm-disclaimer-envelope.test.ts`
   - coverage:
     - passing fixture,
     - `/clinical-ai` disclaimer removal failure,
     - `/suggest` disclaimer removal failure.

## Regression Proof (Local)

1. `npx vitest run --config ./vitest.config.ts scripts/guards/__tests__/check-llm-disclaimer-envelope.test.ts` => PASS (`3/3`)
2. `npm run guard:llm-disclaimer-envelope` => PASS
3. `npm run lint:changed` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Verify protected-branch CI consistently enforces `guard:llm-disclaimer-envelope`.
2. Attach canary + burn-in + post-burn-in evidence packet per lane closure contract.
3. Flip bug catalogue state only after rollout closure evidence is attached.
