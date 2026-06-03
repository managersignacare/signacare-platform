export type PatientOption = {
  id: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
};

export type PatientsResponse =
  | PatientOption[]
  | {
      patients?: PatientOption[];
      data?: PatientOption[];
    };

export type MarAdministrationRow = {
  scheduledTime?: string;
  time?: string;
  status?: string;
};

export type MarMedicationRow = {
  id?: string;
  name?: string;
  medicationName?: string;
  dose?: string;
  route?: string;
  administrations?: MarAdministrationRow[];
};

export type MarChartResponse = {
  medications?: MarMedicationRow[];
  data?: MarMedicationRow[];
};

export type ObservationForm = {
  level: string;
  location: string;
  mood: string;
  behaviour: string;
  sleep: string;
  notes: string;
};

export type ObservationRow = {
  id?: string;
  createdAt?: string;
  level?: string;
  location?: string;
  mood?: string;
  behaviour?: string;
  sleep?: string;
  notes?: string;
};

export type ObservationsResponse =
  | ObservationRow[]
  | {
      observations?: ObservationRow[];
      data?: ObservationRow[];
    };

export type ShiftType = 'day' | 'evening' | 'night';

export type HandoverUpdateRow = {
  id?: string;
  patientName?: string;
  patientDisplayName?: string;
  priority?: string;
  summary?: string;
  notes?: string;
  description?: string;
};

export type HandoverUpdatesResponse =
  | HandoverUpdateRow[]
  | {
      updates?: HandoverUpdateRow[];
      data?: HandoverUpdateRow[];
    };

export type HandoverAutoSummaryResponse = {
  summary?: string;
  text?: string;
  keyIssues?: string[];
};

export type SaveHandoverPayload = {
  shiftType: ShiftType;
  summary: string;
  keyIssues: string[];
};

export type RiskFlags = {
  suicidality?: 'none' | 'ideation' | 'plan' | 'intent';
  agitation?: 'none' | 'mild' | 'moderate' | 'severe';
  intoxication?: boolean;
  safety_concern_notes?: string;
};

export type PhoneTriageRow = {
  id: string;
  urgency?: string;
  caller_name?: string;
  reason_for_call?: string;
  receptionist_summary?: string;
  clinical_risk_flags?: RiskFlags | string;
  clinicalRiskFlags?: RiskFlags | string;
};

export type PhoneTriageResponse =
  | PhoneTriageRow[]
  | {
      data?: PhoneTriageRow[];
    };

export const toPatientList = (value: PatientsResponse | undefined): PatientOption[] =>
  Array.isArray(value) ? value : value?.patients ?? value?.data ?? [];

export const toMarMedicationList = (value: MarChartResponse | undefined): MarMedicationRow[] =>
  value?.medications ?? value?.data ?? [];

export const toObservationList = (value: ObservationsResponse | undefined): ObservationRow[] =>
  Array.isArray(value) ? value : value?.observations ?? value?.data ?? [];

export const toHandoverUpdates = (value: HandoverUpdatesResponse | undefined): HandoverUpdateRow[] =>
  Array.isArray(value) ? value : value?.updates ?? value?.data ?? [];

export const toPhoneTriageRows = (value: PhoneTriageResponse | undefined): PhoneTriageRow[] =>
  Array.isArray(value) ? value : value?.data ?? [];

export const parseRiskFlags = (raw: unknown): RiskFlags => {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as RiskFlags;
      return parsed ?? {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return raw as RiskFlags;
  }
  return {};
};

export const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

export const fmtTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};
