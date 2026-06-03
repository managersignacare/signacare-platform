/**
 * S2.2 — Prometheus metrics
 *
 * Exposes a single registry with:
 *
 *   - Default Node.js process metrics (event loop lag, GC duration, RSS,
 *     active handles, file descriptors). These come for free from
 *     prom-client's collectDefaultMetrics().
 *
 *   - Custom application metrics:
 *
 *       http_request_duration_seconds  histogram of HTTP request latency
 *                                      labelled by method, route, status
 *
 *       db_query_duration_seconds      histogram of Knex query latency,
 *                                      labelled by op (select|insert|...)
 *                                      and table. Optional — wired in
 *                                      via knex hooks in db.ts in a
 *                                      follow-up PR.
 *
 *       bullmq_queue_depth             gauge of pending+active jobs per
 *                                      named queue. Optional — wired in
 *                                      from a periodic poller in a
 *                                      follow-up.
 *
 *       jobbus_enqueued_total          counter of jobBus.enqueue calls,
 *                                      labelled by queue name. Updated
 *                                      synchronously by the JobBus
 *                                      facade in a follow-up.
 *
 * The /metrics endpoint is gated by the existing IP allowlist
 * middleware (server.ts). It MUST NOT be public — Prometheus scrapers
 * authenticate by IP address, not by token.
 *
 * Naming compliance:
 *   - Metric names use snake_case (Prometheus convention)
 *   - Module exports use camelCase
 *   - Label values stay short and bounded so cardinality doesn't explode
 */

import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

/** Single registry for the whole process. */
export const metricsRegistry = new Registry();

// Default Node.js process metrics — RSS, event loop lag, GC, handles, etc.
// These are the same metrics every prom-client app exposes; we add the
// `signacare_` prefix to make them grep-friendly across multiple apps in one
// Prometheus instance.
collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'signacare_',
});

// ── HTTP request duration ───────────────────────────────────────────────────

export const httpRequestDurationSeconds = new Histogram({
  name: 'signacare_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds, labelled by method, route, and status code',
  labelNames: ['method', 'route', 'status'],
  // Buckets tuned for an EMR: most requests are fast (DB lookups), but
  // LLM/scribe routes can take seconds. The 10s upper bucket catches
  // the slow tail without dragging cardinality up.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ── DB query duration (used by knex hooks in a follow-up) ────────────────────

export const dbQueryDurationSeconds = new Histogram({
  name: 'signacare_db_query_duration_seconds',
  help: 'Duration of Knex queries in seconds, labelled by op and table',
  labelNames: ['op', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

// ── BullMQ queue depth (used by a periodic poller in a follow-up) ────────────

export const bullmqQueueDepth = new Gauge({
  name: 'signacare_bullmq_queue_depth',
  help: 'Number of pending + active jobs in a BullMQ queue',
  labelNames: ['queue'],
  registers: [metricsRegistry],
});

// ── JobBus enqueue counter (wired into the JobBus facade in a follow-up) ────

export const jobbusEnqueuedTotal = new Counter({
  name: 'signacare_jobbus_enqueued_total',
  help: 'Total number of jobs enqueued via the JobBus facade',
  labelNames: ['queue'],
  registers: [metricsRegistry],
});

// ── PostgreSQL pool telemetry (BUG-POOL-BUDGET-WORKSHEET) ──────────────────

type PoolKind = 'app' | 'admin' | 'read_replica';

interface PoolSnapshotLike {
  used: number;
  free: number;
  pendingAcquires: number;
  pendingCreates: number;
  max: number;
}

interface DbPoolTelemetrySnapshotLike {
  app: PoolSnapshotLike | null;
  admin: PoolSnapshotLike | null;
  readReplica: PoolSnapshotLike | null;
}

export const pgPoolUsed = new Gauge({
  name: 'signacare_pg_pool_used',
  help: 'PostgreSQL pool in-use connections by pool kind',
  labelNames: ['pool'],
  registers: [metricsRegistry],
});

export const pgPoolFree = new Gauge({
  name: 'signacare_pg_pool_free',
  help: 'PostgreSQL pool free connections by pool kind',
  labelNames: ['pool'],
  registers: [metricsRegistry],
});

export const pgPoolPending = new Gauge({
  name: 'signacare_pg_pool_pending',
  help: 'PostgreSQL pool pending acquires by pool kind',
  labelNames: ['pool'],
  registers: [metricsRegistry],
});

export const pgPoolPendingCreates = new Gauge({
  name: 'signacare_pg_pool_pending_creates',
  help: 'PostgreSQL pool pending creates by pool kind',
  labelNames: ['pool'],
  registers: [metricsRegistry],
});

export const pgPoolMax = new Gauge({
  name: 'signacare_pg_pool_max',
  help: 'PostgreSQL pool configured max by pool kind',
  labelNames: ['pool'],
  registers: [metricsRegistry],
});

function observePool(kind: PoolKind, snapshot: PoolSnapshotLike | null): void {
  if (!snapshot) return;
  const labels = { pool: kind };
  pgPoolUsed.set(labels, snapshot.used);
  pgPoolFree.set(labels, snapshot.free);
  pgPoolPending.set(labels, snapshot.pendingAcquires);
  pgPoolPendingCreates.set(labels, snapshot.pendingCreates);
  pgPoolMax.set(labels, snapshot.max);
}

export function observeDbPoolTelemetry(snapshot: DbPoolTelemetrySnapshotLike): void {
  observePool('app', snapshot.app);
  observePool('admin', snapshot.admin);
  observePool('read_replica', snapshot.readReplica);
}

let dbPoolMetricsInterval: ReturnType<typeof setInterval> | null = null;

export function startDbPoolMetricsPolling(
  readSnapshot: () => DbPoolTelemetrySnapshotLike,
  intervalMs = 30_000,
): void {
  stopDbPoolMetricsPolling();
  observeDbPoolTelemetry(readSnapshot());
  dbPoolMetricsInterval = setInterval(() => {
    observeDbPoolTelemetry(readSnapshot());
  }, intervalMs);
}

export function stopDbPoolMetricsPolling(): void {
  if (!dbPoolMetricsInterval) return;
  clearInterval(dbPoolMetricsInterval);
  dbPoolMetricsInterval = null;
}

// ── Post-deployment hardening telemetry pre-work (S2 deferred set) ─────────

export const clinicalIntelligenceSummaryStateTotal = new Counter({
  name: 'signacare_clinical_intelligence_summary_state_total',
  help: 'Clinical-intelligence summary generation outcomes by state',
  labelNames: ['state', 'diagnosis_bucket', 'program_bucket'],
  registers: [metricsRegistry],
});

export const clinicalIntelligenceSourceFailureTotal = new Counter({
  name: 'signacare_clinical_intelligence_source_failure_total',
  help: 'Per-source failures while generating clinical-intelligence summaries',
  labelNames: ['source'],
  registers: [metricsRegistry],
});

export const aiSummaryReadabilityTotal = new Counter({
  name: 'signacare_ai_summary_readability_total',
  help: 'Readability telemetry for AI-generated summaries by feature and language bucket',
  labelNames: ['feature', 'language', 'band'],
  registers: [metricsRegistry],
});

export const aiAlertCalibrationFeedbackTotal = new Counter({
  name: 'signacare_ai_alert_calibration_feedback_total',
  help: 'Clinician feedback used to calibrate alert fatigue risk-surfacing precision/recall',
  labelNames: ['signal_type', 'outcome'],
  registers: [metricsRegistry],
});

// ── Express middleware ──────────────────────────────────────────────────────

/**
 * Wrap every request in a high-resolution timer and record the result
 * into the http_request_duration_seconds histogram. Mounted before
 * route handlers in server.ts.
 *
 * The `route` label uses req.route?.path when available (the Express
 * route pattern, not the literal URL) to keep cardinality bounded.
 * Falls back to a constant 'unknown' when no route matched, which
 * groups all 404s into a single time series.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    const route = (req.route?.path as string | undefined) ?? 'unknown';
    const method = req.method;
    const status = String(res.statusCode);
    httpRequestDurationSeconds.observe({ method, route, status }, elapsedSeconds);
  });
  next();
}

/**
 * Express handler that returns the registry as Prometheus text format.
 * Mounted at GET /metrics behind the IP allowlist middleware so only
 * the Prometheus scraper IPs can read it.
 */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  } catch (err) {
    res.status(500).send(`# scrape failed: ${(err as Error).message}\n`);
  }
}
