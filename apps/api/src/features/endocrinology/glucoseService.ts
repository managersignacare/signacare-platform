// apps/api/src/features/endocrinology/glucoseService.ts
//
// Multi-specialty Phase 4 — Endocrinology: glucose service.
//
// Provides:
//   - listForPatient (with optional date window)
//   - create (audited)
//   - softDelete (audited)
//   - computeTimeInRange (pure helper, exported for unit tests)
//
// The TIR helper uses ATTD-recommended ranges (mmol/L). Inputs in
// mg/dL are converted on the fly so the histogram is normalised.
import {
  CreateGlucoseReadingDTO,
  GlucoseListFilters,
  GlucoseReadingResponse,
  TimeInRangeSummary,
} from '@signacare/shared';
import { glucoseRepository, GlucoseReadingRowWithRecorder } from './glucoseRepository';
import { HttpError } from '../../shared/errors';
import auditLogService from '../../utils/audit';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function mapRow(row: GlucoseReadingRowWithRecorder): GlucoseReadingResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    value: Number(row.value),
    unit: row.unit as GlucoseReadingResponse['unit'],
    source: row.source as GlucoseReadingResponse['source'],
    mealContext: (row.meal_context ?? null) as GlucoseReadingResponse['mealContext'],
    measuredAt: toIso(row.measured_at)!,
    note: row.note,
    recordedBy: row.recorded_by,
    recordedByName:
      row.recorded_by_given_name && row.recorded_by_family_name
        ? `${row.recorded_by_given_name} ${row.recorded_by_family_name}`
        : null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

/** Convert mg/dL → mmol/L using the canonical 18.0182 divisor. */
function toMmolL(value: number, unit: string): number {
  if (unit === 'mg/dL') return value / 18.0182;
  return value;
}

/**
 * Pure TIR computation. Exported for unit testing — the bands follow
 * the 2019 ATTD international consensus on CGM time-in-range:
 *   Very Low  : < 3.0   mmol/L  (TBR)
 *   Low       : 3.0–3.8 mmol/L  (TBR)
 *   In Range  : 3.9–10.0
 *   High      : 10.1–13.9
 *   Very High : > 13.9
 */
export function computeTimeInRange(
  readings: ReadonlyArray<{ value: number; unit: string }>,
): TimeInRangeSummary {
  const total = readings.length;
  if (total === 0) {
    return {
      totalReadings: 0,
      meanGlucose: null,
      veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0,
      veryLowPct: 0, lowPct: 0, inRangePct: 0, highPct: 0, veryHighPct: 0,
    };
  }

  let veryLow = 0, low = 0, inRange = 0, high = 0, veryHigh = 0;
  let sum = 0;
  for (const r of readings) {
    const mmol = toMmolL(r.value, r.unit);
    sum += mmol;
    if (mmol < 3.0) veryLow++;
    else if (mmol < 3.9) low++;
    else if (mmol <= 10.0) inRange++;
    else if (mmol <= 13.9) high++;
    else veryHigh++;
  }

  const pct = (n: number) => Math.round((n / total) * 1000) / 10; // one-decimal %

  return {
    totalReadings: total,
    meanGlucose: Math.round((sum / total) * 100) / 100,
    veryLow, low, inRange, high, veryHigh,
    veryLowPct: pct(veryLow),
    lowPct: pct(low),
    inRangePct: pct(inRange),
    highPct: pct(high),
    veryHighPct: pct(veryHigh),
  };
}

export class GlucoseService {
  async listForPatient(
    clinicId: string,
    patientId: string,
    filters: GlucoseListFilters,
  ): Promise<GlucoseReadingResponse[]> {
    const rows = await glucoseRepository.listForPatient(clinicId, patientId, {
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      source: filters.source,
      limit: filters.limit,
    });
    return rows.map(mapRow);
  }

  async timeInRange(
    clinicId: string,
    patientId: string,
    filters: GlucoseListFilters,
  ): Promise<TimeInRangeSummary> {
    const rows = await glucoseRepository.listForPatient(clinicId, patientId, {
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      source: filters.source,
      limit: filters.limit ?? 1000,
    });
    return computeTimeInRange(rows.map((r) => ({ value: Number(r.value), unit: r.unit })));
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateGlucoseReadingDTO,
  ): Promise<GlucoseReadingResponse> {
    const created = await glucoseRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      value: dto.value,
      unit: dto.unit,
      source: dto.source,
      meal_context: dto.mealContext ?? null,
      measured_at: new Date(dto.measuredAt),
      recorded_by: actorId,
      note: dto.note ?? null,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'glucose_readings',
      recordId: created.id,
      newData: { value: created.value, unit: created.unit, source: created.source },
    });
    return mapRow(created as GlucoseReadingRowWithRecorder);
  }

  async softDelete(clinicId: string, actorId: string, id: string): Promise<void> {
    // glucoseRepository.softDelete is already tenant-scoped
    // (WHERE clinic_id = ? AND id = ? AND deleted_at IS NULL), so a
    // row in another clinic or an already-deleted row is a no-op.
    // Previous implementation fetched a dummy list against a zero
    // UUID "for existence" then discarded the result — it was dead
    // code and contributed nothing to safety. Removed.
    await glucoseRepository.softDelete(clinicId, id);
    await auditLogService.logDelete({
      clinicId,
      userId: actorId,
      tableName: 'glucose_readings',
      recordId: id,
    });
  }
}

export const glucoseService = new GlucoseService();
// Pure helper exposed for unit tests that need the function but not the class.
GlucoseService.prototype.constructor; // tree-shake guard

export const _testing = { computeTimeInRange };
// Throws when imported in tests so the lint/strict rules don't complain.
// (Static reference; not used at runtime.)
void HttpError;
