/*
 * packages/shared/src/errors/__tests__/result.test.ts
 *
 * BUG-530 — 7 cases pinning the Result<T, AppError> contract.
 *
 * Pre-fix RED: imports fail to resolve before BUG-530 SSoT lands.
 * Post-fix GREEN: all 7 cases pass.
 *
 * RES-7 specifically pins the BUG-531 hook: tryAsync MUST return
 * Result<T, AppError> regardless of what was thrown (AppError pass-
 * through; non-AppError wrapped via fromUnknown). This is the
 * structural contract BUG-531's ESLint autofix points at.
 */
import { describe, it, expect } from 'vitest';
import {
  Result,
  isOk,
  isErr,
  match,
  unwrap,
  unwrapOr,
  unwrapOrElse,
  map,
  mapErr,
  tryAsync,
  trySync,
  fromUnknown,
  AppError,
} from '../../index';

describe('BUG-530 Result<T, AppError> — outcome wrapper', () => {
  it('RES-1: Result.ok produces { kind: "ok", value }; isOk narrows', () => {
    const r = Result.ok(42);
    expect(r).toEqual({ kind: 'ok', value: 42 });
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('RES-2: Result.err produces { kind: "err", error }; isErr narrows', () => {
    const err = new AppError('validation', 422, 'VALIDATION_ERROR');
    const r = Result.err(err);
    expect(r.kind).toBe('err');
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (isErr(r)) expect(r.error).toBe(err);
  });

  it('RES-3: match dispatches to the correct handler arm', () => {
    const okResult = match(Result.ok(7), {
      ok:  (v) => `ok:${v}`,
      err: (_e) => 'err-branch',
    });
    expect(okResult).toBe('ok:7');

    const errResult = match(Result.err(new AppError('e', 500, 'X')), {
      ok:  (_v) => 'ok-branch',
      err: (e) => `err:${e.code}`,
    });
    expect(errResult).toBe('err:X');
  });

  it('RES-4: unwrap returns value on ok and throws AppError on err', () => {
    expect(unwrap(Result.ok(99))).toBe(99);
    const err = new AppError('boom', 500, 'INTERNAL');
    expect(() => unwrap(Result.err(err))).toThrow(err);
  });

  it('RES-5: unwrapOr returns fallback on err; unwrapOrElse calls fn(error) lazily', () => {
    expect(unwrapOr(Result.ok(1), 99)).toBe(1);
    expect(unwrapOr(Result.err(new AppError('e', 500, 'X')), 99)).toBe(99);

    let called = 0;
    const lazy = (e: AppError) => { called++; return `fallback:${e.code}`; };
    expect(unwrapOrElse(Result.ok('hit'), lazy)).toBe('hit');
    expect(called).toBe(0); // not called on ok branch
    expect(unwrapOrElse(Result.err(new AppError('e', 500, 'X')), lazy)).toBe('fallback:X');
    expect(called).toBe(1);
  });

  it('RES-6: map / mapErr preserve discrimination; mapper not invoked on the wrong arm', () => {
    let mapCalled = 0;
    let mapErrCalled = 0;

    const okMapped = map(Result.ok(2), (x) => { mapCalled++; return x * 2; });
    expect(okMapped).toEqual({ kind: 'ok', value: 4 });
    expect(mapCalled).toBe(1);

    const errIn = new AppError('e', 500, 'X');
    const errPreserved = map(Result.err(errIn), (x) => { mapCalled++; return (x as number) * 2; });
    expect(errPreserved).toEqual({ kind: 'err', error: errIn });
    expect(mapCalled).toBe(1); // map fn NOT called on err arm

    const errMapped = mapErr(Result.err(errIn), (e) => { mapErrCalled++; return new AppError(e.message, 503, 'WRAPPED'); });
    if (isErr(errMapped)) expect(errMapped.error.code).toBe('WRAPPED');
    expect(mapErrCalled).toBe(1);

    const okPreserved = mapErr(Result.ok(5), (e) => { mapErrCalled++; return e; });
    expect(okPreserved).toEqual({ kind: 'ok', value: 5 });
    expect(mapErrCalled).toBe(1); // mapErr NOT called on ok arm
  });

  it('RES-7: tryAsync converts throws to Result.err; AppError passes through; unknown wraps via fromUnknown (BUG-531 hook)', async () => {
    // Resolved Promise → ok
    const okR = await tryAsync(() => Promise.resolve(7));
    expect(okR).toEqual({ kind: 'ok', value: 7 });

    // Rejected with AppError → err with same instance
    const ae = new AppError('upstream', 502, 'UPSTREAM_FAILED');
    const errR1 = await tryAsync(() => Promise.reject(ae));
    expect(isErr(errR1)).toBe(true);
    if (isErr(errR1)) expect(errR1.error).toBe(ae);

    // Rejected with a string → wrapped via fromUnknown
    const errR2 = await tryAsync(() => Promise.reject('plain-string-thrown'));
    expect(isErr(errR2)).toBe(true);
    if (isErr(errR2)) {
      expect(errR2.error).toBeInstanceOf(AppError);
      expect(errR2.error.message).toContain('plain-string-thrown');
    }

    // Rejected with a generic Error → wrapped via fromUnknown
    const errR3 = await tryAsync(() => Promise.reject(new Error('regular-error')));
    expect(isErr(errR3)).toBe(true);
    if (isErr(errR3)) {
      expect(errR3.error).toBeInstanceOf(AppError);
      expect(errR3.error.message).toContain('regular-error');
    }

    // trySync sibling: throws→err, returns→ok
    const sOk = trySync(() => 100);
    expect(sOk).toEqual({ kind: 'ok', value: 100 });
    const sErr = trySync(() => { throw new AppError('s', 500, 'S'); });
    expect(isErr(sErr)).toBe(true);

    // fromUnknown explicit
    const wrapped = fromUnknown('raw-string');
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe('UNKNOWN_THROWN');
  });

  it('RES-7b: fromUnknown DUCK-TYPES status/code on cross-class Error subclasses (BUG-530 absorb-1)', () => {
    // Simulate api-side AppError (different class identity, same shape).
    // Until BUG-541 reconciles to one canonical class, an api-thrown
    // AppError caught by shared-side tryAsync MUST preserve status/code,
    // not silently downgrade to 500/UNKNOWN_THROWN. This is the
    // load-bearing case that prevents the SSoT from re-introducing the
    // BUG-445 lie-about-success class internally.
    class ApiSideAppError extends Error {
      public readonly status: number;
      public readonly code: string;
      public readonly details?: unknown;
      constructor(message: string, status: number, code: string, details?: unknown) {
        super(message);
        this.name = 'AppError'; // matches api-side `this.name = 'AppError'`
        this.status = status;
        this.code = code;
        this.details = details;
      }
    }
    const apiThrown = new ApiSideAppError('Patient not found', 404, 'NOT_FOUND', { patientId: 'abc' });
    expect(apiThrown).not.toBeInstanceOf(AppError); // distinct class identity confirmed
    expect(apiThrown).toBeInstanceOf(Error);

    const wrapped = fromUnknown(apiThrown);
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.status).toBe(404);             // NOT 500
    expect(wrapped.code).toBe('NOT_FOUND');        // NOT 'UNKNOWN_THROWN'
    expect(wrapped.message).toBe('Patient not found');
    expect(wrapped.details).toEqual({ patientId: 'abc' });

    // Plain Error WITHOUT status/code should still hit the 500 fallback.
    const plain = new Error('regular bug');
    const plainWrapped = fromUnknown(plain);
    expect(plainWrapped.status).toBe(500);
    expect(plainWrapped.code).toBe('UNKNOWN_THROWN');

    // Error with status but no code → 500 fallback (both required).
    const partial = Object.assign(new Error('partial'), { status: 503 });
    const partialWrapped = fromUnknown(partial);
    expect(partialWrapped.status).toBe(500);

    // undefined / null / boolean coverage (RES-7 implicit boundary).
    expect(fromUnknown(undefined).code).toBe('UNKNOWN_THROWN');
    expect(fromUnknown(null).code).toBe('UNKNOWN_THROWN');
    expect(fromUnknown(false).code).toBe('UNKNOWN_THROWN');
  });

  it('RES-7c: tryAsync end-to-end preserves cross-class status/code (BUG-530 absorb-2 F3)', async () => {
    // L3 absorb-2 finding F3: RES-7b pinned `fromUnknown` directly. The
    // load-bearing integration is the FULL path: tryAsync → catch (e) →
    // fromUnknown(e) → Result.err(AppError). A future refactor of
    // tryAsync that bypasses fromUnknown could silently regress to
    // 500/UNKNOWN_THROWN even though RES-7b stays green. This test
    // pins the END-TO-END signal preservation.
    class ApiSideAppError extends Error {
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

    // Promise.reject with api-side AppError → Result.err with preserved 404/NOT_FOUND
    const r1 = await tryAsync(() => Promise.reject(new ApiSideAppError('Patient not found', 404, 'NOT_FOUND', { patientId: 'abc' })));
    expect(isErr(r1)).toBe(true);
    if (isErr(r1)) {
      expect(r1.error).toBeInstanceOf(AppError);
      expect(r1.error.status).toBe(404);
      expect(r1.error.code).toBe('NOT_FOUND');
      expect(r1.error.message).toBe('Patient not found');
      expect(r1.error.details).toEqual({ patientId: 'abc' });
    }

    // Promise.reject with 422/VALIDATION_ERROR → preserved end-to-end
    const r2 = await tryAsync(() => Promise.reject(new ApiSideAppError('email required', 422, 'VALIDATION_ERROR')));
    expect(isErr(r2)).toBe(true);
    if (isErr(r2)) {
      expect(r2.error.status).toBe(422);
      expect(r2.error.code).toBe('VALIDATION_ERROR');
    }

    // Plain Error rejected → 500/UNKNOWN_THROWN end-to-end (regression baseline)
    const r3 = await tryAsync(() => Promise.reject(new Error('regular bug')));
    expect(isErr(r3)).toBe(true);
    if (isErr(r3)) {
      expect(r3.error.status).toBe(500);
      expect(r3.error.code).toBe('UNKNOWN_THROWN');
    }

    // Sync sibling: trySync end-to-end same shape
    const r4 = trySync(() => { throw new ApiSideAppError('locked', 423, 'LOCKED'); });
    expect(isErr(r4)).toBe(true);
    if (isErr(r4)) {
      expect(r4.error.status).toBe(423);
      expect(r4.error.code).toBe('LOCKED');
    }
  });
});
