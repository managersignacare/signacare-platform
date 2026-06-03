/**
 * S3.2 — FHIR serializer unit tests
 *
 * Pure-function tests for the resource serializers used by both the
 * synchronous /fhir/* GET handlers and the bulk export worker. The
 * end-to-end async kickoff → poll → download flow needs a real
 * Postgres + a real S3 (or LocalBlobStorage) and is covered by an
 * integration test in a follow-up.
 */

import { describe, it, expect } from 'vitest';
import {
  patientToFhir,
  observationToFhir,
  conditionToFhir,
  medicationToFhir,
  isSupportedBulkType,
  SUPPORTED_BULK_TYPES,
} from '../src/integrations/fhir/serializers';

describe('patientToFhir', () => {
  it('emits a minimal Patient with required fields', () => {
    const out = patientToFhir({
      id: 'p-1',
      family_name: 'Doe',
      given_name: 'Jane',
      gender: 'female',
      date_of_birth: '1990-04-11',
    });
    expect(out.resourceType).toBe('Patient');
    expect(out.id).toBe('p-1');
    expect(out.gender).toBe('female');
    expect(out.birthDate).toBe('1990-04-11');
    expect((out.name as Array<{ family: string; given: string[] }>)[0]).toMatchObject({
      family: 'Doe',
      given: ['Jane'],
    });
  });

  it('includes Medicare and IHI identifiers when present', () => {
    const out = patientToFhir({
      id: 'p-2',
      medicare_number: '1234567890',
      ihi_number: '8003608166690503',
    });
    const ids = out.identifier as Array<{ system: string; value: string }>;
    expect(ids).toHaveLength(2);
    expect(ids[0].system).toBe('http://ns.electronichealth.net.au/id/medicare-number');
    expect(ids[0].value).toBe('1234567890');
    expect(ids[1].system).toBe('http://ns.electronichealth.net.au/id/ihi');
  });

  it('omits identifiers entirely when neither is present', () => {
    const out = patientToFhir({ id: 'p-3' });
    expect(out.identifier).toEqual([]);
  });

  it('emits an address only when at least one address field is present', () => {
    const noAddress = patientToFhir({ id: 'p-4' });
    expect(noAddress.address).toEqual([]);

    const withAddress = patientToFhir({
      id: 'p-5',
      address_street: '123 Main St',
      address_suburb: 'Melbourne',
      address_state: 'VIC',
      address_postcode: '3000',
    });
    expect((withAddress.address as Array<{ city: string; postalCode: string }>)[0]).toMatchObject({
      city: 'Melbourne',
      postalCode: '3000',
    });
  });

  it('coerces a Date birthDate to YYYY-MM-DD', () => {
    const out = patientToFhir({
      id: 'p-6',
      date_of_birth: new Date('1990-04-11T00:00:00Z'),
    });
    expect(out.birthDate).toBe('1990-04-11');
  });
});

describe('observationToFhir', () => {
  it('emits a numeric valueQuantity', () => {
    const out = observationToFhir({
      id: 'o-1',
      patient_id: 'p-1',
      observation_type: 'Heart rate',
      value_numeric: 72,
      unit: 'bpm',
      observed_at: '2026-04-11T08:00:00Z',
    });
    expect(out.resourceType).toBe('Observation');
    expect(out.subject).toEqual({ reference: 'Patient/p-1' });
    expect(out.valueQuantity).toEqual({ value: 72, unit: 'bpm' });
    expect(out.valueString).toBeUndefined();
  });

  it('falls back to valueString when there is no numeric value', () => {
    const out = observationToFhir({
      id: 'o-2',
      patient_id: 'p-1',
      observation_type: 'Mood',
      value_text: 'euthymic',
    });
    expect(out.valueString).toBe('euthymic');
    expect(out.valueQuantity).toBeUndefined();
  });

  it('defaults status to "final"', () => {
    const out = observationToFhir({ id: 'o-3', patient_id: 'p-1' });
    expect(out.status).toBe('final');
  });
});

describe('conditionToFhir', () => {
  it('marks resolved conditions as resolved', () => {
    const out = conditionToFhir({
      id: 'c-1',
      patient_id: 'p-1',
      diagnosis: 'Major depressive disorder',
      status: 'resolved',
    });
    expect((out.clinicalStatus as { coding: Array<{ code: string }> }).coding[0].code).toBe('resolved');
    expect((out.code as { text: string }).text).toBe('Major depressive disorder');
  });

  it('marks anything-not-resolved as active', () => {
    const out = conditionToFhir({
      id: 'c-2',
      patient_id: 'p-1',
      diagnosis: 'Anxiety',
      status: 'open',
    });
    expect((out.clinicalStatus as { coding: Array<{ code: string }> }).coding[0].code).toBe('active');
  });

  it('includes ICD-10 coding when diagnosis_code is present', () => {
    const out = conditionToFhir({
      id: 'c-3',
      patient_id: 'p-1',
      diagnosis: 'Major depressive disorder',
      diagnosis_code: 'F32.9',
    });
    const code = out.code as { coding?: Array<{ system: string; code: string }> };
    expect(code.coding?.[0]).toEqual({ system: 'http://hl7.org/fhir/sid/icd-10', code: 'F32.9' });
  });
});

describe('medicationToFhir', () => {
  it('maps active medications to status=active', () => {
    const out = medicationToFhir({
      id: 'm-1',
      patient_id: 'p-1',
      drug_name: 'Sertraline',
      dose: '50mg',
      frequency: 'daily',
      status: 'active',
      started_at: '2026-04-01T00:00:00Z',
    });
    expect(out.status).toBe('active');
    expect((out.medicationCodeableConcept as { text: string }).text).toBe('Sertraline');
    expect((out.dosage as Array<{ text: string }>)[0].text).toBe('50mg daily');
  });

  it('maps ceased medications to status=stopped', () => {
    const out = medicationToFhir({
      id: 'm-2',
      patient_id: 'p-1',
      drug_name: 'Fluoxetine',
      status: 'ceased',
    });
    expect(out.status).toBe('stopped');
  });
});

describe('SUPPORTED_BULK_TYPES + isSupportedBulkType', () => {
  it('includes the four expected types', () => {
    expect(SUPPORTED_BULK_TYPES).toEqual(['Patient', 'Observation', 'Condition', 'MedicationStatement']);
  });

  it('isSupportedBulkType narrows correctly', () => {
    expect(isSupportedBulkType('Patient')).toBe(true);
    expect(isSupportedBulkType('Observation')).toBe(true);
    expect(isSupportedBulkType('Condition')).toBe(true);
    expect(isSupportedBulkType('MedicationStatement')).toBe(true);
    expect(isSupportedBulkType('Encounter')).toBe(false);
    expect(isSupportedBulkType('')).toBe(false);
  });
});
