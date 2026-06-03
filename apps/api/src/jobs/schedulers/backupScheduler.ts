// apps/api/src/jobs/schedulers/backupScheduler.ts
//
// S1.3 — Persistent backup scheduler
//
// Reads the singleton row from the `backup_config` table on every tick
// (so config edits via the admin UI take effect on the next minute, not
// after a process restart) and runs a pg_dump if the schedule says it
// should.
//
// Why node-cron + a 1-minute tick instead of cron-style frequency:
// frequency in the DB is 'hourly' | 'daily' | 'weekly', and 'daily' has
// a wall-clock time-of-day that needs to be checked against the current
// minute. A 1-minute tick is the simplest way to honour both. The
// last_run_at column in backup_config doubles as a debouncer so we
// don't run the same daily backup twice if the process restarts during
// the run window.
//
// All errors are logged but never thrown — Express error middleware
// does not see scheduler errors, and an unhandled rejection here would
// crash the API.
//
// Naming: backup_config / backup_history columns snake_case, function
// names camelCase, cron module from node-cron.

import cron from 'node-cron';
import path from 'path';
import { logger } from '../../utils/logger';
import { runBackup, cleanOldBackups, getBackupConfig } from '../../features/backup/backupRoutes';

interface DueDecision {
  due: boolean;
  reason: string;
}

interface SchedulerDbErrorShape {
  code?: string;
  message?: string;
  cause?: unknown;
  err?: unknown;
  originalError?: unknown;
  nativeError?: unknown;
}

/**
 * Decide whether the schedule says we should run a backup right now,
 * given the current time and the row from backup_config. Pulled out as
 * a pure function so it can be unit-tested without time travel.
 */
export function shouldRunNow(
  cfg: { schedule_enabled: boolean; frequency: 'hourly' | 'daily' | 'weekly'; time_of_day: string; last_run_at: Date | null },
  now: Date,
): DueDecision {
  if (!cfg.schedule_enabled) return { due: false, reason: 'schedule_disabled' };

  const last = cfg.last_run_at ? new Date(cfg.last_run_at).getTime() : 0;
  const elapsedMs = now.getTime() - last;

  if (cfg.frequency === 'hourly') {
    // Run if it's been at least 60 minutes since the last run.
    return elapsedMs >= 60 * 60 * 1000
      ? { due: true, reason: 'hourly_elapsed' }
      : { due: false, reason: 'hourly_not_yet' };
  }

  // For daily and weekly the wall-clock time-of-day matters.
  const [hh, mm] = cfg.time_of_day.split(':').map((s) => parseInt(s, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) {
    return { due: false, reason: 'invalid_time_of_day' };
  }
  // Match within the current minute window.
  if (now.getHours() !== hh || now.getMinutes() !== mm) {
    return { due: false, reason: 'wrong_minute' };
  }

  if (cfg.frequency === 'daily') {
    // Don't double-run if last_run_at is within the past 23 hours.
    return elapsedMs >= 23 * 60 * 60 * 1000
      ? { due: true, reason: 'daily_at_time' }
      : { due: false, reason: 'daily_already_ran_today' };
  }

  if (cfg.frequency === 'weekly') {
    // Run on Sundays (matches the legacy weekly meaning) at the configured time.
    if (now.getDay() !== 0) return { due: false, reason: 'weekly_wrong_day' };
    return elapsedMs >= 6 * 24 * 60 * 60 * 1000
      ? { due: true, reason: 'weekly_at_time' }
      : { due: false, reason: 'weekly_already_ran_this_week' };
  }

  return { due: false, reason: 'unknown_frequency' };
}

let alreadyRunning = false;
let schedulerDisabled = false;

function getDbErrorHint(err: unknown): SchedulerDbErrorShape {
  let cursor: unknown = err;
  let fallbackMessage: string | undefined;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!cursor || typeof cursor !== 'object') break;
    const candidate = cursor as SchedulerDbErrorShape;
    const code = typeof candidate.code === 'string' ? candidate.code : undefined;
    const message = typeof candidate.message === 'string' ? candidate.message : undefined;
    if (message && !fallbackMessage) {
      fallbackMessage = message;
    }
    if (code) {
      return { code, message: message ?? fallbackMessage };
    }
    cursor = candidate.err ?? candidate.cause ?? candidate.originalError ?? candidate.nativeError;
  }
  return { message: fallbackMessage };
}

export function isUnrecoverableBackupConfigAccessError(err: unknown): boolean {
  const hint = getDbErrorHint(err);
  if (hint.code !== '42501') return false;
  const message = (hint.message ?? '').toLowerCase();
  return message.includes('backup_config') || message.includes('row-level security policy');
}

async function tick(): Promise<void> {
  if (schedulerDisabled || alreadyRunning) {
    // Mutex against the rare case where a 1-minute tick fires while a
    // previous tick's pg_dump is still in flight.
    return;
  }
  alreadyRunning = true;
  try {
    const cfg = await getBackupConfig();
    const decision = shouldRunNow(cfg, new Date());
    if (!decision.due) return;

    const dir = cfg.local_dir || path.resolve(process.cwd(), '../../backups');
    logger.info({ dir, reason: decision.reason }, 'backupScheduler: running backup');
    await runBackup(dir, 'scheduled', null);
    try {
      cleanOldBackups(dir, cfg.retention_days);
    } catch (err) {
      logger.warn({ err }, 'backupScheduler: cleanup failed');
    }
  } catch (err) {
    if (isUnrecoverableBackupConfigAccessError(err)) {
      schedulerDisabled = true;
      logger.error(
        { err, kind: 'BACKUP_SCHEDULER_DISABLED_UNRECOVERABLE_ACCESS' },
        'backupScheduler: disabling scheduler after unrecoverable backup_config access error',
      );
      return;
    }
    logger.error({ err }, 'backupScheduler: tick failed');
  } finally {
    alreadyRunning = false;
  }
}

/**
 * Wire up the scheduler. Called once from server bootstrap. Returns the
 * cron task so callers can stop it in tests.
 */
export function startBackupScheduler(): cron.ScheduledTask | null {
  schedulerDisabled = false;
  // Tick every minute. The check is cheap (one indexed SELECT against the
  // singleton config row) so this is well within budget.
  const task = cron.schedule('* * * * *', () => {
    void tick();
  }, { timezone: process.env.BACKUP_TZ || 'Australia/Melbourne' });
  logger.info({ tz: process.env.BACKUP_TZ || 'Australia/Melbourne' }, 'backupScheduler started');
  // Run once immediately so permission/config errors surface on boot rather
  // than one minute later.
  void tick();
  return task;
}

// BUG-042 — static import of shutdown registry.
import { registerShutdownHook } from '../../shared/gracefulShutdown';

// Auto-start on import to match the prior behaviour. Bootstraps when the
// API process loads this module via the schedulers index (or directly).
// Tests can avoid this by importing only `shouldRunNow`.
if (process.env.NODE_ENV !== 'test') {
  // Lazily — defer to next tick so module init order is unaffected.
  setImmediate(() => {
    try {
      // db connection may not be ready at module-init time; defer the
      // first DB read to the first tick.
      const task = startBackupScheduler();
      // BUG-042 — stop cron at priority 85 before DB pool destroy.
      if (task) {
        registerShutdownHook({
          name: 'scheduler:backup',
          priority: 85,
          handler: async () => { task.stop(); },
        });
      }
    } catch (err) {
      logger.error({ err }, 'backupScheduler failed to start');
    }
  });
}
