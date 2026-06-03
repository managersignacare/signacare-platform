// apps/api/src/jobs/workers/outlookWorker.ts
import { Worker, type Job } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../utils/logger';
// BUG-042 — canonical shutdown registry (static import per §9.6).
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import {
  createStaffEvent,
  updateStaffEvent,
  deleteStaffEvent,
} from '../../integrations/outlook/outlookCalendarService';
import { db } from '../../db/db';
import { withTenantContext } from '../../shared/tenantContext';

import IORedis from 'ioredis';
const connection = new IORedis(config.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

interface OutlookJobData {
  clinicId: string;
  clinicianId: string;
  appointmentId: string;
  type: 'create' | 'update' | 'delete';
  payload?: {
    subject: string;
    htmlBody: string;
    startIso: string;
    endIso: string;
    location?: string;
  };
}

const outlookWorker = new Worker(
  'outlook',
  async (job: Job) => {
    const data = job.data as OutlookJobData;

    // Wrap all DB queries in tenant context for RLS
    await withTenantContext(data.clinicId, async () => {
      if (data.type === 'create' && data.payload) {
        const eventId = await createStaffEvent(data.clinicianId, data.payload);
        await db('appointments')
          .where({ id: data.appointmentId, clinic_id: data.clinicId })
          .update({ outlook_event_id: eventId, updated_at: new Date() });
        logger.info({ eventId, appointmentId: data.appointmentId }, 'Outlook event created');
      } else if (data.type === 'update' && data.payload) {
        const appt = await db('appointments')
          .where({ id: data.appointmentId, clinic_id: data.clinicId })
          .first('outlook_event_id');
        if (appt?.outlook_event_id) {
          await updateStaffEvent(data.clinicianId, appt.outlook_event_id as string, data.payload);
          logger.info({ appointmentId: data.appointmentId }, 'Outlook event updated');
        }
      } else if (data.type === 'delete') {
        const appt = await db('appointments')
          .where({ id: data.appointmentId, clinic_id: data.clinicId })
          .first('outlook_event_id');
        if (appt?.outlook_event_id) {
          await deleteStaffEvent(data.clinicianId, appt.outlook_event_id as string);
          logger.info({ appointmentId: data.appointmentId }, 'Outlook event deleted');
        }
      }
    });
  },
  { connection, concurrency: 5 },
);
outlookWorker.on('failed', (job, err) => {
  // Non-blocking: EMR continues even if Outlook sync fails
  logger.error({ jobId: job?.id, err }, 'Outlook worker job failed');
});

// BUG-042 — drain in-flight Outlook sync jobs before DB close.
registerShutdownHook({
  name: 'bullmq-worker:outlook',
  priority: 60,
  handler: async () => { await outlookWorker.close(); },
});