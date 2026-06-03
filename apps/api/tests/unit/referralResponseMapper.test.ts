import { describe, expect, it } from 'vitest';
import { mapReferralRowToResponse } from '../../src/features/referrals/referralResponseMapper';
import type { ReferralDbRow } from '../../src/features/referrals/referralRepository';

function buildRow(): ReferralDbRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clinic_id: '22222222-2222-4222-8222-222222222222',
    patient_id: '33333333-3333-4333-8333-333333333333',
    referral_number: 'REF-2026-ABC123',
    referral_date: '2026-05-18',
    source: 'external',
    from_service: 'GP',
    from_provider_name: 'Dr Jane Referrer',
    from_provider_phone: '0400000000',
    from_provider_email: 'jane@example.com',
    from_provider_prescriber_no: '12345A',
    referring_org: 'City Clinic',
    reason: 'Assessment request',
    clinical_summary: null,
    current_medications: null,
    diagnosis_info: null,
    urgency: 'urgent',
    status: 'received',
    status_changed_at: new Date('2026-05-18T00:00:00.000Z'),
    received_at: new Date('2026-05-18T00:00:00.000Z'),
    assigned_to_staff_id: null,
    linked_episode_id: null,
    has_attachment: false,
    ocr_extracted: null,
    rejection_reason: null,
    redirect_to: null,
    sla_due_date: '2026-05-20',
    sla_breached: false,
    internal_notes: null,
    created_at: new Date('2026-05-18T00:00:00.000Z'),
    updated_at: new Date('2026-05-18T00:00:00.000Z'),
    deleted_at: null,
    referral_mode: 'standard',
    target_clinician_id: null,
    distribution_mode: null,
    distribution_speciality: null,
    accepted_by_staff_id: null,
    broadcast_at: null,
    reminder_sent_at: null,
    final_reminder_sent_at: null,
    auto_close_at: null,
    feedback_sent_at: null,
    clarification_notes: null,
    created_by_staff_id: null,
    target_specialty_code: 'mental_health',
    service_request_status: 'active',
    task_status: 'received',
    coordinator_id: null,
    triaged_at: null,
    triaged_by: null,
  };
}

describe('mapReferralRowToResponse', () => {
  it('maps optional patient display fields for intake list', () => {
    const mapped = mapReferralRowToResponse(
      {
        ...buildRow(),
        patient_given_name: 'Noah',
        patient_family_name: 'Bennett',
        patient_dob: '1981-02-02',
        patient_ur_no: 'P000003',
      },
      [],
    );

    expect(mapped.patientGivenName).toBe('Noah');
    expect(mapped.patientFamilyName).toBe('Bennett');
    expect(mapped.patientDob).toBe('1981-02-02');
    expect(mapped.patientUrNo).toBe('P000003');
  });
});
