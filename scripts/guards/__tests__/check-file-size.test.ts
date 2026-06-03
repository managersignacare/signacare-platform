/*
 * scripts/guards/__tests__/check-file-size.test.ts
 *
 * BUG-528 — LOC ratchet guard tests.
 *
 * Each case writes a temp ceilings file + temp source file into
 * os.tmpdir(), invokes runCheck() directly, asserts the result.
 * Tests do NOT mutate the real .github/file-size-ceilings.txt.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../check-file-size';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'bug-528-'));
  // The runCheck() walks SCAN_ROOTS = ['apps/api/src', 'apps/web/src',
  // 'packages/shared/src']. Create empty roots so the new-file walk
  // finds nothing unless the test explicitly populates them.
  for (const root of ['apps/api/src', 'apps/web/src', 'packages/shared/src']) {
    mkdirSync(join(workdir, root), { recursive: true });
  }
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function lines(n: number): string {
  // n LOC = n lines, each terminated by \n. wc -l counts newlines, so
  // a file with content "a\nb\n" has 2 newlines = 2 LOC.
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
}

function writeCeilings(content: string): string {
  mkdirSync(join(workdir, '.github'), { recursive: true });
  const path = join(workdir, '.github/file-size-ceilings.txt');
  writeFileSync(path, content);
  return path;
}

function writeFile(relPath: string, lineCount: number): void {
  const abs = join(workdir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, lines(lineCount));
}

describe('BUG-528 check-file-size guard', () => {
  it('FS-1: file at exact ceiling → exit 0', () => {
    writeFile('apps/api/src/foo.ts', 100);
    const ceilings = writeCeilings('apps/api/src/foo.ts=100\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(0);
    expect(r.failures).toEqual([]);
    expect(r.notices).toEqual([]);
  });

  it('FS-2: file at ceiling + 1 → exit 0 (within +50 grace)', () => {
    writeFile('apps/api/src/foo.ts', 101);
    const ceilings = writeCeilings('apps/api/src/foo.ts=100\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(0);
  });

  it('FS-3: file at ceiling + 50 → exit 0 (exactly +50)', () => {
    writeFile('apps/api/src/foo.ts', 150);
    const ceilings = writeCeilings('apps/api/src/foo.ts=100\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(0);
  });

  it('FS-4: file at ceiling + 51 → exit 1 (PRE-FIX RED)', () => {
    writeFile('apps/api/src/foo.ts', 151);
    const ceilings = writeCeilings('apps/api/src/foo.ts=100\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(1);
    expect(r.failures.some((f) => f.includes('split or refactor'))).toBe(true);
  });

  it('FS-5: file at ceiling - 200 → exit 0, no notice (boundary)', () => {
    writeFile('apps/api/src/foo.ts', 100);
    const ceilings = writeCeilings('apps/api/src/foo.ts=300\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(0);
    expect(r.notices).toEqual([]);
  });

  it('FS-6: file at ceiling - 201 → exit 0 + NOTICE', () => {
    writeFile('apps/api/src/foo.ts', 99);
    const ceilings = writeCeilings('apps/api/src/foo.ts=300\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(0);
    expect(r.notices.some((n) => n.includes('ceiling can drop to 99'))).toBe(true);
  });

  it('FS-7: file NOT in ceiling list, 1001 LOC → exit 1 (PRE-FIX RED)', () => {
    writeFile('apps/api/src/big.ts', 1001);
    const ceilings = writeCeilings('# empty\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(1);
    expect(r.failures.some((f) => f.includes('1000 (architectural BLOCK threshold)'))).toBe(true);
  });

  it('FS-8: file NOT in ceiling list, 999 LOC → exit 0 silent', () => {
    writeFile('apps/api/src/medium.ts', 999);
    const ceilings = writeCeilings('# empty\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(0);
    expect(r.notices).toEqual([]);
  });

  it('FS-9: ceilings file missing → exit 2', () => {
    const r = runCheck(workdir, join(workdir, '.github/does-not-exist.txt'));
    expect(r.exitCode).toBe(2);
    expect(r.failures[0]).toMatch(/cannot read/);
  });

  it('FS-10: malformed line (no =) → exit 2', () => {
    const ceilings = writeCeilings('apps/api/src/foo.ts no equals here\n');
    const r = runCheck(workdir, ceilings);
    expect(r.exitCode).toBe(2);
    expect(r.failures[0]).toMatch(/malformed/);
  });
});
