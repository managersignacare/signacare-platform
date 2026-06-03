// apps/api/src/utils/sanitizeErrForLogging.ts
//
// BUG-267 — Custom pino err serializer.
//
// Problem (pre-fix):
//   PostgreSQL constraint violations embed column values into err.message:
//     23505 unique:    Key (medicare_number)=(2123456789) already exists
//     23505 composite: Key (clinic_id, medicare_number)=(uuid, 2123456789) already exists
//     23503 FK:        Key (patient_id)=(uuid) is not present in table "patients"
//     23514 check:     failing row contains (val1, val2, ..., valN)
//     23502 not-null:  null value in column "family_name" violates not-null constraint
//   pino.stdSerializers.err passes these through verbatim. Any
//   logger.error({ err }) call on a DB-constraint path leaks the
//   offending PHI value to journald. OAIC Notifiable Data Breach
//   reportable.
//
// Solution:
//   Replace pino.stdSerializers.err with this function. Calls the
//   standard serializer first (preserves shape + cause chain), then
//   runs sanitizeString() over message, stack, detail, hint, table,
//   constraint. Three regex anchors match known PG error-message
//   syntax; arbitrary-value regex would over-redact non-PHI and
//   under-redact novel PG formats, so this is conservative by design.
//
// Scope:
//   - Layer 2 of defence in depth. Layer 1 is per-handler
//     err.code === '23xxx' catches + sanitise before logging. Layer 3
//     is redact.paths + redactPhi() (structured-field redaction,
//     BUG-216). This module sits between handler code and pino —
//     catches ALL logger.{error,warn}({ err }) paths without
//     per-call-site change.
//   - Non-pino log paths (console.error, stderr.write) → BUG-312.
//   - Third-party loggers (knex debug, pg driver) → BUG-313.
//
// Performance:
//   - Runs only on error-logging paths. No hot-path impact.
//   - All regexes non-greedy + bounded by `)` → ReDoS-safe.
//   - ≤3 passes per error, linear in message length.
//   - Returns a sanitised COPY. err is never mutated.

import pino from 'pino';
// Import from the leaf module to avoid a logger.ts ↔ sanitizeErrForLogging.ts
// circular. BUG-267 L5 architectural absorption.
import { PHI_FIELDS } from './phiFields';

const KEY_VALUE_RE = /Key \(([^)]+)\)=\((.*?)\)/g;
const FAILING_ROW_RE = /Failing row contains \((.*?)\)/g;

/**
 * Pure-function string sanitiser. Applied to message, stack, detail,
 * hint, table, constraint. Exported for unit testing — the unit tests
 * call this directly rather than building synthetic Error objects.
 */
export function sanitizeString(input: string): string {
  if (!input) return input;

  let out = input.replace(KEY_VALUE_RE, (whole, colsRaw: string, _valBlock: string) => {
    // Handle both single-column `col` and composite `c1, c2` captures.
    const cols = colsRaw.split(/,\s*/).map((c) => c.trim().toLowerCase());
    const anyPhi = cols.some((c) => PHI_FIELDS.has(c));
    if (!anyPhi) return whole;
    // Preserve column names (ops-useful), redact the value block.
    return `Key (${colsRaw})=([REDACTED — PHI column])`;
  });

  out = out.replace(FAILING_ROW_RE, 'Failing row contains ([REDACTED — failing-row PHI])');

  // Not-null column references (`column "family_name"`) are preserved
  // as-is. The column name without value is ops-useful and not PHI.

  return out;
}

/**
 * Custom pino err serializer. Wire into logger.ts serializers.err.
 * Returns a sanitised copy; never mutates err.
 */
export function sanitizeErrForLogging(err: Error): Record<string, unknown> {
  const base = pino.stdSerializers.err(err) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const key of ['message', 'stack', 'detail', 'hint', 'table', 'constraint']) {
    const v = out[key];
    if (typeof v === 'string') out[key] = sanitizeString(v);
  }
  return out;
}
