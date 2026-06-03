export interface CreatedAlertResponse {
  alert?: { id?: string };
}

export interface PlanTemplateField {
  type?: string;
  text?: string;
  label?: string;
}

export interface PlanTemplate {
  id: string;
  name: string;
  categoryName?: string;
  type?: string;
  content?: unknown;
}

export interface StaffTemplatesResponse {
  templates?: PlanTemplate[];
}

export interface PatientNote {
  id: string;
  title?: string;
  content?: string | null;
  createdAt?: string;
  contactMeta?: unknown;
}

export interface PatientNotesResponse {
  notes?: PatientNote[];
  data?: PatientNote[];
}

export interface SafetyPlanApiRow {
  id: string;
  status?: string;
  content?: Record<string, unknown>;
  createdAt: string;
}

export interface NursingAssessmentHistoryRow {
  id?: string;
  createdAt?: string;
  assessmentType?: string;
  scores?: Record<string, unknown>;
  totalScore?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseMaybeRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function asPatientNotes(value: PatientNotesResponse | PatientNote[] | undefined): PatientNote[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (Array.isArray(value.notes)) return value.notes;
  if (Array.isArray(value.data)) return value.data;
  return [];
}
