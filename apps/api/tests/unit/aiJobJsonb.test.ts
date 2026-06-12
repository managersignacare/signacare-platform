import { describe, expect, it } from 'vitest';
import knex from 'knex';
import { normalizeAiJobResultJson, normalizeAiJobWarnings, toJsonbDbValue } from '../../src/features/llm/aiJobJsonb';

describe('aiJobJsonb helpers', () => {
  it('normalizes nested result payloads to JSON-safe objects', () => {
    expect(normalizeAiJobResultJson({
      ok: true,
      omit: undefined,
      nested: { value: 'x' },
    })).toEqual({
      ok: true,
      nested: { value: 'x' },
    });
  });

  it('normalizes warnings arrays to string arrays', () => {
    expect(normalizeAiJobWarnings(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('produces explicit jsonb SQL bindings', () => {
    const db = knex({ client: 'pg' });
    try {
      const raw = toJsonbDbValue(db, ['presenting', 'protective'], []);
      const sql = raw.toSQL();
      expect(sql.sql).toContain('::jsonb');
      expect(sql.bindings).toEqual(['["presenting","protective"]']);
    } finally {
      void db.destroy();
    }
  });
});
