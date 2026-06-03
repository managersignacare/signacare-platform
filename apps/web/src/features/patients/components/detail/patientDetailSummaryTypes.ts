import type {
  AppointmentResponse,
  EpisodeResponse,
  MedicationResponse,
  PatientClinicalIntelligenceSummary,
  PatientResponse,
  TaskResponse,
} from '@signacare/shared';

import type { PatientFlagResponse } from '../../types/patientTypes';

export type EpisodeSummary = EpisodeResponse;

export type LegalOrderSummary = {
  id: string;
  status?: string | null;
  orderTypeName?: string | null;
  order_type_name?: string | null;
};

export type AllergySummary = {
  status?: string | null;
  isActive?: boolean | null;
  is_active?: boolean | null;
  allergen?: string | null;
  allergenName?: string | null;
  allergen_name?: string | null;
  name?: string | null;
};

export type MedicationSummary = Omit<MedicationResponse, 'status'> & {
  status: MedicationResponse['status'] | 'active' | 'current';
} & Partial<{
  medication_name: string | null;
  supplyDays: number | null;
  prescribed_at: string | null;
  supply_days: number | null;
  is_lai: boolean | null;
  lai_next_due: string | null;
  lai_last_admin: string | null;
}>;

export type PathologySummary = {
  createdAt?: string | null;
  created_at?: string | null;
};

export type AppointmentSummary = Omit<AppointmentResponse, 'status'> & {
  status: AppointmentResponse['status'] | 'no_show' | 'missed';
};

export type OutcomeSummary = {
  id: string;
  createdAt?: string | null;
  totalScore?: number | null;
  total_score?: number | null;
};

export type TaskSummary = TaskResponse & Partial<{
  due_date: string | null;
}>;

export type ClinicalNoteSummary = {
  id: string;
  title?: string | null;
  noteType?: string | null;
  noteCategory?: string | null;
  status?: string | null;
  createdAt?: string | null;
  contactMeta?: {
    planType?: string | null;
  } | null;
};

export type ClinicalIntelligenceSummary = PatientClinicalIntelligenceSummary;

export interface SmartSummaryPanelProps {
  patientId: string;
  patient: PatientResponse;
  activeFlags: PatientFlagResponse[];
}

export function readArrayField<T>(value: unknown, fieldName: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const field = record[fieldName];
  return Array.isArray(field) ? (field as T[]) : [];
}

export function readApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const maybeResponse = (err as { response?: unknown }).response;
  if (maybeResponse && typeof maybeResponse === 'object') {
    const maybeData = (maybeResponse as { data?: unknown }).data;
    if (maybeData && typeof maybeData === 'object') {
      const maybeError = (maybeData as { error?: unknown }).error;
      if (typeof maybeError === 'string' && maybeError.length > 0) {
        return maybeError;
      }
    }
  }
  const maybeMessage = (err as { message?: unknown }).message;
  return typeof maybeMessage === 'string' && maybeMessage.length > 0 ? maybeMessage : fallback;
}
