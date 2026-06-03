import {
  drainWorkflowOutbox,
  workflowOutboxLength,
} from '../../features/workflows/workflowOutbox';
import { logger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';

const DRAIN_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;
const BACKLOG_ALERT_THRESHOLD = 100;

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const lengthBefore = await workflowOutboxLength();
    if (lengthBefore === 0) return;

    const result = await drainWorkflowOutbox(BATCH_SIZE);
    const lengthAfter = await workflowOutboxLength();

    logger.info(
      {
        kind: 'workflow_event_outbox_drain_tick',
        lengthBefore,
        lengthAfter,
        drained: result.drained,
        requeued: result.requeued,
        stuck: result.stuck,
      },
      'Workflow event outbox drain tick',
    );

    if (lengthAfter >= BACKLOG_ALERT_THRESHOLD) {
      logger.error(
        { kind: 'workflow_event_outbox_backlog', length: lengthAfter },
        'Workflow event outbox backlog above alert threshold',
      );
    }
    if (result.stuck > 0) {
      logger.error(
        { kind: 'workflow_event_outbox_stuck_summary', stuck: result.stuck },
        'Workflow event outbox has stuck entries',
      );
    }
  } catch (err) {
    logger.error({ err, kind: 'workflow_event_outbox_drain_tick_failed' }, 'Workflow outbox drainer tick failed');
  }
}

export function startWorkflowOutboxDrainer(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    tick().catch((err) => {
      logger.error({ err, kind: 'workflow_event_outbox_drain_tick_unhandled' }, 'Workflow outbox tick unhandled');
    });
  }, DRAIN_INTERVAL_MS);
  logger.info(
    { kind: 'workflow_event_outbox_drainer_started', intervalMs: DRAIN_INTERVAL_MS, batchSize: BATCH_SIZE },
    'Workflow event outbox drainer started',
  );
}

export function stopWorkflowOutboxDrainer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
    logger.info({ kind: 'workflow_event_outbox_drainer_stopped' }, 'Workflow event outbox drainer stopped');
  }
}

if (process.env.NODE_ENV !== 'test') {
  setImmediate(() => {
    try {
      startWorkflowOutboxDrainer();
      registerShutdownHook({
        name: 'scheduler:workflow-outbox-drainer',
        priority: 84,
        handler: async () => {
          stopWorkflowOutboxDrainer();
          try {
            const result = await drainWorkflowOutbox(500);
            logger.info({ kind: 'workflow_event_outbox_final_drain', ...result }, 'Workflow outbox final drain on shutdown');
          } catch (err) {
            logger.error({ err, kind: 'workflow_event_outbox_final_drain_failed' }, 'Workflow outbox final drain failed');
          }
        },
      });
    } catch (err) {
      logger.error({ err }, 'workflowOutboxDrainer failed to start');
    }
  });
}
