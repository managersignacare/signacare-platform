import { randomUUID } from 'crypto';
import type { AuthContext } from '@signacare/shared';
import { db, dbAdmin } from '../../db/db';
import { AppError } from '../../shared/errors';
import { encryptPhi } from '../../utils/phiEncryption';
import { computePatientBlindIndexes } from '../../shared/blindIndex';
import { writeAuditLog } from '../../utils/audit';
import { validateIhiFormat } from '../../integrations/hiService/hiServiceClient';

export type IhiRecordStatus = 'verified' | 'unverified' | 'provisional';
export type IhiNumberStatus = 'active' | 'deceased' | 'retired' | 'expired' | 'resolved';
export type IhiSource = 'hi_search' | 'hi_verify' | 'manual' | 'fhir_ingest';

const PRESCRIBE_ALLOWED_RECORD_STATUS: readonly IhiRecordStatus[] = ['verified'];
const PRESCRIBE_ALLOWED_NUMBER_STATUS: readonly IhiNumberStatus[] = ['active'];

type PersistSnapshotInput = {
  patientId: string;
  ihi: string;
  recordStatus: IhiRecordStatus;
  numberStatus: IhiNumberStatus;
  source: IhiSource;
  displayName?: string | null;
  verifiedAt?: string | Date | null;
};

type HiFailureInput = {
  patientId?: string | null;
  operation: string;
  errorCode?: string | null;
  errorMessage: string;
  statusCode?: number | null;
  requestRef?: string | null;
  context?: Record<string, unknown> | null;
};

type LatestIhiStatus = {
  recordStatus: IhiRecordStatus | null;
  numberStatus: IhiNumberStatus | null;
  verifiedAt: string | null;
};

function normalizeDisplayName40(
  value: string | null | undefined,
): { original: string | null; normalized40: string | null; truncated: boolean } {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return { original: null, normalized40: null, truncated: false };
  if (trimmed.length <= 40) return { original: trimmed, normalized40: trimmed, truncated: false };
  return { original: trimmed, normalized40: trimmed.slice(0, 40), truncated: true };
}

function toIso(value: string | Date | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

async function writeHiErrorLog(input: {
  clinicId?: string | null;
  patientId?: string | null;
  actorId?: string | null;
  operation: string;
  errorCode?: string | null;
  errorMessage: string;
  statusCode?: number | null;
  requestRef?: string | null;
  context?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await dbAdmin('hi_error_log').insert({
      id: randomUUID(),
      clinic_id: input.clinicId ?? null,
      patient_id: input.patientId ?? null,
      operation: input.operation,
      status_code: input.statusCode ?? null,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage,
      request_ref: input.requestRef ?? null,
      context: input.context ?? null,
      created_by_staff_id: input.actorId ?? null,
      created_at: new Date(),
    });
  } catch {
    // intentional silent — best-effort forensic write only; clinical
    // safety flow must not be blocked if hi_error_log persistence fails
  }
}

async function readLatestIhiStatus(
  clinicId: string,
  patientId: string,
): Promise<LatestIhiStatus> {
  const latestHistory = await db('patient_ihis')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .orderBy('created_at', 'desc')
    .first([
      'record_status',
      'number_status',
      'hi_verified_at',
    ]) as
    | {
      record_status: IhiRecordStatus;
      number_status: IhiNumberStatus;
      hi_verified_at: Date | string | null;
    }
    | undefined;
  if (latestHistory) {
    return {
      recordStatus: latestHistory.record_status,
      numberStatus: latestHistory.number_status,
      verifiedAt: latestHistory.hi_verified_at
        ? new Date(latestHistory.hi_verified_at).toISOString()
        : null,
    };
  }

  const patient = await db('patients')
    .where({ clinic_id: clinicId, id: patientId })
    .whereNull('deleted_at')
    .first([
      'ihi_record_status',
      'ihi_number_status',
      'ihi_verified_at',
    ]) as
    | {
      ihi_record_status: IhiRecordStatus | null;
      ihi_number_status: IhiNumberStatus | null;
      ihi_verified_at: Date | string | null;
    }
    | undefined;

  return {
    recordStatus: patient?.ihi_record_status ?? null,
    numberStatus: patient?.ihi_number_status ?? null,
    verifiedAt: patient?.ihi_verified_at ? new Date(patient.ihi_verified_at).toISOString() : null,
  };
}

export const ihiConformanceService = {
  normalizeDisplayName40,

  async persistVerificationSnapshot(
    auth: AuthContext,
    input: PersistSnapshotInput,
  ): Promise<void> {
    if (!validateIhiFormat(input.ihi)) {
      throw new AppError('Invalid IHI format', 422, 'VALIDATION_ERROR');
    }
    const verifiedAtIso = toIso(input.verifiedAt);
    const display = normalizeDisplayName40(input.displayName);
    const encryptedIhi = encryptPhi(input.ihi);
    const ihiLookup = computePatientBlindIndexes({ ihiNumber: input.ihi }).ihi_number_lookup;
    if (!encryptedIhi || !ihiLookup) {
      throw new AppError('Unable to persist IHI snapshot', 500, 'IHI_PERSISTENCE_FAILED');
    }

    await db.transaction(async (trx) => {
      const patient = await trx('patients')
        .where({ clinic_id: auth.clinicId, id: input.patientId })
        .whereNull('deleted_at')
        .first(['id']);
      if (!patient) {
        throw new AppError('Patient not found', 404, 'NOT_FOUND');
      }

      await trx('patients')
        .where({ clinic_id: auth.clinicId, id: input.patientId })
        // @ihi-write-exempt: bug-a5-3-canonical-hi-snapshot-writer
        .update({
          ihi_number: encryptedIhi,
          ihi_number_lookup: ihiLookup,
          ihi_record_status: input.recordStatus,
          ihi_number_status: input.numberStatus,
          ihi_verified_at: verifiedAtIso,
          updated_at: new Date(),
        });

      const historyId = randomUUID();
      await trx('patient_ihis').insert({
        id: historyId,
        clinic_id: auth.clinicId,
        patient_id: input.patientId,
        ihi_value: encryptedIhi,
        ihi_lookup: ihiLookup,
        record_status: input.recordStatus,
        number_status: input.numberStatus,
        source: input.source,
        hi_verified_at: verifiedAtIso,
        hi_display_name_original: display.original,
        hi_display_name_40: display.normalized40,
        hi_name_was_truncated: display.truncated,
        created_by_staff_id: auth.staffId,
        created_at: new Date(),
      });

      await writeAuditLog({
        clinicId: auth.clinicId,
        actorId: auth.staffId,
        action: 'UPDATE',
        tableName: 'patients',
        recordId: input.patientId,
        newData: {
          bug: 'BUG-A5.3',
          source: input.source,
          ihiRecordStatus: input.recordStatus,
          ihiNumberStatus: input.numberStatus,
          ihiVerifiedAt: verifiedAtIso,
          hiDisplayNameWasTruncated: display.truncated,
        },
      });
      await writeAuditLog({
        clinicId: auth.clinicId,
        actorId: auth.staffId,
        action: 'CREATE',
        tableName: 'patient_ihis',
        recordId: historyId,
        newData: {
          bug: 'BUG-N4',
          source: input.source,
          ihiRecordStatus: input.recordStatus,
          ihiNumberStatus: input.numberStatus,
          ihiVerifiedAt: verifiedAtIso,
          disclosureAuditVersion: '10-field-hi-disclosure-v1',
          fields: {
            clinicId: auth.clinicId,
            patientId: input.patientId,
            actorId: auth.staffId,
            ihiRecordStatus: input.recordStatus,
            ihiNumberStatus: input.numberStatus,
            source: input.source,
            verifiedAt: verifiedAtIso,
            hiDisplayName40: display.normalized40,
            hiDisplayNameWasTruncated: display.truncated,
            historyRowId: historyId,
          },
        },
      });
    });
  },

  async assertPrescribeEligibleIhiStatus(
    auth: AuthContext,
    patientId: string,
  ): Promise<void> {
    const latest = await readLatestIhiStatus(auth.clinicId, patientId);
    const recordStatus = latest.recordStatus;
    const numberStatus = latest.numberStatus;

    if (
      recordStatus
      && numberStatus
      && PRESCRIBE_ALLOWED_RECORD_STATUS.includes(recordStatus)
      && PRESCRIBE_ALLOWED_NUMBER_STATUS.includes(numberStatus)
    ) {
      return;
    }

    await writeHiErrorLog({
      clinicId: auth.clinicId,
      patientId,
      actorId: auth.staffId,
      operation: 'prescribe_ihi_status_gate',
      errorCode: 'IHI_NOT_PRESCRIBABLE',
      errorMessage: 'IHI status is not eligible for prescribing',
      context: {
        recordStatus,
        numberStatus,
        verifiedAt: latest.verifiedAt,
        allowedRecordStatuses: PRESCRIBE_ALLOWED_RECORD_STATUS,
        allowedNumberStatuses: PRESCRIBE_ALLOWED_NUMBER_STATUS,
      },
    });

    throw new AppError(
      'Patient IHI is not eligible for prescribing (requires active + verified)',
      409,
      'IHI_NOT_PRESCRIBABLE',
      {
        recordStatus,
        numberStatus,
        verifiedAt: latest.verifiedAt,
      },
    );
  },

  async recordHiFailure(auth: AuthContext, input: HiFailureInput): Promise<void> {
    await writeHiErrorLog({
      clinicId: auth.clinicId,
      patientId: input.patientId ?? null,
      actorId: auth.staffId,
      operation: input.operation,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage,
      statusCode: input.statusCode ?? null,
      requestRef: input.requestRef ?? null,
      context: input.context ?? null,
    });
  },
};
