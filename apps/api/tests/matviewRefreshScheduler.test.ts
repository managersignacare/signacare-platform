/**
 * S2.4 — matviewRefreshScheduler unit tests
 *
 * The scheduler is mostly side-effect glue (cron tick → REFRESH MATERIALIZED
 * VIEW). The interesting unit-testable surface is the identifier validation
 * inside refreshOneView, which is the SQL-injection guard preventing the
 * MATVIEW_REFRESH_VIEWS env var from being used to inject arbitrary SQL.
 *
 * The actual REFRESH execution is mocked through the db module so the test
 * never opens a real connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rawCalls: Array<{ sql: string; bindings: unknown[] | undefined }> = [];

vi.mock('../src/db/db', () => ({
  db: {
    raw: vi.fn(async (sql: string, bindings?: unknown[]) => {
      rawCalls.push({ sql, bindings });
      return [];
    }),
  },
}));

vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { refreshOneView } from '../src/jobs/schedulers/matviewRefreshScheduler';

describe('matviewRefreshScheduler.refreshOneView', () => {
  beforeEach(() => {
    rawCalls.length = 0;
  });

  it('refreshes a valid snake_case view name', async () => {
    const r = await refreshOneView('vw_dashboard_summary');
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0]).toEqual({
      sql: 'REFRESH MATERIALIZED VIEW CONCURRENTLY ??',
      bindings: ['vw_dashboard_summary'],
    });
  });

  it('rejects names with semicolons (SQL injection attempt)', async () => {
    const r = await refreshOneView('vw_x; DROP TABLE patients');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_identifier');
    expect(rawCalls).toHaveLength(0);
  });

  it('rejects names with spaces', async () => {
    const r = await refreshOneView('vw foo');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_identifier');
    expect(rawCalls).toHaveLength(0);
  });

  it('rejects empty names', async () => {
    const r = await refreshOneView('');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_identifier');
    expect(rawCalls).toHaveLength(0);
  });

  it('rejects names starting with a digit', async () => {
    const r = await refreshOneView('1vw_bad');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_identifier');
    expect(rawCalls).toHaveLength(0);
  });

  it('rejects names with hyphens', async () => {
    const r = await refreshOneView('vw-bad');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_identifier');
    expect(rawCalls).toHaveLength(0);
  });

  it('rejects names longer than the postgres identifier limit (63 chars)', async () => {
    const r = await refreshOneView('a' + 'b'.repeat(63));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_identifier');
    expect(rawCalls).toHaveLength(0);
  });

  it('accepts the maximum allowed length (63 chars)', async () => {
    const r = await refreshOneView('a' + 'b'.repeat(62));
    expect(r.ok).toBe(true);
  });
});
