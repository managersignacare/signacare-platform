// apps/api/src/jobs/bootstrap.ts
import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import http from 'http';
import { logger } from '../utils/logger';
import { resolveBinary } from '../shared/binaryResolver';

export function startWorkers(): void {
  // Phase 12B — patientOutreachWorker consumes the 'patient-outreach'
  // queue and dispatches via patientOutreachService (FCM / ACS SMS /
  // audit-logged skip). It's the worker the appointment scheduler and
  // every patient-destined emitter indirectly feeds.
  const workers = ['emailWorker', 'llmWorker', 'flagWorker', 'outlookWorker', 'patientOutreachWorker'];
  for (const w of workers) {
    import(`./workers/${w}`).catch(err => logger.error({ err, worker: w }, `[Bootstrap] Failed to load worker: ${w}`));
  }
  logger.info('BullMQ workers started');
}

export function startSchedulers(): void {
  // S1.3: backupScheduler reads backup_config every minute and runs
  // pg_dump if the schedule says it should. It replaces the prior
  // setInterval-based scheduler that lived in backupRoutes.ts.
  // S2.4: matviewRefreshScheduler is opt-in via MATVIEW_REFRESH_VIEWS
  // and is a no-op (no scheduler started) when that env var is unset.
  // S5.3: audioRetentionScheduler walks uploads/audio/* daily and
  // deletes anything older than AUDIO_RETENTION_DAYS (default 30).
  // For S3 backends it logs a reminder and defers to bucket lifecycle.
  // BUG-283: auditOutboxDrainer ticks every 30 s, drains the Redis
  // `audit:outbox` list, retries DB inserts. On sustained backlog
  // emits kind=audit_outbox_backlog for Azure Monitor alerting.
  // BUG-372a — pathologyCriticalScheduler (every 15 min, AEST) walks
  // unacknowledged critical pathology results and emits a per-recipient
  // notification idempotent by UTC-day dedupe key.
  // BUG-372b — mhaReviewScheduler (hourly, AEST) walks legal_orders +
  // patient_legal_orders for review-window tiers (T-7d/T-3d/T-1d/T-0/
  // T+overdue) and emits per-recipient notifications. Replaces the
  // pre-existing `mhaExpiryScheduler` stub (export {}).
  // BUG-372c — prescriptionRepeatScheduler (daily 06:00 AEST) walks
  // active prescriptions for repeat-due tiers (T-7d/T-1d/T+overdue);
  // promotes clozapine/lithium/depot drug-class to critical at all
  // tiers; consumed_count derived from erx_tokens.dispensed_at.
  // BUG-374b — dataRetentionScheduler (annual 1st January 04:00 AEST)
  // walks patients past 25-year floor + per-clinic retention config
  // (3-clock predicate). Triple-lock production arming: env DRY_RUN
  // gate + per-clinic retention_purge_enabled flag + manager approval
  // (segregation of duties + 30-day TTL). Calls anonymisePatientService
  // per row; idempotent via patients.purged_at; audit_log per ANONYMISE.
  // BUG-592 — therapeuticLevelMonitoringScheduler (daily 06:30 AEST)
  // walks active prescriptions of lithium / valproate / carbamazepine
  // / warfarin and joins each patient's most-recent matching
  // pathology_results to detect overdue surveillance. Consolidates
  // BUG-571 (lithium) + BUG-580 (warfarin/INR) into a single
  // drug-class-driven scheduler.
  // BUG-570 — laiAlertScheduler (daily 07:00 AEST) walks active
  // `lai_schedules.next_due_date` and emits T-7d/T-3d/T-1d/up-overdue
  // reminders with inactive-recipient fallback to clinic admin.
  // BUG-573 — advanceDirectiveReviewScheduler (daily 07:10 AEST)
  // walks active `advance_directives.valid_until` for review-window
  // tiers (T-30d/T-14d/T-7d/T-1d/T+overdue) with inactive-recipient
  // fallback to clinic admin.
  // BUG-574 — clozapineMonitoringWeekScheduler (daily 07:20 AEST)
  // walks active clozapine registrations in monitoring weeks 1..18
  // and emits review-point reminders from `next_blood_due_date`
  // (T-3d/T-1d/T-0d/T+overdue) with inactive-recipient fallback to
  // clinic admin.
  // BUG-572 — ectConsentExpiryScheduler (daily 07:30 AEST) walks
  // active/planned ECT courses and derives consent expiry from
  // `consent_date + ect_consent_validity_days` (default 180; per-clinic
  // threshold override). Emits T-7d warning and T+overdue critical
  // reminders with inactive-recipient fallback to clinic admin.
  // BUG-581 — suicidalIdeationAfterHoursScheduler (every 5 minutes)
  // scans recently-created clinical notes for high suicide-risk-linked
  // notes authored outside shift windows, then routes critical alerts to
  // the on-call psychiatrist (or admin fallback with immutable audit).
  // BUG-577/584-FOLLOWUP — clinicAdminSlotBootstrapCheck runs once at
  // scheduler bootstrap to surface pre-existing clinics that have both
  // admin slots unset (nominated + delegated). New clinics are covered
  // at create time by clinicService guard.
  // BUG-EPISODE-WORKFLOW-EVENT-SILENT-CATCH — workflowOutboxDrainer
  // drains `workflow:event:outbox` and re-emits deferred events once
  // workflow listeners recover.
  const schedulers = ['laiAlertScheduler', 'advanceDirectiveReviewScheduler', 'clozapineMonitoringWeekScheduler', 'ectConsentExpiryScheduler', 'suicidalIdeationAfterHoursScheduler', 'clozapineAlertScheduler', 'mhaReviewScheduler', 'referralSlaScheduler', 'appointmentReminderScheduler', 'pathologyCriticalScheduler', 'prescriptionRepeatScheduler', 'therapeuticLevelMonitoringScheduler', 'stepCareAutomationScheduler', 'digitalPhenotypingScheduler', 'dataRetentionScheduler', 'backupScheduler', 'matviewRefreshScheduler', 'audioRetentionScheduler', 'auditOutboxDrainer', 'workflowOutboxDrainer'];
  for (const s of schedulers) {
    import(`./schedulers/${s}`).catch(err => logger.error({ err, scheduler: s }, `[Bootstrap] Failed to load scheduler: ${s}`));
  }
  import('./schedulers/clinicAdminSlotBootstrapCheck')
    .then(async ({ runClinicAdminSlotBootstrapCheck }) => {
      const out = await runClinicAdminSlotBootstrapCheck();
      logger.info(
        {
          kind: 'CLINIC_ADMIN_SLOT_BOOTSTRAP_CHECK_COMPLETE',
          scanned: out.scanned,
          alerted: out.alerted,
          skippedRecent: out.skippedRecent,
          errors: out.errors,
        },
        'clinic admin slot bootstrap check completed',
      );
    })
    .catch((err) => {
      logger.error(
        { err },
        'clinic admin slot bootstrap check failed to execute',
      );
    });
  logger.info('Schedulers started');
}

// ── Whisper Server Auto-Start ────────────────────────────────────────────────
// Starts the Whisper transcription server as a child process if not already
// running. Checks health periodically and restarts if it crashes.

const WHISPER_URL = process.env.WHISPER_API_URL ?? 'http://localhost:8080';
const WHISPER_HEALTH = `${WHISPER_URL}/health`;
const MAX_RESTART_ATTEMPTS = 3;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
const STARTUP_DELAY_MS = 5_000; // wait before first health check

let whisperProcess: ChildProcess | null = null;
let restartCount = 0;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

function isWhisperHealthAccessLog(message: string): boolean {
  return message.includes('"GET /health HTTP/1.1" 200');
}

function isWhisperDevServerBanner(message: string): boolean {
  return message.includes('development server')
    || message.includes('Running on http://')
    || message.includes('Press CTRL+C to quit');
}

function findWhisperScript(): string | null {
  // Check multiple possible locations
  const candidates = [
    path.resolve(process.cwd(), 'deploy/whisper-server/server.py'),
    path.resolve(process.cwd(), '../deploy/whisper-server/server.py'),
    path.resolve(process.cwd(), '../../deploy/whisper-server/server.py'),
    path.resolve(__dirname, '../../../deploy/whisper-server/server.py'),
    // Installed location (macOS .app bundle)
    path.join(process.env.SIGNACARE_HOME ?? '', 'whisper-server/server.py'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function checkWhisperHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(WHISPER_HEALTH, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function spawnWhisper(scriptPath: string): void {
  if (whisperProcess) {
    try { whisperProcess.kill(); } catch { /* already dead */ }
    whisperProcess = null;
  }

  const port = new URL(WHISPER_URL).port || '8080';
  // Operators on macOS often have multiple python3 binaries on PATH
  // (system, homebrew, python.org installer). Flask + whisper may be
  // installed in only one of them, and `spawn('python3', ...)` picks
  // whichever is earliest on the child's PATH — frequently the wrong
  // one. WHISPER_PYTHON is the first-class env override; when unset
  // the shared resolver walks /opt/homebrew, /usr/local, /usr/bin in
  // order and falls back to the plain name for Linux containers
  // where the default pick is already correct.
  const pythonBin = process.env.WHISPER_PYTHON || resolveBinary('python3');
  logger.info({ scriptPath, port, pythonBin }, '[Whisper] Starting Whisper transcription server');

  whisperProcess = spawn(pythonBin, [scriptPath, '--port', port], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  whisperProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) logger.info({ source: 'whisper' }, `[Whisper] ${msg}`);
  });

  whisperProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg || msg.includes('FutureWarning') || msg.includes('UserWarning')) return;
    if (isWhisperHealthAccessLog(msg)) {
      logger.debug({ source: 'whisper' }, `[Whisper] ${msg}`);
      return;
    }
    if (isWhisperDevServerBanner(msg)) {
      logger.info({ source: 'whisper' }, `[Whisper] ${msg}`);
      return;
    }
    logger.warn({ source: 'whisper' }, `[Whisper] ${msg}`);
  });

  whisperProcess.on('exit', (code, signal) => {
    logger.warn({ code, signal }, '[Whisper] Whisper server exited');
    whisperProcess = null;

    // Auto-restart if under limit
    if (restartCount < MAX_RESTART_ATTEMPTS) {
      restartCount++;
      logger.info({ attempt: restartCount, max: MAX_RESTART_ATTEMPTS }, '[Whisper] Restarting...');
      setTimeout(() => spawnWhisper(scriptPath), 3000);
    } else {
      logger.error('[Whisper] Max restart attempts reached. Whisper will not be restarted automatically.');
    }
  });
}

export async function startWhisperServer(): Promise<void> {
  // Skip if explicitly disabled
  if (process.env.WHISPER_DISABLED === 'true') {
    logger.info('[Whisper] Disabled via WHISPER_DISABLED=true');
    return;
  }

  // Check if already running
  const alreadyRunning = await checkWhisperHealth();
  if (alreadyRunning) {
    logger.info('[Whisper] Whisper server already running');
    startHealthMonitor();
    return;
  }

  // Find the script
  const scriptPath = findWhisperScript();
  if (!scriptPath) {
    logger.warn('[Whisper] server.py not found — ambient transcription unavailable. Looked in deploy/whisper-server/');
    return;
  }

  // Spawn
  spawnWhisper(scriptPath);
  startHealthMonitor();
}

function startHealthMonitor(): void {
  if (healthCheckTimer) return;

  // Delay first check to allow startup. CLAUDE.md §3.2 + §9.6 —
  // the setInterval body is wrapped in try/catch so a single
  // check failure (network blip, spawn error) can't kill the
  // interval and leave Whisper unmonitored.
  setTimeout(() => {
    healthCheckTimer = setInterval(async () => {
      try {
        const healthy = await checkWhisperHealth();
        if (!healthy && !whisperProcess) {
          // External Whisper may have been stopped — try to restart
          const scriptPath = findWhisperScript();
          if (scriptPath && restartCount < MAX_RESTART_ATTEMPTS) {
            restartCount++;
            logger.warn({ attempt: restartCount }, '[Whisper] Health check failed, attempting restart');
            spawnWhisper(scriptPath);
          }
        } else if (healthy) {
          // Reset restart counter on successful health check
          restartCount = 0;
        }
      } catch (err) {
        logger.error({ err }, '[Whisper] health check interval threw — swallowed to keep interval alive');
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export function stopWhisperServer(): void {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
  if (whisperProcess) {
    logger.info('[Whisper] Stopping Whisper server');
    try { whisperProcess.kill('SIGTERM'); } catch { /* already dead */ }
    whisperProcess = null;
  }
}
