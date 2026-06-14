// apps/api/src/features/dashboard/dashboardRepository.ts
//
// S2.5: All queries here are read-only (the dashboard never writes)
// so they route through dbRead (read replica when DB_REPLICA_HOST is
// set, falls back to the primary pool when not). The `db` import is
// kept ONLY for db.raw() build-time SQL fragments, which are pool-
// agnostic.
import { db, dbRead } from '../../db/db';
import { OPEN_TASK_STATUSES } from '../tasks/taskStatusCatalog';
import { applyTeamTaskScopeFilter } from '../tasks/taskScopeSql';
import { hasClinicWideClinicalLeadershipAccess } from '../../shared/clinicalLeadershipAccess';

// ── Row types (DB snake_case) ─────────────────────────────────────────────────

interface AppointmentRow {
  id: string;
  patient_id: string;
  given_name: string;
  family_name: string;
  start_time: string;
  end_time: string;
  status: string;
  type: string;
  telehealth_link: string | null;
  appointment_start: string;
  appointment_end: string;
  appointment_type: string;
  telehealth_url: string | null;
}

interface EscalationAlertRow {
  id: string;
  patient_id: string;
  given_name: string;
  family_name: string;
  type: string;
  status: string;
  created_at: string;
}

interface RiskAlertRow {
  id: string;
  patient_id: string;
  given_name: string;
  family_name: string;
  overall_risk_level: string;
  assessment_date: string;
  created_at: string;
}

interface StaffMetricRow {
  user_id: string;
  first_name: string;
  last_name: string;
  completed_appointments: string;
  signed_notes: string;
  overdue_tasks: string;
  last_active_at: string | null;
}

interface BillingKpiRow {
  total_invoiced: string;
  total_collected: string;
  invoice_count: string;
  bulk_bill_count: string;
}

interface ReferralSlaRow {
  total: string;
  within_sla: string;
  avg_days: string | null;
}

interface OrgTeamRow {
  id: string;
  name: string;
  parent_id: string | null;
}

interface ProgramTeamRow {
  program_id: string;
  program_name: string;
  team_id: string;
}

interface TeamBreakdownRow {
  team_id: string;
  team_name: string;
  open_episodes: string;
  active_patients: string;
}

interface TeamClinicianBreakdownRow {
  staff_id: string;
  display_name: string;
  team_id: string;
  team_name: string;
  open_episodes: string;
  active_patients: string;
}

// ── Clinician queries ─────────────────────────────────────────────────────────

export async function getTodaysAppointments(
  clinicId: string,
  clinicianId: string,
): Promise<AppointmentRow[]> {
  return dbRead('appointments as a')
    .join('patients as p', 'a.patient_id', 'p.id')
    .where('a.clinic_id', clinicId)
    .where('a.clinician_id', clinicianId)
    .whereRaw(
      `DATE(a.appointment_start AT TIME ZONE 'Australia/Sydney') = CURRENT_DATE AT TIME ZONE 'Australia/Sydney'`,
    )
    .whereNull('a.deleted_at')
    .whereNotIn('a.status', ['cancelled'])
    .orderBy('a.appointment_start', 'asc')
    .select(
      'a.id',
      'a.patient_id',
      'p.given_name',
      'p.family_name',
      db.raw(`a.appointment_start AS start_time`),
      db.raw(`a.appointment_end AS end_time`),
      'a.status',
      db.raw(`a.appointment_type AS type`),
      db.raw(`a.telehealth_url AS telehealth_link`),
    );
}

export async function getOvernightEscalations(
  clinicId: string,
): Promise<EscalationAlertRow[]> {
  return dbRead('escalations as e')
    .join('patients as p', 'e.patient_id', 'p.id')
    .where('e.clinic_id', clinicId)
    .where('e.status', 'active')
    .whereRaw(`e.created_at >= NOW() - INTERVAL '12 hours'`)
    .whereNull('e.deleted_at')
    .orderBy('e.created_at', 'desc')
    .select(
      'e.id',
      'e.patient_id',
      'p.given_name',
      'p.family_name',
      'e.type',
      'e.status',
      'e.created_at',
    );
}

export async function getOvernightHighRiskAssessments(
  clinicId: string,
): Promise<RiskAlertRow[]> {
  return dbRead('risk_assessments as r')
    .join('patients as p', 'r.patient_id', 'p.id')
    .where('r.clinic_id', clinicId)
    .whereIn('r.overall_risk_level', ['high', 'very_high'])
    .whereRaw(`r.created_at >= NOW() - INTERVAL '12 hours'`)
    .whereNull('r.deleted_at')
    .orderBy('r.created_at', 'desc')
    .select(
      'r.id',
      'r.patient_id',
      'p.given_name',
      'p.family_name',
      'r.overall_risk_level',
      'r.assessment_date',
      'r.created_at',
    );
}

export async function countNewPathologyResults(
  clinicId: string,
  clinicianId: string,
): Promise<number> {
  // NEW-S1-A fix (2026-04-30): correct FK column is `pathology_order_id`.
  // Verified against schema-snapshot.json. Pre-fix this query referenced
  // the wrong pathology_results foreign key, crashed at runtime, and the
  // dashboard counter silently returned the SQL-error-as-zero so the bug
  // lived undetected.
  const [row] = await dbRead('pathology_orders as lo')
    .join('pathology_results as lr', 'lo.id', 'lr.pathology_order_id')
    .where('lo.clinic_id', clinicId)
    .where('lo.ordered_by_id', clinicianId)
    .whereRaw(`lr.created_at >= NOW() - INTERVAL '24 hours'`)
    .whereNull('lo.deleted_at')
    .count<[{ cnt: string }]>('lr.id as cnt');
  return parseInt(row?.cnt ?? '0', 10);
}

export async function countOverduePathologyResults(
  clinicId: string,
  clinicianId: string,
): Promise<number> {
  // "Overdue pathology" = clinician-ordered tests still awaiting a
  // final/corrected result beyond urgency-dependent SLA windows.
  const [row] = await dbRead('pathology_orders as lo')
    .where('lo.clinic_id', clinicId)
    .where('lo.ordered_by_id', clinicianId)
    .whereIn('lo.status', ['pending', 'sent', 'partial'])
    .whereNull('lo.deleted_at')
    .whereNotExists(
      dbRead('pathology_results as lr')
        .select(db.raw('1'))
        .whereRaw('lr.pathology_order_id = lo.id')
        .whereIn('lr.result_status', ['final', 'corrected']),
    )
    .andWhere(function overdueByUrgencyScope() {
      this.where(function statWindow() {
        this.where('lo.urgency', 'stat')
          .whereRaw(`lo.created_at < NOW() - INTERVAL '1 day'`);
      })
        .orWhere(function urgentWindow() {
          this.where('lo.urgency', 'urgent')
            .whereRaw(`lo.created_at < NOW() - INTERVAL '2 days'`);
        })
        .orWhere(function routineWindow() {
          this.where('lo.urgency', 'routine')
            .whereRaw(`lo.created_at < NOW() - INTERVAL '7 days'`);
        })
        .orWhere(function fallbackWindow() {
          this.whereRaw(`lo.urgency NOT IN ('routine', 'urgent', 'stat')`)
            .whereRaw(`lo.created_at < NOW() - INTERVAL '7 days'`);
        });
    })
    .count<[{ cnt: string }]>('lo.id as cnt');
  return parseInt(row?.cnt ?? '0', 10);
}

export async function countNewReferrals(
  clinicId: string,
  clinicianId: string,
): Promise<number> {
  const [row] = await dbRead('referrals')
    .where('clinic_id', clinicId)
    // PR-R1-13 DRAIN (2026-05-01): correct FK column is `assigned_to_staff_id`
    // not `assigned_to_id`. Verified against schema-snapshot.json. Pre-fix
    // this query crashed at runtime with "column assigned_to_id does not exist";
    // countNewReferrals silently returned the SQL-error-as-zero so the
    // dashboard's new-referrals counter stayed at 0 for clinicians regardless
    // of actual referral assignments. Same harm class as NEW-S1-A.
    .where('assigned_to_staff_id', clinicianId)
    .whereIn('status', ['received', 'under_review'])
    .whereNull('deleted_at')
    .count<[{ cnt: string }]>('id as cnt');
  return parseInt(row?.cnt ?? '0', 10);
}

export async function countOpenTasks(
  clinicId: string,
  userId: string,
): Promise<number> {
  const [row] = await dbRead('tasks')
    .where('clinic_id', clinicId)
    .where('assigned_to_id', userId)
    .whereIn('status', OPEN_TASK_STATUSES)
    .count<[{ cnt: string }]>('id as cnt');
  return parseInt(row?.cnt ?? '0', 10);
}

export async function countUnreadMessages(
  clinicId: string,
  userId: string,
): Promise<number> {
  // BUG-NEW-S1-CASCADE-B fix (2026-04-30): pre-fix referenced `mtp.clinic_id`
  // and `mtp.staff_id`, neither of which exists on `message_thread_participants`
  // (verified against schema-snapshot.json — actual columns are `[id, thread_id,
  // user_id, last_read_at, created_at, updated_at]`). Pre-fix this query crashed
  // at runtime with "column mtp.clinic_id does not exist"; the crash rejected
  // the getClinicianDashboard Promise.all, so the entire clinician dashboard
  // returned 500 for weeks — rendering NEW-S1-A's pathology counter fix INERT
  // until this cascade closed. Post-fix: clinic scope inherited via
  // `mt.clinic_id` (canonical for thread-scoped tenant filter); participant
  // identity is `mtp.user_id` (the actual column).
  const [row] = await dbRead('message_thread_participants as mtp')
    .join('message_threads as mt', 'mtp.thread_id', 'mt.id')
    .where('mt.clinic_id', clinicId)
    .where('mtp.user_id', userId)
    .whereNotNull('mt.last_message_at')
    .where(function () {
      this.whereNull('mtp.last_read_at').orWhereRaw(
        'mt.last_message_at > mtp.last_read_at',
      );
    })
    .whereNull('mt.deleted_at')
    .count<[{ cnt: string }]>('mtp.id as cnt');
  return parseInt(row?.cnt ?? '0', 10);
}

// ── Manager queries ───────────────────────────────────────────────────────────

export async function getReferralSlaSummary(
  clinicId: string,
  fromDate: Date,
  toDate: Date,
): Promise<ReferralSlaRow> {
  const [row] = await dbRead('referrals')
    .where('clinic_id', clinicId)
    .whereBetween('created_at', [fromDate, toDate])
    .whereNull('deleted_at')
    .select(
      db.raw('COUNT(*) AS total'),
      db.raw(
        `COUNT(*) FILTER (WHERE sla_due_date IS NULL OR updated_at::date <= sla_due_date) AS within_sla`,
      ),
      db.raw(
        `AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::numeric(5,1) AS avg_days`,
      ),
    );
  return row as ReferralSlaRow;
}

export async function getMissedAppointmentCounts(
  clinicId: string,
  fromDate: Date,
  toDate: Date,
): Promise<{ total: string; missed: string }> {
  const [row] = await dbRead('appointments')
    .where('clinic_id', clinicId)
    .whereBetween('appointment_start', [fromDate, toDate])
    .whereNull('deleted_at')
    .select(
      db.raw('COUNT(*) AS total'),
      db.raw(
        `COUNT(*) FILTER (WHERE status IN ('no_show','cancelled')) AS missed`,
      ),
    );
  return row as { total: string; missed: string };
}

export async function getStaffActivityMetrics(
  clinicId: string,
  fromDate: Date,
  toDate: Date,
): Promise<StaffMetricRow[]> {
  return dbRead('staff as u')
    .where('u.clinic_id', clinicId)
    .whereIn('u.role', ['clinician', 'admin', 'manager'])
    .where('u.is_active', true)
    .whereNull('u.deleted_at')
    .leftJoin(
      dbRead('appointments')
        .where('clinic_id', clinicId)
        .where('status', 'completed')
        .whereBetween('appointment_start', [fromDate, toDate])
        .whereNull('deleted_at')
        .groupBy('clinician_id')
        .select('clinician_id', db.raw('COUNT(*) as completed_count'))
        .as('appt'),
      'u.id',
      'appt.clinician_id',
    )
    .leftJoin(
      dbRead('clinical_notes')
        .where('clinic_id', clinicId)
        .where('is_signed', true)
        .whereBetween('created_at', [fromDate, toDate])
        .whereNull('deleted_at')
        .groupBy('author_id')
        .select('author_id', db.raw('COUNT(*) as signed_count'))
        .as('notes'),
      'u.id',
      'notes.author_id',
    )
    .leftJoin(
      dbRead('tasks')
        .where('clinic_id', clinicId)
        .whereIn('status', OPEN_TASK_STATUSES)
        // PR-R1-13 DRAIN (2026-05-01): correct column is `due_date` not
        // `due_at` (sibling of NEW-S1-CASCADE-A; same drift class).
        .whereRaw('due_date < CURRENT_DATE')
        .groupBy('assigned_to_id')
        .select('assigned_to_id', db.raw('COUNT(*) as overdue_count'))
        .as('otasks'),
      'u.id',
      'otasks.assigned_to_id',
    )
    .select(
      'u.id as user_id',
      db.raw(`u.given_name AS first_name`),
      db.raw(`u.family_name AS last_name`),
      db.raw('COALESCE(appt.completed_count, 0) AS completed_appointments'),
      db.raw('COALESCE(notes.signed_count, 0) AS signed_notes'),
      db.raw('COALESCE(otasks.overdue_count, 0) AS overdue_tasks'),
      'u.last_login_at as last_active_at',
    )
    .orderBy('u.family_name', 'asc');
}

export async function getBillingKpis(
  clinicId: string,
  fromDate: Date,
  toDate: Date,
): Promise<BillingKpiRow> {
  // BUG-647 (L5): invoices store canonical currency as *_cents.
  // Using legacy total_amount / amount_paid hard-fails with
  // "column does not exist" on current schema and takes
  // GET /dashboard/manager down with 500s. Keep dashboard API
  // amounts in dollars by converting cents -> dollars in SQL.
  const [row] = await dbRead('invoices')
    .where('clinic_id', clinicId)
    .whereBetween('created_at', [fromDate, toDate])
    .whereNotIn('status', ['draft', 'void'])
    .select(
      db.raw('COUNT(*) AS invoice_count'),
      db.raw('COALESCE(SUM(total_cents), 0)::numeric / 100 AS total_invoiced'),
      db.raw('COALESCE(SUM(paid_cents), 0)::numeric / 100 AS total_collected'),
      db.raw(
        `COUNT(*) FILTER (WHERE billing_type = 'bulk_bill') AS bulk_bill_count`,
      ),
    );
  return row as BillingKpiRow;
}

// ── Team dashboard scope and metrics ─────────────────────────────────────────

function asCount(
  row: Record<string, unknown> | undefined,
  key: string,
): number {
  const value = row?.[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}

function openEpisodeQuery(clinicId: string, teamIds: string[]) {
  return dbRead('episodes')
    .where('clinic_id', clinicId)
    .whereIn('team_id', teamIds)
    .whereIn('status', ['open', 'onhold', 'active'])
    .whereNull('deleted_at');
}

function teamPatientIdsQuery(clinicId: string, teamIds: string[]) {
  return openEpisodeQuery(clinicId, teamIds).select('patient_id');
}

export async function getOrgTeams(
  clinicId: string,
): Promise<OrgTeamRow[]> {
  return dbRead('org_units')
    .where({ clinic_id: clinicId, is_active: true })
    .select('id', 'name', 'parent_id')
    .orderBy('name', 'asc') as Promise<OrgTeamRow[]>;
}

export async function getProgramTeams(
  clinicId: string,
): Promise<ProgramTeamRow[]> {
  return dbRead('org_unit_programs as oup')
    .join('programs as p', function joinProgram() {
      this.on('p.clinic_id', 'oup.clinic_id').andOn('p.name', 'oup.name');
    })
    .where('oup.clinic_id', clinicId)
    .where('oup.is_active', true)
    .where('p.is_active', true)
    .select(
      'p.id as program_id',
      'p.name as program_name',
      'oup.org_unit_id as team_id',
    ) as Promise<ProgramTeamRow[]>;
}

export async function getAssignedTeamIdsForStaff(
  clinicId: string,
  staffId: string,
): Promise<string[]> {
  const teamRows = await dbRead('staff_team_assignments')
    .where({
      clinic_id: clinicId,
      staff_id: staffId,
      is_active: true,
    })
    .where(function activeDate() {
      this.whereNull('end_date').orWhereRaw('end_date >= CURRENT_DATE');
    })
    .select('org_unit_id');

  const roleRows = await dbRead('staff_role_assignments')
    .where({
      clinic_id: clinicId,
      staff_id: staffId,
      is_active: true,
    })
    .where(function activeDate() {
      this.whereNull('end_date').orWhereRaw('end_date >= CURRENT_DATE');
    })
    .select('org_unit_id');

  return [...new Set([
    ...teamRows.map((r) => String(r.org_unit_id)),
    ...roleRows.map((r) => String(r.org_unit_id)),
  ])];
}

export async function hasClinicWideLeadershipAccess(
  clinicId: string,
  staffId: string,
): Promise<boolean> {
  return hasClinicWideClinicalLeadershipAccess(
    dbRead,
    clinicId,
    staffId,
  );
}

export async function getTeamStaffIds(
  clinicId: string,
  teamIds: string[],
): Promise<string[]> {
  if (teamIds.length === 0) return [];

  const teamRows = await dbRead('staff_team_assignments')
    .where('clinic_id', clinicId)
    .whereIn('org_unit_id', teamIds)
    .where('is_active', true)
    .where(function activeDate() {
      this.whereNull('end_date').orWhereRaw('end_date >= CURRENT_DATE');
    })
    .select('staff_id');

  const roleRows = await dbRead('staff_role_assignments')
    .where('clinic_id', clinicId)
    .whereIn('org_unit_id', teamIds)
    .where('is_active', true)
    .where(function activeDate() {
      this.whereNull('end_date').orWhereRaw('end_date >= CURRENT_DATE');
    })
    .select('staff_id');

  return [...new Set([
    ...teamRows.map((r) => String(r.staff_id)),
    ...roleRows.map((r) => String(r.staff_id)),
  ])];
}

export async function countTeamActivePatients(
  clinicId: string,
  teamIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const [row] = await openEpisodeQuery(clinicId, teamIds)
    .countDistinct('patient_id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamOpenEpisodes(
  clinicId: string,
  teamIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const [row] = await openEpisodeQuery(clinicId, teamIds).count('id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamTodaysAppointments(
  clinicId: string,
  teamIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const [row] = await dbRead('appointments as a')
    .where('a.clinic_id', clinicId)
    .whereNull('a.deleted_at')
    .whereNotIn('a.status', ['cancelled'])
    .whereRaw(
      `DATE(a.appointment_start AT TIME ZONE 'Australia/Sydney') = CURRENT_DATE AT TIME ZONE 'Australia/Sydney'`,
    )
    .whereExists(function teamEpisodeExists() {
      this.select(db.raw('1'))
        .from('episodes as e')
        .whereRaw('e.clinic_id = a.clinic_id')
        .whereIn('e.team_id', teamIds)
        .whereIn('e.status', ['open', 'onhold', 'active'])
        .whereNull('e.deleted_at')
        .andWhere(function episodeJoin() {
          this.whereRaw('e.id = a.episode_id').orWhere(function fallbackPatientJoin() {
            this.whereNull('a.episode_id').whereRaw('e.patient_id = a.patient_id');
          });
        });
    })
    .countDistinct('a.id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamOverdueReviews(
  clinicId: string,
  teamIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const [row] = await openEpisodeQuery(clinicId, teamIds)
    .whereRaw("start_date < CURRENT_DATE - INTERVAL '91 days'")
    .countDistinct('patient_id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamUpcomingReviews(
  clinicId: string,
  teamIds: string[],
  daysAhead: number = 7,
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const [row] = await openEpisodeQuery(clinicId, teamIds)
    .whereRaw("(start_date + INTERVAL '91 days') >= CURRENT_DATE")
    .whereRaw("(start_date + INTERVAL '91 days') <= CURRENT_DATE + (? * INTERVAL '1 day')", [daysAhead])
    .countDistinct('patient_id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamDidNotAttendAppointments(
  clinicId: string,
  teamIds: string[],
  daysBack: number = 30,
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const teamPatients = teamPatientIdsQuery(clinicId, teamIds);
  const [row] = await dbRead('appointments as a')
    .where('a.clinic_id', clinicId)
    .whereIn('a.status', ['no_show', 'missed'])
    .whereIn('a.patient_id', teamPatients)
    .whereRaw('a.appointment_start >= CURRENT_DATE - (? * INTERVAL \'1 day\')', [daysBack])
    .whereNull('a.deleted_at')
    .countDistinct('a.id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamLaiOverdue(
  clinicId: string,
  teamIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const teamPatients = teamPatientIdsQuery(clinicId, teamIds);
  const [row] = await dbRead('lai_schedules')
    .where('clinic_id', clinicId)
    .where('status', 'active')
    .whereNull('deleted_at')
    .whereIn('patient_id', teamPatients)
    .whereRaw('next_due_date < CURRENT_DATE')
    .countDistinct('id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamLaiUpcoming(
  clinicId: string,
  teamIds: string[],
  daysAhead: number = 14,
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const teamPatients = teamPatientIdsQuery(clinicId, teamIds);
  const [row] = await dbRead('lai_schedules')
    .where('clinic_id', clinicId)
    .where('status', 'active')
    .whereNull('deleted_at')
    .whereIn('patient_id', teamPatients)
    .whereRaw('next_due_date >= CURRENT_DATE')
    .whereRaw('next_due_date <= CURRENT_DATE + (? * INTERVAL \'1 day\')', [daysAhead])
    .countDistinct('id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamMhaOverdue(
  clinicId: string,
  teamIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const teamPatients = teamPatientIdsQuery(clinicId, teamIds);
  const [row] = await dbRead('patient_legal_orders as lo')
    .where('lo.clinic_id', clinicId)
    .where('lo.status', 'active')
    .whereIn('lo.patient_id', teamPatients)
    .whereRaw('lo.end_date < CURRENT_DATE')
    .countDistinct('lo.id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamMhaUpcoming(
  clinicId: string,
  teamIds: string[],
  daysAhead: number = 14,
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const teamPatients = teamPatientIdsQuery(clinicId, teamIds);
  const [row] = await dbRead('patient_legal_orders as lo')
    .where('lo.clinic_id', clinicId)
    .where('lo.status', 'active')
    .whereIn('lo.patient_id', teamPatients)
    .whereRaw('lo.end_date >= CURRENT_DATE')
    .whereRaw('lo.end_date <= CURRENT_DATE + (? * INTERVAL \'1 day\')', [daysAhead])
    .countDistinct('lo.id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamUrgentAlerts(
  clinicId: string,
  teamIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;

  const teamPatients = openEpisodeQuery(clinicId, teamIds).select('patient_id');

  const [escalationRow] = await dbRead('escalations')
    .where('clinic_id', clinicId)
    .whereIn('status', ['open', 'active', 'new'])
    .whereIn('patient_id', teamPatients)
    .whereNull('deleted_at')
    .count('id as cnt');

  const [riskRow] = await dbRead('risk_assessments')
    .where('clinic_id', clinicId)
    .whereIn('overall_risk_level', ['high', 'very_high'])
    .whereIn('patient_id', teamPatients)
    .whereRaw("created_at >= NOW() - INTERVAL '30 days'")
    .whereNull('deleted_at')
    .count('id as cnt');

  return asCount(escalationRow as Record<string, unknown>, 'cnt')
    + asCount(riskRow as Record<string, unknown>, 'cnt');
}

export async function countTeamOpenTasks(
  clinicId: string,
  teamIds: string[],
  _staffIds: string[],
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const query = dbRead('tasks as t')
    .where('t.clinic_id', clinicId)
    .whereIn('t.status', OPEN_TASK_STATUSES);
  applyTeamTaskScopeFilter(query, clinicId, teamIds);
  const [row] = await query.countDistinct('t.id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamUnreadMessages(
  clinicId: string,
  staffIds: string[],
): Promise<number> {
  if (staffIds.length === 0) return 0;
  const [row] = await dbRead('message_thread_participants as mtp')
    .join('message_threads as mt', 'mtp.thread_id', 'mt.id')
    .where('mt.clinic_id', clinicId)
    .whereIn('mtp.user_id', staffIds)
    .whereNotNull('mt.last_message_at')
    .where(function unread() {
      this.whereNull('mtp.last_read_at').orWhereRaw(
        'mt.last_message_at > mtp.last_read_at',
      );
    })
    .whereNull('mt.deleted_at')
    .count('mtp.id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function countTeamNewReferrals(
  clinicId: string,
  staffIds: string[],
): Promise<number> {
  if (staffIds.length === 0) return 0;
  const [row] = await dbRead('referrals')
    .where('clinic_id', clinicId)
    .whereIn('assigned_to_staff_id', staffIds)
    .whereIn('status', ['received', 'under_review'])
    .whereNull('deleted_at')
    .count('id as cnt');
  return asCount(row as Record<string, unknown>, 'cnt');
}

export async function getTeamBreakdown(
  clinicId: string,
  teamIds: string[],
): Promise<TeamBreakdownRow[]> {
  if (teamIds.length === 0) return [];
  return dbRead('episodes as e')
    // @fk-join-exempt: legacy schema has no explicit FK on episodes.team_id; join remains clinic-scoped in this query. BUG-637.
    .join('org_units as ou', 'ou.id', 'e.team_id')
    .where('e.clinic_id', clinicId)
    .whereIn('e.team_id', teamIds)
    .whereIn('e.status', ['open', 'onhold', 'active'])
    .whereNull('e.deleted_at')
    .groupBy('e.team_id', 'ou.name')
    .select(
      'e.team_id',
      'ou.name as team_name',
      db.raw('COUNT(e.id)::int as open_episodes'),
      db.raw('COUNT(DISTINCT e.patient_id)::int as active_patients'),
    ) as Promise<TeamBreakdownRow[]>;
}

export async function getTeamClinicianBreakdown(
  clinicId: string,
  teamIds: string[],
): Promise<TeamClinicianBreakdownRow[]> {
  if (teamIds.length === 0) return [];
  return dbRead('episodes as e')
    .join('staff as s', 's.id', 'e.primary_clinician_id')
    // @fk-join-exempt: legacy schema has no explicit FK on episodes.team_id; join remains clinic-scoped in this query. BUG-637.
    .join('org_units as ou', 'ou.id', 'e.team_id')
    .where('e.clinic_id', clinicId)
    .whereIn('e.team_id', teamIds)
    .whereIn('e.status', ['open', 'onhold', 'active'])
    .whereNull('e.deleted_at')
    .groupBy('s.id', 's.given_name', 's.family_name', 'e.team_id', 'ou.name')
    .select(
      's.id as staff_id',
      db.raw("s.given_name || ' ' || s.family_name as display_name"),
      'e.team_id',
      'ou.name as team_name',
      db.raw('COUNT(e.id)::int as open_episodes'),
      db.raw('COUNT(DISTINCT e.patient_id)::int as active_patients'),
    )
    .orderByRaw('COUNT(DISTINCT e.patient_id) DESC')
    .orderBy('s.family_name', 'asc')
    .orderBy('s.given_name', 'asc') as Promise<TeamClinicianBreakdownRow[]>;
}
