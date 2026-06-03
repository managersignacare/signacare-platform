import type {
  AuthContext,
  DigitalPhenotypeSnapshot,
  WearableSurveillanceSignal,
  WearableSurveillanceSnapshot,
} from '@signacare/shared';
import { OPEN_TASK_STATUSES } from '@signacare/shared';
import { dbAdmin } from '../../db/db';
import { createTaskInternalAdmin } from '../tasks/taskService';
import { emitClinicalSignal } from '../events/clinicalSignalEmitter';
import { computeTimeInRange } from '../endocrinology/glucoseService';
import logger from '../../utils/logger';

type GlucoseReadingRow = {
  value: unknown;
  unit: unknown;
  measured_at: Date | string;
};

type ArrhythmiaTrackingRow = {
  tracking_type: string;
  value: unknown;
  recorded_at: Date | string;
};

export const TRACKING_TYPE_FOR_GLUCOSE = new Set(['glucose_mgdl', 'glucose_mmoll']);
export const TRACKING_TYPE_FOR_ARRHYTHMIA = new Set([
  'ecg_afib_flag',
  'ecg_afib_burden_pct',
  'ppg_irregular_rhythm_score',
]);

const SURVEILLANCE_DISCLAIMER = 'Wearable surveillance signals are non-diagnostic and require clinician review before any care change.';

const CGM_REVIEW_SCORE_THRESHOLD = 35;
const ARRHYTHMIA_REVIEW_SCORE_THRESHOLD = 45;
const ARRHYTHMIA_HIGH_SCORE_THRESHOLD = 75;

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function surveillanceBandFromScore(score: number): WearableSurveillanceSignal['riskBand'] {
  if (score >= 70) return 'high';
  if (score >= 35) return 'moderate';
  return 'low';
}

function toDateOnly(value: Date): string {
  return value.toISOString().split('T')[0];
}

async function resolveClinicAutomationActor(clinicId: string): Promise<string | null> {
  const clinic = await dbAdmin('clinics')
    .where({ id: clinicId })
    .whereNull('deleted_at')
    .first('nominated_admin_staff_id', 'delegated_admin_staff_id');
  const nominated = clinic?.['nominated_admin_staff_id'];
  if (typeof nominated === 'string' && nominated.length > 0) return nominated;
  const delegated = clinic?.['delegated_admin_staff_id'];
  if (typeof delegated === 'string' && delegated.length > 0) return delegated;

  const fallback = await dbAdmin('staff')
    .where({ clinic_id: clinicId, is_active: true })
    .whereIn('role', ['manager', 'admin', 'superadmin'])
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc')
    .first('id');
  return typeof fallback?.['id'] === 'string' ? fallback['id'] : null;
}

async function resolvePrimaryClinician(clinicId: string, patientId: string): Promise<string | null> {
  const row = await dbAdmin('episodes')
    .where({ clinic_id: clinicId, patient_id: patientId, status: 'open' })
    .whereNull('deleted_at')
    .whereNotNull('primary_clinician_id')
    .orderBy('start_date', 'desc')
    .first('primary_clinician_id');
  const staffId = row?.['primary_clinician_id'];
  return typeof staffId === 'string' && staffId.length > 0 ? staffId : null;
}

async function ensureSurveillanceTask(args: {
  clinicId: string;
  patientId: string;
  actorStaffId: string;
  assignedToId: string | null;
  taskType: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string;
}): Promise<void> {
  const existing = await dbAdmin('tasks')
    .where({
      clinic_id: args.clinicId,
      patient_id: args.patientId,
      task_type: args.taskType,
    })
    .whereIn('status', [...OPEN_TASK_STATUSES] as string[])
    .first('id');
  if (existing) return;

  await createTaskInternalAdmin(args.clinicId, args.actorStaffId, {
    patientId: args.patientId,
    assignedToId: args.assignedToId ?? undefined,
    title: args.title,
    description: args.description,
    priority: args.priority,
    dueDate: args.dueDate,
    taskType: args.taskType,
    status: 'pending',
  });
}

function buildDepressionRelapseSignal(
  latest: DigitalPhenotypeSnapshot | null,
): WearableSurveillanceSignal {
  if (!latest) {
    return {
      domain: 'depression_relapse',
      score: 0,
      riskBand: 'low',
      summary: 'No 7-day digital phenotype snapshot available yet.',
      recommendedAction: 'Continue passive monitoring and review after enough sleep/steps/mood observations are captured.',
      confidence: 0.15,
    };
  }

  const score = clampScore(latest.riskIndex);
  const band = surveillanceBandFromScore(score);
  const summary = [
    `Relapse surveillance score ${score}`,
    `sleep ${latest.sleepHoursAvg7d != null ? latest.sleepHoursAvg7d.toFixed(1) : 'n/a'}h`,
    `steps ${latest.stepsAvg7d != null ? Math.round(latest.stepsAvg7d) : 'n/a'}`,
    `mood ${latest.moodAvg7d != null ? latest.moodAvg7d.toFixed(1) : 'n/a'}`,
    `anxiety ${latest.anxietyAvg7d != null ? latest.anxietyAvg7d.toFixed(1) : 'n/a'}`,
  ].join(' · ');
  return {
    domain: 'depression_relapse',
    score,
    riskBand: band,
    summary,
    recommendedAction: band === 'high'
      ? 'Prioritize clinician review and confirm with direct assessment before any treatment change.'
      : 'Track trend at next review and validate against clinical interview/context.',
    confidence: latest.adherenceScore >= 60 ? 0.72 : 0.45,
  };
}

function buildCgmSignal(rows: GlucoseReadingRow[]): WearableSurveillanceSignal {
  if (rows.length === 0) {
    return {
      domain: 'cgm_variability',
      score: 0,
      riskBand: 'low',
      summary: 'No recent CGM readings captured in the past 72 hours.',
      recommendedAction: 'Confirm CGM device sync and continue routine glucose surveillance.',
      confidence: 0.2,
    };
  }
  const tir = computeTimeInRange(rows
    .map((row) => ({
      value: asNullableNumber(row.value) ?? 0,
      unit: String(row.unit ?? 'mmol/L'),
    }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0));
  const score = clampScore(
    ((100 - tir.inRangePct) * 0.7)
    + (tir.veryHighPct * 0.9)
    + (tir.veryLowPct * 1.2)
    + (tir.lowPct * 0.5),
  );
  const band = surveillanceBandFromScore(score);
  return {
    domain: 'cgm_variability',
    score,
    riskBand: band,
    summary: `CGM 72h time-in-range ${tir.inRangePct.toFixed(1)}% (very high ${tir.veryHighPct.toFixed(1)}%, low ${tir.lowPct.toFixed(1)}%).`,
    recommendedAction: band === 'high'
      ? 'Trigger endocrinology coaching review with a human clinician and verify adherence/context.'
      : 'Continue CGM trend monitoring; escalate if time-in-range drops further.',
    confidence: rows.length >= 24 ? 0.78 : 0.52,
  };
}

function buildArrhythmiaSignal(rows: ArrhythmiaTrackingRow[]): WearableSurveillanceSignal {
  if (rows.length === 0) {
    return {
      domain: 'arrhythmia',
      score: 0,
      riskBand: 'low',
      summary: 'No ECG/PPG arrhythmia telemetry captured in the past 7 days.',
      recommendedAction: 'Continue passive rhythm surveillance where wearable data is available.',
      confidence: 0.18,
    };
  }
  let afibFlag = false;
  let maxBurden = 0;
  const ppgScores: number[] = [];
  for (const row of rows) {
    const value = asNullableNumber(row.value) ?? 0;
    if (row.tracking_type === 'ecg_afib_flag' && value >= 1) afibFlag = true;
    if (row.tracking_type === 'ecg_afib_burden_pct') maxBurden = Math.max(maxBurden, value);
    if (row.tracking_type === 'ppg_irregular_rhythm_score') ppgScores.push(value);
  }
  const avgPpg = ppgScores.length > 0
    ? ppgScores.reduce((sum, value) => sum + value, 0) / ppgScores.length
    : 0;
  const score = clampScore(Math.max(afibFlag ? 100 : 0, maxBurden * 2, avgPpg));
  const band = surveillanceBandFromScore(score);
  return {
    domain: 'arrhythmia',
    score,
    riskBand: band,
    summary: `AFib flag ${afibFlag ? 'present' : 'absent'} · burden ${maxBurden.toFixed(1)}% · PPG irregularity ${avgPpg.toFixed(1)}.`,
    recommendedAction: band === 'high'
      ? 'Trigger cardiology surveillance alert for clinician confirmation (ECG review, clinical correlation).'
      : 'Maintain rhythm surveillance and reassess if burden/irregularity increases.',
    confidence: rows.length >= 5 ? 0.74 : 0.5,
  };
}

async function listRecentCgmReadings(clinicId: string, patientId: string): Promise<GlucoseReadingRow[]> {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const rows = await dbAdmin('glucose_readings')
    .where({
      clinic_id: clinicId,
      patient_id: patientId,
      source: 'cgm',
    })
    .whereNull('deleted_at')
    .where('measured_at', '>=', since)
    .select('value', 'unit', 'measured_at')
    .orderBy('measured_at', 'desc')
    .limit(288);
  return rows as unknown as GlucoseReadingRow[];
}

async function listRecentArrhythmiaTracking(
  clinicId: string,
  patientId: string,
): Promise<ArrhythmiaTrackingRow[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await dbAdmin('patient_tracking')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereIn('tracking_type', [...TRACKING_TYPE_FOR_ARRHYTHMIA])
    .where('recorded_at', '>=', since)
    .select('tracking_type', 'value', 'recorded_at')
    .orderBy('recorded_at', 'desc')
    .limit(500);
  return rows as unknown as ArrhythmiaTrackingRow[];
}

export async function buildWearableSurveillanceSnapshot(auth: AuthContext, args: {
  patientId: string;
  latestPhenotype: DigitalPhenotypeSnapshot | null;
}): Promise<WearableSurveillanceSnapshot> {
  const [cgmRows, arrhythmiaRows] = await Promise.all([
    listRecentCgmReadings(auth.clinicId, args.patientId),
    listRecentArrhythmiaTracking(auth.clinicId, args.patientId),
  ]);

  const signals: WearableSurveillanceSignal[] = [
    buildDepressionRelapseSignal(args.latestPhenotype),
    buildCgmSignal(cgmRows),
    buildArrhythmiaSignal(arrhythmiaRows),
  ];
  return {
    clinicId: auth.clinicId,
    patientId: args.patientId,
    generatedAt: new Date().toISOString(),
    classification: 'surveillance',
    actionability: 'clinical_review_required',
    disclaimer: SURVEILLANCE_DISCLAIMER,
    signals,
  };
}

export async function runSpecialtySurveillanceActions(
  auth: AuthContext,
  patientId: string,
): Promise<void> {
  const [actorStaffId, primaryClinicianId, cgmRows, arrhythmiaRows] = await Promise.all([
    resolveClinicAutomationActor(auth.clinicId),
    resolvePrimaryClinician(auth.clinicId, patientId),
    listRecentCgmReadings(auth.clinicId, patientId),
    listRecentArrhythmiaTracking(auth.clinicId, patientId),
  ]);

  if (!actorStaffId) {
    logger.warn(
      { clinicId: auth.clinicId, patientId },
      'digital surveillance actions skipped: no automation actor could be resolved',
    );
    return;
  }

  const now = new Date();
  const dueSoon = toDateOnly(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const dueImmediate = toDateOnly(now);

  const cgmSignal = buildCgmSignal(cgmRows);
  if (cgmSignal.score >= CGM_REVIEW_SCORE_THRESHOLD) {
    await ensureSurveillanceTask({
      clinicId: auth.clinicId,
      patientId,
      actorStaffId,
      assignedToId: primaryClinicianId,
      taskType: 'digital_care_cgm_coaching',
      title: 'CGM coaching review required',
      description: `${cgmSignal.summary} ${SURVEILLANCE_DISCLAIMER}`,
      priority: cgmSignal.score >= ARRHYTHMIA_HIGH_SCORE_THRESHOLD ? 'high' : 'medium',
      dueDate: dueSoon,
    });
    await emitClinicalSignal({
      clinicId: auth.clinicId,
      userId: primaryClinicianId ?? actorStaffId,
      source: 'workflow',
      signalKey: 'digital_care.cgm_surveillance',
      severity: cgmSignal.score >= ARRHYTHMIA_HIGH_SCORE_THRESHOLD ? 'warning' : 'info',
      category: 'digital_care_surveillance',
      title: 'CGM surveillance needs clinician coaching review',
      body: cgmSignal.summary,
      actionUrl: `/patients/${patientId}?tab=endocrinology`,
      dedupeKey: `surveillance:cgm:${patientId}:${toDateOnly(now)}`,
    });
  }

  const arrhythmiaSignal = buildArrhythmiaSignal(arrhythmiaRows);
  if (arrhythmiaSignal.score >= ARRHYTHMIA_REVIEW_SCORE_THRESHOLD) {
    const isHigh = arrhythmiaSignal.score >= ARRHYTHMIA_HIGH_SCORE_THRESHOLD;
    await ensureSurveillanceTask({
      clinicId: auth.clinicId,
      patientId,
      actorStaffId,
      assignedToId: primaryClinicianId,
      taskType: 'digital_care_arrhythmia_review',
      title: 'AFib surveillance review required',
      description: `${arrhythmiaSignal.summary} ${SURVEILLANCE_DISCLAIMER}`,
      priority: isHigh ? 'urgent' : 'high',
      dueDate: isHigh ? dueImmediate : dueSoon,
    });
    await emitClinicalSignal({
      clinicId: auth.clinicId,
      userId: primaryClinicianId ?? actorStaffId,
      source: 'workflow',
      signalKey: 'digital_care.arrhythmia_surveillance',
      severity: isHigh ? 'critical' : 'warning',
      category: 'digital_care_surveillance',
      title: isHigh
        ? 'High AFib surveillance signal detected'
        : 'Arrhythmia surveillance review required',
      body: arrhythmiaSignal.summary,
      actionUrl: `/patients/${patientId}?tab=clinical-intelligence`,
      dedupeKey: `surveillance:arrhythmia:${patientId}:${toDateOnly(now)}`,
    });
  }
}
