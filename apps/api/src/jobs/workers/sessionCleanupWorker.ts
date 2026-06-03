// apps/api/src/jobs/workers/sessionCleanupWorker.ts
//
// Purges expired and stale sessions from staff_sessions table.
// Runs every 6 hours. Prevents table bloat and ensures compliance
// with session management requirements (ISO 27001 A.8.5).

import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../../config';
import { dbAdmin } from '../../db/db';
import { logger } from '../../utils/logger';
// BUG-042 — canonical shutdown registry (static import per §9.6).
import { registerShutdownHook } from '../../shared/gracefulShutdown';

let redisConnection: IORedis | null = null;
try {
  redisConnection = new IORedis(config.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
} catch { /* Redis not available */ }

export const sessionCleanupQueue = redisConnection ? new Queue('session-cleanup', {
  connection: redisConnection,
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 5 },
}) : null;

export async function scheduleSessionCleanup(): Promise<void> {
  if (!sessionCleanupQueue) return;
  await sessionCleanupQueue.add('cleanup', {}, {
    repeat: { every: 6 * 60 * 60 * 1000 }, // Every 6 hours
    jobId: 'session-cleanup-6h',
  });
  logger.info('Session cleanup scheduled every 6 hours');
}

if (redisConnection) {
  const sessionCleanupWorker = new Worker(
    'session-cleanup',
    async (_job: Job) => {
      // Delete expired sessions older than 30 days
      const expiredResult = await dbAdmin('staff_sessions')
        .where('expires_at', '<', new Date())
        .where('created_at', '<', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .delete();

      // Delete revoked sessions older than 7 days
      const revokedResult = await dbAdmin('staff_sessions')
        .whereNotNull('revoked_at')
        .where('revoked_at', '<', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .delete();

      logger.info({ expired: expiredResult, revoked: revokedResult }, 'Session cleanup complete');
      return { expired: expiredResult, revoked: revokedResult };
    },
    { connection: redisConnection, concurrency: 1 },
  );
  sessionCleanupWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Session cleanup failed');
  });

  // BUG-042 — drain session cleanup worker before DB close.
  registerShutdownHook({
    name: 'bullmq-worker:session-cleanup',
    priority: 60,
    handler: async () => { await sessionCleanupWorker.close(); },
  });
}
