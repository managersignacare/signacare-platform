/*
 * scripts/guards/__tests__/check-fix-registry-decisiveness.test.ts
 *
 * Phase R1 PR-R1-7 cycle-2 — symmetric tests that IMPORT the actual
 * production functions (per L3 finding #4). Cycle-1 spec re-implemented
 * `parseRegistry` against in-memory strings; a regression in the
 * production parser passed the spec unchanged. Cycle-2 imports from
 * `lib/fix-registry-decisiveness-core.ts` so a mutation in the parser
 * is caught by the spec.
 */
import { describe, it, expect } from 'vitest';
import {
  parseRegistry,
  parseAllowlist,
  evaluateDecisiveness,
  MAX_DECISIVE_HITS,
} from '../lib/fix-registry-decisiveness-core';

describe('parseRegistry — basic table parsing', () => {
  it('parses a simple registry table', () => {
    const src = `
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| ANCHOR1 | src/foo.ts | present | \`pattern\` | desc |
| ANCHOR2 | src/bar.ts | absent | \`badPattern\` | desc |
`;
    const rows = parseRegistry(src);
    expect(rows.length).toBe(2);
    expect(rows[0]!.id).toBe('ANCHOR1');
    expect(rows[0]!.type).toBe('present');
    expect(rows[0]!.pattern).toBe('pattern');
  });

  it('strips backticks from pattern cell', () => {
    const src = `
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| A | f.ts | present | \`my\\.regex\` | d |
`;
    const rows = parseRegistry(src);
    expect(rows[0]!.pattern).toBe('my\\.regex');
  });

  it('skips rows with missing fields', () => {
    const src = `
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| GOOD | f.ts | present | \`p\` | d |
|  | f.ts | present | \`p\` | d |
`;
    const rows = parseRegistry(src);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe('GOOD');
  });

  it('returns empty for non-pattern table', () => {
    const src = `
| Name | Type |
|------|------|
| Alice | dev |
`;
    expect(parseRegistry(src).length).toBe(0);
  });

  it('captures lineno for downstream reporting', () => {
    const src = `header line
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| A | f.ts | present | \`p\` | d |
`;
    const rows = parseRegistry(src);
    expect(rows[0]!.lineno).toBe(4);
  });
});

describe('parseAllowlist — cycle-2 expected=N format', () => {
  it('parses valid `<ID> expected=<N>` entries', () => {
    const src = `
ANCHOR1 expected=10  # comment
ANCHOR2 expected=8
`;
    const { entries, parseErrors } = parseAllowlist(src);
    expect(parseErrors).toEqual([]);
    expect(entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ id: 'ANCHOR1', expected: 10 });
    expect(entries[1]).toMatchObject({ id: 'ANCHOR2', expected: 8 });
  });

  it('rejects bare-ID entries (cycle-1 format)', () => {
    const src = `ANCHOR-NO-EXPECTED  # missing expected=N`;
    const { entries, parseErrors } = parseAllowlist(src);
    expect(entries.length).toBe(0);
    expect(parseErrors.length).toBe(1);
    expect(parseErrors[0]).toContain('malformed');
  });

  it('rejects entries with non-numeric expected', () => {
    const src = `ANCHOR1 expected=many`;
    const { parseErrors } = parseAllowlist(src);
    expect(parseErrors.length).toBe(1);
  });

  it('skips comment-only and blank lines', () => {
    const src = `
# comment line
   # indented comment
ANCHOR1 expected=5

`;
    const { entries, parseErrors } = parseAllowlist(src);
    expect(parseErrors).toEqual([]);
    expect(entries.length).toBe(1);
  });
});

describe('evaluateDecisiveness — threshold + drift semantics', () => {
  it('flags non-allowlisted anchor with > MAX_DECISIVE_HITS', () => {
    const rows = parseRegistry(`
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| LOOSE | f.ts | present | \`p\` | d |
`);
    const { violations, countDrift } = evaluateDecisiveness(rows, [], () => MAX_DECISIVE_HITS + 1);
    expect(violations.length).toBe(1);
    expect(countDrift.length).toBe(0);
    expect(violations[0]!.id).toBe('LOOSE');
  });

  it('does NOT flag anchor at exactly MAX_DECISIVE_HITS', () => {
    const rows = parseRegistry(`
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| EDGE | f.ts | present | \`p\` | d |
`);
    const { violations } = evaluateDecisiveness(rows, [], () => MAX_DECISIVE_HITS);
    expect(violations.length).toBe(0);
  });

  it('does NOT flag absent-type anchors regardless of hits', () => {
    const rows = parseRegistry(`
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| ABS | f.ts | absent | \`p\` | d |
`);
    const { violations } = evaluateDecisiveness(rows, [], () => 100);
    expect(violations.length).toBe(0);
  });

  it('asserts allowlisted anchor count matches expected (no drift)', () => {
    const rows = parseRegistry(`
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| ALLOWED | f.ts | present | \`p\` | d |
`);
    const allowlist = [{ id: 'ALLOWED', expected: 10, raw: 'ALLOWED expected=10' }];
    const { violations, countDrift } = evaluateDecisiveness(rows, allowlist, () => 10);
    expect(violations.length).toBe(0);
    expect(countDrift.length).toBe(0);
  });

  it('flags drift when allowlisted count diverges from expected', () => {
    const rows = parseRegistry(`
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| ALLOWED | f.ts | present | \`p\` | d |
`);
    const allowlist = [{ id: 'ALLOWED', expected: 10, raw: 'ALLOWED expected=10' }];
    const { violations, countDrift } = evaluateDecisiveness(rows, allowlist, () => 13);
    expect(violations.length).toBe(0);
    expect(countDrift.length).toBe(1);
    expect(countDrift[0]).toMatchObject({ id: 'ALLOWED', expected: 10, actual: 13 });
  });

  it('flags drift in the LOW direction (anchor count dropped)', () => {
    // Important: a dropped count means the file changed — anchor
    // should be re-tightened or allowlist updated. Silent drift
    // would mask the cleanup signal.
    const rows = parseRegistry(`
| ID | File | Type | Pattern | Description |
|----|------|------|---------|-------------|
| ALLOWED | f.ts | present | \`p\` | d |
`);
    const allowlist = [{ id: 'ALLOWED', expected: 10, raw: 'ALLOWED expected=10' }];
    const { countDrift } = evaluateDecisiveness(rows, allowlist, () => 7);
    expect(countDrift.length).toBe(1);
    expect(countDrift[0]).toMatchObject({ expected: 10, actual: 7 });
  });
});
