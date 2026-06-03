import { redis } from '../../config/redis';
import { logger } from '../../utils/logger';
import { workflowEvents, type TriggerEvent, type WorkflowTriggerData } from './workflowEvents';

export const WORKFLOW_OUTBOX_KEY = 'workflow:event:outbox';
export const WORKFLOW_OUTBOX_MAX_RETRIES = 5;

interface WorkflowOutboxEntry {
  event: TriggerEvent;
  data: WorkflowTriggerData;
  retries: number;
  enqueuedAt: number;
  source: string;
  reason: string;
}

export interface WorkflowOutboxDrainResult {
  drained: number;
  requeued: number;
  stuck: number;
}

export async function enqueueWorkflowOutbox(input: {
  event: TriggerEvent;
  data: WorkflowTriggerData;
  source: string;
  reason: string;
}): Promise<void> {
  const entry: WorkflowOutboxEntry = {
    event: input.event,
    data: input.data,
    retries: 0,
    enqueuedAt: Date.now(),
    source: input.source,
    reason: input.reason,
  };

  try {
    await redis.lpush(WORKFLOW_OUTBOX_KEY, JSON.stringify(entry));
    logger.error(
      {
        kind: 'workflow_event_enqueued',
        event: input.event,
        clinicId: input.data.clinicId,
        source: input.source,
        reason: input.reason,
      },
      'Workflow event enqueue fallback used',
    );
  } catch (err) {
    logger.error(
      {
        err,
        kind: 'workflow_event_outbox_enqueue_failed',
        event: input.event,
        clinicId: input.data.clinicId,
        source: input.source,
        reason: input.reason,
      },
      'Workflow event enqueue fallback failed',
    );
  }
}

export async function workflowOutboxLength(): Promise<number> {
  try {
    return Number(await redis.llen(WORKFLOW_OUTBOX_KEY));
  } catch (err) {
    logger.error({ err, kind: 'workflow_event_outbox_length_failed' }, 'Failed to read workflow event outbox length');
    return -1;
  }
}

export async function drainWorkflowOutbox(batchSize = 50): Promise<WorkflowOutboxDrainResult> {
  const result: WorkflowOutboxDrainResult = { drained: 0, requeued: 0, stuck: 0 };

  for (let i = 0; i < batchSize; i += 1) {
    let raw: string | null;
    try {
      raw = await redis.rpop(WORKFLOW_OUTBOX_KEY);
    } catch (err) {
      logger.error({ err, kind: 'workflow_event_outbox_rpop_failed' }, 'Failed to RPOP workflow event outbox');
      break;
    }
    if (raw == null) break;

    let entry: WorkflowOutboxEntry;
    try {
      entry = JSON.parse(raw) as WorkflowOutboxEntry;
    } catch (err) {
      logger.error({ err, raw, kind: 'workflow_event_outbox_malformed' }, 'Malformed workflow outbox entry dropped');
      result.stuck += 1;
      continue;
    }

    try {
      if (!workflowEvents.hasListenersFor(entry.event)) {
        throw new Error(`No listeners registered for workflow event ${entry.event}`);
      }
      workflowEvents.emitWorkflow(entry.event, entry.data);
      result.drained += 1;
    } catch (err) {
      const retries = entry.retries + 1;
      if (retries >= WORKFLOW_OUTBOX_MAX_RETRIES) {
        logger.error(
          {
            err,
            kind: 'workflow_event_outbox_stuck',
            event: entry.event,
            clinicId: entry.data.clinicId,
            retries,
            source: entry.source,
            reason: entry.reason,
          },
          'Workflow outbox entry exceeded retry budget',
        );
        result.stuck += 1;
        continue;
      }

      const nextEntry: WorkflowOutboxEntry = {
        ...entry,
        retries,
      };
      try {
        await redis.lpush(WORKFLOW_OUTBOX_KEY, JSON.stringify(nextEntry));
        result.requeued += 1;
      } catch (pushErr) {
        logger.error(
          {
            err: pushErr,
            originalErr: err,
            kind: 'workflow_event_outbox_requeue_failed',
            event: entry.event,
            clinicId: entry.data.clinicId,
            source: entry.source,
            reason: entry.reason,
          },
          'Workflow event outbox requeue failed',
        );
        result.stuck += 1;
      }
    }
  }

  return result;
}
