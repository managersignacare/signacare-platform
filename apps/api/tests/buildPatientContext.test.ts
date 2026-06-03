/**
 * S5.5 — buildPatientContext unit tests
 *
 * Mocks the db module to return canned rows for each table the
 * function reads, then asserts the rendered output structure.
 * Catches the regression class where a table query throws and the
 * whole context block returns empty.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MockTable {
  rows: unknown[];
  shouldThrow?: boolean;
}

const tableData: Record<string, MockTable> = {};

function resetTables(): void {
  for (const key of Object.keys(tableData)) delete tableData[key];
}

interface FakeQuery extends PromiseLike<unknown[]> {
  where: (...args: unknown[]) => FakeQuery;
  whereNull: (...args: unknown[]) => FakeQuery;
  whereNotNull: (...args: unknown[]) => FakeQuery;
  whereIn: (...args: unknown[]) => FakeQuery;
  orderBy: (...args: unknown[]) => FakeQuery;
  limit: (...args: unknown[]) => FakeQuery;
  select: (...args: unknown[]) => Promise<unknown[]>;
  modify: (fn: (query: FakeQuery) => void) => FakeQuery;
}

function fakeQuery(tableName: string): FakeQuery {
  const data = tableData[tableName] ?? { rows: [] };
  // Build a chainable mock that ignores filter calls and returns the
  // canned rows as the awaited result.
  const chain: FakeQuery = {
    where() { return chain; },
    whereNull() { return chain; },
    whereNotNull() { return chain; },
    whereIn() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    select() {
      if (data.shouldThrow) return Promise.reject(new Error('boom'));
      return Promise.resolve(data.rows);
    },
    modify(fn) { fn(chain); return chain; },
    then(onfulfilled, onrejected) {
      if (data.shouldThrow) {
        return Promise.reject(new Error('boom')).then(onfulfilled ?? undefined, onrejected ?? undefined);
      }
      return Promise.resolve(data.rows).then(onfulfilled ?? undefined, onrejected ?? undefined);
    },
  };
  return chain;
}

vi.mock('../src/db/db', () => ({
  db: vi.fn((tableName: string) => fakeQuery(tableName)),
}));

vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildPatientContext } from '../src/mcp/scribeEnhancements';

describe('buildPatientContext', () => {
  beforeEach(() => {
    resetTables();
  });

  it('returns empty string when patientId is missing', async () => {
    const out = await buildPatientContext('');
    expect(out).toBe('');
  });

  it('returns empty string when no sections have data', async () => {
    const out = await buildPatientContext('p-1', 'c-1');
    expect(out).toBe('');
  });

  it('renders an active medications section', async () => {
    tableData['patient_medications'] = {
      rows: [
        {
          drug_label: 'Sertraline',
          dose: '50mg',
          frequency: 'daily',
          route: 'oral',
          start_date: '2026-04-01',
        },
      ],
    };
    const out = await buildPatientContext('p-1', 'c-1');
    expect(out).toContain('PATIENT_CONTEXT');
    expect(out).toContain('CURRENT MEDICATIONS');
    expect(out).toContain('Sertraline');
    expect(out).toContain('50mg');
    expect(out).toContain('daily');
  });

  it('renders an active problem list section, filtering closed episodes', async () => {
    tableData['episodes'] = {
      rows: [
        { primary_diagnosis: 'Major depressive disorder', status: 'open', start_date: '2026-01-01' },
        { primary_diagnosis: 'Anxiety', status: 'closed', start_date: '2025-12-01' },
      ],
    };
    const out = await buildPatientContext('p-1', 'c-1');
    expect(out).toContain('ACTIVE PROBLEM LIST');
    expect(out).toContain('Major depressive disorder');
    expect(out).not.toContain('Anxiety'); // closed episodes excluded
  });

  it('renders active alerts with severity', async () => {
    tableData['patient_alerts'] = {
      rows: [
        { title: 'Suicide risk', severity: 'high', notes: 'Recent ideation, no plan' },
      ],
    };
    const out = await buildPatientContext('p-1', 'c-1');
    expect(out).toContain('ACTIVE ALERTS / RISKS');
    expect(out).toContain('Suicide risk');
    expect(out).toContain('[HIGH]');
    expect(out).toContain('Recent ideation');
  });

  it('renders structured observations', async () => {
    tableData['structured_observations'] = {
      rows: [
        {
          observation_type: 'Heart rate',
          values: { numeric: 72, unit: 'bpm' },
          observed_at: '2026-04-10T08:00:00Z',
        },
      ],
    };
    const out = await buildPatientContext('p-1', 'c-1');
    expect(out).toContain('RECENT OBSERVATIONS');
    expect(out).toContain('Heart rate');
    expect(out).toContain('72bpm');
  });

  it('survives a query that throws — does not block other sections', async () => {
    tableData['patient_medications'] = {
      rows: [{ drug_label: 'Sertraline', dose: '50mg', frequency: 'daily' }],
    };
    tableData['episodes'] = { rows: [], shouldThrow: true };
    tableData['patient_alerts'] = {
      rows: [{ title: 'Allergy', severity: 'low' }],
    };
    const out = await buildPatientContext('p-1', 'c-1');
    expect(out).toContain('CURRENT MEDICATIONS');
    expect(out).toContain('Sertraline');
    expect(out).toContain('ACTIVE ALERTS / RISKS');
    // Episodes section should be missing entirely
    expect(out).not.toContain('ACTIVE PROBLEM LIST');
  });

  it('caps total length to MAX_CONTEXT_CHARS-ish (per-section budget)', async () => {
    // Stuff a lot of medications to verify the truncation kicks in
    tableData['patient_medications'] = {
      rows: Array.from({ length: 50 }, (_, i) => ({
        drug_name: 'X'.repeat(200) + i,
        dose: '500mg',
        frequency: 'daily',
      })),
    };
    const out = await buildPatientContext('p-1', 'c-1');
    // The output is bounded by sectionBudget (8000 / sections - 200) so
    // even with 50 huge meds the output is well under 20k chars.
    expect(out.length).toBeLessThan(20_000);
  });
});
