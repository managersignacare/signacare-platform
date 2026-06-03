import { describe, expect, it } from 'vitest';
import {
  mapAdmissionWaitlistListRowToResponse,
  mapAdmissionWaitlistRowToResponse,
  mapClinicalNoteRowToResponse,
  mapHotspotRowToResponse,
  mapPatientAlertRowToResponse,
  mapPatientLegalOrderRowToResponse,
  type AdmissionWaitlistListRow,
  type AdmissionWaitlistRow,
  type ClinicalNoteRow,
  type HotspotRow,
  type PatientAlertRow,
  type PatientLegalOrderRow,
} from '../../src/features/patients/patientResponseMappers';

describe('patientResponseMappers (BUG-459)', () => {
  it('maps clinical note snake_case keys to camelCase', () => {
    const row: ClinicalNoteRow = {
      id: 'n1',
      clinic_id: 'c1',
      patient_id: 'p1',
      episode_id: 'e1',
      author_id: 's1',
      appointment_id: null,
      title: 'T',
      note_type: 'progress',
      note_category: null,
      source_type: null,
      note_date_time: '2026-05-11T10:00:00.000Z',
      note_date: '2026-05-11',
      content: 'content',
      content_html: null,
      structured_fields: null,
      status: 'draft',
      is_draft: true,
      is_signed: false,
      template_id: null,
      is_reportable_contact: false,
      contact_meta: null,
      foi_content: null,
      foi_exempt: false,
      did_not_attend: false,
      is_ai_draft: true,
      soap_subjective: null,
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      amended_from_id: null,
      signed_at: null,
      signed_by: null,
      signed_by_id: null,
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T10:00:00.000Z',
      deleted_at: null,
      search_tsv: null,
      lock_version: 3,
    };

    const mapped = mapClinicalNoteRowToResponse(row) as Record<string, unknown>;
    expect(mapped.patientId).toBe('p1');
    expect(mapped.noteType).toBe('progress');
    expect(mapped.isAiDraft).toBe(true);
    expect(mapped.lockVersion).toBe(3);
  });

  it('maps patient legal order keys to camelCase', () => {
    const row: PatientLegalOrderRow = {
      id: 'lo1',
      patient_id: 'p1',
      clinic_id: 'c1',
      order_type_id: 't1',
      entered_by_id: 's1',
      order_number: 'MHA-1',
      start_date: '2026-05-11',
      end_date: null,
      review_date: null,
      next_application_date: null,
      status: 'active',
      notes: null,
      ai_summary: null,
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T10:00:00.000Z',
    };

    const mapped = mapPatientLegalOrderRowToResponse(row) as Record<string, unknown>;
    expect(mapped.orderTypeId).toBe('t1');
    expect(mapped.orderNumber).toBe('MHA-1');
    expect(mapped.nextApplicationDate).toBeNull();
  });

  it('maps patient alert keys to camelCase', () => {
    const row: PatientAlertRow = {
      id: 'a1',
      patient_id: 'p1',
      clinic_id: 'c1',
      alert_type_id: 't1',
      entered_by_id: 's1',
      title: 'Allergy',
      notes: null,
      management_plan: null,
      severity: 'high',
      is_active: true,
      show_flag: true,
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T10:00:00.000Z',
      resolved_at: null,
    };

    const mapped = mapPatientAlertRowToResponse(row) as Record<string, unknown>;
    expect(mapped.alertTypeId).toBe('t1');
    expect(mapped.managementPlan).toBeNull();
    expect(mapped.showFlag).toBe(true);
  });

  it('maps hotspot keys to camelCase', () => {
    const row: HotspotRow = {
      id: 'h1',
      clinic_id: 'c1',
      patient_id: 'p1',
      hotspot_type: 'risk',
      reason: 'escalation',
      severity: 'critical',
      is_active: true,
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T10:00:00.000Z',
    };

    const mapped = mapHotspotRowToResponse(row) as Record<string, unknown>;
    expect(mapped.hotspotType).toBe('risk');
    expect(mapped.patientId).toBe('p1');
  });

  it('maps admission waitlist entry keys to camelCase', () => {
    const row: AdmissionWaitlistRow = {
      id: 'w1',
      clinic_id: 'c1',
      patient_id: 'p1',
      episode_id: 'e1',
      hotspot_id: null,
      source: 'planned',
      priority: 'high',
      status: 'waiting',
      reason: 'reason',
      clinical_notes: 'notes',
      preferred_ward: 'ward-a',
      target_admission_date: '2026-05-20',
      flagged_by_staff_id: 's1',
      removed_by_staff_id: null,
      removed_at: null,
      removal_reason: null,
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T10:00:00.000Z',
    };

    const mapped = mapAdmissionWaitlistRowToResponse(row) as Record<string, unknown>;
    expect(mapped.targetAdmissionDate).toBe('2026-05-20');
    expect(mapped.flaggedByStaffId).toBe('s1');
  });

  it('maps admission waitlist list projection keys to camelCase', () => {
    const row: AdmissionWaitlistListRow = {
      id: 'w1',
      clinic_id: 'c1',
      patient_id: 'p1',
      episode_id: 'e1',
      hotspot_id: null,
      source: 'planned',
      priority: 'high',
      status: 'waiting',
      reason: 'reason',
      clinical_notes: 'notes',
      preferred_ward: 'ward-a',
      target_admission_date: '2026-05-20',
      flagged_by_staff_id: 's1',
      removed_by_staff_id: null,
      removed_at: null,
      removal_reason: null,
      created_at: '2026-05-11T10:00:00.000Z',
      updated_at: '2026-05-11T10:00:00.000Z',
      patient_given_name: 'Jane',
      patient_family_name: 'Smith',
      emr_number: 'EMR-1',
      flagged_by_name: 'Dr Jones',
    };

    const mapped = mapAdmissionWaitlistListRowToResponse(row);
    expect(mapped.patientGivenName).toBe('Jane');
    expect(mapped.emrNumber).toBe('EMR-1');
    expect(mapped.flaggedByName).toBe('Dr Jones');
  });

  it('preserves nullish passthrough for mapper guards', () => {
    expect(mapClinicalNoteRowToResponse(undefined)).toBeUndefined();
    expect(mapPatientLegalOrderRowToResponse(null)).toBeNull();
  });
});

