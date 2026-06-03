import { z } from 'zod';

export const CreateContactRecordSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional().nullable(),
  contactDate: z.string().optional(),
  contactTime: z.string().optional(),
  contactType: z.string().max(200).optional(),
  durationMinutes: z.number().int().min(0).optional().nullable(),
  durationMin: z.number().int().min(0).optional().nullable(),
  isReportable: z.boolean().optional(),
  status: z.enum(['draft', 'signed', 'completed', 'cancelled']).optional(),
  // Extended meta fields
  serviceSetting: z.string().max(200).optional().nullable(),
  durationCategory: z.string().max(100).optional().nullable(),
  practitionerCategory: z.string().max(200).optional().nullable(),
  legalStatus: z.string().max(100).optional().nullable(),
  principalDiagnosis: z.string().max(500).optional().nullable(),
  icd10Code: z.string().max(20).optional().nullable(),
  interventionTypes: z.array(z.string()).optional(),
  outcomeMeasures: z.array(z.string()).optional(),
  patientPresent: z.boolean().optional(),
  carerPresent: z.boolean().optional(),
  interpreterUsed: z.boolean().optional(),
  briefSummary: z.string().max(5000).optional().nullable(),
  sourceType: z.string().max(100).optional(),
  sourceId: z.string().uuid().optional().nullable(),
  team: z.string().max(200).optional().nullable(),
  location: z.string().max(500).optional().nullable(),
  contactMedium: z.string().max(200).optional().nullable(),
  program: z.string().max(200).optional().nullable(),
  serviceRecipients: z.string().max(500).optional().nullable(),
  numProvidingService: z.number().int().min(0).optional().nullable(),
  numReceivingService: z.number().int().min(0).optional().nullable(),
});
export type CreateContactRecordDTO = z.infer<typeof CreateContactRecordSchema>;

export const UpdateContactRecordSchema = z.object({
  contactType: z.string().max(200).optional(),
  contactDate: z.string().optional(),
  contactTime: z.string().optional(),
  durationMin: z.number().int().min(0).optional().nullable(),
  durationMinutes: z.number().int().min(0).optional().nullable(),
  isReportable: z.boolean().optional(),
  status: z.enum(['draft', 'signed', 'completed', 'cancelled']).optional(),
  content: z.unknown().optional(),
});
export type UpdateContactRecordDTO = z.infer<typeof UpdateContactRecordSchema>;
