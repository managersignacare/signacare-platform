import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbRead } from '../../db/db';
import { CASE_MANAGER_ROLES, CLINICAL_ROLES } from '../../shared/roleGroups';
import { logger } from '../../utils/logger';
import {
  OPEN_CASELOAD_STATUS_SQL,
  caseloadAssignmentBindingsForBoundStaff,
  caseloadAssignmentPredicateForBoundStaff,
} from '../dashboard/caseloadAssignmentSql';
import { OPEN_TASK_STATUSES } from '../tasks/taskStatusCatalog';

// Local Zod schemas (Phase R3b / CLAUDE.md §12).
const TransitionChecklistSchema = z.object({
  checklist: z.array(z.record(z.string(), z.unknown())).optional(),
  transitionStatus: z.string().max(40).optional(),
  targetDate: z.string().optional(),
});

const RecoveryStarSchema = z.object({
  scores: z.record(z.string(), z.number().min(1).max(10)),
});

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
// All four tables are materialized in R2b baseline — pre-R2 they were
// ghost tables silently targeted by this router (R2 dropped + recreated
// the DB with these as first-class schemas). The Phase F markers
// these replace have been removed.
const CARE_PLAN_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'title', 'description',
  'status', 'transition_checklist', 'transition_status', 'transition_target_date',
  'recovery_star_scores', 'recovery_star_updated_at', 'recovery_star_updated_by',
  'created_by_id', 'created_at', 'updated_at', 'deleted_at',
] as const;

const CARE_PLAN_GOAL_COLUMNS = [
  'id', 'clinic_id', 'treatment_plan_id', 'goal_text', 'description',
  'goal_type', 'target_date', 'status', 'sort_order', 'measurable',
  'patient_self_rated', 'created_by_id', 'created_at', 'updated_at',
] as const;

const CARE_PLAN_INTERVENTION_COLUMNS = [
  'id', 'clinic_id', 'care_plan_goal_id', 'intervention_text', 'description',
  'frequency', 'responsible_staff_id', 'status', 'start_date', 'end_date',
  'sort_order', 'created_by_id', 'created_at', 'updated_at',
] as const;

const COMMUNITY_RESOURCE_COLUMNS = [
  'id', 'clinic_id', 'name', 'category', 'description', 'services',
  'phone', 'email', 'website', 'address', 'operating_hours',
  'referral_process', 'eligibility', 'contact_person', 'notes',
  'is_active', 'created_at', 'updated_at',
] as const;

const router = Router();

// Dashboard caseload endpoints are reused by multiple clinical views
// (including My Dashboard). Keep this broader than the case-manager-only
// CRUD routes below so psychiatrist/nurse/psychologist users see counts.
const DASHBOARD_CASELOAD_ROLES = Array.from(
  new Set([
    ...CASE_MANAGER_ROLES,
    ...CLINICAL_ROLES,
    'readonly',
    'referral_coordinator',
  ]),
);

const CASELOAD_ASSIGNMENT_PREDICATE_SQL = caseloadAssignmentPredicateForBoundStaff('e');
const OPEN_TASK_STATUS_SQL = `(${OPEN_TASK_STATUSES.map((status) => `'${status}'`).join(', ')})`;

const CASELOAD_DASHBOARD_SQL = [
  'SELECT',
  "  p.id AS patient_id,",
  "  p.given_name || ' ' || p.family_name AS patient_name,",
  '  p.emr_number,',
  '  e.id AS episode_id,',
  '  e.status AS episode_status,',
  '  e.created_at AS episode_start,',
  '  (SELECT MAX(cr.created_at) FROM contact_records cr',
  '    WHERE cr.patient_id = p.id AND cr.staff_id = ?) AS last_contact,',
  '  CASE',
  '    WHEN (SELECT MAX(cr.created_at) FROM contact_records cr',
  "      WHERE cr.patient_id = p.id AND cr.staff_id = ?) IS NULL THEN 'red'",
  '    WHEN (SELECT MAX(cr.created_at) FROM contact_records cr',
  "      WHERE cr.patient_id = p.id AND cr.staff_id = ?) < CURRENT_DATE - INTERVAL '14 days' THEN 'red'",
  '    WHEN (SELECT MAX(cr.created_at) FROM contact_records cr',
  "      WHERE cr.patient_id = p.id AND cr.staff_id = ?) < CURRENT_DATE - INTERVAL '7 days' THEN 'amber'",
  "    ELSE 'green'",
  '  END AS rag_status,',
  '  (SELECT COUNT(*)::int FROM tasks t',
  `    WHERE t.patient_id = p.id AND t.assigned_to_id = ? AND t.status IN ${OPEN_TASK_STATUS_SQL}) AS pending_tasks`,
  'FROM episodes e',
  'JOIN patients p ON p.id = e.patient_id',
  'WHERE e.clinic_id = ?',
  '  AND e.deleted_at IS NULL',
  `  AND e.status IN ${OPEN_CASELOAD_STATUS_SQL}`,
  `  AND ${CASELOAD_ASSIGNMENT_PREDICATE_SQL}`,
  'ORDER BY rag_status DESC, last_contact ASC NULLS FIRST',
].join('\n');

const CASELOAD_CONTACT_GAP_SQL = [
  'SELECT * FROM (',
  '  SELECT',
  '    p.id AS patient_id,',
  "    p.given_name || ' ' || p.family_name AS patient_name,",
  '    p.emr_number,',
  '    p.phone_mobile,',
  '    (SELECT MAX(cr.created_at) FROM contact_records cr',
  '      WHERE cr.patient_id = p.id AND cr.staff_id = ?) AS last_contact,',
  '    EXTRACT(DAY FROM NOW() - COALESCE(',
  '      (SELECT MAX(cr.created_at) FROM contact_records cr',
  '        WHERE cr.patient_id = p.id AND cr.staff_id = ?),',
  '      e.created_at',
  '    ))::int AS days_since_contact',
  '  FROM episodes e',
  '  JOIN patients p ON p.id = e.patient_id',
  '  WHERE e.clinic_id = ?',
  '    AND e.deleted_at IS NULL',
  `    AND e.status IN ${OPEN_CASELOAD_STATUS_SQL}`,
  `    AND ${CASELOAD_ASSIGNMENT_PREDICATE_SQL}`,
  ') sub',
  'WHERE days_since_contact >= ?',
  'ORDER BY days_since_contact DESC',
].join('\n');

//  CASE MANAGER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Caseload Dashboard ──────────────────────────────────────────────────────
// GET /dashboard/caseload
router.get(
  '/dashboard/caseload',
  requireRoles(DASHBOARD_CASELOAD_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const staffBindings = caseloadAssignmentBindingsForBoundStaff(req.user!.id);
      const rows = await dbRead.raw(CASELOAD_DASHBOARD_SQL, [
        ...staffBindings,
        req.clinicId,
        ...staffBindings,
      ]);

      res.json({ data: rows.rows });
    } catch (err) { next(err); }
  },
);

// ── Days Since Contact ──────────────────────────────────────────────────────
// GET /dashboard/days-since-contact
router.get(
  '/dashboard/days-since-contact',
  requireRoles(DASHBOARD_CASELOAD_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const threshold = parseInt((req.query.threshold as string) || '14', 10);
      const staffBindings = caseloadAssignmentBindingsForBoundStaff(req.user!.id);

      const rows = await dbRead.raw(CASELOAD_CONTACT_GAP_SQL, [
        req.user!.id,
        req.user!.id,
        req.clinicId,
        ...staffBindings,
        threshold,
      ]);

      res.json({ data: rows.rows, threshold });
    } catch (err) { next(err); }
  },
);

// ── Care Plan Goals CRUD ────────────────────────────────────────────────────
// GET /care-plans/:planId/goals
router.get(
  '/care-plans/:planId/goals',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await dbRead('care_plan_goals')
        .where({ treatment_plan_id: req.params.planId, clinic_id: req.clinicId })
        .orderBy('sort_order', 'asc')
        .orderBy('created_at', 'asc');
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /care-plans/:planId/goals
router.post(
  '/care-plans/:planId/goals',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        title, description, category, targetDate, status, sortOrder,
        measurable, patientSelfRated,
      } = req.body;

      const [row] = await db('care_plan_goals')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          treatment_plan_id: req.params.planId,
          goal_text: title,
          description: description || null,
          goal_type: category || 'general',
          target_date: targetDate || null,
          status: status || 'active',
          sort_order: sortOrder ?? 0,
          measurable: measurable || null,
          patient_self_rated: patientSelfRated || null,
          created_by_id: req.user!.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(CARE_PLAN_GOAL_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /care-plans/:planId/goals/:goalId
router.put(
  '/care-plans/:planId/goals/:goalId',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        title, description, category, targetDate, status,
        sortOrder, measurable, patientSelfRated,
      } = req.body;

      const updates = {
        updated_at: db.fn.now(),
        ...(title !== undefined ? { goal_text: title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { goal_type: category } : {}),
        ...(targetDate !== undefined ? { target_date: targetDate } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
        ...(measurable !== undefined ? { measurable } : {}),
        ...(patientSelfRated !== undefined ? { patient_self_rated: patientSelfRated } : {}),
      };

      const [row] = await db('care_plan_goals')
        .where({ id: req.params.goalId, treatment_plan_id: req.params.planId, clinic_id: req.clinicId })
        .update(updates)
        .returning(CARE_PLAN_GOAL_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /care-plans/:planId/goals/:goalId
router.delete(
  '/care-plans/:planId/goals/:goalId',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('care_plan_goals')
        .where({ id: req.params.goalId, treatment_plan_id: req.params.planId, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Care Plan Interventions CRUD ────────────────────────────────────────────
// GET /care-plans/:planId/goals/:goalId/interventions
router.get(
  '/care-plans/:planId/goals/:goalId/interventions',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await dbRead('care_plan_interventions')
        .where({ care_plan_goal_id: req.params.goalId, clinic_id: req.clinicId })
        .orderBy('sort_order', 'asc')
        .orderBy('created_at', 'asc');
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /care-plans/:planId/goals/:goalId/interventions
router.post(
  '/care-plans/:planId/goals/:goalId/interventions',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        title, description, frequency, responsibleId, status,
        startDate, endDate, sortOrder,
      } = req.body;

      const [row] = await db('care_plan_interventions')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          care_plan_goal_id: req.params.goalId,
          intervention_text: title,
          description: description || null,
          frequency: frequency || null,
          responsible_staff_id: responsibleId || req.user!.id,
          status: status || 'active',
          start_date: startDate || null,
          end_date: endDate || null,
          sort_order: sortOrder ?? 0,
          created_by_id: req.user!.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(CARE_PLAN_INTERVENTION_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /care-plans/:planId/goals/:goalId/interventions/:interventionId
router.put(
  '/care-plans/:planId/goals/:goalId/interventions/:interventionId',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        title, description, frequency, responsibleId,
        status, startDate, endDate, sortOrder,
      } = req.body;

      const updates = {
        updated_at: db.fn.now(),
        ...(title !== undefined ? { intervention_text: title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(responsibleId !== undefined ? { responsible_staff_id: responsibleId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(startDate !== undefined ? { start_date: startDate } : {}),
        ...(endDate !== undefined ? { end_date: endDate } : {}),
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      };

      const [row] = await db('care_plan_interventions')
        .where({ id: req.params.interventionId, care_plan_goal_id: req.params.goalId, clinic_id: req.clinicId })
        .update(updates)
        .returning(CARE_PLAN_INTERVENTION_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /care-plans/:planId/goals/:goalId/interventions/:interventionId
router.delete(
  '/care-plans/:planId/goals/:goalId/interventions/:interventionId',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('care_plan_interventions')
        .where({ id: req.params.interventionId, care_plan_goal_id: req.params.goalId, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Transition Checklist ────────────────────────────────────────────────────
// GET /care-plans/:planId/transition-checklist
router.get(
  '/care-plans/:planId/transition-checklist',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const plan = await dbRead('care_plans')
        .where({ id: req.params.planId, clinic_id: req.clinicId })
        .select('id', 'transition_checklist', 'transition_status', 'transition_target_date')
        .first()
        .catch((err) => { logger.warn({ err }, 'caseManagerFeatureRoutes: op failed — returning null'); return null; });

      if (!plan) { res.status(404).json({ error: 'Care plan not found' }); return; }

      const checklist = typeof plan.transition_checklist === 'string'
        ? JSON.parse(plan.transition_checklist)
        : plan.transition_checklist || [];

      res.json({
        planId: plan.id,
        transitionStatus: plan.transition_status,
        targetDate: plan.transition_target_date,
        checklist,
      });
    } catch (err) { next(err); }
  },
);

// PUT /care-plans/:planId/transition-checklist
router.put(
  '/care-plans/:planId/transition-checklist',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { checklist, transitionStatus, targetDate } = TransitionChecklistSchema.parse(req.body);
      const updates = {
        updated_at: db.fn.now(),
        ...(checklist !== undefined ? { transition_checklist: JSON.stringify(checklist) } : {}),
        ...(transitionStatus !== undefined ? { transition_status: transitionStatus } : {}),
        ...(targetDate !== undefined ? { transition_target_date: targetDate } : {}),
      };

      // Let the UPDATE error propagate to the error middleware — silently
      // swallowing with `.catch(() => [])` hid real DB errors as spurious
      // "Care plan not found" 404s.
      const rows = await db('care_plans')
        .where({ id: req.params.planId, clinic_id: req.clinicId })
        .update(updates)
        .returning(CARE_PLAN_COLUMNS);
      const row = rows[0];

      if (!row) { res.status(404).json({ error: 'Care plan not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── Recovery Star ───────────────────────────────────────────────────────────
// GET /care-plans/:planId/recovery-star
router.get(
  '/care-plans/:planId/recovery-star',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const plan = await dbRead('care_plans')
        .where({ id: req.params.planId, clinic_id: req.clinicId })
        .select('id', 'recovery_star_scores', 'recovery_star_updated_at')
        .first()
        .catch((err) => { logger.warn({ err }, 'caseManagerFeatureRoutes: op failed — returning null'); return null; });

      if (!plan) { res.status(404).json({ error: 'Care plan not found' }); return; }

      const scores = typeof plan.recovery_star_scores === 'string'
        ? JSON.parse(plan.recovery_star_scores)
        : plan.recovery_star_scores || {};

      res.json({
        planId: plan.id,
        scores,
        updatedAt: plan.recovery_star_updated_at,
      });
    } catch (err) { next(err); }
  },
);

// PUT /care-plans/:planId/recovery-star
router.put(
  '/care-plans/:planId/recovery-star',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { scores } = RecoveryStarSchema.parse(req.body);
      // scores should be { managingMentalHealth: 1-10, physicalHealth: 1-10, ... }

      const rows = await db('care_plans')
        .where({ id: req.params.planId, clinic_id: req.clinicId })
        .update({
          recovery_star_scores: JSON.stringify(scores),
          recovery_star_updated_at: db.fn.now(),
          recovery_star_updated_by: req.user!.id,
          updated_at: db.fn.now(),
        })
        .returning(CARE_PLAN_COLUMNS);
      const row = rows[0];

      if (!row) { res.status(404).json({ error: 'Care plan not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── Community Resources CRUD ────────────────────────────────────────────────
// GET /community-resources
router.get(
  '/community-resources',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { category, search, active } = req.query;
      let query = dbRead('community_resources')
        .where({ clinic_id: req.clinicId })
        .orderBy('name', 'asc');

      if (category) query = query.where({ category });
      if (active !== undefined) query = query.where({ is_active: active === 'true' });
      if (search) {
        query = query.where(function () {
          this.whereILike('name', `%${search}%`)
            .orWhereILike('description', `%${search}%`);
        });
      }

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /community-resources
router.post(
  '/community-resources',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        name, category, description, services, phone, email,
        website, address, operatingHours, referralProcess,
        eligibilityCriteria, contactPerson, notes,
      } = req.body;

      const [row] = await db('community_resources')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          name,
          category: category || 'general',
          description: description || null,
          services: services || null,
          phone: phone || null,
          email: email || null,
          website: website || null,
          address: address || null,
          operating_hours: operatingHours || null,
          referral_process: referralProcess || null,
          eligibility: eligibilityCriteria || null,
          contact_person: contactPerson || null,
          notes: notes || null,
          is_active: true,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(COMMUNITY_RESOURCE_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /community-resources/:id
router.put(
  '/community-resources/:id',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        name, category, description, services, phone, email,
        website, address, operatingHours, referralProcess,
        eligibilityCriteria, contactPerson, notes, active,
      } = req.body;

      const updates = {
        updated_at: db.fn.now(),
        ...(name !== undefined ? { name } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(services !== undefined ? { services } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(website !== undefined ? { website } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(operatingHours !== undefined ? { operating_hours: operatingHours } : {}),
        ...(referralProcess !== undefined ? { referral_process: referralProcess } : {}),
        ...(eligibilityCriteria !== undefined ? { eligibility: eligibilityCriteria } : {}),
        ...(contactPerson !== undefined ? { contact_person: contactPerson } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(active !== undefined ? { is_active: active } : {}),
      };

      const [row] = await db('community_resources')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(updates)
        .returning(COMMUNITY_RESOURCE_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /community-resources/:id
router.delete(
  '/community-resources/:id',
  requireRoles([...CASE_MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('community_resources')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);


export default router;
