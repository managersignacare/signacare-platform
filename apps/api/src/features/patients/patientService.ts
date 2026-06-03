import { v4 as uuidv4 } from 'uuid';
import { encryptPhi, decryptPhi } from '../../utils/phiEncryption';
import type {
  AuthContext,
  CreatePatientDTO,
  UpdatePatientDTO,
  PatientResponse,
  PatientSearchDTO,
  PaginatedResponse,
} from '@signacare/shared';
import { buildPaginatedResponse } from '@signacare/shared';
import { patientRepository, type PatientRow } from './patientRepository';
import { AppError, ErrorCode }                from '../../shared/errors';
import { requirePermission }                  from '../../shared/authGuards';
import { writeAuditLog }                      from '../../utils/audit';
import { generatePatientNumber }              from '../../shared/utils/numberGenerator';
import { findDuplicateCandidates }            from './duplicateDetection';
import { computePatientBlindIndexes }         from '../../shared/blindIndex';
import { db }                                 from '../../db/db';
import type { Knex }                          from 'knex';
import { ensureInitialTeamAssignmentForPatient } from './patientInitialTeamAssignment';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toIso(d: Date | string | null): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

/** Convert Medicare expiry from MM/YYYY or MMYYYY to YYYY-MM-01 date string */
function normaliseMedicareExpiry(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/YYYY
  const slash = s.match(/^(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[2]}-${slash[1]}-01`;
  // MMYYYY
  const compact = s.match(/^(\d{2})(\d{4})$/);
  if (compact) return `${compact[2]}-${compact[1]}-01`;
  // YYYY-MM
  const ym = s.match(/^(\d{4})-(\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}-01`;
  return null; // Unrecognised format — skip rather than crash
}

function normaliseDuplicateToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function duplicateGuardKey(dto: Pick<CreatePatientDTO, 'givenName' | 'familyName' | 'dateOfBirth'>): string {
  return [
    normaliseDuplicateToken(dto.givenName),
    normaliseDuplicateToken(dto.familyName),
    dto.dateOfBirth.trim(),
  ].join('|');
}

// DB contract guard (defence-in-depth): keep service-layer writes within
// declared varchar widths even if an upstream schema drifts or a caller
// bypasses shared DTO validation.
const PATIENT_DB_VARCHAR_LIMITS: Record<string, number> = {
  givenName: 100,
  familyName: 100,
  preferredName: 100,
  gender: 30,
  pronouns: 50,
  medicareNumber: 30,
  medicareIrn: 10,
  ihi: 30,
  dvaNumber: 30,
  dvaCardType: 20,
  phoneMobile: 30,
  phoneHome: 30,
  emailPrimary: 255,
  addressStreet: 255,
  addressSuburb: 100,
  addressState: 30,
  addressPostcode: 10,
  healthFundName: 100,
  healthFundNumber: 50,
  gpName: 200,
  gpPractice: 200,
  gpPhone: 30,
  gpFax: 30,
  gpEmail: 255,
  gpProviderNumber: 30,
  gpAddressStreet: 255,
  gpAddressSuburb: 100,
  gpAddressState: 20,
  gpAddressPostcode: 10,
  nokName: 200,
  nokRelationship: 100,
  nokPhone: 30,
  atsiStatus: 50,
  interpreterLanguage: 100,
  status: 30,
};

function assertPatientStringLengthContract(input: Record<string, unknown>): void {
  for (const [field, max] of Object.entries(PATIENT_DB_VARCHAR_LIMITS)) {
    const value = input[field];
    if (typeof value !== 'string') continue;
    if (value.length <= max) continue;
    throw new AppError(
      `Field ${field} exceeds maximum length (${max} characters).`,
      422,
      ErrorCode.VALIDATION_ERROR,
      {
        field,
        maxLength: max,
        actualLength: value.length,
      },
    );
  }
}

async function acquireDuplicateGuardLock(
  trx: Knex.Transaction,
  clinicId: string,
  key: string,
): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [clinicId, key]);
}

function rowToResponse(row: PatientRow): PatientResponse {
  return {
    id:               row.id,
    clinicId:         row.clinic_id,
    emrNumber:        row.emr_number,
    givenName:        row.given_name,
    familyName:       row.family_name,
    preferredName:    row.preferred_name   ?? null,
    dateOfBirth:      typeof row.date_of_birth === 'string' ? row.date_of_birth : (row.date_of_birth as unknown as Date).toISOString().split('T')[0],
    gender:           row.gender           ?? null,
    pronouns:         row.pronouns         ?? null,
    medicareNumber:   decryptPhi(row.medicare_number)  ?? null,
    medicareIrn:      row.medicare_reference ?? null,
    medicareExpiry:   row.medicare_expiry  ?? null,
    ihi:              decryptPhi(row.ihi_number)       ?? null,
    dvaNumber:        decryptPhi(row.dva_number)       ?? null,
    dvaCardType:      row.dva_card_type    ?? null,
    phoneMobile:      row.phone_mobile     ?? null,
    phoneHome:        row.phone_home       ?? null,
    emailPrimary:     row.email_primary    ?? null,
    addressStreet:    row.address_line1    ?? null,
    addressSuburb:    row.suburb           ?? null,
    addressState:     row.state            ?? null,
    addressPostcode:  row.postcode         ?? null,
    healthFundName:   row.health_fund_name ?? null,
    healthFundNumber: row.health_fund_number ?? null,
    gpName:            row.gp_name             ?? null,
    gpPractice:        row.gp_practice         ?? null,
    gpPhone:           row.gp_phone            ?? null,
    gpFax:             row.gp_fax              ?? null,
    gpEmail:           row.gp_email            ?? null,
    gpProviderNumber:  row.gp_provider_number  ?? null,
    gpAddressStreet:   row.gp_address_street   ?? null,
    gpAddressSuburb:   row.gp_address_suburb   ?? null,
    gpAddressState:    row.gp_address_state    ?? null,
    gpAddressPostcode: row.gp_address_postcode ?? null,
    nokName:           row.nok_name            ?? null,
    nokRelationship:      row.nok_relationship           ?? null,
    nokPhone:             row.nok_phone                 ?? null,
    atsiStatus:           row.atsi_status               ?? null,
    interpreterRequired:  row.interpreter_required      ?? false,
    interpreterLanguage:  row.interpreter_language      ?? null,
    consentToTreatment:   row.consent_to_treatment      ?? false,
    consentForResearch:   row.consent_for_research      ?? false,
    consentToShareWithGp: row.consent_to_share_with_gp  ?? false,
    consentToShareWithCarer: row.consent_to_share_with_carer ?? false,
    status:               row.status ?? 'active',
    flags:            null,
    createdAt:        toIso(row.created_at)!,
    updatedAt:        toIso(row.updated_at)!,
    deletedAt:        toIso(row.deleted_at),
  };
}

export const patientService = {
  // ── CREATE ────────────────────────────────────────────────────────────────
  async create(
    auth: AuthContext,
    dto:  CreatePatientDTO,
  ): Promise<PatientResponse> {
    requirePermission(auth, 'patient:create');
    assertPatientStringLengthContract(dto as unknown as Record<string, unknown>);
    const clinicId = auth.clinicId;
    const actorId = auth.staffId;
    const duplicateInput = {
      givenName: dto.givenName,
      familyName: dto.familyName,
      dateOfBirth: dto.dateOfBirth,
      medicareNumber: dto.medicareNumber,
      medicareIrn: dto.medicareIrn,
      ihiNumber: dto.ihi,
      dvaNumber: dto.dvaNumber,
      phoneMobile: dto.phoneMobile,
      addressLine1: dto.addressStreet,
      postcode: dto.addressPostcode,
    };

    const row = await db.transaction(async (trx) => {
      // Concurrency hardening: serialise competing create attempts for the
      // same clinic + exact given/family/DOB tuple so duplicate detection
      // and insert happen atomically under one transaction lock.
      await acquireDuplicateGuardLock(trx, clinicId, duplicateGuardKey(dto));

      // Duplicate guard (S7.1) — multi-signal scoring via blind indexes on
      // Medicare / IHI / DVA plus fuzzy name + DOB matching. Any deterministic
      // identifier match (confidence=definite) OR strong probabilistic match
      // (score >= 0.80) blocks the registration. "Probable" matches (0.60-0.80)
      // are allowed through but surfaced to the caller via the dedicated
      // POST /patients/duplicates/check endpoint the frontend wizard calls
      // BEFORE submitting — so the clinician has already reviewed them.
      const candidates = await findDuplicateCandidates(clinicId, duplicateInput, undefined, trx);
      const blockingCandidates = candidates.filter(
        (c) => c.confidence === 'definite' || c.confidence === 'strong',
      );
      if (blockingCandidates.length > 0) {
        throw new AppError(
          'Potential duplicate patient detected',
          409,
          ErrorCode.DUPLICATE_PATIENT,
          {
            duplicateIds: blockingCandidates.map((c) => c.patient.id),
            candidates: blockingCandidates.map((c) => ({
              id: c.patient.id,
              emrNumber: c.patient.emr_number,
              score: c.score,
              confidence: c.confidence,
              matchedOn: c.matchedOn,
            })),
          },
        );
      }

      const emrNumber = await generatePatientNumber(clinicId, trx);

      // S7.1 — compute blind indexes alongside the AES-GCM ciphertext so
      // subsequent duplicate detection and patient lookup can do deterministic
      // equality queries on Medicare/IHI/DVA without decrypting every row.
      // The HMAC key is separate from the encryption key (enforced in
      // blindIndex.ts). Safe for all deployments; if BLIND_INDEX_KEY is
      // missing, blindIndex.ts throws and the create fails loudly rather
      // than silently disabling duplicate protection.
      const blindIndexes = computePatientBlindIndexes({
        medicareNumber: dto.medicareNumber,
        ihiNumber: dto.ihi,
        dvaNumber: dto.dvaNumber,
      });

      const createdPatient = await patientRepository.create({
        id:                 uuidv4(),
        clinic_id:          clinicId,
        emr_number:         emrNumber,
        given_name:         dto.givenName,
        family_name:        dto.familyName,
        preferred_name:     dto.preferredName    ?? null,
        date_of_birth:      dto.dateOfBirth,
        gender:             dto.gender           ?? null,
        pronouns:           dto.pronouns         ?? null,
        medicare_number:    encryptPhi(dto.medicareNumber)   ?? null,
        medicare_number_lookup: blindIndexes.medicare_number_lookup,
        ihi_number_lookup:  blindIndexes.ihi_number_lookup,
        dva_number_lookup:  blindIndexes.dva_number_lookup,
        medicare_reference: dto.medicareIrn      ?? null,
        medicare_expiry:    normaliseMedicareExpiry(dto.medicareExpiry),
        ihi_number:         encryptPhi(dto.ihi)              ?? null,
        // BUG-WF31 / BUG-A5.3:
        // `patients_ihi_number_status_check` only allows
        // active|deceased|retired|expired|resolved (or null).
        // At manual entry time we don't yet know number_status until HI
        // verification runs, so keep it null and mark record_status
        // unverified.
        ihi_record_status:  dto.ihi ? 'unverified' : null,
        ihi_number_status:  null,
        dva_number:         encryptPhi(dto.dvaNumber)        ?? null,
        dva_card_type:      dto.dvaCardType      ?? null,
        phone_mobile:       dto.phoneMobile      ?? null,
        phone_home:         dto.phoneHome        ?? null,
        email_primary:      dto.emailPrimary     ?? null,
        address_line1:      dto.addressStreet    ?? null,
        suburb:             dto.addressSuburb    ?? null,
        state:              dto.addressState     ?? null,
        postcode:           dto.addressPostcode  ?? null,
        gp_name:            dto.gpName           ?? null,
        gp_practice:        dto.gpPractice       ?? null,
        gp_phone:           dto.gpPhone          ?? null,
        gp_fax:             dto.gpFax            ?? null,
        gp_email:           dto.gpEmail          ?? null,
        gp_provider_number: dto.gpProviderNumber ?? null,
        gp_address_street:  dto.gpAddressStreet  ?? null,
        gp_address_suburb:  dto.gpAddressSuburb  ?? null,
        gp_address_state:   dto.gpAddressState   ?? null,
        gp_address_postcode: dto.gpAddressPostcode ?? null,
        nok_name:           dto.nokName          ?? null,
        nok_relationship:   dto.nokRelationship  ?? null,
        nok_phone:          dto.nokPhone         ?? null,
        atsi_status:        dto.atsiStatus       ?? null,
        interpreter_required: dto.interpreterRequired ?? false,
        interpreter_language: dto.interpreterLanguage ?? null,
        consent_to_treatment: dto.consentToTreatment ?? false,
        consent_for_research: dto.consentForResearch ?? false,
        consent_to_share_with_gp: dto.consentToShareWithGp ?? false,
        consent_to_share_with_carer: dto.consentToShareWithCarer ?? false,
        health_fund_name:       dto.healthFundName ?? null,
        health_fund_number:     dto.healthFundNumber ?? null,
        status:                 dto.status ?? 'active',
      }, trx);

      await ensureInitialTeamAssignmentForPatient({
        trx,
        clinicId,
        patientId: createdPatient.id,
        staffId: actorId,
      });

      return createdPatient;
    });

    await writeAuditLog(
      { clinicId, userId: actorId },
      {
        tableName: 'patients',
        recordId:  row.id,
        action:    'CREATE',
        newValues: { emrNumber: row.emr_number },
      },
    );

    return rowToResponse(row);
  },

  // ── UPDATE ────────────────────────────────────────────────────────────────
  async update(
    auth: AuthContext,
    id:   string,
    dto:  UpdatePatientDTO,
  ): Promise<PatientResponse> {
    requirePermission(auth, 'patient:update');
    assertPatientStringLengthContract(dto as unknown as Record<string, unknown>);
    const clinicId = auth.clinicId;
    const actorId = auth.staffId;
    const existing = await patientRepository.findById(clinicId, id);
    if (!existing) {
      throw new AppError("Patient not found", 404, ErrorCode.NOT_FOUND);
    }

    const patch: Partial<PatientRow> = {};
    if (dto.givenName       !== undefined) patch.given_name         = dto.givenName;
    if (dto.familyName      !== undefined) patch.family_name        = dto.familyName;
    if (dto.preferredName   !== undefined) patch.preferred_name     = dto.preferredName;
    if (dto.dateOfBirth     !== undefined) patch.date_of_birth      = dto.dateOfBirth;
    if (dto.gender          !== undefined) patch.gender             = dto.gender;
    if (dto.pronouns        !== undefined) patch.pronouns           = dto.pronouns;
    // S7.1 — keep blind-index columns in sync whenever their
    // corresponding identifier changes. computeBlindIndex(null) returns
    // null so clearing an identifier also clears the lookup column,
    // releasing the partial-unique index for reuse.
    if (dto.medicareNumber  !== undefined) {
      patch.medicare_number    = encryptPhi(dto.medicareNumber);
      patch.medicare_number_lookup = computePatientBlindIndexes({ medicareNumber: dto.medicareNumber }).medicare_number_lookup;
    }
    if (dto.medicareIrn     !== undefined) patch.medicare_reference = dto.medicareIrn;
    if (dto.medicareExpiry  !== undefined) patch.medicare_expiry    = normaliseMedicareExpiry(dto.medicareExpiry);
    if (dto.ihi             !== undefined) {
      patch.ihi_number         = encryptPhi(dto.ihi);
      patch.ihi_number_lookup  = computePatientBlindIndexes({ ihiNumber: dto.ihi }).ihi_number_lookup;
      patch.ihi_record_status  = dto.ihi ? 'unverified' : null;
      patch.ihi_number_status  = null;
    }
    if (dto.dvaNumber       !== undefined) {
      patch.dva_number         = encryptPhi(dto.dvaNumber);
      patch.dva_number_lookup  = computePatientBlindIndexes({ dvaNumber: dto.dvaNumber }).dva_number_lookup;
    }
    if (dto.dvaCardType     !== undefined) patch.dva_card_type      = dto.dvaCardType;
    if (dto.phoneMobile     !== undefined) patch.phone_mobile       = dto.phoneMobile;
    if (dto.phoneHome       !== undefined) patch.phone_home         = dto.phoneHome;
    if (dto.emailPrimary    !== undefined) patch.email_primary      = dto.emailPrimary;
    if (dto.addressStreet   !== undefined) patch.address_line1      = dto.addressStreet;
    if (dto.addressSuburb   !== undefined) patch.suburb             = dto.addressSuburb;
    if (dto.addressState    !== undefined) patch.state              = dto.addressState;
    if (dto.addressPostcode !== undefined) patch.postcode           = dto.addressPostcode;
    if (dto.gpName           !== undefined) patch.gp_name             = dto.gpName;
    if (dto.gpPractice       !== undefined) patch.gp_practice         = dto.gpPractice;
    if (dto.gpPhone          !== undefined) patch.gp_phone            = dto.gpPhone;
    if (dto.gpFax            !== undefined) patch.gp_fax              = dto.gpFax;
    if (dto.gpEmail          !== undefined) patch.gp_email            = dto.gpEmail;
    if (dto.gpProviderNumber !== undefined) patch.gp_provider_number  = dto.gpProviderNumber;
    if (dto.gpAddressStreet  !== undefined) patch.gp_address_street   = dto.gpAddressStreet;
    if (dto.gpAddressSuburb  !== undefined) patch.gp_address_suburb   = dto.gpAddressSuburb;
    if (dto.gpAddressState   !== undefined) patch.gp_address_state    = dto.gpAddressState;
    if (dto.gpAddressPostcode !== undefined) patch.gp_address_postcode = dto.gpAddressPostcode;
    if (dto.nokName                !== undefined) patch.nok_name                    = dto.nokName;
    if (dto.nokRelationship        !== undefined) patch.nok_relationship             = dto.nokRelationship;
    if (dto.nokPhone               !== undefined) patch.nok_phone                   = dto.nokPhone;
    if (dto.atsiStatus             !== undefined) patch.atsi_status                 = dto.atsiStatus;
    if (dto.interpreterRequired    !== undefined) patch.interpreter_required         = dto.interpreterRequired;
    if (dto.interpreterLanguage    !== undefined) patch.interpreter_language         = dto.interpreterLanguage;
    if (dto.consentToTreatment     !== undefined) patch.consent_to_treatment         = dto.consentToTreatment;
    if (dto.consentForResearch     !== undefined) patch.consent_for_research         = dto.consentForResearch;
    if (dto.consentToShareWithGp   !== undefined) patch.consent_to_share_with_gp    = dto.consentToShareWithGp;
    if (dto.consentToShareWithCarer !== undefined) patch.consent_to_share_with_carer = dto.consentToShareWithCarer;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.healthFundName !== undefined) patch.health_fund_name = dto.healthFundName;
    if (dto.healthFundNumber !== undefined) patch.health_fund_number = dto.healthFundNumber;

    const updated = await patientRepository.update(clinicId, id, patch);
    if (!updated) {
      throw new AppError("Patient not found", 404, ErrorCode.NOT_FOUND);
    }

    await writeAuditLog(
      { clinicId, userId: actorId },
      {
        tableName: 'patients',
        recordId:  id,
        action:    'UPDATE',
        newValues: patch as Record<string, unknown>,
      },
    );

    return rowToResponse(updated);
  },

  // ── GET BY ID ─────────────────────────────────────────────────────────────
  async getById(
    auth: AuthContext,
    id:   string,
  ): Promise<PatientResponse> {
    requirePermission(auth, 'patient:read');
    const row = await patientRepository.findById(auth.clinicId, id);
    if (!row) {
      throw new AppError("Patient not found", 404, ErrorCode.NOT_FOUND);
    }
    return rowToResponse(row);
  },

  // ── LIST ──────────────────────────────────────────────────────────────────
  async list(
    auth:    AuthContext,
    filters: PatientSearchDTO,
  ): Promise<PaginatedResponse<PatientResponse>> {
    requirePermission(auth, 'patient:read');
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 25;
    const result = await patientRepository.list(auth.clinicId, {
      search:      filters.search,
      status:      filters.status ?? null,
      page,
      limit,
      clinicianId: filters.myPatients ? auth.staffId : undefined,
    });

    return buildPaginatedResponse(result.data.map(rowToResponse), result.total, { page, limit });
  },

  // ── SOFT DELETE ───────────────────────────────────────────────────────────
  async softDelete(
    auth: AuthContext,
    id:   string,
  ): Promise<void> {
    requirePermission(auth, 'patient:update');
    const existing = await patientRepository.findById(auth.clinicId, id);
    if (!existing) {
      throw new AppError("Patient not found", 404, ErrorCode.NOT_FOUND);
    }

    await patientRepository.softDelete(auth.clinicId, id);

    await writeAuditLog(
      { clinicId: auth.clinicId, userId: auth.staffId },
      { tableName: 'patients', recordId: id, action: 'SOFT_DELETE' },
    );
  },

  async quickRegister(
    auth: AuthContext,
    data: {
      givenName: string;
      familyName: string;
      dateOfBirth: string;
      phoneMobile?: string;
      medicareNumber?: string;
      medicareIrn?: string;
      ihi?: string;
      dvaNumber?: string;
    },
  ): Promise<PatientResponse> {
    return patientService.create(auth, {
      givenName: data.givenName,
      familyName: data.familyName,
      dateOfBirth: data.dateOfBirth,
      phoneMobile: data.phoneMobile,
      medicareNumber: data.medicareNumber,
      medicareIrn: data.medicareIrn,
      ihi: data.ihi,
      dvaNumber: data.dvaNumber,
    });
  },
};
