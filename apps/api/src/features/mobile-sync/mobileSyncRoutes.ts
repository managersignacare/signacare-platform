// apps/api/src/features/mobile-sync/mobileSyncRoutes.ts
//
// Phase 11A — the `/mobile/sync` delta endpoint and the FCM device
// registration pair.
//
// /mobile/sync?since=ISO returns "everything that changed for me
// since <timestamp>", scoped by RLS + the caller's authentication.
// Flutter apps hit this on launch, every 60s foreground, on pull-
// to-refresh, and on FCM data-message wake. The response is cached
// into drift (Phase 11B) and used as the source of truth while the
// device is offline.
//
// Entities returned in this initial cut:
//   - notifications  — everything from the Phase 10A bell feed
//                      scoped to the caller. Includes tombstones.
//
// Subsequent PRs add:
//   - appointments (Phase 11A follow-up)
//   - messages     (Phase 11A follow-up)
//   - documents    (Phase 11A follow-up)
//   - patient_sync_preferences-aware filtering for the patient-
//     side Viva app (Phase 11A follow-up)
//
// The scaffold here keeps the contract stable — clients implement
// the sync loop against `notifications` and later entity additions
// slot in as additional array fields in the response without
// breaking the client shape.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { db } from '../../db/db';
import { calendarRepository } from '../calendar/calendarRepository';
import { mapBlockDbToResponse } from '../calendar/calendarService';
import { logger } from '../../utils/logger';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

const SyncQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

const DEFAULT_LOOKBACK_DAYS = 30;

// GET /mobile/sync?since=ISO8601
router.get(
  '/sync',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { since } = SyncQuerySchema.parse(req.query);
      const staffId = req.user!.id;
      const clinicId = req.clinicId;

      const defaultSince = new Date();
      defaultSince.setDate(defaultSince.getDate() - DEFAULT_LOOKBACK_DAYS);
      const cursor = since ? new Date(since) : defaultSince;

      const notifications = await db('notifications')
        .where('clinic_id', clinicId)
        .andWhere((b) => {
          b.where('recipient_staff_id', staffId).orWhereNull('recipient_staff_id');
        })
        .where((b) => {
          b.where('created_at', '>', cursor)
            .orWhere('read_at', '>', cursor);
        })
        .orderBy('created_at', 'desc')
        .limit(500)
        .select(
          'id',
          'clinic_id as clinic_id',
          'recipient_staff_id as user_id',
          'severity',
          'category',
          'title',
          'body',
          'link as action_url',
          'payload',
          'override_patient_sync',
          'read_at',
          'expires_at',
          'created_at',
        );

      // Phase 11B — appointments scoped to this clinician. An
      // appointment is "mine" when clinician_id or staff_id matches
      // the caller. Soft-deletes are included so the on-device
      // reminder scheduler can cancel cancelled slots. Cap of 500
      // matches the notifications slice.
      const appointments = await db('appointments')
        .where('clinic_id', clinicId)
        .andWhere((b) => {
          b.where('clinician_id', staffId).orWhere('staff_id', staffId);
        })
        .where('updated_at', '>', cursor)
        .orderBy('start_time', 'asc')
        .limit(500)
        .select(
          'id',
          'clinic_id',
          'patient_id',
          'clinician_id',
          'staff_id',
          'start_time',
          'end_time',
          'appointment_type',
          'status',
          'location',
          'notes',
          'updated_at',
          'deleted_at',
        )
        .catch((err) => { logger.warn({ err, clinicId, staffId }, 'Mobile sync: appointments query failed — degraded to []'); return []; });

      // Phase 13 PR2e — calendar surface.
      //
      // Availability blocks: the full current set (no since-
      // cursor) because the payload is small (~30 rows per
      // clinician) and Sara needs the complete weekly picture
      // to render an offline grid. Filtered by clinic_id +
      // clinician_id per CLAUDE.md §1.3 + §1.4.
      //
      // Contact records: last N days of the caller's contact
      // records so Sara's day view can render "already
      // completed contacts" without a second round-trip. No
      // deleted_at filter because contact_records doesn't have
      // the column (§1.4 forbidden list).
      //
      // Calendar preferences: the per-clinician JSONB blob from
      // staff_settings so Sara picks up slotMinutes + weekStart
      // without an extra request.
      //
      // Every read is wrapped in `.catch(() => ...)` so a
      // temporary calendar table outage doesn't break the
      // whole sync response — the mobile client degrades
      // gracefully to "calendar empty" but everything else
      // still syncs.
      const availabilityBlocks = await calendarRepository
        .listAvailabilityBlocks({ clinicId, clinicianId: staffId })
        .then((rows) => rows.map(mapBlockDbToResponse))
        .catch((err) => { logger.warn({ err, clinicId, staffId }, 'Mobile sync: availability blocks query failed — degraded to []'); return []; });

      const contactRecords = await db('contact_records')
        .where({ clinic_id: clinicId, staff_id: staffId })
        .where('contact_date', '>=', cursor.toISOString().slice(0, 10))
        .orderBy('contact_date', 'desc')
        .limit(200)
        .select(
          'id',
          'clinic_id',
          'patient_id',
          'episode_id',
          'contact_date',
          'contact_type',
          'duration_min',
          'status',
        )
        .catch((err) => { logger.warn({ err, clinicId, staffId }, 'Mobile sync: contact_records query failed — degraded to []'); return []; });

      const calendarPreferences = await calendarRepository
        .getCalendarPreferences(staffId)
        .catch((err) => { logger.warn({ err, clinicId, staffId }, 'Mobile sync: calendar preferences query failed — degraded to null'); return null; });

      res.json({
        notifications,
        appointments,
        availabilityBlocks,
        contactRecords,
        calendarPreferences,
        lastSyncAt: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  },
);

// POST /mobile/fcm/register-device — Sara app registers its FCM
// token on login. Upserts by (staff_id, device_token). Soft-
// deletes any previously-deleted rows for the same token so a
// re-login after a prune revives the registration.
const RegisterDeviceSchema = z.object({
  deviceToken: z.string().min(10),
  platform: z.enum(['ios', 'android']),
});

router.post(
  '/fcm/register-device',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = RegisterDeviceSchema.parse(req.body);
      const staffId = req.user!.id;
      const clinicId = req.clinicId;
      const now = new Date();

      // Upsert: resurrect a soft-deleted row if present, else insert.
      const existing = await db('staff_fcm_tokens')
        .where({ staff_id: staffId, device_token: dto.deviceToken })
        .first() as { id: string } | undefined;

      if (existing) {
        await db('staff_fcm_tokens')
          .where({ id: existing.id })
          .update({
            deleted_at: null,
            last_seen_at: now,
            platform: dto.platform,
          });
        res.json({ id: existing.id, resurrected: true });
        return;
      }

      const [row] = await db('staff_fcm_tokens')
        .insert({
          clinic_id: clinicId,
          staff_id: staffId,
          device_token: dto.deviceToken,
          platform: dto.platform,
          last_seen_at: now,
          created_at: now,
        })
        .returning('id') as { id: string }[];
      res.status(201).json({ id: row.id, resurrected: false });
    } catch (err) { next(err); }
  },
);

// DELETE /mobile/fcm/register-device/:token — logout path.
router.delete(
  '/fcm/register-device/:token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('staff_fcm_tokens')
        .where({
          clinic_id: req.clinicId,
          staff_id: req.user!.id,
          device_token: req.params.token,
        })
        .whereNull('deleted_at')
        .update({ deleted_at: new Date() });
      res.json({ deleted });
    } catch (err) { next(err); }
  },
);

export default router;
