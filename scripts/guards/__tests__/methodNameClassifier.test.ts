import { describe, expect, it } from 'vitest';
import { matchesMethodPrefix } from '../lib/methodNameClassifier';

describe('matchesMethodPrefix', () => {
  it('matches exact method names', () => {
    expect(matchesMethodPrefix('update', ['update'])).toBe(true);
  });

  it('matches camelCase boundary suffixes', () => {
    expect(matchesMethodPrefix('updateRecord', ['update'])).toBe(true);
    expect(matchesMethodPrefix('getById', ['get'])).toBe(true);
  });

  it('does not match non-boundary suffixes', () => {
    expect(matchesMethodPrefix('updatedAt', ['update'])).toBe(false);
    expect(matchesMethodPrefix('getter', ['get'])).toBe(false);
  });

  it('treats underscore boundary as optional', () => {
    expect(matchesMethodPrefix('update_record', ['update'])).toBe(false);
    expect(matchesMethodPrefix('update_record', ['update'], { allowUnderscoreBoundary: true })).toBe(true);
  });
});
