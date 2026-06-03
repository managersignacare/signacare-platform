// apps/api/src/jobs/schedulers/referralSlaScheduler.ts
// Runs hourly to process team-mode referral reminders and auto-close.
//
// BUG-583 (2026-04-26) — switched bare `db()` → `dbAdmin` for tenant-table
// reads + writes. Outside any request context the `db` proxy falls
// through to `appPool` (app_user role) and the RLS policy
// `clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid`
// evaluates to `clinic_id = NULL` → all rows excluded. The scheduler
// was silently producing zero referral SLA reminders + zero auto-closes
// in production. `dbAdmin` (signacare_owner) bypasses RLS by ownership;
// per-row `clinic_id` is FK-bound and propagated into every emit.
// Repository methods called from this scheduler now accept an optional
// connection arg defaulting to `db` for request-scoped callers.
import { referralRepository } from '../../features/referrals/referralRepository';
import { referralFeedbackService } from '../../features/referrals/referralFeedbackService';
// BUG-602 — cascade closure of BUG-583's silent-zero class. Use the
// admin sibling for tasks (uses dbAdmin internally per HL7 worker
// precedent at taskService.ts:70). For createThread + episodeService.close
// + sendClosedNoResponseFeedback, pass dbAdmin via the new optional `conn`
// parameter on each.
import { createTaskInternalAdmin } from '../../features/tasks/taskService';
import { createThread } from '../../features/messaging/messageService';
import { dbAdmin } from '../../db/db';
import logger from '../../utils/logger';
import { runScheduledTick } from './runScheduledTick';
import { emitSchedulerSignal } from './schedulerSignalEmitter';
import {
  OUTBOUND_REFERRAL_SOURCE,
  type AuthContext,
} from '@signacare/shared';

interface ReferralSlaTickResult {
  intakeAcknowledgements: number;
  reminders3Day: number;
  reminders7Day: number;
  autoClosed: number;
  expired12Month: number;
}

function systemAuthForClinic(clinicId: string): AuthContext {
  return {
    clinicId,
    staffId: 'system',
    role: 'superadmin',
    permissions: [],
  };
}

/**
 * Process referral reminders and auto-close for team-mode referrals.
 * Should be called on an hourly cron schedule.
 */
export async function processReferralReminders(): Promise<ReferralSlaTickResult> {
  const intakeAcknowledgements = await processIntakeAcknowledgementSla();
  const reminders3Day = await process3DayReminders();
  const reminders7Day = await process7DayReminders();
  const autoClosed = await processAutoClose();
  const expired12Month = await processTwelveMonthExpiry();
  return { intakeAcknowledgements, reminders3Day, reminders7Day, autoClosed, expired12Month };
}

// ── Intake acknowledgement SLA (1 hour) ─────────────────────────────────

async function processIntakeAcknowledgementSla(): Promise<number> {
  const candidates = await dbAdmin('referrals as r')
    .whereNull('r.deleted_at')
    .whereNot('r.source', OUTBOUND_REFERRAL_SOURCE)
    .whereNotNull('r.from_provider_email')
    .whereRaw("r.created_at < (NOW() - INTERVAL '1 hour')")
    .whereNotExists(
      dbAdmin('referral_feedback_log as f')
        .select(dbAdmin.raw('1'))
        .whereRaw('f.referral_id = r.id')
        .andWhereRaw('f.clinic_id = r.clinic_id')
        .andWhere('f.feedback_type', 'acknowledged'),
    )
    .select('r.id', 'r.clinic_id');

  for (const row of candidates) {
    try {
      await referralFeedbackService.sendIntakeAcknowledgement(
        systemAuthForClinic(String(row.clinic_id)),
        String(row.id),
        dbAdmin,
      );
    } catch (err) {
      logger.error({ err, referralId: row.id }, 'Failed intake acknowledgement SLA send');
    }
  }

  return candidates.length;
}

// ── 3-day reminder ────────────────────────────────────────────────────────

async function process3DayReminders(): Promise<number> {
  const referrals = await referralRepository.listReferralsForReminder('3day', dbAdmin);

  for (const referral of referrals) {
    try {
      const pendingStaffIds = await referralRepository.listPendingOfferStaffIds(referral.id, dbAdmin);
      const patientName = referral.patient_id
        ? await getPatientName(referral.clinic_id, referral.patient_id)
        : 'Unknown patient';

      const message = `Referral ${referral.referral_number} for ${patientName} has had no response for 3 days. Please review.`;

      // Notify each pending clinician
      for (const staffId of pendingStaffIds) {
        await notifyStaff(referral.clinic_id, staffId, referral, message, 'medium');
      }

      // Notify front desk who created the referral
      if (referral.created_by_staff_id) {
        await notifyStaff(referral.clinic_id, referral.created_by_staff_id, referral, message, 'medium');
      }

      // Mark reminder sent
      await referralRepository.updateReferral(referral.clinic_id, referral.id, {
        reminder_sent_at: new Date(),
      }, dbAdmin);

      await referralRepository.insertWorkflowEvent({
        clinicId: referral.clinic_id,
        referralId: referral.id,
        eventType: 'reminder_3day',
        notes: `3-day reminder sent to ${pendingStaffIds.length} clinician(s)`,
      }, dbAdmin);

      logger.info({ referralId: referral.id, clinicians: pendingStaffIds.length }, '3-day reminder sent');
    } catch (err) {
      logger.error({ err, referralId: referral.id }, 'Failed to process 3-day reminder');
    }
  }
  return referrals.length;
}

// ── 7-day final reminder ──────────────────────────────────────────────────

async function process7DayReminders(): Promise<number> {
  const referrals = await referralRepository.listReferralsForReminder('7day', dbAdmin);

  for (const referral of referrals) {
    try {
      const pendingStaffIds = await referralRepository.listPendingOfferStaffIds(referral.id, dbAdmin);
      const patientName = referral.patient_id
        ? await getPatientName(referral.clinic_id, referral.patient_id)
        : 'Unknown patient';

      const message = `FINAL NOTICE: Referral ${referral.referral_number} for ${patientName} will be closed in 24 hours if no clinician accepts.`;

      // Notify each pending clinician with URGENT priority
      for (const staffId of pendingStaffIds) {
        await notifyStaff(referral.clinic_id, staffId, referral, message, 'urgent');
      }

      // Notify front desk
      if (referral.created_by_staff_id) {
        await notifyStaff(referral.clinic_id, referral.created_by_staff_id, referral, message, 'urgent');
      }

      // Set auto-close deadline
      const autoCloseAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      await referralRepository.updateReferral(referral.clinic_id, referral.id, {
        final_reminder_sent_at: new Date(),
        auto_close_at: autoCloseAt,
      }, dbAdmin);

      await referralRepository.insertWorkflowEvent({
        clinicId: referral.clinic_id,
        referralId: referral.id,
        eventType: 'reminder_7day_final',
        notes: `Final reminder sent. Auto-close at ${autoCloseAt.toISOString()}`,
      }, dbAdmin);

      logger.info({ referralId: referral.id }, '7-day final reminder sent');
    } catch (err) {
      logger.error({ err, referralId: referral.id }, 'Failed to process 7-day reminder');
    }
  }
  return referrals.length;
}

// ── Auto-close ────────────────────────────────────────────────────────────

async function processAutoClose(): Promise<number> {
  const referrals = await referralRepository.listReferralsForReminder('auto_close', dbAdmin);

  for (const referral of referrals) {
    try {
      // Close the referral
      await referralRepository.updateReferral(referral.clinic_id, referral.id, {
        status: 'closed_no_response',
        status_changed_at: new Date(),
      }, dbAdmin);

      // Expire all pending offers
      const pendingStaffIds = await referralRepository.listPendingOfferStaffIds(referral.id, dbAdmin);
      // BUG-583 — dbAdmin (signacare_owner) bypasses RLS so the bulk
      // UPDATE does not silently zero outside any request context.
      // BUG-602 — `clinic_id` added to WHERE per CLAUDE.md §1.3:
      // dbAdmin bypasses RLS by ownership so application-layer
      // clinic_id is the only enforcement. Defence-in-depth against
      // future cross-tenant referral_id collisions or admin scripts.
      await dbAdmin('referral_clinician_offers')
        .where({ referral_id: referral.id, response: 'pending', clinic_id: referral.clinic_id })
        .update({ response: 'expired', responded_at: new Date(), updated_at: new Date() });

      // Close intake episode if exists
      if (referral.linked_episode_id) {
        try {
          const { episodeService } = await import('../../features/episode/episodeService');
          const todayStr = new Date().toISOString().split('T')[0];
          // BUG-602 — pass dbAdmin so episodeRepository.findById/update
          // do not RLS-zero outside any request context.
          await episodeService.close(
            systemAuthForClinic(referral.clinic_id),
            referral.linked_episode_id,
            {
              endDate: todayStr,
              closureReason: 'Referral auto-closed — no clinician response within deadline',
            },
            dbAdmin,
          );
        } catch (err) {
          logger.warn({ err, referralId: referral.id }, 'Failed to close intake episode on auto-close');
        }
      }

      // Send feedback to referrer (BUG-602 — pass dbAdmin so the cascade
      // through findById/insertFeedbackLog/updateReferral/insertWorkflowEvent
      // does not RLS-zero/reject outside any request context).
      try {
        await referralFeedbackService.sendClosedNoResponseFeedback(
          systemAuthForClinic(referral.clinic_id),
          referral.id,
          dbAdmin,
        );
      } catch (err) {
        logger.warn({ err, referralId: referral.id }, 'Failed to send closure feedback to referrer');
      }

      // Notify front desk of closure
      if (referral.created_by_staff_id) {
        const patientName = referral.patient_id
          ? await getPatientName(referral.clinic_id, referral.patient_id)
          : 'Unknown patient';
        await notifyStaff(
          referral.clinic_id,
          referral.created_by_staff_id,
          referral,
          `Referral ${referral.referral_number} for ${patientName} has been auto-closed. No clinician accepted within the deadline. Referrer has been notified.`,
          'high',
        );
      }

      await referralRepository.insertWorkflowEvent({
        clinicId: referral.clinic_id,
        referralId: referral.id,
        eventType: 'auto_closed',
        notes: `Referral auto-closed. ${pendingStaffIds.length} pending offer(s) expired.`,
      }, dbAdmin);

      logger.info({ referralId: referral.id }, 'Referral auto-closed');
    } catch (err) {
      logger.error({ err, referralId: referral.id }, 'Failed to auto-close referral');
    }
  }
  return referrals.length;
}

// ── Long-term auto-expiry (12 months) ────────────────────────────────────
//
// BUG-WF71-EXPIRY-SCHEDULER-MISSING:
// Referrals that remain non-terminal for >12 months are auto-marked
// `expired` to enforce retention/compliance policy and avoid stale active
// queue rows.
async function processTwelveMonthExpiry(): Promise<number> {
  const terminalStatuses = ['rejected', 'redirected', 'closed_no_response', 'expired', 'appointment_booked'];
  const stale = await dbAdmin('referrals')
    .whereNull('deleted_at')
    .whereNotIn('status', terminalStatuses)
    .whereRaw("referral_date < (CURRENT_DATE - INTERVAL '12 months')")
    .select('id', 'clinic_id', 'referral_number', 'patient_id', 'created_by_staff_id', 'task_status');

  for (const referral of stale) {
    try {
      const previousTaskStatus = String(referral.task_status ?? '').trim() || null;
      const nextTaskStatus = 'completed';
      await dbAdmin('referrals')
        .where({ id: referral.id, clinic_id: referral.clinic_id })
        .update({
          status: 'expired',
          task_status: nextTaskStatus,
          status_changed_at: new Date(),
          updated_at: new Date(),
        });

      if (previousTaskStatus !== nextTaskStatus) {
        await dbAdmin('referral_state_transitions').insert({
          clinic_id: referral.clinic_id,
          referral_id: referral.id,
          from_task_status: previousTaskStatus,
          to_task_status: nextTaskStatus,
          actor_id: null,
          reason: 'Auto-expired after 12 months without terminal disposition.',
          created_at: new Date(),
        });
      }

      await referralRepository.insertWorkflowEvent({
        clinicId: referral.clinic_id,
        referralId: referral.id,
        eventType: 'expired',
        notes: 'Referral auto-expired after 12 months without terminal disposition.',
      }, dbAdmin);

      if (referral.created_by_staff_id) {
        await notifyStaff(
          referral.clinic_id,
          referral.created_by_staff_id,
          referral,
          `Referral ${referral.referral_number} has auto-expired after 12 months without a terminal outcome.`,
          'medium',
        );
      }
    } catch (err) {
      logger.error({ err, referralId: referral.id }, 'Failed to auto-expire stale referral');
    }
  }

  return stale.length;
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function notifyStaff(
  clinicId: string,
  staffId: string,
  referral: { id: string; referral_number: string; patient_id: string | null; clinic_id?: string },
  message: string,
  priority: 'low' | 'medium' | 'high' | 'urgent',
): Promise<void> {
  // 1. Create task (BUG-602 — admin sibling per HL7 worker precedent at
  // taskService.ts:70; uses dbAdmin internally).
  try {
    await createTaskInternalAdmin(clinicId, staffId, {
      assignedToId: staffId,
      patientId: referral.patient_id ?? undefined,
      title: message.length > 255 ? message.substring(0, 252) + '...' : message,
      description: message,
      priority,
    });
  } catch (err) {
    logger.warn({ err, staffId }, 'Failed to create reminder task');
  }

  // 2. Internal message (BUG-602 — pass dbAdmin so the message_threads +
  // message_thread_participants INSERTs do not RLS-reject).
  try {
    await createThread(
      {
        clinicId,
        staffId,
        role: 'system',
        permissions: [],
      },
      {
        subject: `Referral ${referral.referral_number} — Reminder`,
        patientId: referral.patient_id ?? undefined,
        participantIds: [staffId],
        recipientIds: [],
      },
      dbAdmin,
    );
  } catch (err) {
    logger.warn({ err, staffId }, 'Failed to create reminder message thread');
  }

  // 3. Durable notification + SSE push through the Phase 10A service.
  //    One call writes the bell row AND fires the live SSE event, so
  //    the clinician sees it the instant the client is connected and
  //    catches it from the bell on next login if they weren't.
  try {
    const severity: 'info' | 'warning' | 'critical' =
      priority === 'urgent' ? 'critical'
      : priority === 'high' ? 'warning'
      : 'info';
    await emitSchedulerSignal({
      clinicId: referral.clinic_id ?? clinicId,
      userId: staffId,
      severity,
      category: 'referral',
      title: `Referral SLA — ${referral.referral_number}`,
      body: message,
      actionUrl: `/referrals/${referral.id}`,
      payload: {
        referral_id: referral.id,
        referral_number: referral.referral_number,
        priority,
      },
      dedupeKey: `referral-sla:${referral.id}:${priority}`,
      // Preserve the legacy event type so any existing client listeners
      // on `referral-reminder` continue to receive the push alongside
      // the generic `notification` event the bell listens to.
      sseEventType: 'referral-reminder',
      signalKey: 'referral_sla_reminder',
    });
  } catch (err) {
    logger.warn({ err, staffId }, 'Failed to emit SLA reminder notification');
  }
}

async function getPatientName(clinicId: string, patientId: string): Promise<string> {
  // BUG-583 — dbAdmin so the SELECT does not RLS-zero outside any request.
  const patient = await dbAdmin('patients')
    .where({ id: patientId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .select('given_name', 'family_name')
    .first();
  if (!patient) return 'Unknown';
  return `${patient.given_name ?? ''} ${patient.family_name ?? ''}`.trim() || 'Unknown';
}

const referralSlaTask = runScheduledTick<ReferralSlaTickResult>({
  schedulerName: 'referral-sla',
  cronExpression: '0 * * * *',
  dbAccess: 'dbAdmin',
  startMessage: 'Running referral reminder scheduler',
  successMessage: 'Referral reminder scheduler tick complete',
  errorMessage: 'Referral reminder scheduler failed',
  tick: async () => processReferralReminders(),
  successMeta: (result) => ({
    intakeAcknowledgements: result.intakeAcknowledgements,
    reminders3Day: result.reminders3Day,
    reminders7Day: result.reminders7Day,
    autoClosed: result.autoClosed,
    expired12Month: result.expired12Month,
  }),
  zeroRow: {
    isZero: (result) =>
      result.intakeAcknowledgements === 0 &&
      result.reminders3Day === 0 &&
      result.reminders7Day === 0 &&
      result.autoClosed === 0 &&
      result.expired12Month === 0,
    kind: 'REFERRAL_SLA_ZERO_ROWS',
    message: 'Referral reminder scheduler found no due referrals this tick',
  },
});

export { referralSlaTask };
