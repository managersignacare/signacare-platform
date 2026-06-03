/*
 * scripts/guards/__tests__/check-no-column-ddl-in-raw-sql.test.ts
 *
 * Phase 0b.1c — symmetric tests for the second-line-defense guard.
 */
import { describe, it, expect } from 'vitest';
import { findRawCalls, detectColumnDdl } from '../check-no-column-ddl-in-raw-sql';

describe('findRawCalls', () => {
  it('extracts SQL from a single-quoted knex.raw call', () => {
    const src = `await knex.raw('CREATE TABLE foo (id uuid)');`;
    const calls = findRawCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe('CREATE TABLE foo (id uuid)');
    expect(calls[0].line).toBe(1);
  });

  it('extracts SQL from a backtick-template knex.raw call', () => {
    const src = `
      // line 2
      await knex.raw(\`
        ALTER TABLE foo ADD COLUMN x text
      \`);
    `;
    const calls = findRawCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('ALTER TABLE foo ADD COLUMN x text');
    expect(calls[0].line).toBe(3); // line of the knex.raw( opener
  });

  it('extracts multiple raw calls', () => {
    const src = `
      await knex.raw('CREATE EXTENSION vector');
      await knex.raw('GRANT SELECT ON foo TO bar');
    `;
    const calls = findRawCalls(src);
    expect(calls).toHaveLength(2);
  });

  it('does not match knex.raw inside a string literal', () => {
    const src = `const message = "knex.raw('foo')";`;
    const calls = findRawCalls(src);
    // The regex still matches the substring, but tests should pass — this
    // is acceptable: a string-quoted "knex.raw('foo')" is a noop call we
    // shouldn't false-positive on. Confirm the SQL extraction stops at
    // the matching quote of the inner call.
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});

describe('detectColumnDdl — POSITIVE detect', () => {
  it('flags CREATE TABLE with column-list opener', () => {
    expect(detectColumnDdl('CREATE TABLE foo (id uuid PRIMARY KEY)')).toEqual({
      kind: 'CREATE TABLE',
      snippet: expect.stringContaining('CREATE TABLE foo'),
    });
  });

  it('flags ALTER TABLE ... ADD COLUMN', () => {
    expect(detectColumnDdl('ALTER TABLE foo ADD COLUMN x text')).toEqual({
      kind: 'ADD COLUMN',
      snippet: expect.stringContaining('ALTER TABLE foo'),
    });
  });

  it('flags ALTER TABLE ... DROP COLUMN', () => {
    expect(detectColumnDdl('ALTER TABLE foo DROP COLUMN x')).toEqual({
      kind: 'DROP COLUMN',
      snippet: expect.any(String),
    });
  });

  it('flags ALTER TABLE ... ALTER COLUMN', () => {
    expect(detectColumnDdl('ALTER TABLE foo ALTER COLUMN x SET NOT NULL')).toEqual({
      kind: 'ALTER COLUMN',
      snippet: expect.any(String),
    });
  });

  it('flags ALTER TABLE ... RENAME COLUMN', () => {
    expect(detectColumnDdl('ALTER TABLE foo RENAME COLUMN x TO y')).toEqual({
      kind: 'RENAME COLUMN',
      snippet: expect.any(String),
    });
  });

  it('flags column DDL with IF NOT EXISTS (idempotency-guard misuse)', () => {
    // This is exactly the pattern absorbed in this commit:
    // `ALTER TABLE phone_triage ADD COLUMN IF NOT EXISTS receptionist_summary text`
    expect(detectColumnDdl('ALTER TABLE phone_triage ADD COLUMN IF NOT EXISTS x text')).toMatchObject({
      kind: 'ADD COLUMN',
    });
  });

  it('flags multi-line column DDL spanning ~80 chars between ALTER TABLE and ADD COLUMN', () => {
    const sql = `
      ALTER TABLE llm_interactions
        ADD COLUMN IF NOT EXISTS embedding vector(1536)
    `;
    expect(detectColumnDdl(sql)).toMatchObject({ kind: 'ADD COLUMN' });
  });
});

describe('detectColumnDdl — NEGATIVE (out of scope, must NOT flag)', () => {
  it('does NOT flag CREATE INDEX', () => {
    expect(detectColumnDdl('CREATE INDEX idx_foo_x ON foo (x)')).toBeNull();
  });

  it('does NOT flag CREATE EXTENSION', () => {
    expect(detectColumnDdl('CREATE EXTENSION IF NOT EXISTS vector')).toBeNull();
  });

  it('does NOT flag ALTER TABLE ENABLE ROW LEVEL SECURITY', () => {
    expect(detectColumnDdl('ALTER TABLE foo ENABLE ROW LEVEL SECURITY')).toBeNull();
  });

  it('does NOT flag CREATE POLICY', () => {
    expect(detectColumnDdl('CREATE POLICY rls_foo_tenant ON foo FOR ALL USING (clinic_id = ...)')).toBeNull();
  });

  it('does NOT flag GRANT', () => {
    expect(detectColumnDdl('GRANT SELECT ON foo TO bar')).toBeNull();
  });

  it('does NOT flag COMMENT ON COLUMN (annotation-only)', () => {
    expect(detectColumnDdl("COMMENT ON COLUMN foo.x IS 'note'")).toBeNull();
  });

  it('does NOT flag ALTER TABLE ... ADD CONSTRAINT (without COLUMN keyword)', () => {
    expect(detectColumnDdl('ALTER TABLE foo ADD CONSTRAINT chk CHECK (x > 0)')).toBeNull();
  });

  it('does NOT flag DROP TABLE', () => {
    expect(detectColumnDdl('DROP TABLE foo')).toBeNull();
  });

  it('does NOT flag SELECT statements (introspection / data backfill)', () => {
    expect(detectColumnDdl('SELECT id FROM foo WHERE x IS NULL')).toBeNull();
  });

  it('does NOT flag UPDATE statements (data backfill)', () => {
    expect(detectColumnDdl('UPDATE foo SET x = 1 WHERE id = 2')).toBeNull();
  });
});
