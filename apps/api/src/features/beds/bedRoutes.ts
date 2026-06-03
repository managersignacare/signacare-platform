/**
 * Bed Management Routes
 * Ward management, bed allocation, leave tracking, restrictive interventions
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { CreateBedSchema, BulkCreateBedsSchema, UpdateBedSchema, AdmitPatientSchema, DischargeFromBedSchema, BedLeaveSchema, CreateRestrictiveInterventionSchema, EndRestrictiveInterventionSchema } from '@signacare/shared';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.BEDS));
const ROLES = ['clinician', 'admin', 'manager', 'superadmin'];

// Phase 0.7.5 c24 D12 — explicit .returning() column lists. beds (11
// cols) verified via schema-snapshot.json; restrictive_interventions
// now has 18 cols after 20260603000003_restrictive_interventions_columns
// added alternatives_tried, debrief_completed, debrief_notes,
// notified_persons (SD59-62 fix).
const BED_COLUMNS = [
  'id', 'clinic_id', 'org_unit_id', 'ward', 'room', 'bed_label',
  'bed_type', 'status', 'is_active', 'created_at', 'updated_at',
] as const;

const RESTRICTIVE_INTERVENTION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'intervention_type',
  'start_time', 'end_time', 'duration_minutes', 'reason',
  'authorised_by_id', 'recorded_by_id', 'outcome',
  'alternatives_tried', 'debrief_completed', 'debrief_notes',
  'notified_persons', 'created_at', 'updated_at',
  'lock_version', // BUG-PR-R1-12-FIX-S0-restrictive_interventions
] as const;

type BedBoardBaseRow = Record<string, unknown> & {
  id: string;
  ward: string | null;
};

interface BedBoardOccupantRow {
  bed_id: string;
  patient_id: string | null;
  patient_given_name: string | null;
  patient_family_name: string | null;
  emr_number: string | null;
  admitted_at: string | Date | null;
}

type EnrichedBedBoardRow = BedBoardBaseRow & {
  patient_given_name: string | null;
  patient_family_name: string | null;
  emr_number: string | null;
  patient_id: string | null;
  admitted_at: string | Date | null;
};

const BedBoardRowSchema = z.object({
  id: z.string(),
  ward: z.string().nullable().optional(),
  patient_given_name: z.string().nullable(),
  patient_family_name: z.string().nullable(),
  emr_number: z.string().nullable(),
  patient_id: z.string().nullable(),
  admitted_at: z.union([z.string(), z.date()]).nullable(),
}).passthrough();

const BedBoardResponseSchema = z.object({
  wards: z.record(z.string(), z.array(BedBoardRowSchema)),
  totalBeds: z.number().int().nonnegative(),
  occupied: z.number().int().nonnegative(),
});

// Root list — all beds
router.get('/', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const beds = await db('beds').where({ clinic_id: clinicId }).orderBy('ward', 'asc').orderBy('bed_label', 'asc');
    res.json({ data: beds });
  } catch (err) { next(err); }
});

// ── Bed Board ──
router.get('/board', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get all beds, then join latest admission movement to find current occupant
    const beds = await db('beds')
      .where({ 'beds.clinic_id': req.clinicId })
      .select('beds.*')
      .orderBy(['beds.ward', 'beds.bed_label']);

    // Find current occupants — use latest admission per bed (no subsequent discharge)
    const occupants = await db.raw(`
      SELECT DISTINCT ON (bm.bed_id)
        bm.bed_id,
        bm.patient_id,
        p.given_name AS patient_given_name,
        p.family_name AS patient_family_name,
        p.emr_number,
        bm.created_at AS admitted_at
      FROM bed_movements bm
      JOIN patients p ON p.id = bm.patient_id
      WHERE bm.clinic_id = ?
        AND bm.movement_type = 'admission'
        AND NOT EXISTS (
          SELECT 1 FROM bed_movements d
          WHERE d.bed_id = bm.bed_id
            AND d.patient_id = bm.patient_id
            AND d.movement_type = 'discharge'
            AND d.created_at > bm.created_at
        )
      ORDER BY bm.bed_id, bm.created_at DESC
    `, [req.clinicId]);

    const occupantRows = (occupants.rows ?? []) as BedBoardOccupantRow[];
    const occupantMap = new Map<string, BedBoardOccupantRow>(occupantRows.map((o) => [o.bed_id, o]));

    const enriched = (beds as BedBoardBaseRow[]).map((bed): EnrichedBedBoardRow => {
      const occ = occupantMap.get(bed.id);
      return {
        ...bed,
        patient_given_name: occ?.patient_given_name ?? null,
        patient_family_name: occ?.patient_family_name ?? null,
        emr_number: occ?.emr_number ?? null,
        patient_id: occ?.patient_id ?? null,
        admitted_at: occ?.admitted_at ?? null,
      };
    });

    // Group by ward
    const wards: Record<string, EnrichedBedBoardRow[]> = {};
    for (const bed of enriched) {
      const w = bed.ward || 'Unassigned';
      if (!wards[w]) wards[w] = [];
      wards[w].push(bed);
    }
    const totalBeds = beds.length;
    const occupied = enriched.filter((b) => b.patient_id != null).length;
    res.json(BedBoardResponseSchema.parse({ wards, totalBeds, occupied }));
  } catch (err) { next(err); }
});

// Create bed
router.post('/', requireRoles(['admin', 'superadmin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateBedSchema.parse(req.body);
    // Schema accepts both bed_number (snake) and bedNumber (camel) for
    // compatibility with historical frontend payloads. Same for bed_type.
    const bedLabel = dto.bed_number ?? dto.bedNumber;
    const bedType = dto.bed_type ?? dto.bedType ?? 'standard';
    const [row] = await db('beds').insert({
      clinic_id: req.clinicId,
      ward: dto.ward,
      bed_label: bedLabel,
      bed_type: bedType,
      status: 'available',
    }).returning(BED_COLUMNS);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// Bulk create beds
router.post('/bulk', requireRoles(['admin', 'superadmin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = BulkCreateBedsSchema.parse(req.body);
    const rows = [];
    for (const b of dto.beds) {
      const [row] = await db('beds').insert({
        clinic_id: req.clinicId,
        ward: b.ward,
        bed_label: b.bed_number,
        bed_type: b.bed_type ?? 'standard',
        status: 'available',
      }).returning(BED_COLUMNS);
      rows.push(row);
    }
    res.status(201).json({ beds: rows, count: rows.length });
  } catch (err) { next(err); }
});

// Update bed (status toggle, etc.)
router.patch('/:bedId', requireRoles(['admin', 'superadmin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = UpdateBedSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (dto.status) patch.status = dto.status;
    if (dto.ward) patch.ward = dto.ward;
    if (dto.bed_type || dto.bedType) patch.bed_type = dto.bed_type || dto.bedType;
    const [row] = await db('beds').where({ id: req.params.bedId, clinic_id: req.clinicId })
      .update(patch).returning(BED_COLUMNS);
    if (!row) { res.status(404).json({ error: 'Bed not found' }); return; }
    res.json(row);
  } catch (err) { next(err); }
});

// Delete bed (only available/maintenance)
router.delete('/:bedId', requireRoles(['admin', 'superadmin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bed = await db('beds').where({ id: req.params.bedId, clinic_id: req.clinicId }).first();
    if (!bed) { res.status(404).json({ error: 'Bed not found' }); return; }
    if (bed.status === 'occupied') { res.status(400).json({ error: 'Cannot delete occupied bed' }); return; }
    await db('beds').where({ id: req.params.bedId, clinic_id: req.clinicId }).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admit patient to bed
router.post('/:bedId/admit', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = AdmitPatientSchema.parse(req.body);
    const { patientId, episodeId, notes } = dto;
    await db('beds').where({ id: req.params.bedId, clinic_id: req.clinicId })
      .update({ status: 'occupied', updated_at: new Date() });
    await db('bed_movements').insert({
      id: db.raw('gen_random_uuid()'),
      clinic_id: req.clinicId, bed_id: req.params.bedId, patient_id: patientId, episode_id: episodeId ?? null,
      movement_type: 'admission', notes: notes ?? null, authorised_by_id: req.user!.id,
      created_at: new Date(), updated_at: new Date(),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Discharge from bed
router.post('/:bedId/discharge', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Find current occupant from latest admission movement
    const admission = await db('bed_movements')
      .where({ bed_id: req.params.bedId, clinic_id: req.clinicId, movement_type: 'admission' })
      .whereNotExists(
        db('bed_movements as d')
          .whereRaw('d.bed_id = bed_movements.bed_id AND d.patient_id = bed_movements.patient_id')
          .where('d.movement_type', 'discharge')
          .whereRaw('d.created_at > bed_movements.created_at')
      )
      .orderBy('created_at', 'desc').first();
    if (!admission) { res.status(400).json({ error: 'Bed is not occupied' }); return; }
    const dischargeBody = DischargeFromBedSchema.parse(req.body);
    await db('bed_movements').insert({
      clinic_id: req.clinicId, bed_id: req.params.bedId, patient_id: admission.patient_id,
      episode_id: admission.episode_id, movement_type: 'discharge', notes: dischargeBody.notes,
      authorised_by_id: req.user!.id,
    });
    await db('beds').where({ id: req.params.bedId, clinic_id: req.clinicId })
      .update({ status: 'available', updated_at: new Date() });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Record leave
router.post('/:bedId/leave', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admission = await db('bed_movements')
      .where({ bed_id: req.params.bedId, clinic_id: req.clinicId, movement_type: 'admission' })
      .whereNotExists(
        db('bed_movements as d')
          .whereRaw('d.bed_id = bed_movements.bed_id AND d.patient_id = bed_movements.patient_id')
          .where('d.movement_type', 'discharge')
          .whereRaw('d.created_at > bed_movements.created_at')
      )
      .orderBy('created_at', 'desc').first();
    if (!admission) { res.status(400).json({ error: 'Bed is not occupied' }); return; }
    const leaveBody = BedLeaveSchema.parse(req.body);
    await db('bed_movements').insert({
      clinic_id: req.clinicId, bed_id: req.params.bedId, patient_id: admission.patient_id,
      episode_id: admission.episode_id, movement_type: 'leave', notes: leaveBody.notes, authorised_by_id: req.user!.id,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Restrictive Interventions ──
router.get('/restrictive-interventions/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('restrictive_interventions')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .orderBy('start_time', 'desc');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/restrictive-interventions', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { patientId, episodeId, interventionType, reason, alternativesTried } = CreateRestrictiveInterventionSchema.parse(req.body);
    const [row] = await db('restrictive_interventions').insert({
      clinic_id: req.clinicId, patient_id: patientId, episode_id: episodeId,
      intervention_type: interventionType, authorised_by_id: req.user!.id,
      start_time: new Date(), reason, alternatives_tried: alternativesTried,
    }).returning(RESTRICTIVE_INTERVENTION_COLUMNS);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// End restrictive intervention
// BUG-PR-R1-12-FIX-S0-restrictive_interventions — opt-locked UPDATE.
// MHA evidentiary integrity: concurrent end-of-intervention writes from
// multiple clinicians during high-acuity episodes would silently overwrite
// duration_minutes / debrief_notes / notified_persons. expectedLockVersion
// (REQUIRED at Zod boundary) protects via updateWithOptimisticLock.
router.post('/restrictive-interventions/:id/end', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ri = await db('restrictive_interventions').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!ri) { res.status(404).json({ error: 'Not found' }); return; }
    const endTime = new Date();
    const durationMinutes = Math.round((endTime.getTime() - new Date(ri.start_time).getTime()) / 60000);
    const endBody = EndRestrictiveInterventionSchema.parse(req.body);
    const { updateWithOptimisticLock } = await import('../../shared/db/optimisticLock');
    const row = await updateWithOptimisticLock<Record<string, unknown>>({
      table: 'restrictive_interventions',
      where: { id: req.params.id, clinic_id: req.clinicId },
      expectedLockVersion: endBody.expectedLockVersion,
      patch: {
        end_time: endTime,
        duration_minutes: durationMinutes,
        outcome: endBody.outcome,
        debrief_completed: endBody.debriefCompleted ?? false,
        debrief_notes: endBody.debriefNotes,
        notified_persons: endBody.notifiedPersons,
      },
      returning: RESTRICTIVE_INTERVENTION_COLUMNS,
    });
    res.json(row);
  } catch (err) { next(err); }
});

export default router;
