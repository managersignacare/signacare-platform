/**
 * S4.2 — featureFlags unit tests
 *
 * Mocks the db layer + tests the resolution + caching + gradual
 * rollout + clinic-override behaviour.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FlagRow {
  id: string;
  clinic_id: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  rollout_percentage: number;
  created_at: Date;
  updated_at: Date;
}

const tableData: { rows: FlagRow[] } = { rows: [] };

type FlagKey = keyof FlagRow;

interface FakeQuery {
  where(field: Partial<FlagRow>): FakeQuery;
  where<K extends FlagKey>(field: K, value: FlagRow[K]): FakeQuery;
  where<K extends FlagKey>(field: Partial<FlagRow> | K, value?: FlagRow[K]): FakeQuery;
  whereNull<K extends FlagKey>(field: K): FakeQuery;
  first(): Promise<FlagRow | undefined>;
  then<TResult1 = FlagRow[], TResult2 = never>(
    onfulfilled?: ((value: FlagRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

function fakeQuery(): FakeQuery {
  const filters: Array<(r: FlagRow) => boolean> = [];
  const chain: FakeQuery = {
    where<K extends FlagKey>(field: Partial<FlagRow> | K, value?: FlagRow[K]) {
      if (typeof field === 'object') {
        for (const [k, v] of Object.entries(field)) {
          const key = k as FlagKey;
          const expected = v as FlagRow[typeof key];
          filters.push((r) => r[key] === expected);
        }
      } else {
        filters.push((r) => r[field] === value);
      }
      return chain;
    },
    whereNull<K extends FlagKey>(field: K) {
      filters.push((r) => r[field] === null);
      return chain;
    },
    first() {
      return Promise.resolve(tableData.rows.find((r) => filters.every((f) => f(r))));
    },
    then(onfulfilled, onrejected) {
      const rows = tableData.rows.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve(rows).then(onfulfilled, onrejected);
    },
  };
  return chain;
}

vi.mock('../src/db/db', () => ({
  db: vi.fn(() => fakeQuery()),
  dbAdmin: vi.fn(() => fakeQuery()),
}));

vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  isFeatureEnabled,
  isValidFlagName,
  _resetFeatureFlagCache,
} from '../src/shared/featureFlags';

beforeEach(() => {
  tableData.rows = [];
  _resetFeatureFlagCache();
});

describe('isValidFlagName', () => {
  it('accepts lowercase + hyphen', () => {
    expect(isValidFlagName('scribe-live-transcript-beta')).toBe(true);
    expect(isValidFlagName('rag-context-v1')).toBe(true);
    expect(isValidFlagName('a')).toBe(true);
  });

  it('rejects uppercase, spaces, leading digits, length over 100', () => {
    expect(isValidFlagName('CamelCase')).toBe(false);
    expect(isValidFlagName('with space')).toBe(false);
    expect(isValidFlagName('1leading-digit')).toBe(false);
    expect(isValidFlagName('a' + 'b'.repeat(100))).toBe(false);
    expect(isValidFlagName('')).toBe(false);
  });
});

describe('isFeatureEnabled', () => {
  it('returns false for an invalid flag name', async () => {
    expect(await isFeatureEnabled('Bad Name', 'clinic-A')).toBe(false);
  });

  it('returns false when no row exists', async () => {
    expect(await isFeatureEnabled('unknown-flag', 'clinic-A')).toBe(false);
  });

  it('returns true for a global enabled flag', async () => {
    tableData.rows.push({
      id: '1', clinic_id: null, name: 'global-on', description: null,
      enabled: true, rollout_percentage: 100, created_at: new Date(), updated_at: new Date(),
    });
    expect(await isFeatureEnabled('global-on', 'clinic-A')).toBe(true);
  });

  it('returns false for a global disabled flag', async () => {
    tableData.rows.push({
      id: '1', clinic_id: null, name: 'global-off', description: null,
      enabled: false, rollout_percentage: 100, created_at: new Date(), updated_at: new Date(),
    });
    expect(await isFeatureEnabled('global-off', 'clinic-A')).toBe(false);
  });

  it('clinic-specific row overrides global', async () => {
    tableData.rows.push({
      id: '1', clinic_id: null, name: 'override-test', description: null,
      enabled: false, rollout_percentage: 100, created_at: new Date(), updated_at: new Date(),
    });
    tableData.rows.push({
      id: '2', clinic_id: 'clinic-A', name: 'override-test', description: null,
      enabled: true, rollout_percentage: 100, created_at: new Date(), updated_at: new Date(),
    });
    expect(await isFeatureEnabled('override-test', 'clinic-A')).toBe(true);
    // clinic-B has no override -> falls through to global -> false
    _resetFeatureFlagCache();
    expect(await isFeatureEnabled('override-test', 'clinic-B')).toBe(false);
  });

  it('respects rollout_percentage with staffId hash', async () => {
    tableData.rows.push({
      id: '1', clinic_id: null, name: 'gradual', description: null,
      enabled: true, rollout_percentage: 50, created_at: new Date(), updated_at: new Date(),
    });
    // Test that the function returns boolean and is deterministic
    // for the same input.
    const a = await isFeatureEnabled('gradual', 'clinic-A', { staffId: 'staff-1' });
    _resetFeatureFlagCache();
    const b = await isFeatureEnabled('gradual', 'clinic-A', { staffId: 'staff-1' });
    expect(a).toBe(b);
    // Test with many staff IDs to confirm not all return the same.
    const results = new Set<boolean>();
    for (let i = 0; i < 50; i++) {
      _resetFeatureFlagCache();
      results.add(await isFeatureEnabled('gradual', 'clinic-A', { staffId: `staff-${i}` }));
    }
    // 50% rollout should produce both true and false across 50 IDs.
    expect(results.size).toBe(2);
  });

  it('without staffId, treats rollout_percentage > 0 as on', async () => {
    tableData.rows.push({
      id: '1', clinic_id: null, name: 'no-staff-context', description: null,
      enabled: true, rollout_percentage: 50, created_at: new Date(), updated_at: new Date(),
    });
    expect(await isFeatureEnabled('no-staff-context', 'clinic-A')).toBe(true);
  });

  it('rollout_percentage 0 is always off even when enabled', async () => {
    tableData.rows.push({
      id: '1', clinic_id: null, name: 'zero-rollout', description: null,
      enabled: true, rollout_percentage: 0, created_at: new Date(), updated_at: new Date(),
    });
    expect(await isFeatureEnabled('zero-rollout', 'clinic-A', { staffId: 'staff-1' })).toBe(false);
  });
});
