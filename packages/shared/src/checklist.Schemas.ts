import { z } from 'zod';

const ChecklistItemSchema = z.object({
  label: z.string().min(1).max(500),
  required: z.boolean().optional(),
  order: z.number().int().optional(),
});

export const CreateChecklistSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  triggerPoint: z.string().max(200).optional(),
  enforcement: z.enum(['optional', 'recommended', 'mandatory']).default('optional'),
  items: z.array(ChecklistItemSchema).optional(),
});
export type CreateChecklistDTO = z.infer<typeof CreateChecklistSchema>;

export const UpdateChecklistSchema = z.object({
  name: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  enforcement: z.enum(['optional', 'recommended', 'mandatory']).optional(),
  items: z.array(ChecklistItemSchema).optional(),
});
export type UpdateChecklistDTO = z.infer<typeof UpdateChecklistSchema>;
