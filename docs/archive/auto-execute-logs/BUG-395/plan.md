# BUG-395 — AI chat patient-context UUID lock — Plan

## Root cause (verified)

`apps/api/src/features/llm/llmRoutes.ts:/clinical-ai` accepts `patientId` per-request. If a clinician starts a chat with patientId=A and mid-session changes to patientId=B, the server happily serves both. The RAG context + prompt-composition can CARRY content from patient A into patient B's response (cross-patient leakage). Wave 5 escalated this to S0.

## Gold-standard fix (backend lock + frontend ID generation)

### Backend

1. Extend `ClinicalAiSchema` with optional `conversationId: z.string().uuid()`.
2. New helper `apps/api/src/features/llm/chatContextLock.ts`:
   - `acquireChatPatientLock(conversationId, patientId, ttlSec=3600)` — Redis KV set if-absent OR matching (SET NX EX fallback: SET + EXPIRE); returns `{ ok: true }` or `{ ok: false, lockedPatientId }`.
   - `releaseChatPatientLock(conversationId)` — DEL; not typically called (TTL does the work).
3. In `/clinical-ai` handler: when both `conversationId` and `patientId` are present, call `acquireChatPatientLock`. On mismatch → throw `AppError(409, 'CHAT_CONTEXT_LOCKED')` with the locked patientId in details + audit via `writeAuditLog({action: 'AI_CHAT_CLASSIFIER_BLOCK'})` (existing literal — extended scope).
4. New audit literal `AI_CHAT_CONTEXT_VIOLATION` in `AuditAction` union.
5. On first-use (no existing lock), set the lock and emit `kind=ai_chat_lock_acquired` info log.

### Frontend

Minimal edit to the AI chat widget so every request carries a `conversationId`:
1. Generate `conversationId = crypto.randomUUID()` on mount of the chat component
2. Re-generate when the patient context changes intentionally (user-initiated)
3. Pass `conversationId` in the POST body

### Tests
- Unit: chatContextLock acquire/acquire-same/acquire-different/expire behaviour (mocked redis)
- Integration: two `/clinical-ai` POSTs with same conversationId, different patientIds → second returns 409

## Files

- `apps/api/src/features/llm/chatContextLock.ts` — NEW
- `apps/api/src/features/llm/llmRoutes.ts` — add lock call in `/clinical-ai` handler
- `apps/api/src/utils/audit.ts` — add `AI_CHAT_CONTEXT_VIOLATION` literal
- `packages/shared/src/schemas/llm.schema.ts` (or wherever ClinicalAiSchema lives) — add optional `conversationId`
- `apps/api/tests/chatContextLock.test.ts` — NEW unit tests (6)
- `apps/api/tests/integration/bug395ChatContextLock.int.test.ts` — NEW 3 tests
- `apps/web/src/features/llm/components/LLMSuggestPanel.tsx` (or equivalent) — conversationId generation + send
- `docs/quality/fix-registry.md` — 3 rows

## Risk + scope

- Backwards-compat: lock fires ONLY when conversationId is present. Frontend rollout can precede/follow backend.
- TTL: 60 min default. A chat session longer than that gets a new lock — acceptable. A session-lifecycle override can be added later.
- Dual Redis failure handling: if Redis is down, the lock acquire throws. Per fail-closed pattern (matches BUG-442 jwtBlacklist), this aborts the AI request. Alternative: fail-open with logger.error. Clinical-safety says fail-CLOSED — better to block the AI call than leak patient context.

## L3/L4/L5

- L3: yes
- L4: yes — AI safety gate + clinical-notes-adjacent patient-context isolation (§13.5 semantic trigger)
- L5: yes — adds new Redis key space + new module under `features/llm/`
