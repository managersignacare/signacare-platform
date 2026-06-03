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

export const today = (): string => new Date().toISOString().slice(0, 10);

export const STATUS_CHIP: Record<string, { color: string; bg: string }> = {
  scheduled: { color: '#327C8D', bg: '#E8F5F7' },
  'checked-in': { color: '#2E7D32', bg: '#E8F5E9' },
  completed: { color: '#555', bg: '#EFEFEF' },
  'no-show': { color: '#D32F2F', bg: '#FDECEA' },
  cancelled: { color: '#999', bg: '#F5F5F5' },
};

export type AppointmentRow = {
  id?: string;
  startTime?: string;
  start_time?: string;
  time?: string;
  status?: string;
  clinicianName?: string;
  clinician?: string;
  clinician_id?: string;
  clinicianId?: string;
  patientDisplayName?: string;
  patientName?: string;
  patientId?: string;
  patientPhone?: string;
  patient_phone?: string;
  type?: string;
  appointmentType?: string;
  appointment_type?: string;
};

export type AppointmentsResponse =
  | AppointmentRow[]
  | {
      appointments?: AppointmentRow[];
      data?: AppointmentRow[];
    };

export type StaffLookupRow = {
  id: string;
  givenName?: string;
  familyName?: string;
};

export type StaffLookupResponse =
  | StaffLookupRow[]
  | {
      data?: StaffLookupRow[];
    };

export type PhoneTriageCallRow = {
  id?: string;
  urgency?: string;
  caller_name?: string;
  callerName?: string;
  reason_for_call?: string;
  reason?: string;
  assigned_to_id?: string;
  outcome?: string;
  status?: string;
  createdAt?: string;
  created_at?: string;
  caller_phone?: string;
  caller_relationship?: string;
  receptionist_summary?: string;
  receptionistSummary?: string;
  triage_notes?: string;
  action_taken?: string;
  actionTaken?: string;
};

export type PhoneTriageResponse =
  | PhoneTriageCallRow[]
  | {
      calls?: PhoneTriageCallRow[];
      data?: PhoneTriageCallRow[];
    };

export type WaitlistPositionRow = {
  id?: string;
  position?: number;
  estimatedWait?: string;
  addedAt?: string;
  createdAt?: string;
  given_name?: string;
  family_name?: string;
  patientDisplayName?: string;
  patientName?: string;
  emr_number?: string;
  reason?: string;
  type?: string;
  priority?: string;
  urgency?: string;
};

export type WaitlistPositionsResponse =
  | WaitlistPositionRow[]
  | {
      positions?: WaitlistPositionRow[];
      data?: WaitlistPositionRow[];
    };

export type BulkReminderResponse = {
  sentCount?: number;
  sent?: number;
  failedCount?: number;
  failed?: number;
};

export type CheckInOutstandingPayload = {
  invoices?: number;
  flags?: number;
  referrals?: number;
  documents?: number;
  total?: number;
};

export type CheckInOutstandingResponse = {
  appointmentId: string;
  patientId: string | null;
  checkInAt?: string | null;
  checkedInById?: string | null;
  outstanding?: CheckInOutstandingPayload;
};

export const toAppointmentRows = (value: AppointmentsResponse | undefined): AppointmentRow[] =>
  Array.isArray(value) ? value : value?.appointments ?? value?.data ?? [];

export const toStaffRows = (value: StaffLookupResponse | undefined): StaffLookupRow[] =>
  Array.isArray(value) ? value : value?.data ?? [];

export const toPhoneTriageRows = (value: PhoneTriageResponse | undefined): PhoneTriageCallRow[] =>
  Array.isArray(value) ? value : value?.calls ?? value?.data ?? [];

export const toWaitlistRows = (value: WaitlistPositionsResponse | undefined): WaitlistPositionRow[] =>
  Array.isArray(value) ? value : value?.positions ?? value?.data ?? [];

export const normalizeOutstanding = (value: CheckInOutstandingPayload | undefined): Required<CheckInOutstandingPayload> => ({
  invoices: value?.invoices ?? 0,
  flags: value?.flags ?? 0,
  referrals: value?.referrals ?? 0,
  documents: value?.documents ?? 0,
  total: value?.total ?? 0,
});
