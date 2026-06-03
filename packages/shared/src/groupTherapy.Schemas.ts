import { z } from 'zod';

export const CreateGroupSessionSchema = z.object({
  programId: z.string().uuid().optional(),
  sessionDate: z.string().min(1),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  facilitatorId: z.string().uuid().optional(),
  coFacilitatorId: z.string().uuid().optional(),
  location: z.string().max(300).optional(),
  topic: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).default('planned'),
});
export type CreateGroupSessionDTO = z.infer<typeof CreateGroupSessionSchema>;

export const UpdateGroupSessionSchema = CreateGroupSessionSchema.partial();
export type UpdateGroupSessionDTO = z.infer<typeof UpdateGroupSessionSchema>;

export const AddGroupAttendeeSchema = z.object({
  patient_id: z.string().uuid(),
  attendance: z.enum(['present', 'absent', 'late', 'left_early']).default('present'),
});
export type AddGroupAttendeeDTO = z.infer<typeof AddGroupAttendeeSchema>;

export const UpdateGroupAttendeeSchema = z.object({
  attendance: z.enum(['present', 'absent', 'late', 'left_early']).optional(),
  participation_rating: z.number().int().min(0).max(10).optional(),
  diary_card_completed: z.boolean().optional(),
  homework_completed: z.boolean().optional(),
  individual_notes: z.string().max(5000).optional(),
});
export type UpdateGroupAttendeeDTO = z.infer<typeof UpdateGroupAttendeeSchema>;
