import { runScheduledTick } from './runScheduledTick';
import { outlookCalendarSyncService } from '../../integrations/outlook/outlookCalendarSyncService';

export const outlookCalendarSubscriptionTask = runScheduledTick({
  schedulerName: 'outlookCalendarSubscription',
  cronExpression: '15 */6 * * *',
  dbAccess: 'dbAdmin',
  tick: async (now) => outlookCalendarSyncService.renewExpiringSubscriptions(now),
  startMessage: 'Running Outlook calendar subscription scheduler',
  successMessage: 'Outlook calendar subscription scheduler tick complete',
  errorMessage: 'Outlook calendar subscription scheduler failed',
  successMeta: (result, now) => ({
    tickAt: now.toISOString(),
    scanned: result.scanned,
    renewed: result.renewed,
    failed: result.failed,
  }),
});
