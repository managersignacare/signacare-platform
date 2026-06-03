// BUG-459 — explicit response mappers for patientRoutes high-risk raw-row
// endpoints per CLAUDE.md §5.2 (no raw Knex rows across the response boundary).
// R-FIX-BUG-459-MAPPERS-FILE

export interface ClinicalNoteRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  author_id: string | null;
  appointment_id: string | null;
  title: string | null;
  note_type: string;
  note_category: string | null;
  source_type: string | null;
  note_date_time: string | Date | null;
  note_date: string | Date | null;
  content: string | null;
  content_html: string | null;
  structured_fields: unknown;
  status: string;
  is_draft: boolean | null;
  is_signed: boolean | null;
  template_id: string | null;
  is_reportable_contact: boolean;
  contact_meta: unknown;
  foi_content: string | null;
  foi_exempt: boolean;
  did_not_attend: boolean;
  is_ai_draft: boolean;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  amended_from_id: string | null;
  signed_at: string | Date | null;
  signed_by: string | null;
  signed_by_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at: string | Date | null;
  search_tsv: string | null;
  lock_version: number;
}

export interface ClinicalNoteListRow extends ClinicalNoteRow {
  author_name: string;
  author_signature: string | null;
  signed_by_name: string;
  episode_title: string | null;
  episode_type: string | null;
}

export interface PatientLegalOrderRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  order_type_id: string;
  entered_by_id: string | null;
  order_number: string | null;
  start_date: string | Date;
  end_date: string | Date | null;
  review_date: string | Date | null;
  next_application_date: string | Date | null;
  status: string;
  notes: string | null;
  ai_summary: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface PatientAlertRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  alert_type_id: string;
  entered_by_id: string | null;
  title: string;
  notes: string | null;
  management_plan: string | null;
  severity: string;
  is_active: boolean;
  show_flag: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  resolved_at: string | Date | null;
}

export interface HotspotRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  hotspot_type: string | null;
  reason: string | null;
  severity: string | null;
  is_active: boolean | null;
  created_at: string | Date;
  updated_at: string | Date | null;
}

export interface AdmissionWaitlistRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  hotspot_id: string | null;
  source: string;
  priority: string;
  status: string;
  reason: string | null;
  clinical_notes: string | null;
  preferred_ward: string | null;
  target_admission_date: string | Date | null;
  flagged_by_staff_id: string | null;
  removed_by_staff_id: string | null;
  removed_at: string | Date | null;
  removal_reason: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface AdmissionWaitlistListRow extends AdmissionWaitlistRow {
  patient_given_name: string | null;
  patient_family_name: string | null;
  emr_number: string | null;
  flagged_by_name: string;
}

export function mapClinicalNoteRowToResponse(
  row: ClinicalNoteRow | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!row) return row;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    authorId: row.author_id,
    appointmentId: row.appointment_id,
    title: row.title,
    noteType: row.note_type,
    noteCategory: row.note_category,
    sourceType: row.source_type,
    noteDateTime: row.note_date_time,
    noteDate: row.note_date,
    content: row.content,
    contentHtml: row.content_html,
    structuredFields: row.structured_fields,
    status: row.status,
    isDraft: row.is_draft,
    isSigned: row.is_signed,
    templateId: row.template_id,
    isReportableContact: row.is_reportable_contact,
    contactMeta: row.contact_meta,
    foiContent: row.foi_content,
    foiExempt: row.foi_exempt,
    didNotAttend: row.did_not_attend,
    isAiDraft: row.is_ai_draft,
    soapSubjective: row.soap_subjective,
    soapObjective: row.soap_objective,
    soapAssessment: row.soap_assessment,
    soapPlan: row.soap_plan,
    amendedFromId: row.amended_from_id,
    signedAt: row.signed_at,
    signedBy: row.signed_by,
    signedById: row.signed_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    searchTsv: row.search_tsv,
    lockVersion: row.lock_version,
  };
}

export function mapClinicalNoteListRowToResponse(
  row: ClinicalNoteListRow,
): Record<string, unknown> {
  return {
    id: row.id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    episodeTitle: row.episode_title,
    episodeType: row.episode_type,
    templateId: row.template_id,
    authorId: row.author_id,
    authorName: row.author_name,
    title: row.title,
    noteType: row.note_type,
    noteDateTime: row.note_date_time ?? row.created_at,
    content: row.content,
    foiContent: row.foi_content,
    foiExempt: row.foi_exempt,
    status: row.status,
    didNotAttend: row.did_not_attend,
    isReportableContact: row.is_reportable_contact ?? true,
    isAiDraft: row.is_ai_draft,
    contactMeta: row.contact_meta ?? null,
    signedById: row.signed_by_id,
    signedByName: row.signed_by_name,
    signedAt: row.signed_at,
    authorSignature: row.author_signature ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPatientLegalOrderRowToResponse(
  row: PatientLegalOrderRow | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!row) return row;
  return {
    id: row.id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    orderTypeId: row.order_type_id,
    enteredById: row.entered_by_id,
    orderNumber: row.order_number,
    startDate: row.start_date,
    endDate: row.end_date,
    reviewDate: row.review_date,
    nextApplicationDate: row.next_application_date,
    status: row.status,
    notes: row.notes,
    aiSummary: row.ai_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPatientAlertRowToResponse(
  row: PatientAlertRow | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!row) return row;
  return {
    id: row.id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    alertTypeId: row.alert_type_id,
    enteredById: row.entered_by_id,
    title: row.title,
    notes: row.notes,
    managementPlan: row.management_plan,
    severity: row.severity,
    isActive: row.is_active,
    showFlag: row.show_flag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export function mapHotspotRowToResponse(
  row: HotspotRow | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!row) return row;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    hotspotType: row.hotspot_type,
    reason: row.reason,
    severity: row.severity,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAdmissionWaitlistRowToResponse(
  row: AdmissionWaitlistRow | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!row) return row;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    hotspotId: row.hotspot_id,
    source: row.source,
    priority: row.priority,
    status: row.status,
    reason: row.reason,
    clinicalNotes: row.clinical_notes,
    preferredWard: row.preferred_ward,
    targetAdmissionDate: row.target_admission_date,
    flaggedByStaffId: row.flagged_by_staff_id,
    removedByStaffId: row.removed_by_staff_id,
    removedAt: row.removed_at,
    removalReason: row.removal_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAdmissionWaitlistListRowToResponse(
  row: AdmissionWaitlistListRow,
): Record<string, unknown> {
  return {
    ...mapAdmissionWaitlistRowToResponse(row),
    patientGivenName: row.patient_given_name,
    patientFamilyName: row.patient_family_name,
    emrNumber: row.emr_number,
    flaggedByName: row.flagged_by_name,
  };
}
