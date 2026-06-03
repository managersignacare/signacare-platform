# Plan — BUG-281: migrate 3 LLM service entry points to AuthContext

## 1. Context

BUG-281 (S1, Track B, wave B-7) — L5-flagged structural gap. `loadPatientContext`, `enhancedGenerate`, `runAgent` accept raw `(clinicId, patientId)` strings. Any future non-HTTP caller (BullMQ worker, WebSocket, MCP tool) bypasses the HTTP-layer gate. **mcpServer already IS such a caller** — `mcpServer.ts:187` calls `loadPatientContext(a.patientId, a.clinicId || CLINIC)` with no AuthContext.

`mcpServer.handleMcpRequest` is reached via HTTP `POST /api/v1/llm/mcp` which DOES go through `authMiddleware` + `requireRoles(...)`, so an AuthContext IS available at the route handler — it just isn't propagated into the MCP tool dispatcher. The fix propagates it and gates patient-data-reading tools with `requirePatientRelationship`.

## 2. Existing code to reuse

- **`AuthContext`** type from `@signacare/shared`
- **`requirePatientRelationship(auth, patientId)`** at `apps/api/src/shared/authGuards.ts:219` — already the canonical pattern used by `medicationService`, `ectService`, `clinicalNoteService`
- **`buildAuthContext(req)`** at `apps/api/src/shared/buildAuthContext.ts` — HTTP handler → AuthContext
- **`runAgent` already calls `requirePatientRelationship` inline** (`aiAgent.ts:345-356`) but constructs an incorrect AuthContext with `role: 'clinician', permissions: []` instead of using the real caller's identity. The migration removes this inline construction and uses the passed-through AuthContext directly.

## 3. Change surface (grep-verified)

**Service signatures (3 functions):**
- `apps/api/src/mcp/aiEnhancer.ts:63` — `loadPatientContext(patientId, clinicId)` → `loadPatientContext(auth: AuthContext, patientId: string)`. Body: call `requirePatientRelationship(auth, patientId)` before any DB read. `auth.clinicId` replaces the `clinicId` param.
- `apps/api/src/mcp/aiEnhancer.ts:468` — `enhancedGenerate(opts)` → add `auth?: AuthContext` field (optional so pure-generation without patient context still works; required when `opts.patientId` is present — validated at runtime). Thread through to `loadPatientContext`.
- `apps/api/src/mcp/server/aiAgent.ts:336` — `runAgent(query, context, model)` where `context = {clinicId, patientId?, staffId?}` → `runAgent(query, auth, model)` with `auth: AuthContext`. Remove the inline `requirePatientRelationship` with fake role — use the passed-through auth directly.

**Call sites (3 sites):**
- `apps/api/src/features/llm/llmRoutes.ts:236` (enhancedGenerate) — pass `buildAuthContext(req)` as new field
- `apps/api/src/features/llm/llmRoutes.ts:874` (runAgent) — pass `buildAuthContext(req)` instead of constructing `context` manually
- `apps/api/src/mcp/server/mcpServer.ts:187` (loadPatientContext) — needs AuthContext. Thread via new param on `handleMcpRequest` + `handleToolCall`.

**MCP dispatcher updates:**
- `apps/api/src/mcp/server/mcpServer.ts` — `handleMcpRequest(body)` → `handleMcpRequest(body, auth: AuthContext)`. `handleToolCall(call)` → `handleToolCall(call, auth: AuthContext)`. Propagate to all tool case branches that access patient data (`get_patient_context`, `list_medications`, `list_notes`, etc. — gate each).
- `apps/api/src/features/llm/llmRoutes.ts:843` — `handleMcpRequest(req.body)` → `handleMcpRequest(req.body, buildAuthContext(req))`.

**Scope boundary:** this commit migrates the 3 functions called out in BUG-281. MCP tool-handlers that read patient data get a `requirePatientRelationship` gate applied once the AuthContext flows through. I will NOT migrate every MCP tool exhaustively in this commit — only the 3 patient-data-reading tools that BUG-036 already gated at HTTP layer (`get_patient_context`, `list_medications`, `list_notes`, `list_alerts`). Other tools (`search_patients`, `get_patient` single-row reads) get AuthContext propagation but no per-patient gate because they're intentionally un-scoped (clinic-wide list). Documented boundary.

## 4. Test plan

**L2.5 TDD:**
- New integration test `bug281LlmAuthContextMigration.int.test.ts`:
  - T1 clinician with no relationship to patient X calls `/api/v1/llm/enhance?patientId=X` → 403
  - T2 clinician with a relationship to patient X → 200 (pre-fix: 200; post-fix: still 200 — positive path preserved)
  - T3 MCP tool `get_patient_context` called for patient X with no clinician relationship → 403 / error
  - T4 agent run `/api/v1/llm/agent?patientId=X` by clinician with no relationship → 403
- **Pre-fix FAIL trace:** stash the migration changes, confirm T1 returns 200 (current behaviour — HTTP gate is on some endpoints but the service layer doesn't enforce).
- **Post-fix PASS:** restore → T1-T4 behave per above.

**L2.6 adjacent:**
- `clinicalAccessRbac` (17 tests) — existing `requirePatientRelationship` shouldn't regress
- `bug356AccessTokenRevocation` (6 tests) — authMiddleware chain unchanged
- `authBoundaries` (13 tests)

**L2.7 flake ×3.**

## 5. Gate (per PART 13.1)

Risky-class — llm/ + shared (AuthContext typed arg). L1-L5 all run.

- L1.1 tsc: api + web + shared green
- L1.2 eslint on touched files: 0 new
- L1.3 all 18 guards green
- L1.4 fix-registry: new anchor `R-FIX-BUG-281-LLM-AUTHCONTEXT`
- L2.5 TDD pre-fix FAIL + post-fix PASS
- L2.6 adjacent green
- L2.7 flake ×3 zero
- L3 code-reviewer: RUN
- L4 clinical-safety: RUN (llm/ + patient-data reads)
- L5 architecture: RUN (shared + services)

## 6. Non-goals

- Not migrating every MCP tool (only 3-4 patient-data-reading tools get explicit gates; others rely on AuthContext flowing through + service-layer gates downstream)
- Not touching `generateWithRefinement` at aiEnhancer.ts:410 (internal helper; caller provides context already gated)
- Not changing the HTTP gates at `llmRoutes.ts` — they remain as Layer A defence-in-depth
