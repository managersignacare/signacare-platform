/*
 * scripts/guards/__tests__/check-migration-rollback-discipline.test.ts
 *
 * Phase R1 PR-R1-3 cycle-2 absorb (L3 finding #2) — symmetric
 * positive + NEGATIVE test fixtures for the rollback-discipline guard.
 *
 * The cycle-1 verification was one-sided ("does the guard catch synthetic
 * violations?") which allowed a CONCURRENTLY regex bug to ship: the regex
 * `\bDROP\s+(?:CONCURRENTLY\s+)?${kw}` placed CONCURRENTLY BEFORE the
 * keyword, but PG syntax is `DROP INDEX [CONCURRENTLY] [IF EXISTS] name`
 * — false-positive on every valid `DROP INDEX CONCURRENTLY IF EXISTS x`.
 *
 * This spec asserts the symmetric set: valid PG syntax must NOT be flagged.
 */
import { describe, it, expect } from 'vitest';
import {
  findRawDropViolationsInString,
  stripSqlComments,
} from '../check-migration-rollback-discipline';

describe('findRawDropViolationsInString — POSITIVE cases (must flag)', () => {
  it('flags DROP TABLE without IF EXISTS', () => {
    const v = findRawDropViolationsInString('DROP TABLE foo');
    expect(v).toHaveLength(1);
    expect(v[0].keyword).toBe('TABLE');
  });

  it('flags DROP INDEX without IF EXISTS or CONCURRENTLY', () => {
    const v = findRawDropViolationsInString('DROP INDEX foo');
    expect(v).toHaveLength(1);
    expect(v[0].keyword).toBe('INDEX');
  });

  it('flags DROP INDEX CONCURRENTLY without IF EXISTS', () => {
    const v = findRawDropViolationsInString('DROP INDEX CONCURRENTLY foo');
    expect(v).toHaveLength(1);
    expect(v[0].keyword).toBe('INDEX');
  });

  it('flags DROP POLICY without IF EXISTS', () => {
    const v = findRawDropViolationsInString('DROP POLICY rls_x ON t');
    expect(v).toHaveLength(1);
    expect(v[0].keyword).toBe('POLICY');
  });

  it('flags DROP CONSTRAINT without IF EXISTS', () => {
    const v = findRawDropViolationsInString('ALTER TABLE x DROP CONSTRAINT x_check');
    expect(v).toHaveLength(1);
    expect(v[0].keyword).toBe('CONSTRAINT');
  });

  it('flags DROP TRIGGER without IF EXISTS', () => {
    const v = findRawDropViolationsInString('DROP TRIGGER tr ON t');
    expect(v).toHaveLength(1);
    expect(v[0].keyword).toBe('TRIGGER');
  });

  it('flags MULTIPLE DROP statements in same string', () => {
    const v = findRawDropViolationsInString(
      'DROP TABLE a; DROP TABLE b; DROP TABLE c',
    );
    expect(v).toHaveLength(3);
    expect(v.every((x) => x.keyword === 'TABLE')).toBe(true);
    // ensure distinct positions
    const indexes = new Set(v.map((x) => x.index));
    expect(indexes.size).toBe(3);
  });

  it('case-insensitive (drop table foo flagged too)', () => {
    expect(findRawDropViolationsInString('drop table foo')).toHaveLength(1);
    expect(findRawDropViolationsInString('Drop Table foo')).toHaveLength(1);
  });
});

describe('findRawDropViolationsInString — NEGATIVE cases (must NOT flag)', () => {
  it('does NOT flag DROP TABLE IF EXISTS', () => {
    expect(findRawDropViolationsInString('DROP TABLE IF EXISTS foo')).toEqual([]);
  });

  it('does NOT flag DROP INDEX IF EXISTS', () => {
    expect(findRawDropViolationsInString('DROP INDEX IF EXISTS foo')).toEqual([]);
  });

  it('does NOT flag DROP INDEX CONCURRENTLY IF EXISTS (cycle-2 false-positive fix)', () => {
    // L3 cycle-1 confirmed false positive — the canonical PG syntax for
    // hot-prod index rebuild. MUST not be flagged.
    expect(findRawDropViolationsInString('DROP INDEX CONCURRENTLY IF EXISTS foo')).toEqual([]);
  });

  it('does NOT flag DROP POLICY IF EXISTS', () => {
    expect(findRawDropViolationsInString('DROP POLICY IF EXISTS rls_x ON t')).toEqual([]);
  });

  it('does NOT flag DROP CONSTRAINT IF EXISTS', () => {
    expect(
      findRawDropViolationsInString('ALTER TABLE x DROP CONSTRAINT IF EXISTS x_check'),
    ).toEqual([]);
  });

  it('does NOT flag DROP MATERIALIZED VIEW IF EXISTS', () => {
    expect(
      findRawDropViolationsInString('DROP MATERIALIZED VIEW IF EXISTS mv_x'),
    ).toEqual([]);
  });

  it('does NOT flag DROP TABLE inside SQL line comment', () => {
    expect(
      findRawDropViolationsInString('-- DROP TABLE foo (legacy note)\nSELECT 1'),
    ).toEqual([]);
  });

  it('does NOT flag DROP TABLE inside SQL block comment', () => {
    expect(
      findRawDropViolationsInString('/* DROP TABLE foo bar */\nSELECT 1'),
    ).toEqual([]);
  });
});

describe('findRawDropViolationsInString — MIXED cases', () => {
  it('flags only the unsafe DROP among valid+unsafe siblings', () => {
    const v = findRawDropViolationsInString(
      'DROP TABLE IF EXISTS safe;\nDROP TABLE unsafe;\nDROP TABLE IF EXISTS also_safe;',
    );
    expect(v).toHaveLength(1);
    expect(v[0].keyword).toBe('TABLE');
  });
});

describe('stripSqlComments', () => {
  it('strips SQL line comments', () => {
    expect(stripSqlComments('SELECT 1; -- a comment\nSELECT 2')).toMatch(/SELECT 1; +\s+SELECT 2/);
  });

  it('strips SQL block comments', () => {
    expect(stripSqlComments('SELECT /* inline */ 1')).toMatch(/SELECT +1/);
  });

  it('strips block comments spanning multiple lines', () => {
    expect(
      stripSqlComments('SELECT 1;\n/*\n  multi-line\n*/\nSELECT 2'),
    ).not.toContain('multi-line');
  });
});
