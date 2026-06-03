/**
 * S5.8 — buildKShotExamples unit tests
 *
 * Mocks the db layer to return canned signed notes for a clinician
 * and asserts the K-shot block is structurally correct.
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

import { buildKShotExamples } from '../src/mcp/scribeEnhancements';

describe('buildKShotExamples', () => {
  beforeEach(() => resetTables());

  it('returns empty string when staffId is missing', async () => {
    expect(await buildKShotExamples('', 'soap')).toBe('');
  });

  it('returns empty string when noteType is missing', async () => {
    expect(await buildKShotExamples('staff-1', '')).toBe('');
  });

  it('returns empty string when no prior signed notes exist', async () => {
    expect(await buildKShotExamples('staff-1', 'soap')).toBe('');
  });

  it('renders examples in <example> tags inside <style_examples>', async () => {
    tableData['clinical_notes'] = {
      rows: [
        { content: 'SUBJECTIVE: Patient reports improved mood.', note_type: 'soap', signed_at: '2026-04-01' },
        { content: 'SUBJECTIVE: Continued sleep difficulties.', note_type: 'soap', signed_at: '2026-03-25' },
      ],
    };
    const out = await buildKShotExamples('staff-1', 'soap');
    expect(out).toContain('<style_examples>');
    expect(out).toContain('</style_examples>');
    expect(out).toContain('<example index="1">');
    expect(out).toContain('<example index="2">');
    expect(out).toContain('Patient reports improved mood');
    expect(out).toContain('Continued sleep difficulties');
    expect(out).toContain('most recent signed SOAP notes');
  });

  it('truncates long content with a marker', async () => {
    const longContent = 'X'.repeat(2000);
    tableData['clinical_notes'] = {
      rows: [{ content: longContent, note_type: 'soap', signed_at: '2026-04-01' }],
    };
    const out = await buildKShotExamples('staff-1', 'soap');
    expect(out).toContain('(truncated)');
    expect(out.length).toBeLessThan(longContent.length);
  });

  it('survives a query that throws', async () => {
    tableData['clinical_notes'] = { rows: [], shouldThrow: true };
    const out = await buildKShotExamples('staff-1', 'soap');
    expect(out).toBe('');
  });
});
