#!/usr/bin/env tsx
/**
 * scripts/guards/check-no-hardcoded-column-lists.ts
 *
 * Phase 0b.2b — guard against hand-written `*_COLUMNS` / `*_COLS`
 * constants under `apps/api/src/features/` that drift silently when
 * migrations add columns.
 *
 * Operator-authorized strategy 2026-05-04 ("A-as-default-with-B-allowed-
 * per-site"):
 *
 *   Class A — "all columns of a table"
 *     Drift debt: when a migration adds a column, the hand-written
 *     constant goes stale silently. Replace with the auto-generated
 *     `<TABLE>_COLUMNS` from `apps/api/src/db/types/<table>.ts`
 *     (Phase 0b.2a generator emit) so the constant is migration-driven.
 *
 *   Class B — "projection subset" (privacy redaction, role-based filter)
 *     Intentional column-list narrowing where the omission IS the
 *     mechanism (e.g. `PHONE_TRIAGE_COLUMNS_REDACTED` in
 *     receptionistFeatureRoutes.ts deliberately omits
 *     `clinical_risk_flags` for non-nurse callers — that is the
 *     privacy boundary, not drift). These declarations require
 *     `// @column-list-projection-exempt: <reason>` annotation within
 *     ±10 lines of the `const X_COLUMNS = [` opener.
 *
 *   `select('*')` + Zod parse — allowed only where it doesn't weaken
 *     projection/privacy semantics. Such sites use no `*_COLUMNS`
 *     constant at all (out of this guard's scope).
 *
 * Detection: any `^const\s+[A-Z_]+_(COLUMNS|COLS)\s*=` declaration in
 * `apps/api/src/features/**` is a violation unless either:
 *   (a) annotated with `// @column-list-projection-exempt: <reason>`
 *       within ±10 lines, OR
 *   (b) listed in `scripts/guards/check-no-hardcoded-column-lists.allowlist`.
 *
 * Allowlist format (Phase 0a.7 expiry-policy compliant):
 *   <file>:<constant_name>  # class: A|B | <BUG-XXX> — <reason> | expires: <YYYY-MM-DD> (cascade: <BUG-XXX>)
 *
 * Class A entries drain in 0b.2c (replace with generated import).
 * Class B entries are mis-classifications discovered during 0b.2c —
 * if a Class A allowlist entry turns out to be Class B, the right
 * action is to add the annotation in-source AND remove the allowlist
 * entry, NOT to flip the class in the allowlist (annotation is the
 * canonical mechanism).
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 *   2 — malformed allowlist OR stale entry
 */

import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from './lib/repoRoot';

const FEATURES_DIR = path.join(REPO_ROOT, 'apps/api/src/features');
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts/guards/check-no-hardcoded-column-lists.allowlist');

export function findColumnConstants(source: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  const lines = source.split('\n');
  // Constant name must contain `_COLUMNS` or `_COLS` substring (optionally
  // followed by a suffix like `_FULL` / `_REDACTED` for paired projections).
  // Optional `export` modifier matched (Phase 0b.2b cycle-1 absorb of L5
  // cascade-discovery: 6 `export const X_COLUMNS = [` constants in
  // `apps/api/src/features/{referrals,treatment-pathways}/` were silently
  // invisible to the regex when the optional `export\s+` was missing).
  // Examples matched: PATIENT_COLUMNS, APPOINTMENT_COLS, PHONE_TRIAGE_COLUMNS_FULL,
  // PHONE_TRIAGE_COLUMNS_REDACTED, BASE_COLS, REFERRAL_COLUMNS (export form).
  const re = /^\s*(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*(?:_COLUMNS|_COLS)[A-Z0-9_]*)\s*=\s*\[/;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) out.push({ name: m[1], line: i + 1 });
  }
  return out;
}

export function hasProjectionExemptAnnotation(source: string, declLine: number): boolean {
  const lines = source.split('\n');
  // Look ±10 lines around the declaration line
  const lo = Math.max(0, declLine - 11);
  const hi = Math.min(lines.length, declLine + 9);
  for (let i = lo; i < hi; i++) {
    if (/\/\/\s*@column-list-projection-exempt:\s*.+/.test(lines[i])) return true;
  }
  // Also accept file-header annotation in first 30 lines
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    if (/\/\/\s*@column-list-projection-exempt:\s*.+/.test(lines[i])) return true;
  }
  return false;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(p, acc);
    } else if (e.isFile() && p.endsWith('.ts')) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

interface AllowlistEntry {
  readonly fileRelative: string;
  readonly constantName: string;
  readonly classMarker: 'A' | 'B' | 'unknown';
  readonly raw: string;
}

export function readAllowlist(): { entries: AllowlistEntry[]; malformed: string[] } {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { entries: [], malformed: [] };
  const text = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
  const entries: AllowlistEntry[] = [];
  const malformed: string[] = [];
  for (const lineRaw of text.split('\n')) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    // Format: <file>:<constant>  # class: A|B | <BUG-XXX> — <reason> | expires: <YYYY-MM-DD> (cascade: <BUG-XXX>)
    const m = /^([^\s:]+):([A-Z_][A-Z0-9_]*)\s*#(.*)$/.exec(line);
    if (!m) {
      malformed.push(lineRaw);
      continue;
    }
    const comment = m[3];
    let classMarker: 'A' | 'B' | 'unknown' = 'unknown';
    const cm = /\bclass:\s*(A|B)\b/.exec(comment);
    if (cm) classMarker = cm[1] as 'A' | 'B';
    entries.push({ fileRelative: m[1], constantName: m[2], classMarker, raw: lineRaw });
  }
  return { entries, malformed };
}

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly constantName: string;
}

interface RunResult {
  filesScanned: number;
  declsFound: number;
  exemptedByAnnotation: number;
  allowlistEntries: number;
  classACount: number;
  classBCount: number;
  classUnknownCount: number;
  violations: Violation[];
  staleEntries: AllowlistEntry[];
  malformedEntries: string[];
}

export function run(): RunResult {
  const files = walk(FEATURES_DIR);
  const { entries: allowlist, malformed } = readAllowlist();
  const allowlistKeyed = new Map<string, AllowlistEntry>();
  for (const e of allowlist) {
    allowlistKeyed.set(`${e.fileRelative}:${e.constantName}`, e);
  }

  const violations: Violation[] = [];
  const allSeenKeys = new Set<string>();
  let declsFound = 0;
  let exemptedByAnnotation = 0;

  for (const file of files) {
    const fileRelative = path.relative(REPO_ROOT, file);
    const source = fs.readFileSync(file, 'utf8');
    const decls = findColumnConstants(source);
    for (const decl of decls) {
      declsFound++;
      if (hasProjectionExemptAnnotation(source, decl.line)) {
        exemptedByAnnotation++;
        continue;
      }
      const key = `${fileRelative}:${decl.name}`;
      allSeenKeys.add(key);
      if (allowlistKeyed.has(key)) continue;
      violations.push({ file: fileRelative, line: decl.line, constantName: decl.name });
    }
  }

  // Stale-allowlist detection: entries that point to constants that no longer
  // violate (constant removed, file removed, OR annotation added in-source).
  const staleEntries: AllowlistEntry[] = [];
  for (const entry of allowlist) {
    const key = `${entry.fileRelative}:${entry.constantName}`;
    if (!allSeenKeys.has(key)) staleEntries.push(entry);
  }

  let classACount = 0;
  let classBCount = 0;
  let classUnknownCount = 0;
  for (const e of allowlist) {
    if (e.classMarker === 'A') classACount++;
    else if (e.classMarker === 'B') classBCount++;
    else classUnknownCount++;
  }

  return {
    filesScanned: files.length,
    declsFound,
    exemptedByAnnotation,
    allowlistEntries: allowlist.length,
    classACount,
    classBCount,
    classUnknownCount,
    violations,
    staleEntries,
    malformedEntries: malformed,
  };
}

function main() {
  // eslint-disable-next-line no-console
  console.log('\n→ check-no-hardcoded-column-lists (Phase 0b.2b)\n');
  const result = run();
  // eslint-disable-next-line no-console
  console.log(`  files scanned:        ${result.filesScanned}`);
  // eslint-disable-next-line no-console
  console.log(`  *_COLUMNS / *_COLS decls: ${result.declsFound}`);
  // eslint-disable-next-line no-console
  console.log(`  exempted by annotation: ${result.exemptedByAnnotation}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist entries:    ${result.allowlistEntries}`);
  // eslint-disable-next-line no-console
  console.log(`    Class A (drift debt):           ${result.classACount}`);
  // eslint-disable-next-line no-console
  console.log(`    Class B (projection-exemption): ${result.classBCount}`);
  // eslint-disable-next-line no-console
  console.log(`    Class unknown:                  ${result.classUnknownCount}`);
  // eslint-disable-next-line no-console
  console.log(`  violations:           ${result.violations.length}`);
  // eslint-disable-next-line no-console
  console.log(`  stale allowlist:      ${result.staleEntries.length}`);
  // eslint-disable-next-line no-console
  console.log(`  malformed entries:    ${result.malformedEntries.length}`);

  if (result.malformedEntries.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ malformed allowlist entries (must be: <file>:<constant>  # class: A|B | <BUG> — <reason> | expires: <YYYY-MM-DD> (cascade: <BUG>)):`);
    for (const r of result.malformedEntries) {
      // eslint-disable-next-line no-console
      console.error(`  ${r}`);
    }
    process.exit(2);
  }

  if (result.staleEntries.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ stale allowlist entries (constant migrated, removed, or now annotated):`);
    for (const e of result.staleEntries) {
      // eslint-disable-next-line no-console
      console.error(`  ${e.fileRelative}:${e.constantName}`);
    }
    process.exit(2);
  }

  if (result.classUnknownCount > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ ${result.classUnknownCount} allowlist entry/entries lack a class marker (must include "class: A" or "class: B" in the annotation):`);
    for (const e of [...readAllowlist().entries].filter((e) => e.classMarker === 'unknown')) {
      // eslint-disable-next-line no-console
      console.error(`  ${e.fileRelative}:${e.constantName}`);
    }
    process.exit(2);
  }

  if (result.violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ ${result.violations.length} hand-written *_COLUMNS / *_COLS constant(s) lack the canonical resolution:`);
    for (const v of result.violations) {
      // eslint-disable-next-line no-console
      console.error(`  ${v.file}:${v.line}  ${v.constantName}`);
    }
    // eslint-disable-next-line no-console
    console.error(`\nFix per Phase 0b.2 plan + CLAUDE.md §15:`);
    // eslint-disable-next-line no-console
    console.error(`  Class A (drift debt — "all columns of a table"):`);
    // eslint-disable-next-line no-console
    console.error(`    Replace with:`);
    // eslint-disable-next-line no-console
    console.error(`      import { <TABLE>_COLUMNS } from '../../db/types/<table>';`);
    // eslint-disable-next-line no-console
    console.error(`    Then use <TABLE>_COLUMNS where the local constant was used.`);
    // eslint-disable-next-line no-console
    console.error(`  Class B (projection subset — privacy/role-based redaction):`);
    // eslint-disable-next-line no-console
    console.error(`    Add annotation within ±10 lines of the declaration:`);
    // eslint-disable-next-line no-console
    console.error(`      // @column-list-projection-exempt: <reason describing the privacy/projection mechanism>`);
    // eslint-disable-next-line no-console
    console.error(`  NEW entries cannot be allowlisted (the lenient baseline is for pre-existing`);
    // eslint-disable-next-line no-console
    console.error(`  drift only; new sites must take the canonical resolution).`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('\n✓ All hand-written *_COLUMNS / *_COLS constants are either annotated as projection-exempt or in the lenient baseline allowlist.');
}

if (require.main === module) {
  main();
}
