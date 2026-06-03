import { z } from 'zod';

export const CreateCarerSchema = z.object({
  patientId: z.string().uuid(),
  givenName: z.string().min(1).max(200),
  familyName: z.string().min(1).max(200),
  relationship: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  isPrimary: z.boolean().optional(),
});
export type CreateCarerDTO = z.infer<typeof CreateCarerSchema>;

export const UpdateCarerSchema = CreateCarerSchema.partial().omit({ patientId: true });
export type UpdateCarerDTO = z.infer<typeof UpdateCarerSchema>;
