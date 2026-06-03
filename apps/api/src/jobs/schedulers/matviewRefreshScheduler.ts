// apps/api/src/jobs/schedulers/matviewRefreshScheduler.ts
//
// S2.4 — Materialized view refresh scheduler
//
// The system-design audit assumed two materialized views existed
// (vw_llm_usage_by_day, vw_llm_usage_clinic_day). On inspection they
// turned out to be plain VIEWs (recompute on every query) and are not
// consumed by any current dashboard. So S2.4's original scope — write
// a refresh job for known views — is moot.
//
// What this scheduler ships instead is the GENERIC infrastructure for
// when a matview is genuinely added later. It is opt-in via env var,
// reads a comma-separated list of view names, and is a complete no-op
// (no DB calls, no logs except at startup) when the list is empty.
//
// To enable in production:
//
//     MATVIEW_REFRESH_VIEWS=vw_dashboard_summary,vw_audit_rollup
//     MATVIEW_REFRESH_CRON='0 2 * * *'   (default: nightly at 02:00 local)
//
// The scheduler runs `REFRESH MATERIALIZED VIEW CONCURRENTLY <name>`
// for each view. CONCURRENTLY requires a unique index on the matview;
// callers are responsible for adding that when they create the view.
// On unique-index-missing errors the scheduler falls back to non-
// concurrent refresh and logs a warning so ops can fix the index.
//
// Naming compliance: snake_case view names, camelCase TS exports,
// kebab-case node-cron expression.

import cron from 'node-cron';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';

interface RefreshResult {
  view: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export async function refreshOneView(view: string): Promise<RefreshResult> {
  // Defence in depth: only allow snake_case identifiers so the env var
  // can never be used to inject SQL.
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(view)) {
    return { view, ok: false, durationMs: 0, error: 'invalid_identifier' };
  }
  const start = Date.now();
  try {
    await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY ??', [view]);
    return { view, ok: true, durationMs: Date.now() - start };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // CONCURRENTLY requires a unique index. If it's missing, fall back
    // to non-concurrent refresh (which holds an exclusive lock briefly)
    // and log a warning so the index can be added later.
    if (errMsg.includes('CONCURRENTLY')) {
      logger.warn({ view }, 'matviewRefresh: CONCURRENTLY failed, falling back to non-concurrent refresh — add a unique index to the view');
      try {
        await db.raw('REFRESH MATERIALIZED VIEW ??', [view]);
        return { view, ok: true, durationMs: Date.now() - start };
      } catch (err2) {
        return { view, ok: false, durationMs: Date.now() - start, error: err2 instanceof Error ? err2.message : String(err2) };
      }
    }
    return { view, ok: false, durationMs: Date.now() - start, error: errMsg };
  }
}

function parseViewList(): string[] {
  const raw = process.env.MATVIEW_REFRESH_VIEWS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

let alreadyRunning = false;

async function tick(): Promise<void> {
  if (alreadyRunning) return; // mutex against overlap
  const views = parseViewList();
  if (views.length === 0) return; // env var unset — nothing to do
  alreadyRunning = true;
  try {
    logger.info({ count: views.length }, 'matviewRefresh: starting');
    const results: RefreshResult[] = [];
    for (const view of views) {
      const r = await refreshOneView(view);
      results.push(r);
      if (r.ok) {
        logger.info({ view: r.view, durationMs: r.durationMs }, 'matviewRefresh: refreshed');
      } else {
        logger.error({ view: r.view, error: r.error }, 'matviewRefresh: failed');
      }
    }
    const failed = results.filter((r) => !r.ok).length;
    logger.info(
      { total: results.length, failed, succeeded: results.length - failed },
      'matviewRefresh: done',
    );
  } finally {
    alreadyRunning = false;
  }
}

export function startMatviewRefreshScheduler(): cron.ScheduledTask | null {
  const views = parseViewList();
  if (views.length === 0) {
    // No views configured — leave the scheduler off entirely so we
    // don't even pay the 1-minute timer cost.
    logger.info('matviewRefreshScheduler: MATVIEW_REFRESH_VIEWS unset, scheduler not started');
    return null;
  }
  const cronExpr = process.env.MATVIEW_REFRESH_CRON ?? '0 2 * * *';
  if (!cron.validate(cronExpr)) {
    logger.error({ cronExpr }, 'matviewRefreshScheduler: invalid MATVIEW_REFRESH_CRON, scheduler not started');
    return null;
  }
  const task = cron.schedule(cronExpr, () => { void tick(); }, {
    timezone: process.env.MATVIEW_REFRESH_TZ || 'Australia/Melbourne',
  });
  logger.info({ cronExpr, views }, 'matviewRefreshScheduler started');
  return task;
}

// BUG-042 — static import of shutdown registry (no `void import()`).
import { registerShutdownHook } from '../../shared/gracefulShutdown';

// Auto-start on import (matches the existing scheduler convention).
// Skipped under NODE_ENV=test so unit tests don't accidentally hit the DB.
if (process.env.NODE_ENV !== 'test') {
  setImmediate(() => {
    try {
      const task = startMatviewRefreshScheduler();
      // BUG-042 — register cron stop at priority 85 so ticks don't
      // fire during the DB pool destroy window.
      if (task) {
        registerShutdownHook({
          name: 'scheduler:matview-refresh',
          priority: 85,
          handler: async () => { task.stop(); },
        });
      }
    } catch (err) {
      logger.error({ err }, 'matviewRefreshScheduler failed to start');
    }
  });
}
