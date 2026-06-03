/*
 * scripts/guards/__tests__/check-mapper-naming.test.ts
 *
 * Phase R1 PR-R1-10 — symmetric vitest spec for the mapper-naming
 * canonicalisation guard.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isNonCanonicalMapperName, suggestCanonicalName } from '../check-mapper-naming';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const GUARD_PATH = join(REPO_ROOT, 'scripts', 'guards', 'check-mapper-naming.ts');

/**
 * Run the guard against a synthetic file. Used to test AST-walker
 * coverage end-to-end (cycle-2 absorb of L3 advisory A1: verify class
 * methods, object-literal shorthand, and arrow properties are detected).
 */
function runGuardOnSynthetic(content: string): { code: number; stderr: string } {
  const synthDir = join(REPO_ROOT, 'apps', 'api', 'src', 'features', '_zsynth_test_pr_r1_10');
  mkdirSync(synthDir, { recursive: true });
  const synthFile = join(synthDir, '_zsynthetic.ts');
  writeFileSync(synthFile, content, 'utf-8');
  try {
    const r = spawnSync('npx', ['tsx', GUARD_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: 'development' },
      encoding: 'utf-8',
    });
    return { code: r.status ?? -1, stderr: r.stderr ?? '' };
  } finally {
    rmSync(synthDir, { recursive: true, force: true });
  }
}

describe('isNonCanonicalMapperName — POSITIVE flag', () => {
  it('flags `mapNoteResponse` (no `To`)', () => {
    expect(isNonCanonicalMapperName('mapNoteResponse')).toBe(true);
  });

  it('flags `mapClozapineResponse` (no `To`)', () => {
    expect(isNonCanonicalMapperName('mapClozapineResponse')).toBe(true);
  });

  it('flags single-word `mapResponse` (degenerate but technically matches)', () => {
    // Edge case: `mapResponse` doesn't match `^map[A-Z]\w*Response$` because
    // `[A-Z]` requires an uppercase char after `map`.
    expect(isNonCanonicalMapperName('mapResponse')).toBe(false);
  });
});

describe('isNonCanonicalMapperName — NEGATIVE accept', () => {
  it('accepts canonical `mapNoteRowToResponse`', () => {
    expect(isNonCanonicalMapperName('mapNoteRowToResponse')).toBe(false);
  });

  it('accepts canonical `mapMedicationAdministrationRowToResponse`', () => {
    expect(isNonCanonicalMapperName('mapMedicationAdministrationRowToResponse')).toBe(false);
  });

  it('accepts canonical `mapClozapineRegistrationRowToResponse`', () => {
    expect(isNonCanonicalMapperName('mapClozapineRegistrationRowToResponse')).toBe(false);
  });

  it('accepts non-mapper functions ending in Response', () => {
    expect(isNonCanonicalMapperName('validateResponse')).toBe(false);
    expect(isNonCanonicalMapperName('parseResponse')).toBe(false);
    expect(isNonCanonicalMapperName('handleResponse')).toBe(false);
  });

  it('accepts functions that don\'t start with `map`', () => {
    expect(isNonCanonicalMapperName('toResponse')).toBe(false);
    expect(isNonCanonicalMapperName('XxxToResponse')).toBe(false);
  });

  it('accepts functions ending in different suffix', () => {
    expect(isNonCanonicalMapperName('mapResponseFromRow')).toBe(false);
    expect(isNonCanonicalMapperName('mapResponseToDb')).toBe(false);
  });
});

describe('AST walker coverage — cycle-2 absorb (advisory A1)', () => {
  it('flags class method `class X { mapNoteResponse(row) {} }`', () => {
    const r = runGuardOnSynthetic(`
      export class NoteHelper {
        mapNoteResponse(row: unknown) {
          return row;
        }
      }
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('mapNoteResponse');
  }, 20_000);

  it('flags static class method', () => {
    const r = runGuardOnSynthetic(`
      export class NoteHelper {
        static mapClozapineResponse(row: unknown) {
          return row;
        }
      }
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('mapClozapineResponse');
  }, 20_000);

  it('flags object-literal method shorthand `{ mapNoteResponse(row) {} }`', () => {
    const r = runGuardOnSynthetic(`
      export const helpers = {
        mapNoteResponse(row: unknown) {
          return row;
        },
      };
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('mapNoteResponse');
  }, 20_000);

  it('flags object-literal arrow property `{ mapNoteResponse: (row) => row }`', () => {
    const r = runGuardOnSynthetic(`
      export const helpers = {
        mapNoteResponse: (row: unknown) => row,
      };
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('mapNoteResponse');
  }, 20_000);

  it('accepts canonical class method `mapNoteRowToResponse`', () => {
    const r = runGuardOnSynthetic(`
      export class NoteHelper {
        mapNoteRowToResponse(row: unknown) {
          return row;
        }
      }
    `);
    expect(r.code).toBe(0);
  }, 20_000);

  it('accepts canonical object-literal shorthand', () => {
    const r = runGuardOnSynthetic(`
      export const helpers = {
        mapNoteRowToResponse(row: unknown) {
          return row;
        },
      };
    `);
    expect(r.code).toBe(0);
  }, 20_000);
});

describe('suggestCanonicalName', () => {
  it('inserts RowTo before Response', () => {
    expect(suggestCanonicalName('mapNoteResponse')).toBe('mapNoteRowToResponse');
    expect(suggestCanonicalName('mapClozapineResponse')).toBe('mapClozapineRowToResponse');
  });

  it('returns input unchanged when not ending in Response', () => {
    expect(suggestCanonicalName('mapNoteRowToResponse')).toBe('mapNoteRowToResponse');
    expect(suggestCanonicalName('helperFn')).toBe('helperFn');
  });
});
