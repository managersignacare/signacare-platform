// apps/api/src/jobs/schedulers/suicidalIdeationAfterHoursScheduler.ts
//
// BUG-581 — suicidal-ideation note created outside clinician shift.
//
// Every 5 minutes, scan recently-created clinical notes and identify
// notes that have a linked high suicide-risk signal (latest
// risk_assessments row with `suicide_risk=true` and
// `overall_risk_level in ('high','very_high')` within the prior 24h).
//
// If the note author is outside their configured availability window,
// notify the on-call psychiatrist. If no on-call psychiatrist can be
// resolved, reassign to clinic admin (nominated/delegated) and write an
// immutable audit row; if even admin is missing, fail-visible with an
// immutable no-recipient audit row.
//
// SCHEDULER ONLY — uses `dbAdmin` per BUG-583 (RLS-closed query/insert
// paths outside request context). Tenant scoping is preserved through
// FK-bound `clinic_id` carried into every emit.

import cron from 'node-cron';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { writeAuditLog } from '../../utils/audit';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SiAfterHoursCandidateRow {
  note_id: string;
  clinic_id: string;
  patient_id: string;
  author_id: string;
  note_type: string;
  note_created_at: string;
  risk_assessment_id: string;
  overall_risk_level: 'high' | 'very_high';
  clinic_timezone: string;
}

/** @schema-drift-exempt partial-shape */
export interface AvailabilityBlockRow {
  clinician_id: string;
  colour: 'red' | 'yellow' | 'green';
  recurrence: 'none' | 'weekly' | 'fortnightly';
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_until: string | null;
  label: string | null;
}

export interface OnCallPsychiatryCandidate {
  staff_id: string;
  role: string;
  discipline: string | null;
  has_psy_specialty: boolean;
  has_psy_role_label: boolean;
}

export interface SiAfterHoursEmitInput {
  clinicId: string;
  userId: string;
  severity: 'critical';
  category: 'risk';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface SiAfterHoursContext {
  listCandidateRows(now: Date): Promise<SiAfterHoursCandidateRow[]>;
  isAuthorWithinShift(row: SiAfterHoursCandidateRow): Promise<boolean>;
  resolveOnCallRecipients(row: SiAfterHoursCandidateRow): Promise<{
    active: string[];
    reassignedToAdmin: string | null;
  }>;
  emit(input: SiAfterHoursEmitInput): Promise<{ ids: string[]; published: boolean }>;
  writeAuditLogRow(input: {
    clinicId: string;
    action:
      | 'SI_AFTER_HOURS_RECIPIENT_REASSIGNED'
      | 'SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE';
    noteId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface SiAfterHoursOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

export interface TimezoneClock {
  dateYmd: string;
  timeHms: string;
  dayOfWeek: number;
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const DEFAULT_CLINIC_TIMEZONE = 'Australia/Melbourne';

// ── Pure helpers ───────────────────────────────────────────────────────────

function parseTimeHmsToSeconds(time: string): number {
  const [hhRaw = '0', mmRaw = '0', ssRaw = '0'] = time.split(':');
  const hh = Number.parseInt(hhRaw, 10);
  const mm = Number.parseInt(mmRaw, 10);
  const ss = Number.parseInt(ssRaw, 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return 0;
  return (hh * 3600) + (mm * 60) + ss;
}

/**
 * Returns true when `localTime` (HH:MM[:SS]) falls within [start, end).
 * Supports overnight windows where start > end.
 */
export function isWithinTimeWindow(
  localTime: string,
  startTime: string,
  endTime: string,
): boolean {
  const at = parseTimeHmsToSeconds(localTime);
  const start = parseTimeHmsToSeconds(startTime);
  const end = parseTimeHmsToSeconds(endTime);

  if (start === end) return true; // 24h block convention
  if (start < end) return at >= start && at < end;
  // Overnight block, e.g. 22:00 -> 06:00
  return at >= start || at < end;
}

export function localClockAt(
  at: Date,
  timezone: string,
): TimezoneClock {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_CLINIC_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
  }

  const parts = formatter.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  const hh = get('hour');
  const mi = get('minute');
  const ss = get('second');
  const weekday = get('weekday');
  const dayOfWeek = WEEKDAY_TO_INDEX[weekday] ?? 0;

  return {
    dateYmd: `${yyyy}-${mm}-${dd}`,
    timeHms: `${hh}:${mi}:${ss}`,
    dayOfWeek,
  };
}

function blockMatchesLocalDate(
  block: AvailabilityBlockRow,
  localDateYmd: string,
  localDow: number,
): boolean {
  if (block.effective_from > localDateYmd) return false;
  if (block.effective_until && block.effective_until < localDateYmd) return false;

  if (block.recurrence === 'weekly') {
    return block.day_of_week === localDow;
  }
  if (block.recurrence === 'fortnightly') {
    if (block.day_of_week !== localDow || block.day_of_week === null) return false;
    const anchor = firstOccurrenceOnOrAfter(block.effective_from, block.day_of_week);
    return isFortnightBoundary(anchor, localDateYmd);
  }
  if (block.recurrence === 'none') {
    return block.specific_date === localDateYmd;
  }
  return false;
}

function firstOccurrenceOnOrAfter(
  isoDate: string,
  targetDayOfWeek: number,
): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  const current = base.getUTCDay();
  const delta = (targetDayOfWeek - current + 7) % 7;
  const out = new Date(base);
  out.setUTCDate(base.getUTCDate() + delta);
  return out.toISOString().slice(0, 10);
}

function isFortnightBoundary(anchorIsoDate: string, candidateIsoDate: string): boolean {
  const anchor = new Date(`${anchorIsoDate}T00:00:00Z`);
  const candidate = new Date(`${candidateIsoDate}T00:00:00Z`);
  const diffDays = Math.floor((candidate.getTime() - anchor.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays % 14 === 0;
}

export function matchingBlocksAt(
  at: Date,
  timezone: string,
  blocks: AvailabilityBlockRow[],
): AvailabilityBlockRow[] {
  const clock = localClockAt(at, timezone);
  return blocks.filter((block) => {
    if (!blockMatchesLocalDate(block, clock.dateYmd, clock.dayOfWeek)) return false;
    return isWithinTimeWindow(clock.timeHms, block.start_time, block.end_time);
  });
}

export function isWithinShiftWindow(
  at: Date,
  timezone: string,
  blocks: AvailabilityBlockRow[],
): boolean {
  const matches = matchingBlocksAt(at, timezone, blocks);
  // red = explicit unavailable; green/yellow = in-shift/available.
  return matches.some((b) => b.colour !== 'red');
}

export function dedupeKeyForAfterHoursSiNote(
  noteId: string,
  staffId: string,
): string {
  return `si-after-hours:${noteId}:${staffId}`;
}

// ── Processor ──────────────────────────────────────────────────────────────

export async function processSuicidalIdeationAfterHoursAlerts(
  now: Date,
  ctx: SiAfterHoursContext,
): Promise<SiAfterHoursOutcome> {
  const out: SiAfterHoursOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: SiAfterHoursCandidateRow[] = [];

  try {
    rows = await ctx.listCandidateRows(now);
  } catch (err) {
    ctx.logger.error(
      { err },
      'suicidalIdeationAfterHoursScheduler top-level listCandidateRows failed',
    );
    return out;
  }

  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'SI_AFTER_HOURS_ZERO_ROWS', tickAt: now.toISOString() },
      'suicidalIdeationAfterHoursScheduler returned zero rows (either no at-risk notes or access-path failure)',
    );
  }

  for (const row of rows) {
    out.processed++;
    try {
      const withinShift = await ctx.isAuthorWithinShift(row);
      if (withinShift) continue;

      const { active, reassignedToAdmin } = await ctx.resolveOnCallRecipients(row);

      if (reassignedToAdmin) {
        ctx.logger.warn(
          {
            kind: 'SI_AFTER_HOURS_RECIPIENT_REASSIGNED_TO_ADMIN',
            noteId: row.note_id,
            clinicId: row.clinic_id,
            adminStaffId: reassignedToAdmin,
            authorId: row.author_id,
            riskAssessmentId: row.risk_assessment_id,
          },
          'SI after-hours alert reassigned to clinic admin (no on-call psychiatrist candidate)',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'SI_AFTER_HOURS_RECIPIENT_REASSIGNED',
          noteId: row.note_id,
          metadata: {
            note_id: row.note_id,
            patient_id: row.patient_id,
            author_id: row.author_id,
            risk_assessment_id: row.risk_assessment_id,
            overall_risk_level: row.overall_risk_level,
            admin_staff_id: reassignedToAdmin,
            reason: 'no_on_call_psychiatrist_available',
            system_actor: 'si-after-hours-scheduler',
          },
        });
      }

      if (active.length === 0) {
        ctx.logger.error(
          {
            kind: 'SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE',
            noteId: row.note_id,
            clinicId: row.clinic_id,
            authorId: row.author_id,
            riskAssessmentId: row.risk_assessment_id,
          },
          'SI after-hours alert had no on-call psychiatrist and no admin fallback; skipped emit',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE',
          noteId: row.note_id,
          metadata: {
            note_id: row.note_id,
            patient_id: row.patient_id,
            author_id: row.author_id,
            risk_assessment_id: row.risk_assessment_id,
            overall_risk_level: row.overall_risk_level,
            reason: 'no_recipient_available',
            system_actor: 'si-after-hours-scheduler',
          },
        });
        continue;
      }

      for (const staffId of active) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity: 'critical',
          category: 'risk',
          title: 'After-hours high suicide-risk note requires immediate review',
          body: 'A clinical note linked to a high suicide-risk assessment was recorded outside the author’s shift window. Please review immediately.',
          actionUrl: `/patients/${row.patient_id}`,
          payload: {
            note_id: row.note_id,
            patient_id: row.patient_id,
            author_id: row.author_id,
            note_type: row.note_type,
            note_created_at: row.note_created_at,
            risk_assessment_id: row.risk_assessment_id,
            overall_risk_level: row.overall_risk_level,
            system_actor: 'si-after-hours-scheduler',
          },
          dedupeKey: dedupeKeyForAfterHoursSiNote(row.note_id, staffId),
        });
        out.emitted++;
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error(
        { err, noteId: row.note_id },
        'suicidalIdeationAfterHoursScheduler row failed',
      );
    }
  }

  return out;
}

// ── Live-context construction ──────────────────────────────────────────────

async function loadAvailabilityBlocks(
  clinicId: string,
  staffIds: string[],
): Promise<AvailabilityBlockRow[]> {
  if (staffIds.length === 0) return [];
  const rows = await dbAdmin('clinician_availability_blocks')
    .where({ clinic_id: clinicId })
    .whereIn('clinician_id', staffIds)
    .whereNull('deleted_at')
    .select(
      'clinician_id',
      'colour',
      'recurrence',
      'day_of_week',
      'specific_date',
      'start_time',
      'end_time',
      'effective_from',
      'effective_until',
      'label',
    );
  return rows as AvailabilityBlockRow[];
}

async function listPsychiatryCandidates(
  clinicId: string,
): Promise<OnCallPsychiatryCandidate[]> {
  const rows = await dbAdmin('staff as s')
    .leftJoin('staff_specialties as ss', function joinSpecialty() {
      this.on('ss.staff_id', '=', 's.id')
        .andOn('ss.clinic_id', '=', 's.clinic_id')
        .andOn('ss.specialty_code', '=', dbAdmin.raw('?', ['psychiatry']))
        .andOnNull('ss.deleted_at');
    })
    .leftJoin('staff_role_assignments as sra', function joinRoleAssignments() {
      this.on('sra.staff_id', '=', 's.id')
        .andOn('sra.clinic_id', '=', 's.clinic_id')
        .andOn('sra.is_active', '=', dbAdmin.raw('?', [true]));
    })
    .leftJoin('clinical_roles as cr', 'cr.id', 'sra.clinical_role_id')
    .where('s.clinic_id', clinicId)
    .where('s.is_active', true)
    .whereNull('s.deleted_at')
    .andWhere((qb) => {
      qb.where('s.role', 'psychiatrist')
        .orWhereRaw("lower(coalesce(s.discipline, '')) like '%psychiat%'")
        .orWhereNotNull('ss.id')
        .orWhereRaw("lower(coalesce(cr.name, '')) like '%psychiat%'");
    })
    .groupBy('s.id', 's.role', 's.discipline')
    .select(
      's.id as staff_id',
      's.role',
      's.discipline',
      dbAdmin.raw('MAX(CASE WHEN ss.id IS NOT NULL THEN 1 ELSE 0 END) = 1 as has_psy_specialty'),
      dbAdmin.raw("MAX(CASE WHEN lower(coalesce(cr.name, '')) like '%psychiat%' THEN 1 ELSE 0 END) = 1 as has_psy_role_label"),
    );
  return rows as OnCallPsychiatryCandidate[];
}

function sortOnCallCandidates(
  rows: Array<OnCallPsychiatryCandidate & { hasOnCallLabel: boolean }>,
): Array<OnCallPsychiatryCandidate & { hasOnCallLabel: boolean }> {
  return [...rows].sort((a, b) => {
    if (a.hasOnCallLabel !== b.hasOnCallLabel) return a.hasOnCallLabel ? -1 : 1;
    if ((a.role === 'psychiatrist') !== (b.role === 'psychiatrist')) return a.role === 'psychiatrist' ? -1 : 1;
    if (a.has_psy_specialty !== b.has_psy_specialty) return a.has_psy_specialty ? -1 : 1;
    if (a.has_psy_role_label !== b.has_psy_role_label) return a.has_psy_role_label ? -1 : 1;
    return a.staff_id.localeCompare(b.staff_id);
  });
}

export async function buildLiveContext(): Promise<SiAfterHoursContext> {
  return {
    async listCandidateRows(now: Date): Promise<SiAfterHoursCandidateRow[]> {
      const since = new Date(now.getTime() - (30 * 60 * 1000));
      const rows = await dbAdmin('clinical_notes as n')
        .join('clinics as c', 'c.id', 'n.clinic_id')
        .joinRaw(`
          JOIN LATERAL (
            SELECT
              r.id AS risk_assessment_id,
              r.overall_risk_level
            FROM risk_assessments AS r
            WHERE r.clinic_id = n.clinic_id
              AND r.patient_id = n.patient_id
              AND r.deleted_at IS NULL
              AND r.suicide_risk = TRUE
              AND r.overall_risk_level IN ('high', 'very_high')
              AND r.created_at <= n.created_at
              AND r.created_at >= (n.created_at - INTERVAL '24 hours')
            ORDER BY r.created_at DESC
            LIMIT 1
          ) AS rs ON TRUE
        `)
        .whereNull('n.deleted_at')
        .whereNotNull('n.author_id')
        .where('n.created_at', '>=', since)
        .select(
          'n.id as note_id',
          'n.clinic_id',
          'n.patient_id',
          'n.author_id',
          'n.note_type',
          'n.created_at as note_created_at',
          'rs.risk_assessment_id',
          dbAdmin.raw(
            "rs.overall_risk_level::text as overall_risk_level",
          ),
          dbAdmin.raw(
            "COALESCE(c.timezone, c.time_zone, ?) as clinic_timezone",
            [DEFAULT_CLINIC_TIMEZONE],
          ),
        );
      return rows as SiAfterHoursCandidateRow[];
    },

    async isAuthorWithinShift(row): Promise<boolean> {
      const blocks = await loadAvailabilityBlocks(row.clinic_id, [row.author_id]);
      const authoredAt = new Date(row.note_created_at);
      const authorBlocks = blocks.filter((b) => b.clinician_id === row.author_id);
      return isWithinShiftWindow(authoredAt, row.clinic_timezone || DEFAULT_CLINIC_TIMEZONE, authorBlocks);
    },

    async resolveOnCallRecipients(row) {
      const authoredAt = new Date(row.note_created_at);
      const timezone = row.clinic_timezone || DEFAULT_CLINIC_TIMEZONE;
      const candidates = (await listPsychiatryCandidates(row.clinic_id))
        .filter((c) => c.staff_id !== row.author_id);

      if (candidates.length > 0) {
        const blocks = await loadAvailabilityBlocks(
          row.clinic_id,
          candidates.map((c) => c.staff_id),
        );
        const available: Array<OnCallPsychiatryCandidate & { hasOnCallLabel: boolean }> = [];
        for (const candidate of candidates) {
          const candidateBlocks = blocks.filter((b) => b.clinician_id === candidate.staff_id);
          const matching = matchingBlocksAt(authoredAt, timezone, candidateBlocks)
            .filter((b) => b.colour !== 'red');
          if (matching.length === 0) continue;
          const hasOnCallLabel = matching.some((b) =>
            typeof b.label === 'string' && /on[- ]?call/i.test(b.label),
          );
          available.push({ ...candidate, hasOnCallLabel });
        }

        const sorted = sortOnCallCandidates(available);
        if (sorted.length > 0) {
          return { active: [sorted[0]!.staff_id], reassignedToAdmin: null };
        }
      }

      const clinic = await dbAdmin('clinics')
        .where({ id: row.clinic_id })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      const adminId = clinic?.nominated_admin_staff_id ?? clinic?.delegated_admin_staff_id ?? null;
      return { active: adminId ? [adminId] : [], reassignedToAdmin: adminId };
    },

    async emit(input) {
      return emitSchedulerSignal({
        clinicId: input.clinicId,
        userId: input.userId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        signalKey: 'suicidal_ideation_after_hours',
      });
    },

    async writeAuditLogRow({ clinicId, action, noteId, metadata }) {
      await writeAuditLog({
        clinicId,
        actorId: 'system:si-after-hours-scheduler',
        action,
        tableName: 'clinical_notes',
        recordId: noteId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

// ── Cron tick ──────────────────────────────────────────────────────────────

const suicidalIdeationAfterHoursTask = cron.schedule('*/5 * * * *', async () => {
  defaultLogger.info('Running SI after-hours note scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processSuicidalIdeationAfterHoursAlerts(new Date(), ctx);
    defaultLogger.info(out, 'SI after-hours note scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'SI after-hours note scheduler failed');
  }
}, { timezone: DEFAULT_CLINIC_TIMEZONE });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:si-after-hours-note',
    priority: 85,
    handler: async () => { suicidalIdeationAfterHoursTask.stop(); },
  });
}

export { suicidalIdeationAfterHoursTask };
