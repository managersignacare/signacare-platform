import { randomBytes } from 'crypto';
import { AppError } from '../../shared/errors';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import {
  createStaffEventSubscription,
  deleteStaffEventSubscription,
  getStaffEvent,
  getStaffGraphIdentity,
  renewStaffEventSubscription,
  type StaffGraphCalendarEvent,
} from './outlookCalendarService';
import {
  outlookCalendarSyncRepository,
  type ExternalCalendarSubscriptionDb,
  type OutlookAppointmentSyncRow,
} from './outlookCalendarSyncRepository';
import { jobBus } from '../../shared/jobBus';

const OUTLOOK_SUBSCRIPTION_LIFETIME_MINUTES = 6 * 24 * 60;
const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

interface GraphWebhookNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: 'created' | 'updated' | 'deleted';
  lifecycleEvent?: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed';
  resource?: string;
  resourceData?: {
    id?: string;
  };
}

interface GraphWebhookEnvelope {
  value?: GraphWebhookNotification[];
}

export interface OutlookCalendarSyncStatus {
  connected: boolean;
  configured: boolean;
  email: string | null;
  subscription: {
    status: string;
    expiresAt: string | null;
    lastNotificationAt: string | null;
    lastRenewedAt: string | null;
    lastError: string | null;
  } | null;
}

export interface AppointmentGraphSyncPatch {
  appointment_start: Date;
  appointment_end: Date;
  start_time: Date;
  end_time: Date;
  telehealth: boolean;
  telehealth_url: string | null;
  mode: string | null;
  outlook_change_key: string | null;
  outlook_last_modified_at: Date | null;
  outlook_last_synced_at: Date;
  outlook_sync_status: string;
  outlook_sync_error: null;
  reminder_scheduled: boolean;
  reminder_sent: boolean;
  reminder_sent_at: Date | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAxiosStatus(error: unknown, status: number): boolean {
  const candidate = error as { response?: { status?: number } } | undefined;
  return candidate?.response?.status === status;
}

export function buildOutlookCalendarSyncUrls(baseUrl: string): {
  webhookUrl: string;
  lifecycleUrl: string;
} {
  const webhookUrl = new URL('/api/v1/integrations/outlook/calendar-sync/webhook', baseUrl).toString();
  return { webhookUrl, lifecycleUrl: webhookUrl };
}

export function graphDateTimeToIso(
  value: { dateTime?: string | null; timeZone?: string | null } | null | undefined,
): string | null {
  if (!value?.dateTime) return null;
  const raw = String(value.dateTime).trim();
  if (!raw) return null;

  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
    ? raw
    : `${raw}${String(value.timeZone ?? '').toUpperCase() === 'UTC' ? 'Z' : ''}`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isoToDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nextSubscriptionExpirationDate(now: Date): Date {
  return new Date(now.getTime() + OUTLOOK_SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000);
}

export function isSubscriptionExpiringSoon(
  expirationUtc: Date | string,
  now: Date,
): boolean {
  const expiration = expirationUtc instanceof Date ? expirationUtc : new Date(expirationUtc);
  return expiration.getTime() - now.getTime() <= RENEWAL_WINDOW_MS;
}

function makeClientState(): string {
  return randomBytes(24).toString('hex');
}

async function clearQueuedAppointmentReminders(
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  await Promise.all([
    jobBus.removeByMatch('email', {
      type: 'appointment_reminder',
      clinicId,
      appointmentId,
    }),
    jobBus.removeByMatch('patient-outreach', {
      kind: 'appointment_reminder',
      clinicId,
      appointmentId,
    }),
  ]);
}

export function buildAppointmentPatchFromGraphEvent(
  appointment: OutlookAppointmentSyncRow,
  event: StaffGraphCalendarEvent,
  now: Date,
): AppointmentGraphSyncPatch | null {
  const startIso = graphDateTimeToIso(event.start);
  const endIso = graphDateTimeToIso(event.end);
  const start = isoToDate(startIso);
  const end = isoToDate(endIso);
  if (!start || !end) return null;

  const joinUrl = event.onlineMeeting?.joinUrl ?? null;
  const previousStartMs = (appointment.appointment_start ?? appointment.start_time).getTime();
  const previousEndMs = (appointment.appointment_end ?? appointment.end_time).getTime();
  const timingChanged = previousStartMs !== start.getTime() || previousEndMs !== end.getTime();

  return {
    appointment_start: start,
    appointment_end: end,
    start_time: start,
    end_time: end,
    telehealth: Boolean(joinUrl) || appointment.telehealth,
    telehealth_url: joinUrl ?? appointment.telehealth_url ?? null,
    mode: joinUrl
      ? (appointment.mode === 'telehealth' ? 'telehealth' : 'videoconference')
      : appointment.mode,
    outlook_change_key: event.changeKey ?? null,
    outlook_last_modified_at: isoToDate(event.lastModifiedDateTime ?? null),
    outlook_last_synced_at: now,
    outlook_sync_status: 'synced',
    outlook_sync_error: null,
    reminder_scheduled: timingChanged ? false : appointment.reminder_scheduled,
    reminder_sent: timingChanged ? false : appointment.reminder_sent,
    reminder_sent_at: timingChanged ? null : appointment.reminder_sent_at,
  };
}

export function buildAppointmentCancellationPatch(now: Date): Record<string, unknown> {
  return {
    status: 'cancelled',
    cancellation_reason: 'Cancelled in linked Outlook calendar',
    outlook_last_synced_at: now,
    outlook_sync_status: 'deleted_remote',
    outlook_sync_error: null,
    reminder_scheduled: false,
    reminder_sent: false,
    reminder_sent_at: null,
  };
}

async function ensureConnectedStaff(staffId: string): Promise<{ email: string }> {
  try {
    return await getStaffGraphIdentity(staffId);
  } catch (error) {
    throw new AppError(
      errorMessage(error),
      409,
      'OUTLOOK_NOT_CONNECTED',
    );
  }
}

async function createSubscription(
  clinicId: string,
  ownerStaffId: string,
  clientState: string,
  now: Date,
): Promise<ExternalCalendarSubscriptionDb> {
  const { email } = await ensureConnectedStaff(ownerStaffId);
  const { webhookUrl, lifecycleUrl } = buildOutlookCalendarSyncUrls(config.apiBaseUrl);
  const expiration = nextSubscriptionExpirationDate(now);
  const created = await createStaffEventSubscription(ownerStaffId, {
    changeNotificationUrl: webhookUrl,
    lifecycleNotificationUrl: lifecycleUrl,
    clientState,
    expirationDateTime: expiration.toISOString(),
  });

  return outlookCalendarSyncRepository.saveActiveSubscription({
    clinicId,
    ownerStaffId,
    externalSubscriptionId: created.id,
    resource: created.resource || `users/${encodeURIComponent(email)}/events`,
    notificationUrl: webhookUrl,
    lifecycleNotificationUrl: lifecycleUrl,
    clientState,
    expirationUtc: new Date(created.expirationDateTime),
    status: 'active',
    lastRenewedAt: now,
    lastError: null,
  });
}

export const outlookCalendarSyncService = {
  async ensureSubscriptionForStaff(input: {
    clinicId: string;
    ownerStaffId: string;
    forceResubscribe?: boolean;
  }): Promise<ExternalCalendarSubscriptionDb> {
    const now = new Date();
    const existing = await outlookCalendarSyncRepository.findActiveByOwner(
      input.clinicId,
      input.ownerStaffId,
    );

    if (
      existing
      && !input.forceResubscribe
      && existing.status === 'active'
      && !isSubscriptionExpiringSoon(existing.expiration_utc, now)
    ) {
      return existing;
    }

    const clientState = existing?.client_state ?? makeClientState();

    if (existing && !input.forceResubscribe) {
      try {
        const renewed = await renewStaffEventSubscription(
          input.ownerStaffId,
          existing.external_subscription_id,
          nextSubscriptionExpirationDate(now).toISOString(),
        );
        return outlookCalendarSyncRepository.saveActiveSubscription({
          clinicId: input.clinicId,
          ownerStaffId: input.ownerStaffId,
          externalSubscriptionId: renewed.id,
          resource: renewed.resource,
          notificationUrl: existing.notification_url,
          lifecycleNotificationUrl: existing.lifecycle_notification_url,
          clientState: existing.client_state,
          expirationUtc: new Date(renewed.expirationDateTime),
          status: 'active',
          lastRenewedAt: now,
          lastError: null,
        });
      } catch (error) {
        logger.warn(
          {
            err: error,
            clinicId: input.clinicId,
            ownerStaffId: input.ownerStaffId,
            subscriptionId: existing.external_subscription_id,
          },
          'Outlook calendar subscription renewal failed; creating replacement subscription',
        );
      }
    }

    if (existing) {
      try {
        await deleteStaffEventSubscription(
          input.ownerStaffId,
          existing.external_subscription_id,
        );
      } catch (error) {
        logger.warn(
          {
            err: error,
            clinicId: input.clinicId,
            ownerStaffId: input.ownerStaffId,
            subscriptionId: existing.external_subscription_id,
          },
          'Outlook calendar subscription delete failed during resubscribe',
        );
      }
    }

    return createSubscription(
      input.clinicId,
      input.ownerStaffId,
      clientState,
      now,
    );
  },

  async disconnectStaff(clinicId: string, ownerStaffId: string): Promise<void> {
    const existing = await outlookCalendarSyncRepository.findActiveByOwner(
      clinicId,
      ownerStaffId,
    );
    if (!existing) return;

    let lastError: string | null = null;
    try {
      await deleteStaffEventSubscription(
        ownerStaffId,
        existing.external_subscription_id,
      );
    } catch (error) {
      lastError = errorMessage(error);
      logger.warn(
        { err: error, clinicId, ownerStaffId },
        'Outlook calendar subscription delete failed during disconnect',
      );
    }

    await outlookCalendarSyncRepository.markDisabledByOwner(
      clinicId,
      ownerStaffId,
      lastError,
    );
  },

  async getStatus(
    clinicId: string,
    ownerStaffId: string,
  ): Promise<OutlookCalendarSyncStatus> {
    const existing = await outlookCalendarSyncRepository.findActiveByOwner(
      clinicId,
      ownerStaffId,
    );

    try {
      const identity = await ensureConnectedStaff(ownerStaffId);
      return {
        connected: true,
        configured: Boolean(config.O365_CLIENT_ID && config.O365_TENANT_ID && config.O365_CLIENT_SECRET),
        email: identity.email,
        subscription: existing
          ? {
            status: existing.status,
            expiresAt: existing.expiration_utc.toISOString(),
            lastNotificationAt: existing.last_notification_at?.toISOString() ?? null,
            lastRenewedAt: existing.last_renewed_at?.toISOString() ?? null,
            lastError: existing.last_error,
          }
          : null,
      };
    } catch {
      return {
        connected: false,
        configured: Boolean(config.O365_CLIENT_ID && config.O365_TENANT_ID && config.O365_CLIENT_SECRET),
        email: null,
        subscription: existing
          ? {
            status: existing.status,
            expiresAt: existing.expiration_utc.toISOString(),
            lastNotificationAt: existing.last_notification_at?.toISOString() ?? null,
            lastRenewedAt: existing.last_renewed_at?.toISOString() ?? null,
            lastError: existing.last_error,
          }
          : null,
      };
    }
  },

  async renewExpiringSubscriptions(now = new Date()): Promise<{
    scanned: number;
    renewed: number;
    failed: number;
  }> {
    const expiring = await outlookCalendarSyncRepository.listExpiringBefore(
      new Date(now.getTime() + RENEWAL_WINDOW_MS),
    );

    let renewed = 0;
    let failed = 0;
    for (const row of expiring) {
      try {
        await outlookCalendarSyncService.ensureSubscriptionForStaff({
          clinicId: row.clinic_id,
          ownerStaffId: row.owner_staff_id,
        });
        renewed += 1;
      } catch (error) {
        failed += 1;
        await outlookCalendarSyncRepository.markStatus(
          row.id,
          'error',
          errorMessage(error),
        );
      }
    }

    return {
      scanned: expiring.length,
      renewed,
      failed,
    };
  },

  async handleWebhook(payload: GraphWebhookEnvelope): Promise<{
    processed: number;
    ignored: number;
  }> {
    const notifications = Array.isArray(payload.value) ? payload.value : [];
    let processed = 0;
    let ignored = 0;

    for (const notification of notifications) {
      const subscriptionId = notification.subscriptionId;
      if (!subscriptionId) {
        ignored += 1;
        continue;
      }

      const subscription = await outlookCalendarSyncRepository.findByExternalSubscriptionId(
        subscriptionId,
      );
      if (!subscription) {
        ignored += 1;
        continue;
      }
      if (notification.clientState !== subscription.client_state) {
        logger.warn(
          {
            subscriptionId,
            clinicId: subscription.clinic_id,
            ownerStaffId: subscription.owner_staff_id,
          },
          'Outlook calendar webhook ignored due to clientState mismatch',
        );
        ignored += 1;
        continue;
      }

      await outlookCalendarSyncRepository.touchNotification(subscription.id);

      if (notification.lifecycleEvent) {
        processed += 1;
        if (
          notification.lifecycleEvent === 'reauthorizationRequired'
          || notification.lifecycleEvent === 'subscriptionRemoved'
          || notification.lifecycleEvent === 'missed'
        ) {
          await outlookCalendarSyncService.ensureSubscriptionForStaff({
            clinicId: subscription.clinic_id,
            ownerStaffId: subscription.owner_staff_id,
            forceResubscribe: true,
          });
        }
        continue;
      }

      const eventId = notification.resourceData?.id;
      if (!eventId) {
        ignored += 1;
        continue;
      }

      const appointment = await outlookCalendarSyncRepository.findAppointmentByOutlookEvent(
        subscription.clinic_id,
        eventId,
      );
      if (!appointment) {
        ignored += 1;
        continue;
      }

      processed += 1;
      if (notification.changeType === 'deleted') {
        await outlookCalendarSyncRepository.updateAppointmentSyncState(
          subscription.clinic_id,
          appointment.id,
          buildAppointmentCancellationPatch(new Date()),
        );
        await clearQueuedAppointmentReminders(subscription.clinic_id, appointment.id).catch((error) => {
          logger.warn(
            { err: error, clinicId: subscription.clinic_id, appointmentId: appointment.id },
            'Failed to clear queued reminders after external Outlook deletion',
          );
        });
        continue;
      }

      try {
        const event = await getStaffEvent(subscription.owner_staff_id, eventId);
        if (event.isCancelled) {
          await outlookCalendarSyncRepository.updateAppointmentSyncState(
            subscription.clinic_id,
            appointment.id,
            buildAppointmentCancellationPatch(new Date()),
          );
          await clearQueuedAppointmentReminders(subscription.clinic_id, appointment.id).catch((error) => {
            logger.warn(
              { err: error, clinicId: subscription.clinic_id, appointmentId: appointment.id },
              'Failed to clear queued reminders after external Outlook cancellation',
            );
          });
          continue;
        }

        if (event.changeKey && event.changeKey === appointment.outlook_change_key) {
          continue;
        }

        const patch = buildAppointmentPatchFromGraphEvent(
          appointment,
          event,
          new Date(),
        );
        if (!patch) {
          ignored += 1;
          continue;
        }

        await outlookCalendarSyncRepository.updateAppointmentSyncState(
          subscription.clinic_id,
          appointment.id,
          patch,
        );
      } catch (error) {
        if (isAxiosStatus(error, 404)) {
          await outlookCalendarSyncRepository.updateAppointmentSyncState(
            subscription.clinic_id,
            appointment.id,
            buildAppointmentCancellationPatch(new Date()),
          );
          continue;
        }

        await outlookCalendarSyncRepository.updateAppointmentSyncState(
          subscription.clinic_id,
          appointment.id,
          {
            outlook_last_synced_at: new Date(),
            outlook_sync_status: 'error',
            outlook_sync_error: errorMessage(error),
          },
        );
      }
    }

    return { processed, ignored };
  },
};
