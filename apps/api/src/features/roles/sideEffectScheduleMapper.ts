// apps/api/src/features/roles/sideEffectScheduleMapper.ts
//
// BUG-613 — backend response-mapper for the `/side-effect-schedules`
// surface per CLAUDE.md §5.2 ("Backend must map snake_case DB columns
// to camelCase response fields. Never pass raw Knex rows directly to
// res.json()"). Sibling architectural class to BUG-618 (clozapine
// mappers consolidation).
//
// Pre-fix: GET / POST / PUT `/side-effect-schedules` returned raw
// Knex snake_case rows. Frontend SideEffectsPanel.tsx had subtle bugs
// from the mixed shape (overdue indicator never fired because
// `s.nextDueDate` was always undefined; `lastCompletedDate` line never
// rendered). Post-fix: this mapper produces canonical camelCase + Zod-
// validates output via SideEffectScheduleResponseSchema; mismatch
// surfaces as AppError(500, 'RESPONSE_SHAPE_ERROR').

import { ZodError } from 'zod';
import {
  AppError,
  SideEffectScheduleResponseSchema,
  type SideEffectScheduleResponse,
} from '@signacare/shared';

export interface SideEffectScheduleRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  patient_medication_id: string | null;
  schedule_type: string;
  frequency_weeks: number;
  next_due_date: string | null;
  last_completed_date: string | null;
  parameters: unknown; // Knex returns the JSONB column as parsed object OR string
  notes: string | null;
  status: string;
  created_by_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

// Knex returns native `Date` objects for date / timestamp columns; the
// SSoT response schemas declare these as `z.string()` so direct emission
// would 422 on parse. Coerce to ISO-8601 here (mirrors the canonical
// `medicationService.toResponse` + `clozapineMappers.dateToIso` pattern).
function dateToIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return v.toISOString();
}

// Knex JSONB column may arrive as a parsed object OR as a string
// (depending on driver config). Normalise to a Record (or null).
function parseParameters(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof v === 'object') return v as Record<string, unknown>;
  return null;
}

export function mapSideEffectScheduleRowToResponse(
  r: SideEffectScheduleRow,
): SideEffectScheduleResponse {
  const candidate = {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    patientMedicationId: r.patient_medication_id ?? null,
    scheduleType: r.schedule_type,
    frequencyWeeks: r.frequency_weeks,
    nextDueDate: dateToIso(r.next_due_date as unknown as Date | string | null),
    lastCompletedDate: dateToIso(r.last_completed_date as unknown as Date | string | null),
    parameters: parseParameters(r.parameters),
    notes: r.notes ?? null,
    status: r.status,
    createdById: r.created_by_id ?? null,
    createdAt: dateToIso(r.created_at) ?? '',
    updatedAt: dateToIso(r.updated_at) ?? '',
  };
  try {
    return SideEffectScheduleResponseSchema.parse(candidate);
  } catch (err) {
    const message = err instanceof ZodError
      ? `side-effect-schedule response-shape drift: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      : `side-effect-schedule response-shape drift on row ${r.id}`;
    throw new AppError(message, 500, 'RESPONSE_SHAPE_ERROR');
  }
}
