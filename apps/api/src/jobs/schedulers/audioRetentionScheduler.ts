// apps/api/src/jobs/schedulers/audioRetentionScheduler.ts
//
// S5.3 — Audio retention purge scheduler
//
// Deletes raw consultation audio older than AUDIO_RETENTION_DAYS
// (default 30) so we don't carry indefinitely-growing PHI on disk
// or in cloud blob storage. Heidi documents a retention policy; Signacare now does too.
//
// What this scheduler covers depends on the BLOB_STORAGE_BACKEND:
//
//   local  — walks `uploads/audio/yyyy/mm/...` on the API container's
//            local filesystem and removes files whose mtime is older
//            than the cutoff.
//
//   cloud  — deletes DB-tracked async scribe audio through the BlobStorage
//            facade. Cloud lifecycle policies remain useful defence-in-depth,
//            but application retention is the source of truth because each
//            ai_job_runs row records the policy and deletion proof.
//
// The scheduler is intentionally a simple cron tick (default daily at
// 03:00 local) — there's no need for sub-day precision on a 30-day
// window. Per-tick mutex prevents overlap if the previous run is
// still walking a huge directory.
//
// Naming compliance: snake_case env vars (AUDIO_*), camelCase TS.

import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import { resolveUploadPath } from '../../shared/uploadPaths';
import { purgeExpiredAsyncScribeAudioBlobs } from '../../mcp/scribeAudioRetention';

interface PurgeStats {
  scanned: number;
  deleted: number;
  errors: number;
  bytesFreed: number;
}

let alreadyRunning = false;

export function getAudioRetentionDays(): number {
  const raw = process.env.AUDIO_RETENTION_DAYS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed) || parsed < 1) return 30;
  return parsed;
}

/**
 * Recursively walk a directory and yield each file path along with
 * its mtime. Pulled out so the test can mock the filesystem layer.
 */
export function* walkAudioFiles(rootDir: string): Generator<{ filePath: string; mtimeMs: number; size: number }> {
  if (!fs.existsSync(rootDir)) return;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        yield { filePath: full, mtimeMs: stat.mtimeMs, size: stat.size };
      } catch {
        // skip unreadable entries
      }
    }
  }
}

/**
 * Purge audio files older than `retentionDays` from `rootDir`.
 * Pure function over fs — easy to unit-test by pointing rootDir at
 * a tmpdir with seed files.
 */
export function purgeOldAudioFiles(rootDir: string, retentionDays: number, now: number = Date.now()): PurgeStats {
  const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000;
  const stats: PurgeStats = { scanned: 0, deleted: 0, errors: 0, bytesFreed: 0 };
  for (const { filePath, mtimeMs, size } of walkAudioFiles(rootDir)) {
    stats.scanned++;
    if (mtimeMs < cutoffMs) {
      try {
        fs.unlinkSync(filePath);
        stats.deleted++;
        stats.bytesFreed += size;
      } catch {
        stats.errors++;
      }
    }
  }
  return stats;
}

async function tick(): Promise<void> {
  if (alreadyRunning) return;
  alreadyRunning = true;
  try {
    const days = getAudioRetentionDays();
    const backend = (process.env.BLOB_STORAGE_BACKEND ?? 'local').toLowerCase();

    const asyncStats = await purgeExpiredAsyncScribeAudioBlobs();

    if (backend !== 'local') {
      logger.info(
        { backend, days, asyncStats },
        'audioRetentionScheduler: cloud backend async scribe blob purge complete',
      );
      return;
    }

    const audioRoot = resolveUploadPath('audio');
    const stats = purgeOldAudioFiles(audioRoot, days);
    if (stats.scanned > 0 || stats.deleted > 0 || asyncStats.scanned > 0 || asyncStats.deleted > 0) {
      logger.info(
        { ...stats, asyncStats, days, root: audioRoot },
        'audioRetentionScheduler: purge complete',
      );
    }
  } catch (err) {
    logger.error({ err }, 'audioRetentionScheduler: tick failed');
  } finally {
    alreadyRunning = false;
  }
}

export function startAudioRetentionScheduler(): cron.ScheduledTask | null {
  const cronExpr = process.env.AUDIO_RETENTION_CRON ?? '0 3 * * *'; // daily at 03:00
  if (!cron.validate(cronExpr)) {
    logger.error({ cronExpr }, 'audioRetentionScheduler: invalid AUDIO_RETENTION_CRON');
    return null;
  }
  const task = cron.schedule(cronExpr, () => { void tick(); }, {
    timezone: process.env.AUDIO_RETENTION_TZ || 'Australia/Melbourne',
  });
  logger.info({ cronExpr, days: getAudioRetentionDays() }, 'audioRetentionScheduler started');
  return task;
}

// BUG-042 — static import of shutdown registry.
import { registerShutdownHook } from '../../shared/gracefulShutdown';

if (process.env.NODE_ENV !== 'test') {
  setImmediate(() => {
    try {
      const task = startAudioRetentionScheduler();
      // BUG-042 — stop cron at priority 85 before DB pool destroy.
      if (task) {
        registerShutdownHook({
          name: 'scheduler:audio-retention',
          priority: 85,
          handler: async () => { task.stop(); },
        });
      }
    } catch (err) {
      logger.error({ err }, 'audioRetentionScheduler failed to start');
    }
  });
}
