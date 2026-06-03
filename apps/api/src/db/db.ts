// apps/api/src/db/db.ts
//
// Dual-role database layer:
//   db       — app_user connection (RLS-enforced via AsyncLocalStorage proxy)
//   dbAdmin  — signacare/owner connection (bypasses RLS, used for startup checks)
//   dbRead   — read replica (falls back to app_user pool when no replica configured)
//
// How it works:
//   1. rlsMiddleware wraps each authenticated request in a transaction
//   2. SET LOCAL app.clinic_id is called inside that transaction
//   3. The transaction is stored in AsyncLocalStorage (rlsStore)
//   4. The `db` export is a Proxy that transparently delegates to the
//      request-scoped transaction when one exists, or falls back to the
//      raw pool for non-request contexts (startup, background jobs)
//
// RLS enforcement posture:
//   - tenant tables are expected to run with FORCE ROW LEVEL SECURITY.
//   - owner-role runtime bypass is prohibited in production posture.
//   - dbAdmin calls made inside request-scoped transactions are routed
//     through the request transaction to preserve tenant scope.

import { AsyncLocalStorage } from "async_hooks";
import knex, { Knex } from "knex";
import pgTypes from "pg-types";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  registerKnexQueryErrorAudit,
  registerPgClientErrorAudit,
} from "../shared/thirdPartyErrorAudit";

// ── pg type parser overrides ────────────────────────────────────────────────
//
// Postgres DATE columns (type OID 1082) default to being parsed into a
// JavaScript Date at local-time midnight. `.toISOString()` on that Date
// then shifts the value back one day in any west-of-UTC environment,
// which broke every specialty that stores a plain date (obstetrics
// lmp_date / edd_date, surgical_cases planned_date, antenatal_visits
// visit_date, appointments planned dates, …). Users reported it as
// "I saved a pregnancy with LMP 2026-01-01 and it shows 2025-12-31".
//
// Override the parser to return DATE columns as raw strings ('YYYY-MM-
// DD') end-to-end. Every service layer's toDateOnly() helper already
// slices(0, 10), and string values pass through that unchanged. This
// is the gold-standard single-point fix — no per-column Date-object
// juggling, no per-migration timezone dance, applies uniformly to
// every table in the schema.
//
// OID 1082 = date
// OID 1182 = _date (date array — future flowsheet columns). The pg-types
// TypeId union only lists scalar OIDs; _date isn't in it, so we cast.
pgTypes.setTypeParser(1082, (v: string | null) => v);
pgTypes.setTypeParser(1182 as unknown as pgTypes.TypeId, (v: string | null) => v);

// ── AsyncLocalStorage for request-scoped transactions ───────────────────────
export const rlsStore = new AsyncLocalStorage<Knex.Transaction>();

// ── SSL config ──────────────────────────────────────────────────────────────
const sslConfig = config.database.ssl
  ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" } }
  : {};

// Pool sizing: behind PgBouncer, each worker needs fewer connections
// because PgBouncer multiplexes. With N workers × 20 connections per
// worker → PgBouncer maps to the Azure PG Flexible Server backend
// (max_connections=859 on D2s_v3, ~730 usable after superuser /
// autovacuum reserve). Direct-connection default (50) is dev-only —
// Azure production MUST route through PgBouncer per
// docs/plans/azure-staging-deployment.md §2.2.
//
// BUG-366b — the PgBouncer-branch default was 5; bumped to 20 so
// Playwright-load bursts (BUG-264 reproduction) don't exhaust the
// per-worker slice. With 4 workers × 20 = 80 client-side connections,
// PgBouncer still comfortably fits the 730-usable backend budget.
const isPgBouncer = Boolean(process.env.PGBOUNCER_HOST || (config.database.port === 6432));
const poolMax = config.database.poolMax
  ?? parseInt(process.env.DB_POOL_MAX ?? (isPgBouncer ? "20" : "50"), 10);
const poolMin = parseInt(process.env.DB_POOL_MIN ?? (isPgBouncer ? "2" : "5"), 10);
const adminPoolMax = 5;
const replicaPoolMax = parseInt(process.env.DB_REPLICA_POOL_MAX ?? "30", 10);

// BUG-187 / BUG-264 / BUG-366b: connection-level guardrails applied on
// every new app_user connection in BOTH primary (appPool) and read-
// replica (rawDbRead) pools.
//
//   statement_timeout = '30s'
//     Any individual query that stalls is cancelled by Postgres after
//     30s, releasing the connection back to the pool. rlsMiddleware
//     already applies SET LOCAL statement_timeout = '30s' per-request,
//     so request-path queries are protected at both layers; this
//     connection-level setting extends protection to non-request
//     contexts (schedulers, background jobs) that the middleware skips.
//
//   idle_in_transaction_session_timeout = '60s'
//     If a transaction is ever orphaned (opened but never committed or
//     rolled back), Postgres will terminate the connection after 60s,
//     releasing the backend. Guards against edge cases in the
//     rlsMiddleware promise lifecycle where res.on('finish') or
//     res.on('close') fail to settle under atypical response paths.
//
//   lock_timeout = '5s'
//     Any query waiting longer than 5s to acquire a row or table lock
//     fails with 55P03 lock_not_available instead of blocking the
//     connection indefinitely. Protects against deadlock-prone
//     workloads under load (e.g. concurrent UPDATE of the same row,
//     schema-change lock waits). Chosen to be shorter than
//     statement_timeout so a lock-wait failure surfaces as a distinct
//     error class rather than being masked by the outer statement
//     cancellation.
//
// Follow-up scope (see docs/archive/audit-2026-04-19/follow-up-on-cloud-deploy.md):
// these guardrails BOUND the damage from the originally observed 21h
// pool-drain symptom and the BUG-264 Playwright-load pool exhaustion;
// the three-timeout triple + the SSE route isolation in rlsMiddleware
// (which skips `/events` paths) is the accepted pattern.
type PgConnectionForAfterCreate = {
  query: (sql: string, cb: (err: Error | null) => void) => void;
  on?: (event: "error", handler: (err: unknown) => void) => unknown;
};

const makeAppUserAfterCreate = (poolRole: "app_user" | "read_replica") => (
  conn: PgConnectionForAfterCreate,
  done: (err: Error | null, conn: unknown) => void,
): void => {
  registerPgClientErrorAudit(conn, poolRole);
  conn.query(
    "SET statement_timeout = '30s'; SET idle_in_transaction_session_timeout = '60s'; SET lock_timeout = '5s'; SELECT 1",
    (err: Error | null) => {
      if (err) {
        logger.error(
          { err, kind: "db_connection_init_failed", poolRole },
          "DB app_user connection init failed",
        );
      }
      done(err, conn);
    },
  );
};

const appUserAfterCreate = makeAppUserAfterCreate("app_user");
const readReplicaAfterCreate = makeAppUserAfterCreate("read_replica");

const adminAfterCreate = (
  conn: PgConnectionForAfterCreate,
  done: (err: Error | null, conn: unknown) => void,
): void => {
  registerPgClientErrorAudit(conn, "admin");
  if (process.env.NODE_ENV === "test") {
    // Integration suites frequently seed tenant rows via dbAdmin(...) in
    // beforeAll hooks. With FORCE RLS enabled, those writes require an
    // app.clinic_id context even on owner-role connections.
    const fallbackClinicId = "11111111-1111-1111-1111-111111111111";
    const requestedClinicId = process.env.TEST_DEFAULT_CLINIC_ID?.trim();
    const clinicId = /^[0-9a-fA-F-]{36}$/.test(requestedClinicId ?? "")
      ? (requestedClinicId as string)
      : fallbackClinicId;
    const safeClinicId = clinicId.replace(/'/g, "");
    conn.query(
      `SELECT set_config('app.clinic_id', '${safeClinicId}', false); SELECT 1`,
      (err: Error | null) => done(err, conn),
    );
    return;
  }
  done(null, conn);
};

// ── App pool (app_user — subject to RLS) ────────────────────────────────────
const appPool = knex({
  client: "pg",
  connection: {
    host: config.database.host,
    port: config.database.port,
    user: config.database.appUser,
    password: config.database.appPassword,
    database: config.database.database,
    ...sslConfig,
  },
  pool: {
    min: poolMin,
    max: poolMax,
    acquireTimeoutMillis: 60_000,
    createTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    reapIntervalMillis: 5_000,
    propagateCreateError: false,
    afterCreate: appUserAfterCreate,
  },
  migrations: { tableName: "knex_migrations" },
});
registerKnexQueryErrorAudit(appPool, "app_user");

// ── Admin pool (owner role; routed through request trx when available) ────────
const adminPool = knex({
  client: "pg",
  connection: {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    ...sslConfig,
  },
  pool: {
    min: 1,
    max: adminPoolMax,
    acquireTimeoutMillis: 30_000,
    idleTimeoutMillis: 60_000,
    afterCreate: adminAfterCreate,
  },
});
registerKnexQueryErrorAudit(adminPool, "admin");

/** Raw admin pool — use sparingly for startup checks and privileged
 *  maintenance paths that cannot run under tenant-scoped app_user. */
export const adminPoolRaw = adminPool;

const adminProxyHandler: ProxyHandler<typeof adminPool> = {
  apply(_target, _thisArg, args) {
    const trx = rlsStore.getStore();
    return trx ? (trx as unknown as KnexCallable)(...args) : (adminPool as unknown as KnexCallable)(...args);
  },
  get(target, prop, receiver) {
    if (prop === "client" || prop === "destroy") {
      return Reflect.get(target, prop, receiver);
    }
    const trx = rlsStore.getStore();
    const source = trx ?? target;
    const value = (source as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(source) : value;
  },
};

export const dbAdmin: Knex = new Proxy(adminPool, adminProxyHandler);

// ── Proxy: transparently delegates to request-scoped transaction ────────────
// When inside a request with rlsMiddleware active:
//   db('patients')  → trx('patients')    (RLS-scoped)
//   db.raw(...)     → trx.raw(...)       (RLS-scoped)
// When outside a request (startup, background jobs):
//   db('patients')  → appPool('patients') (no RLS context — returns 0 rows for tenant tables)
//   db.raw(...)     → appPool.raw(...)
// Proxy internals — Knex's function type isn't introspectable as a simple
// callable by TypeScript, so the apply trap must coerce to a call-signature
// shape. The coercions here are the narrowest form TypeScript permits
// without compromising runtime behaviour.
type KnexCallable = (...args: unknown[]) => unknown;
const proxyHandler: ProxyHandler<typeof appPool> = {
  apply(_target, _thisArg, args) {
    const trx = rlsStore.getStore();
    return trx ? (trx as unknown as KnexCallable)(...args) : (appPool as unknown as KnexCallable)(...args);
  },
  get(target, prop, receiver) {
    // Pool internals always go to the raw instance
    if (prop === "client" || prop === "destroy") {
      return Reflect.get(target, prop, receiver);
    }
    const trx = rlsStore.getStore();
    const source = trx ?? target;
    const value = (source as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(source) : value;
  },
};

export const db: Knex = new Proxy(appPool, proxyHandler);

/** Raw app pool — used by rlsMiddleware to create transactions.
 *  Do NOT use this in route handlers; use `db` instead. */
export const appPoolRaw = appPool;

// ── Pool monitoring ─────────────────────────────────────────────────────────
// Knex doesn't expose the underlying tarn.js pool in its public types,
// but it's reliably present at .client.pool on every driver. Typed as
// a structural interface with the runtime-observable methods we call.
interface TarnPool {
  numUsed?: () => number;
  numFree?: () => number;
  numPendingAcquires?: () => number;
  numPendingCreates?: () => number;
  min?: number;
  max?: number;
}
const pool = (appPool.client as unknown as { pool?: TarnPool }).pool;
let poolMonitorInterval: ReturnType<typeof setInterval> | null = null;
if (pool) {
  poolMonitorInterval = setInterval(() => {
    const used = pool.numUsed?.() ?? 0;
    const free = pool.numFree?.() ?? 0;
    const pending = pool.numPendingAcquires?.() ?? 0;
    if (pending > 5 || used >= poolMax * 0.9) {
      logger.warn({ used, free, pending, max: poolMax }, "DB pool pressure detected");
    }
  }, 30_000);
}

/** Call on graceful shutdown to clear the pool monitor */
export function clearPoolMonitor(): void { if (poolMonitorInterval) { clearInterval(poolMonitorInterval); poolMonitorInterval = null; } }

// ── Read Replica ────────────────────────────────────────────────────────────
const replicaHost = process.env.DB_REPLICA_HOST;

const replicaConfig: Knex.Config = replicaHost
  ? {
      client: "pg",
      connection: {
        host: replicaHost,
        port: parseInt(process.env.DB_REPLICA_PORT ?? String(config.database.port), 10),
        user: config.database.appUser,
        password: config.database.appPassword,
        database: config.database.database,
        ...sslConfig,
      },
      pool: {
        min: 2,
        max: replicaPoolMax,
        acquireTimeoutMillis: 60_000,
        idleTimeoutMillis: 30_000,
        // BUG-187: same connection-level guardrails as appPool — see
        // definition of appUserAfterCreate above for rationale.
        afterCreate: readReplicaAfterCreate,
      },
    }
  : {
      client: "pg",
      connection: {
        host: config.database.host,
        port: config.database.port,
        user: config.database.appUser,
        password: config.database.appPassword,
        database: config.database.database,
        ...sslConfig,
      },
      pool: {
        min: 2,
        max: replicaPoolMax,
        acquireTimeoutMillis: 60_000,
        idleTimeoutMillis: 30_000,
        // BUG-187: same connection-level guardrails as appPool — see
        // definition of appUserAfterCreate above for rationale.
        afterCreate: readReplicaAfterCreate,
      },
    };

/** Use dbRead for SELECT-only queries (dashboards, reports, lists).
 *  Routes to the read replica when DB_REPLICA_HOST is configured,
 *  otherwise falls back to app_user pool.
 *  Wrapped in the same AsyncLocalStorage proxy so RLS context is honoured. */
const rawDbRead = knex(replicaConfig);
registerKnexQueryErrorAudit(rawDbRead, "read_replica");

const readProxyHandler: ProxyHandler<typeof rawDbRead> = {
  apply(_target, _thisArg, args) {
    const trx = rlsStore.getStore();
    return trx ? (trx as unknown as KnexCallable)(...args) : (rawDbRead as unknown as KnexCallable)(...args);
  },
  get(target, prop, receiver) {
    if (prop === "client" || prop === "destroy") {
      return Reflect.get(target, prop, receiver);
    }
    const trx = rlsStore.getStore();
    const source = trx ?? target;
    const value = (source as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(source) : value;
  },
};

export const dbRead: Knex = new Proxy(rawDbRead, readProxyHandler);

export interface PoolSnapshot {
  used: number;
  free: number;
  pendingAcquires: number;
  pendingCreates: number;
  min: number;
  max: number;
}

export interface DbPoolTelemetrySnapshot {
  app: PoolSnapshot | null;
  admin: PoolSnapshot | null;
  readReplica: PoolSnapshot | null;
}

export interface DbPoolBudgetRuntimeConfig {
  appPoolMax: number;
  adminPoolMax: number;
  replicaPoolMax: number;
  hasReplica: boolean;
}

function toPoolSnapshot(poolLike: TarnPool | undefined): PoolSnapshot | null {
  if (!poolLike) return null;
  return {
    used: poolLike.numUsed?.() ?? 0,
    free: poolLike.numFree?.() ?? 0,
    pendingAcquires: poolLike.numPendingAcquires?.() ?? 0,
    pendingCreates: poolLike.numPendingCreates?.() ?? 0,
    min: poolLike.min ?? 0,
    max: poolLike.max ?? 0,
  };
}

export function getDbPoolTelemetrySnapshot(): DbPoolTelemetrySnapshot {
  const app = (appPool.client as unknown as { pool?: TarnPool }).pool;
  const admin = (adminPool.client as unknown as { pool?: TarnPool }).pool;
  const readReplica = (rawDbRead.client as unknown as { pool?: TarnPool }).pool;
  return {
    app: toPoolSnapshot(app),
    admin: toPoolSnapshot(admin),
    readReplica: toPoolSnapshot(readReplica),
  };
}

export function getDbPoolBudgetRuntimeConfig(): DbPoolBudgetRuntimeConfig {
  return {
    appPoolMax: poolMax,
    adminPoolMax,
    replicaPoolMax,
    hasReplica: Boolean(replicaHost),
  };
}
