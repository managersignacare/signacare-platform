import { describe, expect, it } from 'vitest';
import {
  buildDbOpenerRegex,
  findChainEnd,
  findDbAliasIdentifiers,
  parseTableAlias,
} from '../lib/knexChainRuntime';

describe('findDbAliasIdentifiers', () => {
  it('collects local db fallback aliases', () => {
    const aliases = findDbAliasIdentifiers(`
      const conn = trx ?? db;
      const reader = readerOrTrx ?? dbRead;
    `);
    expect(aliases.has('conn')).toBe(true);
    expect(aliases.has('reader')).toBe(true);
  });
});

describe('buildDbOpenerRegex', () => {
  it('matches db and alias openers', () => {
    const source = `db('episodes').where('id', '1'); conn('patients').first();`;
    const re = buildDbOpenerRegex(new Set(['conn']));
    const matches = [...source.matchAll(re)];
    expect(matches).toHaveLength(2);
    expect(matches[0]?.[1] ?? matches[0]?.[2]).toBe('episodes');
    expect(matches[1]?.[1] ?? matches[1]?.[2]).toBe('patients');
  });
});

describe('findChainEnd', () => {
  it('stops at statement terminator for chained calls', () => {
    const source = `db('foo').where({ id: 1 }).update({ name: 'x' }); const n = 1;`;
    const start = source.indexOf("db('foo')");
    const end = findChainEnd(source, start);
    expect(source.slice(start, end)).toContain(".update({ name: 'x' })");
  });
});

describe('parseTableAlias', () => {
  it('returns table and alias for AS syntax', () => {
    expect(parseTableAlias('episodes as e')).toEqual({ table: 'episodes', alias: 'e' });
  });

  it('uses table as alias when no AS clause exists', () => {
    expect(parseTableAlias('episodes')).toEqual({ table: 'episodes', alias: 'episodes' });
  });
});
