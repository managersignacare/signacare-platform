/**
 * CI guard: every Knex query on a multi-tenant table (one that has a
 * `clinic_id` column per schema-snapshot.json) that filters by
 * `patient_id` MUST also filter by `clinic_id`. RLS is the second layer
 * of tenant isolation; the app-layer `.where(...)` is the first per
 * CLAUDE.md §1.3. An RLS-disabled maintenance / debug / migration path
 * would leak cross-clinic data without the app-layer filter.
 *
 * BUG-368 introduced this guard after 5 endpoints in patientRoutes.ts
 * were found filtering by patient_id only. A future regression must be
 * caught at merge time, not by audit.
 *
 * Data source: apps/api/src/db/schema-snapshot.json — SSoT for which
 * tables are multi-tenant.
 *
 * What the guard detects (patterns):
 *   - db('<table>').where({ patient_id: ... })           — no clinic_id
 *   - db('<table>').where('<table>.patient_id', ...)     — no clinic_id
 *   - dbAdmin('<table>').where({ patient_id: ... })      — same
 *   - trx('<table>').where({ patient_id: ... })          — same
 *
 * What the guard accepts:
 *   - the same pattern WITH clinic_id in the `where` object or as a
 *     subsequent `.where('<col>', ...)` chain link within the same
 *     statement (up to ~8 lines after the call).
 *   - Functions whose name ends in `Admin` — deliberate admin paths
 *     (those ARE still recommended to have clinic_id but the guard
 *     doesn't gate them — too many false positives on legitimate
 *     background-job uses).
 *   - Lines annotated with `// @clinic-id-exempt: <reason>` on the
 *     preceding or same line (for legitimate cross-tenant SUPERADMIN
 *     code paths; must include a justification).
 *
 * Exit code:
 *   0 — no violations
 *   1 — at least one violation; prints file:line + table + snippet
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readdirSync, statSync } from 'fs';

interface SchemaSnapshot {
  generatedAt: string;
  tables: Record<string, string[] | Record<string, unknown>>;
}

const SNAPSHOT_PATH = resolve(
  __dirname,
  '..',
  '..',
  'apps',
  'api',
  'src',
  'db',
  'schema-snapshot.json',
);
const SCAN_ROOT = resolve(__dirname, '..', '..', 'apps', 'api', 'src', 'features');
const ALLOWLIST_PATH = resolve(__dirname, 'check-query-has-clinic-id.allowlist.txt');

function readSnapshot(): SchemaSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SchemaSnapshot;
}

// Each allowlist entry is `file:line # BUG-<N> [note]`. The BUG-ID must be
// present — an allowlist entry without a BUG reference is rejected so the
// allowlist cannot be used to silently grow. When the referenced BUG closes,
// the entry is removed in the same commit.
function readAllowlist(): Set<string> {
  const result = new Set<string>();
  try {
    const raw = readFileSync(ALLOWLIST_PATH, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^(\S+?:\d+)\s*#\s*(BUG-[A-Za-z0-9-]+)/);
      if (!match) {
        throw new Error(
          `Allowlist entry missing BUG-<N> reference: "${trimmed}". ` +
            'Every allowlisted file:line must cite a catalogued BUG.',
        );
      }
      result.add(match[1]);
    }
  } catch (err) {
    // It is OK for the allowlist file to not exist (empty allowlist).
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  return result;
}

// Returns the set of table names that have a `clinic_id` column.
function multiTenantTables(snapshot: SchemaSnapshot): Set<string> {
  const result = new Set<string>();
  for (const [name, cols] of Object.entries(snapshot.tables)) {
    const colArray = Array.isArray(cols) ? cols : Object.keys(cols);
    if (colArray.includes('clinic_id')) {
      result.add(name);
    }
  }
  return result;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__mocks__') continue;
      walkTs(full, out);
    } else if (
      st.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  lineNo: number;
  table: string;
  snippet: string;
}

function scanFile(
  path: string,
  mtTables: Set<string>,
  violations: Violation[],
): void {
  const src = readFileSync(path, 'utf-8');
  const lines = src.split('\n');

  // Identify functions whose name ends in 'Admin' so we can skip queries inside them.
  // Simple bracket-depth tracking; good enough for the repo's style.
  const adminSpans: Array<[number, number]> = []; // [startLine, endLine] 0-based
  let currentFnStart: number | null = null;
  let currentFnIsAdmin = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fnMatch = line.match(
      /(?:async\s+function|function|const|let|var)\s+([A-Za-z0-9_]+)\s*(?:=\s*(?:async\s*)?\([^)]*\)|\([^)]*\))/,
    );
    if (fnMatch && depth === 0) {
      const name = fnMatch[1];
      currentFnStart = i;
      currentFnIsAdmin = /Admin$/.test(name);
    }
    // Count brace depth
    for (const ch of line) {
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0 && currentFnStart !== null) {
          if (currentFnIsAdmin) adminSpans.push([currentFnStart, i]);
          currentFnStart = null;
          currentFnIsAdmin = false;
        }
      }
    }
  }

  const inAdmin = (ln: number) => adminSpans.some(([s, e]) => ln >= s && ln <= e);

  // Scan for db/dbAdmin/trx('<table>') calls referencing a multi-tenant table.
  const callRe = /\b(db|dbAdmin|trx)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\)/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(callRe);
    if (!m) continue;
    const table = m[2];
    if (!mtTables.has(table)) continue;
    if (inAdmin(i)) continue;

    // Look at up to 8 lines from this line forward to form the statement window.
    const windowEnd = Math.min(lines.length, i + 8);
    const windowText = lines.slice(i, windowEnd).join('\n');

    // The statement must touch patient_id to be a candidate.
    if (!/patient_id/.test(windowText)) continue;

    // Exempt if annotated.
    const prevLine = i > 0 ? lines[i - 1] : '';
    if (/@clinic-id-exempt:/.test(prevLine) || /@clinic-id-exempt:/.test(line)) continue;

    // Accept if clinic_id appears in the same window.
    if (/clinic_id/.test(windowText)) continue;

    violations.push({
      file: path,
      lineNo: i + 1,
      table,
      snippet: line.trim().slice(0, 140),
    });
  }
}

function main(): number {
  const snapshot = readSnapshot();
  const mtTables = multiTenantTables(snapshot);
  const allowlist = readAllowlist();
  const repoRoot = resolve(__dirname, '..', '..');
  const files = walkTs(SCAN_ROOT);
  const raw: Violation[] = [];
  for (const f of files) {
    scanFile(f, mtTables, raw);
  }
  // Partition into unblocked violations (fail) vs allowlisted (pass through).
  const violations: Violation[] = [];
  let allowlisted = 0;
  for (const v of raw) {
    const rel = v.file.replace(`${repoRoot}/`, '');
    const key = `${rel}:${v.lineNo}`;
    if (allowlist.has(key)) {
      allowlisted += 1;
    } else {
      violations.push(v);
    }
  }

  // Enforce: every allowlist entry must correspond to an actual violation
  // right now. Stale entries (entries that no longer match any violation —
  // maybe the code shifted or the query was fixed) clutter the allowlist
  // and erode its meaning. A stale entry is a FAIL so the engineer prunes.
  const liveEntries = new Set<string>();
  for (const v of raw) {
    const rel = v.file.replace(`${repoRoot}/`, '');
    liveEntries.add(`${rel}:${v.lineNo}`);
  }
  const stale = [...allowlist].filter((k) => !liveEntries.has(k));
  if (stale.length > 0) {
    console.error(
      `check-query-has-clinic-id: ${stale.length} stale allowlist entr${stale.length === 1 ? 'y' : 'ies'} (no longer matches a violation):`,
    );
    for (const s of stale) console.error(`  ${s}`);
    console.error(
      'Prune the stale entries from scripts/guards/check-query-has-clinic-id.allowlist.txt.',
    );
    return 1;
  }

  if (violations.length === 0) {
    console.log(
      `check-query-has-clinic-id: no new violations (${mtTables.size} multi-tenant tables tracked, ${allowlisted} allowlisted backlog entr${allowlisted === 1 ? 'y' : 'ies'} deferred to BUG-430)`,
    );
    return 0;
  }

  console.error(`check-query-has-clinic-id: ${violations.length} violation(s)`);
  console.error('');
  console.error(
    'Each of these Knex queries touches a multi-tenant table AND filters by patient_id but does NOT include clinic_id.',
  );
  console.error(
    'CLAUDE.md §1.3: every query on patient/clinical data MUST include `clinic_id: req.clinicId` in the WHERE clause.',
  );
  console.error('');
  for (const v of violations) {
    const rel = v.file.replace(resolve(__dirname, '..', '..') + '/', '');
    console.error(`  ${rel}:${v.lineNo}  [${v.table}]`);
    console.error(`    ${v.snippet}`);
  }
  console.error('');
  console.error(
    'To fix: add `clinic_id: req.clinicId` to the `.where({...})` object or as a chained `.where(...)` call.',
  );
  console.error(
    'For intentional cross-tenant SUPERADMIN paths, annotate the preceding line with `// @clinic-id-exempt: <reason>`.',
  );
  return 1;
}

process.exit(main());
