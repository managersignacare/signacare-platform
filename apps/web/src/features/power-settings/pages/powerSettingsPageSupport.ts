export type LookupUpdatePayload = Record<string, unknown>

export type AlertTypeRow = {
  id: string
  name: string
  severity?: string
  isActive?: boolean
  sortOrder?: number
}

export type LegalOrderTypeRow = {
  id: string
  name: string
  category?: string
  isActive?: boolean
  sortOrder?: number
}

export type AppointmentModeRow = {
  id: string
  name: string
  isActive?: boolean
  sortOrder?: number
}

export type TemplateCategoryRow = {
  id: string
  name: string
  isActive?: boolean
}

export type EpisodeTypeRow = {
  id: string
  name: string
  isActive?: boolean
  sortOrder?: number
}

export type RoleTypeRow = {
  id: string
  name: string
  isActive?: boolean
  is_active?: boolean
  sortOrder?: number
  sort_order?: number
}

export type ClinicOption = {
  id: string
  name: string
}

export const ALL_MODULES: Array<{ key: string; label: string; description: string }> = [
  { key: 'patients', label: 'Patient Management', description: 'Patient registration, demographics, contacts, NOK' },
  { key: 'episodes', label: 'Episode Management', description: 'Treatment episodes, intake, discharge' },
  { key: 'clinical_notes', label: 'Clinical Notes', description: 'Progress notes, ward rounds, assessments' },
  { key: 'medications', label: 'Medications & Prescriptions', description: 'Prescribing, MAR chart, PBS' },
  { key: 'lai', label: 'LAI Management', description: 'Long-acting injectable scheduling and revalidation' },
  { key: 'clozapine', label: 'Clozapine Monitoring', description: 'NIMC titration, blood monitoring, CPMS' },
  { key: 'referrals', label: 'Referral Management', description: 'Internal and external referrals, intake' },
  { key: 'referral-solo', label: 'Solo Referral Management', description: 'Single practitioner accept/reject workflow with auto-episode and appointment creation' },
  { key: 'referral-team', label: 'Team Referral Management', description: 'Multi-clinician distribution with first-to-accept, reminders, and auto-close. Mutually exclusive with Solo.' },
  { key: 'appointments', label: 'Appointments & Scheduling', description: 'Clinic scheduling, recurring appointments' },
  { key: 'bed_board', label: 'Bed Board / Inpatient', description: 'Ward management, admissions, discharge' },
  { key: 'pathology', label: 'Pathology & Investigations', description: 'Lab results, uploads, monitoring' },
  { key: 'mha', label: 'Mental Health Act / Legal', description: 'Legal orders, tribunals, consent' },
  { key: 'tasks', label: 'Task Management', description: 'Clinical tasks, team tasks, reminders' },
  { key: 'correspondence', label: 'Correspondence & Letters', description: 'Letter generation, templates, faxing' },
  { key: 'billing', label: 'Billing & ABF', description: 'Medicare billing, ABF reporting, invoicing' },
  { key: 'reports', label: 'Reports & Analytics', description: 'Clinical reports, dashboards, CMI' },
  { key: 'medical-scribe', label: 'Medical Scribe (Ambient)', description: 'Ambient recording, Whisper Sync transcription, and structured note generation' },
  { key: 'ai-agent', label: 'AI Agent', description: 'Clinical AI assistant, decision support' },
  { key: 'agentic-ai-scribe', label: 'Medical Scribe Drafting', description: 'Transcript-to-draft follow-through for labs, referrals, follow-up appointments, and tasks' },
  { key: 'group_therapy', label: 'Group Therapy', description: 'Group sessions, attendance tracking' },
  { key: 'escalations', label: 'Escalations', description: 'Clinical escalations, ISBAR' },
  { key: 'shift_handover', label: 'Shift Handover', description: 'Nursing handover, clinical summaries' },
  { key: 'outcome_measures', label: 'Outcome Measures', description: 'HoNOS, K10/K10+, LSP-16 and NOCC outcome reporting' },
  { key: 'risk_assessment', label: 'Risk Assessment', description: 'Risk assessments, safety planning' },
  { key: 'pathways', label: 'Treatment Pathways', description: 'Structured digital care pathways (CBT, DBT, ACT, EMDR, CAT, schema)' },
  { key: 'workflows', label: 'Workflow Builder', description: 'Automated business process workflows' },
]
