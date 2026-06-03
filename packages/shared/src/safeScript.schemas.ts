import { z } from 'zod';

export const SafeScriptPatientIdentifierSchema = z.object({
  ihi: z.string().min(1).optional(),
  medicareNumber: z.string().min(1).optional(),
  medicareIrn: z.string().min(1).optional(),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
}).strict();
export type SafeScriptPatientIdentifier = z.infer<typeof SafeScriptPatientIdentifierSchema>;

export const SafeScriptSupplySchema = z.object({
  medicationName: z.string(),
  dose: z.string(),
  quantity: z.number().int().nonnegative(),
  repeatsSupplied: z.number().int().nonnegative(),
  dispensingPharmacy: z.string(),
  supplyDate: z.string(),
  prescribedBy: z.string(),
}).strict();
export type SafeScriptSupply = z.infer<typeof SafeScriptSupplySchema>;

export const SafeScriptCheckResultSchema = z.object({
  checked: z.boolean(),
  checkedAt: z.string().datetime(),
  patientFound: z.boolean(),
  supplies: z.array(SafeScriptSupplySchema),
  riskIndicators: z.array(z.string()),
  rawResponse: z.unknown().optional(),
  error: z.string().optional(),
}).strict();
export type SafeScriptCheckResult = z.infer<typeof SafeScriptCheckResultSchema>;
