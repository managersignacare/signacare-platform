import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../shared/errors';
import { db } from '../../db/db';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';
import { BaseRepository } from '../../shared/repositories/BaseRepository';
import {
  SafeScriptCheckResultSchema,
  type PrescriptionCreateDTO,
} from '@signacare/shared';

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
const PRESCRIPTION_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'drug_product_id',
  'prescribed_by_staff_id', 'patient_medication_id', 'generic_name',
  'brand_name', 'dose', 'route', 'frequency', 'directions', 'quantity',
  'repeats', 'pbs_item_code', 'is_authority', 'authority_code', 'is_s8',
  'prescription_type', 'status', 'safescript_checked',
  'safescript_checked_at', 'safescript_result', 'erx_token', 'erx_dsp_id',
  'erx_submitted_at', 'is_electronic', 'prescribed_date', 'expires_at',
  'notes', 'created_at', 'updated_at', 'deleted_at',
  'prescription_category', 'lock_version',
  // BUG-553 — cancellation-audit columns (NULL on pre-fix rows; required
  // at Zod boundary for new cancellations). AHPRA Standard 1 + S8 SafeScript
  // forensic chain.
  'cancellation_reason', 'cancelled_at', 'cancelled_by_staff_id',
] as const;
const ERX_TOKEN_COLUMNS = [
  'id', 'clinic_id', 'prescription_id', 'token_value', 'dsp_id',
  'npds_reference', 'status', 'issued_at', 'expires_at',
  'dispensed_at', 'dispensing_pharmacy', 'raw_response',
  'created_at', 'updated_at',
] as const;

/**
 * Mirrors the `prescriptions` table in the current migration set. Verified
 * against `psql \d prescriptions` on 2026-04-17 during Phase 0.7.5 c24 C1
 * (SD19 fix). If a new migration adds/removes a column, run
 * `npm run db:snapshot --workspace=apps/api` — the row-iface-drift guard
 * will fail this build until the interface matches.
 *
 * BUG-371b — `lock_version` declared post-BUG-371a migration. All UPDATE
 * paths route through `updateWithOptimisticLock` per CLAUDE.md §1.6.
 */
export interface PrescriptionRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  drug_product_id: string | null;
  prescribed_by_staff_id: string;
  patient_medication_id: string | null;
  generic_name: string;
  brand_name: string | null;
  dose: string;
  route: string;
  frequency: string;
  directions: string | null;
  quantity: number;
  repeats: number;
  pbs_item_code: string | null;
  is_authority: boolean;
  authority_code: string | null;
  is_s8: boolean;
  prescription_type: string;
  status: string;
  safescript_checked: boolean;
  safescript_checked_at: string | null;
  safescript_result: unknown;
  erx_token: string | null;
  erx_dsp_id: string | null;
  erx_submitted_at: string | null;
  is_electronic: boolean;
  prescribed_date: string;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  prescription_category: string;
  lock_version: number;
  // BUG-553 — cancellation-audit columns. NULL on pre-fix rows; for any
  // row with status='cancelled' AFTER the migration these are non-null.
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by_staff_id: string | null;
}

/** Synthetic row returned when erx_tokens table is not yet created */
export interface ErxTokenRow {
  id: string;
  clinic_id: string;
  prescription_id: string;
  token_value: string;
  dsp_id: string | null;
  npds_reference: string | null;
  status: string;
  issued_at: string;
  expires_at: string | null;
  dispensed_at: string | null;
  dispensing_pharmacy: string | null;
  raw_response: unknown;
  created_at: string;
  updated_at: string;
}

export interface ErxDispenseUpdateInput {
  dispensedAt: Date;
  dispensingPharmacy: string | null;
  rawResponse: unknown;
}

export class PrescriptionRepository extends BaseRepository<PrescriptionRow> {
  constructor() {
    super('prescriptions');
  }

  async create(
    clinicId: string,
    prescriberId: string,
    dto: PrescriptionCreateDTO,
  ): Promise<PrescriptionRow> {
    if (!dto.patientMedicationId) {
      throw new AppError('patientMedicationId is required', 400, 'VALIDATION_ERROR');
    }
    // Every key below is a real column on `prescriptions`. Verified
    // against psql \d on 2026-04-17 — see PrescriptionRow comment.
    // Previously this insert wrote to 7 columns that don't exist
    // (medication_id, prescribed_by_id, method, repeats_remaining,
    // dispensing_instructions, authority_required, authority_number)
    // — every prescribe crashed at runtime (SD19).
    const [row] = await db('prescriptions')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        drug_product_id: dto.drugProductId ?? null,
        prescribed_by_staff_id: prescriberId,
        patient_medication_id: dto.patientMedicationId,
        generic_name: dto.genericName,
        brand_name: dto.brandName ?? null,
        dose: dto.dose,
        route: dto.route,
        frequency: dto.frequency,
        directions: dto.directions ?? null,
        quantity: dto.quantity,
        repeats: dto.repeats ?? 0,
        pbs_item_code: dto.pbsItemCode ?? null,
        is_authority: dto.isAuthority ?? false,
        authority_code: dto.authorityCode ?? null,
        is_s8: dto.isS8 ?? false,
        prescription_type: dto.prescriptionType ?? 'standard',
        is_electronic: dto.isElectronic ?? true,
        prescribed_date: dto.prescribedDate,
        expires_at: dto.expiryDate ?? null,
        notes: dto.notes ?? null,
        prescription_category: dto.prescriptionCategory ?? 'outpatient',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(PRESCRIPTION_COLUMNS) as PrescriptionRow[];
    return row;
  }

  async findByPatient(
    clinicId: string,
    patientId: string,
    statusFilter?: string,
  ): Promise<PrescriptionRow[]> {
    const q = db('prescriptions')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .orderBy('prescribed_date', 'desc')
      .limit(500); // BUG-437 — list-ceiling per-patient prescriptions
    if (statusFilter) q.where('status', statusFilter);
    return q as Promise<PrescriptionRow[]>;
  }

  /**
   * BUG-311 — SafeScript check persistence contract.
   * Persists the canonical SafeScript result + checked flags on the
   * prescription row so downstream UI/decision paths consume one typed
   * source of truth.
   */
  async updateSafescriptResult(
    id: string,
    clinicId: string,
    result: unknown,
  ): Promise<void> {
    const parsed = SafeScriptCheckResultSchema.parse(result);
    const updated = await db('prescriptions')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({
        safescript_checked: parsed.checked,
        safescript_checked_at: parsed.checkedAt,
        safescript_result: parsed,
        updated_at: new Date(),
      });
    if (updated === 0) {
      throw new AppError('Prescription not found', 404, 'NOT_FOUND');
    }
  }

  async updateErxToken(
    id: string,
    clinicId: string,
    erxToken: string,
    dspId: string | null,
    submittedAt: Date,
    expectedLockVersion: number,
  ): Promise<PrescriptionRow> {
    // BUG-371b — opt-locked. Per c24 C1 (SD19 fix): erx_tokens row is
    // SoT for token state; here we update the prescription's copy of
    // the token + submission metadata. NPDS-callback path must wrap
    // a forUpdate() SELECT in a transaction to derive expectedLockVersion
    // (see prescriptionService.submitErx).
    return updateWithOptimisticLock<PrescriptionRow>({
      table: 'prescriptions',
      where: { id, clinic_id: clinicId, deleted_at: null },
      expectedLockVersion,
      patch: {
        erx_token: erxToken,
        erx_dsp_id: dspId,
        erx_submitted_at: submittedAt,
      },
      returning: PRESCRIPTION_COLUMNS,
    });
  }

  async updateStatus(
    id: string,
    clinicId: string,
    status: string,
    expectedLockVersion: number,
  ): Promise<PrescriptionRow> {
    // BUG-371b — opt-locked status transition (e.g. cancel). Caller
    // must propagate `expectedLockVersion` from the request DTO.
    return updateWithOptimisticLock<PrescriptionRow>({
      table: 'prescriptions',
      where: { id, clinic_id: clinicId, deleted_at: null },
      expectedLockVersion,
      patch: { status },
      returning: PRESCRIPTION_COLUMNS,
    });
  }

  /**
   * BUG-553 — dedicated cancel path that persists the AHPRA S8/SafeScript
   * forensic-chain audit columns (reason + actor + timestamp) atomically
   * with the status flip. Sibling pattern of medication-cease (BUG-371b
   * absorb-1). The dedicated method keeps `updateStatus` honest as a
   * generic status-flip primitive; cancellations always go through here.
   */
  async cancelWithReason(
    id: string,
    clinicId: string,
    reasonForCancellation: string,
    cancelledByStaffId: string,
    expectedLockVersion: number,
  ): Promise<PrescriptionRow> {
    return updateWithOptimisticLock<PrescriptionRow>({
      table: 'prescriptions',
      where: { id, clinic_id: clinicId, deleted_at: null },
      expectedLockVersion,
      patch: {
        status: 'cancelled',
        cancellation_reason: reasonForCancellation,
        cancelled_at: new Date(),
        cancelled_by_staff_id: cancelledByStaffId,
      },
      returning: PRESCRIPTION_COLUMNS,
    });
  }

  /**
   * BUG-553 follow-up — find the latest active erx_token for a prescription
   * (status='issued') so the cancel flow can revoke it at the DSP and mark
   * the local row as cancelled. Returns null when no active token exists
   * (rare — typical for cancellations of a draft eScript that was never
   * submitted to NPDS / eRx REST).
   */
  async findActiveErxTokenForPrescription(
    prescriptionId: string,
    clinicId: string,
  ): Promise<ErxTokenRow | null> {
    const row = await db('erx_tokens')
      .where({ prescription_id: prescriptionId, clinic_id: clinicId, status: 'issued' })
      .orderBy('issued_at', 'desc')
      .first();
    return (row as ErxTokenRow | undefined) ?? null;
  }

  /**
   * BUG-WF81-DISPENSE-FLOW-MISSING
   * Resolve the best token candidate for an inbound dispense notification.
   * Matching priority:
   *   1) exact prescription_id when provided by upstream payload
   *   2) dsp_id fallback
   *   3) token_value fallback
   *   4) npds_reference fallback
   *
   * This preserves compatibility across vendor dialects where ERX005 may
   * send script identifiers in different fields.
   */
  async findTokenForDispenseNotification(
    clinicId: string,
    scriptNumber: string,
    prescriptionId?: string | null,
  ): Promise<ErxTokenRow | null> {
    const normalizedScript = scriptNumber.trim();
    const normalizedPrescriptionId = (prescriptionId ?? '').trim() || null;

    const query = db('erx_tokens')
      .where({ clinic_id: clinicId })
      .orderBy('issued_at', 'desc');

    if (normalizedPrescriptionId) {
      query
        .andWhere((qb) =>
          qb
            .where('prescription_id', normalizedPrescriptionId)
            .orWhere('dsp_id', normalizedScript)
            .orWhere('token_value', normalizedScript)
            .orWhere('npds_reference', normalizedScript),
        )
        .orderByRaw(
          `
          CASE
            WHEN prescription_id = ? THEN 0
            WHEN dsp_id = ? THEN 1
            WHEN token_value = ? THEN 2
            WHEN npds_reference = ? THEN 3
            ELSE 4
          END
          `,
          [
            normalizedPrescriptionId,
            normalizedScript,
            normalizedScript,
            normalizedScript,
          ],
        );
    } else {
      query
        .andWhere((qb) =>
          qb
            .where('dsp_id', normalizedScript)
            .orWhere('token_value', normalizedScript)
            .orWhere('npds_reference', normalizedScript),
        )
        .orderByRaw(
          `
          CASE
            WHEN dsp_id = ? THEN 0
            WHEN token_value = ? THEN 1
            WHEN npds_reference = ? THEN 2
            ELSE 3
          END
          `,
          [
            normalizedScript,
            normalizedScript,
            normalizedScript,
          ],
        );
    }

    const row = await query.first();

    return (row as ErxTokenRow | undefined) ?? null;
  }

  /**
   * BUG-P7 — cancellation is forbidden when the DSP token has progressed
   * to a non-cancellable lifecycle state (dispensed or locked-for-amend).
   * We also treat non-null dispensed_at as authoritative dispense evidence
   * even if status drifted.
   */
  async findCancellationBlockedErxTokenForPrescription(
    prescriptionId: string,
    clinicId: string,
  ): Promise<ErxTokenRow | null> {
    const row = await db('erx_tokens')
      .where({ prescription_id: prescriptionId, clinic_id: clinicId })
      .where((qb) =>
        qb
          .whereIn('status', ['dispensed', 'locked'])
          .orWhereNotNull('dispensed_at'),
      )
      .orderByRaw(`
        CASE
          WHEN status = 'locked' THEN 0
          WHEN status = 'dispensed' THEN 1
          WHEN dispensed_at IS NOT NULL THEN 2
          ELSE 3
        END
      `)
      .orderBy('issued_at', 'desc')
      .first();
    return (row as ErxTokenRow | undefined) ?? null;
  }

  /**
   * BUG-553 follow-up — flip an erx_token to cancelled. Called atomically
   * with prescription cancel after a successful DSP-side revocation.
   */
  async markErxTokenCancelled(tokenId: string, clinicId: string): Promise<void> {
    await db('erx_tokens')
      .where({ id: tokenId, clinic_id: clinicId })
      .update({ status: 'cancelled', updated_at: new Date() });
  }

  /**
   * BUG-WF81-DISPENSE-FLOW-MISSING
   * Mark an existing token as dispensed and persist dispense metadata.
   * Idempotent semantics:
   * - if already dispensed, keep the earliest dispensed_at
   * - backfill dispensing_pharmacy only when missing
   */
  async markErxTokenDispensed(
    tokenId: string,
    clinicId: string,
    input: ErxDispenseUpdateInput,
  ): Promise<ErxTokenRow> {
    const current = await db('erx_tokens')
      .where({ id: tokenId, clinic_id: clinicId })
      .first() as ErxTokenRow | undefined;
    if (!current) {
      throw new AppError('eRx token not found', 404, 'NOT_FOUND');
    }

    const patch: Record<string, unknown> = {
      status: 'dispensed',
      updated_at: new Date(),
      raw_response: input.rawResponse as object,
    };
    if (!current.dispensed_at) {
      patch['dispensed_at'] = input.dispensedAt;
    }
    if (!current.dispensing_pharmacy && input.dispensingPharmacy) {
      patch['dispensing_pharmacy'] = input.dispensingPharmacy;
    }

    const [updated] = await db('erx_tokens')
      .where({ id: tokenId, clinic_id: clinicId })
      .update(patch)
      .returning(ERX_TOKEN_COLUMNS) as ErxTokenRow[];
    return updated;
  }

  async createErxToken(
    clinicId: string,
    prescriptionId: string,
    tokenValue: string,
    dspId: string | null,
    npdsReference: string | null,
    expiresAt: string | null,
    rawResponse: unknown,
  ): Promise<ErxTokenRow> {
    // Per c24 C1 (SD19/SD27 fix) — previously this returned a synthetic
    // in-memory row because the comment claimed "erx_tokens table not yet
    // created". The table DOES exist (migration 20260413000000_erx_tokens
    // or equivalent, verified via psql \d erx_tokens on 2026-04-17). We
    // now write a real row so the token is durable and downstream
    // dispensing events can update it.
    const [row] = await db('erx_tokens')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        prescription_id: prescriptionId,
        token_value: tokenValue,
        dsp_id: dspId,
        npds_reference: npdsReference,
        status: 'issued',
        issued_at: new Date(),
        expires_at: expiresAt ? new Date(expiresAt) : null,
        dispensed_at: null,
        dispensing_pharmacy: null,
        raw_response: rawResponse as object,
      })
      .returning(ERX_TOKEN_COLUMNS) as ErxTokenRow[];
    return row;
  }
}

export const prescriptionRepository = new PrescriptionRepository();
