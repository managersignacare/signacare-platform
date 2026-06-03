/**
 * CI guard: every mutation method on `clinicalNoteService` MUST call
 * `writeAuditLog(` in its body.
 *
 * BUG-369 — HIPAA §164.312(b) forensic audit trail. `clinical_note_versions`
 * is the restore/undo ledger; `audit_log` is the SEPARATE forensic trail.
 * A clinical-incident investigation must be able to answer "who edited
 * note N, when, from where" — that's audit_log, not versions.
 *
 * The 5 mutation methods today are: create, update, sign, amend, softDelete.
 * A future mutation method (e.g. `lock`, `unsign`, `redact`) must carry the
 * same audit discipline. This guard scans the service file and asserts
 * every top-level `async <name>(auth: AuthContext, ...)` method body
 * contains at least one `writeAuditLog(` call, UNLESS the method is a
 * read-only accessor (listByPatient / getById / findById / list / get).
 *
 * Exit code:
 *   0 — every mutation method has a writeAuditLog call
 *   1 — at least one mutation method is missing the audit call
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SERVICE_FILE = resolve(
  __dirname,
  '..',
  '..',
  'apps',
  'api',
  'src',
  'features',
  'clinical-notes',
  'clinicalNote.service.ts',
);

// Read-only method name prefixes — these do NOT require audit rows.
const READ_PREFIXES = ['listBy', 'list', 'getBy', 'get', 'findBy', 'find'];

function isReadOnlyMethod(name: string): boolean {
  return READ_PREFIXES.some((p) => name.startsWith(p));
}

function main(): number {
  let src: string;
  try {
    src = readFileSync(SERVICE_FILE, 'utf-8');
  } catch (err) {
    console.error(`check-clinical-note-audit-log: cannot read ${SERVICE_FILE}: ${(err as Error).message}`);
    return 1;
  }

  // Match `async <name>(` at any indentation inside the clinicalNoteService
  // object literal. Capture the name + the index so we can slice each body.
  const methodRe = /^\s{2,4}async\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  const methods: Array<{ name: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(src)) !== null) {
    methods.push({ name: m[1], start: m.index });
  }

  if (methods.length === 0) {
    console.error('check-clinical-note-audit-log: no async methods found in clinicalNoteService — service file may have been renamed or refactored');
    return 1;
  }

  // For each method, take the slice from its start to the next method's
  // start (or end of file) and check for writeAuditLog.
  const violations: string[] = [];
  for (let i = 0; i < methods.length; i += 1) {
    const { name, start } = methods[i];
    if (isReadOnlyMethod(name)) continue;
    const end = i + 1 < methods.length ? methods[i + 1].start : src.length;
    const body = src.slice(start, end);
    if (!/writeAuditLog\s*\(/.test(body)) {
      violations.push(name);
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-clinical-note-audit-log: every mutation method on clinicalNoteService calls writeAuditLog (${methods.length - methods.filter((x) => isReadOnlyMethod(x.name)).length} mutation method(s) audited)`,
    );
    return 0;
  }

  console.error(`check-clinical-note-audit-log: ${violations.length} mutation method(s) missing writeAuditLog:`);
  for (const v of violations) console.error(`  - clinicalNoteService.${v}`);
  console.error('');
  console.error('HIPAA §164.312(b) requires a forensic audit trail for every clinical-note mutation.');
  console.error('Add `await writeAuditLog({ clinicId, actorId, tableName: "clinical_notes", recordId, action, ... })` after the repository write succeeds.');
  return 1;
}

process.exit(main());
