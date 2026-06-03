/**
 * S5.9 — Evidence retrieval client unit tests
 *
 * Exercises the stub backend (default no-op), the keyword backend
 * with a mocked dbRead, the in-process cache, and the prompt-block
 * formatter. The pgvector backend is asserted to fail closed until
 * its follow-up migration lands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface MockTable { rows: unknown[]; shouldThrow?: boolean }
const tableData: Record<string, MockTable> = {};
let lastQuery: { table: string; phrase: string | null } = { table: '', phrase: null };

interface FakeQuery extends PromiseLike<unknown[]> {
  join: (...args: unknown[]) => FakeQuery;
  select: (...args: unknown[]) => FakeQuery;
  where: (...args: unknown[]) => FakeQuery;
  whereRaw: (_sql: string, params: unknown[]) => FakeQuery;
  orderBy: (...args: unknown[]) => FakeQuery;
  limit: (...args: unknown[]) => Promise<unknown[]>;
}

function fakeQuery(tableName: string): FakeQuery {
  const data = tableData[tableName] ?? { rows: [] };
  lastQuery = { table: tableName, phrase: null };
  const chain: FakeQuery = {
    join() { return chain; },
    select() { return chain; },
    where() { return chain; },
    whereRaw(_sql: string, params: unknown[]) {
      if (Array.isArray(params) && typeof params[0] === 'string') {
        lastQuery.phrase = params[0];
      }
      return chain;
    },
    orderBy() { return chain; },
    limit() {
      if (data.shouldThrow) return Promise.reject(new Error('db boom'));
      return Promise.resolve(data.rows);
    },
    then(onfulfilled, onrejected) {
      if (data.shouldThrow) {
        return Promise.reject(new Error('db boom')).then(onfulfilled ?? undefined, onrejected ?? undefined);
      }
      return Promise.resolve(data.rows).then(onfulfilled ?? undefined, onrejected ?? undefined);
    },
  };
  return chain;
}

vi.mock('../src/db/db', () => ({
  db: vi.fn((tableName: string) => fakeQuery(tableName)),
  dbRead: vi.fn((tableName: string) => fakeQuery(tableName)),
}));
vi.mock('../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  retrieveEvidence,
  evidenceBackendName,
  formatEvidenceBlock,
  _resetEvidenceCache,
} from '../src/integrations/evidence/evidenceClient';

const ORIGINAL_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = ['EVIDENCE_BACKEND'];

beforeEach(() => {
  for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k];
  for (const key of Object.keys(tableData)) delete tableData[key];
  lastQuery = { table: '', phrase: null };
  _resetEvidenceCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
});

describe('evidenceBackendName', () => {
  it('defaults to stub when unset', () => {
    delete process.env.EVIDENCE_BACKEND;
    expect(evidenceBackendName()).toBe('stub');
  });

  it('returns keyword when EVIDENCE_BACKEND=keyword', () => {
    process.env.EVIDENCE_BACKEND = 'keyword';
    expect(evidenceBackendName()).toBe('keyword');
  });

  it('returns pgvector when EVIDENCE_BACKEND=pgvector', () => {
    process.env.EVIDENCE_BACKEND = 'pgvector';
    expect(evidenceBackendName()).toBe('pgvector');
  });

  it('falls back to stub on unknown value', () => {
    process.env.EVIDENCE_BACKEND = 'pinecone';
    expect(evidenceBackendName()).toBe('stub');
  });
});

describe('retrieveEvidence — stub backend', () => {
  it('returns empty array by default', async () => {
    delete process.env.EVIDENCE_BACKEND;
    expect(await retrieveEvidence('lithium maintenance dose')).toEqual([]);
  });

  it('returns empty for short phrases', async () => {
    expect(await retrieveEvidence('ab')).toEqual([]);
  });

  it('returns empty for whitespace phrases', async () => {
    expect(await retrieveEvidence('   ')).toEqual([]);
  });
});

describe('retrieveEvidence — keyword backend', () => {
  beforeEach(() => {
    process.env.EVIDENCE_BACKEND = 'keyword';
  });

  it('returns mapped passages from dbRead with confidence tiers', async () => {
    tableData['evidence_chunks as ec'] = {
      rows: [
        { chunk_id: 'c1', document_id: 'd1', section_path: 'Treatment > Lithium', body: 'Lithium 600mg nocte titrated to level 0.6.', document_title: 'RANZCP CPG', publisher: 'RANZCP' },
        { chunk_id: 'c2', document_id: 'd1', section_path: 'Monitoring',        body: 'Check lithium levels at 5-7 days post change.', document_title: 'RANZCP CPG', publisher: 'RANZCP' },
        { chunk_id: 'c3', document_id: 'd2', section_path: null,                body: 'Lithium toxicity threshold considerations.',  document_title: 'NICE CG185', publisher: 'NICE' },
      ],
    };

    const out = await retrieveEvidence('lithium maintenance');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ chunkId: 'c1', confidence: 'high', source: 'evidence_keyword' });
    expect(out[1].confidence).toBe('moderate');
    expect(out[2].confidence).toBe('moderate');
    expect(out[0].publisher).toBe('RANZCP');
    expect(out[0].sectionPath).toBe('Treatment > Lithium');
  });

  it('parameterises the phrase to defeat SQL injection', async () => {
    tableData['evidence_chunks as ec'] = { rows: [] };
    await retrieveEvidence("lithium'; DROP TABLE patients;--");
    // The phrase is wrapped in % % and passed as a parameter, not interpolated.
    expect(lastQuery.phrase).toBe("%lithium'; DROP TABLE patients;--%");
  });

  it('returns empty when dbRead throws (fails closed)', async () => {
    tableData['evidence_chunks as ec'] = { rows: [], shouldThrow: true };
    expect(await retrieveEvidence('lithium maintenance')).toEqual([]);
  });

  it('caches repeated lookups (does not re-call dbRead)', async () => {
    tableData['evidence_chunks as ec'] = {
      rows: [
        { chunk_id: 'c1', document_id: 'd1', section_path: null, body: 'cached body', document_title: 'CPG', publisher: 'NICE' },
      ],
    };

    const first = await retrieveEvidence('cached phrase');
    // Mutate the table so a second uncached call would return different data.
    tableData['evidence_chunks as ec'] = { rows: [] };
    const second = await retrieveEvidence('cached phrase');
    expect(first).toEqual(second);
    expect(second).toHaveLength(1);
  });

  it('caches per backend, not across backends', async () => {
    tableData['evidence_chunks as ec'] = {
      rows: [{ chunk_id: 'c1', document_id: 'd1', section_path: null, body: 'b', document_title: 't', publisher: 'p' }],
    };
    const out1 = await retrieveEvidence('shared phrase');
    expect(out1).toHaveLength(1);

    process.env.EVIDENCE_BACKEND = 'pgvector';
    // pgvector returns [] regardless; cache must not bleed across.
    const out2 = await retrieveEvidence('shared phrase');
    expect(out2).toEqual([]);
  });
});

describe('retrieveEvidence — pgvector backend (placeholder)', () => {
  it('fails closed and returns [] until follow-up migration lands', async () => {
    process.env.EVIDENCE_BACKEND = 'pgvector';
    expect(await retrieveEvidence('lithium maintenance')).toEqual([]);
  });
});

describe('formatEvidenceBlock', () => {
  it('returns empty string for no passages', () => {
    expect(formatEvidenceBlock([])).toBe('');
  });

  it('emits a structured prompt block with citations and section paths', () => {
    const block = formatEvidenceBlock([
      {
        chunkId: 'c1', documentId: 'd1', documentTitle: 'CPG Bipolar', publisher: 'RANZCP',
        sectionPath: 'Treatment > Lithium', body: '  Lithium\n  titration  rules.  ',
        confidence: 'high', source: 'evidence_keyword',
      },
      {
        chunkId: 'c2', documentId: 'd2', documentTitle: 'CG185', publisher: null,
        sectionPath: null, body: 'Toxicity considerations.',
        confidence: 'moderate', source: 'evidence_keyword',
      },
    ]);

    expect(block).toContain('<evidence>');
    expect(block).toContain('</evidence>');
    expect(block).toContain('[1] RANZCP — CPG Bipolar (Treatment > Lithium)');
    expect(block).toContain('Lithium titration rules.');
    expect(block).toContain('[2] CG185');
    expect(block).toContain('Toxicity considerations.');
  });
});
