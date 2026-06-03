/*
 * scripts/guards/__tests__/check-no-hardcoded-column-lists.test.ts
 *
 * Phase 0b.2b — symmetric tests for the no-hardcoded-column-lists guard.
 */
import { describe, it, expect } from 'vitest';
import {
  findColumnConstants,
  hasProjectionExemptAnnotation,
  readAllowlist,
} from '../check-no-hardcoded-column-lists';

describe('findColumnConstants — POSITIVE detect', () => {
  it('detects simple `const X_COLUMNS = [` declaration', () => {
    const src = `
import { db } from '../../db/db';

const PATIENT_COLUMNS = [
  'id', 'clinic_id', 'family_name',
] as const;
`;
    const decls = findColumnConstants(src);
    expect(decls).toHaveLength(1);
    expect(decls[0].name).toBe('PATIENT_COLUMNS');
    expect(decls[0].line).toBe(4);
  });

  it('detects `*_COLS` suffix variant (e.g. BASE_COLS)', () => {
    const src = `const BASE_COLS = ['id', 'name'] as const;`;
    const decls = findColumnConstants(src);
    expect(decls).toHaveLength(1);
    expect(decls[0].name).toBe('BASE_COLS');
  });

  it('detects multi-projection paired constants (FULL + REDACTED suffixes)', () => {
    const src = `
const PHONE_TRIAGE_COLUMNS_FULL = ['id', 'risk'] as const;
const PHONE_TRIAGE_COLUMNS_REDACTED = ['id'] as const;
`;
    const decls = findColumnConstants(src);
    expect(decls).toHaveLength(2);
    expect(decls.map((d) => d.name)).toEqual([
      'PHONE_TRIAGE_COLUMNS_FULL',
      'PHONE_TRIAGE_COLUMNS_REDACTED',
    ]);
  });

  it('detects multiple constants in same file', () => {
    const src = `
const PATIENT_COLUMNS = ['id'] as const;
const STAFF_COLUMNS = ['id'] as const;
const APPOINTMENT_COLS = ['id'] as const;
`;
    const decls = findColumnConstants(src);
    expect(decls).toHaveLength(3);
  });
});

describe('findColumnConstants — NEGATIVE non-flag', () => {
  it('does NOT match constants that lack _COLUMNS / _COLS', () => {
    const src = `
const PATIENT_LIMIT = 100;
const ROLES = ['admin', 'staff'];
const COLUMNS_PER_PAGE = 20;
`;
    const decls = findColumnConstants(src);
    expect(decls).toHaveLength(0);
  });

  it('does NOT match an array literal that is not a const declaration', () => {
    const src = `
let PATIENT_COLUMNS_LET = ['id'];   // let, not const
function foo() {
  const LOCAL_COLUMNS = ['id']; // indented; matches because regex allows leading \\s*
}
`;
    const decls = findColumnConstants(src);
    // The function-scoped `const LOCAL_COLUMNS = [...]` is matched (regex tolerates indentation).
    // The `let PATIENT_COLUMNS_LET = [` is NOT matched (regex requires `const`).
    expect(decls.map((d) => d.name)).toEqual(['LOCAL_COLUMNS']);
  });

  it('does NOT match array literals that aren\'t constant declarations', () => {
    const src = `
db.select(['id', 'name']);          // array as fn arg
const x = { COLS: ['a', 'b'] };     // not a top-level _COLS const
`;
    const decls = findColumnConstants(src);
    expect(decls).toHaveLength(0);
  });
});

describe('hasProjectionExemptAnnotation', () => {
  it('detects annotation on the line directly above the declaration', () => {
    const src = `
// @column-list-projection-exempt: privacy redaction for non-nurse callers
const PHONE_TRIAGE_COLUMNS_REDACTED = ['id'] as const;
`;
    expect(hasProjectionExemptAnnotation(src, 3)).toBe(true);
  });

  it('detects annotation within ±10 lines of the declaration', () => {
    const src = `
// @column-list-projection-exempt: paired projection mechanism
// (lots of lines between annotation and decl)
${'\n'.repeat(7)}
const PHONE_TRIAGE_COLUMNS_FULL = ['id'] as const;
`;
    // Annotation on line 2; decl on line 12.
    expect(hasProjectionExemptAnnotation(src, 12)).toBe(true);
  });

  it('detects file-header annotation in first 30 lines (always wins)', () => {
    const src = `
// @column-list-projection-exempt: file-level — every constant in this file is a projection
// (50 lines later)
${'\n'.repeat(45)}
const SOME_COLUMNS = ['id'] as const;
`;
    // Decl is on line ~50; annotation is on line 2 → in first 30 lines window.
    const lines = src.split('\n');
    const declLine = lines.findIndex((l) => l.includes('SOME_COLUMNS')) + 1;
    expect(hasProjectionExemptAnnotation(src, declLine)).toBe(true);
  });

  it('returns false when no annotation is present', () => {
    const src = `
const PATIENT_COLUMNS = ['id'] as const;
`;
    expect(hasProjectionExemptAnnotation(src, 2)).toBe(false);
  });

  it('returns false when annotation is far above the decl + outside file-header window', () => {
    // Annotation must be OUTSIDE the first-30 window (file-header rule always wins) AND
    // outside the ±10 window centered on the decl. So put the annotation at line 35
    // and the decl at line 60 (25 lines apart; both windows miss).
    const lines: string[] = [];
    for (let i = 0; i < 34; i++) lines.push('// non-annotation padding'); // lines 1-34 (no annotation in first-30 window)
    lines.push(`// @column-list-projection-exempt: too-far-above-not-detected`); // line 35
    for (let i = 0; i < 24; i++) lines.push('// padding'); // lines 36-59
    lines.push(`const FOO_COLUMNS = ['id'] as const;`); // line 60
    const src = lines.join('\n');
    expect(hasProjectionExemptAnnotation(src, 60)).toBe(false);
  });
});

describe('readAllowlist — class marker parsing', () => {
  // These tests use the real allowlist file at `scripts/guards/check-no-hardcoded-column-lists.allowlist`.
  // Only assert structural shape (presence of class markers); don't pin specific entries since
  // the file's contents drift as 0b.2c drains.
  it('reads the baseline allowlist and reports class markers', () => {
    const result = readAllowlist();
    expect(result.malformed).toEqual([]);
    // At minimum, every entry must have a class marker (A or B) or be flagged as `unknown`.
    for (const e of result.entries) {
      expect(['A', 'B', 'unknown']).toContain(e.classMarker);
    }
  });
});
