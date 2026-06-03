// apps/api/src/shared/gracefulShutdown.ts
//
// BUG-042 — canonical graceful-shutdown registry.
//
// Pre-fix server.ts had a minimal SIGTERM handler duplicated across
// HTTPS + HTTP branches that closed the HTTP server, destroyed the DB
// pool, and quit Redis. Gaps:
//   - No BullMQ worker drain → in-flight jobs killed mid-execution
//     → duplicate enqueue on restart (BUG-202 idempotency is defence
//     but BUG-042 is prevention).
//   - No WebSocket close → server.close() hangs indefinitely when an
//     active scribe session is open (server.close() waits for ALL
//     sockets including WS upgrades).
//   - No /ready flip → LB keeps routing traffic to draining pod.
//   - Not re-entrant safe → double SIGTERM = double shutdown.
//   - No scheduler cancel → cron ticks call db() on destroyed pool.
//   - Historical HIPAA 164.312(b) audit-completeness risk — Pino
//     buffered lines could be lost on abrupt process.exit().
//
// Solution — priority-based registry:
//   Every component with cleanup work registers a hook at module init.
//   On SIGTERM / SIGINT, runGracefulShutdown drains hooks in descending
//   priority, per-hook timeout (default 5s, override via timeoutMs for
//   long-running workers), overall 25s budget with deadline tracking
//   (short-circuits remaining hooks when exceeded). Hooks isolated —
//   one hook's throw does not block the rest.
//
// Priority buckets (higher = drained earlier):
//   100  readiness probe flips to not_ready (LB stops routing)
//    90  WebSocket close (clients sent 1001 going-away + terminate())
//    85  scheduled tasks (node-cron + setInterval) cancelled
//    80  HTTP server close (closeIdleConnections + server.close())
//    70  Whisper external process stop
//    60  BullMQ workers drain (worker.close() awaits current job)
//    50  Workflow engine stop (unregister event listeners)
//    20  DB pool destroy
//    10  Redis quit
//     5  OTEL SDK flush + pino destination flushSync
//
// Re-entrant: module-level isShuttingDown flag. Second signal logs a
// warning and returns immediately (NOT the in-flight promise). Callers
// that must wait should await the first call directly.
//
// Budget: 25s total (5s buffer before k8s terminationGracePeriodSeconds
// default of 30s). Per-hook default 5s; long-running workers override
// to 15-20s within the overall budget.
//
// Both SIGTERM (orchestrator) and SIGINT (local dev Ctrl-C) invoke
// runGracefulShutdown so lifecycle is consistent across environments.

import { logger } from '../utils/logger';

export interface ShutdownHook {
  /** Human-readable identifier in logs. */
  name: string;
  /** Higher = drained earlier. See file header for canonical buckets. */
  priority: number;
  /** Cleanup function; MUST resolve within timeoutMs (or default). */
  handler: () => Promise<void>;
  /**
   * Per-hook timeout override in ms. Defaults to PER_HOOK_TIMEOUT_MS
   * (5s). Long-running workers (aiWorker LLM generation, OCR) pass
   * 15-20s so their in-flight job can complete.
   */
  timeoutMs?: number;
}

type ShutdownHookOutcome = 'completed' | 'failed' | 'timed_out' | 'skipped_budget';

export interface ShutdownHookRunTelemetry {
  hookName: string;
  priority: number;
  timeoutMs: number;
  durationMs: number;
  outcome: ShutdownHookOutcome;
  error: string | null;
}

export interface GracefulShutdownRunTelemetry {
  signal: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  budgetMs: number;
  budgetExhausted: boolean;
  hookCount: number;
  summary: {
    completed: number;
    failed: number;
    timedOut: number;
    skippedBudget: number;
  };
  hooks: ShutdownHookRunTelemetry[];
}

export interface GracefulShutdownPerHookAggregate {
  hookName: string;
  priority: number;
  invocations: number;
  completed: number;
  failed: number;
  timedOut: number;
  skippedBudget: number;
  avgDurationMs: number;
  maxDurationMs: number;
  maxTimeoutMs: number;
}

export interface GracefulShutdownObservabilitySnapshot {
  generatedAt: string;
  isShuttingDown: boolean;
  runCount: number;
  runsLast24Hours: number;
  lastRun: GracefulShutdownRunTelemetry | null;
  aggregatesLast24Hours: {
    hooksCompleted: number;
    hooksFailed: number;
    hooksTimedOut: number;
    hooksSkippedBudget: number;
    avgHookDurationMs: number;
    maxHookDurationMs: number;
  };
  perHookLast24Hours: GracefulShutdownPerHookAggregate[];
}

const PER_HOOK_TIMEOUT_MS = 5_000;
const OVERALL_TIMEOUT_MS = 25_000;
const TELEMETRY_MAX_RUNS = 50;
const TELEMETRY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const hooks: ShutdownHook[] = [];
const shutdownRuns: GracefulShutdownRunTelemetry[] = [];
let isShuttingDown = false;
let readyState = true;

/**
 * Register a cleanup hook. Call at module init (alongside the
 * resource being created). Registration is idempotent by name —
 * re-registering a same-named hook replaces the prior entry.
 */
export function registerShutdownHook(hook: ShutdownHook): void {
  const existing = hooks.findIndex((h) => h.name === hook.name);
  if (existing >= 0) {
    hooks.splice(existing, 1, hook);
  } else {
    hooks.push(hook);
  }
}

/** Read current readiness. /ready route returns 503 when false. */
export function isReady(): boolean {
  return readyState && !isShuttingDown;
}

/** Test-only — reset internal state so integration tests can isolate. */
export function __resetForTests(): void {
  hooks.length = 0;
  shutdownRuns.length = 0;
  isShuttingDown = false;
  readyState = true;
}

/** Test-only — enumerate hook names in priority order. */
export function __hookNamesForTests(): string[] {
  return [...hooks].sort((a, b) => b.priority - a.priority).map((h) => h.name);
}

/** Snapshot for compliance dashboard / reliability review surfaces. */
export function getGracefulShutdownObservabilitySnapshot(
  now: Date = new Date(),
): GracefulShutdownObservabilitySnapshot {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - TELEMETRY_LOOKBACK_MS;
  const runsLast24 = shutdownRuns.filter((run) => {
    const runStartedMs = new Date(run.startedAt).getTime();
    return Number.isFinite(runStartedMs) && runStartedMs >= windowStartMs;
  });

  const perHookMap = new Map<string, {
    hookName: string;
    priority: number;
    invocations: number;
    completed: number;
    failed: number;
    timedOut: number;
    skippedBudget: number;
    durationTotalMs: number;
    maxDurationMs: number;
    maxTimeoutMs: number;
  }>();

  let hooksCompleted = 0;
  let hooksFailed = 0;
  let hooksTimedOut = 0;
  let hooksSkippedBudget = 0;
  let durationSumMs = 0;
  let durationCount = 0;
  let maxHookDurationMs = 0;

  for (const run of runsLast24) {
    for (const hook of run.hooks) {
      hooksCompleted += hook.outcome === 'completed' ? 1 : 0;
      hooksFailed += hook.outcome === 'failed' ? 1 : 0;
      hooksTimedOut += hook.outcome === 'timed_out' ? 1 : 0;
      hooksSkippedBudget += hook.outcome === 'skipped_budget' ? 1 : 0;
      durationSumMs += hook.durationMs;
      durationCount += 1;
      maxHookDurationMs = Math.max(maxHookDurationMs, hook.durationMs);

      const existing = perHookMap.get(hook.hookName);
      if (!existing) {
        perHookMap.set(hook.hookName, {
          hookName: hook.hookName,
          priority: hook.priority,
          invocations: 1,
          completed: hook.outcome === 'completed' ? 1 : 0,
          failed: hook.outcome === 'failed' ? 1 : 0,
          timedOut: hook.outcome === 'timed_out' ? 1 : 0,
          skippedBudget: hook.outcome === 'skipped_budget' ? 1 : 0,
          durationTotalMs: hook.durationMs,
          maxDurationMs: hook.durationMs,
          maxTimeoutMs: hook.timeoutMs,
        });
      } else {
        existing.invocations += 1;
        if (hook.outcome === 'completed') existing.completed += 1;
        if (hook.outcome === 'failed') existing.failed += 1;
        if (hook.outcome === 'timed_out') existing.timedOut += 1;
        if (hook.outcome === 'skipped_budget') existing.skippedBudget += 1;
        existing.durationTotalMs += hook.durationMs;
        existing.maxDurationMs = Math.max(existing.maxDurationMs, hook.durationMs);
        existing.maxTimeoutMs = Math.max(existing.maxTimeoutMs, hook.timeoutMs);
      }
    }
  }

  const perHookLast24Hours: GracefulShutdownPerHookAggregate[] = Array.from(perHookMap.values())
    .map((row) => ({
      hookName: row.hookName,
      priority: row.priority,
      invocations: row.invocations,
      completed: row.completed,
      failed: row.failed,
      timedOut: row.timedOut,
      skippedBudget: row.skippedBudget,
      avgDurationMs: row.invocations > 0 ? Math.round(row.durationTotalMs / row.invocations) : 0,
      maxDurationMs: row.maxDurationMs,
      maxTimeoutMs: row.maxTimeoutMs,
    }))
    .sort((a, b) => {
      if (b.timedOut !== a.timedOut) return b.timedOut - a.timedOut;
      if (b.failed !== a.failed) return b.failed - a.failed;
      if (b.maxDurationMs !== a.maxDurationMs) return b.maxDurationMs - a.maxDurationMs;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.hookName.localeCompare(b.hookName);
    });

  return {
    generatedAt: now.toISOString(),
    isShuttingDown,
    runCount: shutdownRuns.length,
    runsLast24Hours: runsLast24.length,
    lastRun: shutdownRuns[0] ?? null,
    aggregatesLast24Hours: {
      hooksCompleted,
      hooksFailed,
      hooksTimedOut,
      hooksSkippedBudget,
      avgHookDurationMs: durationCount > 0 ? Math.round(durationSumMs / durationCount) : 0,
      maxHookDurationMs,
    },
    perHookLast24Hours,
  };
}

/**
 * Run all registered hooks in descending priority order.
 *
 * - readyState flips to false BEFORE any hook runs so /ready returns
 *   503 immediately.
 * - Each hook is given its own timeoutMs (or default 5s). Timeouts
 *   do NOT cancel the underlying promise — on timeout the hook is
 *   considered "done" from the registry's view so the next hook can
 *   start. The background promise may complete or fail later; we
 *   trust the OS to reclaim resources on process.exit().
 * - An overall 25s deadline is tracked; hooks that would start past
 *   the deadline are skipped with a logged warning listing the
 *   skipped-hook names so operators see which cleanup didn't run.
 * - Per-hook failures are isolated — a throw does not block
 *   subsequent hooks.
 * - Idempotent — second call while first is running is a no-op with
 *   a warning log. Returns void; callers must await the FIRST call
 *   if they need completion guarantees.
 *
 * Never throws.
 */
export async function runGracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn({ signal }, '[gracefulShutdown] already in progress — ignoring duplicate signal');
    return;
  }
  isShuttingDown = true;
  readyState = false; // /ready flips to 503 immediately so LB stops routing

  logger.info({ signal, hookCount: hooks.length, budgetMs: OVERALL_TIMEOUT_MS }, '[gracefulShutdown] begin');
  const startedAt = Date.now();
  const deadline = startedAt + OVERALL_TIMEOUT_MS;
  const runTelemetry: GracefulShutdownRunTelemetry = {
    signal,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(startedAt).toISOString(),
    totalDurationMs: 0,
    budgetMs: OVERALL_TIMEOUT_MS,
    budgetExhausted: false,
    hookCount: 0,
    summary: {
      completed: 0,
      failed: 0,
      timedOut: 0,
      skippedBudget: 0,
    },
    hooks: [],
  };

  const ordered = [...hooks].sort((a, b) => b.priority - a.priority);
  runTelemetry.hookCount = ordered.length;
  for (let i = 0; i < ordered.length; i++) {
    const hook = ordered[i];
    if (!hook) continue;
    if (Date.now() >= deadline) {
      const skipped = ordered.slice(i).map((h) => h.name);
      runTelemetry.budgetExhausted = true;
      for (const skippedHook of ordered.slice(i)) {
        const timeoutMs = skippedHook.timeoutMs ?? PER_HOOK_TIMEOUT_MS;
        runTelemetry.hooks.push({
          hookName: skippedHook.name,
          priority: skippedHook.priority,
          timeoutMs,
          durationMs: 0,
          outcome: 'skipped_budget',
          error: 'overall_shutdown_budget_exhausted',
        });
        runTelemetry.summary.skippedBudget += 1;
      }
      logger.error(
        { hookName: hook.name, skipped, elapsedMs: Date.now() - startedAt },
        '[gracefulShutdown] overall 25s budget exhausted — skipping remaining hooks',
      );
      break;
    }
    const hookTimeoutMs = hook.timeoutMs ?? PER_HOOK_TIMEOUT_MS;
    const hookStartedAt = Date.now();
    try {
      await runWithTimeout(hook.handler(), hookTimeoutMs, hook.name);
      const durationMs = Date.now() - hookStartedAt;
      runTelemetry.hooks.push({
        hookName: hook.name,
        priority: hook.priority,
        timeoutMs: hookTimeoutMs,
        durationMs,
        outcome: 'completed',
        error: null,
      });
      runTelemetry.summary.completed += 1;
      logger.info(
        { hookName: hook.name, priority: hook.priority, durationMs },
        '[gracefulShutdown] hook complete',
      );
    } catch (err) {
      const durationMs = Date.now() - hookStartedAt;
      const timedOut = err instanceof HookTimeoutError;
      runTelemetry.hooks.push({
        hookName: hook.name,
        priority: hook.priority,
        timeoutMs: hookTimeoutMs,
        durationMs,
        outcome: timedOut ? 'timed_out' : 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      if (timedOut) {
        runTelemetry.summary.timedOut += 1;
      } else {
        runTelemetry.summary.failed += 1;
      }
      logger.error(
        {
          hookName: hook.name,
          priority: hook.priority,
          durationMs,
          timeoutMs: hookTimeoutMs,
          err: err instanceof Error ? err.message : String(err),
        },
        '[gracefulShutdown] hook failed or timed out — continuing with next hook',
      );
    }
  }

  runTelemetry.completedAt = new Date().toISOString();
  runTelemetry.totalDurationMs = Date.now() - startedAt;
  shutdownRuns.unshift(runTelemetry);
  if (shutdownRuns.length > TELEMETRY_MAX_RUNS) {
    shutdownRuns.length = TELEMETRY_MAX_RUNS;
  }

  logger.info(
    {
      totalDurationMs: runTelemetry.totalDurationMs,
      summary: runTelemetry.summary,
      budgetExhausted: runTelemetry.budgetExhausted,
    },
    '[gracefulShutdown] complete',
  );
}

/**
 * Race a promise against a timeout. On timeout we reject but do NOT
 * cancel the underlying promise — JavaScript has no general-purpose
 * Promise cancellation. The hook caller catches the timeout rejection
 * as a "hook failed" log; the background work may resolve later
 * against nothing (which is acceptable — the process is about to die).
 */
class HookTimeoutError extends Error {
  readonly code = 'GRACEFUL_SHUTDOWN_HOOK_TIMEOUT';
  constructor(hookName: string, ms: number) {
    super(`hook '${hookName}' timed out after ${ms}ms`);
    this.name = 'HookTimeoutError';
  }
}

function runWithTimeout<T>(p: Promise<T>, ms: number, hookName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new HookTimeoutError(hookName, ms));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}
