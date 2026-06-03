export interface VivaInviteCode {
  code?: string | null;
  expiresAt?: string | null;
}

export interface VivaInviteResponse {
  hasAccount?: boolean;
  accountActive?: boolean;
  lastLogin?: string | null;
  invite?: VivaInviteCode | null;
}

export interface VivaTrackingEntry {
  id?: string;
  type?: string | null;
  value?: number | string | null;
  recordedAt?: string | null;
  note?: string | null;
  source?: string | null;
}

export interface VivaTrackingResponse {
  entries?: VivaTrackingEntry[];
}

export interface VivaGoalStep {
  done?: boolean;
  text?: string | null;
}

export interface VivaDiaryPayload {
  mood?: string | null;
  title?: string | null;
  content?: string | null;
}

export interface VivaGoalPayload {
  progress?: number;
  title?: string | null;
  category?: string | null;
  steps?: VivaGoalStep[];
}

export interface VivaActivityPayload {
  done?: boolean;
  time?: string | null;
  name?: string | null;
  category?: string | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readArrayField<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (!isRecord(payload)) {
    return [];
  }
  const candidate = payload[key];
  return Array.isArray(candidate) ? (candidate as T[]) : [];
}

export function parseJsonFromNote(note: string | null | undefined): unknown {
  if (!note) {
    return null;
  }
  try {
    return JSON.parse(note);
  } catch {
    return note;
  }
}
