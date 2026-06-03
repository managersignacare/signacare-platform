import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import { escapeLike } from '../../shared/escapeLike';
import { escalationController as ctrl } from './escalation.controller';
import { nestIsbar } from './escalation.repository';
import { todayLocal } from '../../utils/dateUtils';
import logger from '../../utils/logger';
import { AppError } from '../../shared/errors';

const router = Router();

interface EscalationListRow {
  id?: string;
  description: unknown;
  [key: string]: unknown;
}

interface TeamSummaryRow {
  referral_status: string;
  count: number | string | bigint | null;
}

interface EscalationDescription {
  assignedTeam?: string;
  [key: string]: unknown;
}

function parseEscalationDescription(raw: unknown, escalationId?: string): EscalationDescription {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as EscalationDescription;
    }
    return {};
  } catch (err) {
    logger.warn({ err, escalationId }, 'Failed to parse escalation description JSON');
    return {};
  }
}

router.use(requireAuth);
router.use(requireModuleRead(MODULE_KEYS.ESCALATIONS));

// List all escalations for the clinic
router.get('/', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const q = db('escalations').where({ clinic_id: req.clinicId }).whereNull('deleted_at').orderBy('created_at', 'desc').limit(100);
    // assignedTeam is stored in description JSONB — filter after fetch
    let rows: EscalationListRow[] = await q;
    if (req.query.assignedTeam) {
      const team = req.query.assignedTeam as string;
      rows = rows.filter((r) => parseEscalationDescription(r.description, r.id).assignedTeam === team);
    }
    res.json({ data: rows.map((r: Record<string, unknown>) => nestIsbar(r)) });
  } catch (err) { next(err); }
});

router.get('/patient/:patientId',    ctrl.listByPatient);

// Team summary — MUST be before /:id to avoid "team-summary" being parsed as UUID
router.get('/team-summary', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const orgUnitId = req.query.orgUnitId as string;
    if (!orgUnitId) { res.json({ new: 0, in_review: 0, accepted: 0, rejected: 0 }); return; }
    // ARCH-S0-1 hardening: ensure the requested org unit is bound to the
    // caller's clinic before reading assignment aggregates. This prevents
    // cross-clinic UUID probing from exposing referral-state counts.
    const orgUnit = await db('org_units')
      .where({ id: orgUnitId, clinic_id: req.clinicId, is_active: true })
      .first();
    if (!orgUnit) {
      return next(new AppError('Team not found', 404, 'TEAM_NOT_FOUND'));
    }
    const rows: TeamSummaryRow[] = await db('patient_team_assignments')
      .where({ org_unit_id: orgUnit.id })
      .whereIn('referral_status', ['new', 'in_review', 'accepted', 'rejected'])
      .groupBy('referral_status')
      .select('referral_status')
      .count('* as count');
    const counts: Record<string, number> = { new: 0, in_review: 0, accepted: 0, rejected: 0 };
    rows.forEach((r) => { counts[r.referral_status] = Number(r.count); });
    res.json(counts);
  } catch (err) { next(err); }
});

router.get('/:id',                   ctrl.getById);
// S1.2: Idempotency-Key on escalation create — escalations trigger
// notifications and team transfers; double-creation is highly disruptive.
router.post('/',                     idempotencyMiddleware(), ctrl.create);
router.patch('/:id',                 ctrl.update);
router.post('/:id/acknowledge',      ctrl.acknowledge);
router.post('/:id/resolve',          ctrl.resolve);
router.post('/:id/notes',            ctrl.addNote);
router.delete('/:id',                ctrl.softDelete);

// Accept escalation — creates care episode "TeamName — Date", closes intake episode
router.post('/:id/accept-transfer', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { buildAuthContext } = await import('../../shared/buildAuthContext');
    const { requirePatientRelationship } = await import('../../shared/authGuards');
    const escalation = await db('escalations').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!escalation) { res.status(404).json({ error: 'Not found' }); return; }
    // Tier 3.2 — accept-transfer mutates the patient's team assignment
    // and creates a care episode on them. Require the accepting
    // clinician has an active relationship with the patient (open
    // episode / team assignment / appointment). Break-glass bypasses.
    const auth = buildAuthContext(req, escalation.patient_id);
    await requirePatientRelationship(auth, escalation.patient_id);

    const desc = parseEscalationDescription(escalation.description, escalation.id);
    const team = desc.assignedTeam ?? '';
    const orgUnit = team ? await db('org_units').where({ clinic_id: req.clinicId }).whereRaw('name ILIKE ?', [`%${escapeLike(team)}%`]).first() : null;
    const today = todayLocal();

    if (orgUnit) {
      // 1. Mark team assignment as accepted + active
      await db('patient_team_assignments')
        .where({ patient_id: escalation.patient_id, org_unit_id: orgUnit.id })
        .update({ referral_status: 'accepted', is_active: true, reviewed_by_id: req.user!.id, reviewed_at: new Date(), updated_at: new Date() });

      // 2. Close the intake episode (created on escalation)
      const intakeEp = await db('episodes')
        .where({ patient_id: escalation.patient_id, team_id: orgUnit.id, episode_type: 'intake', status: 'open', clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .first();
      if (intakeEp) {
        await db('episodes').where({ id: intakeEp.id }).update({ status: 'closed', end_date: today, updated_at: new Date() });
      }

      // 3. Create care episode: "TeamName — Date"
      const careTitle = `${orgUnit.name} — ${today}`;
      await db('episodes').insert({
        clinic_id: req.clinicId, patient_id: escalation.patient_id,
        episode_type: 'community', team_id: orgUnit.id,
        primary_clinician_id: req.user!.id,
        status: 'open', start_date: today, title: careTitle,
        presenting_problem: `Accepted transfer of care to ${orgUnit.name}`,
        created_at: new Date(), updated_at: new Date(),
      });
    }

    // Update escalation status
    await db('escalations')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update({ status: 'in_progress', updated_at: new Date() });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/reject-transfer', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const { RejectTransferSchema } = await import('@signacare/shared');
    const { buildAuthContext } = await import('../../shared/buildAuthContext');
    const { requirePatientRelationship } = await import('../../shared/authGuards');
    const { rejectionReason } = RejectTransferSchema.parse(req.body);
    const escalation = await db('escalations').where({ id: req.params.id, clinic_id: req.clinicId }).first();
    if (!escalation) { res.status(404).json({ error: 'Not found' }); return; }
    // Tier 3.2 — reject-transfer mutates PTA state. Require relationship.
    const auth = buildAuthContext(req, escalation.patient_id);
    await requirePatientRelationship(auth, escalation.patient_id);

    const desc = parseEscalationDescription(escalation.description, escalation.id);
    const team = desc.assignedTeam ?? '';
    const orgUnit = team ? await db('org_units').where({ clinic_id: req.clinicId }).whereRaw('name ILIKE ?', [`%${escapeLike(team)}%`]).first() : null;

    if (orgUnit) {
      await db('patient_team_assignments')
        .where({ patient_id: escalation.patient_id, org_unit_id: orgUnit.id })
        .update({ referral_status: 'rejected', reviewed_by_id: req.user!.id, reviewed_at: new Date(), rejection_reason: rejectionReason ?? null, updated_at: new Date() });
    }

    await db('escalations')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update({
        status: 'resolved',
        resolution: rejectionReason ?? 'Rejected',
        resolved_at: new Date(),
        resolved_by_id: req.user!.id,
        updated_at: new Date(),
      });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
