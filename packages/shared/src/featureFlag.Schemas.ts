import { z } from 'zod';

export const CreateFeatureFlagSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Flag names must be lowercase + hyphens only'),
  enabled: z.boolean().default(false),
  rolloutPercentage: z.number().int().min(0).max(100).default(100),
  description: z.string().max(1000).optional(),
  scope: z.enum(['global', 'clinic', 'user']).default('global'),
});
export type CreateFeatureFlagDTO = z.infer<typeof CreateFeatureFlagSchema>;
