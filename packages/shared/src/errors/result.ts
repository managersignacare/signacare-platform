/*
 * packages/shared/src/errors/result.ts
 *
 * BUG-530 — Result<T, E = AppError>: canonical service-layer outcome
 * wrapper for *expected* failures (validation, not-found, business-
 * rule violations, optimistic-lock conflicts). Throws remain reserved
 * for *unexpected* failures (DB connection lost, OOM, programming bug).
 *
 * Why both:
 *   - Promise rejection is implicit; callers can forget to handle it.
 *     Result is explicit; the type system forces narrowing before
 *     consuming the value.
 *   - Today's `try { ... } catch { fabricate-success-shape }` pattern
 *     (BUG-445/446/520/521/523 root cause) cannot type-check against
 *     Result — `r.value` is unreachable until `isOk(r)` narrows.
 *
 * The discriminator field is `kind` (matching UIStatus's discriminator
 * convention; not `tag`, not `_t`, not `success`/`error` booleans).
 *
 * `tryAsync` is the canonical fix-shape that BUG-531's ESLint rule
 * (Phase A item 6) will point at when banning empty `} catch { }`
 * blocks. See CLAUDE.md §16.2.
 */

import { AppError } from './appError';

export type ResultOk<T> = { kind: 'ok'; value: T };
export type ResultErr<E> = { kind: 'err'; error: E };

/**
 * Discriminated outcome wrapper. Default `E = AppError` so the common
 * case `Result<Patient>` automatically widens to `Result<Patient,
 * AppError>` — matching the wire-shape that `apps/api/src/shared/
 * errors.ts:toErrorResponse` already serialises and the BUG-531 autofix
 * will produce.
 */
export type Result<T, E = AppError> = ResultOk<T> | ResultErr<E>;

// ─── Constructors ───────────────────────────────────────────────────

function ok<T>(value: T): ResultOk<T> {
  return { kind: 'ok', value };
}

function err<E = AppError>(error: E): ResultErr<E> {
  return { kind: 'err', error };
}

/**
 * Canonical entry-points for constructing Results. Namespace exposes
 * `Result.ok(...)` / `Result.err(...)` matching Rust convention. The
 * type alias `Result<T, E>` (above) and this value `Result` (below)
 * coexist by TypeScript's separate type/value namespaces.
 */
export const Result = { ok, err } as const;

// ─── Type guards (load-bearing for narrowing) ───────────────────────

export const isOk = <T, E>(r: Result<T, E>): r is ResultOk<T> => r.kind === 'ok';

export const isErr = <T, E>(r: Result<T, E>): r is ResultErr<E> => r.kind === 'err';

// ─── Pattern-match (exhaustive) ─────────────────────────────────────

export function match<T, E, R>(
  r: Result<T, E>,
  handlers: {
    ok: (value: T) => R;
    err: (error: E) => R;
  },
): R {
  return r.kind === 'ok' ? handlers.ok(r.value) : handlers.err(r.error);
}

// ─── Unwrap helpers ─────────────────────────────────────────────────

/**
 * Extract the value or throw the error. Use ONLY at boundaries where
 * a thrown error is the right shape (e.g. test setup; routes that
 * delegate to the global Express error middleware via `next(err)`).
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.kind === 'ok') return r.value;
  throw r.error;
}

/** Eager fallback — `fallback` is evaluated whether or not `r` is ok. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.kind === 'ok' ? r.value : fallback;
}

/** Lazy fallback — `fn(error)` runs only on the err arm. */
export function unwrapOrElse<T, E>(r: Result<T, E>, fn: (error: E) => T): T {
  return r.kind === 'ok' ? r.value : fn(r.error);
}

// ─── Mappers ────────────────────────────────────────────────────────

/** Transform the ok value; err arm is preserved unchanged. */
export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.kind === 'ok' ? Result.ok(fn(r.value)) : r;
}

/** Transform the err value; ok arm is preserved unchanged. */
export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.kind === 'err' ? Result.err(fn(r.error)) : r;
}

// ─── Throw → Result conversion (BUG-531 hook) ───────────────────────

/**
 * Coerce an unknown thrown value to an AppError. Coverage:
 *
 *   thrown                                  → result
 *   ─────────────────────────────────────────────────────────────────
 *   AppError instance (shared-side)         → pass-through (preserves status / code / details)
 *   Error subclass with numeric `.status`   → AppError(msg, status, code ?? 'UNKNOWN_THROWN', details)
 *     and string `.code` (DUCK-TYPE)         (BUG-530 absorb-1: this branch preserves the clinical signal
 *                                            for api-side AppError instances which are NOT shared-side
 *                                            instanceof until BUG-541 reconciles to one canonical class)
 *   Plain Error / Error subclass            → AppError(msg, 500, 'UNKNOWN_THROWN', { name })
 *   string                                  → AppError(thrown, 500, 'UNKNOWN_THROWN')
 *   undefined / null / number / boolean /   → AppError(`Non-error value thrown: ${String(thrown)}`, 500,
 *     Symbol / plain object                    'UNKNOWN_THROWN', { thrown })
 *
 * The code `UNKNOWN_THROWN` lets observability dashboards distinguish
 * "deliberate AppError(…)" from "accidentally-thrown native Error" —
 * the latter is usually a sign of a missing AppError-wrap upstream.
 *
 * The duck-type branch is load-bearing: without it, an api-side
 * AppError thrown into shared-side `tryAsync` would lose its 404 /
 * 422 / etc. status and silently downgrade to 500 — the BUG-445
 * lie-about-success class re-emerging inside the SSoT meant to close
 * it. Reconciliation to ONE AppError class is BUG-541 follow-up.
 */
export function fromUnknown(thrown: unknown): AppError {
  if (thrown instanceof AppError) return thrown;
  if (thrown instanceof Error) {
    // Cross-class duck-type: api-side AppError carries the same
    // .status / .code / .details own-properties even though its class
    // identity differs from the shared-side AppError. Preserve the
    // signal — do NOT downgrade to 500/UNKNOWN_THROWN.
    const candidate = thrown as Error & { status?: unknown; code?: unknown; details?: unknown };
    if (typeof candidate.status === 'number' && typeof candidate.code === 'string') {
      return new AppError(thrown.message, candidate.status, candidate.code, candidate.details);
    }
    return new AppError(thrown.message, 500, 'UNKNOWN_THROWN', { name: thrown.name });
  }
  if (typeof thrown === 'string') {
    return new AppError(thrown, 500, 'UNKNOWN_THROWN');
  }
  return new AppError(`Non-error value thrown: ${String(thrown)}`, 500, 'UNKNOWN_THROWN', { thrown });
}

/**
 * Wrap an async fn; convert thrown values to Result.err(AppError).
 *
 * The canonical BUG-531 autofix target. Pseudocode of the rule's
 * suggestion when it sees `try { x = await foo() } catch { x = [] }`:
 *
 *   const r = await tryAsync(() => foo());
 *   if (isErr(r)) {
 *     // surface r.error to the user / route / UI
 *     return ...;
 *   }
 *   const x = r.value;
 *
 * This eliminates the silent-fabrication failure mode by forcing the
 * caller to narrow before consuming the value.
 */
export async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, AppError>> {
  try {
    const value = await fn();
    return Result.ok(value);
  } catch (e) {
    return Result.err(fromUnknown(e));
  }
}

/** Sync sibling of `tryAsync`. Same semantics for non-async fns. */
export function trySync<T>(fn: () => T): Result<T, AppError> {
  try {
    return Result.ok(fn());
  } catch (e) {
    return Result.err(fromUnknown(e));
  }
}
