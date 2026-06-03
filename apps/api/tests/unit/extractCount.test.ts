import { describe, expect, it } from 'vitest';
import { extractCount } from '../../src/shared/extractCount';

describe('extractCount', () => {
  it('reads count aliases used across knex queries', () => {
    expect(extractCount([{ cnt: '5' }])).toBe(5);
    expect(extractCount([{ c: '7' }])).toBe(7);
    expect(extractCount([{ count: '9' }])).toBe(9);
    expect(extractCount([{ 'count(*)': '11' }])).toBe(11);
  });

  it('returns zero for empty/invalid shapes', () => {
    expect(extractCount([])).toBe(0);
    expect(extractCount([{ nope: '12' }])).toBe(0);
  });
});

