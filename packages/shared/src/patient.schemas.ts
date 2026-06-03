import { z } from 'zod';
import { isValidIhi } from './luhn';

// BUG-A5.0 — IHI must be Luhn-valid + 16-digit + 800360 prefix.
// Empty string is treated as "not provided" (optional field semantics);
// the refine only fires when a non-empty value is supplied.
const IhiSchema = z
  .string()
  .optional()
  .refine(
    (v) => v === undefined || v === '' || isValidIhi(v),
    {
      message:
        'IHI must be 16 digits starting with 800360 with a valid Luhn check digit (AHPRA ADHA-A5.0)',
    },
  );

// Keep request-level limits aligned with DB column widths so invalid
// payloads fail at API boundary (422) instead of bubbling as PG 22001.
const MAX = {
  GIVEN_NAME: 100,
  FAMILY_NAME: 100,
  PREFERRED_NAME: 100,
  GENDER: 30,
  PRONOUNS: 50,
  MEDICARE_NUMBER: 30,
  MEDICARE_IRN: 10,
  DVA_NUMBER: 30,
  DVA_CARD_TYPE: 20,
  PHONE: 30,
  EMAIL: 255,
  ADDRESS_LINE: 255,
  SUBURB: 100,
  STATE: 30,
  POSTCODE: 10,
  HEALTH_FUND_NAME: 100,
  HEALTH_FUND_NUMBER: 50,
  GP_NAME: 200,
  GP_PRACTICE: 200,
  GP_PROVIDER_NUMBER: 30,
  GP_STATE: 20,
  NOK_NAME: 200,
  NOK_RELATIONSHIP: 100,
  ATSI_STATUS: 50,
  INTERPRETER_LANGUAGE: 100,
  STATUS: 30,
} as const;

function normaliseDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function isValidDateOnly(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const [y, m, d] = raw.split('-').map((n) => Number(n));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() + 1 === m &&
    parsed.getUTCDate() === d
  );
}

function isFutureDateOnly(raw: string): boolean {
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return parsed.getTime() > utcToday.getTime();
}

function ageYears(raw: string): number {
  const now = new Date();
  const dob = new Date(`${raw}T00:00:00.000Z`);
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) years -= 1;
  return years;
}

function isValidPhoneNumber(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (!/^[0-9+()\-\s.]+$/.test(trimmed)) return false;
  const digits = normaliseDigits(trimmed);
  return digits.length >= 8 && digits.length <= 15;
}

function isValidMedicareNumber(raw: string): boolean {
  const digits = normaliseDigits(raw);
  if (!(digits.length === 10 || digits.length === 11)) return false;
  const first = Number(digits[0]);
  if (!Number.isFinite(first) || first < 2 || first > 6) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9];
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    const d = Number(digits[i]);
    if (!Number.isFinite(d)) return false;
    sum += d * weights[i];
  }
  const checkDigit = Number(digits[8]);
  if (!Number.isFinite(checkDigit)) return false;
  return sum % 10 === checkDigit;
}

export const PatientDobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDateOnly, 'dateOfBirth must be a valid calendar date (YYYY-MM-DD)')
  .refine((v) => !isFutureDateOnly(v), 'dateOfBirth cannot be in the future')
  .refine((v) => ageYears(v) <= 130, 'dateOfBirth indicates implausible age (>130 years)');

export const PatientPhoneSchema = z
  .string()
  .max(MAX.PHONE)
  .refine(isValidPhoneNumber, 'Phone number must contain 8-15 digits and valid phone characters');

export const PatientMedicareNumberSchema = z
  .string()
  .max(MAX.MEDICARE_NUMBER)
  .refine(isValidMedicareNumber, 'medicareNumber must be a valid Australian Medicare number');

export const PatientMedicareIrnSchema = z
  .string()
  .max(MAX.MEDICARE_IRN)
  .regex(/^[1-9]$/, 'medicareIrn must be a single digit 1-9');

export const CreatePatientSchema = z.object({
  givenName: z.string().min(1).max(MAX.GIVEN_NAME),
  familyName: z.string().min(1).max(MAX.FAMILY_NAME),
  preferredName: z.string().max(MAX.PREFERRED_NAME).optional(),
  dateOfBirth: PatientDobSchema,
  gender: z.string().max(MAX.GENDER).optional(),
  pronouns: z.string().max(MAX.PRONOUNS).optional(),
  medicareNumber: PatientMedicareNumberSchema.optional(),
  medicareIrn: PatientMedicareIrnSchema.optional(),
  medicareExpiry: z.string().optional(),
  ihi: IhiSchema,
  dvaNumber: z.string().max(MAX.DVA_NUMBER).optional(),
  dvaCardType: z.string().max(MAX.DVA_CARD_TYPE).optional(),
  phoneMobile: PatientPhoneSchema.optional(),
  phoneHome: PatientPhoneSchema.optional(),
  emailPrimary: z.string().max(MAX.EMAIL).optional(),
  addressStreet: z.string().max(MAX.ADDRESS_LINE).optional(),
  addressSuburb: z.string().max(MAX.SUBURB).optional(),
  addressState: z.string().max(MAX.STATE).optional(),
  addressPostcode: z.string().max(MAX.POSTCODE).optional(),
  healthFundName: z.string().max(MAX.HEALTH_FUND_NAME).optional(),
  healthFundNumber: z.string().max(MAX.HEALTH_FUND_NUMBER).optional(),
  gpName: z.string().max(MAX.GP_NAME).optional(),
  gpPractice: z.string().max(MAX.GP_PRACTICE).optional(),
  gpPhone: PatientPhoneSchema.optional(),
  gpFax: PatientPhoneSchema.optional(),
  gpEmail: z.string().max(MAX.EMAIL).optional(),
  gpProviderNumber: z.string().max(MAX.GP_PROVIDER_NUMBER).optional(),
  gpAddressStreet: z.string().max(MAX.ADDRESS_LINE).optional(),
  gpAddressSuburb: z.string().max(MAX.SUBURB).optional(),
  gpAddressState: z.string().max(MAX.GP_STATE).optional(),
  gpAddressPostcode: z.string().max(MAX.POSTCODE).optional(),
  nokName: z.string().max(MAX.NOK_NAME).optional(),
  nokRelationship: z.string().max(MAX.NOK_RELATIONSHIP).optional(),
  nokPhone: PatientPhoneSchema.optional(),
  atsiStatus: z.string().max(MAX.ATSI_STATUS).optional(),
  interpreterRequired: z.boolean().optional(),
  interpreterLanguage: z.string().max(MAX.INTERPRETER_LANGUAGE).optional(),
  consentToTreatment: z.boolean().optional(),
  consentForResearch: z.boolean().optional(),
  consentToShareWithGp: z.boolean().optional(),
  consentToShareWithCarer: z.boolean().optional(),
  status: z.string().max(MAX.STATUS).optional(),
});
export type CreatePatientDTO = z.infer<typeof CreatePatientSchema>;

export const UpdatePatientSchema = CreatePatientSchema.partial();
export type UpdatePatientDTO = z.infer<typeof UpdatePatientSchema>;

export const PatientSearchSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  myPatients: z.coerce.boolean().optional(),
});
export type PatientSearchDTO = z.infer<typeof PatientSearchSchema>;

export const PatientResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  emrNumber: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  preferredName: z.string().nullable(),
  dateOfBirth: z.string(),
  gender: z.string().nullable(),
  pronouns: z.string().nullable(),
  medicareNumber: z.string().nullable(),
  medicareIrn: z.string().nullable(),
  medicareExpiry: z.string().nullable(),
  ihi: z.string().nullable(),
  dvaNumber: z.string().nullable(),
  dvaCardType: z.string().nullable(),
  phoneMobile: z.string().nullable(),
  phoneHome: z.string().nullable(),
  emailPrimary: z.string().nullable(),
  addressStreet: z.string().nullable(),
  addressSuburb: z.string().nullable(),
  addressState: z.string().nullable(),
  addressPostcode: z.string().nullable(),
  healthFundName: z.string().nullable(),
  healthFundNumber: z.string().nullable(),
  gpName: z.string().nullable(),
  gpPractice: z.string().nullable(),
  gpPhone: z.string().nullable(),
  gpFax: z.string().nullable(),
  gpEmail: z.string().nullable(),
  gpProviderNumber: z.string().nullable(),
  gpAddressStreet: z.string().nullable(),
  gpAddressSuburb: z.string().nullable(),
  gpAddressState: z.string().nullable(),
  gpAddressPostcode: z.string().nullable(),
  nokName: z.string().nullable(),
  nokRelationship: z.string().nullable(),
  nokPhone: z.string().nullable(),
  atsiStatus: z.string().nullable(),
  interpreterRequired: z.boolean(),
  interpreterLanguage: z.string().nullable(),
  consentToTreatment: z.boolean(),
  consentForResearch: z.boolean(),
  consentToShareWithGp: z.boolean(),
  consentToShareWithCarer: z.boolean(),
  status: z.string(),
  flags: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type PatientResponse = z.infer<typeof PatientResponseSchema>;
