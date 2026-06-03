import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbRead } from '../../db/db';
import { MANAGER_ROLES } from '../../shared/roleGroups';
import { settingsService } from '../settings/settingsService';
import {
  OPEN_CASELOAD_STATUS_SQL,
  caseloadAssignmentPredicateForStaffAlias,
} from '../dashboard/caseloadAssignmentSql';

// Local Zod schemas (Phase R3b / CLAUDE.md §12).
const StaffLeaveCreateSchema = z.object({
  staffId: z.string().uuid(),
  leaveType: z.string().min(1).max(40),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(2000).optional(),
  coverStaffId: z.string().uuid().optional(),
});

const StaffLeaveUpdateSchema = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'cancelled']).optional(),
  leaveType: z.string().min(1).max(40).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().max(2000).optional(),
  coverStaffId: z.string().uuid().nullable().optional(),
});

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
// staff_leave + report_schedules are materialized in R2b baseline — pre-R2
// they were ghost tables silently targeted by this router. The Phase F
// markers these replace have been removed.
const STAFF_LEAVE_COLUMNS = [
  'id', 'clinic_id', 'staff_id', 'leave_type', 'start_date', 'end_date',
  'reason', 'cover_staff_id', 'status', 'requested_by',
  'approved_by_staff_id', 'approved_at', 'created_at', 'updated_at',
] as const;

const REPORT_SCHEDULE_COLUMNS = [
  'id', 'clinic_id', 'report_type', 'name', 'frequency', 'schedule_cron',
  'recipients', 'filters', 'format', 'is_active',
  'created_by_staff_id', 'last_run_at', 'next_run_at',
  'created_at', 'updated_at',
] as const;

const router = Router();

async function getManagerTargets(clinicId: string): Promise<{
  contactTarget: number;
  caseloadTarget: number;
}> {
  const thresholds = await settingsService.getThresholds(clinicId, dbRead);
  const contactTarget = Math.max(
    1,
    Math.round(thresholds['manager_contacts_target'] ?? 80),
  );
  const caseloadTarget = Math.max(
    1,
    Math.round(thresholds['manager_caseload_target'] ?? 35),
  );
  return { contactTarget, caseloadTarget };
}

//  MANAGER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Contacts KPI ────────────────────────────────────────────────────────────
// GET /reports/contacts-kpi
router.get(
  '/reports/contacts-kpi',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const period = (req.query.period as string) || 'month';
      const now = new Date();
      let from: Date;
      switch (period) {
        case 'week': { const d = now.getDay(); from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1)); break; }
        case 'quarter': from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
        case 'year': from = new Date(now.getFullYear(), 0, 1); break;
        default: from = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      const { contactTarget } = await getManagerTargets(req.clinicId!);

      const rows = await dbRead.raw(`
        SELECT
          s.id AS clinician_id,
          s.given_name || ' ' || s.family_name AS clinician_name,
          COUNT(cr.id)::int AS contacts_this_period,
          ?::int AS target,
          CASE
            WHEN COUNT(cr.id) >= ?::int THEN 'green'
            WHEN COUNT(cr.id) >= (?::int * 0.8) THEN 'amber'
            ELSE 'red'
          END AS rag_status
        FROM staff s
        LEFT JOIN contact_records cr
          ON cr.staff_id = s.id
          AND cr.clinic_id = ?
          AND cr.created_at >= ?
        WHERE s.clinic_id = ? AND s.role IN ('clinician','psychiatrist','nurse','case_manager')
          AND s.is_active = true
        GROUP BY s.id, s.given_name, s.family_name
        ORDER BY rag_status DESC, contacts_this_period ASC
      `, [contactTarget, contactTarget, contactTarget, req.clinicId, from, req.clinicId]);

      res.json({ data: rows.rows, period, from: from.toISOString() });
    } catch (err) { next(err); }
  },
);

// ── Staff Caseload ──────────────────────────────────────────────────────────
// GET /reports/staff-caseload
router.get(
  '/reports/staff-caseload',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { caseloadTarget } = await getManagerTargets(req.clinicId!);
      const caseloadPredicate = caseloadAssignmentPredicateForStaffAlias('e', 's');
      const sql = `
        SELECT
          s.id AS clinician_id,
          s.given_name || ' ' || s.family_name AS clinician_name,
          s.role,
          COUNT(DISTINCT e.patient_id)::int AS patient_count,
          ?::int AS max_caseload,
          CASE
            WHEN COUNT(DISTINCT e.patient_id) > ?::int THEN 'over'
            WHEN COUNT(DISTINCT e.patient_id) >= (?::int * 0.9) THEN 'near'
            ELSE 'ok'
          END AS caseload_status
        FROM staff s
        LEFT JOIN episodes e
          ON e.clinic_id = ?
          AND e.deleted_at IS NULL
          AND e.status IN ${OPEN_CASELOAD_STATUS_SQL}
          AND ` + caseloadPredicate + `
        WHERE s.clinic_id = ? AND s.is_active = true
          AND s.role IN ('clinician','psychiatrist','nurse','case_manager')
        GROUP BY s.id, s.given_name, s.family_name, s.role
        ORDER BY patient_count DESC
      `;
      const rows = await dbRead.raw(sql, [
        caseloadTarget,
        caseloadTarget,
        caseloadTarget,
        req.clinicId,
        req.clinicId,
      ]);

      res.json({ data: rows.rows });
    } catch (err) { next(err); }
  },
);

// ── DNA/No-Show Rates ───────────────────────────────────────────────────────
// GET /reports/dna-rates
router.get(
  '/reports/dna-rates',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt((req.query.days as string) || '90', 10);
      const since = new Date(Date.now() - days * 86400000);

      const rows = await dbRead.raw(`
        SELECT
          s.id AS clinician_id,
          s.given_name || ' ' || s.family_name AS clinician_name,
          COUNT(a.id)::int AS total_appointments,
          COUNT(a.id) FILTER (WHERE a.status IN ('dna','no_show'))::int AS dna_count,
          CASE WHEN COUNT(a.id) > 0
            THEN ROUND(100.0 * COUNT(a.id) FILTER (WHERE a.status IN ('dna','no_show')) / COUNT(a.id), 1)
            ELSE 0
          END AS dna_rate_pct
        FROM staff s
        LEFT JOIN appointments a
          ON a.clinician_id = s.id
          AND a.clinic_id = ?
          AND a.start_time >= ?
        WHERE s.clinic_id = ? AND s.is_active = true
          AND s.role IN ('clinician','psychiatrist','nurse','case_manager')
        GROUP BY s.id, s.given_name, s.family_name
        ORDER BY dna_rate_pct DESC
      `, [req.clinicId, since, req.clinicId]);

      res.json({ data: rows.rows, period: { days, since: since.toISOString() } });
    } catch (err) { next(err); }
  },
);

// ── Contacts vs Booked ──────────────────────────────────────────────────────
// GET /reports/contacts-vs-booked
router.get(
  '/reports/contacts-vs-booked',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt((req.query.days as string) || '30', 10);
      const since = new Date(Date.now() - days * 86400000);

      const rows = await dbRead.raw(`
        SELECT
          s.id AS clinician_id,
          s.given_name || ' ' || s.family_name AS clinician_name,
          (SELECT COUNT(*)::int FROM contact_records cr
            WHERE cr.staff_id = s.id AND cr.clinic_id = ? AND cr.created_at >= ?) AS contacts_made,
          (SELECT COUNT(*)::int FROM appointments a
            WHERE a.clinician_id = s.id AND a.clinic_id = ? AND a.start_time >= ?) AS appointments_booked
        FROM staff s
        WHERE s.clinic_id = ? AND s.is_active = true
          AND s.role IN ('clinician','psychiatrist','nurse','case_manager')
        ORDER BY clinician_name
      `, [req.clinicId, since, req.clinicId, since, req.clinicId]);

      res.json({ data: rows.rows, period: { days } });
    } catch (err) { next(err); }
  },
);

// ── Bed Occupancy Trend ─────────────────────────────────────────────────────
// GET /reports/bed-occupancy-trend
router.get(
  '/reports/bed-occupancy-trend',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt((req.query.days as string) || '30', 10);

      const rows = await dbRead.raw(`
        WITH date_series AS (
          SELECT generate_series(
            CURRENT_DATE - ?::int,
            CURRENT_DATE,
            '1 day'::interval
          )::date AS day
        ),
        total AS (
          SELECT COUNT(*)::int AS total_beds
          FROM beds WHERE clinic_id = ?
        )
        SELECT
          ds.day,
          total.total_beds,
          COALESCE(
            (SELECT COUNT(*)::int FROM bed_movements bm
             WHERE bm.clinic_id = ?
               AND bm.movement_type = 'admission'
               AND bm.created_at::date <= ds.day
               AND (bm.id NOT IN (
                 SELECT bm2.id FROM bed_movements bm2
                 WHERE bm2.clinic_id = ?
                   AND bm2.movement_type = 'discharge'
                   AND bm2.created_at::date <= ds.day
               ))
            ), 0
          ) AS occupied,
          CASE WHEN total.total_beds > 0
            THEN ROUND(100.0 * COALESCE(
              (SELECT COUNT(*)::int FROM beds b
               WHERE b.clinic_id = ? AND b.status = 'occupied'), 0
            ) / total.total_beds, 1)
            ELSE 0
          END AS occupancy_pct
        FROM date_series ds, total
        ORDER BY ds.day
      `, [days, req.clinicId, req.clinicId, req.clinicId, req.clinicId]);

      res.json({ data: rows.rows });
    } catch (err) { next(err); }
  },
);

// ── Workload Alerts ─────────────────────────────────────────────────────────
// GET /reports/workload-alerts
router.get(
  '/reports/workload-alerts',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { caseloadTarget } = await getManagerTargets(req.clinicId!);
      const caseloadPredicate = caseloadAssignmentPredicateForStaffAlias('e', 's');
      // Staff exceeding caseload
      const overloaded = await dbRead.raw(`
        SELECT
          s.id, s.given_name || ' ' || s.family_name AS name, s.role,
          COUNT(DISTINCT e.patient_id)::int AS patient_count,
          ?::int AS max_caseload,
          'caseload_exceeded' AS alert_type
        FROM staff s
        JOIN episodes e
          ON e.clinic_id = ?
          AND e.deleted_at IS NULL
          AND e.status IN ${OPEN_CASELOAD_STATUS_SQL}
          AND ` + caseloadPredicate + `
        WHERE s.clinic_id = ? AND s.is_active = true
        GROUP BY s.id, s.given_name, s.family_name, s.role
        HAVING COUNT(DISTINCT e.patient_id) > ?::int
      `, [caseloadTarget, req.clinicId, req.clinicId, caseloadTarget]);

      // Staff with overdue contacts (no contact in 14+ days for active patients)
      const overdueContacts = await dbRead.raw(`
        SELECT
          s.id, s.given_name || ' ' || s.family_name AS name, s.role,
          COUNT(DISTINCT e.patient_id)::int AS overdue_patients,
          'overdue_contacts' AS alert_type
        FROM staff s
        JOIN episodes e
          ON e.clinic_id = ?
          AND e.deleted_at IS NULL
          AND e.status IN ${OPEN_CASELOAD_STATUS_SQL}
          AND ` + caseloadPredicate + `
        WHERE s.clinic_id = ? AND s.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM contact_records cr
            WHERE cr.staff_id = s.id
              AND cr.patient_id = e.patient_id
              AND cr.clinic_id = ?
              AND cr.created_at >= CURRENT_DATE - INTERVAL '14 days'
          )
        GROUP BY s.id, s.given_name, s.family_name, s.role
      `, [req.clinicId, req.clinicId, req.clinicId]);

      res.json({
        data: {
          caseloadExceeded: overloaded.rows,
          overdueContacts: overdueContacts.rows,
        },
      });
    } catch (err) { next(err); }
  },
);

// ── Staff Leave CRUD ────────────────────────────────────────────────────────
// GET /staff-leave
router.get(
  '/staff-leave',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { staffId, status, from, to } = req.query;
      let query = dbRead('staff_leave')
        .where({ clinic_id: req.clinicId })
        .orderBy('start_date', 'desc');

      if (staffId) query = query.where({ staff_id: staffId });
      if (status) query = query.where({ status });
      if (from) query = query.where('start_date', '>=', from);
      if (to) query = query.where('end_date', '<=', to);

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /staff-leave
router.post(
  '/staff-leave',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { staffId, leaveType, startDate, endDate, reason, coverStaffId } = StaffLeaveCreateSchema.parse(req.body);
      const [row] = await db('staff_leave')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          staff_id: staffId,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          reason: reason || null,
          cover_staff_id: coverStaffId || null,
          status: 'requested',
          requested_by: req.user!.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(STAFF_LEAVE_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /staff-leave/:id
router.put(
  '/staff-leave/:id',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, leaveType, startDate, endDate, reason, coverStaffId } = StaffLeaveUpdateSchema.parse(req.body);
      const updates = {
        updated_at: db.fn.now(),
        ...(status ? { status } : {}),
        ...(leaveType ? { leave_type: leaveType } : {}),
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(coverStaffId !== undefined ? { cover_staff_id: coverStaffId } : {}),
        ...(status === 'approved' || status === 'rejected'
          ? { approved_by_staff_id: req.user!.id, approved_at: db.fn.now() }
          : {}),
      };

      const [row] = await db('staff_leave')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(updates)
        .returning(STAFF_LEAVE_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /staff-leave/:id
router.delete(
  '/staff-leave/:id',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('staff_leave')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

// ── Report Schedules CRUD ───────────────────────────────────────────────────
// GET /report-schedules
router.get(
  '/report-schedules',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await dbRead('report_schedules')
        .where({ clinic_id: req.clinicId })
        .orderBy('created_at', 'desc');
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /report-schedules
router.post(
  '/report-schedules',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        reportType, name, frequency, cronExpression, recipients,
        parameters, format, enabled,
      } = req.body;

      const [row] = await db('report_schedules')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          report_type: reportType,
          name,
          frequency: frequency || 'weekly',
          schedule_cron: cronExpression || null,
          recipients: JSON.stringify(recipients || []),
          filters: JSON.stringify(parameters || {}),
          format: format || 'pdf',
          is_active: enabled !== false,
          created_by_staff_id: req.user!.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(REPORT_SCHEDULE_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /report-schedules/:id
router.put(
  '/report-schedules/:id',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        name, frequency, cronExpression, recipients,
        parameters, format, enabled,
      } = req.body;

      const updates = {
        updated_at: db.fn.now(),
        ...(name !== undefined ? { name } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(cronExpression !== undefined ? { schedule_cron: cronExpression } : {}),
        ...(recipients !== undefined ? { recipients: JSON.stringify(recipients) } : {}),
        ...(parameters !== undefined ? { filters: JSON.stringify(parameters) } : {}),
        ...(format !== undefined ? { format } : {}),
        ...(enabled !== undefined ? { is_active: enabled } : {}),
      };

      const [row] = await db('report_schedules')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(updates)
        .returning(REPORT_SCHEDULE_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /report-schedules/:id
router.delete(
  '/report-schedules/:id',
  requireRoles([...MANAGER_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('report_schedules')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);


export default router;
