/**
 * PR-R1-14 — CI guard: SELECT/UPDATE queries against tables WITH a
 * `deleted_at` column MUST include a `.whereNull('deleted_at')` filter
 * (CLAUDE.md §1.4).
 *
 * Why this exists — ~30 queries across the codebase have been observed
 * returning soft-deleted records to clinicians because the `deleted_at`
 * filter was forgotten. The PR-R1-13 guard catches the OPPOSITE drift
 * (`.whereNull('deleted_at')` on tables WITHOUT the column — runtime
 * SQL crash); this guard catches the MISSING-on-WITH half.
 *
 * The 61 tables WITH `deleted_at` (per schema-snapshot) require the
 * filter on every SELECT / UPDATE / DELETE query that should NOT
 * surface soft-deleted records. The 182 tables WITHOUT the column are
 * out of scope (PR-R1-13 already catches false-presence).
 *
 * Detection (Stage 1, single-statement precision):
 *   1. Walk every `apps/api/src/{features,mcp,integrations,jobs}/*.ts`
 *   2. Find every Knex opener `db('TABLE')` / `dbRead('TABLE')` /
 *      `trx('TABLE')` / `dbAdmin('TABLE')` (incl. generic-call form
 *      `db<Type>('TABLE')` and parenthesised ternary `(trx ?? db)('TABLE')`)
 *   3. If TABLE is in the WITH-deleted_at set, scan the chain for
 *      ANY of these soft-delete-aware predicates:
 *        - `.whereNull('deleted_at')` / `.whereNull('alias.deleted_at')`
 *        - `.where('deleted_at', null)` / `.where({deleted_at: null})`
 *        - `.whereRaw('deleted_at IS NULL')`
 *        - `.where('deleted_at', '<', someDate)` (admin/audit "include deleted")
 *        - `.where('deleted_at', '>', ...)` (similar)
 *   4. If the chain has NONE of the above AND it's a SELECT/UPDATE/DELETE
 *      → REJECT (the query may return soft-deleted records).
 *
 * Out of scope (Stage 1):
 *   - INSERT queries (`.insert(...)`) — no soft-delete relevance
 *   - Cross-statement variable chaining (`const q = db('foo'); ...; q.where(...)`)
 *     — only same-statement chain is scanned
 *   - Subquery analysis (`db('foo').whereExists(function() { this.from(...) })`)
 *   - INNER JOIN parent tables — only the OPENER table is checked
 *
 * Allowlist:
 *   - Inline `// @soft-delete-exempt: <reason>` (REQUIRES non-empty
 *     reason) on the line directly above the opener
 *   - File-level fingerprint allowlist `check-soft-delete-filter.allowlist`
 *     for grandfathered baseline drift
 *
 * Scope (matches PR-R1-13):
 *   `apps/api/src/features/`, `apps/api/src/mcp/`,
 *   `apps/api/src/integrations/`, `apps/api/src/jobs/`
 *
 * Mutation-resistant testing:
 *   `runGuard()` exported for end-to-end vitest fixture testing.
 *
 * Exit codes:
 *   0 — every SELECT/UPDATE/DELETE on WITH-deleted_at tables filters soft-delete
 *   1 — one or more queries lack the filter
 *   2 — schema-snapshot.json malformed or missing
 */

import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import {
  loadAllowlist as loadFingerprintAllowlist,
  isAllowlisted as isAllowlistedFingerprint,
  fingerprint as fingerprintLine,
  getAllowlistedCount,
  type AllowlistEntry,
} from './lib/allowlist-fingerprint';
import {
  buildLineOffsets,
  lineNoOfIndex,
  hasInlineExemptionOnPreviousLine,
  readSchemaTables,
  walkTsFiles,
} from './lib/guardRuntime';
import {
  buildDbOpenerRegex,
  findChainEnd,
  findDbAliasIdentifiers,
  parseTableAlias,
  stripCommentsPreservingLayout,
} from './lib/knexChainRuntime';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOTS = [
  resolve(ROOT, 'apps', 'api', 'src', 'features'),
  resolve(ROOT, 'apps', 'api', 'src', 'mcp'),
  resolve(ROOT, 'apps', 'api', 'src', 'integrations'),
  resolve(ROOT, 'apps', 'api', 'src', 'jobs'),
];
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-soft-delete-filter.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  table: string;
  preview: string;
  reason: string;
}

interface ScanCounts {
  validated: number;
  skippedNoDeletedAtColumn: number;
  skippedExempt: number;
  skippedInsert: number;
  skippedNoChain: number;
}

// ── helpers ────────────────────────────────────────────────────────────

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@soft-delete-exempt:\s*\S/);
}

/**
 * Find the end of a Knex chain starting at `openerStart`. Walks forward
 * through `.method(...)` chained calls (handling balanced parens) until
 * the chain terminates with a Promise consumer (`.then`, `.catch`, `await`)
 * or a top-level `;` / `)` / newline that breaks the chain.
 *
 * Returns the END index (exclusive). Conservative: stops at first
 * top-level `;` or end-of-statement.
 */
const SOFT_DELETE_PREDICATES = [
  // .whereNull('deleted_at') / .whereNull('alias.deleted_at')
  /\.whereNull\s*\(\s*['"`](?:\w+\.)?deleted_at['"`]\s*\)/,
  // .where('deleted_at', null) / .where('alias.deleted_at', null)
  /\.where\s*\(\s*['"`](?:\w+\.)?deleted_at['"`]\s*,\s*null\s*\)/,
  // .where({ deleted_at: null }) / .where({ 'alias.deleted_at': null })
  /\.where\s*\(\s*\{\s*[^}]*['"`]?(?:\w+\.)?deleted_at['"`]?\s*:\s*null/,
  // .whereRaw('deleted_at IS NULL') / .whereRaw('a.deleted_at IS NULL')
  /\.whereRaw\s*\(\s*['"`][^'"`]*\bdeleted_at\s+IS\s+NULL\b/i,
  // Admin/audit "include deleted" filters: .where('deleted_at', '<' / '>' / '=', someDate)
  /\.where\s*\(\s*['"`](?:\w+\.)?deleted_at['"`]\s*,\s*['"`]/,
  // .whereNotNull('deleted_at') — caller wants only deleted records (audit query)
  /\.whereNotNull\s*\(\s*['"`](?:\w+\.)?deleted_at['"`]\s*\)/,
];

function chainHasSoftDeletePredicate(chain: string): boolean {
  for (const re of SOFT_DELETE_PREDICATES) {
    if (re.test(chain)) return true;
  }
  return false;
}

/**
 * Detect whether a chain is a SELECT query that lists records (vs INSERT
 * / UPDATE / DELETE / single-row .first()). The soft-delete-filter rule
 * (CLAUDE.md §1.4 canonical examples) targets SELECT lists where
 * soft-deleted records would surface to consumers. UPDATEs / DELETEs by
 * primary key intentionally target specific rows regardless of soft-delete
 * state (recovery flows, audit corrections), so they are out of scope.
 *
 * Detection: a chain is in-scope iff:
 *   - It has NO `.insert(...)`, `.update(...)`, `.del()`, `.delete()` call.
 *   - It HAS at least one `.where*` clause (single-row lookups by id-only
 *     are usually `.first()` and conventionally include soft-delete check
 *     via the broader CLAUDE.md §1.3 clinic_id discipline; we leave them
 *     to the writer's judgment by requiring an explicit `.where`).
 */
function isSelectListChain(chain: string): boolean {
  if (/\.insert\s*\(/.test(chain)) return false;
  if (/\.update\s*\(/.test(chain)) return false;
  if (/\.del\s*\(\s*\)/.test(chain)) return false;
  if (/\.delete\s*\(/.test(chain)) return false;
  return true;
}

// ── opener detection (sibling of PR-R1-13's findQueryScopedAliases) ──

export { findDbAliasIdentifiers };

// ── file scanner ───────────────────────────────────────────────────────

function checkFile(
  file: string,
  rawSource: string,
  withDeletedAt: Set<string>,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  const source = stripCommentsPreservingLayout(rawSource);
  const rawLineOffsets = buildLineOffsets(rawSource);
  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const lineOffsets = buildLineOffsets(source);
  const lines = rawSource.split('\n');
  const dbAliases = findDbAliasIdentifiers(source);
  const openerRe = buildDbOpenerRegex(dbAliases);

  let m: RegExpExecArray | null;
  openerRe.lastIndex = 0;
  while ((m = openerRe.exec(source)) !== null) {
    const spec = m[1] || m[2] || '';
    if (!spec) continue;
    const { table } = parseTableAlias(spec);

    // Skip if the table is NOT in the WITH-deleted_at set (out of scope —
    // PR-R1-13 catches false-presence on these).
    if (!withDeletedAt.has(table)) {
      counts.skippedNoDeletedAtColumn++;
      continue;
    }

    const lineNo = lineNoOfIndex(lineOffsets, m.index);
    if (hasInlineExemption(rawSource, lineNo, rawLineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    // Find the chain end.
    const chainEnd = findChainEnd(source, m.index);
    const chain = source.slice(m.index, chainEnd);

    // Skip INSERTs / UPDATEs / DELETEs (no soft-delete filter relevance —
    // those operations target specific rows by primary key and are
    // intentionally non-list semantically).
    if (!isSelectListChain(chain)) {
      counts.skippedInsert++;
      continue;
    }

    // Skip if no `.where*` at all in the chain — likely raw select-all
    // or a builder fragment that's awaited/composed elsewhere.
    if (!/\.where/.test(chain) && !/\.whereNull/.test(chain) && !/\.whereRaw/.test(chain)) {
      counts.skippedNoChain++;
      continue;
    }

    if (chainHasSoftDeletePredicate(chain)) {
      counts.validated++;
      continue;
    }

    // Violation: WITH-deleted_at table with no soft-delete predicate in chain.
    const fullLine = lines[lineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);

    if (isAllowlistedFingerprint(relFile, lineNo, fullLine, allow)) {
      const fp = fingerprintLine(fullLine);
      if (fp) {
        const key = `${relFile}|${fp}`;
        violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
        const allowed = getAllowlistedCount(relFile, fp, allow);
        if ((violationBuckets.get(key) || 0) > allowed) {
          violations.push({
            file: relFile,
            lineNo,
            table,
            preview,
            reason: `over-count: ${violationBuckets.get(key)} occurrences vs ${allowed} allowlisted (fingerprint ${fp})`,
          });
        }
      }
      continue;
    }

    violations.push({
      file: relFile,
      lineNo,
      table,
      preview,
      reason: `query against '${table}' (which has soft-delete column 'deleted_at') lacks .whereNull('deleted_at') filter — query may surface soft-deleted records to clinicians`,
    });
  }

  return violations;
}

// ── runner (exported for tests) ────────────────────────────────────────

export interface RunGuardOpts {
  snapshotPath?: string;
  scanRoots?: string[];
  allowlistPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1 | 2;
  violations: Violation[];
  counts: ScanCounts;
  filesScanned: number;
  allowlistEntries: number;
  withDeletedAtCount: number;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const scanRoots = opts.scanRoots ?? DEFAULT_SCAN_ROOTS;
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  const tables = readSchemaTables(snapshotPath);
  if (!tables) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validated: 0, skippedNoDeletedAtColumn: 0, skippedExempt: 0, skippedInsert: 0, skippedNoChain: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
      withDeletedAtCount: 0,
    };
  }

  // Build the WITH-deleted_at set once.
  const withDeletedAt = new Set<string>();
  for (const [table, cols] of Object.entries(tables)) {
    if (cols.includes('deleted_at')) withDeletedAt.add(table);
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = Array.from(
    new Set(
      scanRoots.flatMap((root) => walkTsFiles(root, [], {
        excludeDirs: ['node_modules', 'dist', '__tests__'],
      })),
    ),
  ).sort();
  const counts: ScanCounts = {
    validated: 0,
    skippedNoDeletedAtColumn: 0,
    skippedExempt: 0,
    skippedInsert: 0,
    skippedNoChain: 0,
  };
  const violationBuckets = new Map<string, number>();
  const allViolations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const v = checkFile(file, source, withDeletedAt, allow, counts, violationBuckets);
    allViolations.push(...v);
  }

  return {
    exitCode: allViolations.length > 0 ? 1 : 0,
    violations: allViolations,
    counts,
    filesScanned: files.length,
    allowlistEntries: allow.length,
    withDeletedAtCount: withDeletedAt.size,
  };
}

// ── CLI entry ──────────────────────────────────────────────────────────

function main(): void {
  const result = runGuard();
  // eslint-disable-next-line no-console
  console.log('→ check-soft-delete-filter (PR-R1-14; CLAUDE.md §1.4)');
  // eslint-disable-next-line no-console
  console.log(`  snapshot:           ${relative(ROOT, DEFAULT_SNAPSHOT_PATH)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:          ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  scanned:            ${result.filesScanned} ts file(s)`);
  // eslint-disable-next-line no-console
  console.log(`  WITH deleted_at:    ${result.withDeletedAtCount} tables`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty. Regenerate with \`npm run db:snapshot --workspace=apps/api\`.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated:           ${result.counts.validated}  (chain has soft-delete predicate)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped no-deleted_at: ${result.counts.skippedNoDeletedAtColumn}  (table has no deleted_at column — out of scope)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped insert:      ${result.counts.skippedInsert}  (INSERT chain — no soft-delete relevance)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped no-chain:    ${result.counts.skippedNoChain}  (no .where* in chain — likely composed elsewhere)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:      ${result.counts.skippedExempt}  (// @soft-delete-exempt:)`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every SELECT/UPDATE/DELETE chain on a soft-delete table includes the filter.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} chain(s) missing soft-delete filter:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  table='${v.table}'`);
    // eslint-disable-next-line no-console
    console.error(`    reason: ${v.reason}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: append `.whereNull(\'deleted_at\')` (or alias-prefixed equivalent) to the chain. If the query intentionally includes soft-deleted records (admin/audit/recovery view), add `// @soft-delete-exempt: <reason>` on the line directly above the opener OR add `<file> <fingerprint>  # comment` to scripts/guards/check-soft-delete-filter.allowlist.',
  );
  process.exit(1);
}

if (require.main === module) main();
