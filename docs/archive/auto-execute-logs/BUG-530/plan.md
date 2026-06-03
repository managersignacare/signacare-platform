# Plan — BUG-530: UIStatus + Result SSoT (canonical structural primitives)

[Plan agent invocation 2026-04-26 per PART 2 §B; first-principles per PART 6.1 #3. Phase A item 5 of approved structural prevention block.]

**Severity:** S1 (structural prevention; opt-in SSoT; zero runtime impact this commit).
**Class:** Type-machinery. NEW canonical SSoT in `packages/shared/`. Adoption is OPT-IN per future BUG. Foundation that BUG-531's ESLint autofix will point at when banning empty-`catch` blocks.

## §0. Drift summary

The BUG-445/446/520/521/523 cluster are sibling instances of the same lie-about-success class:
1. Frontend `try { fetch() } catch { setData([]) }` collapses `failed` into `empty`. UI renders "no data" or "saved successfully" instead of failing loud. 2-state `isLoading: boolean` collapses idle/loading/empty/failed into one bit.
2. Backend services either throw (caller MUST wrap — frequently forgotten) or return `null|undefined|[]` (caller MUST narrow — frequently forgotten). Both lose the *expected vs unexpected* failure distinction.

**Empirical:** packages/shared/ has zero UIStatus / Result / tryAsync. apps/web/src/features/ uses 2-state booleans across 30 files / 107 occurrences. apps/api/src/shared/errors.ts:49 defines `AppError extends HttpError`.

The 5-state union + `Result<T, E>` are the structural fix-shapes the cluster needed but did not have.

## §1. Verification (read-confirmed)

- No `UIStatus` / `Result<T,>` in packages/shared/ (grep 0 hits).
- No packages/shared/src/{ui,errors}/ directories.
- AppError in apps/api/src/shared/errors.ts:49 — `(message, status, code, details)` constructor.
- 30 web feature files use 2-state booleans (~107 hits — adoption surface for FUTURE BUGs, not this commit).
- packages/shared/tsconfig.json excludes `**/*.test.ts`.
- Root vitest.config.ts is BUG-528-scoped to scripts/**/*.test.ts; no packages/shared/vitest.config.ts.
- BUG-526 plan precedent: 4 anchors, atomic flip, no `\|` per BUG-510.
- BUG-527 safety-surfaces.txt does NOT include packages/shared/.

## §2. Fix shape

### §2.1 NEW packages/shared/src/ui/statusMachine.ts (~120 LOC)

5-state discriminated union, discriminator field `kind` (NOT `status` — collides with HTTP/route/patient status).

```ts
export type UIStatusIdle    = { kind: 'idle' };
export type UIStatusLoading = { kind: 'loading' };
export type UIStatusReady<T> = { kind: 'ready'; data: T };
export type UIStatusEmpty   = { kind: 'empty'; reason?: 'no-results' | 'not-yet-loaded' | 'filtered-out' };
export type UIStatusFailed  = { kind: 'failed'; error: AppError; retry?: () => void };
export type UIStatus<T> = UIStatusIdle | UIStatusLoading | UIStatusReady<T> | UIStatusEmpty | UIStatusFailed;

export const UIStatus = { idle, loading, ready<T>, empty, failed, fromResult<T> } as const;
export const isIdle/isLoading/isReady/isEmpty/isFailed = …;
export function matchUIStatus<T, R>(s, handlers): R; // exhaustive
```

**Why 5 states (first-principles):**
- `idle` — distinguishes "user hasn't asked" from "loading in flight"; without it, deferred queries show misleading spinner.
- `loading` — trivially required.
- `ready<T>` — trivially required, carries data.
- `empty` (FIRST-CLASS, not `ready([])`) — the BUG-445 root cause. `ready-with-zero-rows` forces every renderer to inspect `data.length === 0` AT EVERY CALL SITE, which is exactly the bug-shape. First-class `empty` pushes the discrimination to the constructor, so exhaustive `matchUIStatus` guarantees the empty-UI is wired.
- `failed` — the whole point. Carries `AppError` (status, code, message, details) + optional `retry`. Exhaustiveness check guarantees no renderer can silently fall back to "render as empty".

**Rejected:** `succeeded` (redundant w/ ready), `partial` (no BUG demands it), `cancelled` (back to idle), network/validation split (already on error.code).

**`empty.reason`** — `'no-results' | 'not-yet-loaded' | 'filtered-out'`; lean coverage of the cluster's needs.

### §2.2 NEW packages/shared/src/errors/result.ts (~140 LOC)

```ts
export type ResultOk<T> = { kind: 'ok'; value: T };
export type ResultErr<E> = { kind: 'err'; error: E };
export type Result<T, E = AppError> = ResultOk<T> | ResultErr<E>;

export const Result = { ok<T>, err<E = AppError> } as const;
export const isOk/isErr = …;
export function match<T, E, R>(r, handlers): R;
export function unwrap<T, E>(r): T;            // throws if err
export function unwrapOr<T, E>(r, fallback): T;
export function unwrapOrElse<T, E>(r, fn): T;
export function map<T, U, E>(r, fn): Result<U, E>;
export function mapErr<T, E, F>(r, fn): Result<T, F>;
export function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, AppError>>;  // BUG-531 hook
export function trySync<T>(fn: () => T): Result<T, AppError>;
export function fromUnknown(thrown: unknown): AppError;
```

**Decision: `E` defaults to `AppError`, not `Error`.** Reasoning:
1. BUG-531's autofix produces `Result<T, AppError>` — `r.error` MUST be AppError for the `failed` UI to consume `.code/.status/.message`. Defaulting to Error would re-introduce BUG-445 ambiguity at the type level.
2. Symmetric with backend `toErrorResponse` mapping (apps/api/src/shared/errors.ts:55–163).
3. Generic escape hatch preserved (`Result<T, FhirSdkError>` still works).
4. `fromUnknown` bridges `catch (e: unknown)` → AppError; `tryAsync` ALWAYS produces `Result<T, AppError>`.

**Lean surface:** IN — ok/err/isOk/isErr/match/unwrap/unwrapOr/unwrapOrElse/map/mapErr/tryAsync/trySync/fromUnknown. OUT — andThen/or/orElse/Result.fromPromise alias/Result.all/Result.any/toJSON.

### §2.3 NEW packages/shared/src/errors/appError.ts (~40 LOC)

`AppError` MUST be importable from packages/shared (Result<T, AppError> default). Three options considered:
- A: Import from apps/api → REJECTED (reverses dependency arrow).
- B: Move AppError to shared, api re-exports → REJECTED for THIS commit (counts as existing-code edit).
- **C: Mirror minimal `AppError extends Error` shim in shared with `(message, status, code, details)` constructor; reconcile via follow-up BUG-541.** CHOSEN. Honours "no existing-code edits". Drift risk low (small stable shape). Follow-up filed.

```ts
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export type AppErrorCode = string;
```

### §2.4 Re-export wiring

`packages/shared/src/index.ts` — append (the ONE existing-code edit, additive only):
```ts
export * from './ui/statusMachine';
export * from './errors/result';
export * from './errors/appError';
```

## §3. UNION-up-front

N/A this commit. Adoption opt-in. Migration is BUG-446/521/525 follow-up. SSoT lands inert by design — BUG-531 references `tryAsync` as autofix target for NEW catches even though zero call-sites use it yet.

## §4. CLAUDE.md update

- **§3 amendment** — add §3.4 "Service-layer expected failures: return Result<T, AppError>, do NOT throw". Distinguish expected (validation/not-found/business-rule) from unexpected (DB lost/OOM). Routes' outer try/catch + `next(err)` still required.
- **NEW §16 — UI STATUS + SERVICE RESULT (CANONICAL)** with three rules:
  - §16.1 5-state UIStatus mandatory for safety-surface fetch UI. Cite BUG-445/446/520/521/523. Show union + matchUIStatus pattern.
  - §16.2 Result<T, AppError> canonical service-layer outcome wrapper. tryAsync canonical replacement for `} catch { fabricate }`. Forward-ref BUG-531.
  - §16.3 Adoption rule: opt-in per BUG. New safety-surface code SHOULD use; existing migrated by dedicated BUGs.

~80 LOC total. CLAUDE.md edit explicitly permitted by brief ("Plus CLAUDE.md if §4 fires").

## §5. Test plan

NEW packages/shared/vitest.config.ts (~20 LOC) + root package.json `test:shared` script (the smallest possible existing-code edit; justified by absence). Two test files, 14 cases.

### packages/shared/src/ui/__tests__/statusMachine.test.ts (~150 LOC)

| ID | Case | Expectation |
|---|---|---|
| SM-1 | `UIStatus.idle()` | `{kind:'idle'}` |
| SM-2 | `UIStatus.loading()` | `{kind:'loading'}` |
| SM-3 | `UIStatus.ready({a:1})` | `{kind:'ready',data:{a:1}}` |
| SM-4 | `UIStatus.empty('filtered-out')` | `{kind:'empty',reason:'filtered-out'}` |
| SM-5 | `UIStatus.failed(new AppError('boom',500,'INTERNAL'))` | `{kind:'failed',error:<AppError>}` |
| SM-6 | `isReady` narrows to `{data:T}`; `isFailed` narrows to `{error:AppError}` (compile + runtime) | both narrow correctly |
| SM-7 | `matchUIStatus` exhaustive over 5 kinds; missing branch → `// @ts-expect-error` (compile-time exhaustiveness contract pin) | all 5 branches green; missing-branch fails compile |

### packages/shared/src/errors/__tests__/result.test.ts (~180 LOC)

| ID | Case | Expectation |
|---|---|---|
| RES-1 | `Result.ok(42)` | `{kind:'ok',value:42}`; isOk true; isErr false |
| RES-2 | `Result.err(new AppError('x',422,'V'))` | `{kind:'err',error:<AppError>}`; isErr true |
| RES-3 | `match(Result.ok(1), {ok,err})` calls `ok(1)`; same for err branch | both branches |
| RES-4 | `unwrap` ok→value; err→throws AppError | both paths |
| RES-5 | `unwrapOr` err→fallback; `unwrapOrElse` err→fn(error) | lazy + eager |
| RES-6 | `map(ok(2), x=>x*2)` → `ok(4)`; `map(err(e), …)` → `err(e)` (mapper not invoked); same for mapErr | mapper never on wrong arm |
| RES-7 | `tryAsync(()=>Promise.resolve(7))` → `ok(7)`; `tryAsync(()=>Promise.reject(new AppError(…)))` → `err(<that>)`; `tryAsync(()=>Promise.reject('string'))` → `err(<wrapped via fromUnknown>)` (BUG-531 hook) | all three including unknown-coercion |

**Pre-fix RED:** structural — `import from '@signacare/shared'` fails to resolve before the SSoT lands. 14/14 GREEN after. Run ×3 flake.

## §6. Fix-registry rows (5)

| ID | File | Type | Pattern |
|---|---|---|---|
| `R-FIX-BUG-530-UI-STATUS-EXPORT` | `packages/shared/src/ui/statusMachine.ts` | present | `^export type UIStatus<` |
| `R-FIX-BUG-530-RESULT-EXPORT` | `packages/shared/src/errors/result.ts` | present | `^export type Result<` |
| `R-FIX-BUG-530-FIVE-STATES` | `packages/shared/src/ui/statusMachine.ts` | present | `kind: 'idle'.*kind: 'loading'.*kind: 'ready'.*kind: 'empty'.*kind: 'failed'` (multiline-dotall) |
| `R-FIX-BUG-530-TRY-ASYNC` | `packages/shared/src/errors/result.ts` | present | `^export (async )?function tryAsync<` |
| `R-FIX-BUG-530-CLAUDE-MD-SECTION-16` | `CLAUDE.md` | present | `^## 16\. UI STATUS \+ SERVICE RESULT` |

## §7. Files to modify

| File | Action | Net LOC |
|---|---|---|
| `packages/shared/src/ui/statusMachine.ts` | NEW | ~120 |
| `packages/shared/src/errors/result.ts` | NEW | ~140 |
| `packages/shared/src/errors/appError.ts` | NEW (shim) | ~40 |
| `packages/shared/src/ui/__tests__/statusMachine.test.ts` | NEW | ~150 |
| `packages/shared/src/errors/__tests__/result.test.ts` | NEW | ~180 |
| `packages/shared/vitest.config.ts` | NEW | ~20 |
| `packages/shared/src/index.ts` | EXTEND (+3 lines) | +3 |
| `package.json` (root) | EXTEND (+1 script) | +1 |
| `CLAUDE.md` | EXTEND (§3.4 + §16) | +80 |
| `docs/quality/fix-registry.md` | EXTEND (5 anchors) | +5 |
| `docs/quality/bugs-remaining.md` | EXTEND (atomic flip + 2 follow-ups) | +3 |

Zero edits to any apps/* file.

## §8. Trigger assessment

- L3: FIRES.
- L4: does NOT fire (no clinical surface).
- L5: FIRES (packages/shared/ + CLAUDE.md + fix-registry — three §I triggers stacked).

BUG-527 atomic-flip: packages/shared/ NOT in safety-surfaces.txt today, so guard not triggered — but we flip atomically anyway per discipline.

## §9. Risks

- **§9.1 Bikeshedding 5 vs N states** — mitigated by §2.1 first-principles table.
- **§9.2 API bloat** — mitigated by §2.2 lean-surface list.
- **§9.3 Why Result vs Promise rejection** — Result for *expected* failures (validation/not-found/business-rule); throws for *unexpected* (DB lost, OOM). Documented in CLAUDE.md §3.4.
- **§9.4 AppError shim drift** — small/stable; follow-up BUG-541 reconciles.
- **§9.5 BUG-527 safety-surfaces gap** — packages/shared/{ui,errors}/ not listed; follow-up filed.
- **§9.6 AppError consolidation** — NEW BUG-541 (S2): consolidate apps/api AppError + shared shim.
- **§9.7 ESLint forward-ref** — BUG-531 is next; reference is explicit and load-bearing.
- **§9.8 Cascade-discovery** — N/A (NEW files; empty directories before commit; index.ts only consumer).

## §10. Acceptance

- 5 fix-registry rows pass.
- 14 test cases (SM-1..7, RES-1..7) GREEN ×3 flake.
- `// @ts-expect-error` exhaustiveness assertions pin compile-time contract.
- L1 GREEN: tsc × 3 workspaces, all guards.
- L3 PASS, L5 PASS, L4 not invoked.
- CLAUDE.md §3.4 + §16 present.
- Atomic catalogue flip (BUG-530 → fixed) + follow-ups (BUG-541 + safety-surfaces extension).
- Zero modifications to any apps/* file.
- Explicit user authorization before push.
