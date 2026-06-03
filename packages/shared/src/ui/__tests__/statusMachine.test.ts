/*
 * packages/shared/src/ui/__tests__/statusMachine.test.ts
 *
 * BUG-530 — 7 cases pinning the 5-state UIStatus contract.
 *
 * Pre-fix RED: imports fail to resolve before BUG-530 SSoT lands.
 * Post-fix GREEN: all 7 cases pass; SM-7 doubles as a compile-time
 * exhaustiveness contract pin (`// @ts-expect-error` directives fail
 * the build if the union loses a case in the future).
 */
import { describe, it, expect } from 'vitest';
import {
  UIStatus,
  isIdle,
  isLoading,
  isReady,
  isEmpty,
  isFailed,
  matchUIStatus,
  AppError,
} from '../../index';

describe('BUG-530 UIStatus — 5-state discriminated union', () => {
  it('SM-1: idle constructor produces { kind: "idle" }', () => {
    const s = UIStatus.idle();
    expect(s).toEqual({ kind: 'idle' });
    expect(isIdle(s)).toBe(true);
    expect(isLoading(s)).toBe(false);
  });

  it('SM-2: loading constructor produces { kind: "loading" }', () => {
    const s = UIStatus.loading();
    expect(s).toEqual({ kind: 'loading' });
    expect(isLoading(s)).toBe(true);
    expect(isReady(s)).toBe(false);
  });

  it('SM-3: ready constructor carries the data payload', () => {
    const s = UIStatus.ready({ a: 1, b: 'two' });
    expect(s).toEqual({ kind: 'ready', data: { a: 1, b: 'two' } });
    expect(isReady(s)).toBe(true);
  });

  it('SM-4: empty constructor accepts an optional reason field', () => {
    const a = UIStatus.empty();
    expect(a).toEqual({ kind: 'empty', reason: undefined });
    const b = UIStatus.empty('filtered-out');
    expect(b).toEqual({ kind: 'empty', reason: 'filtered-out' });
    expect(isEmpty(b)).toBe(true);
  });

  it('SM-5: failed constructor carries an AppError + optional retry callback', () => {
    const err = new AppError('boom', 500, 'INTERNAL');
    let retried = false;
    const retry = () => { retried = true; };
    const s = UIStatus.failed(err, retry);
    expect(s.kind).toBe('failed');
    if (s.kind !== 'failed') throw new Error('unreachable');
    expect(s.error).toBe(err);
    expect(s.error.status).toBe(500);
    expect(s.error.code).toBe('INTERNAL');
    s.retry?.();
    expect(retried).toBe(true);
    expect(isFailed(s)).toBe(true);
  });

  it('SM-6: type guards narrow the discriminated union correctly', () => {
    const ready = UIStatus.ready([1, 2, 3]);
    if (isReady(ready)) {
      // TypeScript-level: data is now `number[]` not `T | undefined`
      expect(ready.data.length).toBe(3);
    } else {
      throw new Error('isReady narrowing failed');
    }
    const failed = UIStatus.failed(new AppError('x', 422, 'V'));
    if (isFailed(failed)) {
      // TypeScript-level: error is now AppError not `AppError | undefined`
      expect(failed.error.code).toBe('V');
    } else {
      throw new Error('isFailed narrowing failed');
    }
  });

  it('SM-7: matchUIStatus is exhaustive over all 5 kinds (compile-time pin)', () => {
    const handlers = {
      idle:    () => 'idle-branch',
      loading: () => 'loading-branch',
      ready:   (data: unknown) => `ready:${JSON.stringify(data)}`,
      empty:   (reason: string | undefined) => `empty:${reason ?? 'none'}`,
      failed:  (error: AppError) => `failed:${error.code}`,
    };
    expect(matchUIStatus(UIStatus.idle(), handlers)).toBe('idle-branch');
    expect(matchUIStatus(UIStatus.loading(), handlers)).toBe('loading-branch');
    expect(matchUIStatus(UIStatus.ready({ x: 1 }), handlers)).toBe('ready:{"x":1}');
    expect(matchUIStatus(UIStatus.empty('no-results'), handlers)).toBe('empty:no-results');
    expect(matchUIStatus(UIStatus.failed(new AppError('e', 500, 'X')), handlers)).toBe('failed:X');

    // Compile-time exhaustiveness contract pin: removing any handler key
    // below MUST cause `// @ts-expect-error` to FAIL (because the error
    // disappears) and break the build. This is the canonical way to
    // ensure the 5-state union cannot silently lose a case.
    // @ts-expect-error — handlers missing 'failed' branch on purpose
    const incompletePartialHandlers: Parameters<typeof matchUIStatus>[1] = {
      idle:    () => 'i',
      loading: () => 'l',
      ready:   (_d: unknown) => 'r',
      empty:   () => 'e',
      // failed: missing
    };
    expect(typeof incompletePartialHandlers).toBe('object');
  });
});
