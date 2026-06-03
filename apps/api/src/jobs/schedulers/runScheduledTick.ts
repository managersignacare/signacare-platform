import cron from 'node-cron';
import logger from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';

interface SchedulerLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

interface ZeroRowPolicy<TResult> {
  isZero: (result: TResult) => boolean;
  kind: string;
  message: string;
  meta?: (result: TResult, now: Date) => Record<string, unknown>;
}

export interface RunScheduledTickOptions<TResult> {
  schedulerName: string;
  cronExpression: string;
  dbAccess: 'dbAdmin' | 'db' | 'mixed';
  tick: (now: Date) => Promise<TResult>;
  logger?: SchedulerLogger;
  timezone?: string;
  shutdownPriority?: number;
  startMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  successMeta?: (result: TResult, now: Date) => Record<string, unknown>;
  zeroRow?: ZeroRowPolicy<TResult>;
}

/**
 * BUG-582
 * Shared scheduler shell for:
 * - cron registration
 * - AEST timezone default
 * - top-level try/catch
 * - structured zero-row warning (optional)
 * - shutdown hook registration at priority 85
 */
export function runScheduledTick<TResult>(
  options: RunScheduledTickOptions<TResult>,
): ReturnType<typeof cron.schedule> {
  const {
    schedulerName,
    cronExpression,
    dbAccess,
    tick,
    logger: schedulerLogger = logger,
    timezone = 'Australia/Melbourne',
    shutdownPriority = 85,
    startMessage = `Running ${schedulerName} scheduler`,
    successMessage = `${schedulerName} scheduler tick complete`,
    errorMessage = `${schedulerName} scheduler failed`,
    successMeta,
    zeroRow,
  } = options;

  const task = cron.schedule(
    cronExpression,
    async () => {
      const now = new Date();
      schedulerLogger.info({ schedulerName, dbAccess }, startMessage);
      try {
        const result = await tick(now);

        if (zeroRow && zeroRow.isZero(result)) {
          const event = {
            kind: zeroRow.kind,
            schedulerName,
            dbAccess,
            tickAt: now.toISOString(),
            ...(zeroRow.meta ? zeroRow.meta(result, now) : {}),
          };
          schedulerLogger.warn(event, zeroRow.message);
        }

        if (successMeta) {
          schedulerLogger.info(
            { schedulerName, dbAccess, ...successMeta(result, now) },
            successMessage,
          );
        } else {
          schedulerLogger.info({ schedulerName, dbAccess }, successMessage);
        }
      } catch (err) {
        schedulerLogger.error({ err, schedulerName, dbAccess }, errorMessage);
      }
    },
    { timezone },
  );

  if (process.env.NODE_ENV !== 'test') {
    registerShutdownHook({
      name: `scheduler:${schedulerName}`,
      priority: shutdownPriority,
      handler: async () => {
        task.stop();
      },
    });
  }

  return task;
}
