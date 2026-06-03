// apps/api/src/features/notifications/notificationService.ts
//
// Phase 10A — the one function every emitter calls.
//
// `notificationService.emit(...)` is the single entry point for any
// backend code that wants to tell a clinician "something happened."
// It writes a durable row to the `notifications` table (so the bell
// has a log when the clinician wasn't connected), AND publishes to
// SSE (so connected clients react in real time), in one call.
//
// This is the contract every future retrofit (Phase 10C) and every
// new feature (Phase 12 patient outreach, Phase 11 mobile FCM) hooks
// into — no one reaches past this into `publishUserEvent` directly.
// Centralising the decision here is how the "one source of truth for
// delivery discipline" rule stays enforceable.
import { publishClinicEvent, publishUserEvent } from '../events/ssePublisher';
import logger from '../../utils/logger';
import { sendToStaff as fcmSendToStaff } from '../../integrations/fcm/fcmService';
import { addJob } from '../../queues';
import { notificationRepository, type NotificationRow } from './notificationRepository';
import type {
  NotificationResponse,
  NotificationSeverity,
} from '@signacare/shared';

// ── Channel types ──────────────────────────────────────────────────────────

export type NotificationChannel = 'sse' | 'bell' | 'fcm' | 'email';
// Phase 11A — 'fcm' joins the default channel set so every staff
// notification automatically fans out to any registered mobile
// devices (Sara) via Firebase Cloud Messaging. FCM is purely
// additive: a clinician without a registered device sees the bell
// row via SSE exactly as before; a clinician with Sara installed
// also gets a native push on their phone.
//
// Callers can opt-in `'email'` when an offline staff channel is
// required, and can suppress FCM (e.g. clinic-wide broadcasts where
// waking up every staff phone is overkill) with
// `channels: ['sse', 'bell']`.
export const DEFAULT_CHANNELS: NotificationChannel[] = ['sse', 'bell', 'fcm'];

// ── Emit input ─────────────────────────────────────────────────────────────

export interface EmitInput {
  clinicId: string;
  /** Single-user target. Use this OR `userIds` OR neither (clinic-wide). */
  userId?: string;
  /** Multi-user fan-out. One row is written per user. */
  userIds?: string[];
  severity: NotificationSeverity;
  category: string;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
  payload?: Record<string, unknown> | null;
  /**
   * Idempotency guard. When supplied, the partial unique index on
   * `(clinic_id, (payload->>'dedupe_key'))` prevents duplicate rows
   * from the same dedupe key — used by the appointment reminder
   * scheduler that runs every 15 minutes.
   */
  dedupeKey?: string;
  /** Default `['sse','bell','fcm']`. Add `'email'` explicitly when needed. */
  channels?: NotificationChannel[];
  /**
   * Override the event `type` on the SSE publish. Defaults to the
   * generic `'notification'` — existing SSE listeners (e.g. the
   * referral queue auto-invalidator) can keep their typed channels
   * by passing the legacy event name here.
   */
  sseEventType?: string;
  /**
   * Safety-critical flag for duty-of-care / MH-crisis alerts that
   * patients cannot silence via Viva's per-module opt-in (Phase 11A).
   * Default false — only flip this on for genuine patient-safety
   * escalations.
   */
  overridePatientSync?: boolean;
  /** Optional expiry — after this time the bell hides the row. */
  expiresAt?: Date;
  /**
   * BUG-583 — optional connection. Defaults to the request-scoped
   * `db` proxy (RLS applies). Schedulers that run outside any request
   * context MUST pass `dbAdmin` so the RLS WITH CHECK predicate
   * `clinic_id = NULL` does not reject every INSERT into `notifications`.
   */
  conn?: import('knex').Knex;
}

export interface EmitResult {
  /** IDs of the rows actually inserted (dedupe'd rows are not returned). */
  ids: string[];
  /** Whether any SSE publishes were fired. */
  published: boolean;
}

// ── Row → DTO mapper ───────────────────────────────────────────────────────

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function parseJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return v as T;
}

export function mapNotificationRowToResponse(row: NotificationRow): NotificationResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    // The DTO calls this `userId` — the physical column is
    // `recipient_staff_id` from the legacy v2 baseline schema.
    userId: row.recipient_staff_id,
    // Prefer the strict `severity` enum column added by the Phase 10A
    // augment migration; fall back to priority mapping for rows that
    // existed before this PR.
    severity: (row.severity ??
      (row.priority === 'critical' ? 'critical'
        : row.priority === 'high' ? 'warning'
        : 'info')) as NotificationSeverity,
    // Prefer the strict `category` whitelist column; fall back to
    // the free-form legacy `type` column for older rows.
    category: row.category ?? row.type ?? 'system',
    title: row.title,
    body: row.body,
    actionUrl: row.link,
    payload: parseJson<Record<string, unknown>>(row.payload),
    overridePatientSync: row.override_patient_sync,
    readAt: row.is_read ? toIso(row.read_at) : null,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at)!,
  };
}

// ── Emitter ────────────────────────────────────────────────────────────────

export class NotificationService {
  /**
   * Write the durable row(s) AND publish the live SSE event(s) for a
   * single logical notification.
   *
   * Channel semantics:
   *   - 'bell': insert a row in the `notifications` table so the
   *     clinician sees it in the bell popover later even if they
   *     weren't connected at emit time.
   *   - 'sse':  publish on the Redis user- or clinic-channel so any
   *     connected `useEventStream` client updates immediately.
   *
   * Target semantics (in priority order):
   *   1. `userIds[]` — multi-user fan-out. One row per user.
   *   2. `userId`    — single-user target.
   *   3. Neither     — clinic-wide broadcast (one row with user_id NULL).
   */
  async emit(input: EmitInput): Promise<EmitResult> {
    const channels = input.channels ?? DEFAULT_CHANNELS;
    const shouldWriteBell = channels.includes('bell');
    const shouldPublishSse = channels.includes('sse');
    const sseEventType = input.sseEventType ?? 'notification';

    // Resolve the target list.
    let targetUserIds: (string | null)[];
    if (input.userIds && input.userIds.length > 0) {
      targetUserIds = input.userIds;
    } else if (input.userId) {
      targetUserIds = [input.userId];
    } else {
      targetUserIds = [null]; // clinic-wide
    }

    // Merge the dedupe key into the payload if provided. The partial
    // unique index reads `payload->>'dedupe_key'`.
    const basePayload: Record<string, unknown> = { ...(input.payload ?? {}) };
    if (input.dedupeKey) {
      basePayload.dedupe_key = input.dedupeKey;
    }
    const payloadForInsert = Object.keys(basePayload).length > 0 ? basePayload : null;

    // Durable bell insert. Repository maps DTO field names to
    // physical column names (userId → recipient_staff_id, actionUrl
    // → link, category → category + type fallback).
    let insertedIds: string[] = [];
    if (shouldWriteBell) {
      try {
        if (targetUserIds.length === 1) {
          const row = await notificationRepository.insertOne({
            clinic_id: input.clinicId,
            recipient_staff_id: targetUserIds[0],
            severity: input.severity,
            category: input.category,
            title: input.title,
            body: input.body ?? null,
            link: input.actionUrl ?? null,
            payload: payloadForInsert,
            override_patient_sync: input.overridePatientSync ?? false,
            expires_at: input.expiresAt ?? null,
          }, input.conn);
          if (row) insertedIds.push(row.id);
        } else {
          const rows = await notificationRepository.insertMany(
            targetUserIds.map((uid) => ({
              clinic_id: input.clinicId,
              recipient_staff_id: uid,
              severity: input.severity,
              category: input.category,
              title: input.title,
              body: input.body ?? null,
              link: input.actionUrl ?? null,
              payload: payloadForInsert,
              override_patient_sync: input.overridePatientSync ?? false,
              expires_at: input.expiresAt ?? null,
            })),
            input.conn,
          );
          insertedIds = rows.map((r) => r.id);
        }
      } catch (err) {
        // Bell insert failure shouldn't stop the SSE publish — the
        // live users still see the alert, we just lose the durable
        // log for this one event. Log loudly so the operator notices.
        logger.error(
          { err, clinicId: input.clinicId, category: input.category },
          'notificationService.emit — bell insert failed, continuing to SSE publish',
        );
      }
    }

    // FCM native push (Phase 11A). Only applies to single-user /
    // multi-user fan-out; clinic-wide broadcasts skip FCM because
    // waking every staff phone in the clinic is typically overkill
    // and there's no "send to all staff" FCM topic wired yet.
    // Missing tokens are a no-op — fcmService.sendToStaff returns
    // { successCount: 0, tokensFound: 0 } and the caller just sees
    // a silent fall-through, which is the correct behaviour (the
    // bell row and SSE event still reach every connected client).
    if (channels.includes('fcm')) {
      const staffTargets = targetUserIds.filter((uid): uid is string => uid !== null);
      if (staffTargets.length > 0) {
        const payload = {
          title: input.title,
          body: input.body ?? '',
          data: {
            notification_id: insertedIds[0] ?? '',
            category: input.category,
            action_url: input.actionUrl ?? '',
            severity: input.severity,
          },
        };
        for (const uid of staffTargets) {
          try {
            await fcmSendToStaff(input.clinicId, uid, payload);
          } catch (err) {
            logger.warn(
              { err, clinicId: input.clinicId, staffId: uid, category: input.category },
              'notificationService.emit — FCM send-to-staff failed, continuing',
            );
          }
        }
      }
    }

    // Email queue fanout (BUG-575). This is opt-in by channel to
    // avoid waking inboxes for every notification; callers enable it
    // explicitly for critical/offline workflows.
    if (channels.includes('email')) {
      const staffTargets = targetUserIds.filter((uid): uid is string => uid !== null);
      if (staffTargets.length === 0) {
        logger.warn(
          { clinicId: input.clinicId, category: input.category },
          'notificationService.emit — email channel requested for clinic-wide broadcast; no staff target, skipping enqueue',
        );
      } else {
        for (const uid of staffTargets) {
          try {
            await addJob('email', {
              type: 'staff_notification',
              clinicId: input.clinicId,
              staffId: uid,
              notificationId: insertedIds[0] ?? null,
              severity: input.severity,
              category: input.category,
              title: input.title,
              body: input.body ?? null,
              actionUrl: input.actionUrl ?? null,
              dedupeKey: input.dedupeKey ?? null,
            });
          } catch (err) {
            logger.warn(
              { err, clinicId: input.clinicId, staffId: uid, category: input.category },
              'notificationService.emit — email enqueue failed, continuing',
            );
          }
        }
      }
    }

    // SSE live publish. The event payload includes the first inserted
    // row's ID so the frontend can setQueryData optimistically instead
    // of issuing a refetch.
    let published = false;
    if (shouldPublishSse) {
      const event = {
        type: sseEventType,
        notificationId: insertedIds[0] ?? null,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body ?? null,
        action_url: input.actionUrl ?? null,
        created_at: new Date().toISOString(),
      };
      try {
        if (targetUserIds[0] === null) {
          // Clinic-wide broadcast — one publish.
          await publishClinicEvent(input.clinicId, event);
          published = true;
        } else {
          // One publish per targeted user.
          for (const uid of targetUserIds as string[]) {
            await publishUserEvent(uid, event);
          }
          published = true;
        }
      } catch (err) {
        // SSE failure is non-fatal — the durable row is already written.
        logger.warn(
          { err, clinicId: input.clinicId, category: input.category },
          'notificationService.emit — SSE publish failed, durable row already written',
        );
      }
    }

    return { ids: insertedIds, published };
  }
}

export const notificationService = new NotificationService();
