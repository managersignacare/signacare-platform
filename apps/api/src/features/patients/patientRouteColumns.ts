export const PATIENT_ATTACHMENT_COLUMNS = [
  'id', 'patient_id', 'uploaded_by', 'filename', 'label', 'mime_type',
  'file_size', 'file_path', 'is_active', 'created_at', 'storage_backend',
  'storage_key', 'storage_bucket', 'storage_etag', 'clinic_id',
  'episode_id', 'specialty_code', 'updated_at',
] as const;

export const TASK_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'assigned_to_id',
  'assigned_by_id', 'title', 'description', 'task_type', 'priority',
  'status', 'due_date', 'completed_at', 'completed_by_id', 'notes',
  'created_at', 'updated_at',
] as const;

export const CLINICAL_NOTE_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'author_id',
  'appointment_id', 'title', 'note_type', 'note_category', 'source_type',
  'note_date_time', 'note_date', 'content', 'content_html',
  'structured_fields', 'status', 'is_draft', 'is_signed', 'template_id',
  'is_reportable_contact', 'contact_meta', 'foi_content', 'foi_exempt',
  'did_not_attend', 'is_ai_draft', 'soap_subjective', 'soap_objective',
  'soap_assessment', 'soap_plan', 'amended_from_id', 'signed_at',
  'signed_by', 'signed_by_id', 'created_at', 'updated_at', 'deleted_at',
  'search_tsv', 'lock_version',
] as const;

export const PATIENT_LEGAL_ORDER_COLUMNS = [
  'id', 'patient_id', 'clinic_id', 'order_type_id', 'entered_by_id',
  'order_number', 'start_date', 'end_date', 'review_date',
  'next_application_date', 'status', 'notes', 'ai_summary',
  'created_at', 'updated_at',
] as const;

// BUG-400d/e (audit immutability) — exclude free-text notes/ai_summary.
export const LEGAL_ORDER_AUDIT_COLS = [
  'id', 'patient_id', 'order_type_id', 'order_number',
  'start_date', 'end_date', 'review_date', 'next_application_date',
  'status', 'updated_at',
] as const;

export const PATIENT_LEGAL_ATTACHMENT_COLUMNS = [
  'id', 'patient_id', 'legal_order_id', 'category', 'filename',
  'mime_type', 'file_size', 'file_path', 'created_at', 'storage_backend',
  'storage_key', 'storage_bucket', 'storage_etag', 'clinic_id', 'updated_at',
] as const;
