/*
 * scripts/guards/lib/fix-registry-decisiveness-core.ts
 *
 * Phase R1 PR-R1-7 cycle-2 — pure helpers extracted from
 * `check-fix-registry-decisiveness.ts` so the vitest spec can
 * import + exercise them directly (per L3 finding #4 on cycle-1).
 */

import { spawnSync } from 'child_process';

/**
 * Maximum number of `git grep -E` hits a `present`-type pattern may
 * produce while still being considered decisive. See the guard's
 * docstring for the rationale.
 */
export const MAX_DECISIVE_HITS = 5;

export interface RegistryRow {
  id: string;
  file: string;
  type: 'present' | 'absent' | 'retired' | 'unknown';
  pattern: string;
  rawLine: string;
  lineno: number;
}

export interface AllowlistEntry {
  id: string;
  expected: number;
  raw: string;
}

/**
 * Parse the markdown registry source. Identifies the table whose
 * header includes "ID" and "Pattern" cells, then extracts every data
 * row's id/file/type/pattern from cells 1-4 (after stripping the
 * leading empty cell).
 */
export function parseRegistry(source: string): RegistryRow[] {
  const lines = source.split('\n');
  const rows: RegistryRow[] = [];
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trimStart().startsWith('|')) {
      inTable = false;
      continue;
    }
    if (!inTable) {
      if (line.includes('| ID |') && line.includes('| Pattern |')) {
        inTable = true;
        i++; // skip separator row
        continue;
      }
      continue;
    }
    if (/^\s*\|\s*-/.test(line)) continue;
    const parts = line.split('|').map((c) => c.trim());
    if (parts.length < 6) continue;
    const id = parts[1]!;
    const file = parts[2]!;
    const type = parts[3]! as RegistryRow['type'];
    let pattern = parts[4]!;
    pattern = pattern.replace(/^`/, '').replace(/`$/, '');
    if (!id || !file || !pattern) continue;
    rows.push({ id, file, type, pattern, rawLine: line, lineno: i + 1 });
  }
  return rows;
}

export interface AllowlistParseResult {
  entries: AllowlistEntry[];
  parseErrors: string[];
}

/**
 * Parse the allowlist source. Cycle-2 format (per L3 finding #3):
 *
 *   <ANCHOR-ID> expected=<N>  # comment
 *
 * The expected count is the SNAPSHOT hit count at allowlist time.
 * Drift in either direction (the file gained or lost matches)
 * surfaces as a count-mismatch in the guard report so the maintainer
 * can decide whether to re-tighten the anchor or update the expected.
 *
 * Cycle-1 used `<ANCHOR-ID>  # comment` with the count buried in the
 * comment. The comment was ignorable; cycle-2 makes the count a
 * machine-checkable assertion (sibling pattern of PR-R1-6 cycle-2's
 * bugs-remaining-uniqueness allowlist).
 */
export function parseAllowlist(source: string): AllowlistParseResult {
  const entries: AllowlistEntry[] = [];
  const parseErrors: string[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.split('#')[0]!.trim();
    if (!trimmed) continue;
    const m = /^([A-Za-z0-9._-]+)\s+expected=(\d+)$/.exec(trimmed);
    if (!m) {
      parseErrors.push(
        `line ${i + 1}: malformed entry "${trimmed}". Expected format: \`<ANCHOR-ID> expected=<N>  # comment\``,
      );
      continue;
    }
    entries.push({ id: m[1]!, expected: parseInt(m[2]!, 10), raw: line });
  }
  return { entries, parseErrors };
}

/**
 * Count matches by running `git grep -E -c <pattern> -- <file>`.
 *
 * Uses `spawnSync` (NOT execSync) to bypass shell parsing entirely —
 * the pattern can contain backticks, dollar signs, parens, escapes
 * or any other character that would be interpreted by `sh -c`. Each
 * argument is passed verbatim to git.
 *
 * Error-mode boundary (per L3 finding #6):
 *   - exit 0 → at least one match; output is `<file>:<count>`
 *   - exit 1 → zero matches (treated as 0)
 *   - exit 128 → file untracked OR malformed regex (also 0; the
 *     existing `check-fix-registry.sh` catches malformed-regex via
 *     its presence check, so the boundary is safe but documented)
 *   - other → defensive 0
 */
export function countMatches(pattern: string, file: string, repoRoot: string): number {
  const r = spawnSync('git', ['grep', '-E', '-c', '--', pattern, '--', file], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  if (r.status !== 0) return 0;
  const out = (r.stdout ?? '').trim();
  const m = /:(\d+)$/.exec(out);
  if (m) return parseInt(m[1]!, 10);
  const n = parseInt(out, 10);
  return Number.isFinite(n) ? n : 0;
}

export interface DecisivenessViolation {
  id: string;
  file: string;
  pattern: string;
  hits: number;
  registryLine: number;
}

export interface CountDriftViolation {
  id: string;
  expected: number;
  actual: number;
  hits: number;
}

/**
 * Apply the decisiveness rule to a parsed registry + allowlist:
 *   - For each `present`-type row, count matches via `countHits(...)`.
 *   - If the row is in the allowlist, assert the count matches the
 *     allowlisted `expected` value (drift = error).
 *   - If the row is NOT in the allowlist and the count exceeds
 *     MAX_DECISIVE_HITS, flag as a decisiveness violation.
 *
 * Returns ({ violations, countDrift }) for the caller to render.
 */
export function evaluateDecisiveness(
  rows: RegistryRow[],
  allowlist: AllowlistEntry[],
  countHits: (pattern: string, file: string) => number,
): { violations: DecisivenessViolation[]; countDrift: CountDriftViolation[] } {
  const allowMap = new Map<string, number>();
  for (const e of allowlist) allowMap.set(e.id, e.expected);

  const violations: DecisivenessViolation[] = [];
  const countDrift: CountDriftViolation[] = [];

  for (const row of rows) {
    if (row.type !== 'present') continue;
    const hits = countHits(row.pattern, row.file);
    if (allowMap.has(row.id)) {
      const expected = allowMap.get(row.id)!;
      if (hits !== expected) {
        countDrift.push({ id: row.id, expected, actual: hits, hits });
      }
      continue;
    }
    if (hits > MAX_DECISIVE_HITS) {
      violations.push({
        id: row.id,
        file: row.file,
        pattern: row.pattern,
        hits,
        registryLine: row.lineno,
      });
    }
  }

  return { violations, countDrift };
}
