// apps/api/src/features/billing/feeScheduleService.ts
import { db } from '../../db/db';
import type { FeeScheduleCreateDTO, FeeScheduleUpdateDTO, FeeScheduleResponse, MbsSuggestion } from '@signacare/shared';
// Phase 0b.2c-batch-3 (2026-05-06): drain hand-written FEE_SCHEDULE_COLUMNS.
// permanent: alias re-export IS the end-state per Phase 0b.2 DoD.
import { FEE_SCHEDULES_COLUMNS } from '../../db/types/fee_schedules';

interface FeeScheduleRow {
  id: string;
  clinic_id: string;
  item_number: string;
  description: string;
  schedule_fee_cents: number;
  category: string;
  modality: string | null;
  min_duration_mins: number | null;
  max_duration_mins: number | null;
  is_initial: boolean;
  is_active: boolean;
  source: string;
  effective_from: string | null;
  effective_to: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

// Phase 0.7.5 c24 D7b — explicit column list for .returning calls.
// Knex types .returning(arr) as Partial<T>[] even when the array is
// complete, so each call casts to FeeScheduleRow[] to preserve the
// interface contract.
const FEE_SCHEDULE_COLUMNS = FEE_SCHEDULES_COLUMNS;

function mapRow(row: FeeScheduleRow): FeeScheduleResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    itemNumber: row.item_number,
    description: row.description,
    scheduleFeeCents: row.schedule_fee_cents,
    category: row.category,
    modality: row.modality,
    minDurationMins: row.min_duration_mins,
    maxDurationMins: row.max_duration_mins,
    isInitial: row.is_initial,
    isActive: row.is_active,
    source: row.source,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    sortOrder: row.sort_order,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export const feeScheduleService = {
  async list(clinicId: string, filters?: { category?: string; isActive?: boolean; source?: string }): Promise<FeeScheduleResponse[]> {
    const query = db<FeeScheduleRow>('fee_schedules')
      .where({ clinic_id: clinicId })
      .orderBy('sort_order', 'asc')
      .orderBy('item_number', 'asc');

    if (filters?.isActive !== undefined) query.where('is_active', filters.isActive);
    if (filters?.category) query.where('category', filters.category);
    if (filters?.source) query.where('source', filters.source);

    const rows = await query;
    return rows.map(mapRow);
  },

  async getByItemNumber(clinicId: string, itemNumber: string): Promise<FeeScheduleResponse | null> {
    const row = await db<FeeScheduleRow>('fee_schedules')
      .where({ clinic_id: clinicId, item_number: itemNumber, is_active: true })
      .whereNull('effective_to')
      .first();
    return row ? mapRow(row) : null;
  },

  async create(clinicId: string, dto: FeeScheduleCreateDTO): Promise<FeeScheduleResponse> {
    const rows = await db<FeeScheduleRow>('fee_schedules')
      .insert({
        clinic_id: clinicId,
        item_number: dto.itemNumber,
        description: dto.description,
        schedule_fee_cents: dto.scheduleFeeCents,
        category: dto.category,
        modality: dto.modality ?? null,
        min_duration_mins: dto.minDurationMins ?? null,
        max_duration_mins: dto.maxDurationMins ?? null,
        is_initial: dto.isInitial ?? false,
        is_active: dto.isActive ?? true,
        source: dto.source ?? 'mbs',
        effective_from: dto.effectiveFrom ?? null,
        effective_to: dto.effectiveTo ?? null,
        sort_order: dto.sortOrder ?? 0,
      })
      .returning(FEE_SCHEDULE_COLUMNS) as FeeScheduleRow[];
    return mapRow(rows[0]);
  },

  async update(clinicId: string, id: string, dto: FeeScheduleUpdateDTO): Promise<FeeScheduleResponse | null> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (dto.itemNumber !== undefined) patch.item_number = dto.itemNumber;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.scheduleFeeCents !== undefined) patch.schedule_fee_cents = dto.scheduleFeeCents;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.modality !== undefined) patch.modality = dto.modality;
    if (dto.minDurationMins !== undefined) patch.min_duration_mins = dto.minDurationMins;
    if (dto.maxDurationMins !== undefined) patch.max_duration_mins = dto.maxDurationMins;
    if (dto.isInitial !== undefined) patch.is_initial = dto.isInitial;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;
    if (dto.source !== undefined) patch.source = dto.source;
    if (dto.effectiveFrom !== undefined) patch.effective_from = dto.effectiveFrom;
    if (dto.effectiveTo !== undefined) patch.effective_to = dto.effectiveTo;
    if (dto.sortOrder !== undefined) patch.sort_order = dto.sortOrder;

    const rows = await db<FeeScheduleRow>('fee_schedules')
      .where({ id, clinic_id: clinicId })
      .update(patch)
      .returning(FEE_SCHEDULE_COLUMNS) as FeeScheduleRow[];
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async deactivate(clinicId: string, id: string): Promise<void> {
    await db('fee_schedules')
      .where({ id, clinic_id: clinicId })
      .update({ is_active: false, updated_at: new Date() });
  },

  /**
   * Auto-suggest MBS item based on appointment type, duration, and modality.
   * Returns a suggestion — clinician must confirm before invoice is created.
   */
  async suggestMbsItem(
    clinicId: string,
    staffId: string,
    appointment: { type: string; startTime: string; endTime: string; patientId: string },
  ): Promise<MbsSuggestion | null> {
    const durationMs = new Date(appointment.endTime).getTime() - new Date(appointment.startTime).getTime();
    const durationMins = Math.round(durationMs / 60000);

    // Determine modality
    let modality = 'in_rooms';
    if (appointment.type === 'telehealth') modality = 'video';
    // Check if phone-based (look for telehealth_provider hints)

    // Check if initial visit (first appointment for this patient with this clinician)
    const priorAppointments = await db('appointments')
      .where({ clinic_id: clinicId, patient_id: appointment.patientId, clinician_id: staffId })
      .where('status', 'completed')
      .count('* as count');
    const isInitial = parseInt(String(priorAppointments[0]?.count ?? '0'), 10) <= 1;

    // Find matching fee schedule items
    const candidates = await db<FeeScheduleRow>('fee_schedules')
      .where({ clinic_id: clinicId, is_active: true })
      .where('is_initial', isInitial)
      .where(function () {
        this.where('modality', modality).orWhereNull('modality');
      })
      .where(function () {
        this.where('min_duration_mins', '<=', durationMins).orWhereNull('min_duration_mins');
      })
      .orderBy('min_duration_mins', 'desc')
      .limit(1);

    if (candidates.length === 0) {
      // Fallback: try without initial/modality filter
      const fallback = await db<FeeScheduleRow>('fee_schedules')
        .where({ clinic_id: clinicId, is_active: true })
        .where(function () {
          this.where('min_duration_mins', '<=', durationMins).orWhereNull('min_duration_mins');
        })
        .orderBy('min_duration_mins', 'desc')
        .limit(1);
      if (fallback.length === 0) return null;
      candidates.push(fallback[0]);
    }

    const item = candidates[0];

    // Look up clinician's provider fee
    const override = await db('clinician_fee_overrides')
      .where({ clinic_id: clinicId, staff_id: staffId, item_number: item.item_number, is_active: true })
      .first();

    const providerFeeCents = override?.provider_fee_cents ?? item.schedule_fee_cents;
    const gapCents = providerFeeCents - item.schedule_fee_cents;
    const rebateCents = Math.round(item.schedule_fee_cents * 0.85);

    return {
      itemNumber: item.item_number,
      description: item.description,
      scheduleFeeCents: item.schedule_fee_cents,
      providerFeeCents,
      gapCents,
      rebateCents,
      reason: `${isInitial ? 'Initial' : 'Subsequent'} ${modality} consultation, ${durationMins} mins → Item ${item.item_number}`,
    };
  },
};
