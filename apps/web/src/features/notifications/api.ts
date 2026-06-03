// apps/web/src/features/notifications/api.ts
//
// Phase 10B — apiClient wrappers for the notification centre.
// Relative paths (no /api/v1/ prefix — the apiClient baseURL already
// has it; URL1-15 naming-contract rule).
import type { NotificationListResponse } from '@signacare/shared';
import { apiClient } from '../../shared/services/apiClient';

export async function listNotifications(
  opts: { unread?: boolean; limit?: number; offset?: number } = {},
): Promise<NotificationListResponse> {
  const params = new URLSearchParams();
  if (opts.unread) params.set('unread', 'true');
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  const suffix = params.toString();
  return apiClient.get<NotificationListResponse>(
    suffix.length > 0 ? `notifications?${suffix}` : 'notifications',
  );
}

export async function markNotificationRead(id: string): Promise<{ updated: number }> {
  return apiClient.post<{ updated: number }>(`notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiClient.post<{ updated: number }>('notifications/read-all');
}

export async function deleteNotification(id: string): Promise<{ deleted: number }> {
  return apiClient.delete<{ deleted: number }>(`notifications/${id}`);
}
