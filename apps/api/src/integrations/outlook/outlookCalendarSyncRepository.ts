import { dbAdmin } from '../../db/db';

export type ExternalCalendarSubscriptionStatus =
  | 'active'
  | 'expired'
  | 'disabled'
  | 'error';

export interface ExternalCalendarSubscriptionDb {
  id: string;
  clinic_id: string;
  owner_staff_id: string;
  provider: 'outlook';
  external_subscription_id: string;
  resource: string;
  notification_url: string;
  lifecycle_notification_url: string | null;
  client_state: string;
  expiration_utc: Date;
  status: ExternalCalendarSubscriptionStatus;
  last_notification_at: Date | null;
  last_renewed_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * @schema-drift-exempt partial-shape
 * This interface is the deliberate `.first(...)` projection used by the
 * Outlook webhook sync path. The source-of-truth row remains
 * `AppointmentsRow`; this shape only carries the subset needed to diff and
 * upsert the external event mirror safely.
 */
export interface OutlookAppointmentSyncRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  clinician_id: string | null;
  appointment_start: Date | null;
  appointment_end: Date | null;
  start_time: Date;
  end_time: Date;
  status: string;
  mode: string | null;
  telehealth: boolean;
  telehealth_url: string | null;
  notes: string | null;
  cancellation_reason?: string | null;
  reminder_scheduled: boolean;
  reminder_sent: boolean;
  reminder_sent_at: Date | null;
  outlook_event_id: string | null;
  outlook_change_key: string | null;
  outlook_last_synced_at?: Date | null;
  outlook_last_modified_at?: Date | null;
  outlook_sync_status?: string | null;
  outlook_sync_error?: string | null;
}

export const outlookCalendarSyncRepository = {
  async findActiveByOwner(
    clinicId: string,
    ownerStaffId: string,
  ): Promise<ExternalCalendarSubscriptionDb | null> {
    const row = await dbAdmin<ExternalCalendarSubscriptionDb>('external_calendar_subscriptions')
      .where({
        clinic_id: clinicId,
        owner_staff_id: ownerStaffId,
        provider: 'outlook',
      })
      .whereNull('deleted_at')
      .first();
    return row ?? null;
  },

  async findByExternalSubscriptionId(
    externalSubscriptionId: string,
  ): Promise<ExternalCalendarSubscriptionDb | null> {
    const row = await dbAdmin<ExternalCalendarSubscriptionDb>('external_calendar_subscriptions')
      .where({
        external_subscription_id: externalSubscriptionId,
        provider: 'outlook',
      })
      .whereNull('deleted_at')
      .first();
    return row ?? null;
  },

  async saveActiveSubscription(input: {
    clinicId: string;
    ownerStaffId: string;
    externalSubscriptionId: string;
    resource: string;
    notificationUrl: string;
    lifecycleNotificationUrl: string | null;
    clientState: string;
    expirationUtc: Date;
    status?: ExternalCalendarSubscriptionStatus;
    lastRenewedAt?: Date | null;
    lastError?: string | null;
  }): Promise<ExternalCalendarSubscriptionDb> {
    const now = new Date();
    return dbAdmin.transaction(async (trx) => {
      const existing = await trx<ExternalCalendarSubscriptionDb>('external_calendar_subscriptions')
        .where({
          clinic_id: input.clinicId,
          owner_staff_id: input.ownerStaffId,
          provider: 'outlook',
        })
        .whereNull('deleted_at')
        .first();

      if (existing) {
        const [updated] = await trx<ExternalCalendarSubscriptionDb>('external_calendar_subscriptions')
          .where({ id: existing.id })
          .update({
            external_subscription_id: input.externalSubscriptionId,
            resource: input.resource,
            notification_url: input.notificationUrl,
            lifecycle_notification_url: input.lifecycleNotificationUrl,
            client_state: input.clientState,
            expiration_utc: input.expirationUtc,
            status: input.status ?? 'active',
            last_renewed_at: input.lastRenewedAt ?? now,
            last_error: input.lastError ?? null,
            updated_at: now,
            deleted_at: null,
          })
          .returning('*');
        return updated;
      }

      const [created] = await trx<ExternalCalendarSubscriptionDb>('external_calendar_subscriptions')
        .insert({
          clinic_id: input.clinicId,
          owner_staff_id: input.ownerStaffId,
          provider: 'outlook',
          external_subscription_id: input.externalSubscriptionId,
          resource: input.resource,
          notification_url: input.notificationUrl,
          lifecycle_notification_url: input.lifecycleNotificationUrl,
          client_state: input.clientState,
          expiration_utc: input.expirationUtc,
          status: input.status ?? 'active',
          last_notification_at: null,
          last_renewed_at: input.lastRenewedAt ?? now,
          last_error: input.lastError ?? null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        })
        .returning('*');
      return created;
    });
  },

  async markStatus(
    id: string,
    status: ExternalCalendarSubscriptionStatus,
    lastError?: string | null,
  ): Promise<void> {
    await dbAdmin('external_calendar_subscriptions')
      .where({ id })
      .update({
        status,
        last_error: lastError ?? null,
        updated_at: new Date(),
      });
  },

  async markDisabledByOwner(
    clinicId: string,
    ownerStaffId: string,
    lastError?: string | null,
  ): Promise<void> {
    await dbAdmin('external_calendar_subscriptions')
      .where({
        clinic_id: clinicId,
        owner_staff_id: ownerStaffId,
        provider: 'outlook',
      })
      .whereNull('deleted_at')
      .update({
        status: 'disabled',
        last_error: lastError ?? null,
        deleted_at: new Date(),
        updated_at: new Date(),
      });
  },

  async touchNotification(id: string): Promise<void> {
    await dbAdmin('external_calendar_subscriptions')
      .where({ id })
      .update({
        last_notification_at: new Date(),
        updated_at: new Date(),
      });
  },

  async listExpiringBefore(cutoff: Date): Promise<ExternalCalendarSubscriptionDb[]> {
    return dbAdmin<ExternalCalendarSubscriptionDb>('external_calendar_subscriptions')
      .where({ provider: 'outlook', status: 'active' })
      .whereNull('deleted_at')
      .andWhere('expiration_utc', '<=', cutoff)
      .orderBy('expiration_utc', 'asc');
  },

  async findAppointmentByOutlookEvent(
    clinicId: string,
    outlookEventId: string,
  ): Promise<OutlookAppointmentSyncRow | null> {
    const row = await dbAdmin<OutlookAppointmentSyncRow>('appointments')
      .where({
        clinic_id: clinicId,
        outlook_event_id: outlookEventId,
      })
      .whereNull('deleted_at')
      .first(
        'id',
        'clinic_id',
        'patient_id',
        'clinician_id',
        'appointment_start',
        'appointment_end',
        'start_time',
        'end_time',
        'status',
        'mode',
        'telehealth',
        'telehealth_url',
        'notes',
        'cancellation_reason',
        'reminder_scheduled',
        'reminder_sent',
        'reminder_sent_at',
        'outlook_event_id',
        'outlook_change_key',
        'outlook_last_synced_at',
        'outlook_last_modified_at',
        'outlook_sync_status',
        'outlook_sync_error',
      );
    return row ?? null;
  },

  async updateAppointmentSyncState(
    clinicId: string,
    appointmentId: string,
    patch: Partial<OutlookAppointmentSyncRow>,
  ): Promise<void> {
    await dbAdmin('appointments')
      .where({ clinic_id: clinicId, id: appointmentId })
      .whereNull('deleted_at')
      .update({
        ...patch,
        updated_at: new Date(),
      });
  },
};
