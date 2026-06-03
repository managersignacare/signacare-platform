/**
 * apps/api/src/integrations/fhir/serializers.ts
 *
 * Pure functions that convert DB rows to FHIR R4 JSON resources.
 *
 * Pulled out of the route handlers (and the prior in-line bulk export
 * stub) so that:
 *
 *   1. The bulk export worker (S3.2) and the synchronous /fhir/* GET
 *      handlers can use exactly the same serialisation logic. Without
 *      this module they were duplicating code, which had already
 *      diverged on whether `identifier` carried the IHI or not.
 *
 *   2. The serialisers can be unit-tested without mocking Knex or
 *      mounting the Express router. The pure-function shape is the
 *      easiest thing in the world to assert against.
 *
 * Naming compliance: function exports camelCase, FHIR JSON keys
 * camelCase per the FHIR R4 spec (resourceType, birthDate, etc.).
 * The DB row fields are snake_case as usual.
 */

// We deliberately do NOT import a Knex Row type here because the
// serialisers should accept any object shape that has the right keys.
// Type safety is enforced by the callers (the workers/routes know what
// table they queried).

interface PatientRow {
  id: string;
  clinic_id?: string;
  given_name?: string | null;
  family_name?: string | null;
  date_of_birth?: string | Date | null;
  gender?: string | null;
  medicare_number?: string | null;
  ihi_number?: string | null;
  email?: string | null;
  phone_mobile?: string | null;
  address_street?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  preferred_name?: string | null;
}

function isoDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Already a string — accept either ISO date or full timestamp.
  return String(value).slice(0, 10);
}

export function patientToFhir(row: PatientRow): Record<string, unknown> {
  const identifier = [
    row.medicare_number
      ? { system: 'http://ns.electronichealth.net.au/id/medicare-number', value: row.medicare_number }
      : null,
    row.ihi_number
      ? { system: 'http://ns.electronichealth.net.au/id/ihi', value: row.ihi_number }
      : null,
  ].filter(Boolean);

  const name = [
    {
      use: 'official',
      family: row.family_name ?? '',
      given: row.given_name ? [row.given_name] : [],
    },
  ];

  const telecom = [
    row.phone_mobile ? { system: 'phone', value: row.phone_mobile, use: 'mobile' } : null,
    row.email ? { system: 'email', value: row.email } : null,
  ].filter(Boolean);

  const address =
    row.address_street || row.address_suburb || row.address_state || row.address_postcode
      ? [
          {
            line: row.address_street ? [row.address_street] : [],
            city: row.address_suburb ?? undefined,
            state: row.address_state ?? undefined,
            postalCode: row.address_postcode ?? undefined,
            country: 'AU',
          },
        ]
      : [];

  return {
    resourceType: 'Patient',
    id: row.id,
    identifier,
    name,
    telecom,
    gender: row.gender ?? undefined,
    birthDate: isoDate(row.date_of_birth),
    address,
  };
}

interface ObservationRow {
  id: string;
  patient_id: string;
  observation_type?: string | null;
  value_numeric?: number | null;
  value_text?: string | null;
  unit?: string | null;
  observed_at?: string | Date | null;
  status?: string | null;
}

export function observationToFhir(row: ObservationRow): Record<string, unknown> {
  return {
    resourceType: 'Observation',
    id: row.id,
    status: row.status ?? 'final',
    code: { text: row.observation_type ?? 'Observation' },
    subject: { reference: `Patient/${row.patient_id}` },
    effectiveDateTime:
      row.observed_at instanceof Date
        ? row.observed_at.toISOString()
        : row.observed_at ?? undefined,
    valueQuantity:
      row.value_numeric != null
        ? { value: row.value_numeric, unit: row.unit ?? undefined }
        : undefined,
    valueString: row.value_numeric == null && row.value_text ? row.value_text : undefined,
  };
}

interface ConditionRow {
  id: string;
  patient_id: string;
  diagnosis?: string | null;
  diagnosis_code?: string | null;
  status?: string | null;
  recorded_at?: string | Date | null;
}

export function conditionToFhir(row: ConditionRow): Record<string, unknown> {
  return {
    resourceType: 'Condition',
    id: row.id,
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: row.status === 'resolved' ? 'resolved' : 'active',
        },
      ],
    },
    code: {
      text: row.diagnosis ?? 'Condition',
      ...(row.diagnosis_code
        ? {
            coding: [
              { system: 'http://hl7.org/fhir/sid/icd-10', code: row.diagnosis_code },
            ],
          }
        : {}),
    },
    subject: { reference: `Patient/${row.patient_id}` },
    recordedDate:
      row.recorded_at instanceof Date ? row.recorded_at.toISOString() : row.recorded_at ?? undefined,
  };
}

interface MedicationRow {
  id: string;
  patient_id: string;
  drug_name?: string | null;
  dose?: string | null;
  frequency?: string | null;
  status?: string | null;
  started_at?: string | Date | null;
  ceased_at?: string | Date | null;
}

export function medicationToFhir(row: MedicationRow): Record<string, unknown> {
  return {
    resourceType: 'MedicationStatement',
    id: row.id,
    status: row.status === 'ceased' ? 'stopped' : 'active',
    medicationCodeableConcept: { text: row.drug_name ?? 'Medication' },
    subject: { reference: `Patient/${row.patient_id}` },
    effectivePeriod: {
      start:
        row.started_at instanceof Date
          ? row.started_at.toISOString()
          : row.started_at ?? undefined,
      end:
        row.ceased_at instanceof Date ? row.ceased_at.toISOString() : row.ceased_at ?? undefined,
    },
    dosage: row.dose
      ? [{ text: `${row.dose}${row.frequency ? ` ${row.frequency}` : ''}` }]
      : [],
  };
}

/**
 * Map of FHIR resource type → DB query + serializer pair. Used by the
 * bulk export worker to handle the _type query parameter generically
 * without a switch statement that would have to be edited every time
 * we add a resource.
 *
 * The query function is given the clinic_id and the optional _since
 * filter and must return an async iterable of FHIR objects. We use a
 * generator so the worker can stream the rows out without loading them
 * all into memory.
 */
export const SUPPORTED_BULK_TYPES = ['Patient', 'Observation', 'Condition', 'MedicationStatement'] as const;
export type BulkResourceType = (typeof SUPPORTED_BULK_TYPES)[number];

export function isSupportedBulkType(type: string): type is BulkResourceType {
  return (SUPPORTED_BULK_TYPES as readonly string[]).includes(type);
}
