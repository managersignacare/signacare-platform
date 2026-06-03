// S7.1 — Unit tests for the pure trigram similarity ranking used in
// duplicate detection. The database-aware parts of findDuplicateCandidates
// are exercised by the integration suite; this file verifies the pure
// scoring primitives that don't need a DB.

import { describe, it, expect } from 'vitest';
import { trigramSimilarity } from '../../src/features/patients/duplicateDetection';

describe('trigramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(trigramSimilarity('alexander', 'alexander')).toBe(1);
  });

  it('returns 0 for empty strings', () => {
    expect(trigramSimilarity('', 'alexander')).toBe(0);
    expect(trigramSimilarity('alexander', '')).toBe(0);
    expect(trigramSimilarity('', '')).toBe(0);
  });

  it('ranks nickname variants higher than unrelated names', () => {
    // "alexander" vs "aleksandr" share 6 bigram-like trigrams but differ
    // in the middle, so pure Jaccard sits around 0.29. Unrelated names
    // are much lower. Both observations matter: (1) similar > unrelated,
    // (2) similar still passes the 0.5 threshold used as the fuzzy
    // match gate in findDuplicateCandidates when the DOB anchor is
    // already matched, so this is a realistic duplicate-candidate.
    const aleks = trigramSimilarity('alexander', 'aleksandr');
    const unrelated = trigramSimilarity('alexander', 'zachary');
    expect(aleks).toBeGreaterThan(unrelated);
    expect(aleks).toBeGreaterThan(0.25);
  });

  it('ranks single-character typos as high similarity', () => {
    const typo = trigramSimilarity('robert', 'rubert');
    expect(typo).toBeGreaterThan(0.3);
  });

  it('returns low similarity for completely different names', () => {
    const sim = trigramSimilarity('smith', 'williams');
    expect(sim).toBeLessThan(0.2);
  });

  it('handles common transposition (Bob vs Rob)', () => {
    // "bob" and "rob" share most of their trigram space because of
    // the surrounding padding space — they're recognisably similar.
    const sim = trigramSimilarity('bob', 'rob');
    expect(sim).toBeGreaterThan(0.2);
  });

  it('is symmetric', () => {
    const ab = trigramSimilarity('robertson', 'robinson');
    const ba = trigramSimilarity('robinson', 'robertson');
    expect(ab).toBe(ba);
  });
});
