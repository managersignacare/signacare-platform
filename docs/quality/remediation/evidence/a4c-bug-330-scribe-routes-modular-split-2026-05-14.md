# A4c BUG-330 Local Evidence — Scribe Routes Modular Split

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-330`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Split the monolithic scribe route file into bounded modules.
   - Pre-split file: `apps/api/src/features/llm/scribeRoutes.ts` (~1344 LOC)
   - New modules:
     - `apps/api/src/features/llm/scribeConsentRoutes.ts`
     - `apps/api/src/features/llm/scribeSessionRoutes.ts`
     - `apps/api/src/features/llm/scribeCatalogRoutes.ts`

2. Preserved one shared middleware envelope at the parent router.
   - Parent `scribeRoutes.ts` still applies:
     - `authMiddleware`
     - `requireModuleRead(MODULE_KEYS.MEDICAL_SCRIBE)`
     - `requireFeatureEnabled('ai-scribe')`
   - Parent now mounts subrouters, keeping endpoint paths and behavior stable.

3. Established explicit route ownership boundaries.
   - `scribeConsentRoutes.ts`:
     - `/consent/mode`
     - `/consent`
     - `/consent/:id/revoke`
   - `scribeSessionRoutes.ts`:
     - `/session*` lifecycle + talk-time
     - sensitive-flag triage
     - action-item workflows
   - `scribeCatalogRoutes.ts`:
     - vocabulary CRUD
     - note templates
     - semantic search

4. Maintained existing invariants while reducing blast radius.
   - Consent revoke invariants (including BUG-329 publish/mark behavior) are preserved in consent module.
   - Session relationship/ownership checks remain in session module.
   - Search relationship gate + bypass-audit contract remain in catalog module.

## Regression Proof (Local)

1. `npm run lint:changed` => PASS
2. `npm run typecheck` => PASS
3. `npm run guard:response-shape-validated` => PASS (all split-route response boundaries now run through canonical `*ToResponse`/Zod contracts)
4. `npm run guard:error-envelope-consistency` => PASS (all split-route error exits now use `next(AppError)` canonical envelope path)
5. `npm run guard:jsonb-extraction` => PASS (split modules include explicit JSONB-aware `*ToResponse` extraction mappers)
6. `npm run test:integration -w apps/api -- tests/integration/scribeConsentRevocation.int.test.ts` => PASS (`9/9`)
7. `npm run test:integration -w apps/api -- tests/integration/scribeWebSocketConsent.int.test.ts` => PASS (`10/10`)

## Post-Deploy Closure Items (Still Required)

1. Canary replay of scribe critical paths (consent, session lifecycle, search, vocabulary/template reads).
2. Burn-in + post-burn-in verification proving no routing regressions and no auth/RBAC gate drift.
3. Catalogue row flip only after rollout closure contract is satisfied.
