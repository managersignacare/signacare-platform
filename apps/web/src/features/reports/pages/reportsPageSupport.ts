export interface ReportScheduleRow {
  id?: string;
  report_type?: string;
  reportType?: string;
  schedule_cron?: string;
  scheduleCron?: string;
  format?: string;
  is_active?: boolean;
  isActive?: boolean;
  next_run_at?: string | null;
}

export interface ReportSchedulesResponse {
  data?: ReportScheduleRow[];
}

export type ReportDataCell = number | string | undefined;
export type ReportDataRow = { label: string } & Record<string, ReportDataCell>;

export interface ReportDataShape {
  rows: ReportDataRow[];
  summary?: Record<string, number>;
  error?: boolean;
}

export interface CaseloadTeamRow {
  teamId?: string;
  teamName?: string;
  caseload?: number;
}

export interface CaseloadClinicianRow {
  staffId?: string;
  staffName?: string;
  role?: string;
  teamId?: string;
  caseload?: number;
}

export interface CaseloadByTeamResponse {
  teams?: CaseloadTeamRow[];
  clinicians?: CaseloadClinicianRow[];
}

export interface AuditTemplateRow {
  id: string;
  name?: string;
  description?: string | null;
  questions?: unknown;
}

export interface AuditRunScoreRow {
  question?: string;
  score?: number;
}

export interface AuditRunResultRow {
  noteId?: string;
  overallScore?: number;
  summary?: string;
  scores?: AuditRunScoreRow[];
  error?: string;
}

export interface AuditRunRow {
  id: string;
  status?: string;
  sample_size?: number;
  createdAt?: string;
  created_at?: string;
  results?: AuditRunResultRow[] | unknown;
}

export interface AuditTemplatesResponse {
  templates?: AuditTemplateRow[];
}

export interface AuditRunsResponse {
  runs?: AuditRunRow[];
}

export interface StaffLookupRow {
  id: string;
  givenName?: string;
  familyName?: string;
}

export interface AuditRunDetailResponse {
  run?: AuditRunRow;
  template?: AuditTemplateRow;
}

export interface StartAuditResponse {
  run?: { id?: string };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

export function readErrorMessage(err: unknown, fallback = 'Unknown'): string {
  const rec = asRecord(err);
  if (!rec) return fallback;
  const response = asRecord(rec.response);
  const data = asRecord(response?.data);
  if (typeof data?.error === 'string' && data.error.trim().length > 0) return data.error;
  if (typeof rec.message === 'string' && rec.message.trim().length > 0) return rec.message;
  return fallback;
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function readReportSchedules(payload: unknown): ReportScheduleRow[] {
  if (Array.isArray(payload)) return payload as ReportScheduleRow[];
  const rec = asRecord(payload);
  if (!rec) return [];
  return Array.isArray(rec.data) ? (rec.data as ReportScheduleRow[]) : [];
}

export function readStaffLookup(payload: unknown): StaffLookupRow[] {
  if (Array.isArray(payload)) return payload as StaffLookupRow[];
  const rec = asRecord(payload);
  if (!rec) return [];
  return Array.isArray(rec.data) ? (rec.data as StaffLookupRow[]) : [];
}

export function readAuditQuestions(rawQuestions: unknown): Array<{ text: string }> {
  let parsed = rawQuestions;
  if (typeof rawQuestions === 'string') {
    try {
      parsed = JSON.parse(rawQuestions) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((q): { text: string } => {
    if (typeof q === 'string') return { text: q };
    const rec = asRecord(q);
    if (typeof rec?.text === 'string') return { text: rec.text };
    return { text: '' };
  });
}
