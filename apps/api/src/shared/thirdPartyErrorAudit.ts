// apps/api/src/shared/thirdPartyErrorAudit.ts
//
// BUG-313 — Third-party logger PHI audit.
//
// Goal:
// - Ensure knex/pg driver/BullMQ-adjacent error paths flow through pino
//   with `err` objects (so BUG-267 sanitizer runs), not raw err.message.
// - Provide one shared, idempotent hook installer for DB-layer
//   third-party emitters.

import type { Knex } from 'knex';
import { logger } from '../utils/logger';

type PoolRole = 'app_user' | 'read_replica' | 'admin';

type PgLikeConnection = {
  on?: (event: 'error', handler: (err: unknown) => void) => unknown;
};

type KnexQueryPayload = {
  __knexUid?: unknown;
  __knexQueryUid?: unknown;
  __knexTxId?: unknown;
  method?: unknown;
  sql?: unknown;
};

const KNEX_QUERY_ERROR_AUDIT_MARK = Symbol('signacare.knexQueryErrorAuditInstalled');
const PG_CLIENT_ERROR_AUDIT_MARK = Symbol('signacare.pgClientErrorAuditInstalled');

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}

function deriveSqlVerb(sql: unknown, method: unknown): string | undefined {
  const methodValue = asNonEmptyString(method);
  if (methodValue) return methodValue.toUpperCase();

  const sqlValue = asNonEmptyString(sql);
  if (!sqlValue) return undefined;
  const firstToken = sqlValue.trim().split(/\s+/)[0] ?? '';
  const normalized = firstToken.replace(/[^A-Za-z_]/g, '').toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

function summarizeKnexQueryPayload(payload: KnexQueryPayload | undefined): Record<string, unknown> {
  return {
    connectionUid: asNonEmptyString(payload?.__knexUid),
    queryUid: asNonEmptyString(payload?.__knexQueryUid),
    txUid: asNonEmptyString(payload?.__knexTxId),
    sqlVerb: deriveSqlVerb(payload?.sql, payload?.method),
  };
}

/**
 * Register fail-visible, pino-serialized query-error logging for a knex
 * instance. Idempotent per instance.
 */
export function registerKnexQueryErrorAudit(knexDb: Knex, poolRole: PoolRole): void {
  const markerTarget = knexDb as unknown as Record<string | symbol, unknown>;
  if (markerTarget[KNEX_QUERY_ERROR_AUDIT_MARK] === true) return;
  markerTarget[KNEX_QUERY_ERROR_AUDIT_MARK] = true;

  knexDb.on('query-error', (err: unknown, payload: unknown) => {
    const meta = summarizeKnexQueryPayload(payload as KnexQueryPayload | undefined);
    logger.error(
      {
        kind: 'third_party_knex_query_error',
        poolRole,
        ...meta,
        err: toError(err),
      },
      'Knex query error surfaced through third-party audit path',
    );
  });
}

/**
 * Register fail-visible, pino-serialized pg client-level error logging on
 * individual pool connections. Idempotent per connection.
 */
export function registerPgClientErrorAudit(conn: PgLikeConnection, poolRole: PoolRole): void {
  const markerTarget = conn as unknown as Record<string | symbol, unknown>;
  if (markerTarget[PG_CLIENT_ERROR_AUDIT_MARK] === true) return;
  markerTarget[PG_CLIENT_ERROR_AUDIT_MARK] = true;

  if (typeof conn.on !== 'function') return;
  conn.on('error', (err: unknown) => {
    logger.error(
      {
        kind: 'third_party_pg_client_error',
        poolRole,
        err: toError(err),
      },
      'Postgres client emitted an error event',
    );
  });
}

