// apps/api/src/features/billing/referralValidityService.ts
import { db } from '../../db/db';
import { todayLocal } from '../../utils/dateUtils';
import type { ReferralValidityCreateDTO, ReferralValidityResponse } from '@signacare/shared';
// Phase 0b.2c-batch-3 (2026-05-06): drain hand-written REFERRAL_VALIDITY_COLUMNS
// to migration-driven SSoT per Phase 0b.2 plan + CLAUDE.md §15.
//
// permanent: pattern variation — DIRECT IMPORT (not alias re-export) because
// the hand-written name (REFERRAL_VALIDITY_COLUMNS) IS already the canonical
// generated name for the `referral_validity` table (singular and plural
// happen to coincide). Aliasing would create a self-reference. The constant
// is module-private (not exported) so direct import is the cleaner end-state.
// Same byte-equivalent class as alias re-export pattern; just no rename
// indirection needed.
import { REFERRAL_VALIDITY_COLUMNS } from '../../db/types/referral_validity';

// Phase 0.7.5 c24 D7b — row interface matching schema-snapshot.json
// (verified 2026-04-18 via psql \d referral_validity).
export interface ReferralValidityRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  referring_provider_name: string;
  referring_provider_number: string | null;
  referral_type: string;
  referral_date: Date | string;
  expires_at: Date | string;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

// GP referral = 12 months, specialist referral = 3 months (Medicare rule)
const REFERRAL_DURATION_MONTHS: Record<string, number> = {
  gp: 12,
  specialist: 3,
};

function computeExpiryDate(referralDate: string, referralType: string): string {
  const date = new Date(referralDate);
  const months = REFERRAL_DURATION_MONTHS[referralType] ?? 12;
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split('T')[0];
}

function mapRow(row: ReferralValidityRow): ReferralValidityResponse {
  const today = new Date(todayLocal());
  const expiry = new Date(row.expires_at);
  const diffMs = expiry.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    referringProviderName: row.referring_provider_name,
    referringProviderNumber: row.referring_provider_number,
    referralType: row.referral_type,
    referralDate: typeof row.referral_date === 'string' ? row.referral_date : row.referral_date.toISOString().split('T')[0],
    expiryDate: typeof row.expires_at === 'string' ? row.expires_at : row.expires_at.toISOString().split('T')[0],
    isActive: row.is_active,
    daysRemaining: Math.max(0, daysRemaining),
    isExpired: daysRemaining < 0,
    notes: row.notes,
  };
}

export const referralValidityService = {
  async create(clinicId: string, dto: ReferralValidityCreateDTO): Promise<ReferralValidityResponse> {
    const expiryDate = computeExpiryDate(dto.referralDate, dto.referralType);

    // Deactivate previous referrals for this patient
    await db<ReferralValidityRow>('referral_validity')
      .where({ clinic_id: clinicId, patient_id: dto.patientId, is_active: true })
      .update({ is_active: false, updated_at: new Date() });

    const rows = await db<ReferralValidityRow>('referral_validity')
      .insert({
        clinic_id: clinicId,
        patient_id: dto.patientId,
        referring_provider_name: dto.referringProviderName,
        referring_provider_number: dto.referringProviderNumber ?? null,
        referral_type: dto.referralType,
        referral_date: dto.referralDate,
        expires_at: expiryDate,
        is_active: true,
        notes: dto.notes ?? null,
      })
      .returning(REFERRAL_VALIDITY_COLUMNS) as ReferralValidityRow[];

    return mapRow(rows[0]);
  },

  async getActive(clinicId: string, patientId: string): Promise<ReferralValidityResponse | null> {
    const row = await db<ReferralValidityRow>('referral_validity')
      .where({ clinic_id: clinicId, patient_id: patientId, is_active: true })
      .orderBy('expires_at', 'desc')
      .first();
    return row ? mapRow(row) : null;
  },

  async checkValidity(clinicId: string, patientId: string): Promise<{
    valid: boolean;
    referral: ReferralValidityResponse | null;
  }> {
    const referral = await this.getActive(clinicId, patientId);
    if (!referral) return { valid: false, referral: null };
    return { valid: !referral.isExpired, referral };
  },

  async listExpiring(clinicId: string, daysAhead: number): Promise<ReferralValidityResponse[]> {
    const today = todayLocal();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const rows = await db<ReferralValidityRow>('referral_validity')
      .where({ clinic_id: clinicId, is_active: true })
      .where('expires_at', '<=', futureDateStr)
      .where('expires_at', '>=', today)
      .orderBy('expires_at', 'asc');

    return rows.map(mapRow);
  },

  async listForPatient(clinicId: string, patientId: string): Promise<ReferralValidityResponse[]> {
    const rows = await db<ReferralValidityRow>('referral_validity')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .orderBy('referral_date', 'desc');
    return rows.map(mapRow);
  },
};
