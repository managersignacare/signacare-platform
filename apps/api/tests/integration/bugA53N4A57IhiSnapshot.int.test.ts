import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import type { AuthContext } from '@signacare/shared';
import { isIntegrationReady } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';
import { decryptPhi, encryptPhi } from '../../src/utils/phiEncryption';
import { computePatientBlindIndexes } from '../../src/shared/blindIndex';
import { luhnCheck } from '../../src/shared/hiNumbers';
import { ihiConformanceService } from '../../src/features/prescriptions/ihiConformanceService';

function fixLuhn(fifteenDigits: string): string {
  for (let d = 0; d < 10; d++) {
    const candidate = `${fifteenDigits}${d}`;
    if (luhnCheck(candidate)) return candidate;
  }
  throw new Error('Unable to derive valid Luhn checksum for A5 snapshot fixture IHI');
}

describe.skipIf(!(await isIntegrationReady()))('BUG-A5.3 / BUG-N4 / BUG-A5.7 IHI snapshot contract', () => {
  let clinicId: string;
  let prescriberId: string;
  let patientId: string;
  let auth: AuthContext;
  let canonicalIhi: string;
  let baselineGivenName: string | null;
  let baselineFamilyName: string | null;
  let createdPatientForTest = false;

  beforeAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');

    const clinic = await dbAdmin('clinics')
      .where({ id: '11111111-1111-1111-1111-111111111111' })
      .first('id') as { id: string } | undefined;
    if (!clinic) throw new Error('A5 snapshot clinic fixture not found');
    clinicId = clinic.id;

    const prescriber = await dbAdmin('staff')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .where('discipline', 'psychiatry')
      .first('id') as { id: string } | undefined;
    const fallbackPrescriber = !prescriber
      ? await dbAdmin('staff')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .first('id') as { id: string } | undefined
      : undefined;
    const resolvedPrescriber = prescriber ?? fallbackPrescriber;
    if (!resolvedPrescriber) throw new Error('A5 snapshot prescriber fixture not found');
    prescriberId = resolvedPrescriber.id;

    const patient = await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereNotNull('ihi_number')
      .first('id', 'ihi_number', 'given_name', 'family_name') as
      | { id: string; ihi_number: string | null; given_name: string | null; family_name: string | null }
      | undefined;
    if (!patient) {
      createdPatientForTest = true;
      patientId = randomUUID();
      baselineGivenName = 'Ihi';
      baselineFamilyName = 'Snapshot';
      const seedBody = patientId.replace(/-/g, '').replace(/\D/g, '').slice(0, 9).padEnd(9, '7');
      canonicalIhi = fixLuhn(`800360${seedBody}`);
      await dbAdmin('patients').insert({
        id: patientId,
        clinic_id: clinicId,
        given_name: baselineGivenName,
        family_name: baselineFamilyName,
        date_of_birth: '1990-01-01',
        emr_number: `A53N4-${patientId.slice(0, 8)}`,
        ihi_number: encryptPhi(canonicalIhi),
        ihi_number_lookup: computePatientBlindIndexes({ ihiNumber: canonicalIhi }).ihi_number_lookup,
        created_at: new Date(),
        updated_at: new Date(),
      });
    } else {
      patientId = patient.id;
      baselineGivenName = patient.given_name;
      baselineFamilyName = patient.family_name;

      const decrypted = decryptPhi(patient.ihi_number);
      if (decrypted && /^800360\d{10}$/.test(decrypted) && luhnCheck(decrypted)) {
        canonicalIhi = decrypted;
      } else {
        const seedBody = patientId.replace(/-/g, '').replace(/\D/g, '').slice(0, 9).padEnd(9, '7');
        canonicalIhi = fixLuhn(`800360${seedBody}`);
      }
    }

    auth = {
      staffId: prescriberId,
      clinicId,
      role: 'clinician',
      permissions: ['prescription:create', 'prescription:update'],
      patientId,
      requestId: randomUUID(),
    } as AuthContext;
  });

  beforeEach(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const lookup = computePatientBlindIndexes({ ihiNumber: canonicalIhi }).ihi_number_lookup;

    await dbAdmin('hi_error_log').where({ clinic_id: clinicId, patient_id: patientId }).del();
    await dbAdmin('patient_ihis').where({ clinic_id: clinicId, patient_id: patientId }).del();
    await dbAdmin('patients')
      .where({ clinic_id: clinicId, id: patientId })
      .update({
        ihi_number: encryptPhi(canonicalIhi),
        ihi_number_lookup: lookup,
        ihi_record_status: null,
        ihi_number_status: null,
        ihi_verified_at: null,
        updated_at: new Date(),
      });
  });

  afterAll(async () => {
    if (!createdPatientForTest) return;
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('hi_error_log').where({ clinic_id: clinicId, patient_id: patientId }).del().catch(() => undefined);
    await dbAdmin('patient_ihis').where({ clinic_id: clinicId, patient_id: patientId }).del().catch(() => undefined);
    await dbAdmin('patients').where({ clinic_id: clinicId, id: patientId }).del().catch(() => undefined);
  });

  it('T1 — truncates HI display name to 40 chars, preserves patient names, and emits N4 disclosure audit payload', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const longDisplayName = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890LONGTAIL';

    await withTenantContext(clinicId, async () => {
      await ihiConformanceService.persistVerificationSnapshot(auth, {
        patientId,
        ihi: canonicalIhi,
        recordStatus: 'verified',
        numberStatus: 'active',
        source: 'hi_search',
        displayName: longDisplayName,
      });
    });

    const patientSnapshot = await dbAdmin('patients')
      .where({ clinic_id: clinicId, id: patientId })
      .first('given_name', 'family_name', 'ihi_record_status', 'ihi_number_status') as
      | {
        given_name: string | null;
        family_name: string | null;
        ihi_record_status: string | null;
        ihi_number_status: string | null;
      }
      | undefined;
    expect(patientSnapshot?.given_name).toBe(baselineGivenName);
    expect(patientSnapshot?.family_name).toBe(baselineFamilyName);
    expect(patientSnapshot?.ihi_record_status).toBe('verified');
    expect(patientSnapshot?.ihi_number_status).toBe('active');

    const historyRow = await dbAdmin('patient_ihis')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .orderBy('created_at', 'desc')
      .first(
        'id',
        'source',
        'record_status',
        'number_status',
        'hi_display_name_original',
        'hi_display_name_40',
        'hi_name_was_truncated',
      ) as
      | {
        id: string;
        source: string;
        record_status: string;
        number_status: string;
        hi_display_name_original: string | null;
        hi_display_name_40: string | null;
        hi_name_was_truncated: boolean;
      }
      | undefined;
    expect(historyRow).toBeDefined();
    expect(historyRow?.source).toBe('hi_search');
    expect(historyRow?.record_status).toBe('verified');
    expect(historyRow?.number_status).toBe('active');
    expect(historyRow?.hi_display_name_original).toBe(longDisplayName);
    expect(historyRow?.hi_display_name_40).toBe(longDisplayName.slice(0, 40));
    expect(historyRow?.hi_name_was_truncated).toBe(true);

    const auditRows = await dbAdmin('audit_log')
      .where({
        clinic_id: clinicId,
        table_name: 'patient_ihis',
      })
      .orderBy('created_at', 'desc')
      .limit(25)
      .select('new_data');
    const matchingAudit = auditRows
      .map((row: { new_data: Record<string, unknown> | string }) => (
        typeof row.new_data === 'string'
          ? JSON.parse(row.new_data)
          : row.new_data
      ))
      .find((newData: Record<string, unknown>) => (
        newData?.bug === 'BUG-N4'
        && (newData?.fields as Record<string, unknown> | undefined)?.patientId === patientId
        && (newData?.fields as Record<string, unknown> | undefined)?.historyRowId === historyRow?.id
      ));
    expect(matchingAudit).toBeDefined();
    const newData = matchingAudit as Record<string, unknown>;
    expect(newData.disclosureAuditVersion).toBe('10-field-hi-disclosure-v1');
    expect(newData.bug).toBe('BUG-N4');
    const fields = newData.fields as Record<string, unknown>;
    expect(Object.keys(fields)).toHaveLength(10);
    expect(fields).toMatchObject({
      clinicId,
      patientId,
      actorId: prescriberId,
      ihiRecordStatus: 'verified',
      ihiNumberStatus: 'active',
      source: 'hi_search',
      hiDisplayName40: longDisplayName.slice(0, 40),
      hiDisplayNameWasTruncated: true,
    });
  });

  it('T2 — records HI failure forensics in hi_error_log', async () => {
    const { dbAdmin } = await import('../../src/db/db');

    await withTenantContext(clinicId, async () => {
      await ihiConformanceService.recordHiFailure(auth, {
        patientId,
        operation: 'search_ihi',
        errorCode: 'HI_SEARCH_ERROR',
        errorMessage: 'synthetic hi service timeout',
        statusCode: 504,
        requestRef: 'req-a5n4-test',
        context: { path: 'medicare', synthetic: true },
      });
    });

    const errorRow = await dbAdmin('hi_error_log')
      .where({ clinic_id: clinicId, patient_id: patientId, operation: 'search_ihi' })
      .orderBy('created_at', 'desc')
      .first(
        'error_code',
        'error_message',
        'status_code',
        'request_ref',
        'created_by_staff_id',
        'context',
      ) as
      | {
        error_code: string | null;
        error_message: string;
        status_code: number | null;
        request_ref: string | null;
        created_by_staff_id: string | null;
        context: Record<string, unknown> | null;
      }
      | undefined;
    expect(errorRow).toBeDefined();
    expect(errorRow?.error_code).toBe('HI_SEARCH_ERROR');
    expect(errorRow?.error_message).toBe('synthetic hi service timeout');
    expect(errorRow?.status_code).toBe(504);
    expect(errorRow?.request_ref).toBe('req-a5n4-test');
    expect(errorRow?.created_by_staff_id).toBe(prescriberId);
    expect(errorRow?.context).toMatchObject({ path: 'medicare', synthetic: true });
  });
});
