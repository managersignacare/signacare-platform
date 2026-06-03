/**
 * Database Backup Routes — S1.3 (persistent config + history)
 *
 * Replaces the prior in-memory `backupConfig` and setInterval-based
 * scheduler. The configuration now lives in the `backup_config` table
 * (single row, enforced by a partial unique index) and every backup run
 * is recorded in the `backup_history` table for audit and ops visibility.
 *
 * Why: the old in-memory config silently disabled scheduled backups on
 * every process restart, and the setInterval-based scheduler offered no
 * record of failures. Per the system-design audit, "untested backups
 * don't exist" — S1.3 lays the foundation for the monthly restore drill
 * (see backupRestoreDrillScheduler.ts) by giving us a real history table
 * to query.
 *
 * Naming:
 *   - DB columns snake_case
 *   - HTTP response fields camelCase via the camelCaseResponse middleware
 *   - Function exports camelCase
 *
 * Auth: every route requires authMiddleware + the admin/superadmin role.
 * No clinic_id — backups are global.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { dbAdmin } from '../../db/db';
import { logger } from '../../utils/logger';
import { resolveBinary } from '../../shared/binaryResolver';

const router = Router();
router.use(authMiddleware);

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
const BACKUP_CONFIG_COLUMNS = [
  'id', 'schedule_enabled', 'frequency', 'time_of_day', 'retention_days',
  'local_dir', 'offsite_target', 'last_run_at', 'last_run_status',
  'created_at', 'updated_at',
] as const;
const BACKUP_HISTORY_COLUMNS = [
  'id', 'started_at', 'finished_at', 'status', 'size_bytes', 'location',
  'error_text', 'trigger_kind', 'triggered_by_staff_id',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface BackupConfigRow {
  id: string;
  schedule_enabled: boolean;
  frequency: 'hourly' | 'daily' | 'weekly';
  time_of_day: string;
  retention_days: number;
  local_dir: string | null;
  offsite_target: string | null;
  last_run_at: Date | null;
  last_run_status: string | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Config helpers ──────────────────────────────────────────────────────────

/**
 * Read the singleton backup config row. Inserts the default row on first
 * read if the table is empty (defensive — the migration seeds it, but
 * a manual TRUNCATE could have removed it).
 */
export async function getBackupConfig(): Promise<BackupConfigRow> {
  // backup_config / backup_history are RLS-locked to signacare_owner
  // (migration 20260424000003); use dbAdmin for scheduler + routes.
  let row = await dbAdmin<BackupConfigRow>('backup_config').first();
  if (!row) {
    [row] = await dbAdmin<BackupConfigRow>('backup_config')
      .insert({
        schedule_enabled: true,
        frequency: 'daily',
        time_of_day: '02:00',
        retention_days: 30,
        local_dir: null,
      } as Partial<BackupConfigRow>)
      .returning(BACKUP_CONFIG_COLUMNS) as BackupConfigRow[];
  }
  return row;
}

async function updateBackupConfig(patch: Partial<BackupConfigRow>): Promise<BackupConfigRow> {
  const current = await getBackupConfig();
  const [updated] = await dbAdmin<BackupConfigRow>('backup_config')
    .where({ id: current.id })
    .update({ ...patch, updated_at: new Date() })
    .returning(BACKUP_CONFIG_COLUMNS) as BackupConfigRow[];
  return updated;
}

// ─── HTTP routes ─────────────────────────────────────────────────────────────

// GET /api/v1/backup/config — current config + last run + recent history
router.get('/config', requireRoles(['admin', 'superadmin']), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = await getBackupConfig();
    const recent = await dbAdmin('backup_history').orderBy('started_at', 'desc').limit(20);
    res.json({
      config: cfg,
      recentHistory: recent,
    });
  } catch (err) { next(err); }
});

// PUT /api/v1/backup/config — update config (schedule, retention, dirs, etc.)
router.put('/config', requireRoles(['admin', 'superadmin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed: Array<keyof BackupConfigRow> = [
      'schedule_enabled',
      'frequency',
      'time_of_day',
      'retention_days',
      'local_dir',
      'offsite_target',
    ];
    const patch: Partial<BackupConfigRow> = {};
    // Accept both snake_case and camelCase keys (the frontend sends camelCase
    // because of the camelCaseResponse middleware on the way IN it's still
    // camelCase). We map back to snake_case here.
    const camelToSnake: Record<string, keyof BackupConfigRow> = {
      scheduleEnabled: 'schedule_enabled',
      frequency: 'frequency',
      timeOfDay: 'time_of_day',
      retentionDays: 'retention_days',
      localDir: 'local_dir',
      offsiteTarget: 'offsite_target',
    };
    for (const [key, value] of Object.entries(req.body ?? {})) {
      const dbKey = camelToSnake[key] ?? (allowed.includes(key as keyof BackupConfigRow) ? (key as keyof BackupConfigRow) : null);
      if (dbKey) (patch as Record<string, unknown>)[dbKey] = value;
    }
    const updated = await updateBackupConfig(patch);
    logger.info({ action: 'backup_config_updated', patch }, 'Backup configuration updated');
    res.json({ config: updated });
  } catch (err) { next(err); }
});

// POST /api/v1/backup/run — trigger a manual backup
router.post('/run', requireRoles(['admin', 'superadmin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = await getBackupConfig();
    const dir = (req.body?.localDir as string) || cfg.local_dir || path.resolve(process.cwd(), '../../backups');
    const result = await runBackup(dir, 'manual', req.user?.id ?? null);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/backup/history — paginated history
router.get('/history', requireRoles(['admin', 'superadmin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const rows = await dbAdmin('backup_history').orderBy('started_at', 'desc').limit(limit);
    res.json({ history: rows });
  } catch (err) { next(err); }
});

// ─── Backup execution ────────────────────────────────────────────────────────

/**
 * Run a single pg_dump → gzip backup, write a history row for both the
 * start and the result. Returns the history row.
 */
export async function runBackup(
  backupDir: string,
  triggerKind: 'manual' | 'scheduled' | 'restore_drill',
  triggeredByStaffId: string | null,
): Promise<{ id: string; filename: string; sizeBytes: number; status: 'success' | 'failed'; error?: string }> {
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_').substring(0, 19);
  const filename = `signacare_backup_${timestamp}.sql.gz`;
  const filepath = path.join(backupDir, filename);

  // Insert the running row up-front so a crash mid-pg_dump leaves a
  // visible "running" record that can be reaped by ops.
  const [historyRow] = await dbAdmin('backup_history')
    .insert({
      started_at: new Date(),
      status: 'running',
      location: filepath,
      trigger_kind: triggerKind,
      triggered_by_staff_id: triggeredByStaffId,
    })
    .returning(BACKUP_HISTORY_COLUMNS);

  if (
    !process.env.DB_HOST ||
    !process.env.DB_PORT ||
    !process.env.DB_USER ||
    !process.env.DB_NAME ||
    !process.env.DB_PASSWORD
  ) {
    const err = 'Database environment variables (DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD) must be configured';
    await dbAdmin('backup_history')
      .where({ id: historyRow.id })
      .update({ status: 'failed', finished_at: new Date(), error_text: err });
    await updateBackupConfig({ last_run_at: new Date(), last_run_status: 'failed' });
    throw new Error(err);
  }

  const dbHost = process.env.DB_HOST;
  const dbPort = process.env.DB_PORT;
  const dbUser = process.env.DB_USER;
  const dbName = process.env.DB_NAME;
  const dbPass = process.env.DB_PASSWORD;

  // Resolve absolute paths so we don't inherit the child process
  // PATH — the same failure mode we hit with the Whisper sidecar on
  // macOS dev boxes with multiple homebrew / system python3 binaries.
  const pgDumpBin = resolveBinary('pg_dump');
  const gzipBin = resolveBinary('gzip');
  const gunzipBin = resolveBinary('gunzip');

  // pg_dump + gzip are wired via programmatic stdio pipe rather than
  // `exec('pg_dump … | gzip > file')`. Three reasons:
  //   1. No shell string — every argument is passed as a discrete
  //      array element so there is no command-injection surface even
  //      if one of the DB env vars contained shell metacharacters.
  //      Replaces the regex-sanitise workaround which was necessary
  //      only because of the shell-string pattern.
  //   2. DB_PASSWORD never touches the command line or the process
  //      table. We pass PGPASSWORD through the child env just like
  //      every pg_dump deployment manual recommends.
  //   3. pg_dump stderr is captured on the Node side so a real
  //      failure surfaces in backup_history.error_text instead of
  //      being redirected to /dev/null.
  return await new Promise((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: dbPass };
    const pgDump = spawn(pgDumpBin, [
      '-h', dbHost,
      '-p', dbPort,
      '-U', dbUser,
      '-d', dbName,
      '--format=plain',
      '--no-owner',
      '--no-privileges',
    ], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    });

    const gzip = spawn(gzipBin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,
    });

    const fileStream = fs.createWriteStream(filepath);

    pgDump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(fileStream);

    let pgDumpStderr = '';
    let gzipStderr = '';
    pgDump.stderr.on('data', (chunk: Buffer) => { pgDumpStderr += chunk.toString(); });
    gzip.stderr.on('data', (chunk: Buffer) => { gzipStderr += chunk.toString(); });

    let settled = false;
    const fail = async (err: Error) => {
      if (settled) return;
      settled = true;
      try { pgDump.kill('SIGTERM'); } catch { /* already dead */ }
      try { gzip.kill('SIGTERM'); } catch { /* already dead */ }
      fileStream.destroy();
      // Remove any partial file so a retried backup starts clean.
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { /* ignore */ }
      await dbAdmin('backup_history')
        .where({ id: historyRow.id })
        .update({ status: 'failed', finished_at: new Date(), error_text: err.message });
      await updateBackupConfig({ last_run_at: new Date(), last_run_status: 'failed' });
      reject(err);
    };

    pgDump.on('error', (err) => fail(new Error(`pg_dump spawn error: ${err.message}`)));
    gzip.on('error', (err) => fail(new Error(`gzip spawn error: ${err.message}`)));
    fileStream.on('error', (err) => fail(new Error(`backup file write error: ${err.message}`)));

    pgDump.on('close', (code) => {
      if (code !== 0 && !settled) {
        fail(new Error(`pg_dump exited ${code}: ${pgDumpStderr.trim() || '(no stderr)'}`));
      }
    });
    gzip.on('close', (code) => {
      if (code !== 0 && !settled) {
        fail(new Error(`gzip exited ${code}: ${gzipStderr.trim() || '(no stderr)'}`));
      }
    });

    fileStream.on('finish', async () => {
      if (settled) return;
      // Only finalise once both children have also closed cleanly.
      // fileStream.finish fires when gzip closes its stdout — which
      // happens after gzip's own close event — so we're safe to check
      // exit codes here synchronously.
      if (pgDump.exitCode !== 0) {
        return fail(new Error(`pg_dump exited ${pgDump.exitCode}: ${pgDumpStderr.trim()}`));
      }
      if (gzip.exitCode !== 0) {
        return fail(new Error(`gzip exited ${gzip.exitCode}: ${gzipStderr.trim()}`));
      }

      try {
        const stats = fs.statSync(filepath);
        // Verify gzip integrity. execFileSync with an array of args
        // — zero shell involvement so the filepath cannot break out
        // of its argument slot even if it contained spaces, quotes
        // or metacharacters.
        execFileSync(gunzipBin, ['-t', filepath], { timeout: 30_000, stdio: 'pipe' });

        await dbAdmin('backup_history')
          .where({ id: historyRow.id })
          .update({
            status: 'success',
            finished_at: new Date(),
            size_bytes: stats.size,
          });
        await updateBackupConfig({ last_run_at: new Date(), last_run_status: 'success' });

        logger.info({ filename, sizeBytes: stats.size, path: filepath, triggerKind }, 'Backup completed');
        settled = true;
        resolve({ id: historyRow.id, filename, sizeBytes: stats.size, status: 'success' });
      } catch (verifyErr) {
        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        fail(new Error(`Backup verification failed: ${msg}`));
      }
    });
  });
}

export function cleanOldBackups(backupDir: string, retentionDays: number): void {
  if (!fs.existsSync(backupDir)) return;

  const cutoff = Date.now() - retentionDays * 86400000;
  const files = fs.readdirSync(backupDir).filter((f) => f.startsWith('signacare_backup_') && f.endsWith('.sql.gz'));

  let deleted = 0;
  for (const file of files) {
    const filepath = path.join(backupDir, file);
    const stats = fs.statSync(filepath);
    if (stats.mtimeMs < cutoff) {
      fs.unlinkSync(filepath);
      deleted++;
    }
  }
  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, 'Old backups cleaned');
  }
}

export default router;
