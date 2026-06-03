// apps/api/src/utils/logger.ts
import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { readFileSync } from 'fs';
import { join } from 'path';
// PHI taxonomy + redactPhi moved to utils/phiFields.ts (BUG-267 L5
// absorption — breaks the logger ↔ sanitizeErrForLogging circular).
import { PHI_FIELDS, redactPhi } from './phiFields';
import { sanitizeErrForLogging } from './sanitizeErrForLogging';

// Backward-compat re-exports for existing callers
// (pipelineTracker, recordLlmInteraction, loggerRedaction.test).
// New code should import directly from './phiFields'.
export {
  PHI_FIELDS,
  redactPhi,
  PHI_CATEGORY_NAMES,
  PHI_CATEGORY_BIRTH,
  PHI_CATEGORY_MEDICARE_IHI_DVA,
  PHI_CATEGORY_BLIND_INDEX,
  PHI_CATEGORY_AU_IDENTIFIERS,
  PHI_CATEGORY_HEALTH_FUND,
  PHI_CATEGORY_PHONE,
  PHI_CATEGORY_EMAIL,
  PHI_CATEGORY_ADDRESS,
  PHI_CATEGORY_CLINICAL_NARRATIVE,
  PHI_CATEGORY_AUTH_SECRETS,
} from './phiFields';

const loggerDestination = pino.destination({ sync: false });

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
    log(obj) {
      // S2.2: inject the active OpenTelemetry trace_id and span_id so
      // every log line can be correlated to a span in Tempo/Jaeger.
      // When the OTel SDK is not initialised (no OTEL_EXPORTER env),
      // getActiveSpan() returns undefined and we add nothing.
      const span = trace.getActiveSpan();
      const ctx = span?.spanContext();
      const enriched =
        ctx && ctx.traceId && ctx.traceId !== '0'.repeat(32)
          ? { ...obj, trace_id: ctx.traceId, span_id: ctx.spanId }
          : obj;
      return redactPhi(enriched as Record<string, unknown>);
    },
  },
  redact: {
    // BUG-216 — pino built-in redactor (C-level, fast path) for known
    // request-body and credential shapes. Nested PHI at arbitrary depth
    // is handled by redactPhi in formatters.log above; these paths are
    // the fast-path overlay for common HTTP request shapes.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.mfaSecret',
      'req.body.password',
      'req.body.mfaSecret',
      'req.body.email',
      'req.body.phone',
      '*.password',
      '*.password_hash',
      '*.passwordHash',
      '*.mfa_secret',
      '*.mfaSecret',
    ],
    censor: '[REDACTED]',
  },
  base: {
    service: 'signacare-api',
    env: process.env.NODE_ENV ?? 'development',
  },
  serializers: {
    // BUG-267 — custom err serializer redacts PHI values from PG
    // constraint-violation messages (Key (col)=(val), Failing row
    // contains (...)) before pino serialises. stdSerializers.err is
    // called internally to preserve shape + cause chain.
    err: sanitizeErrForLogging,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
}, loggerDestination);

/**
 * BUG-306 — synchronous logger flush for shutdown durability.
 *
 * Returns true when flushSync existed and was executed; false when the
 * destination does not expose flushSync (best-effort fallback case).
 */
export function flushLoggerSync(
  destination: { flushSync?: (() => void) | undefined } = loggerDestination,
): boolean {
  if (typeof destination.flushSync !== 'function') return false;
  destination.flushSync();
  return true;
}

// ── Boot-time schema drift check (BUG-216 L5 item 1) ─────────────────────────
/**
 * On boot, scan apps/api/src/db/schema-snapshot.json for columns whose
 * names match known-PHI regex patterns and are NOT in PHI_FIELDS. Emit
 * a WARN listing any unmatched columns. Fail-loud per CLAUDE.md §3.6
 * (Fail Fast, Fail Loud) — the next developer finds out in 1 log line
 * on deploy, not at the next audit.
 *
 * Does not throw; warning only. Silent success in NODE_ENV=test to
 * avoid noise when the snapshot isn't available.
 */
function checkSchemaPhiDrift(): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const snapshotPath = join(__dirname, '..', 'db', 'schema-snapshot.json');
    const raw = readFileSync(snapshotPath, 'utf8');
    const snap = JSON.parse(raw) as { tables?: Record<string, string[]> };
    const tables = snap.tables ?? {};
    const columns = new Set<string>();
    for (const cols of Object.values(tables)) {
      for (const c of cols) columns.add(c);
    }
    // PHI-suspect regex: any column name containing these sub-strings
    // is a candidate PHI field. BUG-267 L4 absorption — added
    // `lookup` and `blind_index` so composite blind-index columns
    // (medicare_number_lookup etc.) are surfaced if they drift out of
    // PHI_CATEGORY_BLIND_INDEX.
    const phiRegex = /(?:phone|email|address|medicare|ihi\b|hpii|dva|ndis|prescriber|dob|given|family|preferred|nok|pbs|narrative|complaint|diagnosis|lookup|blind_?index)/i;
    const suspects: string[] = [];
    for (const col of columns) {
      if (phiRegex.test(col) && !PHI_FIELDS.has(col)) {
        suspects.push(col);
      }
    }
    if (suspects.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[BUG-216 drift] PHI-regex columns not in PHI_FIELDS ' +
          `(${suspects.length}): ${suspects.sort().slice(0, 30).join(', ')}` +
          (suspects.length > 30 ? `, ... +${suspects.length - 30}` : '') +
          '. Review each: add to the matching PHI_CATEGORY_* array if PHI, ' +
          'or document as non-PHI via an exception rule (BUG-269 guard).',
      );
    }
  } catch {
    // Snapshot unreadable — not fatal. Integration environments without
    // the snapshot (e.g. production container builds) skip silently.
  }
}
checkSchemaPhiDrift();

// ── Structured audit helper (non-PHI fields only) ────────────────────────────

export interface AuditLogFields {
  requestId?: string;
  userId?: string;
  clinicId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  durationMs?: number;
  statusCode?: number;
  method?: string;
  path?: string;
}

export function auditLog(fields: AuditLogFields): void {
  logger.info({ ...fields, type: 'audit' });
}

export default logger;
