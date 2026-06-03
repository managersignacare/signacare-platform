# Plan — BUG-360: replace 4 silent `.catch()` with observable handlers

## 1. Context

Pre-existing tech-debt flagged by `.github/scripts/check-no-silent-catches.sh`. 4 `.catch(() => ...)` handlers discard errors without emitting ANY observability signal. Per CLAUDE.md §3.1 + §9.6, every rejection MUST be observable — no empty, no silent-returning, no anonymous swallow.

## 2. Existing code to reuse

- `apps/api/src/utils/logger.ts` — canonical Pino logger. `logger.warn({ err, ...context }, 'message')` is the Signacare pattern for non-blocking-but-observable failures.
- `apps/web/src/shared/services/apiClient.ts` — frontend call wrappers. No existing pattern for a "logged-then-null" fallback, but React Query's `onError` already handles the standard error path; the `.catch(() => null)` at `CorrespondenceTab.tsx:587` is explicitly in a `queryFn` that wants to return `null` when the source-note fetch fails (letter-composer pre-fill, optional).

## 3. Change surface (grep-verified)

Per `check-no-silent-catches.sh` output 2026-04-23:

| File | Line | Current | Rationale (non-blocking intentional? Yes) |
|---|---|---|---|
| `apps/api/src/features/llm/llmRoutes.ts` | 381 | `}).catch(() => {});` | writeAuditLog for TRAINING_EXPORT_REQUESTED — audit write must not block the route response |
| `apps/api/src/features/llm/llmRoutes.ts` | 454 | `}).catch(() => {});` | writeAuditLog for TRAINING_EXPORT_APPROVED/REJECTED — same |
| `apps/api/src/features/llm/llmRoutes.ts` | 513 | `}).catch(() => {});` | writeAuditLog for TRAINING_EXPORT_DOWNLOADED — same |
| `apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx` | 587 | `.then(r => r.note).catch(() => null)` | optional source-note fetch for letter pre-fill; null is the right fallback, but silently dropping the error obscures why pre-fill didn't happen |

## 4. Fix shape

**Backend (llmRoutes.ts, 3 sites):** replace `.catch(() => {})` with `.catch((err) => logger.warn({ err, ...context }, 'training-export audit write failed — non-blocking'))`. The surrounding `writeAuditLog` call is already non-blocking by design; just the FAILURE visibility is missing.

**Frontend (CorrespondenceTab.tsx):** replace `.catch(() => null)` with `.catch((err) => { console.warn('[CorrespondenceTab] source-note fetch failed', err); return null; })`. The `null` fallback is preserved; the failure gains observability.

## 5. Test plan

- No runtime behaviour change on the happy path.
- L2.5: the `check-no-silent-catches.sh` guard transitions from 4 FAIL → 0 FAIL. That IS the TDD evidence.
- Adjacent suites: no behaviour change → zero regression expected.

## 6. Gate

Non-risky-class (llm routes = S2-level but touches llm/ — so L3 + L5 RUN; L4 because llm/ is in the clinical-safety list). Per PART 13.1:
- L1.1 tsc api+web: 0 errors
- L1.2 eslint on 2 touched files: 0 new errors
- L1.3 all 17 guards: `check-no-silent-catches` now green (closes another of the 3 pre-existing FAIL/WARN from prior commits)
- L1.4 fix-registry: new anchor `R-FIX-BUG-360-AUDIT-LOG-FAIL-OBSERVABLE` + `R-FIX-BUG-360-SOURCE-NOTE-FETCH-OBSERVABLE`
- L2.5: guard PASS is the proof
- L2.6: adjacent — run `llmRoutes` integration + correspondence-related suites in isolation
- L2.7: N/A (no new tests)
- **L3 code-reviewer: RUN** (llmRoutes is a llm/ feature — risky-class)
- **L4 clinical-safety: RUN** (llm/ is in the clinical-safety list)
- **L5 architecture: RUN** (shared/ adjacent via logger)

## 7. Explicit non-goals

- Not changing the non-blocking semantics. The audit writes MUST stay fire-and-forget (per CLAUDE.md §9.6 exceptions for audit writes).
- Not touching the `writeAuditLog` internals — SSoT already handles swallow-and-log internally; the external `.catch` is defense-in-depth against promise-level rejections.
