import {
  ReferralResponse,
  ReferralResponseSchema,
} from '@signacare/shared';
import type {
  ReferralAttachmentDbRow,
  ReferralDbRow,
} from './referralRepository';

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function mapReferralRowToResponse(
  row: ReferralDbRow & {
    patient_given_name?: string;
    patient_family_name?: string;
    patient_dob?: string;
    patient_ur_no?: string;
    coordinator_name?: string;
  },
  _attachments: ReferralAttachmentDbRow[],
): ReferralResponse & {
  patientGivenName?: string;
  patientFamilyName?: string;
  patientDob?: string;
  patientUrNo?: string;
} {
  const base = ReferralResponseSchema.parse({
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    referralNumber: row.referral_number,
    referralDate: typeof row.referral_date === 'string'
      ? row.referral_date
      : (row.referral_date as unknown as Date).toISOString().split('T')[0],
    source: row.source ?? 'external',
    fromService: row.from_service,
    fromProviderName: row.from_provider_name,
    fromProviderPhone: row.from_provider_phone,
    fromProviderEmail: row.from_provider_email,
    fromProviderPrescriberNo: row.from_provider_prescriber_no,
    referringOrg: row.referring_org,
    reason: row.reason ?? '',
    clinicalSummary: row.clinical_summary,
    currentMedications: row.current_medications,
    diagnosisInfo: row.diagnosis_info,
    urgency: row.urgency,
    status: row.status,
    statusChangedAt: toIso(row.status_changed_at),
    receivedAt: toIso(row.received_at) ?? toIso(row.created_at)!,
    assignedToStaffId: row.assigned_to_staff_id,
    linkedEpisodeId: row.linked_episode_id,
    hasAttachment: row.has_attachment,
    ocrExtracted: row.ocr_extracted,
    rejectionReason: row.rejection_reason,
    redirectTo: row.redirect_to,
    slaDueDate: row.sla_due_date,
    slaBreached: row.sla_breached,
    internalNotes: row.internal_notes,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    attachments: [],
    targetSpecialty: row.target_specialty_code ?? null,
    serviceRequestStatus: row.service_request_status ?? null,
    taskStatus: row.task_status ?? null,
    coordinatorId: row.coordinator_id ?? null,
    coordinatorName: row.coordinator_name ?? null,
    triagedAt: toIso(row.triaged_at),
    triagedBy: row.triaged_by ?? null,
  });

  return {
    ...base,
    patientGivenName: row.patient_given_name ?? undefined,
    patientFamilyName: row.patient_family_name ?? undefined,
    patientDob: row.patient_dob ?? undefined,
    patientUrNo: row.patient_ur_no ?? undefined,
    referralMode: (row.referral_mode as 'standard' | 'solo' | 'team') ?? null,
    targetClinicianId: row.target_clinician_id ?? null,
    acceptedByStaffId: row.accepted_by_staff_id ?? null,
    broadcastAt: toIso(row.broadcast_at),
    autoCloseAt: toIso(row.auto_close_at),
    clarificationNotes: row.clarification_notes ?? null,
    feedbackSentAt: toIso(row.feedback_sent_at),
    distributionMode: (row.distribution_mode as
      | 'specific_clinician'
      | 'specialty'
      | 'all'
      | null) ?? null,
    distributionSpeciality: row.distribution_speciality ?? null,
    createdByStaffId: row.created_by_staff_id ?? null,
  };
}
