import type { Multer } from 'multer';
import type { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import {
  CreateAdmissionWaitlistSchema,
  CreateHotspotSchema,
  CreatePatientAlertSchema,
  CreatePatientContactSchema,
  CreatePatientProviderSchema,
  PatientSummarySignoffListSchema,
  RemoveFromWaitlistSchema,
  SignPatientSummarySchema,
  UpdateAdmissionWaitlistSchema,
  UpdatePatientAlertSchema,
} from '@signacare/shared';
import { db } from '../../db/db';
import { escapeLike } from '../../shared/escapeLike';
import { uploadLimiter } from '../../middleware/rateLimiters';
import {
  blobStorage,
  buildAttachmentStorageKey,
} from '../../shared/blobStorage';
import { ensureClinicalNoteConsent } from '../../shared/recordingConsent';
import { logger } from '../../utils/logger';
import { buildAuthContext } from '../../shared/buildAuthContext';
import {
  mapAdmissionWaitlistListRowToResponse,
  mapAdmissionWaitlistRowToResponse,
  mapHotspotRowToResponse,
  mapPatientAlertRowToResponse,
} from './patientResponseMappers';
import { PATIENT_LEGAL_ATTACHMENT_COLUMNS } from './patientRouteColumns';
import {
  listPatientSummarySignoffs,
  signPatientSummary,
} from './patientSummarySignoffService';
import { AppError } from '../../shared/errors';

// @jsonb-extraction-exempt: this module writes to clinical_notes for timeline
// side-effects but does not expose clinical_notes rows on any GET surface.

const LegalAttachmentUploadSchema = z.object({
  legalOrderId: z.string().uuid().optional(),
  category: z.string().max(60).optional(),
});

const PATIENT_ALERT_COLUMNS = [
  'id', 'patient_id', 'clinic_id', 'alert_type_id', 'entered_by_id',
  'title', 'notes', 'management_plan', 'severity', 'is_active', 'show_flag',
  'created_at', 'updated_at', 'resolved_at',
] as const;

const PATIENT_ALERT_ATTACHMENT_COLUMNS = [
  'id', 'patient_alert_id', 'filename', 'mime_type', 'file_size',
  'file_path', 'created_at', 'storage_backend', 'storage_key',
  'storage_bucket', 'storage_etag', 'clinic_id', 'updated_at',
] as const;

const HOTSPOT_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'hotspot_type', 'reason', 'severity',
  'is_active', 'created_at', 'updated_at',
] as const;

const ADMISSION_WAITLIST_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'hotspot_id', 'source',
  'priority', 'status', 'reason', 'clinical_notes', 'preferred_ward',
  'target_admission_date', 'flagged_by_staff_id', 'removed_by_staff_id',
  'removed_at', 'removal_reason', 'created_at', 'updated_at',
] as const;

const PATIENT_CONTACT_COLUMNS = [
  'id', 'patient_id', 'clinic_id', 'given_name', 'family_name',
  'relationship', 'phone_mobile', 'phone_home', 'email',
  'is_emergency_contact', 'is_carer', 'has_consent', 'contact_type',
  'consent_level', 'consent_notes', 'deleted_at', 'created_at',
  'updated_at',
] as const;

const PATIENT_PROVIDER_COLUMNS = [
  'id', 'patient_id', 'clinic_id', 'provider_type', 'provider_name',
  'provider_practice', 'provider_phone', 'provider_fax', 'provider_email',
  'provider_number', 'provider_address', 'is_primary', 'created_at',
  'updated_at',
] as const;

interface RegisterPatientAncillaryRoutesDeps {
  upload: Multer;
}

export function registerPatientAncillaryRoutes(
  router: Router,
  deps: RegisterPatientAncillaryRoutesDeps,
): void {
  // ─── Legal Order Types (configurable lookup) ───
  router.get('/legal-order-types', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('legal_order_type_configs').where({ clinic_id: req.clinicId, is_active: true }).orderBy(['category', 'sort_order']);
      res.json({ types: rows.map((r) => ({ id: r.id, name: r.name, category: r.category, isActive: r.is_active })) });
    } catch (err) { next(err); }
  });

  // Legal attachments (order docs + advance statements).
  // S1.1: routes through BlobStorage; clinic_id added defensively.
  router.post('/:id/legal-attachments', uploadLimiter, deps.upload.array('files', 5), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      const { legalOrderId, category } = LegalAttachmentUploadSchema.parse(req.body);
      const inserted = [];
      for (const f of files) {
        const storageKey = buildAttachmentStorageKey(f.originalname);
        const putResult = await blobStorage.put(storageKey, f.buffer, f.mimetype);
        try {
          const [row] = await db('patient_legal_attachments').insert({
            id: db.raw('gen_random_uuid()'),
            clinic_id: req.clinicId,
            patient_id: req.params.id,
            legal_order_id: legalOrderId ?? null,
            category: category ?? 'order',
            filename: f.originalname,
            mime_type: f.mimetype,
            file_size: f.size,
            file_path: putResult.key,
            storage_backend: putResult.backend,
            storage_key: putResult.key,
            storage_bucket: putResult.bucket,
            storage_etag: putResult.etag,
            created_at: new Date(),
          }).returning(PATIENT_LEGAL_ATTACHMENT_COLUMNS);
          inserted.push(row);
        } catch (dbErr) {
          try { await blobStorage.delete(storageKey); } catch { /* best-effort */ }
          throw dbErr;
        }
      }
      res.status(201).json({ attachments: inserted });
    } catch (err) { next(err); }
  });

  router.get('/:id/legal-attachments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cat = req.query.category as string | undefined;
      // BUG-368: clinic_id Layer-1 tenant isolation (see §1.3).
      let q = db('patient_legal_attachments')
        .where({ patient_id: req.params.id, clinic_id: req.clinicId })
        .orderBy('created_at', 'desc');
      if (cat) q = q.where({ category: cat });
      const rows = await q;
      res.json({ attachments: rows.map((r) => ({ id: r.id, legalOrderId: r.legal_order_id, category: r.category, filename: r.filename, mimetype: r.mime_type, filesize: r.file_size, createdAt: r.created_at })) });
    } catch (err) { next(err); }
  });

  // ─── Alert Types (configurable lookup) ───
  router.get('/alert-types', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('alert_types').where({ clinic_id: req.clinicId }).orderBy('sort_order');
      res.json({ types: rows.map((r) => ({ id: r.id, clinicId: r.clinic_id, name: r.name, severity: r.severity, color: r.color, planTemplate: r.plan_template, isActive: r.is_active, sortOrder: r.sort_order })) });
    } catch (err) { next(err); }
  });

  // ─── Patient Alerts CRUD ───
  router.get('/:id/alerts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // BUG-368: clinic_id Layer-1 tenant isolation (see §1.3). The
      // qualified column form matches the pattern already used on
      // patient_alerts.patient_id.
      const rows = await db('patient_alerts')
        .join('alert_types', 'alert_types.id', 'patient_alerts.alert_type_id')
        .leftJoin('staff', 'staff.id', 'patient_alerts.entered_by_id')
        .where('patient_alerts.patient_id', req.params.id)
        .where('patient_alerts.clinic_id', req.clinicId)
        .select(
          'patient_alerts.*',
          'alert_types.name as alerttypename',
          'alert_types.color as alertcolor',
          'alert_types.severity as alertseverity',
          db.raw("COALESCE(staff.given_name || ' ' || staff.family_name, '') as enteredbyname"),
        )
        .orderBy('patient_alerts.created_at', 'desc');

      // Get attachment counts
      const alertIds = rows.map((r) => r.id);
      const attachCounts = alertIds.length ? await db('patient_alert_attachments')
        .whereIn('patient_alert_id', alertIds)
        .groupBy('patient_alert_id')
        .select('patient_alert_id')
        .count('* as count') : [];
      const countMap = new Map(attachCounts.map((r) => [r.patient_alert_id, Number(r.count)]));

      res.json({
        alerts: rows.map((r) => ({
          id: r.id, patientId: r.patient_id, alertTypeId: r.alert_type_id, alertTypeName: r.alerttypename,
          alertColor: r.alertcolor, alertSeverity: r.alertseverity,
          title: r.title, notes: r.notes, managementPlan: r.management_plan,
          severity: r.severity, isActive: r.is_active, showFlag: r.show_flag,
          enteredById: r.entered_by_id, enteredByName: r.enteredbyname,
          attachmentCount: countMap.get(r.id) ?? 0,
          createdAt: r.created_at, resolvedAt: r.resolved_at,
        })),
      });
    } catch (err) { next(err); }
  });

  router.post('/:id/alerts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreatePatientAlertSchema.parse(req.body);
      const { alertTypeId, title, notes, managementPlan, severity, showFlag } = dto;
      const [row] = await db('patient_alerts').insert({
        id: db.raw('gen_random_uuid()'),
        patient_id: req.params.id,
        clinic_id: req.clinicId,
        alert_type_id: alertTypeId,
        entered_by_id: req.user?.id ?? null,
        title, notes: notes ?? null, management_plan: managementPlan ?? null,
        severity: severity ?? 'medium', is_active: true, show_flag: showFlag !== false,
        created_at: new Date(), updated_at: new Date(),
      }).returning(PATIENT_ALERT_COLUMNS);
      res.status(201).json({ alert: mapPatientAlertRowToResponse(row) });
    } catch (err) { next(err); }
  });

  router.patch('/alerts/:alertId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdatePatientAlertSchema.parse(req.body);
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.notes !== undefined) patch.notes = dto.notes;
      if (dto.managementPlan !== undefined) patch.management_plan = dto.managementPlan;
      if (dto.isActive !== undefined) patch.is_active = dto.isActive;
      if (dto.showFlag !== undefined) patch.show_flag = dto.showFlag;
      if (dto.isActive === false) patch.resolved_at = new Date();
      if (dto.isActive === true) patch.resolved_at = null;
      const [row] = await db('patient_alerts').where({ id: req.params.alertId, clinic_id: req.clinicId }).update(patch).returning(PATIENT_ALERT_COLUMNS);
      res.json({ alert: mapPatientAlertRowToResponse(row) });
    } catch (err) { next(err); }
  });

  // Alert attachments.
  // S1.1: routes through BlobStorage; clinic_id added defensively.
  router.post('/alerts/:alertId/attachments', uploadLimiter, deps.upload.array('files', 5), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      const inserted = [];
      for (const f of files) {
        const storageKey = buildAttachmentStorageKey(f.originalname);
        const putResult = await blobStorage.put(storageKey, f.buffer, f.mimetype);
        try {
          const [row] = await db('patient_alert_attachments').insert({
            id: db.raw('gen_random_uuid()'),
            clinic_id: req.clinicId,
            patient_alert_id: req.params.alertId,
            filename: f.originalname,
            mime_type: f.mimetype,
            file_size: f.size,
            file_path: putResult.key,
            storage_backend: putResult.backend,
            storage_key: putResult.key,
            storage_bucket: putResult.bucket,
            storage_etag: putResult.etag,
            created_at: new Date(),
          }).returning(PATIENT_ALERT_ATTACHMENT_COLUMNS);
          inserted.push(row);
        } catch (dbErr) {
          try { await blobStorage.delete(storageKey); } catch { /* best-effort */ }
          throw dbErr;
        }
      }
      res.status(201).json({ attachments: inserted });
    } catch (err) { next(err); }
  });

  // Flags endpoint — active alerts with showFlag=true
  // NOTE: flagRoutes (registered before patientRoutes) also handles /patients/:id/flags
  // This is a fallback in case flagRoutes doesn't match
  router.get('/:id/flags', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // BUG-368: clinic_id Layer-1 tenant isolation (see §1.3).
      const rows = await db('patient_alerts')
        .where({ patient_id: req.params.id, clinic_id: req.clinicId, is_active: true })
        .select('id', 'title', 'severity', 'show_flag', 'created_at');
      res.json((rows ?? []).map((r) => ({
        id: r.id, patientId: req.params.id,
        flagType: r.severity === 'critical' ? 'risk' : r.severity === 'high' ? 'alert' : 'clinical',
        severity: r.severity ?? 'medium', title: r.title ?? '', isActive: true,
      })));
    } catch (err) { next(err); }
  });

  // ─── Hot Spots ───
  router.get('/hotspots', async (req: Request, res: Response, next: NextFunction) => {
    try {
      let q = db('hotspots')
        .join('patients', 'patients.id', 'hotspots.patient_id')
        .leftJoin('patient_team_assignments as pta', function() { this.on('pta.patient_id', '=', 'hotspots.patient_id').andOn('pta.is_active', '=', db.raw('true')); })
        .leftJoin('org_units', 'org_units.id', 'pta.org_unit_id')
        .leftJoin('staff as clinician', 'clinician.id', 'pta.primary_clinician_id')
        .where('hotspots.clinic_id', req.clinicId)
        .distinctOn('hotspots.id');
      if (req.query.status === 'inactive') q = q.where('hotspots.is_active', false);
      else q = q.where('hotspots.is_active', true);
      q = q.select('hotspots.*', 'patients.given_name', 'patients.family_name', 'patients.emr_number',
          db.raw("COALESCE(org_units.name, '') as team_name"),
          db.raw("COALESCE(clinician.given_name || ' ' || clinician.family_name, '') as clinician_name"))
        .orderBy([{ column: 'hotspots.id' }, { column: 'hotspots.created_at', order: 'desc' }]);
      if (req.query.team) q = q.whereILike('org_units.name', `%${escapeLike(req.query.team as string)}%`);
      const rows = await q;
      res.json({ hotspots: rows.map((r) => ({
        id: r.id, patientId: r.patient_id, patientName: `${r.family_name}, ${r.given_name}`, emrNumber: r.emr_number,
        hotspotType: r.hotspot_type, reason: r.reason, severity: r.severity, isActive: r.is_active,
        teamName: r.team_name, clinicianName: r.clinician_name,
        createdAt: r.created_at,
      })), total: rows.length });
    } catch (err) { next(err); }
  });
  router.post('/:id/hotspot', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateHotspotSchema.parse(req.body);
      const [row] = await db('hotspots').insert({
        id: db.raw('gen_random_uuid()'), patient_id: req.params.id, clinic_id: req.clinicId,
        reason: dto.reason, is_active: true,
        created_at: new Date(), updated_at: new Date(),
      }).returning(HOTSPOT_COLUMNS);
      // Also create a clinical note so it appears in Episodes tab
      const activeEp = await db('episodes').where({ patient_id: req.params.id, clinic_id: req.clinicId, status: 'open' }).whereNull('deleted_at').first();
      await db('clinical_notes').insert({
        clinic_id: req.clinicId, patient_id: req.params.id, episode_id: activeEp?.id ?? null,
        consent_id: await ensureClinicalNoteConsent({ clinicId: req.clinicId, patientId: req.params.id, clinicianId: req.user?.id ?? null }),
        author_id: req.user?.id ?? null, title: `Hotspot Started — ${dto.reason ?? 'Alert'}`,
        note_type: 'hotspot', content: `Hotspot alert raised: ${dto.reason ?? 'No reason specified'}`,
        status: 'signed', note_date_time: new Date(), created_at: new Date(), updated_at: new Date(),
      }).catch((err) => { logger.warn({ err, patientId: req.params.id }, 'Hotspot clinical note creation failed — hotspot still saved'); });
      res.status(201).json({ hotspot: mapHotspotRowToResponse(row) });
    } catch (err) { next(err); }
  });
  router.patch('/hotspots/:hotspotId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (req.body.status === 'resolved') { patch.is_active = false; }
      if (req.body.reason !== undefined) { patch.reason = req.body.reason; }
      const [row] = await db('hotspots').where({ id: req.params.hotspotId, clinic_id: req.clinicId }).update(patch).returning(HOTSPOT_COLUMNS);
      // Create a note for hotspot resolution
      if (req.body.status === 'resolved' && row) {
        const activeEp = await db('episodes').where({ patient_id: row.patient_id, clinic_id: req.clinicId, status: 'open' }).whereNull('deleted_at').first();
        await db('clinical_notes').insert({
          clinic_id: req.clinicId, patient_id: row.patient_id, episode_id: activeEp?.id ?? null,
          consent_id: await ensureClinicalNoteConsent({ clinicId: req.clinicId, patientId: row.patient_id, clinicianId: req.user?.id ?? null }),
          author_id: req.user?.id ?? null, title: `Hotspot Resolved — ${row.reason ?? 'Alert'}`,
          note_type: 'hotspot', content: `Hotspot alert resolved: ${row.reason ?? ''}`,
          status: 'signed', note_date_time: new Date(), created_at: new Date(), updated_at: new Date(),
        }).catch((err) => { logger.warn({ err, patientId: row.patient_id }, 'Hotspot resolution note creation failed'); });
      }
      res.json({ hotspot: mapHotspotRowToResponse(row) });
    } catch (err) { next(err); }
  });

  // ─── Admission Waitlist ─────────────────────────────────────────────────────

  // GET /patients/admission-waitlist
  router.get('/admission-waitlist', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // admission_waitlist is a first-class baseline table (R2b). The pre-R2
      // `hasTable` guard has been removed.
      const rows = await db('admission_waitlist')
        .join('patients', 'patients.id', 'admission_waitlist.patient_id')
        .leftJoin('staff as flagged_by', 'flagged_by.id', 'admission_waitlist.flagged_by_staff_id')
        .where('admission_waitlist.clinic_id', req.clinicId)
        .where('admission_waitlist.status', 'waiting')
        .select(
          'admission_waitlist.*',
          'patients.given_name as patient_given_name',
          'patients.family_name as patient_family_name',
          'patients.emr_number',
          db.raw("COALESCE(flagged_by.given_name || ' ' || flagged_by.family_name, '') as flagged_by_name"),
        )
        .orderBy([{ column: 'admission_waitlist.priority', order: 'desc' }, { column: 'admission_waitlist.created_at', order: 'asc' }]);
      res.json({ waitlist: rows.map(mapAdmissionWaitlistListRowToResponse) });
    } catch (err) { next(err); }
  });

  // POST /patients/:id/flag-for-admission — flag patient for admission (from hotspot or planned)
  router.post('/:id/flag-for-admission', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateAdmissionWaitlistSchema.parse(req.body);
      const patientId = req.params.id;
      const { hotspotId, reason, priority, preferredWard, targetAdmissionDate, clinicalNotes, episodeId } = dto;
      const source = hotspotId ? 'hotspot' : 'planned';

      // Check not already on waitlist
      const existing = await db('admission_waitlist')
        .where({ clinic_id: req.clinicId, patient_id: patientId, status: 'waiting' })
        .first();
      if (existing) {
        return next(new AppError('Patient is already on the admission waitlist', 409, 'WAITLIST_ALREADY_EXISTS'));
      }

      const [row] = await db('admission_waitlist').insert({
        id: db.raw('gen_random_uuid()'),
        clinic_id: req.clinicId,
        patient_id: patientId,
        episode_id: episodeId ?? null,
        hotspot_id: hotspotId ?? null,
        source,
        priority: priority ?? 'medium',
        status: 'waiting',
        reason: reason ?? null,
        clinical_notes: clinicalNotes ?? null,
        preferred_ward: preferredWard ?? null,
        target_admission_date: targetAdmissionDate ?? null,
        flagged_by_staff_id: req.user!.id,
        created_at: new Date(),
        updated_at: new Date(),
      }).returning(ADMISSION_WAITLIST_COLUMNS);
      // Record in episode timeline via a clinical note
      const resolvedEpisodeId = episodeId ?? (await db('episodes').where({ patient_id: patientId, clinic_id: req.clinicId, status: 'open' }).whereNull('deleted_at').orderBy('start_date', 'desc').first())?.id;
      if (resolvedEpisodeId) {
        await db('clinical_notes').insert({
          id: db.raw('gen_random_uuid()'),
          clinic_id: req.clinicId,
          patient_id: patientId,
          consent_id: await ensureClinicalNoteConsent({ clinicId: req.clinicId, patientId, clinicianId: req.user?.id ?? null }),
          episode_id: resolvedEpisodeId,
          author_id: req.user!.id,
          title: `Flagged for Admission (${source})`,
          note_type: 'progress',
          content: `Patient flagged for ${source === 'hotspot' ? 'admission from hotspot' : 'planned admission'}.\nPriority: ${priority ?? 'medium'}${reason ? `\nReason: ${reason}` : ''}${preferredWard ? `\nPreferred ward: ${preferredWard}` : ''}${targetAdmissionDate ? `\nTarget date: ${targetAdmissionDate}` : ''}`,
          status: 'signed',
          signed_by_id: req.user!.id,
          signed_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      res.status(201).json({ entry: mapAdmissionWaitlistRowToResponse(row) });
    } catch (err) { next(err); }
  });
  // PATCH /patients/admission-waitlist/:entryId — update waitlist entry
  router.patch('/admission-waitlist/:entryId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateAdmissionWaitlistSchema.parse(req.body);
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (dto.priority !== undefined) patch.priority = dto.priority;
      if (dto.reason !== undefined) patch.reason = dto.reason;
      if (dto.clinicalNotes !== undefined) patch.clinical_notes = dto.clinicalNotes;
      if (dto.preferredWard !== undefined) patch.preferred_ward = dto.preferredWard;
      if (dto.targetAdmissionDate !== undefined) patch.target_admission_date = dto.targetAdmissionDate;
      const [row] = await db('admission_waitlist')
        .where({ id: req.params.entryId, clinic_id: req.clinicId })
        .update(patch)
        .returning(ADMISSION_WAITLIST_COLUMNS);
      if (!row) {
        return next(new AppError('Waitlist entry not found', 404, 'WAITLIST_ENTRY_NOT_FOUND'));
      }
      res.json({ entry: mapAdmissionWaitlistRowToResponse(row) });
    } catch (err) { next(err); }
  });
  router.patch('/admission-waitlist/:entryId/remove', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = RemoveFromWaitlistSchema.parse(req.body);
      const { removalReason } = dto;
      const entry = await db('admission_waitlist')
        .where({ id: req.params.entryId, clinic_id: req.clinicId, status: 'waiting' })
        .first();
      if (!entry) {
        return next(new AppError('Waitlist entry not found or already removed', 404, 'WAITLIST_ENTRY_NOT_FOUND'));
      }

      await db('admission_waitlist')
        .where({ id: req.params.entryId, clinic_id: req.clinicId })
        .update({ status: 'removed', removed_by_staff_id: req.user!.id, removed_at: new Date(), removal_reason: removalReason ?? null, updated_at: new Date() });

      // Record removal in episode timeline
      const resolvedEpisodeId = entry.episode_id ?? (await db('episodes').where({ patient_id: entry.patient_id, clinic_id: req.clinicId, status: 'open' }).whereNull('deleted_at').orderBy('start_date', 'desc').first())?.id;
      if (resolvedEpisodeId) {
        await db('clinical_notes').insert({
          id: db.raw('gen_random_uuid()'),
          clinic_id: req.clinicId,
          patient_id: entry.patient_id,
          consent_id: await ensureClinicalNoteConsent({ clinicId: req.clinicId, patientId: entry.patient_id, clinicianId: req.user?.id ?? null }),
          episode_id: resolvedEpisodeId,
          author_id: req.user!.id,
          title: 'Removed from Admission Waitlist',
          note_type: 'progress',
          content: `Patient removed from admission waitlist.${removalReason ? `\nReason: ${removalReason}` : ''}`,
          status: 'signed',
          signed_by_id: req.user!.id,
          signed_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /patients/admission-waitlist/:entryId/admit — mark as admitted
  router.post('/admission-waitlist/:entryId/admit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await db('admission_waitlist')
        .where({ id: req.params.entryId, clinic_id: req.clinicId, status: 'waiting' })
        .update({ status: 'admitted', updated_at: new Date() });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ─── Patient Contacts (support persons, NOK, carers) ────────────────────────
  router.get('/:id/contacts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('patient_contacts')
        .where({ patient_id: req.params.id, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .orderBy('created_at');
      res.json({
        contacts: rows.map((r) => ({
          id: r.id, patientId: r.patient_id,
          contactType: r.contact_type,
          givenName: r.given_name, familyName: r.family_name,
          relationship: r.relationship,
          phoneMobile: r.phone_mobile, phoneHome: r.phone_home,
          email: r.email,
          isEmergencyContact: r.is_emergency_contact,
          isCarer: r.is_carer,
          hasConsent: r.has_consent,
          consentLevel: r.consent_level ?? 'full',
          consentNotes: r.consent_notes ?? null,
          createdAt: r.created_at,
        })),
      });
    } catch (err) { next(err); }
  });

  router.post('/:id/contacts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreatePatientContactSchema.parse(req.body);
      const { contactType, givenName, familyName, relationship, phoneMobile, phoneHome, email, isEmergencyContact, isCarer, hasConsent, consentLevel, consentNotes } = dto;
      const [row] = await db('patient_contacts').insert({
        id: db.raw('gen_random_uuid()'),
        clinic_id: req.clinicId,
        patient_id: req.params.id,
        contact_type: contactType ?? 'support_person',
        given_name: givenName ?? null,
        family_name: familyName ?? null,
        relationship: relationship ?? null,
        phone_mobile: phoneMobile ?? null,
        phone_home: phoneHome ?? null,
        email: email ?? null,
        is_emergency_contact: isEmergencyContact ?? false,
        is_carer: isCarer ?? false,
        has_consent: hasConsent ?? false,
        consent_level: consentLevel ?? 'full',
        consent_notes: consentNotes ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      }).returning(PATIENT_CONTACT_COLUMNS);
      res.status(201).json({ contact: row });
    } catch (err) { next(err); }
  });

  router.patch('/contacts/:contactId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patch: Record<string, unknown> = { updated_at: new Date() };
      const map: Record<string, string> = {
        contactType: 'contact_type', givenName: 'given_name', familyName: 'family_name',
        relationship: 'relationship', phoneMobile: 'phone_mobile', phoneHome: 'phone_home',
        email: 'email', isEmergencyContact: 'is_emergency_contact', isCarer: 'is_carer', hasConsent: 'has_consent',
      };
      for (const [k, col] of Object.entries(map)) {
        if (req.body[k] !== undefined) patch[col] = req.body[k];
      }
      const [row] = await db('patient_contacts').where({ id: req.params.contactId, clinic_id: req.clinicId }).whereNull('deleted_at').update(patch).returning(PATIENT_CONTACT_COLUMNS);
      res.json({ contact: row });
    } catch (err) { next(err); }
  });

  router.delete('/contacts/:contactId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await db('patient_contacts').where({ id: req.params.contactId, clinic_id: req.clinicId }).update({ deleted_at: new Date() });
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // ─── Patient Diagnoses (from episodes) ───
  router.get('/:id/diagnoses', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('episodes')
        .where({ patient_id: req.params.id, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .whereNotNull('primary_diagnosis')
        .select('primary_diagnosis', 'episode_type', 'status')
        .orderBy('start_date', 'desc');
      // Deduplicate by diagnosis name
      const seen = new Set<string>();
      const diagnoses = rows.filter((r) => {
        const name = (r.primary_diagnosis ?? '').toLowerCase();
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      }).map((r) => ({
        name: r.primary_diagnosis,
        episodeType: r.episode_type,
        episodeStatus: r.status,
      }));
      res.json({ data: diagnoses });
    } catch (err) { next(err); }
  });

  // ─── Patient Providers ───
  router.get('/:id/providers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('patient_providers')
        .where({ patient_id: req.params.id, clinic_id: req.clinicId })
        .orderBy('is_primary', 'desc')
        .orderBy('created_at', 'desc');
      res.json({ providers: rows.map((r) => ({
        id: r.id, patientId: r.patient_id, providerType: r.provider_type,
        providerName: r.provider_name, providerPractice: r.provider_practice,
        providerPhone: r.provider_phone, providerFax: r.provider_fax,
        providerEmail: r.provider_email, providerNumber: r.provider_number,
        providerAddress: r.provider_address, isPrimary: r.is_primary,
        createdAt: r.created_at,
      })) });
    } catch (err) { next(err); }
  });

  router.post('/:id/providers', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreatePatientProviderSchema.parse(req.body);
      const { providerType, providerName, providerPractice, providerPhone, providerFax, providerEmail, providerNumber, providerAddress, isPrimary } = dto;
      const [row] = await db('patient_providers').insert({
        id: db.raw('gen_random_uuid()'),
        patient_id: req.params.id,
        clinic_id: req.clinicId,
        provider_type: providerType ?? 'gp',
        provider_name: providerName ?? null,
        provider_practice: providerPractice ?? null,
        provider_phone: providerPhone ?? null,
        provider_fax: providerFax ?? null,
        provider_email: providerEmail ?? null,
        provider_number: providerNumber ?? null,
        provider_address: providerAddress ?? null,
        is_primary: isPrimary ?? false,
        created_at: new Date(),
        updated_at: new Date(),
      }).returning(PATIENT_PROVIDER_COLUMNS);
      res.status(201).json({ provider: row });
    } catch (err) { next(err); }
  });

  router.delete('/providers/:providerId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await db('patient_providers').where({ id: req.params.providerId, clinic_id: req.clinicId }).delete();
      res.status(204).send();
    } catch (err) { next(err); }
  });

  router.get('/:id/active-specialties', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await db('patient_active_specialties')
        .where({ patient_id: req.params.id, clinic_id: req.clinicId })
        .first();
      const codes: string[] = Array.isArray(row?.specialties) ? row.specialties : [];

      if (codes.length === 0) {
        res.json({ specialties: [] });
        return;
      }

      const refs = await db('specialties')
        .whereIn('code', codes)
        .select('code', 'display')
        .orderBy('sort_order');

      res.json({
        specialties: refs.map((s) => ({ code: s.code, display: s.display })),
      });
    } catch (err) { next(err); }
  });

  router.get('/:id/summary-signoffs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.id);
      const signoffs = await listPatientSummarySignoffs(auth, req.params.id);
      res.json(PatientSummarySignoffListSchema.parse({ signoffs }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/summary-signoffs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.id);
      const dto = SignPatientSummarySchema.parse(req.body);
      const signoffs = await signPatientSummary(auth, req.params.id, dto);
      res.status(201).json(PatientSummarySignoffListSchema.parse({ signoffs }));
    } catch (err) {
      next(err);
    }
  });
}
