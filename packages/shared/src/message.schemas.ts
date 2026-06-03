import { z } from 'zod';

export const MessageThreadCreateSchema = z.object({
  subject: z.string().min(1).max(255),
  patientId: z.string().uuid().optional(),
  participantIds: z.array(z.string().uuid()).optional(),
  recipientIds: z.array(z.string().uuid()).optional(),
}).refine(
  (d) => (d.participantIds?.length ?? 0) > 0 || (d.recipientIds?.length ?? 0) > 0,
  { message: 'At least one participantId or recipientId is required', path: ['participantIds'] },
);
export type MessageThreadCreateDTO = z.infer<typeof MessageThreadCreateSchema>;

export const MessageCreateSchema = z.object({
  threadId: z.string().uuid().optional(),
  recipientId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  subject: z.string().max(255).optional(),
  body: z.string().min(1),
  isUrgent: z.boolean().default(false),
}).refine(
  (d) => d.threadId !== undefined || d.recipientId !== undefined,
  { message: 'Either threadId or recipientId must be provided', path: ['threadId'] },
);
export type MessageCreateDTO = z.infer<typeof MessageCreateSchema>;

export const MessageResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  threadId: z.string().uuid().nullable(),
  senderId: z.string().uuid(),
  recipientId: z.string().uuid().nullable(),
  patientId: z.string().uuid().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  isRead: z.boolean(),
  isUrgent: z.boolean(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const MessageThreadResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  subject: z.string(),
  patientId: z.string().uuid().nullable(),
  createdById: z.string().uuid(),
  lastMessageAt: z.string().datetime().nullable(),
  messageCount: z.number().int(),
  unreadCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(MessageResponseSchema).optional(),
});
export type MessageThreadResponse = z.infer<typeof MessageThreadResponseSchema>;