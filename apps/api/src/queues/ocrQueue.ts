// apps/api/src/queues/ocrQueue.ts
import { Queue, Worker, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';
import { runOcr } from '../ocr/ocrAdapter';
// BUG-042 — canonical shutdown registry (static import per §9.6).
import { registerShutdownHook } from '../shared/gracefulShutdown';
import {
  saveOcrSuccess,
  saveOcrFailure,
} from '../features/referrals/ocrPersistence';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

const OCR_QUEUE_NAME = 'referral-ocr';

export interface OcrJobData {
  clinicId: string;
  referralId: string;
  attachmentId: string;
  storageKey: string;
  mimeType: string;
}

export const ocrQueue = new Queue<OcrJobData>(OCR_QUEUE_NAME, {
  connection,
});

export function createOcrWorker(): Worker<OcrJobData> {
  const worker = new Worker<OcrJobData>(
    OCR_QUEUE_NAME,
    async (job) => {
      const { clinicId, referralId, attachmentId, storageKey, mimeType } = job.data;

      logger.info(
        { clinicId, referralId, attachmentId, mimeType },
        'Starting local OCR job',
      );

      try {
        const ocrResult = await runOcr({
          storageKey,
          mimeType,
        });

        await saveOcrSuccess({
          clinicId,
          referralId,
          attachmentId,
          ocrResult,
        });

        return { status: 'ok' };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown OCR error';

        logger.error(
          { clinicId, referralId, attachmentId, err },
          'OCR job failed',
        );

        await saveOcrFailure({
          clinicId,
          referralId,
          attachmentId,
          errorMessage: message,
        });

        throw err;
      }
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        clinicId: job?.data?.clinicId,
        referralId: job?.data?.referralId,
        err,
      },
      'OCR worker failure',
    );
  });

  // BUG-042 — drain in-flight OCR jobs before DB close. OCR can take
  // 10+ seconds for a multi-page PDF so override per-worker timeout
  // to 15s (within 25s overall budget).
  registerShutdownHook({
    name: `bullmq-worker:${OCR_QUEUE_NAME}`,
    priority: 60,
    timeoutMs: 15_000,
    handler: async () => { await worker.close(); },
  });

  return worker;
}

export async function enqueueOcrJob(
  data: OcrJobData,
  options?: JobsOptions,
): Promise<void> {
  await ocrQueue.add('ocr', data, options);
}
