import type { NextFunction, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { adminPoolRaw, db } from '../../db/db';
import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import {
  PATIENT_APP_REGISTRATION_REQUESTS_COLUMNS,
  type PatientAppRegistrationRequestsRow,
} from '../../db/types/patient_app_registration_requests';
import { encryptPhi } from '../../shared/phiEncryption';
import { withTenantContext } from '../../shared/tenantContext';
import { PatientRegistrationRequestSchema } from './patientAppSchemas';

const PatientRegistrationResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});

const PUBLIC_REGISTRATION_ACCEPTED_RESPONSE = {
  ok: true,
  message: 'Registration submitted. If this matches your clinic records, the clinic will contact you about activation.',
} as const;

type RegistrationClinicRow = {
  id: string;
  name: string | null;
};

type RegistrationRequestSummary = Pick<PatientAppRegistrationRequestsRow, 'id' | 'status'>;

type PatientAppRegistrationRequestResponse = {
  id: string;
  clinicId: string;
  status: string;
  source: string;
  clientRequestId: string | null | undefined;
  address: unknown;
  nextOfKin: unknown;
  gp: unknown;
  supportPerson: unknown;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export function patientAppRegistrationRequestToResponse(
  row: PatientAppRegistrationRequestsRow,
): PatientAppRegistrationRequestResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    status: row.status,
    source: row.source,
    clientRequestId: row.client_request_id,
    address: row.address,
    nextOfKin: row.next_of_kin,
    gp: row.gp,
    supportPerson: row.support_person,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeDobInput(input: string): string | null {
  const trimmed = input.trim();
  const isRealDate = (yyyy: number, mm: number, dd: number): boolean => {
    const date = new Date(Date.UTC(yyyy, mm - 1, dd));
    return date.getUTCFullYear() === yyyy
      && date.getUTCMonth() === mm - 1
      && date.getUTCDate() === dd;
  };

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return isRealDate(Number(yyyy), Number(mm), Number(dd)) ? trimmed : null;
  }
  const auMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!auMatch) return null;
  const [, dd, mm, yyyy] = auMatch;
  if (!isRealDate(Number(yyyy), Number(mm), Number(dd))) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function compactPhone(input: string): string {
  return input.trim().replace(/[^\d+]/g, '');
}

function registrationDedupePepper(): { key: string; version: string } {
  const key = (process.env.PATIENT_APP_DEDUPE_PEPPER ?? '').trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new AppError(
      'Patient-app registration dedupe secret is not configured',
      503,
      'PATIENT_APP_DEDUPE_SECRET_MISSING',
    );
  }

  const version = (process.env.PATIENT_APP_DEDUPE_PEPPER_VERSION ?? 'v1').trim();
  if (!/^v\d+$/i.test(version)) {
    throw new AppError(
      'Patient-app registration dedupe secret version is invalid',
      503,
      'PATIENT_APP_DEDUPE_SECRET_VERSION_INVALID',
    );
  }

  return { key, version: version.toLowerCase() };
}

function buildRegistrationDedupeKey(input: {
  clinicId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  phoneMobile: string;
  email?: string;
}): string {
  const { key, version } = registrationDedupePepper();
  const canonical = [
    input.clinicId,
    input.givenName.trim().toLocaleLowerCase('en-AU'),
    input.familyName.trim().toLocaleLowerCase('en-AU'),
    input.dateOfBirth,
    compactPhone(input.phoneMobile),
    (input.email ?? '').trim().toLocaleLowerCase('en-AU'),
  ].join('|');

  return `${version}:${createHmac('sha256', Buffer.from(key, 'hex')).update(canonical).digest('hex')}`;
}

async function resolveRegistrationClinic(input: {
  clinicId?: string;
  clinicName?: string;
}): Promise<RegistrationClinicRow | null> {
  if (input.clinicId) {
    const row = await adminPoolRaw('clinics')
      .where({ id: input.clinicId, is_active: true })
      .whereNull('deleted_at')
      .first('id', 'name') as RegistrationClinicRow | undefined;
    return row ?? null;
  }

  const activeClinics = await adminPoolRaw('clinics')
    .where({ is_active: true })
    .whereNull('deleted_at')
    .select('id', 'name') as RegistrationClinicRow[];

  const requestedName = input.clinicName?.trim();
  if (requestedName) {
    const normalized = requestedName.toLocaleLowerCase('en-AU');
    const exact = activeClinics.find((clinic) => (clinic.name ?? '').trim().toLocaleLowerCase('en-AU') === normalized);
    if (exact) return exact;
    return null;
  }

  const configuredDefault = process.env.PATIENT_APP_DEFAULT_CLINIC_ID?.trim();
  if (configuredDefault) {
    const row = activeClinics.find((clinic) => clinic.id === configuredDefault);
    if (row) return row;
    logger.warn(
      { configuredDefault },
      'Patient-app default clinic is not active; public registration accepted generically without storing a request',
    );
    return null;
  }

  if (activeClinics.length === 1) return activeClinics[0]!;
  return null;
}

function encryptRequiredPhi(value: string): string {
  const encrypted = encryptPhi(value);
  if (!encrypted) throw new AppError('Unable to protect registration request', 500, 'PHI_ENCRYPTION_FAILED');
  return encrypted;
}

function encryptOptionalPhi(value: string | null | undefined): string | null {
  if (!value) return null;
  return encryptRequiredPhi(value);
}

function encryptJsonPhi(value: unknown): Record<string, unknown> {
  if (!value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
    return {};
  }
  const encrypted = encryptPhi(JSON.stringify(value));
  if (!encrypted) throw new AppError('Unable to protect registration request', 500, 'PHI_ENCRYPTION_FAILED');
  return {
    encoding: 'phi-aes-256-gcm-json-v1',
    ciphertext: encrypted,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

async function findPendingRegistrationRequest(input: {
  clinicId: string;
  dedupeKey: string;
}): Promise<RegistrationRequestSummary | undefined> {
  return db<PatientAppRegistrationRequestsRow>('patient_app_registration_requests')
    .where({ clinic_id: input.clinicId, dedupe_key: input.dedupeKey, status: 'pending' })
    .whereNull('deleted_at')
    .orderBy('created_at', 'desc')
    .first('id', 'status') as Promise<RegistrationRequestSummary | undefined>;
}

export async function handlePatientAppRegistration(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = PatientRegistrationRequestSchema.parse(req.body);
    if (dto.consentToContact !== true) {
      throw new AppError(
        'Consent to contact is required to submit a registration request',
        422,
        'PATIENT_APP_CONTACT_CONSENT_REQUIRED',
      );
    }

    const clinic = await resolveRegistrationClinic({ clinicId: dto.clinicId, clinicName: dto.clinicName });
    if (!clinic) {
      logger.info(
        {
          hasClinicId: Boolean(dto.clinicId),
          hasClinicName: Boolean(dto.clinicName),
        },
        'Viva registration request accepted generically; no active clinic match disclosed',
      );
      res.status(202).json(PatientRegistrationResponseSchema.parse(PUBLIC_REGISTRATION_ACCEPTED_RESPONSE));
      return;
    }

    const normalizedDob = normalizeDobInput(dto.dateOfBirth);
    if (!normalizedDob) {
      throw new AppError('Date of birth must be YYYY-MM-DD or DD/MM/YYYY', 422, 'VALIDATION_ERROR');
    }

    const dedupeKey = buildRegistrationDedupeKey({
      clinicId: clinic.id,
      givenName: dto.givenName,
      familyName: dto.familyName,
      dateOfBirth: normalizedDob,
      phoneMobile: dto.phoneMobile,
      email: dto.email,
    });

    const existing = await withTenantContext(
      clinic.id,
      () => findPendingRegistrationRequest({ clinicId: clinic.id, dedupeKey }),
    );

    if (existing) {
      logger.info(
        { requestId: existing.id, clinicId: clinic.id, duplicate: true },
        'Viva registration request deduped for staff review',
      );
      res.status(202).json(PatientRegistrationResponseSchema.parse(PUBLIC_REGISTRATION_ACCEPTED_RESPONSE));
      return;
    }

    let created: PatientAppRegistrationRequestsRow | undefined;
    try {
      created = await withTenantContext(clinic.id, async () => {
        const [row] = await db<PatientAppRegistrationRequestsRow>('patient_app_registration_requests')
          .insert({
            clinic_id: clinic.id,
            dedupe_key: dedupeKey,
            given_name: encryptRequiredPhi(dto.givenName),
            family_name: encryptRequiredPhi(dto.familyName),
            preferred_name: encryptOptionalPhi(dto.preferredName),
            date_of_birth: encryptRequiredPhi(normalizedDob),
            gender: encryptOptionalPhi(dto.gender),
            phone_mobile: encryptRequiredPhi(dto.phoneMobile),
            email: encryptOptionalPhi(dto.email),
            address: encryptJsonPhi(dto.address ?? {}),
            next_of_kin: encryptJsonPhi(dto.nextOfKin ?? {}),
            gp: encryptJsonPhi(dto.gp ?? {}),
            support_person: encryptJsonPhi(dto.supportPerson ?? {}),
            reason: encryptOptionalPhi(dto.reason),
            source: 'viva_patient_app',
            status: 'pending',
            client_request_id: dto.clientRequestId ?? null,
            metadata: {
              submittedVia: 'patient-app-register-screen',
              clinicName: clinic.name,
              phiStorage: 'encrypted-at-rest',
            },
          })
          .returning(PATIENT_APP_REGISTRATION_REQUESTS_COLUMNS);

        if (!row) return undefined;

        await writeAuditLog({
          clinicId: clinic.id,
          actorId: 'patient-app-public-registration',
          ipAddress: req.ip,
          tableName: 'patient_app_registration_requests',
          recordId: row.id,
          action: 'CREATE',
          newData: {
            source: 'viva_patient_app',
            status: 'pending',
            submittedVia: 'patient-app-register-screen',
            clientRequestIdPresent: Boolean(dto.clientRequestId),
            phiStorage: 'encrypted-at-rest',
          },
        });

        return row;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      created = await withTenantContext(
        clinic.id,
        () => findPendingRegistrationRequest({ clinicId: clinic.id, dedupeKey }) as Promise<PatientAppRegistrationRequestsRow | undefined>,
      );
    }

    if (!created) throw new AppError('Unable to record registration request', 500, 'REGISTRATION_REQUEST_CREATE_FAILED');

    logger.info(
      { requestId: created.id, clinicId: clinic.id },
      'Viva registration request submitted for staff review',
    );

    res.status(202).json(PatientRegistrationResponseSchema.parse(PUBLIC_REGISTRATION_ACCEPTED_RESPONSE));
  } catch (err) {
    next(err);
  }
}
