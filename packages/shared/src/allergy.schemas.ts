// packages/shared/src/allergy.schemas.ts
import { z } from 'zod';

export const AllergySeverityEnum = z.enum(['mild', 'moderate', 'severe', 'life_threatening', 'unknown']);
export const AllergyStatusEnum   = z.enum(['active', 'inactive', 'entered_in_error']);

const RecordedAtInputSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  return trimmed;
}, z.string().datetime().optional());

export const CreateAllergySchema = z.object({
  patientId:    z.string().uuid(),
  allergen:     z.string().min(1).max(255),
  allergenType: z.enum(['drug', 'food', 'environmental', 'contrast', 'latex', 'other']),
  reaction:     z.string().max(255).optional(),
  severity:     AllergySeverityEnum.default('moderate'),
  status:       AllergyStatusEnum.default('active'),
  // @zod-convention-exempt: accepts YYYY-MM-DD and normalizes to ISO datetime for legacy form payloads.
  recordedAt:   RecordedAtInputSchema,
  notes:        z.string().optional(),
});
export type CreateAllergyDTO = z.infer<typeof CreateAllergySchema>;

export const UpdateAllergySchema = CreateAllergySchema.partial().omit({ patientId: true });
export type UpdateAllergyDTO = z.infer<typeof UpdateAllergySchema>;

export const AllergyResponseSchema = CreateAllergySchema.extend({
  id:                  z.string().uuid(),
  clinicId:            z.string().uuid(),
  recordedByStaffId:   z.string().uuid().nullable(),
  createdAt:           z.string().datetime(),
  updatedAt:           z.string().datetime(),
});
export type AllergyResponse = z.infer<typeof AllergyResponseSchema>;
