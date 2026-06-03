// apps/api/src/features/billing/clinicianFeeService.ts
import { db } from '../../db/db';
import type { ClinicianFeeUpsertDTO, ClinicianFeeResponse } from '@signacare/shared';
// Phase 0b.2c-batch-3 (2026-05-06): drain hand-written CLINICIAN_FEE_OVERRIDE_COLUMNS.
// permanent: alias re-export IS the end-state per Phase 0b.2 DoD.
import { CLINICIAN_FEE_OVERRIDES_COLUMNS } from '../../db/types/clinician_fee_overrides';

// Phase 0.7.5 c24 D7b — row interface matching schema-snapshot.json
// (verified 2026-04-18 via psql \d clinician_fee_overrides).
export interface ClinicianFeeOverrideRow {
  id: string;
  clinic_id: string;
  staff_id: string;
  item_number: string;
  provider_fee_cents: number;
  gap_cents: number;
  bulk_bill_eligible: boolean;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const CLINICIAN_FEE_OVERRIDE_COLUMNS = CLINICIAN_FEE_OVERRIDES_COLUMNS;
type ClinicianFeeListRow = ClinicianFeeOverrideRow & { schedule_fee_cents?: number | null };

export const clinicianFeeService = {
  async list(clinicId: string, staffId: string): Promise<ClinicianFeeResponse[]> {
    const rows = await db<ClinicianFeeListRow>('clinician_fee_overrides as cfo')
      .leftJoin('fee_schedules as fs', function () {
        this.on('fs.clinic_id', 'cfo.clinic_id')
          .andOn('fs.item_number', 'cfo.item_number')
          .andOn('fs.is_active', db.raw('true'));
      })
      .where('cfo.clinic_id', clinicId)
      .where('cfo.staff_id', staffId)
      .where('cfo.is_active', true)
      .select(
        'cfo.id',
        'cfo.clinic_id',
        'cfo.staff_id',
        'cfo.item_number',
        'cfo.provider_fee_cents',
        'cfo.gap_cents',
        'cfo.bulk_bill_eligible',
        'cfo.notes',
        'cfo.is_active',
        'fs.schedule_fee_cents',
      )
      .orderBy('cfo.item_number', 'asc');

    return rows.map((r) => ({
      id: r.id,
      clinicId: r.clinic_id,
      staffId: r.staff_id,
      itemNumber: r.item_number,
      providerFeeCents: r.provider_fee_cents,
      gapCents: r.gap_cents,
      scheduleFeeCents: r.schedule_fee_cents ?? 0,
      bulkBillEligible: r.bulk_bill_eligible,
      notes: r.notes,
      isActive: r.is_active,
    }));
  },

  async upsert(clinicId: string, staffId: string, dto: ClinicianFeeUpsertDTO): Promise<ClinicianFeeResponse> {
    // Look up schedule fee to compute gap
    const feeSchedule = await db('fee_schedules')
      .where({ clinic_id: clinicId, item_number: dto.itemNumber, is_active: true })
      .whereNull('effective_to')
      .first();

    const scheduleFeeCents = feeSchedule?.schedule_fee_cents ?? 0;
    const gapCents = dto.providerFeeCents - scheduleFeeCents;

    const row = {
      clinic_id: clinicId,
      staff_id: staffId,
      item_number: dto.itemNumber,
      provider_fee_cents: dto.providerFeeCents,
      gap_cents: gapCents,
      bulk_bill_eligible: dto.bulkBillEligible ?? false,
      notes: dto.notes ?? null,
      is_active: true,
      updated_at: new Date(),
    };

    const results = await db<ClinicianFeeOverrideRow>('clinician_fee_overrides')
      .insert({ ...row, created_at: new Date() })
      .onConflict(['clinic_id', 'staff_id', 'item_number'])
      .merge(row)
      .returning(CLINICIAN_FEE_OVERRIDE_COLUMNS) as ClinicianFeeOverrideRow[];
    const result = results[0];

    return {
      id: result.id,
      clinicId: result.clinic_id,
      staffId: result.staff_id,
      itemNumber: result.item_number,
      providerFeeCents: result.provider_fee_cents,
      gapCents: result.gap_cents,
      scheduleFeeCents,
      bulkBillEligible: result.bulk_bill_eligible,
      notes: result.notes,
      isActive: result.is_active,
    };
  },

  async remove(clinicId: string, staffId: string, itemNumber: string): Promise<void> {
    await db('clinician_fee_overrides')
      .where({ clinic_id: clinicId, staff_id: staffId, item_number: itemNumber })
      .update({ is_active: false, updated_at: new Date() });
  },

  async getProviderFee(clinicId: string, staffId: string, itemNumber: string): Promise<{
    scheduleFeeCents: number;
    providerFeeCents: number;
    gapCents: number;
    rebateCents: number;
    bulkBillEligible: boolean;
  }> {
    const feeSchedule = await db('fee_schedules')
      .where({ clinic_id: clinicId, item_number: itemNumber, is_active: true })
      .whereNull('effective_to')
      .first();

    const scheduleFeeCents = feeSchedule?.schedule_fee_cents ?? 0;

    const override = await db('clinician_fee_overrides')
      .where({ clinic_id: clinicId, staff_id: staffId, item_number: itemNumber, is_active: true })
      .first();

    const providerFeeCents = override?.provider_fee_cents ?? scheduleFeeCents;
    const gapCents = providerFeeCents - scheduleFeeCents;
    const rebateCents = Math.round(scheduleFeeCents * 0.85);

    return {
      scheduleFeeCents,
      providerFeeCents,
      gapCents,
      rebateCents,
      bulkBillEligible: override?.bulk_bill_eligible ?? false,
    };
  },

  /**
   * Apply a uniform gap to all items for a clinician.
   */
  async applyUniformGap(clinicId: string, staffId: string, uniformGapCents: number): Promise<void> {
    const activeItems = await db('fee_schedules')
      .where({ clinic_id: clinicId, is_active: true })
      .whereNull('effective_to')
      .select('item_number', 'schedule_fee_cents');

    for (const item of activeItems) {
      const providerFeeCents = item.schedule_fee_cents + uniformGapCents;
      await this.upsert(clinicId, staffId, {
        itemNumber: item.item_number,
        providerFeeCents,
        bulkBillEligible: false,
      });
    }
  },
};
