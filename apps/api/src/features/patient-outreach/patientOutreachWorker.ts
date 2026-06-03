// apps/api/src/features/patient-outreach/patientOutreachWorker.ts
//
// Phase 12B — BullMQ worker for the 'patient-outreach' queue.
//
// Dequeues jobs enqueued by the appointment scheduler + the
// appointment service (and future patient-destined emitters). Each
// job payload is { kind, clinicId, patientId, title?, body?,
// deepLink?, forceChannel?, overrideReason?, overrideByStaffId? }.
// The worker calls patientOutreachService.send with the payload
// and the right actor id. Retries are limited to real provider
// errors — "no consent" / "no mobile number" are permanent-state
// skips that don't retry (BullMQ's `removeOnFail` handles the
// cleanup).
//
// Registered via apps/api/src/jobs/bootstrap.ts — the import-time
// side effect is registering the Worker with BullMQ against the
// allowlisted 'patient-outreach' queue name.
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
  processPatientOutreachJob,
  type OutreachJobData,
} from './patientOutreachWorkerProcessor';
// BUG-042 — drain in-flight outreach jobs before DB pool close.
import { registerShutdownHook } from '../../shared/gracefulShutdown';

const QUEUE_NAME = 'patient-outreach';

const connection = new IORedis(
  String((config as Record<string, unknown>).REDIS_URL ?? 'redis://localhost:6379'),
  { maxRetriesPerRequest: null },
);

const worker = new Worker<OutreachJobData>(
  QUEUE_NAME,
  async (job) => processPatientOutreachJob(job.data, job.id ?? undefined),
  { connection, concurrency: 4 },
);

worker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, err, data: job?.data },
    'patient-outreach worker — job failed',
  );
});

worker.on('ready', () => {
  logger.info({ queue: QUEUE_NAME }, 'patient-outreach worker ready');
});

// BUG-042 — register worker.close() so SIGTERM drains in-flight jobs
// (SMS / email / push delivery) before the DB pool destroys. Priority
// 60 is AFTER HTTP close (80) — no new jobs enqueue — and BEFORE DB (20).
// Default 5s timeout sufficient for notification providers.
registerShutdownHook({
  name: `bullmq-worker:${QUEUE_NAME}`,
  priority: 60,
  handler: async () => { await worker.close(); },
});

// The module's default export is the worker instance so
// apps/api/src/jobs/bootstrap.ts can reference it if needed for
// graceful shutdown. Most code just imports for the side effect.
export default worker;
