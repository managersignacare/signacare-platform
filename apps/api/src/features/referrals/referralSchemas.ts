// packages/shared/src/referralSchemas.ts
import z from 'zod';

// ...existing exports

export const ReferralOcrFieldsSchema = z.object({
  patientName: z.string().nullable().optional(),
  givenName: z.string().nullable().optional(),
  familyName: z.string().nullable().optional(),
  dob: z.string().nullable().optional(), // YYYY-MM-DD
  medicareNumber: z.string().nullable().optional(),
  referrerName: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  fullText: z.string().nullable().optional(),
});

export type ReferralOcrFields = z.infer<typeof ReferralOcrFieldsSchema>;
