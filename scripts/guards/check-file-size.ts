#!/usr/bin/env tsx
/*
 * scripts/guards/check-file-size.ts
 *
 * BUG-528 — LOC ratchet guard.
 *
 * Reads .github/file-size-ceilings.txt; for each `<path>=<ceiling>`
 * line, compares newline-count of the file against ceiling +50 / -200.
 *
 * Files NOT in the ceiling list:
 *   - <= 1000 LOC: silent pass.
 *   - >  1000 LOC: fail (new file beyond architectural BLOCK threshold).
 *     Suggest "split or add to .github/file-size-ceilings.txt with cite".
 *
 * Closes god-file growth class (BUG-420 / BUG-524). The ratchet runs
 * NOW; the actual MedicationsTab split is BUG-524's job.
 *
 * Sibling guards: BUG-474 check-no-vulnerable-uuid.ts shape; CI wire-in
 * mirrors row-iface-drift-guard.
 *
 * Exit codes:
 *   0  no violation (within ratchet for listed files; <=1000 LOC for new)
 *   1  one or more violations
 *   2  pre-condition failure (ceilings file missing/malformed/duplicate)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const PLUS = 50;
const MINUS_NOTICE = 200;
const HARD_NEW_FILE = 1000;
const EXCLUDE_DIRS = ['node_modules', 'dist', 'build', 'coverage', '.git', '.next'];
const SCAN_ROOTS = ['apps/api/src', 'apps/web/src', 'packages/shared/src'];

interface CeilingEntry {
  path: string;
  ceiling: number;
  line: number;
}

interface CheckResult {
  failures: string[];
  notices: string[];
  ceilingsCount: number;
  exitCode: number;
}

export function runCheck(repoRoot: string, ceilingsPath: string): CheckResult {
  const failures: string[] = [];
  const notices: string[] = [];

  // 1. Parse ceilings file.
  let raw: string;
  try {
    raw = readFileSync(ceilingsPath, 'utf-8');
  } catch (e) {
    return {
      failures: [`cannot read ${ceilingsPath}: ${(e as Error).message}`],
      notices: [],
      ceilingsCount: 0,
      exitCode: 2,
    };
  }

  const ceilings: CeilingEntry[] = [];
  const seen = new Set<string>();
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      return {
        failures: [`${ceilingsPath}:${i + 1} malformed (no '='): ${trimmed}`],
        notices: [],
        ceilingsCount: 0,
        exitCode: 2,
      };
    }
    const p = trimmed.slice(0, eq).trim();
    const n = parseInt(trimmed.slice(eq + 1).trim(), 10);
    if (!Number.isFinite(n) || n < 0) {
      return {
        failures: [`${ceilingsPath}:${i + 1} non-numeric ceiling: ${trimmed}`],
        notices: [],
        ceilingsCount: 0,
        exitCode: 2,
      };
    }
    if (seen.has(p)) {
      return {
        failures: [`${ceilingsPath}:${i + 1} duplicate entry: ${p}`],
        notices: [],
        ceilingsCount: 0,
        exitCode: 2,
      };
    }
    seen.add(p);
    ceilings.push({ path: p, ceiling: n, line: i + 1 });
  }

  // 2. Helper: line count via fs (newline-tally; mirrors `wc -l`).
  function lineCount(absPath: string): number {
    const buf = readFileSync(absPath);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) n++;
    }
    return n;
  }

  // 3. Walk listed-ceiling files.
  const listedAbs = new Set<string>();
  for (const e of ceilings) {
    const abs = resolve(repoRoot, e.path);
    listedAbs.add(abs);
    let cur: number;
    try {
      cur = lineCount(abs);
    } catch {
      failures.push(`${e.path}: ceiling-listed but file missing — drop entry or restore file`);
      continue;
    }
    if (cur > e.ceiling + PLUS) {
      failures.push(
        `${e.path}: ${cur} LOC > ceiling ${e.ceiling} + ${PLUS} grace — split or refactor`,
      );
    } else if (cur < e.ceiling - MINUS_NOTICE) {
      notices.push(
        `${e.path}: ${cur} LOC — ceiling can drop to ${cur} (currently ${e.ceiling})`,
      );
    }
  }

  // 4. Walk SCAN_ROOTS for "new" files >1000 LOC.
  function walkTs(dir: string, out: string[]): void {
    let entries: ReturnType<typeof readdirSync> = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.includes(entry.name)) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walkTs(full, out);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        out.push(full);
      }
    }
  }

  const allTs: string[] = [];
  for (const r of SCAN_ROOTS) walkTs(resolve(repoRoot, r), allTs);

  for (const abs of allTs) {
    if (listedAbs.has(abs)) continue;
    const cur = lineCount(abs);
    if (cur > HARD_NEW_FILE) {
      const rel = relative(repoRoot, abs);
      failures.push(
        `${rel}: ${cur} LOC > ${HARD_NEW_FILE} (architectural BLOCK threshold) — split, OR add to .github/file-size-ceilings.txt with BUG-cite if grandfathering`,
      );
    }
  }

  return {
    failures,
    notices,
    ceilingsCount: ceilings.length,
    exitCode: failures.length > 0 ? 1 : 0,
  };
}

// CLI entry point — runs against the live repo.
if (require.main === module) {
  const repoRoot = resolve(__dirname, '..', '..');
  const ceilingsPath = resolve(repoRoot, '.github/file-size-ceilings.txt');
  const result = runCheck(repoRoot, ceilingsPath);

  for (const n of result.notices) {
    console.log(`check-file-size NOTICE: ${n}`);
  }
  if (result.exitCode === 2) {
    for (const f of result.failures) console.error(`check-file-size: ${f}`);
    process.exit(2);
  }
  if (result.exitCode === 1) {
    console.error(`check-file-size: ${result.failures.length} violation(s):`);
    for (const f of result.failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `check-file-size: OK — ${result.ceilingsCount} ceiling-listed files within +${PLUS} grace, ${result.notices.length} eligible for ceiling drop.`,
  );
}
