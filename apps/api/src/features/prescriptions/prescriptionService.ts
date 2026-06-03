import { prescriptionRepository } from './prescriptionRepository';
import { AppError } from '../../shared/errors';
import { safeScriptService } from '../../integrations/safeScript/safeScriptService';
import { escriptService } from '../../integrations/escript/escriptService';
import { writeAuditLog } from '../../utils/audit';
import { logger } from '../../utils/logger';
// BUG-292 — service-layer AuthContext migration + prescriber-discipline
// barrier (Layer A). Pairs with the DB-level trigger installed by
// migration 20260701000029_prescriptions_prescriber_discipline_barrier.ts
// (Layer B). CLAUDE.md §13 mandates new service code use AuthContext.
import type { AuthContext } from '@signacare/shared';
import { requirePrescribingDiscipline, requireValidHpii } from '../../shared/authGuards';
import { requireRecentStepUp } from '../../shared/stepUpAuth';
import {
  SafeScriptCheckResultSchema,
  type PrescriptionCreateDTO,
  type PrescriptionResponse,
  type ErxTokenResponse,
  type SafeScriptCheckResult,
} from '@signacare/shared';
import type { PrescriptionRow, ErxTokenRow } from './prescriptionRepository';
import type { SafeScriptPatientIdentifier } from '../../integrations/safeScript/safeScriptService';
import type { ErxSubmitPayload } from '../../integrations/escript/escriptService';
import { patientRepository } from '../patients/patientRepository';
import { ihiConformanceService } from './ihiConformanceService';
import { decryptPhi } from '../../utils/phiEncryption';
import { ErxSubmitContractSchema } from './erxRegulatoryContract';
import { syncMedicationRequestFromPrescription } from '../../integrations/escript/myslClient';
import { erxAdapterService, type DispenseNotification } from '../../integrations/escript/erxAdapterService';
import { emitClinicalSignal } from '../events/clinicalSignalEmitter';

function normalizeSafeScriptResult(value: unknown): SafeScriptCheckResult | null {
  if (value == null) return null;
  const parsed = SafeScriptCheckResultSchema.safeParse(value);
  if (!parsed.success) {
    logger.warn(
      {
        code: 'BUG-311_SAFE_SCRIPT_RESULT_CONTRACT_DRIFT',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
      '[prescriptionService] dropping invalid safescript_result payload',
    );
    return null;
  }
  return parsed.data;
}

function getAuditTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function toResponse(r: PrescriptionRow): PrescriptionResponse {
  // Phase 0.7.5 c24 C1 (SD19) — every fallback field that used to read
  // a non-existent column (r.dispensing_instructions, r.authority_required,
  // r.authority_number, r.method) has been removed. The DB columns are
  // the single source of truth.
  return {
    id: r.id,
    // BUG-371b — propagate lock_version to client so next mutation
    // sends it back as expectedLockVersion.
    lockVersion: r.lock_version,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    episodeId: r.episode_id ?? null,
    // BUG-553 — surface patient_medication_id so the frontend can resolve
    // medication-id → active-prescription-id when cancelling an eScript.
    patientMedicationId: r.patient_medication_id ?? null,
    prescribedByStaffId: r.prescribed_by_staff_id,
    genericName: r.generic_name ?? '',
    brandName: r.brand_name ?? null,
    dose: r.dose ?? '',
    route: r.route ?? '',
    frequency: r.frequency ?? '',
    directions: r.directions ?? null,
    quantity: r.quantity ?? 0,
    repeats: r.repeats ?? 0,
    pbsItemCode: r.pbs_item_code ?? null,
    isAuthority: r.is_authority ?? false,
    authorityCode: r.authority_code ?? null,
    isS8: r.is_s8 ?? false,
    prescriptionType: r.prescription_type ?? 'standard',
    prescriptionCategory: (r.prescription_category ?? 'outpatient') as PrescriptionResponse['prescriptionCategory'],
    status: r.status as PrescriptionResponse['status'],
    safescriptChecked: r.safescript_checked ?? false,
    safescriptCheckedAt: r.safescript_checked_at ?? null,
    safescriptResult: normalizeSafeScriptResult(r.safescript_result),
    erxToken: r.erx_token ?? null,
    erxDspId: r.erx_dsp_id ?? null,
    erxSubmittedAt: r.erx_submitted_at ?? null,
    isElectronic: r.is_electronic ?? false,
    prescribedDate: r.prescribed_date,
    expiryDate: r.expires_at ?? null,
    notes: r.notes ?? null,
    // BUG-553 — cancellation-audit fields. NULL until row is cancelled
    // post-migration (or for pre-fix cancellations).
    cancellationReason: r.cancellation_reason ?? null,
    cancelledAt: r.cancelled_at ?? null,
    cancelledByStaffId: r.cancelled_by_staff_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function erxToResponse(r: ErxTokenRow): ErxTokenResponse {
  return {
    id: r.id,
    prescriptionId: r.prescription_id,
    tokenValue: r.token_value,
    dspId: r.dsp_id ?? null,
    npdsReference: r.npds_reference ?? null,
    status: r.status as ErxTokenResponse['status'],
    issuedAt: r.issued_at,
    expiresAt: r.expires_at ?? null,
    dispensedAt: r.dispensed_at ?? null,
    dispensingPharmacy: r.dispensing_pharmacy ?? null,
    createdAt: r.created_at,
  };
}

function canonicalizeErxPayloadFromPrescription(
  payload: ErxSubmitPayload,
  row: PrescriptionRow,
  patientIhi: string,
): ErxSubmitPayload {
  const authorityApprovalNumber = row.is_authority
    ? (row.authority_code ?? payload.authorityApprovalNumber ?? undefined)
    : (payload.authorityApprovalNumber ?? row.authority_code ?? undefined);
  const pbsItemCode = row.is_authority
    ? (row.pbs_item_code ?? payload.pbsItemCode ?? undefined)
    : (payload.pbsItemCode ?? row.pbs_item_code ?? undefined);
  const authorityMode = payload.authorityMode
    ?? (row.is_authority ? (authorityApprovalNumber ? 'written' : 'streamlined') : undefined);
  return {
    ...payload,
    patientIhi,
    pbsItemCode,
    authorityApprovalNumber,
    authorityMode,
  };
}

function assertPbsAuthorityConsistency(row: PrescriptionRow, payload: ErxSubmitPayload): void {
  if (row.is_authority) {
    if (!payload.pbsItemCode) {
      throw new AppError(
        'Authority prescription is missing PBS item code',
        409,
        'PBS_AUTHORITY_PBS_CODE_REQUIRED',
      );
    }
    if (payload.authorityMode === 'private') {
      throw new AppError(
        'Authority prescription cannot be submitted as private',
        409,
        'PBS_AUTHORITY_MODE_INVALID',
      );
    }
    if (
      (payload.authorityMode === 'phone' || payload.authorityMode === 'written')
      && !payload.authorityApprovalNumber
    ) {
      throw new AppError(
        'Authority approval number is required for phone/written authority scripts',
        409,
        'PBS_AUTHORITY_APPROVAL_REQUIRED',
      );
    }
    return;
  }

  if (
    payload.authorityMode === 'phone'
    || payload.authorityMode === 'written'
  ) {
    throw new AppError(
      'Prescription is not marked as authority in source record',
      409,
      'PBS_AUTHORITY_FLAG_MISMATCH',
    );
  }
}

function buildMySLMedicationRequestFromPrescriptionRow(
  row: PrescriptionRow,
  status: 'active' | 'cancelled',
): Record<string, unknown> {
  return {
    resourceType: 'MedicationRequest',
    status,
    intent: 'order',
    authoredOn: row.prescribed_date,
    identifier: [
      { system: 'urn:signacare:prescription-id', value: row.id },
    ],
    medicationCodeableConcept: {
      text: row.brand_name || row.generic_name || 'Medication',
    },
    dosageInstruction: [
      {
        text: [row.dose, row.frequency, row.route].filter(Boolean).join(' ').trim(),
      },
    ],
  };
}

export const prescriptionService = {
  async create(
    auth: AuthContext,
    dto: PrescriptionCreateDTO,
  ): Promise<PrescriptionResponse> {
    // BUG-292 Layer A — AHPRA discipline barrier BEFORE the repository
    // write. Layer B (DB trigger) catches the same class at engine level
    // for defence-in-depth against compromised owner-role SQL.
    await requirePrescribingDiscipline(auth);
    // BUG-296 / BUG-WF81-HPII-MISSING — strict HPI-I gate alongside
    // discipline barrier. Missing/malformed HPI-I always blocks.
    await requireValidHpii(auth);
    // BUG-P3 — PRES-7 DH-3869 + DH-4155 §3 step-up. S8 (Schedule 8 controlled
    // drug) prescribing requires a fresh MFA / password challenge within the
    // STEP_UP_TTL_MINUTES window. Throws AppError(403, 'STEP_UP_REQUIRED')
    // if missing — frontend opens MfaChallengeDialog and retries on success.
    if (dto.isS8) {
      await requireRecentStepUp(auth);
    }
    const row = await prescriptionRepository.create(auth.clinicId, auth.staffId, dto);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'CREATE',
      tableName: 'prescriptions',
      recordId: row.id,
      newData: {
        id: row.id,
        patientId: row.patient_id,
        patientMedicationId: row.patient_medication_id,
        drugProductId: row.drug_product_id,
      },
    });
    return toResponse(row);
  },

  async listByPatient(
    auth: AuthContext,
    patientId: string,
    statusFilter?: string,
  ): Promise<PrescriptionResponse[]> {
    const rows = await prescriptionRepository.findByPatient(
      auth.clinicId,
      patientId,
      statusFilter,
    );
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'prescriptions',
      recordId: patientId,
    });
    return rows.map(toResponse);
  },

  async getById(
    auth: AuthContext,
    id: string,
  ): Promise<PrescriptionResponse> {
    const row = await prescriptionRepository.findById(id, auth.clinicId);
    if (!row) {
      throw new AppError('Prescription not found', 404, 'NOT_FOUND');
    }
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'prescriptions',
      recordId: id,
    });
    return toResponse(row);
  },

  /**
   * Run a SafeScript (PDMP) check for the patient associated with a prescription.
   * Stores the result against the prescription record.
   * MUST be called before activating any S8 prescription.
   */
  async runSafeScriptCheck(
    auth: AuthContext,
    id: string,
    identifier: SafeScriptPatientIdentifier,
  ): Promise<PrescriptionResponse> {
    // BUG-292 Layer A — SafeScript gate-check is a prescribing-adjacent
    // action (feeds into S8 dispensing decision); require the same
    // discipline barrier as create/submit.
    await requirePrescribingDiscipline(auth);
    const row = await prescriptionRepository.findById(id, auth.clinicId);
    if (!row) {
      throw new AppError('Prescription not found', 404, 'NOT_FOUND');
    }
    logger.info(
      { clinicId: auth.clinicId, actorId: auth.staffId, prescriptionId: id },
      '[Signacare] Running SafeScript check',
    );
    const result = await safeScriptService.checkPatient(
      auth.clinicId,
      auth.staffId,
      row.patient_id,
      identifier,
    );
    await prescriptionRepository.updateSafescriptResult(id, auth.clinicId, result);
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'READ',
      tableName: 'prescriptions',
      recordId: id,
      newData: {
        action: 'safescript_check',
        checked: result.checked,
        suppliesCount: result.supplies.length,
      },
    });
    const updated = await prescriptionRepository.findById(id, auth.clinicId);
    return toResponse(updated!);
  },

  /**
   * Submit an electronic prescription to NPDS.
   * Issues the eScript token and stores it in erx_tokens.
   */
  async submitErx(
    auth: AuthContext,
    id: string,
    payload: ErxSubmitPayload,
  ): Promise<{ prescription: PrescriptionResponse; token: ErxTokenResponse | null }> {
    // BUG-292 Layer A — submitting an eScript to NPDS is the
    // prescribing-moment in the ETP2 flow. Discipline gate here
    // matches create() + runSafeScriptCheck().
    await requirePrescribingDiscipline(auth);
    // BUG-296 — HPI-I gate on eRx submission. The NPDS XML carries
    // <PrescriberHPII>; missing/malformed HPI-I = rejected submission.
    await requireValidHpii(auth);
    const regulatoryPayload = ErxSubmitContractSchema.parse(payload);
    const row = await prescriptionRepository.findById(id, auth.clinicId);
    if (!row) {
      throw new AppError('Prescription not found', 404, 'NOT_FOUND');
    }
    const patient = await patientRepository.findById(auth.clinicId, row.patient_id);
    if (!patient) {
      throw new AppError('Prescription patient not found', 404, 'NOT_FOUND');
    }
    const canonicalPatientIhi = decryptPhi(patient.ihi_number) ?? null;
    if (!canonicalPatientIhi) {
      throw new AppError('Patient IHI is required before eRx submission', 409, 'IHI_REQUIRED');
    }
    await ihiConformanceService.assertPrescribeEligibleIhiStatus(auth, row.patient_id);
    if (!row.is_electronic) {
      // Phase 0.7.5 c24 C1 (SD19) — was `row.method !== 'electronic'`,
      // but the `method` column doesn't exist. `is_electronic` is the
      // canonical flag per the schema.
      throw new AppError(
        'Prescription is not flagged for electronic submission',
        409,
        'NOT_ELECTRONIC',
      );
    }
    const canonicalPayload = canonicalizeErxPayloadFromPrescription(
      regulatoryPayload,
      row,
      canonicalPatientIhi,
    );
    assertPbsAuthorityConsistency(row, canonicalPayload);
    const contractPayload = ErxSubmitContractSchema.parse(canonicalPayload);
    const result = await escriptService.submitPrescription(
      auth.clinicId,
      auth.staffId,
      contractPayload,
    );
    if (result.success && result.erxToken) {
      // BUG-371b — opt-locked write. `row.lock_version` was read at
      // line 208 before NPDS submission. If the prescription was
      // mutated between the read and now (rare — NPDS round-trip),
      // the helper throws AppError(409, 'OPTIMISTIC_LOCK_CONFLICT')
      // and the eRx token write is skipped — correct: a stale-version
      // write would corrupt the prescription state.
      await prescriptionRepository.updateErxToken(
        id,
        auth.clinicId,
        result.erxToken,
        result.dspId ?? null,
        new Date(),
        row.lock_version,
      );
      const tokenRow = await prescriptionRepository.createErxToken(
        auth.clinicId,
        id,
        result.erxToken,
        result.dspId ?? null,
        result.npdsReference ?? null,
        result.expiresAt ?? null,
        result.rawResponse,
      );
      const myslSync = await syncMedicationRequestFromPrescription({
        patientIhi: canonicalPatientIhi,
        prescriptionId: id,
        medicationRequestResource: result.fhirResource,
        status: 'active',
        npdsReference: result.npdsReference ?? null,
        erxToken: result.erxToken,
      });
      await writeAuditLog({
        actorId: auth.staffId,
        clinicId: auth.clinicId,
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: tokenRow.id,
        newData: {
          operation: 'mysl_sync',
          outcome: myslSync.success ? 'success' : 'skipped',
          action: myslSync.action,
          reason: myslSync.reason ?? null,
          error: myslSync.error ?? null,
          medicationRequestId: myslSync.medicationRequestId ?? null,
          patientFhirId: myslSync.patientFhirId ?? null,
        },
      });
      await writeAuditLog({
        actorId: auth.staffId,
        clinicId: auth.clinicId,
        action: 'CREATE',
        tableName: 'erx_tokens',
        recordId: tokenRow.id,
        newData: {
          operation: 'submit',
          outcome: 'success',
          guid: id,
          npdsReference: result.npdsReference ?? null,
          npdsAcknowledgedAt: result.pathway === 'npds' || result.pathway === 'both' ? new Date().toISOString() : null,
          timezone: getAuditTimezone(),
          token: result.erxToken,
          prescriptionId: id,
          pathway: result.pathway ?? null,
          auditSpec: 'dh3945-2B-dh4155-4',
        },
      });
      const updatedRx = await prescriptionRepository.findById(id, auth.clinicId);
      return { prescription: toResponse(updatedRx!), token: erxToResponse(tokenRow) };
    }
    logger.warn(
      { clinicId: auth.clinicId, actorId: auth.staffId, prescriptionId: id, error: result.error },
      '[Signacare] eScript submission did not return a token',
    );
    const updatedRx = await prescriptionRepository.findById(id, auth.clinicId);
    return { prescription: toResponse(updatedRx!), token: null };
  },

  /**
   * BUG-WF81-DISPENSE-FLOW-MISSING
   * Poll ETP1 dispense notifications and apply downstream state transitions:
   * - erx_tokens.status -> dispensed (+ dispense metadata)
   * - prescriptions.status -> dispensed
   * - audit trail + clinician signal for matched items
   */
  async pollAndApplyDispenseNotifications(
    auth: AuthContext,
  ): Promise<{
    notifications: DispenseNotification[];
    matched: number;
    updated: number;
    unmatched: number;
    alreadyDispensed: number;
    errors: number;
  }> {
    const notifications = await erxAdapterService.pollDispenseNotifications(auth.clinicId, auth.staffId);
    if (notifications.length === 0) {
      return {
        notifications,
        matched: 0,
        updated: 0,
        unmatched: 0,
        alreadyDispensed: 0,
        errors: 0,
      };
    }

    let matched = 0;
    let updated = 0;
    let unmatched = 0;
    let alreadyDispensed = 0;
    let errors = 0;

    for (const n of notifications) {
      try {
        const token = await prescriptionRepository.findTokenForDispenseNotification(
          auth.clinicId,
          n.scriptNumber,
          n.prescriptionId ?? null,
        );
        if (!token) {
          unmatched += 1;
          continue;
        }
        matched += 1;

        const parsedDispensedAt = new Date(n.dispensedDate);
        const dispensedAt = Number.isNaN(parsedDispensedAt.getTime()) ? new Date() : parsedDispensedAt;

        const updatedToken = await prescriptionRepository.markErxTokenDispensed(
          token.id,
          auth.clinicId,
          {
            dispensedAt,
            dispensingPharmacy: n.pharmacyName ?? null,
            rawResponse: {
              source: 'erx_adapter_erx005',
              scriptNumber: n.scriptNumber,
              prescriptionId: n.prescriptionId ?? null,
              dispensedDate: n.dispensedDate,
              dispensedQuantity: n.dispensedQuantity,
              pharmacyName: n.pharmacyName ?? null,
              pharmacistName: n.pharmacistName ?? null,
              pharmacyHpio: n.pharmacyHpio ?? null,
              repeatNumber: n.repeatNumber ?? null,
            },
          },
        );

        const prescription = await prescriptionRepository.findById(updatedToken.prescription_id, auth.clinicId);
        if (!prescription) {
          unmatched += 1;
          continue;
        }

        if (prescription.status === 'dispensed') {
          alreadyDispensed += 1;
        } else {
          await prescriptionRepository.updateStatus(
            prescription.id,
            auth.clinicId,
            'dispensed',
            prescription.lock_version,
          );
          updated += 1;
        }

        await writeAuditLog({
          actorId: auth.staffId,
          clinicId: auth.clinicId,
          action: 'UPDATE',
          tableName: 'prescriptions',
          recordId: prescription.id,
          newData: {
            operation: 'dispense_notification_apply',
            source: 'ERX005',
            erxTokenId: updatedToken.id,
            scriptNumber: n.scriptNumber,
            dispensedDate: n.dispensedDate,
            dispensedQuantity: n.dispensedQuantity,
            pharmacyName: n.pharmacyName ?? null,
          },
        });

        await emitClinicalSignal({
          clinicId: auth.clinicId,
          userIds: [prescription.prescribed_by_staff_id],
          title: 'Prescription Dispensed',
          body: `${prescription.generic_name} dispensed${n.pharmacyName ? ` at ${n.pharmacyName}` : ''}.`,
          severity: 'info',
          category: 'clinical',
          source: 'workflow',
          signalKey: 'prescription_dispensed',
          payload: {
            prescriptionId: prescription.id,
            patientId: prescription.patient_id,
            scriptNumber: n.scriptNumber,
            repeatNumber: n.repeatNumber ?? null,
          },
        });
      } catch (err) {
        errors += 1;
        logger.error(
          {
            err,
            clinicId: auth.clinicId,
            scriptNumber: n.scriptNumber,
            prescriptionId: n.prescriptionId ?? null,
          },
          '[prescriptionService] failed to apply dispense notification',
        );
      }
    }

    return {
      notifications,
      matched,
      updated,
      unmatched,
      alreadyDispensed,
      errors,
    };
  },

  async cancel(
    auth: AuthContext,
    id: string,
    expectedLockVersion: number,
    reasonForCancellation: string,
  ): Promise<{ prescription: PrescriptionResponse; dspRevocation: 'revoked' | 'pending' | 'not-applicable' }> {
    // BUG-292 Layer A — cancellation is a prescribing-state transition
    // (revokes an active eScript); require the discipline barrier so
    // a non-prescribing discipline can't unilaterally invalidate
    // someone else's prescription.
    await requirePrescribingDiscipline(auth);
    const row = await prescriptionRepository.findById(id, auth.clinicId);
    if (!row) {
      throw new AppError('Prescription not found', 404, 'NOT_FOUND');
    }
    if (row.status === 'cancelled') {
      throw new AppError('Prescription already cancelled', 409, 'ALREADY_CANCELLED');
    }
    if (row.status === 'dispensed') {
      throw new AppError('Dispensed prescriptions cannot be cancelled', 409, 'ERX_CANCEL_BLOCKED_DISPENSED');
    }
    const cancellationBlockedToken = await prescriptionRepository.findCancellationBlockedErxTokenForPrescription(
      id,
      auth.clinicId,
    );
    if (cancellationBlockedToken) {
      if (cancellationBlockedToken.status === 'locked') {
        throw new AppError('Prescription is locked for amendment and cannot be cancelled', 409, 'ERX_CANCEL_BLOCKED_LOCKED');
      }
      throw new AppError('Dispensed prescriptions cannot be cancelled', 409, 'ERX_CANCEL_BLOCKED_DISPENSED');
    }
    // BUG-P3 — S8 cancel also requires step-up (DH-4155 §3).
    if (row.is_s8) {
      await requireRecentStepUp(auth);
    }
    // BUG-371b — opt-locked status transition. expectedLockVersion
    // comes from the Zod-validated request body; concurrent edits
    // (e.g. another clinician dispensing while this one cancels) → 409.
    // BUG-553 — cancellation now persists reason + actor + timestamp via
    // the dedicated `cancelWithReason` repository path (sibling pattern of
    // medication-cease). AHPRA Standard 1 + S8 SafeScript forensic chain.
    const updated = await prescriptionRepository.cancelWithReason(
      id,
      auth.clinicId,
      reasonForCancellation,
      auth.staffId,
      expectedLockVersion,
    );
    // BUG-553 cycle-2 (L4 CONCERN-2 forensic-completeness) — capture the
    // self-contained snapshot of WHAT was cancelled so the audit_log row
    // alone reconstructs the cancellation without joining to the (possibly
    // soft-deleted) prescriptions row.
    await writeAuditLog({
      actorId: auth.staffId,
      clinicId: auth.clinicId,
      action: 'UPDATE',
      tableName: 'prescriptions',
      recordId: id,
      oldData: {
        status: row.status,
        cancellationReason: row.cancellation_reason,
        genericName: row.generic_name,
        dose: row.dose,
        isS8: row.is_s8,
        prescriptionCategory: row.prescription_category,
        prescribedDate: row.prescribed_date,
      },
      // BUG-P6 — include regulated eRx audit-extension fields directly in
      // cancellation audit payload for DH-3945 §2B / DH-4155 §4 traceability.
      // (operation metadata + timezone are now explicit and queryable.)
      // NOTE: this is prescription-level cancellation evidence; DSP token
      // revocation rows are emitted separately by escriptService.
      newData: {
        status: 'cancelled',
        cancellationReason: reasonForCancellation,
        operation: 'cancel',
        outcome: 'success',
        guid: id,
        timezone: getAuditTimezone(),
        auditedAt: new Date().toISOString(),
        auditSpec: 'dh3945-2B-dh4155-4',
      },
    });

    // BUG-553 cycle-2 (L4 CONCERN-1 lie-about-success) — DSP-side token
    // revocation. Pre-fix the dialog claimed "pharmacies cannot dispense
    // after cancellation" but the local DB flip alone is INSUFFICIENT —
    // an active eScript token at NPDS / eRx REST remains live until
    // explicitly revoked via ERX023 / NPDS PATCH. Two-phase posture:
    //   - Phase 1 (DB): always succeeds (above) — clinician sees their
    //     edit committed; UI can refresh.
    //   - Phase 2 (DSP): best-effort. On success → erx_tokens.status='cancelled'
    //     and dspRevocation='revoked'. On failure → keep token state +
    //     emit structured warn with kind:'ERX_CANCEL_DSP_FAILED' for the
    //     reconciliation cron (filed as BUG-553-FOLLOWUP-DSP-RECONCILE);
    //     return dspRevocation='pending' so the UI can warn the clinician
    //     that the pharmacy may still dispense.
    // Skipped when not electronic OR no active token exists (e.g. draft
    // never submitted) — dspRevocation='not-applicable'.
    let dspRevocation: 'revoked' | 'pending' | 'not-applicable' = 'not-applicable';
    if (updated.is_electronic && updated.erx_token) {
      const activeToken = await prescriptionRepository.findActiveErxTokenForPrescription(
        id,
        auth.clinicId,
      );
      if (activeToken) {
        const dspResult = await escriptService.cancelToken(
          auth.clinicId,
          auth.staffId,
          activeToken.token_value,
          reasonForCancellation,
          { scid: activeToken.dsp_id ?? undefined },
        );
        if (dspResult.success) {
          await prescriptionRepository.markErxTokenCancelled(activeToken.id, auth.clinicId);
          dspRevocation = 'revoked';
        } else {
          logger.warn(
            {
              kind: 'ERX_CANCEL_DSP_FAILED',
              prescriptionId: id,
              tokenId: activeToken.token_value,
              error: dspResult.error,
              clinicId: auth.clinicId,
            },
            '[Signacare] DSP token revocation failed — pharmacy may still dispense; reconciliation cron must catch',
          );
          dspRevocation = 'pending';
        }
      }
    }

    const cancelPatient = await patientRepository.findById(auth.clinicId, updated.patient_id);
    const cancelPatientIhi = cancelPatient ? decryptPhi(cancelPatient.ihi_number) : null;
    if (cancelPatientIhi && updated.erx_token) {
      const myslCancelSync = await syncMedicationRequestFromPrescription({
        patientIhi: cancelPatientIhi,
        prescriptionId: id,
        medicationRequestResource: buildMySLMedicationRequestFromPrescriptionRow(updated, 'cancelled'),
        status: 'cancelled',
        npdsReference: null,
        erxToken: updated.erx_token,
      });
      await writeAuditLog({
        actorId: auth.staffId,
        clinicId: auth.clinicId,
        action: 'UPDATE',
        tableName: 'prescriptions',
        recordId: id,
        newData: {
          operation: 'mysl_sync_cancel',
          outcome: myslCancelSync.success ? 'success' : 'skipped',
          action: myslCancelSync.action,
          reason: myslCancelSync.reason ?? null,
          error: myslCancelSync.error ?? null,
          medicationRequestId: myslCancelSync.medicationRequestId ?? null,
          patientFhirId: myslCancelSync.patientFhirId ?? null,
        },
      });
    }

    return { prescription: toResponse(updated), dspRevocation };
  },
};
