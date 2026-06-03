// apps/api/src/features/patient-outreach/patientOutreachRoutes.ts
//
// Phase 12B — clinician-facing routes for the patient outreach
// dispatcher. Mounted at /api/v1/patient-outreach.
//
// Routes:
//   GET  /delivery-profile/:patientId        — read the panel state
//   POST /delivery-profile/:patientId/consent — set SMS consent
//   POST /send                                — clinician-initiated send
//   GET  /logs/:patientId                     — delivery audit history
//
// The POST /send endpoint is the UI counterpart of "Send Patient
// Message" in the correspondence tab. It invokes
// patientOutreachService.send directly rather than going through
// the BullMQ queue because the clinician is waiting on the result
// and wants the delivery log entry to appear immediately.
//
// Scheduler-originated outreach still flows through the
// 'patient-outreach' queue — the queue path exists for
// fire-and-forget background jobs, the route path exists for
// synchronous UI actions. Both paths end up calling
// patientOutreachService.send with the same signature.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  SendOutreachSchema,
  SetSmsConsentSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { patientOutreachService } from './patientOutreachService';
import { patientOutreachRepository } from './patientOutreachRepository';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// GET /patient-outreach/delivery-profile/:patientId
router.get(
  '/delivery-profile/:patientId',
  requirePermission('patient:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await patientOutreachRepository.loadDeliveryProfile(req.clinicId, req.params.patientId);
      if (!profile) { res.status(404).json({ error: 'Patient not found' }); return; }

      const patient = await db('patients')
        .where({ id: req.params.patientId, clinic_id: req.clinicId })
        .select('sms_consent_updated_at', 'sms_consent_updated_by')
        .first() as { sms_consent_updated_at: Date | null; sms_consent_updated_by: string | null } | undefined;

      res.json({
        patientId: profile.patientId,
        smsConsent: profile.smsConsent,
        smsConsentUpdatedAt: patient?.sms_consent_updated_at
          ? new Date(patient.sms_consent_updated_at).toISOString()
          : null,
        smsConsentUpdatedByStaffId: patient?.sms_consent_updated_by ?? null,
        mobilePhone: profile.mobilePhone,
        hasVivaApp: profile.fcmTokenCount > 0,
        activeFcmDeviceCount: profile.fcmTokenCount,
      });
    } catch (err) { next(err); }
  },
);

// POST /patient-outreach/delivery-profile/:patientId/consent
router.post(
  '/delivery-profile/:patientId/consent',
  requirePermission('patient:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = SetSmsConsentSchema.parse(req.body);

      const update: Record<string, unknown> = {
        sms_consent: dto.consent,
        sms_consent_updated_at: new Date(),
        sms_consent_updated_by: req.user!.id,
      };
      if (dto.mobilePhone) {
        update.phone_mobile = dto.mobilePhone;
      }

      const [updated] = await db('patients')
        .where({ id: req.params.patientId, clinic_id: req.clinicId })
        .update(update)
        .returning('id') as { id: string }[];
      if (!updated) { res.status(404).json({ error: 'Patient not found' }); return; }

      // The consent change itself is a notable event — write an audit
      // log row so "when did we get SMS consent from Mrs Smith?" is
      // answerable later.
      try {
        const auditLogService = (await import('../../utils/audit')).default;
        await auditLogService.logUpdate({
          clinicId: req.clinicId,
          userId: req.user!.id,
          tableName: 'patients',
          recordId: req.params.patientId,
          oldData: { sms_consent: !dto.consent },
          newData: { sms_consent: dto.consent, reason: dto.reason ?? null },
        });
      } catch (err) {
        // BUG-517 — audit-write swallow on SMS consent toggle.
        // Per BUG-443 precedent: must NOT block (consent mutation
        // already committed), but the audit failure is itself a
        // legally-material event for "when did we get SMS consent
        // from Mrs Smith?" forensic queries.
        logger.warn(
          {
            err,
            kind: 'audit_write_failure',
            action: 'sms_consent_update',
            clinicId: req.clinicId,
            patientId: req.params.patientId,
            actorStaffId: req.user!.id,
            consent: dto.consent,
            reason: dto.reason ?? null,
          },
          'BUG-517: audit write failed for sms_consent update; mutation succeeded but audit row missing',
        );
      }

      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// POST /patient-outreach/bulk-reminder
//
// BUG-518 — was a 404-known-broken route (frontend ReceptionistPage:562
// posted to it, backend never mounted). Bulk-sends appointment-reminder
// SMS for every appointment on the given date that has a patient phone
// number on file. Per-patient errors are logged + counted but do not
// block the loop, so a single SMS-egress failure does not abort the
// batch — the response carries `{sent, failed, totalRecipients}` so
// the UI can render the failure-honest Alert (BUG-445 fix shape).
// BUG-518 absorb-1 (L3 F6 charset): reject unicode bidirectional
// override chars (U+202A–U+202E, U+2066–U+2069), zero-width joiners
// (U+200B–U+200D), and C0/C1 control chars. SMS providers RELAY —
// they do not filter. Future PRs that expose customisable templates
// inherit this safety without reopening BUG-518's surface.
function hasSmsInjectionChars(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u202a-\u202e\u2066-\u2069]/.test(s);
}

const BulkReminderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  messageTemplate: z
    .string()
    .min(1)
    .max(2000)
    .refine((s) => !hasSmsInjectionChars(s), {
      message: 'messageTemplate contains disallowed control / bidi-override / zero-width chars',
    }),
  totalRecipients: z.number().int().nonnegative().optional(),
});

/**
 * Map an arbitrary thrown value to a stable error-code taxonomy for
 * the bulk-reminder response body. Privacy-preserving: the caller
 * sees a stable code, the structured Pino log carries the full err.
 */
function classifyBulkReminderError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('not found')) return 'PATIENT_NOT_FOUND';
    if (msg.includes('consent')) return 'NO_CONSENT';
    if (msg.includes('phone') || msg.includes('mobile')) return 'NO_MOBILE';
    if (msg.includes('rate') || msg.includes('limit')) return 'RATE_LIMITED';
    if (msg.includes('acs') || msg.includes('provider')) return 'PROVIDER_FAILED';
  }
  return 'UNKNOWN_FAILURE';
}

router.post(
  '/bulk-reminder',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = BulkReminderSchema.parse(req.body);

      // BUG-518 absorb-1 (L3 F1 timezone): build the day boundary in
      // the clinic's local timezone, NOT UTC. Pre-absorb the route
      // built `${date}T00:00:00.000Z` which excluded AU clinics' 8am
      // and 9am appointments and leaked in tomorrow's morning slot.
      const clinicRow = await db('clinics')
        .where({ id: req.clinicId })
        .first<{ time_zone: string | null; timezone: string | null }>(
          'time_zone',
          'timezone',
        );
      const tz = clinicRow?.time_zone ?? clinicRow?.timezone ?? 'Australia/Sydney';

      // Derive UTC offset for the target date in the clinic's tz, then
      // build the [00:00, 23:59:59.999] window in UTC. Using
      // Intl.DateTimeFormat to avoid pulling in date-fns-tz.
      const tzOffsetMinutes = (() => {
        const fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'longOffset',
        });
        const parts = fmt.formatToParts(new Date(`${dto.date}T12:00:00Z`));
        const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
        const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(offsetPart);
        if (!m) return 0;
        const sign = m[1] === '-' ? -1 : 1;
        const h = parseInt(m[2], 10);
        const mins = m[3] ? parseInt(m[3], 10) : 0;
        return sign * (h * 60 + mins);
      })();
      const localMidnightUtc = new Date(`${dto.date}T00:00:00.000Z`);
      const dayStart = new Date(localMidnightUtc.getTime() - tzOffsetMinutes * 60_000);
      const dayEnd = new Date(dayStart.getTime() + 86_399_999);

      // BUG-518 absorb-1 (L3 F2 defence-in-depth): pin clinic_id on
      // BOTH sides of the JOIN. RLS is a backstop per CLAUDE.md §1.3
      // but the application layer is the first line.
      const appts = await db('appointments as a')
        .join('patients as p', function () {
          this.on('p.id', 'a.patient_id').andOn('p.clinic_id', 'a.clinic_id');
        })
        .where('a.clinic_id', req.clinicId)
        .where('p.clinic_id', req.clinicId)
        .where('a.appointment_start', '>=', dayStart)
        .where('a.appointment_start', '<=', dayEnd)
        .whereNull('a.deleted_at')
        .whereNull('p.deleted_at')
        .whereNotNull('p.phone_mobile')
        .select(
          'a.id as appointmentId',
          'a.patient_id as patientId',
          'a.appointment_start as start',
        );

      const clinicName = (await db('clinics').where({ id: req.clinicId }).first<{ name: string }>('name'))?.name ?? '';

      let sent = 0;
      let failed = 0;
      const failures: Array<{ appointmentId: string; patientId: string; error: string }> = [];

      for (const appt of appts) {
        const startISO =
          appt.start instanceof Date ? appt.start.toISOString() : String(appt.start);
        const time = new Date(startISO).toLocaleTimeString('en-AU', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: tz,
        });
        // BUG-518 absorb-1 (L3 F4): substitute clinic name into
        // {clinic} placeholder rather than empty string. Pre-absorb
        // the SMS read "appointment at  on <date>" — grammatically
        // broken; recipients perceived as templating bug.
        const body = dto.messageTemplate
          .replace('{date}', dto.date)
          .replace('{time}', time)
          .replace('{clinic}', clinicName);
        try {
          await patientOutreachService.send(
            {
              clinicId: req.clinicId,
              patientId: appt.patientId,
              kind: 'appointment_reminder',
              title: 'Appointment reminder',
              body,
            },
            req.user!.id,
          );
          sent++;
        } catch (err) {
          failed++;
          // BUG-518 absorb-1 (L3 F3 privacy): map error to a stable
          // taxonomy code rather than leaking raw err.message which
          // could include provider internals or stack-trace fragments.
          // Full err is in the structured Pino log for ops.
          const errCode = classifyBulkReminderError(err);
          failures.push({
            appointmentId: appt.appointmentId,
            patientId: appt.patientId,
            error: errCode,
          });
          logger.warn(
            {
              err,
              kind: 'bulk_reminder_send_failed',
              appointmentId: appt.appointmentId,
              patientId: appt.patientId,
              clinicId: req.clinicId,
              errCode,
            },
            'BUG-518: bulk-reminder per-patient send failed; continuing batch',
          );
        }
      }

      res.status(200).json({
        sent,
        failed,
        totalRecipients: appts.length,
        failures: failures.length > 0 ? failures : undefined,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /patient-outreach/send
router.post(
  '/send',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = SendOutreachSchema.parse(req.body);
      const result = await patientOutreachService.send(
        {
          clinicId: req.clinicId,
          patientId: dto.patientId,
          kind: dto.kind,
          title: dto.title,
          body: dto.body,
          deepLink: dto.deepLink,
          forceChannel: dto.forceChannel,
          overrideReason: dto.overrideReason,
        },
        req.user!.id,
      );
      res.status(201).json(result);
    } catch (err) { next(err); }
  },
);

// GET /patient-outreach/logs/:patientId
router.get(
  '/logs/:patientId',
  requirePermission('patient:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await patientOutreachRepository.listForPatient(
        req.clinicId,
        req.params.patientId,
        30,
      );

      // Join staff names for the override actor so the UI can render
      // "Override: SMS (by Dr Kamath)" without a second query.
      const staffIds = Array.from(new Set(rows.map((r) => r.override_by_staff_id).filter((x): x is string => !!x)));
      const staffRows = staffIds.length > 0
        ? await db('staff')
            .whereIn('id', staffIds)
            .select('id', 'given_name', 'family_name')
        : [];
      const staffMap = new Map<string, string>();
      for (const s of staffRows as { id: string; given_name: string; family_name: string }[]) {
        staffMap.set(s.id, `${s.given_name ?? ''} ${s.family_name ?? ''}`.trim());
      }

      const items = rows.map((r) => ({
        id: r.id,
        clinicId: r.clinic_id,
        patientId: r.patient_id,
        kind: r.kind,
        channel: r.channel,
        skipReason: r.skip_reason,
        providerMessageId: r.provider_message_id,
        title: r.title,
        body: r.body,
        deepLink: r.deep_link,
        overrideChannel: r.override_channel,
        overrideReason: r.override_reason,
        overrideByStaffId: r.override_by_staff_id,
        overrideByStaffName: r.override_by_staff_id ? staffMap.get(r.override_by_staff_id) ?? null : null,
        attemptedAt: r.attempted_at instanceof Date ? r.attempted_at.toISOString() : String(r.attempted_at),
        deliveredAt: r.delivered_at ? (r.delivered_at instanceof Date ? r.delivered_at.toISOString() : String(r.delivered_at)) : null,
        failedAt: r.failed_at ? (r.failed_at instanceof Date ? r.failed_at.toISOString() : String(r.failed_at)) : null,
        errorMessage: r.error_message,
      }));

      res.json({ items });
    } catch (err) { next(err); }
  },
);

export default router;
