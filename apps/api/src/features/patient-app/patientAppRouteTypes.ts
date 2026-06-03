import { z } from 'zod';

export interface TrackingQueryRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  tracking_type: string;
  value: string | number;
  note: string | null;
  source: string | null;
  recorded_at: Date | string;
}

export interface MedReminderQueryRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  drug_name: string;
  dose: string | null;
  instructions: string | null;
  days_of_week: number[] | null;
  reminder_time: string;
  medication_id: string | null;
  is_active: boolean;
  created_at: Date | string;
}

export interface SharedDocumentQueryRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  title: string;
  doc_type: string;
  file_path: string | null;
  url: string | null;
  shared_by: string | null;
  created_at: Date | string;
}

export const MedReminderResponseSchema = z.object({
  id: z.string().uuid(),
  drugName: z.string(),
  dose: z.string().nullable(),
  instructions: z.string().nullable(),
  daysOfWeek: z.array(z.number().int()).nullable(),
  reminderTime: z.string(),
  medicationId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  createdAt: z.union([z.date(), z.string()]),
});

export const MedRemindersResponseSchema = z.object({
  reminders: z.array(MedReminderResponseSchema),
});

export const SharedDocumentResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  docType: z.string(),
  filePath: z.string().nullable(),
  url: z.string().nullable(),
  sharedBy: z.string().nullable(),
  createdAt: z.union([z.date(), z.string()]),
});

export const SharedDocumentsResponseSchema = z.object({
  documents: z.array(SharedDocumentResponseSchema),
});

export function mapMedReminderRowToResponse(row: MedReminderQueryRow): z.infer<typeof MedReminderResponseSchema> {
  return {
    id: row.id,
    drugName: row.drug_name,
    dose: row.dose,
    instructions: row.instructions,
    daysOfWeek: row.days_of_week,
    reminderTime: row.reminder_time,
    medicationId: row.medication_id,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function mapSharedDocumentRowToResponse(row: SharedDocumentQueryRow): z.infer<typeof SharedDocumentResponseSchema> {
  return {
    id: row.id,
    title: row.title,
    docType: row.doc_type,
    filePath: row.file_path,
    url: row.url,
    sharedBy: row.shared_by,
    createdAt: row.created_at,
  };
}
