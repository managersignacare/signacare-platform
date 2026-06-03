// apps/api/src/worker.ts
import { createOcrWorker } from '../queues/ocrQueue';
import { logger } from '../utils/logger';

async function bootstrap() {
  createOcrWorker();
  logger.info('OCR worker started');
}

bootstrap().catch((err) => {
  // BUG-267 L4 absorption — route through logger so the custom err
  // serializer (sanitizeErrForLogging) redacts PHI from any PG
  // constraint-violation message embedded in err.message / .stack.
  logger.fatal({ err }, 'OCR worker bootstrap failed');
  process.exit(1);
});
