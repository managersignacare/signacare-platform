/*
 * packages/shared/src/errors/appError.ts
 *
 * BUG-530 — minimal `AppError` shim for shared types.
 *
 * Today's production `AppError` lives in `apps/api/src/shared/errors.ts`
 * and extends an api-side `HttpError`. `Result<T, AppError>` (this BUG)
 * needs an `AppError` symbol importable from `@signacare/shared`, so we
 * mirror a structurally-identical shape here. The api-side class
 * remains the runtime-canonical implementation; this shim covers the
 * shared/web/test-time consumers.
 *
 * Reconciliation to ONE definition is BUG-541 follow-up (filed in this
 * commit). The shape is small and stable — drift risk is bounded.
 */

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
    // Restore prototype chain across ES5 transpilation boundaries so
    // `instanceof AppError` works in consumers compiled to older targets.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Permissive code alias. The api-side `errors.ts` narrows this to a
 * `'NOT_FOUND' | 'VALIDATION_ERROR' | …` literal union; the shim stays
 * permissive so shared-side consumers don't need the full code list.
 * BUG-541 reconciles.
 */
export type AppErrorCode = string;
