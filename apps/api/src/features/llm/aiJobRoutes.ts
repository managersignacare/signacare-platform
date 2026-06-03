/**
 * @admin-only — async AI job queue, no UI caller yet
 *
 * AI Job Routes — Async AI processing via BullMQ
 *
 * POST /api/v1/ai/jobs       — Submit an AI job (returns jobId immediately)
 * GET  /api/v1/ai/jobs/:id   — Poll job status (fallback if SSE unavailable)
 * GET  /api/v1/ai/jobs       — List recent jobs for current user
 *
 * Results are pushed via SSE in real-time. Polling is only needed as fallback.
 *
 * Rationale (DEAD-MOUNT exemption per Phase 0.7 PR2): the synchronous
 * /llm/clinical-ai endpoint is what every clinical surface (Summary,
 * Medications, Legal tabs etc.) actually calls today. The async /ai/jobs
 * queue is staged for the future move to long-running AI tasks (multi-document
 * summaries, batch chart reviews) but no UI submits jobs yet. The aiWorker
 * is wired to BullMQ. Operators can submit test jobs via curl. When a UI
 * surface adopts the async queue, remove the sentinel. See
 * docs/admin-routes.md.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { randomUUID } from 'crypto';
import { Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { authMiddleware } from '../../middleware/authMiddleware';
import { AI_QUEUE_NAME } from '../../jobs/workers/aiWorker';
import type { AiJobData } from '../../jobs/workers/aiWorker';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';

// Local Zod schema (Phase R3b / CLAUDE.md §12). Action is a free-form
// dispatcher key consumed by aiWorker; data is stringified before enqueue
// so any shape is acceptable but presence + non-empty are required.
const AiJobSubmitSchema = z.object({
  action: z.string().min(1).max(100),
  data: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
  model: z.string().max(200).optional(),
  patientId: z.string().uuid().optional(),
});

const router = Router();
router.use(authMiddleware);

// Queue instance for submitting jobs
const connection = new IORedis(config.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const aiQueue = new Queue<AiJobData>(AI_QUEUE_NAME, { connection });

// ── Submit AI Job ──
router.post('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  let parsed: z.infer<typeof AiJobSubmitSchema>;
  try {
    parsed = AiJobSubmitSchema.parse(req.body);
  } catch (err) {
    next(err);
    return;
  }
  const { action, data, model, patientId } = parsed;

  if (action === 'ambient') {
    if (!patientId) {
      next(new AppError('ambient jobs require patientId', 422, 'VALIDATION_ERROR'));
      return;
    }
    const auth = buildAuthContext(req, patientId);
    await requirePatientRelationship(auth, patientId);
  }

  const jobId = randomUUID();
  const jobData: AiJobData = {
    jobId,
    action,
    data: typeof data === 'string' ? data : JSON.stringify(data),
    model,
    patientId,
    staffId: req.user!.id,
    clinicId: req.clinicId,
  };

  try {
    await aiQueue.add(action, jobData, {
      jobId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600 },   // Keep for 1 hour
      removeOnFail: { age: 86400 },       // Keep failures for 24 hours
    });

    logger.info({ jobId, action, staffId: req.user!.id }, 'AI job submitted');

    res.status(202).json({
      jobId,
      action,
      status: 'queued',
      message: 'Job submitted. Results will be delivered via SSE or poll GET /ai/jobs/:id',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, message, action }, 'Failed to submit AI job');
    next(new AppError('Failed to queue AI job', 500, 'JOB_QUEUE_ERROR'));
  }
});

// ── Get Job Status ──
router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = await Job.fromId(aiQueue, req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const state = await job.getState();
    const result = job.returnvalue;

    res.json({
      jobId: job.id,
      action: job.name,
      status: state,
      result: state === 'completed' ? result?.result : undefined,
      validated: result?.validated,
      validationWarnings: result?.validationWarnings,
      completedAt: result?.completedAt,
      failedReason: state === 'failed' ? job.failedReason : undefined,
      progress: job.progress,
    });
  } catch {
    res.status(404).json({ error: 'Job not found' });
  }
});

// ── List Recent Jobs ──
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const completed = await aiQueue.getCompleted(0, 10);
    const active = await aiQueue.getActive(0, 5);
    const waiting = await aiQueue.getWaiting(0, 5);

    const staffId = req.user!.id;
    const format = (jobs: Job<AiJobData>[], status: string) =>
      jobs
        .filter(j => j.data.staffId === staffId)
        .map(j => ({
          jobId: j.id,
          action: j.name,
          status,
          result: status === 'completed' ? j.returnvalue?.result?.substring(0, 200) : undefined,
          submittedAt: j.timestamp ? new Date(j.timestamp).toISOString() : undefined,
        }));

    res.json({
      jobs: [
        ...format(active, 'processing'),
        ...format(waiting, 'queued'),
        ...format(completed, 'completed'),
      ],
    });
  } catch {
    res.json({ jobs: [] });
  }
});

export default router;
