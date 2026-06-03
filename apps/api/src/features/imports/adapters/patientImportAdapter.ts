/**
 * Patient registration import adapter.
 *
 * Delegates to the existing patientService.create so every row
 * goes through the same duplicate-detection, PHI-encryption, blind-
 * index, EMR-number-generation, and audit-log pipeline as a
 * single-patient POST. A row that would throw DUPLICATE_PATIENT on
 * the single POST gets the same error surfaced in the import report
 * — there is no "bypass duplicates" path, deliberately.
 *
 * CSV columns (required):
 *   given_name, family_name, date_of_birth
 * CSV columns (optional):
 *   preferred_name, gender, pronouns, phone_mobile, email_primary,
 *   medicare_number, medicare_irn, medicare_expiry, ihi, dva_number,
 *   address_street, address_suburb, address_state, address_postcode
 *
 * date_of_birth must be YYYY-MM-DD. All other fields are free-form
 * strings passed through to the service.
 */
import type { ImportAdapter, RowError } from '../importTypes';
import { patientService } from '../../patients/patientService';
import { AppError } from '../../../shared/errors';

interface PatientImportDto {
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  preferredName?: string;
  gender?: string;
  pronouns?: string;
  phoneMobile?: string;
  emailPrimary?: string;
  medicareNumber?: string;
  medicareIrn?: string;
  medicareExpiry?: string;
  ihi?: string;
  dvaNumber?: string;
  addressStreet?: string;
  addressSuburb?: string;
  addressState?: string;
  addressPostcode?: string;
}

const REQUIRED = ['given_name', 'family_name', 'date_of_birth'] as const;
const OPTIONAL = [
  'preferred_name', 'gender', 'pronouns', 'phone_mobile', 'email_primary',
  'medicare_number', 'medicare_irn', 'medicare_expiry', 'ihi', 'dva_number',
  'address_street', 'address_suburb', 'address_state', 'address_postcode',
] as const;

function strOrUndef(v: string | undefined): string | undefined {
  const trimmed = (v ?? '').trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export const patientImportAdapter: ImportAdapter<PatientImportDto> = {
  kind: 'patients',
  requiredColumns: REQUIRED,
  optionalColumns: OPTIONAL,

  async parseRow(row, rowIndex) {
    const errors: RowError[] = [];
    const givenName = strOrUndef(row.given_name);
    const familyName = strOrUndef(row.family_name);
    const dateOfBirth = strOrUndef(row.date_of_birth);

    if (!givenName) errors.push({ rowIndex, field: 'given_name', message: 'given_name is required' });
    if (!familyName) errors.push({ rowIndex, field: 'family_name', message: 'family_name is required' });
    if (!dateOfBirth) {
      errors.push({ rowIndex, field: 'date_of_birth', message: 'date_of_birth is required' });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      errors.push({
        rowIndex,
        field: 'date_of_birth',
        message: 'date_of_birth must be YYYY-MM-DD (e.g. 1975-03-21)',
      });
    }

    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      dto: {
        givenName: givenName!,
        familyName: familyName!,
        dateOfBirth: dateOfBirth!,
        preferredName: strOrUndef(row.preferred_name),
        gender: strOrUndef(row.gender),
        pronouns: strOrUndef(row.pronouns),
        phoneMobile: strOrUndef(row.phone_mobile),
        emailPrimary: strOrUndef(row.email_primary),
        medicareNumber: strOrUndef(row.medicare_number),
        medicareIrn: strOrUndef(row.medicare_irn),
        medicareExpiry: strOrUndef(row.medicare_expiry),
        ihi: strOrUndef(row.ihi),
        dvaNumber: strOrUndef(row.dva_number),
        addressStreet: strOrUndef(row.address_street),
        addressSuburb: strOrUndef(row.address_suburb),
        addressState: strOrUndef(row.address_state),
        addressPostcode: strOrUndef(row.address_postcode),
      },
    };
  },

  async commitOne(dto, ctx) {
    // patientService.create manages its own DB writes outside the
    // import transaction because it calls several repositories and
    // writes audit rows. A mid-batch failure still rolls back the
    // import_jobs status update — the already-created patients
    // remain (idempotent by deterministic EMR number), and the job
    // row is marked rejected so the operator sees the partial state.
    try {
      await patientService.create(
        { staffId: ctx.uploadedByStaffId, clinicId: ctx.clinicId, role: 'admin', permissions: ['patient:create'] },
        {
        givenName: dto.givenName,
        familyName: dto.familyName,
        dateOfBirth: dto.dateOfBirth,
        preferredName: dto.preferredName ?? null,
        gender: dto.gender ?? null,
        pronouns: dto.pronouns ?? null,
        phoneMobile: dto.phoneMobile ?? null,
        emailPrimary: dto.emailPrimary ?? null,
        medicareNumber: dto.medicareNumber ?? null,
        medicareIrn: dto.medicareIrn ?? null,
        medicareExpiry: dto.medicareExpiry ?? null,
        ihi: dto.ihi ?? null,
        dvaNumber: dto.dvaNumber ?? null,
        addressStreet: dto.addressStreet ?? null,
        addressSuburb: dto.addressSuburb ?? null,
        addressState: dto.addressState ?? null,
        addressPostcode: dto.addressPostcode ?? null,
      } as never);
    } catch (err) {
      if (err instanceof AppError) {
        throw new AppError(
          `Patient row failed: ${err.message}`,
          err.status ?? 409,
          (err.code as never) ?? 'IMPORT_PATIENT_FAILED',
        );
      }
      throw err;
    }
  },
};
