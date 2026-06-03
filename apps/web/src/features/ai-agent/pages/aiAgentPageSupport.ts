export interface AiPatientContext {
  givenName?: string;
  familyName?: string;
  preferredName?: string;
  dateOfBirth?: string;
  gender?: string;
  emrNumber?: string;
  medicareNumber?: string;
  atsiStatus?: string;
  interpreterRequired?: boolean;
  interpreterLanguage?: string;
  addressStreet?: string;
  addressSuburb?: string;
  addressState?: string;
  addressPostcode?: string;
  phoneMobile?: string;
  emailPrimary?: string;
  gpName?: string;
  gpPractice?: string;
  gpPhone?: string;
  nokName?: string;
  nokRelationship?: string;
  nokPhone?: string;
}

export interface AiClinicalNote {
  noteType?: string;
  createdAt?: string;
  authorName?: string;
  assessmentHtml?: string;
  planHtml?: string;
  bodyHtml?: string;
  content?: string;
}

export interface AiAlert {
  isActive?: boolean;
  title?: string;
  alertSeverity?: string;
  notes?: string;
  resolvedAt?: string;
}

export interface AiMedication {
  status?: string;
  medicationName?: string;
  dose?: string;
  frequency?: string;
  route?: string;
  isLai?: boolean;
  isS8?: boolean;
  isClozapine?: boolean;
  indication?: string;
  ceasedAt?: string;
  ceasedReason?: string;
}

export interface AiEpisode {
  status?: string;
  title?: string;
  episodeType?: string;
  team?: string;
  startDate?: string;
  endDate?: string;
  primaryDiagnosis?: string;
  closureReason?: string;
}

export interface AiContact {
  givenName?: string;
  familyName?: string;
  relationship?: string;
  isEmergencyContact?: boolean;
  isCarer?: boolean;
}

export interface AiAppointment {
  startTime?: string;
  appointmentType?: string;
  status?: string;
}

export interface AgentToolCall {
  tool?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

export function readArrayPayload<T>(payload: unknown, keys: string[] = ['data']): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const rec = asRecord(payload);
  if (!rec) return [];
  for (const key of keys) {
    const value = rec[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

export function readErrorMessage(err: unknown, fallback: string): string {
  const rec = asRecord(err);
  if (!rec) return fallback;
  const response = asRecord(rec.response);
  const data = asRecord(response?.data);
  if (typeof data?.error === 'string' && data.error.trim().length > 0) return data.error;
  if (typeof rec.message === 'string' && rec.message.trim().length > 0) {
    const message = rec.message.trim();
    if (!/^Request failed with status code \d{3}$/i.test(message)) {
      return message;
    }
  }
  const statusRaw = rec.status ?? response?.status;
  const status = typeof statusRaw === 'number' ? statusRaw : Number(statusRaw);
  if (status === 502 || status === 503 || status === 504) {
    return 'AI service is temporarily unavailable. Please retry in a few seconds.';
  }
  return fallback;
}
