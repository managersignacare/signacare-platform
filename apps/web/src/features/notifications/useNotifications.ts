// apps/web/src/features/notifications/useNotifications.ts
//
// Phase 10B — live notification feed hook.
//
// 1. Fetches the current user's notifications via useQuery.
// 2. Subscribes to the `notification` SSE event via the existing
//    useEventStream().on() API and prepends new rows into the
//    cache via qc.setQueryData — no refetch required.
// 3. Exposes helpers for marking read, mark-all-read, and dismiss.
//
// The hook returns both the list and the unread count so the bell
// badge can render without a second query.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationListResponse, NotificationResponse } from '@signacare/shared';
import { useEventStream } from '../../shared/hooks/useEventStream';
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';
import { notificationKeys } from './queryKeys';

interface UseNotificationsOptions {
  unread?: boolean;
  limit?: number;
}

export function useNotifications(opts: UseNotificationsOptions = {}) {
  const qc = useQueryClient();
  const { on: onEvent } = useEventStream();

  const limit = opts.limit ?? 50;

  const query = useQuery<NotificationListResponse>({
    queryKey: notificationKeys.list({ unread: opts.unread }),
    queryFn: () => listNotifications({ unread: opts.unread, limit }),
    staleTime: 30_000,
  });

  // Live push: when a new notification arrives on the SSE stream,
  // prepend it to the cached list and bump the unread count. No
  // refetch is issued — the event payload has all the fields the
  // bell needs. This is the key latency win: a clinician sees the
  // alert within milliseconds of the backend writing the row.
  useEffect(() => {
    const unsubscribe = onEvent('notification', (event: unknown) => {
      const payload = event as Partial<NotificationResponse> & { notificationId?: string | null };
      if (!payload || typeof payload !== 'object') return;

      const now = new Date().toISOString();
      const freshRow: NotificationResponse = {
        id: payload.id ?? payload.notificationId ?? now,
        clinicId: payload.clinicId ?? '',
        userId: payload.userId ?? null,
        severity: (payload.severity ?? 'info') as NotificationResponse['severity'],
        category: payload.category ?? 'system',
        title: payload.title ?? 'Notification',
        body: payload.body ?? null,
        actionUrl: payload.actionUrl ?? null,
        payload: payload.payload ?? null,
        overridePatientSync: payload.overridePatientSync ?? false,
        readAt: null,
        expiresAt: payload.expiresAt ?? null,
        createdAt: payload.createdAt ?? now,
      };

      // Update every active list cache key (unread filter variants).
      qc.setQueriesData<NotificationListResponse | undefined>(
        { queryKey: notificationKeys.all },
        (prev) => {
          if (!prev) return prev;
          // De-dupe by id — SSE can deliver the same row more than
          // once in edge cases (Redis pub/sub fan-out retries).
          if (prev.items.some((i) => i.id === freshRow.id)) return prev;
          return {
            items: [freshRow, ...prev.items],
            unreadCount: prev.unreadCount + 1,
          };
        },
      );
    });

    return unsubscribe;
  }, [onEvent, qc]);

  const markReadMut = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });

  const markAllReadMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });

  const dismissMut = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });

  return {
    items: query.data?.items ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    markRead: markReadMut.mutate,
    markAllRead: markAllReadMut.mutate,
    dismiss: dismissMut.mutate,
  };
}
