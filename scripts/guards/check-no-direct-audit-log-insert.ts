/**
 * CI guard: no direct `db('audit_log').insert(...)` or
 * `dbAdmin('audit_log').insert(...)` outside the two legitimate writer
 * paths (`apps/api/src/utils/audit.ts` + `apps/api/src/shared/auditOutbox.ts`).
 *
 * BUG-467 — F-audit-action-union (Wave 6b) found 10 bypass call sites
 * across 5 files that wrote to audit_log directly, skipping the typed
 * `writeAuditLog` wrapper. Consequences:
 *   - Action literals were strings, not union members — typos silent
 *   - No dual-write safety (BUG-283 Redis outbox bypassed)
 *   - No eventTime stamp (BUG-283 chronology absorb bypassed)
 *   - No legacy-column compatibility fallback
 *
 * Exit code:
 *   0 — no bypass call sites found
 *   1 — at least one bypass; prints file:line + snippet
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const SCAN_ROOT = resolve(__dirname, '..', '..', 'apps', 'api', 'src');

// Files that LEGITIMATELY call db/dbAdmin('audit_log').insert — the
// two canonical writer paths. Every other file must route through
// writeAuditLog.
const ALLOWED_PATHS = new Set<string>([
  resolve(SCAN_ROOT, 'utils', 'audit.ts'),
  resolve(SCAN_ROOT, 'shared', 'auditOutbox.ts'),
]);

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
  snippet: string;
}

// L3-absorb 2026-04-24: the original regex covered `db` + `dbAdmin`
// only and MISSED a `trx('audit_log').insert` call in duplicateRoutes.ts.
// Extended to include `trx(...)` — any Knex connection handle can
// write to audit_log, so the bypass shape must include all three.
const BYPASS_RE = /\b(?:db|dbAdmin|trx)\s*\(\s*['"]audit_log['"]\s*\)\s*\.\s*insert\b/;

function scanFile(path: string, violations: Violation[]): void {
  if (ALLOWED_PATHS.has(path)) return;
  const lines = readFileSync(path, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Skip comments — BUG-467 migration annotations reference the old
    // pattern in prose without being actual code.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (BYPASS_RE.test(line)) {
      violations.push({
        file: path,
        lineNo: i + 1,
        snippet: trimmed.slice(0, 140),
      });
    }
  }
}

function main(): number {
  const files = walkTs(SCAN_ROOT);
  const violations: Violation[] = [];
  for (const f of files) scanFile(f, violations);

  if (violations.length === 0) {
    console.log(
      `check-no-direct-audit-log-insert: no direct audit_log.insert() bypass across ${files.length} files (${ALLOWED_PATHS.size} allowed canonical writers)`,
    );
    return 0;
  }

  console.error(
    `check-no-direct-audit-log-insert: ${violations.length} direct audit_log.insert() bypass call site(s)`,
  );
  console.error('');
  console.error(
    'audit_log writes MUST go through `writeAuditLog` from `apps/api/src/utils/audit.ts`.',
  );
  console.error(
    'The direct path bypasses (a) the typed AuditAction union, (b) BUG-283 Redis outbox recovery, (c) BUG-283 eventTime chronology, (d) legacy-column compatibility.',
  );
  console.error('');
  const repoRoot = resolve(__dirname, '..', '..');
  for (const v of violations) {
    const rel = v.file.replace(`${repoRoot}/`, '');
    console.error(`  ${rel}:${v.lineNo}`);
    console.error(`    ${v.snippet}`);
  }
  console.error('');
  console.error(
    'To fix: replace the direct insert with `await writeAuditLog({ clinicId, actorId, tableName, recordId, action, newData? })`. If the action literal is new, add it to the AuditAction union in audit.ts first.',
  );
  return 1;
}

process.exit(main());
