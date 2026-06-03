export interface DashboardAppointmentRow {
  id?: string;
  patientId?: string;
  patientName?: string;
  patientDisplayName?: string;
  startTime?: string;
  appointmentType?: string;
  type?: string;
  status?: string;
  duration?: number | string;
  durationMinutes?: number | string;
}

export interface CaseloadRow {
  patientId?: string;
  patientName?: string;
  ragStatus?: string;
}

export interface ContactsKpiRow {
  clinicianName?: string;
  contacts_this_period?: number;
  target?: number;
  ragStatus?: string;
}

export interface StaffCaseloadRow {
  clinicianName?: string;
  patient_count?: number;
  max_caseload?: number;
  caseload_status?: string;
}

export interface DnaRateRow {
  clinicianName?: string;
  dna_rate_pct?: number | string;
}

export interface WorkloadCaseloadAlert {
  name?: string;
  patient_count?: number;
  max_caseload?: number;
}

export interface WorkloadOverdueAlert {
  name?: string;
  overdue_patients?: number;
}

export interface WorkloadData {
  caseloadExceeded?: WorkloadCaseloadAlert[];
  overdueContacts?: WorkloadOverdueAlert[];
}

export interface PhoneTriageRow {
  caller_name?: string;
  urgency?: string;
  reason_for_call?: string;
}

export interface ClinicalAlertRow {
  patientId?: string;
  givenName?: string;
  familyName?: string;
  alertType?: string;
  detail?: string;
  dueDate?: string;
}

export interface ClinicalAlertsCounts {
  laiOverdue?: number;
  legalExpired?: number;
  review91dOverdue?: number;
  review91dUpcoming?: number;
  missedAppointments?: number;
  overdueMedicalReview?: number;
  metabolicOverdue?: number;
  postDischargeContacts?: number;
  unreadMessages?: number;
  openIncidents?: number;
  overdueTasks?: number;
  laiUpcoming?: number;
  legalExpiring?: number;
}

export interface ClinicalAlertsResponse {
  overdue?: ClinicalAlertRow[];
  upcoming?: ClinicalAlertRow[];
  counts?: ClinicalAlertsCounts;
}

export interface HandoverSummary {
  escalatedObservations?: number;
  missedMedications?: number;
  incidents?: number;
  newAdmissions?: number;
  highlights?: string[];
}

export interface TeamScopeOptionRow {
  scopeType: 'team' | 'parent_team' | 'program' | 'clinic';
  scopeId: string | null;
  label: string;
  memberTeams: string[];
}

export interface TeamDashboardScopesRow {
  teams: TeamScopeOptionRow[];
  parentTeams: TeamScopeOptionRow[];
  programs: TeamScopeOptionRow[];
  canViewClinic: boolean;
}

export interface TeamDashboardDataRow {
  scope: {
    scopeType: 'team' | 'parent_team' | 'program' | 'clinic';
    scopeId: string | null;
    scopeLabel: string;
  };
  totals: {
    activePatients: number;
    openEpisodes: number;
    todaysAppointments: number;
    didNotAttendAppointments: number;
    overdueLai: number;
    upcomingLai: number;
    overdueMha: number;
    upcomingMha: number;
    overdueReviews91d: number;
    upcomingReviews91d: number;
    openTasks: number;
    unreadMessages: number;
    newReferrals: number;
    urgentAlerts: number;
  };
  teamBreakdown: Array<{
    teamId: string;
    teamName: string;
    openEpisodes: number;
    activePatients: number;
  }>;
  clinicianBreakdown: Array<{
    staffId: string;
    displayName: string;
    teamId: string;
    teamName: string;
    openEpisodes: number;
    activePatients: number;
  }>;
  generatedAt: string;
}

export interface ContactTypePresentation {
  color: string;
  label: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export function readArray<T>(payload: unknown, keys: string[] = ['data']): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!isRecord(payload)) return [];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

export function getContactTypePresentation(type: string | null | undefined): ContactTypePresentation {
  const t = (type ?? '').toLowerCase();
  if (t.includes('phone') || t.includes('telephone')) return { color: '#1565C0', label: 'Phone' };
  if (t.includes('video') || t.includes('telehealth')) return { color: '#7B1FA2', label: 'Video' };
  if (t.includes('group')) return { color: '#2E7D32', label: 'Group' };
  return { color: '#327C8D', label: 'Face to Face' };
}

export function resolveOpenTaskTileCount(args: {
  openTaskRowsCount: number;
  clinicianOpenTasksCount: number | null | undefined;
  tasksQueryFailed: boolean;
}): number {
  const { openTaskRowsCount, clinicianOpenTasksCount, tasksQueryFailed } = args;
  if (!tasksQueryFailed) {
    return openTaskRowsCount;
  }
  return clinicianOpenTasksCount ?? 0;
}
