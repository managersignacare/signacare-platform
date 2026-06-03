export interface SummaryPatientProfile {
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  gender?: string | null;
}

export interface SummaryEpisodeRow {
  id: string;
  title?: string | null;
  episodeType?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  primaryDiagnosis?: string | null;
  diagnoses?: string | null;
  severity?: string | null;
}

export interface SummaryNoteRow {
  id?: string;
  noteType?: string | null;
  status?: string | null;
  createdAt?: string | null;
  noteDateTime?: string | null;
  didNotAttend?: boolean | null;
  isReportableContact?: boolean | null;
  authorName?: string | null;
  title?: string | null;
  content?: string | null;
  assessmentHtml?: string | null;
  planHtml?: string | null;
  bodyHtml?: string | null;
  episodeId?: string | null;
  contactMeta?: {
    planType?: string | null;
  } | null;
}

export interface SummaryMedicationRow {
  id: string;
  status?: string | null;
  medicationName?: string | null;
  genericName?: string | null;
  drugLabel?: string | null;
  dose?: string | null;
  frequency?: string | null;
  route?: string | null;
  prescribedAt?: string | null;
  ceasedAt?: string | null;
  ceasedReason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface SummaryAlertRow {
  id: string;
  title?: string | null;
  description?: string | null;
  alertSeverity?: string | null;
  severity?: string | null;
  isActive?: boolean | null;
  createdAt?: string | null;
}

export interface SummaryAppointmentRow {
  id: string;
  title?: string | null;
  type?: string | null;
  status?: string | null;
  notes?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  appointmentType?: string | null;
  appointment_type?: string | null;
  appointmentStart?: string | null;
  appointment_start?: string | null;
  start_time?: string | null;
}

export interface SummaryRiskAssessmentRow {
  id: string;
  riskLevel?: string | null;
  assessedAt?: string | null;
  assessed_at?: string | null;
  createdAt?: string | null;
}

export interface SummaryPathwayRow {
  id: string;
  pathwayName?: string | null;
  pathwayType?: string | null;
  status?: string | null;
  notes?: string | null;
  startDate?: string | null;
  createdAt?: string | null;
}

export interface LinkageTaskRow {
  id: string;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  dueAt?: string | null;
  dueDate?: string | null;
  due_at?: string | null;
  due_date?: string | null;
  status?: string | null;
  createdAt?: string | null;
  assigneeName?: string | null;
  assignee_name?: string | null;
}

export interface VivaProfileTrackingRow {
  recordedAt?: string | null;
  note?: string | null;
}

export interface PhysicalHealthSource {
  weight?: number | string | null;
  height?: number | string | null;
  bmi?: number | string | null;
  bpSystolic?: number | string | null;
  bpDiastolic?: number | string | null;
  bp_systolic?: number | string | null;
  bp_diastolic?: number | string | null;
  heartRate?: number | string | null;
  heart_rate?: number | string | null;
  bloodGlucose?: number | string | null;
  blood_glucose?: number | string | null;
  waistCircumference?: number | string | null;
  waist_circumference?: number | string | null;
  systolicBp?: number | string | null;
  diastolicBp?: number | string | null;
  bloodPressure?: string | null;
  pulse?: number | string | null;
  assessmentDate?: string | null;
  assessmentDatetime?: string | null;
  createdAt?: string | null;
  assessmentData?: Record<string, unknown> | null;
  scores?: Record<string, unknown> | null;
}

export interface PhysicalHealthSummary {
  weight?: number | string | null;
  bmi?: number | string | null;
  systolicBp?: number | string | null;
  diastolicBp?: number | string | null;
  bloodPressure?: string | null;
  heartRate?: number | string | null;
  pulse?: number | string | null;
  assessmentDate?: string | null;
  createdAt?: string | null;
}

export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function fmtDate(iso: string | null | undefined): string {
  const date = parseDate(iso);
  return date
    ? date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Unknown date';
}

export function fmtDateShort(iso: string | null | undefined): string {
  const date = parseDate(iso);
  return date
    ? date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
    : '—';
}

export function daysBetween(a: string | null | undefined, b: string | null | undefined): number {
  const first = parseDate(a);
  const second = parseDate(b);
  if (!first || !second) {
    return 0;
  }
  return Math.round((second.getTime() - first.getTime()) / 86400000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readStringArrayField<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (!isRecord(payload)) {
    return [];
  }
  const candidate = payload[key];
  return Array.isArray(candidate) ? (candidate as T[]) : [];
}

export function extractErrorMessage(error: unknown, fallback: string): string {
  if (!isRecord(error)) {
    return fallback;
  }
  const message = typeof error.message === 'string' ? error.message : undefined;
  const response = isRecord(error.response) ? error.response : undefined;
  const data = response && isRecord(response.data) ? response.data : undefined;
  const apiError = data && typeof data.error === 'string' ? data.error : undefined;
  return apiError ?? message ?? fallback;
}
