// packages/shared/src/notification.schemas.ts
//
// Phase 10A — shared DTOs for the durable notification centre.
//
// The `notifications` table is the single source of truth for
// "things a clinician missed while they weren't looking at this tab."
// Every `notificationService.emit` call on the backend writes a row
// here AND publishes to SSE in one transaction, so the web bell and
// the Flutter mobile bell (Phase 11) can both render from the same
// data with the same query contract.
import { z } from 'zod';

export const NotificationSeverityEnum = z.enum(['info', 'success', 'warning', 'critical']);
export type NotificationSeverity = z.infer<typeof NotificationSeverityEnum>;

/**
 * Category is a free-form varchar at the DB layer but the frontend
 * picks its severity icon + colour palette from this whitelist. If
 * a backend emitter supplies a category not in this list the row
 * still stores, but the UI falls back to a generic bell icon.
 */
export const NotificationCategoryEnum = z.enum([
  'referral',
  'appointment',
  'task',
  'escalation',
  'message',
  'medication',
  'pathology',
  'ai',
  'system',
]);
export type NotificationCategory = z.infer<typeof NotificationCategoryEnum>;

export const NotificationResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  severity: NotificationSeverityEnum,
  category: z.string().min(1).max(40),
  title: z.string(),
  body: z.string().nullable(),
  actionUrl: z.string().nullable(),
  payload: z.record(z.unknown()).nullable(),
  overridePatientSync: z.boolean(),
  readAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationResponse = z.infer<typeof NotificationResponseSchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationResponseSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const ListNotificationsQuerySchema = z.object({
  unread: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

export const MarkReadBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100).optional(),
});
export type MarkReadBody = z.infer<typeof MarkReadBodySchema>;
