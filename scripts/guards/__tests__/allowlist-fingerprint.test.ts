/*
 * scripts/guards/__tests__/allowlist-fingerprint.test.ts
 *
 * Phase R1 PR-R1-1.5 cycle-2 absorb (L3 finding #4) — vitest spec for
 * the fingerprint helper that backs check-fk-aware-joins +
 * check-response-shape-validated allowlists.
 *
 * Properties under test:
 *   - fingerprint() is sha256[:8] of trimmed line content
 *   - fingerprint() returns EMPTY_FINGERPRINT (null) for whitespace-only
 *     input — defends against accidental wildcard amnesty for blank
 *     lines (cycle-1 finding #5)
 *   - loadAllowlist() parses both fingerprint + legacy lineno formats
 *   - isAllowlisted() returns false for empty-fingerprint violations
 *     even if the file has matching entries
 *   - getAllowlistedCount() counts fingerprint occurrences for
 *     multiplicity-aware over-count detection (cycle-1 finding #3)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fingerprint,
  EMPTY_FINGERPRINT,
  loadAllowlist,
  isAllowlisted,
  getAllowlistedCount,
  migrateLegacyEntries,
} from '../lib/allowlist-fingerprint';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'pr-r1-1-5-fp-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeAllowlist(content: string): string {
  const path = join(workdir, 'allowlist.txt');
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('fingerprint()', () => {
  it('returns first 8 hex chars of sha256(trimmed)', () => {
    // sha256('foo') = 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
    expect(fingerprint('foo')).toBe('2c26b46b');
    expect(fingerprint('  foo  ')).toBe('2c26b46b'); // trim
    expect(fingerprint('\tfoo\n')).toBe('2c26b46b'); // trim whitespace
  });

  it('returns null (EMPTY_FINGERPRINT) for whitespace-only input', () => {
    expect(fingerprint('')).toBe(EMPTY_FINGERPRINT);
    expect(fingerprint('   ')).toBe(EMPTY_FINGERPRINT);
    expect(fingerprint('\t\n')).toBe(EMPTY_FINGERPRINT);
    expect(fingerprint('  \r\n  ')).toBe(EMPTY_FINGERPRINT);
  });

  it('produces stable fingerprints for same content', () => {
    const fp1 = fingerprint('res.json({ foo: bar })');
    const fp2 = fingerprint('res.json({ foo: bar })');
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces different fingerprints for different content', () => {
    expect(fingerprint('foo')).not.toBe(fingerprint('bar'));
  });
});

describe('loadAllowlist()', () => {
  it('parses fingerprint format <file> <8-hex>', () => {
    const path = writeAllowlist(
      'apps/api/src/foo.ts deadbeef  # BUG-X — reason\n',
    );
    const entries = loadAllowlist(path);
    expect(entries).toHaveLength(1);
    expect(entries[0].file).toBe('apps/api/src/foo.ts');
    expect(entries[0].fingerprint).toBe('deadbeef');
    expect(entries[0].lineno).toBeNull();
  });

  it('parses legacy lineno format <file>:<n>', () => {
    const path = writeAllowlist(
      'apps/api/src/foo.ts:42  # legacy entry\n',
    );
    const entries = loadAllowlist(path);
    expect(entries).toHaveLength(1);
    expect(entries[0].file).toBe('apps/api/src/foo.ts');
    expect(entries[0].fingerprint).toBeNull();
    expect(entries[0].lineno).toBe(42);
  });

  it('parses mixed fingerprint + legacy entries', () => {
    const path = writeAllowlist(
      [
        'apps/api/src/a.ts deadbeef  # fp',
        'apps/api/src/b.ts:7  # legacy',
        '# comment line — ignored',
        '',
        'apps/api/src/c.ts cafebabe',
      ].join('\n'),
    );
    const entries = loadAllowlist(path);
    expect(entries).toHaveLength(3);
    expect(entries[0].fingerprint).toBe('deadbeef');
    expect(entries[1].lineno).toBe(7);
    expect(entries[2].fingerprint).toBe('cafebabe');
  });

  it('returns empty array if file missing', () => {
    expect(loadAllowlist('/nonexistent/path')).toEqual([]);
  });

  it('silently skips malformed entries', () => {
    const path = writeAllowlist(
      [
        'valid/file.ts deadbeef',
        'this is not a valid entry at all',
        'also/bad fingerprint-too-long-not-8-hex',
      ].join('\n'),
    );
    const entries = loadAllowlist(path);
    expect(entries).toHaveLength(1);
  });
});

describe('isAllowlisted()', () => {
  const allowlist = [
    { file: 'a.ts', fingerprint: 'deadbeef', lineno: null, raw: '' },
    { file: 'b.ts', fingerprint: null, lineno: 42, raw: '' },
  ];

  it('matches by fingerprint regardless of line number', () => {
    expect(isAllowlisted('a.ts', 1, '\n  res.deadbeef\n', allowlist)).toBe(false);
    // Need actual content with matching fingerprint
    const fp = fingerprint('matching content')!;
    const al = [{ file: 'a.ts', fingerprint: fp, lineno: null, raw: '' }];
    expect(isAllowlisted('a.ts', 1, 'matching content', al)).toBe(true);
    expect(isAllowlisted('a.ts', 999, 'matching content', al)).toBe(true);
    expect(isAllowlisted('a.ts', 1, 'different content', al)).toBe(false);
  });

  it('matches legacy entries by exact lineno', () => {
    expect(isAllowlisted('b.ts', 42, 'any content', allowlist)).toBe(true);
    expect(isAllowlisted('b.ts', 41, 'any content', allowlist)).toBe(false);
  });

  it('NEVER matches whitespace-only line content', () => {
    // Empty fingerprint should not match — defends against wildcard amnesty
    const al = [{ file: 'a.ts', fingerprint: 'e3b0c442', lineno: null, raw: '' }];
    expect(isAllowlisted('a.ts', 1, '', al)).toBe(false);
    expect(isAllowlisted('a.ts', 1, '   ', al)).toBe(false);
    expect(isAllowlisted('a.ts', 1, '\t\n', al)).toBe(false);
  });

  it('does not cross-match files', () => {
    const fp = fingerprint('some line')!;
    const al = [{ file: 'a.ts', fingerprint: fp, lineno: null, raw: '' }];
    expect(isAllowlisted('a.ts', 1, 'some line', al)).toBe(true);
    expect(isAllowlisted('b.ts', 1, 'some line', al)).toBe(false);
  });
});

describe('getAllowlistedCount()', () => {
  it('counts allowlist entries matching (file, fingerprint)', () => {
    const al = [
      { file: 'a.ts', fingerprint: 'deadbeef', lineno: null, raw: '' },
      { file: 'a.ts', fingerprint: 'deadbeef', lineno: null, raw: '' },
      { file: 'a.ts', fingerprint: 'cafebabe', lineno: null, raw: '' },
      { file: 'b.ts', fingerprint: 'deadbeef', lineno: null, raw: '' },
    ];
    expect(getAllowlistedCount('a.ts', 'deadbeef', al)).toBe(2);
    expect(getAllowlistedCount('a.ts', 'cafebabe', al)).toBe(1);
    expect(getAllowlistedCount('b.ts', 'deadbeef', al)).toBe(1);
    expect(getAllowlistedCount('a.ts', 'unknown', al)).toBe(0);
    expect(getAllowlistedCount('c.ts', 'deadbeef', al)).toBe(0);
  });

  it('does not count legacy lineno entries', () => {
    // Multiplicity tracking is fingerprint-only — legacy entries cannot
    // disambiguate same-text occurrences
    const al = [
      { file: 'a.ts', fingerprint: null, lineno: 1, raw: '' },
      { file: 'a.ts', fingerprint: null, lineno: 2, raw: '' },
    ];
    expect(getAllowlistedCount('a.ts', 'anything', al)).toBe(0);
  });
});

describe('migrateLegacyEntries()', () => {
  it('upgrades legacy lineno entries to fingerprint format', () => {
    const sourceContent = 'line 0\nline 1\ntarget line\nline 3';
    const reader = (file: string) =>
      file === 'a.ts' ? sourceContent : null;

    const legacy = [
      { file: 'a.ts', fingerprint: null, lineno: 3, raw: 'a.ts:3' },
    ];
    const migrated = migrateLegacyEntries(legacy, reader);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].lineno).toBeNull();
    expect(migrated[0].fingerprint).toBe(fingerprint('target line'));
  });

  it('preserves already-fingerprinted entries unchanged', () => {
    const fpEntry = { file: 'a.ts', fingerprint: 'deadbeef', lineno: null, raw: '' };
    const migrated = migrateLegacyEntries([fpEntry], () => null);
    expect(migrated[0]).toBe(fpEntry);
  });

  it('leaves legacy entries unchanged when source file unreadable', () => {
    const legacy = [
      { file: 'a.ts', fingerprint: null, lineno: 1, raw: 'a.ts:1' },
    ];
    const migrated = migrateLegacyEntries(legacy, () => null);
    expect(migrated[0].lineno).toBe(1);
    expect(migrated[0].fingerprint).toBeNull();
  });

  it('leaves legacy entries unchanged when lineno out of range', () => {
    const legacy = [
      { file: 'a.ts', fingerprint: null, lineno: 999, raw: 'a.ts:999' },
    ];
    const migrated = migrateLegacyEntries(legacy, () => 'only one line');
    expect(migrated[0].lineno).toBe(999);
    expect(migrated[0].fingerprint).toBeNull();
  });
});
