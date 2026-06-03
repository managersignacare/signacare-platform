import { describe, expect, it, vi } from 'vitest';
import { flushLoggerSync } from '../../src/utils/logger';

describe('BUG-306 flushLoggerSync', () => {
  it('returns false when destination has no flushSync', () => {
    expect(flushLoggerSync({})).toBe(false);
  });

  it('calls flushSync and returns true when available', () => {
    const flushSync = vi.fn();
    expect(flushLoggerSync({ flushSync })).toBe(true);
    expect(flushSync).toHaveBeenCalledTimes(1);
  });

  it('propagates destination flush errors to caller', () => {
    expect(() => flushLoggerSync({ flushSync: () => { throw new Error('flush failed'); } })).toThrow(
      'flush failed',
    );
  });
});

