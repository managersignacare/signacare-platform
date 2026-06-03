/*
 * scripts/guards/__tests__/check-bugs-remaining-uniqueness.test.ts
 *
 * Phase R1 PR-R1-6 — symmetric tests for the catalogue uniqueness guard.
 * Cycle-1 (per L3 PR-R1-3+4+5 cycle-2 absorb precedent): symmetric
 * tests for the dominant detect/ignore axis.
 * Cycle-2 absorb of L3 PR-R1-6 advisories A1-A5: tests for fenced
 * code blocks, missing separators, no-trailing-pipe robustness, and
 * the EXPECTED-COUNT allowlist semantics.
 */
import { describe, it, expect } from 'vitest';
import { findBugIdOccurrences, scanCatalogue, parseRow } from '../check-bugs-remaining-uniqueness';

describe('findBugIdOccurrences — POSITIVE detect', () => {
  it('detects duplicate BUG-ID across two tables', () => {
    const src = `
| Bug | State | Notes |
|---|---|---|
| **BUG-001** | open | first |

| BUG | Sev | Title |
|---|---|---|
| BUG-001 | S0 | second |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-001')).toBe(true);
    expect(occs.get('BUG-001')!.length).toBe(2);
  });

  it('strips ~~strikethrough~~ markdown', () => {
    const src = `
| Bug | State |
|---|---|
| ~~**BUG-002**~~ | fixed |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-002')).toBe(true);
  });

  it('handles tables with BUG column at index 0 OR index 1', () => {
    const src = `
| BUG | Sev |
|---|---|
| BUG-100 | S2 |

| Cat | Bug | Title |
|---|---|---|
| X | **BUG-101** | hi |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-100')).toBe(true);
    expect(occs.has('BUG-101')).toBe(true);
  });

  it('preserves dot-suffix IDs (BUG-A5.0 vs BUG-A5.3 are distinct)', () => {
    const src = `
| BUG | Sev |
|---|---|
| **BUG-A5.0** | open |
| **BUG-A5.3** | open |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-A5.0')).toBe(true);
    expect(occs.has('BUG-A5.3')).toBe(true);
    // CRITICAL: must NOT collapse into BUG-A5
    expect(occs.has('BUG-A5')).toBe(false);
  });

  it('treats cascade siblings as DISTINCT IDs', () => {
    const src = `
| BUG | Sev |
|---|---|
| BUG-200 | S1 |
| BUG-200-CASCADE-1 | S2 |
| BUG-200-FOLLOWUP-A | S3 |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.size).toBe(3);
    expect(occs.get('BUG-200')!.length).toBe(1);
    expect(occs.get('BUG-200-CASCADE-1')!.length).toBe(1);
    expect(occs.get('BUG-200-FOLLOWUP-A')!.length).toBe(1);
  });
});

describe('findBugIdOccurrences — NEGATIVE ignore', () => {
  it('ignores BUG-ID mentions in prose / Notes column', () => {
    const src = `
| Cat | Bug | Title | Notes |
|---|---|---|---|
| X | BUG-300 | hi | sibling of BUG-300 (mentioned in prose) |
`;
    const occs = findBugIdOccurrences(src);
    // Only the column-1 (Bug) cell counts
    expect(occs.get('BUG-300')!.length).toBe(1);
  });

  it('ignores text before any table', () => {
    const src = `
This is a paragraph mentioning BUG-400 and BUG-401 in prose.

| BUG | Sev |
|---|---|
| BUG-402 | S2 |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-400')).toBe(false);
    expect(occs.has('BUG-401')).toBe(false);
    expect(occs.has('BUG-402')).toBe(true);
  });

  it('ignores tables WITHOUT a Bug/BUG header column', () => {
    const src = `
| Name | Type | Notes |
|---|---|---|
| Alice | dev | references BUG-500 |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.size).toBe(0);
  });

  it('returns empty for an empty document', () => {
    expect(findBugIdOccurrences('').size).toBe(0);
  });
});

// ── Cycle-2 absorb tests (L3 PR-R1-6 advisories A1-A3) ─────────────

describe('A1: fenced code-block tables are NOT parsed', () => {
  it('ignores pipe-tables inside ```-fenced code blocks', () => {
    const src = `
\`\`\`markdown
| BUG | Sev |
|---|---|
| BUG-INSIDE-FENCE | S0 |
\`\`\`

| BUG | Sev |
|---|---|
| BUG-OUTSIDE | S2 |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-INSIDE-FENCE')).toBe(false);
    expect(occs.has('BUG-OUTSIDE')).toBe(true);
  });

  it('handles fenced block with language tag', () => {
    const src = `
\`\`\`typescript
const example = '| BUG-INSIDE | S0 |';
\`\`\`
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.size).toBe(0);
  });

  it('resumes parsing after fenced block closes', () => {
    const src = `
\`\`\`
| Bug | State |
|---|---|
| BUG-FENCED | open |
\`\`\`

| Bug | State |
|---|---|
| BUG-AFTER | open |
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-FENCED')).toBe(false);
    expect(occs.has('BUG-AFTER')).toBe(true);
  });
});

describe('A2: tables without separator emit explicit warning', () => {
  it('reports tablesWithoutSeparator when a Bug-header table lacks |---|', () => {
    const src = `
| Bug | State |
| BUG-NO-SEP | open |
`;
    const result = scanCatalogue(src);
    expect(result.tablesWithoutSeparator.length).toBeGreaterThan(0);
    // The malformed-table data row is NOT parsed as catalogue
    expect(result.occurrences.has('BUG-NO-SEP')).toBe(false);
  });

  it('does NOT warn on a properly formatted Bug-header table', () => {
    const src = `
| Bug | State |
|---|---|
| BUG-OK | open |
`;
    const result = scanCatalogue(src);
    expect(result.tablesWithoutSeparator.length).toBe(0);
    expect(result.occurrences.has('BUG-OK')).toBe(true);
  });
});

describe('A3: parseRow keeps trailing cells without a trailing pipe', () => {
  it('parses `| open | BUG-X` with NO trailing pipe', () => {
    const cells = parseRow('| open | BUG-X');
    expect(cells).toEqual(['open', 'BUG-X']);
  });

  it('parses `| open | BUG-X |` with trailing pipe', () => {
    const cells = parseRow('| open | BUG-X |');
    expect(cells).toEqual(['open', 'BUG-X']);
  });

  it('returns empty for non-pipe-prefixed line', () => {
    expect(parseRow('open | BUG-X')).toEqual([]);
  });

  it('detects BUG-ID in last column without trailing pipe', () => {
    const src = `
| State | Bug
|---|---
| open | BUG-LAST-COL
`;
    const occs = findBugIdOccurrences(src);
    expect(occs.has('BUG-LAST-COL')).toBe(true);
  });
});
