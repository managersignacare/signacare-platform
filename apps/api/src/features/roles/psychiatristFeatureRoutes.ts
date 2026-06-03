import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbRead } from '../../db/db';
import { multerUpload } from '../../middleware/uploadMiddleware';
import { PSYCHIATRIST_ROLES } from '../../shared/roleGroups';
import { logger } from '../../utils/logger';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requireSpecialty } from '../../shared/authGuards';
import { mapSideEffectScheduleRowToResponse, type SideEffectScheduleRow } from './sideEffectScheduleMapper';
// BUG-424b — Whisper ASR forensic audit SSoT (CLAUDE.md §6.3 + Audit Tier 4.4).
import {
  parseWhisperVersionFromResponse,
  recordWhisperAsrInteractionSafely,
} from '../../mcp/whisperClient';

// Local Zod schemas (Phase R3b / CLAUDE.md §12).
const InteractionCheckSchema = z.object({
  patientId: z.string().uuid(),
  newMedicationName: z.string().min(1).max(200).optional(),
  newMedicationCode: z.string().max(60).optional(),
}).refine(
  (d) => !!(d.newMedicationName ?? d.newMedicationCode),
  { message: 'newMedicationName or newMedicationCode is required', path: ['newMedicationName'] },
);

// Voice quick-memo accepts patientId + optional episodeId + noteType in
// multipart form-data (alongside the audio file handled by multer).
const QuickMemoSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  noteType: z.string().max(60).optional(),
});

interface ActiveMedicationRow {
  patient_id: string;
  clinic_id: string;
  status: string;
  generic_name: string | null;
  medication_code: string | null;
  dose: string | null;
  frequency: string | null;
}

interface DrugInteractionRow {
  drug_a: string | null;
  drug_b: string | null;
  severity: string | null;
  description: string | null;
  recommendation: string | null;
  source: string | null;
}

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
// clinical_formulations + side_effect_schedules materialized in R2b baseline
// — pre-R2 they were ghost tables silently targeted by this router. The
// Phase F markers these replace have been removed.
const CLINICAL_FORMULATION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'author_id',
  'formulation_type', 'presenting_problem',
  'predisposing_factors', 'precipitating_factors', 'perpetuating_factors',
  'protective_factors', 'summary', 'diagnostic_formulation',
  'treatment_implications', 'shared_with_patient', 'shared_with_clinicians',
  'confidentiality_level',
  'status', 'created_at', 'updated_at', 'deleted_at',
] as const;

const SIDE_EFFECT_SCHEDULE_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'patient_medication_id',
  'schedule_type', 'frequency_weeks', 'next_due_date', 'last_completed_date',
  'parameters', 'notes', 'status', 'created_by_id', 'created_at', 'updated_at',
] as const;

const router = Router();

const DASHBOARD_MY_CLINIC_ROLES = Array.from(
  new Set([
    ...PSYCHIATRIST_ROLES,
    'case_manager',
    'readonly',
    'referral_coordinator',
  ]),
);

//  PSYCHIATRIST ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── My Clinic Today ─────────────────────────────────────────────────────────
// GET /dashboard/my-clinic-today
router.get(
  '/dashboard/my-clinic-today',
  requireRoles(DASHBOARD_MY_CLINIC_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const today = new Date().toISOString().slice(0, 10);

      const rows = await dbRead.raw(`
        SELECT
          a.id AS appointment_id,
          a.start_time,
          a.end_time,
          a.status AS appointment_status,
          a.appointment_type,
          p.id AS patient_id,
          p.given_name || ' ' || p.family_name AS patient_name,
          p.emr_number,
          p.date_of_birth,
          (SELECT cn.content FROM clinical_notes cn
            WHERE cn.patient_id = p.id AND cn.clinic_id = ?
            ORDER BY cn.created_at DESC LIMIT 1
          ) AS last_note_summary,
          (SELECT cn.created_at FROM clinical_notes cn
            WHERE cn.patient_id = p.id AND cn.clinic_id = ?
            ORDER BY cn.created_at DESC LIMIT 1
          ) AS last_note_date
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        WHERE a.clinician_id = ?
          AND a.clinic_id = ?
          AND a.start_time::date = ?
        ORDER BY a.start_time ASC
      `, [req.clinicId, req.clinicId, req.user!.id, req.clinicId, today]);

      res.json({ data: rows.rows, date: today });
    } catch (err) { next(err); }
  },
);

// ── Drug Interaction Check ──────────────────────────────────────────────────
// POST /medications/interaction-check
router.post(
  '/medications/interaction-check',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, newMedicationName, newMedicationCode } = InteractionCheckSchema.parse(req.body);

      // Get current active medications for the patient
      const currentMeds = await dbRead<ActiveMedicationRow>('prescriptions')
        .where({ patient_id: patientId, clinic_id: req.clinicId })
        .whereIn('status', ['active', 'on_hold'])
        .whereNull('deleted_at')
        .select('generic_name', 'pbs_item_code as medication_code', 'dose', 'frequency');

      // Check known interactions from local DB
      const interactions: Array<{
        existingMedication: string | null;
        newMedication: string | undefined;
        interactions: Array<{
          severity: string | null;
          description: string | null;
          recommendation: string | null;
          source: string | null;
        }>;
      }> = [];
      for (const med of currentMeds) {
        const knownInteractions = await dbRead<DrugInteractionRow>('drug_interactions')
          .where(function () {
            this.where({ drug_a: newMedicationCode || newMedicationName, drug_b: med.medication_code || med.generic_name })
              .orWhere({ drug_a: med.medication_code || med.generic_name, drug_b: newMedicationCode || newMedicationName });
          })
          .select('drug_a', 'drug_b', 'severity', 'description', 'recommendation', 'source')
          .catch((err) => {
            logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'drug_interactions query failed — assuming no known interactions');
            return [] as DrugInteractionRow[];
          });

        if (knownInteractions.length > 0) {
          interactions.push({
            existingMedication: med.generic_name,
            newMedication: newMedicationName,
            interactions: knownInteractions.map((i) => ({
              severity: i.severity,
              description: i.description,
              recommendation: i.recommendation,
              source: i.source,
            })),
          });
        }
      }

      // Also check for duplicate therapeutic class
      const duplicateClass = currentMeds.filter(
        (m) => m.generic_name?.toLowerCase() === newMedicationName?.toLowerCase(),
      );

      res.json({
        data: {
          interactions,
          duplicateWarning: duplicateClass.length > 0
            ? `Patient already on ${duplicateClass[0].generic_name}`
            : null,
          currentMedicationCount: currentMeds.length,
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (err) { next(err); }
  },
);

// ── Clinical Formulations CRUD (5P model) ───────────────────────────────────
// ── Clinical Formulations (5P) ──────────────────────────────────────────────
// Audit Tier 1.3 (CRIT-H4 / GAP-B4). Gated end-to-end:
//   - Route: requireRoles([...PSYCHIATRIST_ROLES]) — admits clinicians + admin
//     + superadmin. The DB staff.role enum only has admin/clinician/
//     receptionist/superadmin, so narrower role-literal gating is ineffective.
//   - Service-layer: requireSpecialty(auth, ['psychiatry']) — excludes
//     psychologists who have role='clinician' + specialty='psychology'.
//   - Read filter: author_id = caller OR shared_with_clinicians=true.
// Psychiatrist → formulation is visible to themselves by default; they can
// toggle shared_with_clinicians=true to allow the wider clinical team to read.

// Tier 6.1 (MED-H1) — visibility gate by confidentiality_level.
// Returns true iff `auth` is authorised to see `row` according to the
// 3-tier scheme: restricted → author only; confidential → author + admin;
// standard → existing behaviour (author OR shared_with_clinicians=true).
function canSeeFormulation(
  row: { author_id: string | null; shared_with_clinicians: boolean; confidentiality_level: string },
  authStaffId: string,
  authRole: string,
): boolean {
  const isAuthor = row.author_id === authStaffId;
  const isAdmin = authRole === 'admin' || authRole === 'superadmin';
  if (row.confidentiality_level === 'restricted') return isAuthor;
  if (row.confidentiality_level === 'confidential') return isAuthor || isAdmin;
  // 'standard' or anything else — legacy path.
  return isAuthor || row.shared_with_clinicians;
}

// GET /clinical-formulations
router.get(
  '/clinical-formulations',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requireSpecialty(auth, ['psychiatry']);
      const { patientId, limit = '20' } = req.query;
      const isAdmin = auth.role === 'admin' || auth.role === 'superadmin';
      // WHERE filter encodes the 3-tier visibility logic so the DB does
      // the access check, not a post-filter:
      //   - Any row the caller authored → visible
      //   - confidentiality_level='standard' AND shared_with_clinicians → visible
      //   - confidentiality_level='confidential' AND caller is admin → visible
      //   - confidentiality_level='restricted' AND caller is author → already covered above
      let query = dbRead('clinical_formulations')
        .where({ clinic_id: req.clinicId })
        .where(function () {
          this.where('author_id', auth.staffId)
            .orWhere(function () {
              this.where('confidentiality_level', 'standard')
                .andWhere('shared_with_clinicians', true);
            });
          if (isAdmin) {
            this.orWhere('confidentiality_level', 'confidential');
          }
        })
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit as string, 10));

      if (patientId) query = query.where({ patient_id: patientId });

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// GET /clinical-formulations/:id
router.get(
  '/clinical-formulations/:id',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requireSpecialty(auth, ['psychiatry']);
      const row = await dbRead('clinical_formulations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      // Confidentiality: return 404 (not 403) when a formulation exists but
      // the caller is not authorised. Minimal-disclosure: the caller
      // shouldn't learn that a formulation exists at all.
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      if (!canSeeFormulation(row, auth.staffId, auth.role)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// POST /clinical-formulations
router.post(
  '/clinical-formulations',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requireSpecialty(auth, ['psychiatry']);
      const {
        patientId, episodeId,
        presenting, predisposing, precipitating, perpetuating, protective,
        summary, diagnosticFormulation, treatmentImplications,
        sharedWithPatient, sharedWithClinicians, confidentialityLevel, status,
      } = req.body;

      if (!patientId) {
        res.status(400).json({ error: 'patientId is required' });
        return;
      }

      const validConfidentiality = ['standard', 'confidential', 'restricted'];
      const confidentiality = typeof confidentialityLevel === 'string' && validConfidentiality.includes(confidentialityLevel)
        ? confidentialityLevel
        : 'standard';

      const [row] = await db('clinical_formulations')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: patientId,
          episode_id: episodeId || null,
          formulation_type: '5p',
          presenting_problem: presenting || null,
          predisposing_factors: predisposing || null,
          precipitating_factors: precipitating || null,
          perpetuating_factors: perpetuating || null,
          protective_factors: protective || null,
          summary: summary || null,
          diagnostic_formulation: diagnosticFormulation || null,
          treatment_implications: treatmentImplications || null,
          shared_with_patient: sharedWithPatient || false,
          shared_with_clinicians: sharedWithClinicians || false,
          confidentiality_level: confidentiality,
          status: status || 'draft',
          author_id: auth.staffId,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(CLINICAL_FORMULATION_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /clinical-formulations/:id
router.put(
  '/clinical-formulations/:id',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requireSpecialty(auth, ['psychiatry']);

      // Confidentiality: only the author may update. Even other psychiatrists
      // cannot edit a colleague's formulation. They can create a new one.
      const existing = await db('clinical_formulations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      if (existing.author_id !== auth.staffId) {
        res.status(403).json({ error: 'Only the author may edit this formulation', code: 'NOT_AUTHOR' });
        return;
      }

      const {
        presenting, predisposing, precipitating, perpetuating, protective,
        summary, diagnosticFormulation, treatmentImplications,
        sharedWithPatient, sharedWithClinicians, confidentialityLevel, status,
      } = req.body;

      const updates = {
        updated_at: db.fn.now(),
        ...(presenting !== undefined ? { presenting_problem: presenting } : {}),
        ...(predisposing !== undefined ? { predisposing_factors: predisposing } : {}),
        ...(precipitating !== undefined ? { precipitating_factors: precipitating } : {}),
        ...(perpetuating !== undefined ? { perpetuating_factors: perpetuating } : {}),
        ...(protective !== undefined ? { protective_factors: protective } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(diagnosticFormulation !== undefined ? { diagnostic_formulation: diagnosticFormulation } : {}),
        ...(treatmentImplications !== undefined ? { treatment_implications: treatmentImplications } : {}),
        ...(sharedWithPatient !== undefined ? { shared_with_patient: sharedWithPatient } : {}),
        ...(sharedWithClinicians !== undefined ? { shared_with_clinicians: sharedWithClinicians } : {}),
        ...(confidentialityLevel !== undefined
          && ['standard', 'confidential', 'restricted'].includes(confidentialityLevel)
          ? { confidentiality_level: confidentialityLevel }
          : {}),
        ...(status !== undefined ? { status } : {}),
      };

      const [row] = await db('clinical_formulations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(updates)
        .returning(CLINICAL_FORMULATION_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /clinical-formulations/:id
router.delete(
  '/clinical-formulations/:id',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requireSpecialty(auth, ['psychiatry']);
      // Confidentiality: only the author may delete (admin/superadmin bypass
      // via requireSpecialty). Other psychiatrists cannot delete colleagues'
      // formulations.
      const existing = await db('clinical_formulations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      if (existing.author_id !== auth.staffId && auth.role !== 'admin' && auth.role !== 'superadmin') {
        res.status(403).json({ error: 'Only the author may delete this formulation', code: 'NOT_AUTHOR' });
        return;
      }
      const deleted = await db('clinical_formulations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Side Effect Schedules CRUD (AIMS, metabolic monitoring) ─────────────────
// GET /side-effect-schedules
router.get(
  '/side-effect-schedules',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, scheduleType, status } = req.query;
      let query = dbRead('side_effect_schedules')
        .where({ clinic_id: req.clinicId })
        .orderBy('next_due_date', 'asc');

      if (patientId) query = query.where({ patient_id: patientId });
      if (scheduleType) query = query.where({ schedule_type: scheduleType });
      if (status) query = query.where({ status });

      const data = await query;
      // BUG-613 — apply mapper at boundary (canonical camelCase per
      // CLAUDE.md §5.2). Pre-fix shape leaked snake_case to frontend
      // and `data` was wrapped in an envelope; the mapper produces
      // canonical camelCase. The wrapper envelope is preserved for
      // frontend backwards compat (consumer reads `r.value?.data ?? []`).
      res.json({ data: (data as SideEffectScheduleRow[]).map(mapSideEffectScheduleRowToResponse) });
    } catch (err) { next(err); }
  },
);

// POST /side-effect-schedules
router.post(
  '/side-effect-schedules',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId, prescriptionId, scheduleType, frequency,
        nextDueDate, parameters, notes,
      } = req.body;

      const [row] = await db('side_effect_schedules')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: patientId,
          patient_medication_id: prescriptionId || null,
          schedule_type: scheduleType,
          frequency_weeks: frequency || 4,
          next_due_date: nextDueDate,
          parameters: JSON.stringify(parameters || {}),
          notes: notes || null,
          status: 'active',
          created_by_id: req.user!.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(SIDE_EFFECT_SCHEDULE_COLUMNS);

      // BUG-613 — apply mapper at boundary.
      res.status(201).json(mapSideEffectScheduleRowToResponse(row as SideEffectScheduleRow));
    } catch (err) { next(err); }
  },
);

// PUT /side-effect-schedules/:id
router.put(
  '/side-effect-schedules/:id',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        frequency, nextDueDate, parameters, notes,
        status, lastCompletedDate,
      } = req.body;

      const updates = {
        updated_at: db.fn.now(),
        ...(frequency !== undefined ? { frequency_weeks: frequency } : {}),
        ...(nextDueDate !== undefined ? { next_due_date: nextDueDate } : {}),
        ...(parameters !== undefined ? { parameters: JSON.stringify(parameters) } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(lastCompletedDate !== undefined ? { last_completed_date: lastCompletedDate } : {}),
      };

      const [row] = await db('side_effect_schedules')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(updates)
        .returning(SIDE_EFFECT_SCHEDULE_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      // BUG-613 — apply mapper at boundary.
      res.json(mapSideEffectScheduleRowToResponse(row as SideEffectScheduleRow));
    } catch (err) { next(err); }
  },
);

// DELETE /side-effect-schedules/:id
router.delete(
  '/side-effect-schedules/:id',
  requireRoles([...PSYCHIATRIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('side_effect_schedules')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Voice Quick Memo ────────────────────────────────────────────────────────
// POST /voice/quick-memo — upload audio, transcribe via Whisper, save as note
router.post(
  '/voice/quick-memo',
  requireRoles([...PSYCHIATRIST_ROLES]),
  multerUpload.single('audio'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, episodeId, noteType } = QuickMemoSchema.parse(req.body);
      const audioFile = req.file;

      if (!audioFile) {
        res.status(400).json({ error: 'Audio file is required (field: audio)' });
        return;
      }

      // Transcribe via Whisper
      const WHISPER_API_URL = process.env.WHISPER_API_URL ?? 'http://localhost:8080';
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', audioFile.buffer, {
        filename: audioFile.originalname || 'recording.webm',
        contentType: audioFile.mimetype,
      });
      form.append('response_format', 'json');
      form.append('language', 'en');

      const axios = (await import('axios')).default;
      const whisperStartedAt = Date.now();
      const whisperResp = await axios.post(`${WHISPER_API_URL}/inference`, form, {
        headers: form.getHeaders(),
        timeout: 120000,
      });
      const whisperLatencyMs = Date.now() - whisperStartedAt;

      const transcript = whisperResp.data?.text?.trim() || '';

      if (!transcript) {
        res.status(422).json({ error: 'Transcription produced no text. Please try again.' });
        return;
      }

      // Save as clinical note
      const noteId = randomUUID();
      const [note] = await db('clinical_notes')
        .insert({
          id: noteId,
          clinic_id: req.clinicId,
          patient_id: patientId,
          episode_id: episodeId || null,
          note_type: noteType || 'quick_memo',
          content: transcript,
          status: 'draft',
          author_id: req.user!.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(['id']);

      // BUG-424b — Whisper ASR forensic-identity audit row. Same SSoT helper
      // as the ambient pipeline (apps/api/src/mcp/ambientProcessor.ts:622).
      // Failure is logged but does NOT abort the clinical flow — the note
      // is already persisted; degraded forensic identity is preferred over
      // a lost transcript. parseWhisperVersionFromResponse falls back to
      // the cached /health probe when /inference omits model_version.
      const { whisperModel, whisperModelVersion } = await parseWhisperVersionFromResponse(
        whisperResp.data ?? {},
      );
      await recordWhisperAsrInteractionSafely({
        clinicId: req.clinicId,
        userId: req.user!.id,
        patientId,
        episodeId: episodeId || null,
        modelName: whisperModel,
        modelVersion: whisperModelVersion,
        latencyMs: whisperLatencyMs,
        success: true,
        metadata: {
          surface: 'voice.quick-memo',
          clinicalNoteId: noteId,
          transcriptLength: transcript.length,
        },
      });

      res.status(201).json({
        noteId: note.id,
        transcript,
        transcriptLength: transcript.length,
        source: 'whisper',
        status: 'draft',
      });
    } catch (err) { next(err); }
  },
);


export default router;
