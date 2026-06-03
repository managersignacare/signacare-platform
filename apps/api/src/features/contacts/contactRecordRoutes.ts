/**
 * ABF Contact Record Routes
 *
 * Serves contact/encounter data from two sources:
 * 1. clinicalnotes table (contactmeta JSONB field)
 * 2. contact_records table (auto-created by middleware)
 *
 * Also provides an external API for integration with other systems.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { db } from '../../db/db';
import { resolveTeamNames } from '../../utils/nameResolver';
import { CreateContactRecordSchema, UpdateContactRecordSchema } from '@signacare/shared';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified against schema-snapshot.json: contact_records has these 23
// columns. NO deleted_at — soft-delete is not used; status (draft/signed)
// + is_reportable handle the visibility model. CLAUDE.md §1.4 explicitly
// lists contact_records in the "tables WITHOUT deleted_at" set.
const CONTACT_RECORD_COLUMNS = [
  'id',
  'patient_id',
  'clinic_id',
  'episode_id',
  'staff_id',
  'contact_type',
  'contact_date',
  'contact_time',
  'duration_min',
  'location',
  'contact_medium',
  'program',
  'service_recipients',
  'is_reportable',
  'team',
  'num_providing',
  'num_receiving',
  'content',
  'template_id',
  'status',
  'created_at',
  'updated_at',
] as const;

type JsonRecord = Record<string, unknown>;

interface ContactMetaPayload extends JsonRecord {
  contactDate?: string;
  contactTime?: string;
  serviceSetting?: string;
  location?: string;
  contactMedium?: string;
  contactType?: string;
  durationMin?: string | number;
  durationCategory?: string;
  principalDiagnosis?: string;
  serviceRecipients?: unknown[];
  program?: string;
  sourceId?: string;
}

interface UnifiedContactRow {
  id: string;
  patient_id: string;
  episode_id: string | null;
  note_type: string | null;
  title: string | null;
  content: unknown;
  status: string | null;
  did_not_attend: boolean | null;
  is_reportable: boolean | null;
  contact_meta: unknown;
  created_at: string | Date;
  staff_name: string;
  staff_id: string | null;
  episode_title: string | null;
  team: string | null;
  source: string;
}

interface ExportContactRow {
  id: string;
  note_type: string | null;
  title: string | null;
  contact_meta: unknown;
  is_reportable_contact: boolean | null;
  did_not_attend: boolean | null;
  status: string | null;
  created_at: string | Date;
  staff_name: string;
  episode_title: string | null;
  team: string | null;
  primary_diagnosis: string | null;
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object') return value as JsonRecord;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as JsonRecord : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseContactMeta(value: unknown): ContactMetaPayload {
  return (parseJsonRecord(value) ?? {}) as ContactMetaPayload;
}

// ── Unified contacts list (merges clinicalnotes + contact_records) ────────

// GET /api/v1/contact-records/patient/:patientId/unified
router.get('/patient/:patientId/unified', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.params.patientId;
    const { startDate, endDate, format } = req.query;

    // Source 1: clinicalnotes with contactMeta
    const notesQ = db<UnifiedContactRow>('clinical_notes')
      .leftJoin('staff as author', 'author.id', 'clinical_notes.author_id')
      .leftJoin('episodes', 'episodes.id', 'clinical_notes.episode_id')
      .where('clinical_notes.patient_id', patientId)
      .where('clinical_notes.clinic_id', req.clinicId)
      .whereNull('clinical_notes.deleted_at')
      .whereNotNull('clinical_notes.contact_meta')
      .select(
        'clinical_notes.id',
        'clinical_notes.patient_id as patient_id',
        'clinical_notes.episode_id as episode_id',
        'clinical_notes.note_type as note_type',
        'clinical_notes.title',
        'clinical_notes.content',
        'clinical_notes.status',
        'clinical_notes.did_not_attend as did_not_attend',
        'clinical_notes.is_reportable_contact as is_reportable',
        'clinical_notes.contact_meta as contact_meta',
        'clinical_notes.created_at as created_at',
        db.raw("COALESCE(author.given_name || ' ' || author.family_name, '') as staff_name"),
        'clinical_notes.author_id as staff_id',
        'episodes.presenting_problem as episode_title',
        'episodes.team_id as team',
        db.raw("'clinicalnote' as source"),
      )
      .orderBy('clinical_notes.created_at', 'desc');

    if (startDate) notesQ.where('clinical_notes.created_at', '>=', new Date(startDate as string));
    if (endDate) notesQ.where('clinical_notes.created_at', '<=', new Date(endDate as string));

    // Source 2: contact_records table
    const crQ = db<UnifiedContactRow>('contact_records as cr')
      .leftJoin('staff', 'staff.id', 'cr.staff_id')
      .leftJoin('episodes', 'episodes.id', 'cr.episode_id')
      .where({ 'cr.clinic_id': req.clinicId, 'cr.patient_id': patientId })
      .select(
        'cr.id',
        'cr.patient_id',
        'cr.episode_id',
        'cr.contact_type as note_type',
        db.raw("cr.contact_type as title"),
        'cr.content',
        'cr.status',
        db.raw("false as did_not_attend"),
        'cr.is_reportable',
        db.raw(`json_build_object(
          'contactDate', cr.contact_date, 'contactTime', cr.contact_time,
          'contactType', cr.contact_type, 'durationMin', cr.duration_min,
          'team', CASE WHEN cr.content IS NOT NULL AND cr.content != '' THEN cr.content::jsonb->>'team' ELSE cr.team END,
          'location', CASE WHEN cr.content IS NOT NULL AND cr.content != '' THEN cr.content::jsonb->>'location' ELSE cr.location END,
          'contactMedium', CASE WHEN cr.content IS NOT NULL AND cr.content != '' THEN cr.content::jsonb->>'contactMedium' ELSE cr.contact_medium END,
          'program', CASE WHEN cr.content IS NOT NULL AND cr.content != '' THEN cr.content::jsonb->>'program' ELSE cr.program END,
          'serviceRecipients', CASE WHEN cr.content IS NOT NULL AND cr.content != '' THEN cr.content::jsonb->>'serviceRecipients' ELSE cr.service_recipients END,
          'numProvidingService', CASE WHEN cr.content IS NOT NULL AND cr.content != '' THEN cr.content::jsonb->>'numProvidingService' ELSE cr.num_providing::text END,
          'numReceivingService', CASE WHEN cr.content IS NOT NULL AND cr.content != '' THEN cr.content::jsonb->>'numReceivingService' ELSE cr.num_receiving::text END
        ) as contact_meta`),
        'cr.created_at',
        db.raw("COALESCE(staff.given_name || ' ' || staff.family_name, '') as staff_name"),
        'cr.staff_id',
        'episodes.presenting_problem as episode_title',
        db.raw("'' as team"),
        db.raw("'contact_record' as source"),
      )
      .orderBy('cr.created_at', 'desc');

    if (startDate) crQ.where('cr.contact_date', '>=', startDate);
    if (endDate) crQ.where('cr.contact_date', '<=', endDate);

    const noteContacts = await notesQ;
    const crContacts = await crQ;

    // Merge and deduplicate.
    // Some contact_records were auto-created FROM clinical notes (via autoContactRecord).
    // Those records store a `sourceId` in their content JSON that matches the clinical
    // note ID.  Filter them out so encounters aren't double-counted.
    const noteIds = new Set(noteContacts.map((n) => n.id));
    const uniqueCr = crContacts.filter((cr) => {
      if (noteIds.has(cr.id)) return false;
      // Parse the content text (stored as JSON string in text column) to check sourceId
      const content = parseJsonRecord(cr.content);
      const sourceId = typeof content?.sourceId === 'string' ? content.sourceId : null;
      if (sourceId && noteIds.has(sourceId)) return false;
      return true;
    });
    const all = [...noteContacts, ...uniqueCr].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Resolve team names
    await resolveTeamNames(all, 'team');

    // CSV export
    if (format === 'csv') {
      const header = 'Date,Time,Type,Title,Staff,Team,Setting,Medium,Duration,Diagnosis,Reportable,Status';
      const rows = all.map((r) => {
        const m = parseContactMeta(r.contact_meta);
        const date = typeof m.contactDate === 'string' ? m.contactDate : new Date(r.created_at).toLocaleDateString('en-AU');
        const time = typeof m.contactTime === 'string' ? m.contactTime : '';
        const setting = (typeof m.serviceSetting === 'string' ? m.serviceSetting : (typeof m.location === 'string' ? m.location : ''));
        const medium = (typeof m.contactMedium === 'string' ? m.contactMedium : (typeof m.contactType === 'string' ? m.contactType : ''));
        const diagnosis = typeof m.principalDiagnosis === 'string' ? m.principalDiagnosis : '';
        return [date, time, r.note_type, r.title ?? '', r.staff_name, r.team ?? '', setting, medium, m.durationMin ?? m.durationCategory ?? '', diagnosis, r.is_reportable ? 'Yes' : 'No', r.status]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=contacts-${patientId}.csv`);
      res.send([header, ...rows].join('\n'));
      return;
    }

    res.json({
      contacts: all.map((r) => ({
        id: r.id,
        patientId: r.patient_id,
        episodeId: r.episode_id,
        noteType: r.note_type,
        title: r.title,
        content: r.content,
        status: r.status,
        didNotAttend: r.did_not_attend,
        isReportable: r.is_reportable,
        contactMeta: parseContactMeta(r.contact_meta),
        staffName: r.staff_name,
        staffId: r.staff_id,
        episodeTitle: r.episode_title,
        team: r.team,
        createdAt: r.created_at,
        source: r.source,
      })),
      total: all.length,
    });
  } catch (err) { next(err); }
});

// ── CRUD for contact_records ──────────────────────────────────────────────

// GET /api/v1/contact-records/patient/:patientId
router.get('/patient/:patientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('contact_records')
      .where({ clinic_id: req.clinicId, patient_id: req.params.patientId })
      .orderBy('contact_date', 'desc')
      .limit(50);
    res.json({ records: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/contact-records/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('contact_records').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
  } catch (err) { next(err); }
});

// POST /api/v1/contact-records
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateContactRecordSchema.parse(req.body);
    // Extended fields stored in the content JSONB column
    const extendedMeta = {
      serviceSetting: body.serviceSetting,
      durationCategory: body.durationCategory,
      practitionerCategory: body.practitionerCategory,
      legalStatus: body.legalStatus,
      principalDiagnosis: body.principalDiagnosis,
      icd10Code: body.icd10Code,
      interventionTypes: body.interventionTypes || [],
      outcomeMeasures: body.outcomeMeasures || [],
      patientPresent: body.patientPresent ?? true,
      carerPresent: body.carerPresent ?? false,
      interpreterUsed: body.interpreterUsed ?? false,
      briefSummary: body.briefSummary,
      sourceType: body.sourceType ?? 'clinical_note',
      sourceId: body.sourceId || null,
      // Additional fields from ContactFormDialog
      team: body.team || null,
      location: body.location || null,
      contactMedium: body.contactMedium || null,
      program: body.program || null,
      serviceRecipients: body.serviceRecipients || null,
      numProvidingService: body.numProvidingService ?? null,
      numReceivingService: body.numReceivingService ?? null,
    };
    const [record] = await db('contact_records').insert({
      clinic_id: req.clinicId,
      patient_id: body.patientId,
      episode_id: body.episodeId || null,
      staff_id: req.user!.id,
      contact_date: body.contactDate || new Date().toISOString().slice(0, 10),
      contact_time: body.contactTime || new Date().toTimeString().slice(0, 5),
      contact_type: body.contactType || 'Face to face — Individual',
      duration_min: body.durationMinutes ?? body.durationMin ?? null,
      is_reportable: body.isReportable ?? true,
      status: body.status ?? 'completed',
      content: JSON.stringify(extendedMeta),
    }).returning(CONTACT_RECORD_COLUMNS);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PATCH /api/v1/contact-records/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = UpdateContactRecordSchema.parse(req.body);
    const updates: Record<string, unknown> = { updated_at: new Date() };
    const fieldMap: Record<string, string> = {
      contactType: 'contact_type', contactDate: 'contact_date',
      contactTime: 'contact_time', durationMin: 'duration_min',
      durationMinutes: 'duration_min', isReportable: 'is_reportable',
      status: 'status', content: 'content',
    };
    const bodyRec = body as Record<string, unknown>;
    for (const [key, dbCol] of Object.entries(fieldMap)) {
      if (bodyRec[key] !== undefined) {
        let val = bodyRec[key];
        if (key === 'interventionTypes' || key === 'outcomeMeasures') val = JSON.stringify(val);
        updates[dbCol] = val;
      }
    }
    const affected = await db('contact_records').where({ id: req.params.id, clinic_id: req.clinicId }).update(updates);
    if (affected === 0) { res.status(404).json({ error: 'Contact record not found' }); return; }
    const updated = await db('contact_records').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!updated) { res.status(404).json({ error: 'Contact record not found' }); return; }
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/v1/contact-records/by-source/:sourceType/:sourceId
router.get('/by-source/:sourceType/:sourceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // source_type and source_id are stored in the content JSONB column
    // Use JSONB operators to avoid SQL injection via string interpolation
    const row = await db('contact_records')
      .where({ clinic_id: req.clinicId })
      .whereRaw("content::jsonb->>'sourceType' = ?", [req.params.sourceType])
      .whereRaw("content::jsonb->>'sourceId' = ?", [req.params.sourceId])
      .first();
    res.json(row || null);
  } catch (err) { next(err); }
});

// GET /api/v1/contact-records/incomplete/mine
router.get('/incomplete/mine', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // contact_records has NO deleted_at column (CLAUDE.md §1.4).
    // Status=draft is the visibility filter; removed pre-existing
    // .whereNull('deleted_at') call which would have crashed at runtime.
    const rows = await db('contact_records')
      .where({ clinic_id: req.clinicId, staff_id: req.user!.id, status: 'draft' })
      .orderBy('contact_date', 'desc')
      .limit(20);
    res.json({ records: rows });
  } catch (err) { next(err); }
});

// ── External API (for integration with other systems) ─────────────────────

// GET /api/v1/contact-records/export/:patientId — full export for external systems
router.get('/export/:patientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, format } = req.query;
    const patientId = req.params.patientId;

    // Get patient info
    const patient = await db('patients').where({ id: patientId, clinic_id: req.clinicId }).first();
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }

    // Get all contacts from clinicalnotes
    // BUG-430: qualified-column clinic_id on the export-side clinical_notes
    // table (the joined staff/episodes are tenant-scoped via their own RLS).
    const q = db<ExportContactRow>('clinical_notes')
      .leftJoin('staff as author', 'author.id', 'clinical_notes.author_id')
      .leftJoin('episodes', 'episodes.id', 'clinical_notes.episode_id')
      .where('clinical_notes.patient_id', patientId)
      .where('clinical_notes.clinic_id', req.clinicId)
      .whereNull('clinical_notes.deleted_at')
      .whereNotNull('clinical_notes.contact_meta')
      .select(
        'clinical_notes.id', 'clinical_notes.note_type', 'clinical_notes.title',
        'clinical_notes.contact_meta', 'clinical_notes.is_reportable_contact',
        'clinical_notes.did_not_attend', 'clinical_notes.status',
        'clinical_notes.created_at',
        db.raw("COALESCE(author.given_name || ' ' || author.family_name, '') as staff_name"),
        'episodes.presenting_problem as episode_title',
        'episodes.team_id as team', 'episodes.primary_diagnosis',
      )
      .orderBy('clinical_notes.created_at', 'desc');

    if (startDate) q.where('clinical_notes.created_at', '>=', new Date(startDate as string));
    if (endDate) q.where('clinical_notes.created_at', '<=', new Date(endDate as string));

    const rows = await q;
    await resolveTeamNames(rows, 'team');

    const contacts = rows.map((r) => {
      const m = parseContactMeta(r.contact_meta);
      const serviceRecipients = Array.isArray(m.serviceRecipients) ? m.serviceRecipients : [];
      return {
        id: r.id,
        contactDate: typeof m.contactDate === 'string' ? m.contactDate : new Date(r.created_at).toISOString().split('T')[0],
        contactTime: typeof m.contactTime === 'string' ? m.contactTime : null,
        contactType: (typeof m.contactMedium === 'string' ? m.contactMedium : m.contactType) ?? r.note_type,
        title: r.title,
        staffName: r.staff_name,
        team: r.team,
        setting: (typeof m.serviceSetting === 'string' ? m.serviceSetting : m.location) ?? null,
        medium: typeof m.contactMedium === 'string' ? m.contactMedium : null,
        duration: m.durationMin ?? m.durationCategory ?? null,
        program: typeof m.program === 'string' ? m.program : null,
        serviceRecipients,
        diagnosis: r.primary_diagnosis ?? m.principalDiagnosis ?? null,
        isReportable: r.is_reportable_contact ?? true,
        didNotAttend: r.did_not_attend ?? false,
        status: r.status,
        episodeTitle: r.episode_title,
      };
    });

    // FHIR-compatible output
    if (format === 'fhir') {
      res.json({
        resourceType: 'Bundle',
        type: 'searchset',
        total: contacts.length,
        entry: contacts.map(c => ({
          resource: {
            resourceType: 'Encounter',
            id: c.id,
            status: c.status === 'signed' ? 'finished' : 'in-progress',
            class: { code: c.contactType, display: c.contactType },
            subject: { reference: `Patient/${patientId}`, display: `${patient.given_name} ${patient.family_name}` },
            period: { start: `${c.contactDate}T${c.contactTime ?? '00:00'}:00` },
            participant: [{ individual: { display: c.staffName } }],
            reasonCode: c.diagnosis ? [{ text: c.diagnosis }] : [],
            serviceType: { text: c.title },
            location: c.setting ? [{ location: { display: c.setting } }] : [],
          },
        })),
      });
      return;
    }

    res.json({
      patient: { id: patientId, name: `${patient.given_name} ${patient.family_name}`, urNumber: patient.emr_number },
      contacts,
      total: contacts.length,
      exportedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

export default router;
