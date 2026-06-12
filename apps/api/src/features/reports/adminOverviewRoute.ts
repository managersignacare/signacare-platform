import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { extractCount } from '../../shared/extractCount';
import { OPEN_TASK_STATUSES } from '../tasks/taskStatusCatalog';
import {
  OPEN_CASELOAD_EPISODE_STATUSES,
} from '../dashboard/caseloadAssignmentSql';

// @jsonb-extraction-exempt: aggregate-only route; no JSONB columns are selected or returned.
type GroupRow = Record<string, unknown>;
type TeamBreakdownRow = { team: string; cnt: string | number };
type StaffActivityRow = {
  id: string;
  given_name: string;
  family_name: string;
  role: string;
  notes: number;
  appointments: number;
};
type DischargeRow = { closure_reason?: string; cnt: string | number; avg_los?: string };
type StaffPatientCountRow = { staff_id: string; patients: string | number };

const CountMapSchema = z.record(z.number().int().nonnegative());
const AdminOverviewResponseSchema = z.object({
  period: z.string(),
  overview: z.object({
    totalPatients: z.number().int().nonnegative(),
    openEpisodes: z.number().int().nonnegative(),
    newReferrals: z.number().int().nonnegative(),
    referralsByStatus: CountMapSchema,
    totalAppointments: z.number().int().nonnegative(),
    appointmentsByStatus: CountMapSchema,
    openTasks: z.number().int().nonnegative(),
    overdueTasks: z.number().int().nonnegative(),
  }),
  clinical: z.object({
    totalNotes: z.number().int().nonnegative(),
    signedNotes: z.number().int().nonnegative(),
    draftNotes: z.number().int().nonnegative(),
    dnaRate: z.number().int().nonnegative(),
    dnaCount: z.number().int().nonnegative(),
    laiTotal: z.number().int().nonnegative(),
    laiOverdue: z.number().int().nonnegative(),
    escalationsActive: z.number().int().nonnegative(),
    escalationsResolved: z.number().int().nonnegative(),
    restrictiveInterventions: z.number().int().nonnegative(),
  }),
  compliance: z.object({
    overdueReviews: z.number().int().nonnegative(),
    activeLegalOrders: z.number().int().nonnegative(),
    pendingLegalOrders: z.number().int().nonnegative(),
  }),
  teams: z.array(z.object({
    team: z.string(),
    count: z.number().int().nonnegative(),
  })),
  staff: z.array(z.object({
    name: z.string(),
    role: z.string(),
    patients: z.number().int().nonnegative(),
    notes: z.number().int().nonnegative(),
    appointments: z.number().int().nonnegative(),
  })),
  discharges: z.object({
    total: z.number().int().nonnegative(),
    avgLos: z.number().nonnegative(),
    reasons: z.array(z.object({
      reason: z.string(),
      count: z.number().int().nonnegative(),
    })),
  }),
  beds: z.object({
    total: z.number().int().nonnegative(),
    occupied: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    maintenance: z.number().int().nonnegative(),
  }),
});

function resolvePeriodWindow(period: string): { from: Date; now: Date } {
  const now = new Date();
  let from: Date;
  switch (period) {
    case 'week': {
      const day = now.getDay();
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 0 ? 6 : day - 1));
      break;
    }
    case 'quarter':
      from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { from, now };
}

const sumGroup = (rows: GroupRow[], status: string) =>
  parseInt(String(rows.find((row) => row.status === status)?.cnt ?? '0'), 10);
const sumCat = (rows: GroupRow[], cat: string) =>
  parseInt(String(rows.find((row) => row.cat === cat)?.cnt ?? '0'), 10);
const totalFromGroup = (rows: GroupRow[]) =>
  rows.reduce((sum: number, row) => sum + parseInt(String(row.cnt ?? '0'), 10), 0);
const totalForStatuses = (rows: GroupRow[], statuses: readonly string[]) =>
  statuses.reduce((sum, status) => sum + sumGroup(rows, status), 0);

function applyCaseloadAssignmentPredicate(
  qb: Knex.QueryBuilder,
  today: string,
): void {
  qb.whereRaw('?? = ??', ['e.primary_clinician_id', 'staff.id'])
    .orWhereRaw('?? = ??', ['e.key_worker_id', 'staff.id'])
    .orWhereExists(function patientPrimaryAssignment(this: Knex.QueryBuilder) {
      this.select(1)
        .from('patient_team_assignments as pta_primary')
        .whereRaw('?? = ??', ['pta_primary.patient_id', 'e.patient_id'])
        .where('pta_primary.is_active', true)
        .whereRaw('?? = ??', ['pta_primary.primary_clinician_id', 'staff.id']);
    })
    .orWhereExists(function staffRoleAssignment(this: Knex.QueryBuilder) {
      this.select(1)
        .from('staff_role_assignments as sra')
        .whereRaw('?? = ??', ['sra.clinic_id', 'e.clinic_id'])
        .whereRaw('?? = ??', ['sra.staff_id', 'staff.id'])
        .where('sra.is_active', true)
        .where(function roleStillActive(this: Knex.QueryBuilder) {
          this.whereNull('sra.end_date').orWhere('sra.end_date', '>=', today);
        })
        .where(function roleMatchesEpisodeOrPatientTeam(this: Knex.QueryBuilder) {
          this.whereRaw('?? = ??', ['sra.org_unit_id', 'e.team_id'])
            .orWhereExists(function patientRoleTeamAssignment(this: Knex.QueryBuilder) {
              this.select(1)
                .from('patient_team_assignments as pta_role')
                .whereRaw('?? = ??', ['pta_role.patient_id', 'e.patient_id'])
                .whereRaw('?? = ??', ['pta_role.org_unit_id', 'sra.org_unit_id'])
                .where('pta_role.is_active', true);
            });
        });
    })
    .orWhereExists(function staffTeamAssignment(this: Knex.QueryBuilder) {
      this.select(1)
        .from('staff_team_assignments as sta')
        .whereRaw('?? = ??', ['sta.clinic_id', 'e.clinic_id'])
        .whereRaw('?? = ??', ['sta.staff_id', 'staff.id'])
        .where('sta.is_active', true)
        .where(function teamStillActive(this: Knex.QueryBuilder) {
          this.whereNull('sta.end_date').orWhere('sta.end_date', '>=', today);
        })
        .where(function teamMatchesEpisodeOrPatientTeam(this: Knex.QueryBuilder) {
          this.whereRaw('?? = ??', ['sta.org_unit_id', 'e.team_id'])
            .orWhereExists(function patientTeamAssignment(this: Knex.QueryBuilder) {
              this.select(1)
                .from('patient_team_assignments as pta_team')
                .whereRaw('?? = ??', ['pta_team.patient_id', 'e.patient_id'])
                .whereRaw('?? = ??', ['pta_team.org_unit_id', 'sta.org_unit_id'])
                .where('pta_team.is_active', true);
            });
        });
    });
}

export async function handleAdminOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { db } = await import('../../db/db');
    const { resolveTeamNames } = await import('../../utils/nameResolver');

    const clinicId = req.clinicId;
    const period = (req.query.period as string) || 'month';
    const { from, now } = resolvePeriodWindow(period);
    const today = now.toISOString().slice(0, 10);

    // BUG-722: request-scoped RLS uses one transaction connection.
    // Run independent DB reads sequentially to avoid concurrent-query warnings.
    const patientCount = await db('patients').where('clinic_id', clinicId).whereNull('deleted_at').count('* as cnt').then(extractCount);
    const openEpisodes = await db('episodes')
      .where({ clinic_id: clinicId })
      .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
      .whereNull('episodes.deleted_at')
      .count('* as cnt')
      .then(extractCount);
    const referralRows = await db('referrals').where('clinic_id', clinicId).whereNull('deleted_at').whereBetween('created_at', [from, now]).select(db.raw("status, count(*) as cnt")).groupBy('status');
    const appointmentRows = await db('appointments').where('clinic_id', clinicId).whereNull('deleted_at').whereBetween('appointment_start', [from, now]).select(db.raw("status, count(*) as cnt")).groupBy('status');
    const taskRows = await db('tasks').where('clinic_id', clinicId).select(db.raw("status, count(*) as cnt")).groupBy('status');
    const noteRows = await db('clinical_notes').where('clinic_id', clinicId).whereNull('deleted_at').whereBetween('created_at', [from, now]).select(db.raw("CASE WHEN is_signed THEN 'signed' ELSE 'draft' END as cat, count(*) as cnt")).groupBy('cat');
    const legalRows = await db('patient_legal_orders').where('clinic_id', clinicId).whereIn('status', ['active', 'pending']).select(db.raw("status, count(*) as cnt")).groupBy('status');
    const laiRows = await db('lai_schedules')
      .where({ clinic_id: clinicId, status: 'active' })
      .whereNull('deleted_at')
      .select(db.raw("CASE WHEN next_due_date < now() THEN 'overdue' ELSE 'on_time' END as cat, count(*) as cnt"))
      .groupBy('cat');
    const escalationRows = await db('escalations').where('clinic_id', clinicId).whereNull('deleted_at').whereBetween('created_at', [from, now]).select(db.raw("status, count(*) as cnt")).groupBy('status');
    const restrictiveInterventions = await db('restrictive_interventions').where('clinic_id', clinicId).whereBetween('created_at', [from, now]).count('* as cnt').then(extractCount);
    const teamBreakdown = await db('episodes')
      .where({ clinic_id: clinicId })
      .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
      .whereNull('episodes.deleted_at')
      .whereNotNull('team_id')
      .select('team_id as team', db.raw('count(*) as cnt'))
      .groupBy('team_id')
      .orderBy('cnt', 'desc');
    const staffPatientCountRows = await db('staff')
      .where({ 'staff.clinic_id': clinicId, 'staff.is_active': true })
      .whereNull('staff.deleted_at')
      // @fk-join-exempt: clinic-scope staff x open-episode aggregation; assignment predicates below bind each episode to the staff member.
      .join('episodes as e', 'e.clinic_id', 'staff.clinic_id')
      .whereIn('e.status', [...OPEN_CASELOAD_EPISODE_STATUSES])
      .whereNull('e.deleted_at')
      .where(function assignedToStaff() {
        applyCaseloadAssignmentPredicate(this, today);
      })
      .groupBy('staff.id')
      .select('staff.id as staff_id')
      .countDistinct({ patients: 'e.patient_id' });
    const patientCountsByStaff = new Map(
      (staffPatientCountRows as StaffPatientCountRow[]).map((row) => [
        row.staff_id,
        parseInt(String(row.patients), 10),
      ]),
    );
    const staffActivity = await db('staff')
      .where({ clinic_id: clinicId, is_active: true })
      .whereNull('deleted_at')
      .leftJoin(
        db('clinical_notes').whereNull('deleted_at').whereBetween('created_at', [from, now])
          .groupBy('author_id').select('author_id', db.raw('count(*) as note_cnt')).as('n'),
        'staff.id', 'n.author_id',
      )
      .leftJoin(
        db('appointments').whereNull('deleted_at').where('status', 'completed').whereBetween('appointment_start', [from, now])
          .groupBy('clinician_id').select('clinician_id', db.raw('count(*) as appt_cnt')).as('a'),
        'staff.id', 'a.clinician_id',
      )
      .select(
        'staff.id',
        'staff.given_name',
        'staff.family_name',
        'staff.role',
        db.raw('COALESCE(n.note_cnt, 0)::int as notes'),
        db.raw('COALESCE(a.appt_cnt, 0)::int as appointments'),
      )
      .orderBy('staff.family_name')
      .limit(200);
    const dischargeRows = await db('episodes')
      .where('clinic_id', clinicId)
      .whereNull('episodes.deleted_at')
      .whereNotNull('end_date')
      .whereBetween('end_date', [from, now])
      .select(db.raw("COALESCE(closure_reason, 'unknown') as closure_reason, count(*) as cnt, AVG(end_date - start_date)::numeric(5,1) as avg_los"))
      .groupBy('closure_reason');
    const bedRows = await db('beds').where('clinic_id', clinicId).select(db.raw("status, count(*) as cnt")).groupBy('status');

    await resolveTeamNames(teamBreakdown, 'team');

    const overdueReviewRows = await db('episodes')
      .where({ clinic_id: clinicId })
      .whereIn('status', [...OPEN_CASELOAD_EPISODE_STATUSES])
      .whereNull('episodes.deleted_at')
      .whereNotNull('start_date')
      .whereRaw("start_date < CURRENT_DATE - INTERVAL '91 days'")
      .count('* as cnt');
    const overdueReviews = extractCount(overdueReviewRows as GroupRow[]);
    const totalAppointments = totalFromGroup(appointmentRows);
    const dnaCount = sumGroup(appointmentRows, 'no_show');
    const dnaRate = totalAppointments > 0 ? Math.round((dnaCount / totalAppointments) * 100) : 0;
    const overdueTasks = await db('tasks')
      .where('clinic_id', clinicId)
      .whereIn('status', OPEN_TASK_STATUSES)
      .whereRaw('due_date < CURRENT_DATE').count('* as cnt')
      .then(extractCount);

    res.json(AdminOverviewResponseSchema.parse({
      period,
      overview: {
        totalPatients: patientCount,
        openEpisodes,
        newReferrals: totalFromGroup(referralRows),
        referralsByStatus: Object.fromEntries(referralRows.map((row) => [row.status, parseInt(String(row.cnt), 10)])),
        totalAppointments,
        appointmentsByStatus: Object.fromEntries(appointmentRows.map((row) => [row.status, parseInt(String(row.cnt), 10)])),
        openTasks: totalForStatuses(taskRows, OPEN_TASK_STATUSES),
        overdueTasks,
      },
      clinical: {
        totalNotes: totalFromGroup(noteRows),
        signedNotes: sumCat(noteRows, 'signed'),
        draftNotes: sumCat(noteRows, 'draft'),
        dnaRate,
        dnaCount,
        laiTotal: totalFromGroup(laiRows),
        laiOverdue: sumCat(laiRows, 'overdue'),
        escalationsActive: sumGroup(escalationRows, 'open') + sumGroup(escalationRows, 'active'),
        escalationsResolved: sumGroup(escalationRows, 'resolved'),
        restrictiveInterventions,
      },
      compliance: {
        overdueReviews,
        activeLegalOrders: sumGroup(legalRows, 'active'),
        pendingLegalOrders: sumGroup(legalRows, 'pending'),
      },
      teams: (teamBreakdown as TeamBreakdownRow[]).map((row) => ({ team: row.team, count: parseInt(String(row.cnt), 10) })),
      staff: (staffActivity as StaffActivityRow[]).map((row) => ({
        name: `${row.given_name} ${row.family_name}`,
        role: row.role,
        patients: patientCountsByStaff.get(row.id) ?? 0,
        notes: row.notes,
        appointments: row.appointments,
      })),
      discharges: {
        total: (dischargeRows as DischargeRow[]).reduce((sum: number, row) => sum + parseInt(String(row.cnt), 10), 0),
        avgLos: (dischargeRows as DischargeRow[]).length ? parseFloat((dischargeRows as DischargeRow[])[0]?.avg_los ?? '0') : 0,
        reasons: (dischargeRows as DischargeRow[]).map((row) => ({
          reason: row.closure_reason ?? 'Not specified',
          count: parseInt(String(row.cnt), 10),
        })),
      },
      beds: {
        total: totalFromGroup(bedRows),
        occupied: sumGroup(bedRows, 'occupied'),
        available: sumGroup(bedRows, 'available'),
        maintenance: sumGroup(bedRows, 'maintenance'),
      },
    }));
  } catch (err) {
    next(err);
  }
}
