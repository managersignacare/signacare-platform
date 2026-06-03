/*
 * packages/shared/src/ui/statusMachine.ts
 *
 * BUG-530 — UIStatus<T>: 5-state discriminated union for safety-surface
 * fetch UIs. Closes the BUG-445/446/520/521/523 lie-about-success class.
 *
 * The 5 states (idle | loading | ready | empty | failed) are minimal-
 * sufficient for the empirical bug surface. See CLAUDE.md §16.1 for the
 * first-principles justification of why each state earns its place.
 *
 * Discriminator field is `kind` (matching the convention used in the
 * appointment.Schemas / treatment-pathway shared discriminated unions).
 *
 * Adoption rule: opt-in per BUG. New safety-surface code SHOULD use
 * UIStatus + matchUIStatus; existing code is migrated by dedicated
 * BUGs (BUG-446, BUG-521 follow-ups) so each migration carries its
 * own pre-fix RED + L4/L5 review.
 */

import type { Result } from '../errors/result';
import { isOk } from '../errors/result';
import { AppError } from '../errors/appError';

// BUG-530 — 5 states: idle, loading, ready, empty, failed
// (single-line state-list anchor; removing any state from the union is a
// mutation-resistant fix-registry contract pin — see R-FIX-BUG-530-FIVE-STATES.)

// ─── Per-state shapes (exported for narrowed-type consumers) ────────

export type UIStatusIdle = { kind: 'idle' };

export type UIStatusLoading = { kind: 'loading' };

export type UIStatusReady<T> = { kind: 'ready'; data: T };

/**
 * `empty` is a FIRST-CLASS state, not `ready` with `data: []`.
 * The reason field lets list views distinguish "filter excluded all
 * rows" from "underlying table has no rows" without collapsing both
 * to a generic empty state. Lean — three values cover the empirical
 * surface; future BUG can extend.
 */
export type UIStatusEmpty = {
  kind: 'empty';
  reason?: 'no-results' | 'not-yet-loaded' | 'filtered-out';
};

/**
 * `failed` carries an AppError (status / code / message / details) and
 * an optional `retry` callback. The compiler refuses to compile a
 * `matchUIStatus` that omits `failed`, eliminating the BUG-445 silent-
 * fallback failure mode.
 */
export type UIStatusFailed = {
  kind: 'failed';
  error: AppError;
  retry?: () => void;
};

/** Discriminated union over the 5 states. */
export type UIStatus<T> =
  | UIStatusIdle
  | UIStatusLoading
  | UIStatusReady<T>
  | UIStatusEmpty
  | UIStatusFailed;

// ─── Constructors ───────────────────────────────────────────────────

function idle(): UIStatusIdle {
  return { kind: 'idle' };
}

function loading(): UIStatusLoading {
  return { kind: 'loading' };
}

function ready<T>(data: T): UIStatusReady<T> {
  return { kind: 'ready', data };
}

function empty(reason?: UIStatusEmpty['reason']): UIStatusEmpty {
  return { kind: 'empty', reason };
}

function failed(error: AppError, retry?: () => void): UIStatusFailed {
  return { kind: 'failed', error, retry };
}

/**
 * Adapter from Result<T, AppError> → UIStatus<T>. Optional `isEmpty`
 * predicate splits ok values into the empty state — e.g.
 * `UIStatus.fromResult(r, (xs) => xs.length === 0)` for list endpoints.
 * Without the predicate, a successful Result always maps to ready.
 */
function fromResult<T>(
  r: Result<T, AppError>,
  isEmpty?: (data: T) => boolean,
): UIStatus<T> {
  if (isOk(r)) {
    if (isEmpty?.(r.value)) return empty('no-results');
    return ready(r.value);
  }
  return failed(r.error);
}

/**
 * Canonical UIStatus value-namespace. The type alias `UIStatus<T>`
 * (above) and this value `UIStatus` (below) coexist by TypeScript's
 * separate type/value namespaces.
 */
export const UIStatus = { idle, loading, ready, empty, failed, fromResult } as const;

// ─── Type guards (load-bearing for renderer narrowing) ──────────────

export const isIdle = (s: UIStatus<unknown>): s is UIStatusIdle => s.kind === 'idle';
export const isLoading = (s: UIStatus<unknown>): s is UIStatusLoading => s.kind === 'loading';
export const isReady = <T>(s: UIStatus<T>): s is UIStatusReady<T> => s.kind === 'ready';
export const isEmpty = (s: UIStatus<unknown>): s is UIStatusEmpty => s.kind === 'empty';
export const isFailed = (s: UIStatus<unknown>): s is UIStatusFailed => s.kind === 'failed';

// ─── Exhaustive matcher (compile-time exhaustiveness) ───────────────

/**
 * Exhaustive pattern-match over UIStatus. The TypeScript compiler
 * refuses to type-check a call that omits any of the 5 handler keys,
 * which is the structural guarantee that prevents the BUG-445 silent-
 * fallback class.
 *
 * Renderers should ALWAYS use this rather than chained `if (isReady)
 * ... else if (isFailed) ...` blocks — the chain has no compile-time
 * exhaustiveness check.
 */
export function matchUIStatus<T, R>(
  s: UIStatus<T>,
  handlers: {
    idle: () => R;
    loading: () => R;
    ready: (data: T) => R;
    empty: (reason: UIStatusEmpty['reason']) => R;
    failed: (error: AppError, retry?: () => void) => R;
  },
): R {
  switch (s.kind) {
    case 'idle':
      return handlers.idle();
    case 'loading':
      return handlers.loading();
    case 'ready':
      return handlers.ready(s.data);
    case 'empty':
      return handlers.empty(s.reason);
    case 'failed':
      return handlers.failed(s.error, s.retry);
    default: {
      // Compile-time exhaustiveness check — if a new state is added
      // to the union without adding a handler, this assignment fails.
      const _exhaustive: never = s;
      throw new Error(`matchUIStatus: unhandled UIStatus kind ${JSON.stringify(_exhaustive)}`);
    }
  }
}
