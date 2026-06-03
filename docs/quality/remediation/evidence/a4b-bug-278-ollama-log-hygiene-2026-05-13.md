# A4b BUG-278 Local Evidence — Ollama Prompt-Log Hygiene

**Date:** 2026-05-13  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-278`  
**Scope:** local implementation of deploy-time verification contract (no canary/burn-in claims in this file).

## What Landed

1. Added deploy-time fail-closed probe:
   - `apps/api/scripts/verify-ollama-log-hygiene.mjs`
   - npm entrypoint: `npm run probe:ollama-log-hygiene -w apps/api`
2. Added mechanical guard to prevent contract drift:
   - `scripts/guards/check-ollama-log-hygiene-deploy-contract.ts`
   - wired into `guard:claude-discipline`
3. Added production template baseline:
   - `deploy/env.production.example` includes `OLLAMA_DEBUG=false`
4. Added runbook execution steps:
   - `docs/guides/deployment-guide.md` (first-time + rolling deploy)
   - `docs/archive/audit-2026-04-19/follow-up-on-cloud-deploy.md` (§13.4)

## Local Verification

1. `npm run guard:ollama-log-hygiene-contract` => PASS  
2. `npm run lint:changed` => PASS  
3. `npm run typecheck` => PASS  
4. `npm run guard:claude-discipline:ci` => PASS (includes BUG-278 contract guard)  
5. `node apps/api/scripts/verify-ollama-log-hygiene.mjs --help` => PASS (usage contract visible)

## Post-Deploy Closure Items (Still Required)

1. Run `probe:ollama-log-hygiene` on canary/prod host with real Ollama log paths (`OLLAMA_LOG_FILES=...`).  
2. Attach probe PASS output to rollout evidence packet.  
3. Complete burn-in and post-burn-in verification per lane contract.  
4. Record security/compliance signoff before flipping `BUG-278` to closed.

