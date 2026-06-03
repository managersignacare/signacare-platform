// apps/api/src/utils/phiFields.ts
//
// Leaf module for PHI field-name taxonomy + recursive object redaction.
//
// Extracted from utils/logger.ts during BUG-267 L5 architectural review:
// logger.ts wired a new custom err serializer (sanitizeErrForLogging)
// that needed PHI_FIELDS as a column-name oracle, producing a circular
// import (logger.ts → sanitizeErrForLogging.ts → logger.ts). Moving the
// taxonomy here breaks the cycle and gives every consumer a single
// leaf dependency.
//
// Consumers:
//   - utils/logger.ts (for redactPhi in formatters.log)
//   - utils/sanitizeErrForLogging.ts (for err-message redaction)
//   - shared/pipelineTracker.ts (for LLM pipeline meta validation)
//   - shared/recordLlmInteraction.ts (for meta-key PHI rejection)
//
// Not exported from here: the pino logger instance itself. The logger
// lives in logger.ts because it owns process-level side effects
// (checkSchemaPhiDrift, OTel span correlation).
//
// MAINTENANCE RULE: whenever a migration adds a new PHI-flavoured column
// (name / contact / address / Medicare / IHI / health-fund / NOK /
// emergency-contact / DOB / NDIS / HPI-I / provider / PBS / clinical
// narrative / BLIND-INDEX HASH), add the snake_case AND camelCase forms
// to the matching PHI_CATEGORY_* array AND extend
// apps/api/tests/unit/loggerRedaction.test.ts. BUG-269 tracks a CI
// guard to enforce this at commit time.

export const PHI_CATEGORY_NAMES = [
  'given_name', 'family_name', 'givenName', 'familyName',
  'preferred_name', 'preferredName',
  'nok_name', 'nokName',
  'gp_name', 'gpName',
  'provider_name', 'providerName',
  'from_provider_name', 'fromProviderName',
  'emergency_contact_name', 'emergencyContactName',
  'caller_name', 'callerName',
  'partner_name', 'partnerName',
  'recipient_name', 'recipientName',
  // BUG-721 — schema-drift triage: relationship fields are personal
  // profile metadata and must be redacted in logs.
  'family_id', 'familyId',
  'nok_relationship', 'nokRelationship',
] as const;

export const PHI_CATEGORY_BIRTH = [
  'date_of_birth', 'dateOfBirth', 'dob',
  // BUG-721 — clinical timeline dates surfaced by logger drift check.
  'diagnosis_date', 'diagnosisDate',
  'given_date', 'givenDate',
  'last_given_date', 'lastGivenDate',
] as const;

export const PHI_CATEGORY_MEDICARE_IHI_DVA = [
  'medicare_number', 'medicareNumber',
  'medicare_reference', 'medicareReference',
  'medicare_expiry', 'medicareExpiry',
  'ihi_number', 'ihiNumber', 'ihi',
  'dva_number', 'dvaNumber',
  'dva_card_type', 'dvaCardType',
  'recipient_mhr_ihi', 'recipientMhrIhi',
] as const;

/**
 * BUG-267 L4 clinical-safety addition — blind-index (HMAC) columns
 * derived from Medicare / IHI / DVA. These are the actual composite
 * unique-constraint columns in the patients table:
 *   patients_medicare_lookup_uniq (clinic_id, medicare_number_lookup)
 *   patients_ihi_lookup_uniq      (clinic_id, ihi_number_lookup)
 *   patients_dva_lookup_uniq      (clinic_id, dva_number_lookup)
 *
 * A duplicate enrol emits `Key (clinic_id, medicare_number_lookup)=(uuid, <hash>)`.
 * The hash is a SHA-256 HMAC of the Medicare number with a clinic-scoped
 * pepper — a de-anonymisation vector (attacker with candidate Medicare
 * numbers can hash + match). OAIC treats these as the underlying
 * identifier; leak to journald = Notifiable Data Breach.
 */
export const PHI_CATEGORY_BLIND_INDEX = [
  'medicare_number_lookup', 'medicareNumberLookup',
  'ihi_number_lookup', 'ihiNumberLookup',
  // BUG-216 follow-up — patient_ihis table uses ihi_lookup.
  'ihi_lookup', 'ihiLookup',
  'dva_number_lookup', 'dvaNumberLookup',
] as const;

/**
 * BUG-216 L4 additions — AU-specific clinical identifiers required by
 * Privacy Act 1988, Healthcare Identifiers Act 2010, and NDIS Act.
 */
export const PHI_CATEGORY_AU_IDENTIFIERS = [
  // NDIS participant IDs
  'ndis_number', 'ndisNumber',
  'ndis_package_manager', 'ndisPackageManager',
  // HPI-I (Healthcare Provider Identifier — Individual; clinician counterpart to IHI)
  'hpii',
  // Provider / prescriber numbers
  'prescriber_number', 'prescriberNumber',
  'from_provider_prescriber_no', 'fromProviderPrescriberNo',
  'prescriber_initials', 'prescriberInitials',
  'prescriber_staff_id', 'prescriberStaffId',
  'provider_number', 'providerNumber',
  'gp_provider_number', 'gpProviderNumber',
  'referring_provider_number', 'referringProviderNumber',
  // PBS codes — reveal drug therapy class; PHI under PBS authority regime
  'pbs_code', 'pbsCode',
  'pbs_item_code', 'pbsItemCode',
  'pbs_listed', 'pbsListed',
] as const;

export const PHI_CATEGORY_HEALTH_FUND = [
  'health_fund_number', 'healthFundNumber',
  'health_fund_member_number', 'healthFundMemberNumber',
  'health_fund_name', 'healthFundName',
  'private_health_fund', 'privateHealthFund',
] as const;

export const PHI_CATEGORY_PHONE = [
  'phone_mobile', 'phoneMobile',
  'phone_home', 'phoneHome',
  'phone_work', 'phoneWork',
  'phone',
  'nok_phone', 'nokPhone',
  'gp_phone', 'gpPhone',
  'provider_phone', 'providerPhone',
  'from_provider_phone', 'fromProviderPhone',
  'emergency_contact_phone', 'emergencyContactPhone',
  'caller_phone', 'callerPhone',
  'referrer_phone', 'referrerPhone',
  'phone_number_masked', 'phoneNumberMasked',
] as const;

export const PHI_CATEGORY_EMAIL = [
  'email_primary', 'emailPrimary', 'email',
  'gp_email', 'gpEmail',
  'provider_email', 'providerEmail',
  'from_provider_email', 'fromProviderEmail',
  'outlook_email', 'outlookEmail',
  'recipient_email', 'recipientEmail',
  'referrer_email', 'referrerEmail',
  // BUG-269 L2 guard findings — admin / staff emails logged during
  // provisioning. They're OAIC personal information same as patient
  // emails, so the logger redactor must censor them.
  'admin_email', 'adminEmail',
] as const;

export const PHI_CATEGORY_ADDRESS = [
  'address', 'addressStreet', 'address_street',
  'address_line1', 'addressLine1',
  'address_line2', 'addressLine2',
  'address_suburb', 'addressSuburb',
  'address_state', 'addressState',
  'address_postcode', 'addressPostcode',
  'postcode',
  'gp_address_street', 'gpAddressStreet',
  'gp_address_suburb', 'gpAddressSuburb',
  'gp_address_state', 'gpAddressState',
  'gp_address_postcode', 'gpAddressPostcode',
  'provider_address', 'providerAddress',
  'recipient_address', 'recipientAddress',
] as const;

/**
 * BUG-216 L4 addition — clinical narrative fields. Restricted to
 * CLINICAL-SPECIFIC names; generic `notes` / `content` / `subject` /
 * `title` are left out to avoid blinding operators to workflow
 * reconstruction. BUG-269's guard will flag generic-name additions in
 * clinical contexts.
 */
export const PHI_CATEGORY_CLINICAL_NARRATIVE = [
  'clinical_notes', 'clinicalNotes',
  'presenting_problem', 'presentingProblem',
  'presenting_complaints', 'presentingComplaints',
  // BUG-721 — drift triage additions from schema snapshot.
  'primary_diagnosis', 'primaryDiagnosis',
  'diagnosis_info', 'diagnosisInfo',
  'risk_narrative', 'riskNarrative',
  'dose_given', 'doseGiven',
  'dose_given_mg', 'doseGivenMg',
  'loading_doses_given', 'loadingDosesGiven',
  'reason_not_given', 'reasonNotGiven',
  'preferred_call_days', 'preferredCallDays',
  'preferred_call_start', 'preferredCallStart',
  'preferred_call_end', 'preferredCallEnd',
  'preferred_call_time', 'preferredCallTime',
  'preferred_days', 'preferredDays',
  'preferred_start_time', 'preferredStartTime',
  'preferred_end_time', 'preferredEndTime',
  'preferred_time_of_day', 'preferredTimeOfDay',
  'preferred_clinician_id', 'preferredClinicianId',
  'preferred_ward', 'preferredWard',
  'understand_notes', 'understandNotes',
  'retain_notes', 'retainNotes',
  'weigh_notes', 'weighNotes',
  'communicate_notes', 'communicateNotes',
  'message_body', 'messageBody',
] as const;

export const PHI_CATEGORY_AUTH_SECRETS = [
  'password', 'password_hash', 'passwordHash',
  'mfa_secret', 'mfaSecret',
  // BUG-721 — network identifiers are personal data.
  'ip_address', 'ipAddress',
] as const;

export const PHI_FIELDS = new Set<string>([
  ...PHI_CATEGORY_NAMES,
  ...PHI_CATEGORY_BIRTH,
  ...PHI_CATEGORY_MEDICARE_IHI_DVA,
  ...PHI_CATEGORY_BLIND_INDEX,
  ...PHI_CATEGORY_AU_IDENTIFIERS,
  ...PHI_CATEGORY_HEALTH_FUND,
  ...PHI_CATEGORY_PHONE,
  ...PHI_CATEGORY_EMAIL,
  ...PHI_CATEGORY_ADDRESS,
  ...PHI_CATEGORY_CLINICAL_NARRATIVE,
  ...PHI_CATEGORY_AUTH_SECRETS,
]);

/**
 * Recursively redact any PHI_FIELDS entries in a structured object.
 * Does NOT replace pino's built-in redact.paths fast path — that's
 * handled at the pino configuration layer in logger.ts.
 */
export function redactPhi(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return redactPhiRecord(obj, new WeakMap<Record<string, unknown>, Record<string, unknown>>());
}

function isTraversableRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * BUG-270:
 * - copy-on-write: untouched payload branches keep their original references,
 *   avoiding full-tree cloning for large operational log objects.
 * - cycle-safe traversal: WeakMap memoization prevents infinite recursion on
 *   self-referential debug payloads.
 */
function redactPhiRecord(
  source: Record<string, unknown>,
  memo: WeakMap<Record<string, unknown>, Record<string, unknown>>,
): Record<string, unknown> {
  const cached = memo.get(source);
  if (cached) return cached;

  // Pre-register draft for cycle-safe self/ancestor references.
  const draft: Record<string, unknown> = {};
  memo.set(source, draft);

  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    if (PHI_FIELDS.has(key)) {
      draft[key] = '[REDACTED]';
      if (value !== '[REDACTED]') changed = true;
      continue;
    }

    if (isTraversableRecord(value)) {
      const redactedChild = redactPhiRecord(value, memo);
      draft[key] = redactedChild;
      if (redactedChild !== value) changed = true;
      continue;
    }

    draft[key] = value;
  }

  if (!changed) {
    memo.set(source, source);
    return source;
  }

  return draft;
}
