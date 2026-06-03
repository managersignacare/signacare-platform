import type {
  AdminReportDetailRow,
  AdminReportFilters,
  AdminReportMetricKey,
  AdminReportOverviewCard,
  AdminReportTrendGranularity,
  AdminReportTrendSeries,
} from '@signacare/shared';
import { ADMIN_REPORT_METRIC_META, AdminReportMetricKeySchema } from '@signacare/shared';
import type { Knex } from 'knex';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import {
  OPEN_CASELOAD_EPISODE_STATUSES,
  caseloadAssignmentBindingsForBoundStaff,
  caseloadAssignmentPredicateForBoundStaff,
} from '../dashboard/caseloadAssignmentSql';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DETAIL_LIMIT = 200;
const JMO_ROLE_PATTERNS = ['%medical officer%', '%psychiatry registrar%', '%psychiatry fellow%'] as const;
const CONSULTANT_ROLE_PATTERNS = ['%consultant psychiatrist%'] as const;

export type AdminReportResolvedContext = {
  clinicId: string;
  filters: AdminReportFilters;
  from: Date;
  to: Date;
  asOf: Date;
  teamIds: string[];
};

type DetailCandidateRow = {
  patient_id: string;
  emr_number: string | null;
  given_name: string;
  family_name: string;
  date_of_birth: Date | string | null;
  team_name?: string | null;
  clinician_name?: string | null;
  ref_source?: string | null;
  ref_date?: Date | string | null;
  urgency?: string | null;
  status?: string | null;
  due_date?: Date | string | null;
  note?: string | null;
};

type MetricTimeMode = 'snapshot' | 'event';

const METRIC_TIME_MODE: Record<AdminReportMetricKey, MetricTimeMode> = {
  total_consumers: 'snapshot',
  new_consumer: 'event',
  transfer_to_outpatients: 'event',
  transfer_to_acis: 'event',
  currently_admitted: 'snapshot',
  currently_in_parcs: 'snapshot',
  discharged_from_cct: 'event',
  discharged_from_ipu: 'event',
  discharged_from_parcs: 'event',
  on_single_lai: 'snapshot',
  on_multiple_lai: 'snapshot',
  total_lai_consumer: 'snapshot',
  total_on_mha: 'snapshot',
  upcoming_mha_review: 'snapshot',
  upcoming_tribunal_hearing: 'snapshot',
  dna_last_week: 'event',
  number_of_clozapine: 'snapshot',
  upcoming_mha_application: 'snapshot',
  overdue_kc_review: 'snapshot',
  overdue_jmo_review: 'snapshot',
  overdue_consultant_review: 'snapshot',
  overdue_91d_review: 'snapshot',
  overdue_lai: 'snapshot',
  incomplete_craam: 'snapshot',
  incomplete_registration_form: 'snapshot',
  incomplete_recovery_plan: 'snapshot',
  incomplete_gp_pp_contact: 'snapshot',
  incomplete_family_contact: 'snapshot',
};

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function resolvePeriodWindow(filters: AdminReportFilters): {
  from: Date;
  to: Date;
} {
  const now = new Date();
  const today = startOfDay(now);
  switch (filters.period) {
    case 'week': {
      const weekday = today.getDay();
      const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
      return {
        from: addDays(today, -daysFromMonday),
        to: now,
      };
    }
    case 'month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: now };
    case 'quarter':
      return { from: new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1), to: now };
    case 'year':
      return { from: new Date(today.getFullYear(), 0, 1), to: now };
    case 'custom': {
      if (!filters.from || !filters.to) {
        throw new AppError("Custom period requires 'from' and 'to' dates", 400, 'VALIDATION_ERROR');
      }
      const from = new Date(`${filters.from}T00:00:00.000Z`);
      const to = new Date(`${filters.to}T23:59:59.999Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        throw new AppError("Invalid 'from'/'to' range", 400, 'VALIDATION_ERROR');
      }
      return { from, to };
    }
    default:
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: now };
  }
}

async function resolveTeamScope(clinicId: string, teamId?: string): Promise<string[]> {
  if (!teamId) return [];
  const rows = await db.raw<{ rows: Array<{ id: string }> }>(
    `
      WITH RECURSIVE team_scope AS (
        SELECT id, parent_id
        FROM org_units
        WHERE id = :teamId AND clinic_id = :clinicId
        UNION ALL
        SELECT child.id, child.parent_id
        FROM org_units child
        JOIN team_scope parent ON child.parent_id = parent.id
        WHERE child.clinic_id = :clinicId
      )
      SELECT id FROM team_scope
    `,
    { clinicId, teamId },
  );
  const ids = rows.rows.map((row) => row.id);
  if (ids.length === 0) {
    throw new AppError('Selected team not found in this clinic', 404, 'NOT_FOUND');
  }
  return ids;
}

function applyEpisodeScope(
  query: Knex.QueryBuilder,
  ctx: AdminReportResolvedContext,
  episodeAlias: string,
  options?: { openAtAsOf?: boolean; bindAsOf?: Date },
): void {
  query.where(`${episodeAlias}.clinic_id`, ctx.clinicId).whereNull(`${episodeAlias}.deleted_at`);
  if (ctx.teamIds.length > 0) {
    query.whereIn(`${episodeAlias}.team_id`, ctx.teamIds);
  }
  if (ctx.filters.clinicianId) {
    query.andWhereRaw(
      caseloadAssignmentPredicateForBoundStaff(episodeAlias),
      caseloadAssignmentBindingsForBoundStaff(ctx.filters.clinicianId),
    );
  }
  if (options?.openAtAsOf) {
    const asOf = options.bindAsOf ?? ctx.asOf;
    query
      .whereIn(`${episodeAlias}.status`, [...OPEN_CASELOAD_EPISODE_STATUSES])
      .where(`${episodeAlias}.start_date`, '<=', asOf)
      .andWhere(function () {
        this.whereNull(`${episodeAlias}.end_date`).orWhere(`${episodeAlias}.end_date`, '>=', asOf);
      });
  }
}

function scopedPatientIdsQuery(ctx: AdminReportResolvedContext, asOf?: Date): Knex.QueryBuilder {
  const query = db('episodes as e').distinct('e.patient_id');
  applyEpisodeScope(query, ctx, 'e', {
    openAtAsOf: Boolean(asOf),
    bindAsOf: asOf,
  });
  return query;
}

function applyPatientScope(
  query: Knex.QueryBuilder,
  patientColumn: string,
  ctx: AdminReportResolvedContext,
  asOf?: Date,
): void {
  if (!ctx.filters.teamId && !ctx.filters.clinicianId) return;
  query.whereIn(patientColumn, scopedPatientIdsQuery(ctx, asOf ?? ctx.asOf));
}

function orWhereTeamNameLike(query: Knex.QueryBuilder, pattern: string): void {
  query.orWhereExists(function () {
    this.select(db.raw('1'))
      .from('org_units as ou')
      .whereRaw('ou.id = e.team_id')
      .whereRaw('ou.clinic_id = e.clinic_id')
      .whereRaw("COALESCE(ou.name, '') ILIKE ?", [pattern]);
  });
}

function toDetailRow(row: DetailCandidateRow): AdminReportDetailRow {
  return {
    patientId: row.patient_id,
    urNumber: row.emr_number ?? null,
    patientName: `${row.given_name} ${row.family_name}`.trim(),
    dateOfBirth: isoDate(row.date_of_birth),
    team: row.team_name ?? null,
    clinician: row.clinician_name ?? null,
    refSource: row.ref_source ?? null,
    refDate: isoDate(row.ref_date),
    urgency: row.urgency ?? null,
    status: row.status ?? null,
    dueDate: isoDate(row.due_date),
    note: row.note ?? null,
  };
}

function metricLabel(metricKey: AdminReportMetricKey): string {
  const meta = ADMIN_REPORT_METRIC_META.find((entry) => entry.key === metricKey);
  return meta?.label ?? metricKey;
}

function firstDayOfIsoWeek(input: Date): Date {
  const date = startOfDay(input);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function buildBuckets(
  from: Date,
  to: Date,
  granularity: AdminReportTrendGranularity,
): Array<{ start: Date; end: Date }> {
  const buckets: Array<{ start: Date; end: Date }> = [];
  if (from > to) return buckets;
  if (granularity === 'day') {
    for (let cursor = startOfDay(from); cursor <= to; cursor = addDays(cursor, 1)) {
      const start = cursor;
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
      buckets.push({ start, end: end > to ? to : end });
    }
    return buckets;
  }
  if (granularity === 'week') {
    for (let cursor = firstDayOfIsoWeek(from); cursor <= to; cursor = addDays(cursor, 7)) {
      const start = cursor;
      const end = addDays(cursor, 6);
      buckets.push({ start, end: end > to ? to : end });
    }
    return buckets;
  }
  for (
    let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    cursor <= to;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    const start = cursor;
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    buckets.push({ start, end: end > to ? to : end });
  }
  return buckets;
}

function withBasePatientColumns(
  query: Knex.QueryBuilder,
  options?: { includeTeam?: boolean; includeClinician?: boolean },
): Knex.QueryBuilder {
  query.select(
    'p.id as patient_id',
    'p.emr_number',
    'p.given_name',
    'p.family_name',
    'p.date_of_birth',
  );
  if (options?.includeTeam) {
    query.select(
      db.raw(
        "NULLIF((SELECT ou.name FROM org_units as ou WHERE ou.id = e.team_id AND ou.clinic_id = e.clinic_id LIMIT 1), '') as team_name",
      ),
    );
  }
  if (options?.includeClinician) {
    query.select(
      db.raw("NULLIF(TRIM(COALESCE(s.given_name, '') || ' ' || COALESCE(s.family_name, '')), '') as clinician_name"),
    );
  }
  return query;
}

async function detailRowsForMetric(
  metricKey: AdminReportMetricKey,
  ctx: AdminReportResolvedContext,
  options?: { limit?: number; from?: Date; to?: Date; asOf?: Date },
): Promise<DetailCandidateRow[]> {
  const limit = options?.limit ?? DEFAULT_DETAIL_LIMIT;
  const from = options?.from ?? ctx.from;
  const to = options?.to ?? ctx.to;
  const asOf = options?.asOf ?? ctx.asOf;
  const next30 = addDays(asOf, 30);
  const last7 = addDays(asOf, -7);
  const kcCutoff = addDays(asOf, -28);
  const jmoCutoff = addDays(asOf, -30);
  const consultantCutoff = addDays(asOf, -90);
  const review91Cutoff = addDays(asOf, -91);

  switch (metricKey) {
    case 'total_consumers': {
      const query = db('patients as p')
        .where({ 'p.clinic_id': ctx.clinicId, 'p.status': 'active' })
        .whereNull('p.deleted_at')
        .orderBy(['p.family_name', 'p.given_name'])
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      return withBasePatientColumns(query);
    }
    case 'new_consumer': {
      const query = db('patients as p')
        .where({ 'p.clinic_id': ctx.clinicId })
        .whereNull('p.deleted_at')
        .whereBetween('p.created_at', [from, to])
        .orderBy('p.created_at', 'desc')
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select(db.raw("'new registration' as note"));
      return withBasePatientColumns(query);
    }
    case 'transfer_to_outpatients': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .where('e.status', 'closed')
        .whereBetween('e.end_date', [from, to])
        .where(function () {
          this.whereRaw("COALESCE(e.closure_reason, '') ILIKE '%outpatient%'");
          orWhereTeamNameLike(this, '%out%patient%');
          this.orWhereRaw("COALESCE(e.episode_type, '') ILIKE 'outpatient'");
        })
        .orderBy('e.end_date', 'desc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e');
      query.select('e.end_date as ref_date', 'e.status', 'e.closure_reason as note');
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'transfer_to_acis': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .whereBetween('e.start_date', [from, to])
        .where(function () {
          this.whereRaw("COALESCE(e.episode_type, '') ILIKE 'acis'");
          orWhereTeamNameLike(this, '%acis%');
        })
        .orderBy('e.start_date', 'desc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e');
      query.select('e.start_date as ref_date', 'e.status', db.raw("'Transferred to ACIS' as note"));
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'currently_admitted': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .where(function () {
          this.whereRaw("COALESCE(e.episode_type, '') ILIKE 'inpatient'");
          orWhereTeamNameLike(this, '%ipu%');
          orWhereTeamNameLike(this, '%ccu%');
          orWhereTeamNameLike(this, '%inpatient%');
        })
        .orderBy('e.start_date', 'desc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e', { openAtAsOf: true, bindAsOf: asOf });
      query.select('e.start_date as ref_date', 'e.status');
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'currently_in_parcs': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .whereExists(function () {
          this.select(db.raw('1'))
            .from('org_units as ou')
            .whereRaw('ou.id = e.team_id')
            .whereRaw('ou.clinic_id = e.clinic_id')
            .whereRaw("COALESCE(ou.name, '') ILIKE '%parc%'");
        })
        .orderBy('e.start_date', 'desc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e', { openAtAsOf: true, bindAsOf: asOf });
      query.select('e.start_date as ref_date', 'e.status');
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'discharged_from_cct': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .where('e.status', 'closed')
        .whereBetween('e.end_date', [from, to])
        .where(function () {
          this.whereExists(function () {
            this.select(db.raw('1'))
              .from('org_units as ou')
              .whereRaw('ou.id = e.team_id')
              .whereRaw('ou.clinic_id = e.clinic_id')
              .whereRaw("COALESCE(ou.name, '') ILIKE 'cct%'");
          }).orWhereRaw("COALESCE(e.closure_reason, '') ILIKE '%cct%'");
        })
        .orderBy('e.end_date', 'desc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e');
      query.select('e.end_date as ref_date', 'e.status', 'e.closure_reason as note');
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'discharged_from_ipu': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .where('e.status', 'closed')
        .whereBetween('e.end_date', [from, to])
        .where(function () {
          this.whereRaw("COALESCE(e.episode_type, '') ILIKE 'inpatient'");
          orWhereTeamNameLike(this, '%ipu%');
          orWhereTeamNameLike(this, '%ccu%');
          this.orWhereRaw("COALESCE(e.closure_reason, '') ILIKE '%ipu%'");
        })
        .orderBy('e.end_date', 'desc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e');
      query.select('e.end_date as ref_date', 'e.status', 'e.closure_reason as note');
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'discharged_from_parcs': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .where('e.status', 'closed')
        .whereBetween('e.end_date', [from, to])
        .where(function () {
          this.whereExists(function () {
            this.select(db.raw('1'))
              .from('org_units as ou')
              .whereRaw('ou.id = e.team_id')
              .whereRaw('ou.clinic_id = e.clinic_id')
              .whereRaw("COALESCE(ou.name, '') ILIKE '%parc%'");
          }).orWhereRaw("COALESCE(e.closure_reason, '') ILIKE '%parc%'");
        })
        .orderBy('e.end_date', 'desc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e');
      query.select('e.end_date as ref_date', 'e.status', 'e.closure_reason as note');
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'on_single_lai':
    case 'on_multiple_lai':
    case 'total_lai_consumer': {
      const summary = db('lai_schedules as ls')
        .select('ls.patient_id')
        .count<{ patient_id: string; lai_count: string }[]>('ls.id as lai_count')
        .where('ls.clinic_id', ctx.clinicId)
        .whereNull('ls.deleted_at')
        .where('ls.start_date', '<=', asOf)
        .where(function () {
          this.whereNull('ls.end_date').orWhere('ls.end_date', '>=', asOf);
        })
        .groupBy('ls.patient_id')
        .as('lai');
      const query = db(summary)
        .join('patients as p', 'p.id', 'lai.patient_id')
        .where({ 'p.clinic_id': ctx.clinicId })
        .whereNull('p.deleted_at')
        .orderBy(['p.family_name', 'p.given_name'])
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      if (metricKey === 'on_single_lai') query.whereRaw('lai.lai_count::int = 1');
      if (metricKey === 'on_multiple_lai') query.whereRaw('lai.lai_count::int > 1');
      query.select('lai.lai_count as note');
      return withBasePatientColumns(query);
    }
    case 'total_on_mha':
    case 'upcoming_mha_review':
    case 'upcoming_mha_application': {
      const query = db('patient_legal_orders as lo')
        .join('patients as p', 'p.id', 'lo.patient_id')
        .where('lo.clinic_id', ctx.clinicId)
        .where('lo.status', 'active')
        .where('lo.start_date', '<=', asOf)
        .where(function () {
          this.whereNull('lo.end_date').orWhere('lo.end_date', '>=', asOf);
        })
        .orderBy('lo.review_date', 'asc')
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      if (metricKey === 'upcoming_mha_review') {
        query.whereBetween('lo.review_date', [asOf, next30]);
      }
      if (metricKey === 'upcoming_mha_application') {
        query.whereBetween('lo.next_application_date', [asOf, next30]);
      }
      query.select(
        'lo.status',
        db.raw("COALESCE(lo.review_date, lo.next_application_date) as due_date"),
        db.raw("COALESCE(lo.order_number, 'MHA Order') as note"),
      );
      return withBasePatientColumns(query);
    }
    case 'upcoming_tribunal_hearing': {
      const query = db('mha_reviews as mr')
        .join('patients as p', 'p.id', 'mr.patient_id')
        .where('mr.clinic_id', ctx.clinicId)
        .whereNull('mr.deleted_at')
        .whereBetween('mr.review_date', [asOf, next30])
        .whereRaw("COALESCE(mr.review_type, '') ILIKE '%tribunal%'")
        .orderBy('mr.review_date', 'asc')
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select('mr.review_type as status', 'mr.review_date as due_date', db.raw("'Tribunal hearing' as note"));
      return withBasePatientColumns(query);
    }
    case 'dna_last_week': {
      const query = db('appointments as a')
        .join('patients as p', 'p.id', 'a.patient_id')
        .where('a.clinic_id', ctx.clinicId)
        .whereNull('a.deleted_at')
        .where('a.status', 'no_show')
        .whereBetween('a.appointment_start', [last7, asOf])
        .orderBy('a.appointment_start', 'desc')
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select('a.status', 'a.appointment_start as due_date', db.raw("COALESCE(a.appointment_type, 'Appointment') as note"));
      return withBasePatientColumns(query);
    }
    case 'number_of_clozapine': {
      const query = db('clozapine_registrations as cr')
        .join('patients as p', 'p.id', 'cr.patient_id')
        .where('cr.clinic_id', ctx.clinicId)
        .whereNull('cr.deleted_at')
        .where('cr.registration_date', '<=', asOf)
        .where(function () {
          this.whereNull('cr.ceased_date').orWhere('cr.ceased_date', '>=', asOf);
        })
        .orderBy('cr.registration_date', 'desc')
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select('cr.next_blood_due_date as due_date', db.raw("'Clozapine monitoring active' as note"), db.raw("'active' as status"));
      return withBasePatientColumns(query);
    }
    case 'overdue_kc_review': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.key_worker_id')
        .whereNull('e.deleted_at')
        .whereNotNull('e.key_worker_id')
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('clinical_notes as cn')
            .whereRaw('cn.patient_id = e.patient_id')
            .whereRaw('cn.author_id = e.key_worker_id')
            .whereNull('cn.deleted_at')
            .where('cn.status', 'signed')
            .where('cn.created_at', '>=', kcCutoff)
            .where('cn.created_at', '<=', asOf);
        })
        .orderBy('e.start_date', 'asc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e', { openAtAsOf: true, bindAsOf: asOf });
      query.select(
        db.raw("'overdue' as status"),
        db.raw('?::date as due_date', [kcCutoff]),
        db.raw("'No key clinician note in last 28 days' as note"),
      );
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'overdue_jmo_review': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('clinical_notes as cn')
            .join('staff_role_assignments as sra', function () {
              this.on('sra.staff_id', 'cn.author_id').andOn('sra.clinic_id', 'cn.clinic_id');
            })
            .join('clinical_roles as cr', function () {
              this.on('cr.id', 'sra.clinical_role_id').andOn('cr.clinic_id', 'cn.clinic_id');
            })
            .whereRaw('cn.patient_id = e.patient_id')
            .whereRaw('cn.clinic_id = e.clinic_id')
            .whereNull('cn.deleted_at')
            .where('cn.status', 'signed')
            .where('sra.is_active', true)
            .where(function () {
              for (const pattern of JMO_ROLE_PATTERNS) this.orWhereRaw('cr.name ILIKE ?', [pattern]);
            })
            .where('cn.created_at', '>=', jmoCutoff)
            .where('cn.created_at', '<=', asOf);
        })
        .orderBy('e.start_date', 'asc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e', { openAtAsOf: true, bindAsOf: asOf });
      query.select(
        db.raw('NULL::text as clinician_name'),
        db.raw("'overdue' as status"),
        db.raw('?::date as due_date', [jmoCutoff]),
        db.raw("'No junior medical review in last 30 days' as note"),
      );
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'overdue_consultant_review': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('clinical_notes as cn')
            .join('staff_role_assignments as sra', function () {
              this.on('sra.staff_id', 'cn.author_id').andOn('sra.clinic_id', 'cn.clinic_id');
            })
            .join('clinical_roles as cr', function () {
              this.on('cr.id', 'sra.clinical_role_id').andOn('cr.clinic_id', 'cn.clinic_id');
            })
            .whereRaw('cn.patient_id = e.patient_id')
            .whereRaw('cn.clinic_id = e.clinic_id')
            .whereNull('cn.deleted_at')
            .where('cn.status', 'signed')
            .where('sra.is_active', true)
            .where(function () {
              for (const pattern of CONSULTANT_ROLE_PATTERNS) this.orWhereRaw('cr.name ILIKE ?', [pattern]);
            })
            .where('cn.created_at', '>=', consultantCutoff)
            .where('cn.created_at', '<=', asOf);
        })
        .orderBy('e.start_date', 'asc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e', { openAtAsOf: true, bindAsOf: asOf });
      query.select(
        db.raw('NULL::text as clinician_name'),
        db.raw("'overdue' as status"),
        db.raw('?::date as due_date', [consultantCutoff]),
        db.raw("'No consultant psychiatrist review in last 90 days' as note"),
      );
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'overdue_91d_review': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .whereRaw("e.start_date < ?::date - INTERVAL '91 days'", [asOf])
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('clinical_notes as cn')
            .whereRaw('cn.patient_id = e.patient_id')
            .whereRaw('cn.clinic_id = e.clinic_id')
            .whereNull('cn.deleted_at')
            .where('cn.status', 'signed')
            .where(function () {
              this.where('cn.note_category', '91-day-review')
                .orWhereRaw("COALESCE(cn.title,'') ILIKE '%91%day%review%'")
                .orWhereRaw("COALESCE(cn.content::text,'') ILIKE '%91_day_review%'");
            })
            .where('cn.created_at', '>=', review91Cutoff)
            .where('cn.created_at', '<=', asOf);
        })
        .orderBy('e.start_date', 'asc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e', { openAtAsOf: true, bindAsOf: asOf });
      query.select(
        db.raw("'overdue' as status"),
        db.raw('(e.start_date + INTERVAL \'91 days\')::date as due_date'),
        db.raw("'No 91-day review note recorded in cycle' as note"),
      );
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'overdue_lai': {
      const query = db('lai_schedules as ls')
        .join('patients as p', 'p.id', 'ls.patient_id')
        .where('ls.clinic_id', ctx.clinicId)
        .whereNull('ls.deleted_at')
        .where('ls.start_date', '<=', asOf)
        .where(function () {
          this.whereNull('ls.end_date').orWhere('ls.end_date', '>=', asOf);
        })
        .whereNotNull('ls.next_due_date')
        .where('ls.next_due_date', '<', asOf)
        .orderBy('ls.next_due_date', 'asc')
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select('ls.next_due_date as due_date', db.raw("'overdue' as status"), db.raw("COALESCE(ls.drug_name, 'LAI') as note"));
      return withBasePatientColumns(query);
    }
    case 'incomplete_craam': {
      const query = db('patients as p')
        .where('p.clinic_id', ctx.clinicId)
        .whereNull('p.deleted_at')
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('risk_assessments as ra')
            .whereRaw('ra.patient_id = p.id')
            .whereRaw('ra.clinic_id = p.clinic_id')
            .whereNull('ra.deleted_at')
            .where(function () {
              this.whereRaw("COALESCE(ra.assessment_type, '') ILIKE '%craam%'")
                .orWhereRaw("COALESCE(ra.assessment_type, '') ILIKE '%c-ssrs%'");
            })
            .where('ra.assessment_date', '>=', review91Cutoff);
        })
        .orderBy(['p.family_name', 'p.given_name'])
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select(db.raw("'No CRAAM/C-SSRS assessment in last 91 days' as note"), db.raw("'incomplete' as status"));
      return withBasePatientColumns(query);
    }
    case 'incomplete_registration_form': {
      const query = db('patients as p')
        .where('p.clinic_id', ctx.clinicId)
        .whereNull('p.deleted_at')
        .andWhere(function () {
          this.whereRaw("COALESCE(TRIM(p.given_name), '') = ''")
            .orWhereRaw("COALESCE(TRIM(p.family_name), '') = ''")
            .orWhereNull('p.date_of_birth')
            .orWhereRaw("COALESCE(TRIM(p.phone_mobile), '') = '' AND COALESCE(TRIM(p.phone_home), '') = ''")
            .orWhereRaw("COALESCE(TRIM(p.emergency_contact_name), '') = ''")
            .orWhereRaw("COALESCE(TRIM(p.emergency_contact_phone), '') = ''");
        })
        .orderBy(['p.family_name', 'p.given_name'])
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select(db.raw("'Missing mandatory registration fields' as note"), db.raw("'incomplete' as status"));
      return withBasePatientColumns(query);
    }
    case 'incomplete_recovery_plan': {
      const query = db('episodes as e')
        .join('patients as p', 'p.id', 'e.patient_id')
        .leftJoin('staff as s', 's.id', 'e.primary_clinician_id')
        .whereNull('e.deleted_at')
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('care_plans as cp')
            .whereRaw('cp.patient_id = e.patient_id')
            .whereRaw('cp.clinic_id = e.clinic_id')
            .whereNull('cp.deleted_at')
            .whereRaw("COALESCE(cp.status, 'active') IN ('active','in_progress')");
        })
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('treatment_plans as tp')
            .whereRaw('tp.patient_id = e.patient_id')
            .whereRaw('tp.clinic_id = e.clinic_id')
            .whereRaw("COALESCE(tp.status, 'active') IN ('active','in_progress')");
        })
        .orderBy('e.start_date', 'asc')
        .limit(limit);
      applyEpisodeScope(query, ctx, 'e', { openAtAsOf: true, bindAsOf: asOf });
      query.select(db.raw("'No active care or treatment plan recorded' as note"), db.raw("'incomplete' as status"));
      return withBasePatientColumns(query, { includeTeam: true, includeClinician: true });
    }
    case 'incomplete_gp_pp_contact': {
      const query = db('patients as p')
        .where('p.clinic_id', ctx.clinicId)
        .whereNull('p.deleted_at')
        .where(function () {
          this.whereRaw("COALESCE(TRIM(p.gp_name), '') = ''")
            .orWhereNotExists(function () {
              this.select(db.raw('1'))
                .from('patient_providers as pp')
                .whereRaw('pp.patient_id = p.id')
                .whereRaw('pp.clinic_id = p.clinic_id')
                .where(function () {
                  this.whereRaw("COALESCE(pp.provider_type, '') ILIKE 'gp%'")
                    .orWhereRaw("COALESCE(pp.provider_type, '') ILIKE 'general%'")
                    .orWhereRaw("COALESCE(pp.provider_type, '') ILIKE '%primary%'");
                })
                .where(function () {
                  this.whereRaw("COALESCE(TRIM(pp.provider_phone), '') <> ''")
                    .orWhereRaw("COALESCE(TRIM(pp.provider_email), '') <> ''");
                });
            });
        })
        .orderBy(['p.family_name', 'p.given_name'])
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select(db.raw("'Missing GP/primary provider contact details' as note"), db.raw("'incomplete' as status"));
      return withBasePatientColumns(query);
    }
    case 'incomplete_family_contact': {
      const query = db('patients as p')
        .where('p.clinic_id', ctx.clinicId)
        .whereNull('p.deleted_at')
        .whereNotExists(function () {
          this.select(db.raw('1'))
            .from('patient_contacts as pc')
            .whereRaw('pc.patient_id = p.id')
            .whereRaw('pc.clinic_id = p.clinic_id')
            .whereNull('pc.deleted_at')
            .andWhere(function () {
              this.where('pc.is_carer', true)
                .orWhere('pc.is_emergency_contact', true)
                .orWhereRaw("COALESCE(pc.relationship, '') ILIKE ANY (ARRAY['%family%','%mother%','%father%','%sister%','%brother%','%partner%'])");
            })
            .andWhere(function () {
              this.whereRaw("COALESCE(TRIM(pc.phone_mobile), '') <> ''")
                .orWhereRaw("COALESCE(TRIM(pc.phone_home), '') <> ''")
                .orWhereRaw("COALESCE(TRIM(pc.email), '') <> ''");
            });
        })
        .orderBy(['p.family_name', 'p.given_name'])
        .limit(limit);
      applyPatientScope(query, 'p.id', ctx, asOf);
      query.select(db.raw("'No family/carer contact recorded' as note"), db.raw("'incomplete' as status"));
      return withBasePatientColumns(query);
    }
    default:
      return [];
  }
}

async function countForMetric(
  metricKey: AdminReportMetricKey,
  ctx: AdminReportResolvedContext,
  options?: { from?: Date; to?: Date; asOf?: Date },
): Promise<number> {
  const rows = await detailRowsForMetric(metricKey, ctx, {
    limit: 100000,
    from: options?.from,
    to: options?.to,
    asOf: options?.asOf,
  });
  return rows.length;
}

export async function resolveAdminReportContext(
  clinicId: string,
  filters: AdminReportFilters,
): Promise<AdminReportResolvedContext> {
  const { from, to } = resolvePeriodWindow(filters);
  const teamIds = await resolveTeamScope(clinicId, filters.teamId);
  return {
    clinicId,
    filters,
    from,
    to,
    asOf: to,
    teamIds,
  };
}

export async function getAdminReportOverview(
  ctx: AdminReportResolvedContext,
): Promise<AdminReportOverviewCard[]> {
  const cards: AdminReportOverviewCard[] = [];
  for (const metric of ADMIN_REPORT_METRIC_META) {
    const count = await countForMetric(metric.key, ctx);
    cards.push({
      key: metric.key,
      label: metric.label,
      group: metric.group,
      count,
    });
  }
  return cards;
}

export async function getAdminReportDetails(
  ctx: AdminReportResolvedContext,
  metricKey: AdminReportMetricKey,
  limit = DEFAULT_DETAIL_LIMIT,
): Promise<{ metricLabel: string; total: number; rows: AdminReportDetailRow[] }> {
  const rows = await detailRowsForMetric(metricKey, ctx, { limit });
  const total = await countForMetric(metricKey, ctx);
  return {
    metricLabel: metricLabel(metricKey),
    total,
    rows: rows.map(toDetailRow),
  };
}

export async function getAdminReportTrends(
  ctx: AdminReportResolvedContext,
  metrics: AdminReportMetricKey[],
  granularity: AdminReportTrendGranularity,
): Promise<AdminReportTrendSeries[]> {
  const buckets = buildBuckets(ctx.from, ctx.to, granularity);
  const series: AdminReportTrendSeries[] = [];

  for (const metricKey of metrics) {
    const mode = METRIC_TIME_MODE[metricKey];
    const points = [];
    for (const bucket of buckets) {
      const count =
        mode === 'event'
          ? await countForMetric(metricKey, ctx, { from: bucket.start, to: bucket.end, asOf: bucket.end })
          : await countForMetric(metricKey, ctx, { asOf: bucket.end });
      points.push({
        bucketStart: isoDate(bucket.start)!,
        bucketEnd: isoDate(bucket.end)!,
        count,
      });
    }
    series.push({
      metricKey,
      metricLabel: metricLabel(metricKey),
      points,
    });
  }

  return series;
}

export function parseMetricsCsv(raw: string | undefined): AdminReportMetricKey[] {
  if (!raw || raw.trim().length === 0) {
    return [ADMIN_REPORT_METRIC_META[0].key];
  }
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const deduped = [...new Set(parts)];
  const keys: AdminReportMetricKey[] = [];
  for (const item of deduped) {
    const parsed = AdminReportMetricKeySchema.safeParse(item);
    if (!parsed.success) {
      throw new AppError(`Invalid metric key '${item}'`, 400, 'VALIDATION_ERROR');
    }
    keys.push(parsed.data);
  }
  if (keys.length === 0) {
    return [ADMIN_REPORT_METRIC_META[0].key];
  }
  return keys;
}

export function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${(value == null ? '' : String(value)).replace(/"/g, '""')}"`;
  const lines = [
    keys.join(','),
    ...rows.map((row) => keys.map((key) => escape(row[key])).join(',')),
  ];
  return lines.join('\r\n');
}

export function buildPdfText(title: string, rows: Array<Record<string, unknown>>): string {
  const header = [
    'Signacare EMR Report',
    title,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];
  const body = buildCsv(rows);
  return [...header, body].join('\n');
}

export function metricsMetadata(): typeof ADMIN_REPORT_METRIC_META {
  return ADMIN_REPORT_METRIC_META;
}
