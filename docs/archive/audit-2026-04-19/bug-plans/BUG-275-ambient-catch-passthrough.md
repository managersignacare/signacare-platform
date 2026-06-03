# BUG-275 — /ambient-note catch-block error-class passthrough

**Metadata**

- Severity: S1
- Track / Wave: A / A-2
- State: fixed
- Change class: standard
- Fix-registry anchor: `R-FIX-AMBIENT-CATCH-PASSTHROUGH`
- Origin: BUG-035 L3 code-review finding.

## Diagnosis

[apps/api/src/features/llm/llmRoutes.ts:722-752](apps/api/src/features/llm/llmRoutes.ts#L722-L752). The `/ambient-note` handler's catch block:

1. Passes through `HttpError` (correct, lines 728-731).
2. Passes through `ZodError` (correct, lines 732-735).
3. Four message-substring branches for known upstream errors (ECONNREFUSED / timeout / NO_SPEECH / Ollama) — correct; these are plain `Error` instances from axios/fetch that need specific HTTP-status translation.
4. Fallback: `next(new Error(msg))` — **the bug**. Wraps everything else in a plain `Error`, destroying:
   - Class identity (typed-error subclasses → plain `Error`)
   - Stack trace (new stack anchored at the wrap site)
   - Cause chain (lost)
   - Custom fields (`.code`, `.status`, `.details`)

Downstream, `toErrorResponse()` in `shared/errors.ts:55-133` relies on these fields to produce the correct HTTP response. The duck-typed branch at lines 100-114 renders `{error, code}` with `err.status` when both `.status` + `.code` are present — this whole path was unreachable from the `/ambient-note` fallback because the wrapper stripped both fields.

**Scope expansion (guard caught 2 more):**
- `apps/api/src/features/llm/llmTrainingRoutes.ts:259` — same anti-pattern in model-create handler.
- `apps/api/src/features/patients/zitaviSyncRoutes.ts:110` — throws for an upstream-gateway condition; correct fix is a typed `HttpError(502, 'ZITAVI_BAD_GATEWAY', …)` since it's a synthesised condition, not an unwrapped caught error.

All three fixed in this commit.

## Fix

1. **Passthrough** — replace `next(new Error(msg))` with `next(err)` in `llmRoutes.ts` fallback + `llmTrainingRoutes.ts` catch. Comment documents that the 4 message-substring branches are the ONLY permitted string-match cases (known upstream library errors).
2. **Typed upgrade** — `zitaviSyncRoutes.ts` uses `new HttpError(502, 'ZITAVI_BAD_GATEWAY', …)` for the synthesised bad-gateway condition.
3. **CI guard** — `scripts/guards/check-no-next-new-error.ts` rejects `next(new Error(...))` in `apps/api/src/features/**/*.ts`. Comment-aware (skips prose inside `//` comments). Narrow by design — only the specific BUG-275 shape; indirect wrapping + typed-class wrapping are legitimate and not caught.

## Files changed

- `apps/api/src/features/llm/llmRoutes.ts` — 1-line passthrough + clarifying comment.
- `apps/api/src/features/llm/llmTrainingRoutes.ts` — 1-line passthrough.
- `apps/api/src/features/patients/zitaviSyncRoutes.ts` — `HttpError` import + typed bad-gateway error.
- `scripts/guards/check-no-next-new-error.ts` — new (~120 LOC).
- `apps/api/tests/integration/ambientNoteErrorPassthrough.int.test.ts` — new (3 tests).
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — state: fixed.
- `docs/fix-registry.md` — `R-FIX-AMBIENT-CATCH-PASSTHROUGH` anchor.

## Tests — 3 integration, all PASS

| # | Scenario | Result |
|---|---|---|
| T1 | `HttpError(403, 'UPSTREAM_FORBIDDEN', ...)` thrown by mocked `processAmbientAudio` → passes through first catch branch | response 403 + `code='UPSTREAM_FORBIDDEN'` ✓ |
| T2 | Custom error class thrown, doesn't match HttpError/Zod/upstream-strings → falls to `next(err)` | response 500 (no crash, no hang) ✓ |
| T3 | Duck-typed error with `.status=418` + `.code='BUG_275_PASSTHROUGH'` → `toErrorResponse` duck-typed branch fires on the ORIGINAL instance | response 418 + `code='BUG_275_PASSTHROUGH'` ✓ (pre-fix would be 500 + 'INTERNAL_ERROR') |

T3 is the load-bearing structural assertion: pre-fix the wrapper-new-Error stripped `.status` + `.code` and the duck-typed branch couldn't fire. Post-fix the original err is visible to `toErrorResponse`.

## Guard scope (documented in guard header)

The CI guard is a **narrow safety rail**, not a comprehensive ban on all error wrapping:

- **Catches:** `next(new Error(...))` — the exact BUG-275 anti-pattern.
- **Does NOT catch:**
  - `const e = new Error(x); next(e);` (indirect wrap)
  - `next(new HttpError(...))` (typed-class wrap — legitimate)
  - `throw new Error(msg)` (thrown, handled by error-middleware)

Reviewers should not assume stronger coverage than the guard explicitly provides.

## Non-goals

- Don't refactor every `catch (err) { ... }` block in the codebase — only the three sites matching the BUG-275 pattern.
- Don't introduce a shared error-response helper — the existing `toErrorResponse` is the single source of truth.
- Don't change the global errorHandler — its contract is unchanged; this fix makes it USEFUL for the `/ambient-note` path.

## QA verdicts

- L3 code-reviewer-general: TBD
- L4/L5: not required for standard-class change.

## Residual risk

- Indirect wrapping (`const e = new Error(x); next(e)`) is not guarded. A future regression using that shape would escape the CI guard. Accepted residual — the direct shape was the documented bug.
