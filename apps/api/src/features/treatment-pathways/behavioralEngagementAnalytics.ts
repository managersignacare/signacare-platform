import type {
  AuthContext,
  EscalationSlaBoardResponse,
  FrictionRadarResponse,
  RecoveryStreakSummary,
} from '@signacare/shared';
import { OPEN_TASK_STATUSES } from '@signacare/shared';
import { db } from '../../db/db';
import type { PatientRoutineEventsRow } from '../../db/types/patient_routine_events';

function taskSlaHours(priority: string): number {
  if (priority === 'urgent') return 4;
  if (priority === 'high') return 12;
  if (priority === 'medium') return 24;
  return 48;
}

function referralSlaHours(urgency: string): number {
  if (urgency === 'urgent') return 24;
  if (urgency === 'high') return 48;
  return 72;
}

type ReferralSlaRow = {
  id: string;
  patient_id: string | null;
  reason: string | null;
  assigned_to_staff_id: string | null;
  status: string;
  urgency: string;
  created_at: Date | string;
  ocr_extracted: unknown;
};

type ReferralSlaResponseRow = {
  id: string;
  patientId: string | null;
  title: string;
  ownerStaffId: string | null;
  status: string;
  urgency: string;
  openedAtIso: string;
};

function extractReferralReasonFromOcr(ocrExtracted: unknown): string | null {
  if (!ocrExtracted || typeof ocrExtracted !== 'object') return null;
  const record = ocrExtracted as Record<string, unknown>;
  const candidateKeys = ['reason', 'presentingProblem', 'presenting_problem', 'summary'] as const;
  for (const key of candidateKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function referralSlaRowToResponse(row: ReferralSlaRow): ReferralSlaResponseRow {
  const openedAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
  const reason = typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : null;
  const ocrReason = extractReferralReasonFromOcr(row.ocr_extracted);
  return {
    id: String(row.id),
    patientId: row.patient_id ? String(row.patient_id) : null,
    title: reason ?? ocrReason ?? 'Referral',
    ownerStaffId: row.assigned_to_staff_id ? String(row.assigned_to_staff_id) : null,
    status: String(row.status),
    urgency: String(row.urgency),
    openedAtIso: openedAt.toISOString(),
  };
}

export async function getRecoveryStreakSummary(
  auth: AuthContext,
  patientId: string,
): Promise<RecoveryStreakSummary> {
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const rows = await db<PatientRoutineEventsRow>('patient_routine_events')
    .where({ clinic_id: auth.clinicId, patient_id: patientId })
    .where('occurred_at', '>=', since)
    .orderBy('occurred_at', 'desc')
    .select('event_type', 'occurred_at');

  const trackedEventTypes = [
    'medication_taken',
    'sleep_logged',
    'journal_completed',
    'walk_done',
    'module_opened',
  ] as const;

  const items = trackedEventTypes.map((eventType) => {
    const matches = rows.filter((row) => String(row['event_type']) === eventType);
    const byDay = new Set(
      matches.map((row) => {
        const dt = new Date(String(row['occurred_at']));
        return dt.toISOString().slice(0, 10);
      }),
    );

    const countConsecutiveDaysFrom = (start: Date): number => {
      const cursor = new Date(start);
      let count = 0;
      // Keep bounded for lint safety and deterministic runtime.
      for (let index = 0; index < 366; index += 1) {
        const key = cursor.toISOString().slice(0, 10);
        if (!byDay.has(key)) break;
        count += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return count;
    };

    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);

    let streak = 0;
    if (byDay.has(todayKey)) {
      streak = countConsecutiveDaysFrom(today);
    } else if (byDay.has(yesterdayKey)) {
      streak = countConsecutiveDaysFrom(yesterday);
    }

    const latest = matches[0];
    const lastCompletedAt = latest
      ? new Date(String(latest['occurred_at'])).toISOString()
      : null;
    return {
      eventType,
      currentStreakDays: streak,
      lastCompletedAt,
    };
  });

  return {
    patientId,
    generatedAt: new Date().toISOString(),
    items,
  };
}

export async function getFrictionRadar(
  auth: AuthContext,
  patientId: string,
): Promise<FrictionRadarResponse> {
  const now = new Date();
  const reviewCutoff = now.toISOString().slice(0, 10);

  const overdueContractsCount = await db('patient_behavior_contracts')
    .where({ clinic_id: auth.clinicId, patient_id: patientId, is_active: true })
    .whereNotIn('adherence_status', ['completed'])
    .where('review_date', '<', reviewCutoff)
    .count<{ count: string }[]>('* as count')
    .first();

  const upcomingUnconfirmedAppointments = await db('appointments')
    .where({ clinic_id: auth.clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .whereIn('status', ['scheduled', 'booked', 'pending'])
    .where('start_time', '>=', now)
    .where('start_time', '<=', new Date(now.getTime() + 48 * 60 * 60 * 1000))
    .where((q) => q.whereNull('patient_response').orWhereNot('patient_response', 'confirmed'))
    .count<{ count: string }[]>('* as count')
    .first();

  const openTaskCount = await db('tasks')
    .where({ clinic_id: auth.clinicId, patient_id: patientId })
    .whereIn('status', OPEN_TASK_STATUSES as readonly string[])
    .count<{ count: string }[]>('* as count')
    .first();

  const pendingReferrals = await db('referrals')
    .where({ clinic_id: auth.clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .whereNotIn('status', ['closed', 'completed', 'rejected', 'cancelled'])
    .count<{ count: string }[]>('* as count')
    .first();

  const items: FrictionRadarResponse['items'] = [];
  const overdueContracts = Number(overdueContractsCount?.count ?? 0);
  const unconfirmed = Number(upcomingUnconfirmedAppointments?.count ?? 0);
  const openTasks = Number(openTaskCount?.count ?? 0);
  const pending = Number(pendingReferrals?.count ?? 0);

  if (overdueContracts > 0) {
    items.push({
      key: 'contract-review-overdue',
      label: 'Behavior contract review overdue',
      severity: overdueContracts >= 3 ? 'high' : 'moderate',
      count: overdueContracts,
      lastSeenAt: new Date().toISOString(),
      suggestedAction: 'Bring contract review into next contact and update adherence status.',
    });
  }
  if (unconfirmed > 0) {
    items.push({
      key: 'appointment-unconfirmed',
      label: 'Upcoming appointments not confirmed',
      severity: unconfirmed >= 2 ? 'high' : 'moderate',
      count: unconfirmed,
      lastSeenAt: new Date().toISOString(),
      suggestedAction: 'Trigger confirmation outreach workflow and fallback check-in.',
    });
  }
  if (openTasks > 0) {
    items.push({
      key: 'open-clinical-tasks',
      label: 'Open clinical tasks',
      severity: openTasks >= 5 ? 'high' : 'low',
      count: openTasks,
      lastSeenAt: new Date().toISOString(),
      suggestedAction: 'Prioritize unresolved tasks in next team huddle.',
    });
  }
  if (pending > 0) {
    items.push({
      key: 'pending-referral-flow',
      label: 'Referral still in progress',
      severity: pending >= 2 ? 'moderate' : 'low',
      count: pending,
      lastSeenAt: new Date().toISOString(),
      suggestedAction: 'Review referral stage and assign owner if unallocated.',
    });
  }

  return {
    patientId,
    generatedAt: new Date().toISOString(),
    items,
  };
}

export async function getEscalationSlaBoard(auth: AuthContext): Promise<EscalationSlaBoardResponse> {
  const now = new Date();
  const taskRows = await db('tasks')
    .where({ clinic_id: auth.clinicId })
    .whereIn('status', OPEN_TASK_STATUSES as readonly string[])
    .whereIn('priority', ['high', 'urgent'])
    .select('id', 'patient_id', 'title', 'assigned_to_id', 'status', 'priority', 'created_at');

  const referralRows = await db('referrals')
    .where({ clinic_id: auth.clinicId })
    .whereNull('deleted_at')
    .whereNotIn('status', ['closed', 'completed', 'rejected', 'cancelled'])
    .whereIn('urgency', ['high', 'urgent'])
    .select('id', 'patient_id', 'reason', 'assigned_to_staff_id', 'status', 'urgency', 'created_at', 'ocr_extracted');

  const items: EscalationSlaBoardResponse['items'] = [];

  for (const row of taskRows) {
    const openedAt = row['created_at'] instanceof Date
      ? row['created_at']
      : new Date(String(row['created_at']));
    const target = new Date(openedAt.getTime() + taskSlaHours(String(row['priority'])) * 60 * 60 * 1000);
    const warningAt = new Date(target.getTime() - 60 * 60 * 1000);
    const remainingSeconds = Math.floor((target.getTime() - now.getTime()) / 1000);
    items.push({
      queueType: 'task',
      id: String(row['id']),
      patientId: row['patient_id'] ? String(row['patient_id']) : null,
      title: String(row['title']),
      ownerStaffId: row['assigned_to_id'] ? String(row['assigned_to_id']) : null,
      status: String(row['status']),
      priority: String(row['priority']),
      openedAt: openedAt.toISOString(),
      slaTargetAt: target.toISOString(),
      warningAt: warningAt.toISOString(),
      remainingSeconds,
      isBreached: remainingSeconds < 0,
    });
  }

  for (const row of referralRows as ReferralSlaRow[]) {
    const mapped = referralSlaRowToResponse(row);
    const openedAt = new Date(mapped.openedAtIso);
    const target = new Date(openedAt.getTime() + referralSlaHours(mapped.urgency) * 60 * 60 * 1000);
    const warningAt = new Date(target.getTime() - 2 * 60 * 60 * 1000);
    const remainingSeconds = Math.floor((target.getTime() - now.getTime()) / 1000);
    items.push({
      queueType: 'referral',
      id: mapped.id,
      patientId: mapped.patientId,
      title: mapped.title,
      ownerStaffId: mapped.ownerStaffId,
      status: mapped.status,
      priority: mapped.urgency,
      openedAt: mapped.openedAtIso,
      slaTargetAt: target.toISOString(),
      warningAt: warningAt.toISOString(),
      remainingSeconds,
      isBreached: remainingSeconds < 0,
    });
  }

  items.sort((a, b) => a.remainingSeconds - b.remainingSeconds);
  return {
    generatedAt: new Date().toISOString(),
    items,
  };
}
