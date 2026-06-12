import { describe, expect, it } from 'vitest';
import {
  canRequestDutyClinicianRelationship,
  canRequestDutyPrescriberRelationship,
  DUTY_RELATIONSHIP_DURATION_HOURS,
  getAllowedDutyRelationshipTypes,
  isDutyRelationshipType,
} from './patientDutyRelationship';

describe('patientDutyRelationship', () => {
  it('blocks operational and cross-clinic roles from duty clinician access', () => {
    expect(canRequestDutyClinicianRelationship('receptionist')).toBe(false);
    expect(canRequestDutyClinicianRelationship('readonly')).toBe(false);
    expect(canRequestDutyClinicianRelationship('superadmin')).toBe(false);
    expect(canRequestDutyClinicianRelationship('clinician')).toBe(true);
  });

  it('allows duty prescriber access only for prescriber system roles', () => {
    expect(canRequestDutyPrescriberRelationship('prescriber_consultant')).toBe(true);
    expect(canRequestDutyPrescriberRelationship('prescriber_registrar')).toBe(true);
    expect(canRequestDutyPrescriberRelationship('prescriber_hmo')).toBe(true);
    expect(canRequestDutyPrescriberRelationship('prescriber_nurse_practitioner')).toBe(true);
    expect(canRequestDutyPrescriberRelationship('clinician')).toBe(false);
  });

  it('derives allowed duty relationship types from role', () => {
    expect(getAllowedDutyRelationshipTypes('clinician')).toEqual(['duty_clinician']);
    expect(getAllowedDutyRelationshipTypes('prescriber_hmo')).toEqual([
      'duty_clinician',
      'duty_prescriber',
    ]);
    expect(getAllowedDutyRelationshipTypes('readonly')).toEqual([]);
  });

  it('exposes the bounded duration allow-list', () => {
    expect(DUTY_RELATIONSHIP_DURATION_HOURS).toEqual([4, 8, 12]);
  });

  it('recognizes valid duty relationship types', () => {
    expect(isDutyRelationshipType('duty_clinician')).toBe(true);
    expect(isDutyRelationshipType('duty_prescriber')).toBe(true);
    expect(isDutyRelationshipType('break_glass')).toBe(false);
  });
});

