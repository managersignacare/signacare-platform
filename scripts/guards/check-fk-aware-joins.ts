/**
 * BUG-637 — CI guard: Knex `.innerJoin()`/`.leftJoin()`/`.rightJoin()`/
 * `.fullOuterJoin()`/`.join()` calls MUST resolve to canonical FK relationships
 * per `schema-snapshot.json`.
 *
 * Why this exists — BUG-623 (NursingPage MAR endpoint joined `prescriptions`
 * on `medication_administrations.patient_medication_id` — FK targets
 * `patient_medications` not `prescriptions`) and BUG-632 (sibling instance
 * on `/medications/due-now` of the same file). Both went undetected for
 * weeks because:
 *
 *   - TypeScript can't enforce FK semantics at compile time
 *   - Existing guards check column existence (§1.1) and table existence
 *     (§1.2) but NOT FK compatibility
 *   - Wrong-table joins compile cleanly, pass lint, return empty result
 *     sets at runtime → silent clinical-safety regression (DOUBLE-DOSING /
 *     MISSED-DOSE harm classes)
 *
 * Cycle 2 absorb-1 corrections (per L3 cycle-1 REJECT):
 *
 *   - FN-1: regex now matches `.join()` (Knex's canonical alias for
 *     `.innerJoin()`) in addition to the four named-join forms.
 *   - FN-2: same-column-name fallback restricted to a documented partition-
 *     key allowlist (`clinic_id`, `tenant_id`, `org_id`). All other
 *     neither-FK joins are now REJECTED — closes the cross-table PK = PK
 *     escape hatch the cycle-1 reviewer caught with `staff.id ↔ patients.id`.
 *   - FN-3: multi-condition `(j) => j.on(...)` joins emit a WARN counter
 *     so reviewers see the unvalidated surface size. Filed as
 *     BUG-637-FOLLOWUP-MULTI-CONDITION.
 *   - FN-4: alias resolution is query-scoped, not file-wide. The guard
 *     finds the nearest enclosing `db(...)`/`dbRead(...)`/`trx(...)`/`.from(...)`
 *     opening BEFORE the join (within ~3000 chars / a typical handler
 *     body) and scans only that window for aliases.
 *   - FN-5: scan summary now prints `validated / skipped (no-snapshot) /
 *     warned (multi-condition) / unparseable` counts so blind spots are
 *     auditable.
 *
 * Pattern detection is regex-based against the source code (sibling to
 * the existing `check-query-builder-columns.ts` guard).
 *
 * Allowlist: `// @fk-join-exempt: <reason>` above the join call OR a
 * `<file>:<line>` entry in `check-fk-aware-joins.allowlist`.
 *
 * Coverage GAPS (filed as follow-up BUGs):
 *   - Raw SQL `JOIN ... ON ...` patterns inside `db.raw()` /
 *     `.whereRaw()` strings — BUG-637-FOLLOWUP-RAW-SQL.
 *   - Multi-condition Knex joins `(j) => j.on(...).andOn(...)` —
 *     BUG-637-FOLLOWUP-MULTI-CONDITION (emitted as WARN today).
 *
 * Exit codes:
 *   0 — every Knex join resolves to a canonical FK relationship
 *   1 — one or more wrong-table joins detected
 *   2 — schema-snapshot.json malformed or missing `foreignKeys`
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { loadAllowlist as loadFingerprintAllowlist, isAllowlisted as isAllowlistedFingerprint, fingerprint as fingerprintLine, getAllowlistedCount, type AllowlistEntry } from './lib/allowlist-fingerprint';

const ROOT = resolve(__dirname, '..', '..');
const SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src');
const ALLOWLIST_PATH = resolve(__dirname, 'check-fk-aware-joins.allowlist');

// FN-2 absorb: documented partition-key allowlist. Joins on these columns
// where neither side is an FK (because tenancy is enforced at the application
// layer + RLS, not via FK constraints) are accepted as canonical.
const PARTITION_KEYS = new Set(['clinic_id', 'tenant_id', 'org_id']);

interface SchemaSnapshot {
  generatedAt: string;
  database: string;
  tables: Record<string, string[]>;
  foreignKeys: Record<string, { foreignTable: string; foreignColumn: string }>;
}

interface Violation {
  file: string;
  lineNo: number;
  joinKind: string;
  joinTarget: string;
  leftRef: string;
  rightRef: string;
  reason: string;
  preview: string;
}

interface ScanCounts {
  validated: number;
  skippedNoSnapshot: number;
  warnedMultiCondition: number;
  unparseable: number;
}

function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      walkTs(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Phase R1 PR-R1-1.5 — line-shift-resilient allowlist via fingerprint helper.
// Fallback to legacy lineno match for backward compatibility during migration.
function loadAllowlist(): AllowlistEntry[] {
  return loadFingerprintAllowlist(ALLOWLIST_PATH);
}

function parseTableAlias(spec: string): { table: string; alias: string } {
  const m = spec.match(/^(\S+)\s+as\s+(\S+)$/i);
  if (m) return { table: m[1], alias: m[2] };
  return { table: spec, alias: spec };
}

function resolveColRef(ref: string, aliases: Map<string, string>): { table: string; column: string } | null {
  const m = ref.match(/^(\w+)\.(\w+)$/);
  if (!m) return null;
  const aliasOrTable = m[1];
  const col = m[2];
  const table = aliases.get(aliasOrTable) || aliasOrTable;
  return { table, column: col };
}

// FN-4 absorb: query-scoped alias resolution. Find the nearest enclosing
// `db(...)`/`dbRead(...)`/`trx(...)`/`.from(...)` opening BEFORE the join
// (within a 3000-char window — covers ~100 lines of typical handler body)
// and scan only that window for aliases. This prevents alias bleed across
// queries that share alias names in the same file.
function findQueryScopedAliases(source: string, joinIndex: number): Map<string, string> {
  const aliases = new Map<string, string>();
  const QUERY_WINDOW = 3000;
  const start = Math.max(0, joinIndex - QUERY_WINDOW);

  // Find the nearest enclosing query opener (`db(`, `dbRead(`, `trx(`,
  // or `.from(`) at or after `start` to anchor the scope.
  const openerRe = /(?:\bdb|\bdbRead|\btrx)\s*\(\s*['"]([^'"]+)['"]|\.from\s*\(\s*['"]([^'"]+)['"]/g;
  openerRe.lastIndex = start;
  let lastOpener = -1;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(source)) !== null) {
    if (m.index >= joinIndex) break;
    lastOpener = m.index;
  }
  // If we found a query-opener within the window, scope from there;
  // otherwise scope from the window start.
  const scopeStart = lastOpener >= 0 ? lastOpener : start;
  const scope = source.slice(scopeStart, joinIndex);

  // Scan the scope for table+alias declarations.
  const tableRe = /(?:\bdb|\bdbRead|\btrx|\.from|\.innerJoin|\.leftJoin|\.rightJoin|\.fullOuterJoin|\.join)\s*\(\s*['"]([^'"]+)['"]/g;
  let mm: RegExpExecArray | null;
  while ((mm = tableRe.exec(scope)) !== null) {
    const { table, alias } = parseTableAlias(mm[1]);
    aliases.set(alias, table);
  }
  return aliases;
}

// FN-3 absorb: detect multi-condition Knex joins so we can WARN per skip
// instead of silently dropping them. Pattern: `.innerJoin('table as alias', (j) => ...)`
// or `.leftJoin('table', function () { this.on(...) })`. Two args; second is
// a function expression, not a string.
function findMultiConditionJoins(source: string, lineOffsets: number[]): Array<{ lineNo: number; preview: string }> {
  const out: Array<{ lineNo: number; preview: string }> = [];
  const re = /\.(innerJoin|leftJoin|rightJoin|fullOuterJoin|join)\s*\(\s*['"][^'"]+['"]\s*,\s*(?:\(|function\s*\()/g;
  const lines = source.split('\n');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    let lineNo = 1;
    for (let i = 0; i < lineOffsets.length - 1; i++) {
      if (match.index >= lineOffsets[i] && match.index < lineOffsets[i + 1]) { lineNo = i + 1; break; }
    }
    if (lineNo > 1 && (lines[lineNo - 2] || '').includes('@fk-join-exempt')) continue;
    out.push({ lineNo, preview: (lines[lineNo - 1] || '').trim().slice(0, 180) });
  }
  return out;
}

function checkFile(
  file: string,
  snapshot: SchemaSnapshot,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  const source = readFileSync(file, 'utf-8');
  const relFile = file.replace(ROOT + '/', '');
  const violations: Violation[] = [];

  const lines = source.split('\n');
  const lineOffsets: number[] = [0];
  for (const ln of lines) lineOffsets.push(lineOffsets[lineOffsets.length - 1] + ln.length + 1);

  // FN-3: count multi-condition joins as WARN (not violation, but visible).
  const multiCond = findMultiConditionJoins(source, lineOffsets);
  for (const _ of multiCond) counts.warnedMultiCondition++;

  // FN-1 absorb: regex now includes `\bjoin\b` (Knex's canonical alias for
  // `.innerJoin()`). The `\b` word boundary prevents matching `.someJoin()`
  // or `.innerJoin()` (the latter is captured by the named alternation).
  // Order in alternation matters for regex engines that don't backtrack
  // optimally — put the longer alternatives first.
  const re = /\.(innerJoin|leftJoin|rightJoin|fullOuterJoin|join)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;

  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    let lineNo = 1;
    for (let i = 0; i < lineOffsets.length - 1; i++) {
      if (match.index >= lineOffsets[i] && match.index < lineOffsets[i + 1]) {
        lineNo = i + 1;
        break;
      }
    }
    if (lineNo > 1 && (lines[lineNo - 2] || '').includes('@fk-join-exempt')) continue;

    const joinKind = match[1];
    const joinTargetSpec = match[2];
    const leftRefRaw = match[3];
    const rightRefRaw = match[4];
    const fullLine = lines[lineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);

    // Match on FULL line content (not truncated preview) so fingerprint
    // is stable across the slice(180) boundary.
    if (isAllowlistedFingerprint(relFile, lineNo, fullLine, allow)) {
      // Multiplicity check (PR-R1-1.5 cycle-2 finding #3): track per-fingerprint
      // bucket; reject if violations exceed allowlisted count.
      const fp = fingerprintLine(fullLine);
      if (fp) {
        const key = `${relFile}|${fp}`;
        violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
        const allowed = getAllowlistedCount(relFile, fp, allow);
        if ((violationBuckets.get(key) || 0) > allowed) {
          // Over-count surplus: report as violation (NOT silently allowlisted).
          violations.push({
            file: relFile, lineNo, joinKind: match[1], joinTarget: parseTableAlias(match[2]).table,
            leftRef: match[3], rightRef: match[4],
            reason: `over-count: ${violationBuckets.get(key)} occurrences vs ${allowed} allowlisted (fingerprint ${fp})`,
            preview,
          });
        }
      }
      continue;
    }

    // FN-4 absorb: query-scoped aliases.
    const aliases = findQueryScopedAliases(source, match.index);
    const { table: joinTarget, alias: joinAlias } = parseTableAlias(joinTargetSpec);
    aliases.set(joinAlias, joinTarget);

    const leftRef = resolveColRef(leftRefRaw, aliases);
    const rightRef = resolveColRef(rightRefRaw, aliases);

    if (!leftRef || !rightRef) {
      counts.unparseable++;
      continue;
    }

    if (!snapshot.tables[leftRef.table] || !snapshot.tables[rightRef.table]) {
      counts.skippedNoSnapshot++;
      continue;
    }

    const leftFk = snapshot.foreignKeys[`${leftRef.table}.${leftRef.column}`];
    const rightFk = snapshot.foreignKeys[`${rightRef.table}.${rightRef.column}`];

    let valid = false;
    if (leftFk && leftFk.foreignTable === rightRef.table && leftFk.foreignColumn === rightRef.column) {
      valid = true;
    } else if (rightFk && rightFk.foreignTable === leftRef.table && rightFk.foreignColumn === leftRef.column) {
      valid = true;
    } else if (
      // FN-2 absorb: same-column-name fallback restricted to documented
      // partition keys. The cycle-1 reviewer correctly identified that the
      // pre-fix branch approved any cross-table PK = PK join (e.g.
      // `staff.id = patients.id`). Now restricted to clinic_id / tenant_id /
      // org_id where neither side has FK because tenancy is enforced at
      // app + RLS layer.
      leftRef.column === rightRef.column &&
      PARTITION_KEYS.has(leftRef.column) &&
      !leftFk &&
      !rightFk
    ) {
      valid = true;
    }

    if (valid) {
      counts.validated++;
    } else {
      violations.push({
        file: relFile,
        lineNo,
        joinKind,
        joinTarget,
        leftRef: `${leftRef.table}.${leftRef.column}`,
        rightRef: `${rightRef.table}.${rightRef.column}`,
        reason: leftFk
          ? `${leftRef.table}.${leftRef.column} → ${leftFk.foreignTable}.${leftFk.foreignColumn} (FK target ≠ join's right side ${rightRef.table}.${rightRef.column})`
          : rightFk
            ? `${rightRef.table}.${rightRef.column} → ${rightFk.foreignTable}.${rightFk.foreignColumn} (FK target ≠ join's left side ${leftRef.table}.${leftRef.column})`
            : leftRef.column === rightRef.column
              ? `same-column-name join ('${leftRef.column}'='${rightRef.column}') but column is not in PARTITION_KEYS allowlist (clinic_id/tenant_id/org_id) AND neither side has FK`
              : `neither column is an FK; columns differ; join shape unrecognised`,
        preview,
      });
    }
  }

  return violations;
}

function main(): void {
  let snapshot: SchemaSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed: ${err}`);
    process.exit(2);
  }
  if (!snapshot.foreignKeys || Object.keys(snapshot.foreignKeys).length === 0) {
    // eslint-disable-next-line no-console
    console.error('✗ schema-snapshot.json missing or empty `foreignKeys` map. Regenerate with `npm run db:snapshot --workspace=apps/api`.');
    process.exit(2);
  }

  const allow = loadAllowlist();
  const files = walkTs(SCAN_ROOT);
  const allViolations: Violation[] = [];
  const counts: ScanCounts = { validated: 0, skippedNoSnapshot: 0, warnedMultiCondition: 0, unparseable: 0 };

  // eslint-disable-next-line no-console
  console.log('→ check-fk-aware-joins (BUG-637)');
  // eslint-disable-next-line no-console
  console.log(`  snapshot:    ${SNAPSHOT_PATH.replace(ROOT + '/', '')}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:   ${ALLOWLIST_PATH.replace(ROOT + '/', '')} (${allow.length} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  scanned:     ${files.length} ts file(s)`);
  // eslint-disable-next-line no-console
  console.log(`  fk metadata: ${Object.keys(snapshot.foreignKeys).length} FKs`);
  // eslint-disable-next-line no-console
  console.log(`  partition:   ${[...PARTITION_KEYS].join(', ')}`);

  // Per-file fingerprint multiplicity tracking (cycle-2 finding #3).
  const violationBuckets = new Map<string, number>();

  for (const file of files) {
    const v = checkFile(file, snapshot, allow, counts, violationBuckets);
    allViolations.push(...v);
  }

  // FN-5 absorb: scan summary so blind spots are auditable.
  // eslint-disable-next-line no-console
  console.log(`\n  validated:                 ${counts.validated}  (3-arg Knex joins resolved against FK or partition key)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped no-snapshot:       ${counts.skippedNoSnapshot}  (alias resolved but table not in snapshot — likely CTE/subquery)`);
  // eslint-disable-next-line no-console
  console.log(`  unparseable col-ref:       ${counts.unparseable}  (col arg not in 'alias.col' form — 2-arg join fallback or raw)`);
  // eslint-disable-next-line no-console
  console.log(`  WARN multi-condition:      ${counts.warnedMultiCondition}  (function-expr joins; tracked as BUG-637-FOLLOWUP-MULTI-CONDITION)`);

  if (allViolations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every 3-arg Knex join resolves to a canonical FK relationship.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${allViolations.length} wrong-table or non-FK join(s) detected:\n`);
  for (const v of allViolations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  ${v.joinKind}('${v.joinTarget}', '${v.leftRef}', '${v.rightRef}')`);
    // eslint-disable-next-line no-console
    console.error(`    reason: ${v.reason}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error('\nFix shape: change the JOIN to use the canonical FK target. If the non-FK join is intentional, add `// @fk-join-exempt: <reason>` on the line directly above OR add `<file>:<lineNo>` to scripts/guards/check-fk-aware-joins.allowlist with a reason comment.');
  process.exit(1);
}

main();
