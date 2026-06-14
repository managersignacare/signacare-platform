import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hasTableMock = vi.fn();

vi.mock('../../src/db/db', () => ({
  dbAdmin: {
    schema: {
      hasTable: hasTableMock,
    },
  },
}));

describe('optionalSchema cache policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T00:00:00.000Z'));
    hasTableMock.mockReset();
  });

  afterEach(async () => {
    const mod = await import('../../src/shared/optionalSchema');
    mod.resetOptionalTableCacheForTests();
    vi.useRealTimers();
  });

  it('caches present tables across repeated calls', async () => {
    hasTableMock.mockResolvedValue(true);
    const mod = await import('../../src/shared/optionalSchema');

    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(true);
    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(true);

    expect(hasTableMock).toHaveBeenCalledTimes(1);
  });

  it('re-checks absent tables after the false-cache ttl expires', async () => {
    hasTableMock.mockResolvedValue(false);
    const mod = await import('../../src/shared/optionalSchema');

    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(false);
    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(false);
    expect(hasTableMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(mod.OPTIONAL_TABLE_FALSE_CACHE_TTL_MS + 1);
    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(false);
    expect(hasTableMock).toHaveBeenCalledTimes(2);
  });

  it('degrades schema probe errors to a short-lived false result and re-checks after ttl', async () => {
    const mod = await import('../../src/shared/optionalSchema');
    hasTableMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(false);
    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(false);
    expect(hasTableMock).toHaveBeenCalledTimes(1);

    hasTableMock.mockResolvedValueOnce(true);
    vi.advanceTimersByTime(mod.OPTIONAL_TABLE_FALSE_CACHE_TTL_MS + 1);
    await expect(mod.hasOptionalTable('appointment_attendees')).resolves.toBe(true);
    expect(hasTableMock).toHaveBeenCalledTimes(2);
  });
});
