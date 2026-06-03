import { Worker, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { withTenantContext } from '../../shared/tenantContext';
import {
  processEmailJobData,
  type EmailJobData,
  PermanentEmailJobError,
} from './emailWorkerService';

const QUEUE_NAME = 'email';

const connection = new IORedis(
  String((config as Record<string, unknown>).REDIS_URL ?? 'redis://localhost:6379'),
  { maxRetriesPerRequest: null },
);

const worker = new Worker<EmailJobData>(
  QUEUE_NAME,
  async (job) => {
    const clinicId = job.data.clinicId;
    if (!clinicId) {
      throw new UnrecoverableError('email worker job missing clinicId');
    }

    try {
      return await withTenantContext(clinicId, async () => processEmailJobData(job.data));
    } catch (err) {
      if (err instanceof PermanentEmailJobError) {
        logger.warn(
          { err, jobId: job.id, clinicId, type: job.data.type },
          'email worker — permanent error, not retrying',
        );
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  },
  { connection, concurrency: 4 },
);

worker.on('ready', () => {
  logger.info({ queue: QUEUE_NAME }, 'email worker ready');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err, data: job?.data }, 'email worker job failed');
});

registerShutdownHook({
  name: `bullmq-worker:${QUEUE_NAME}`,
  priority: 60,
  handler: async () => { await worker.close(); },
});

export default worker;
