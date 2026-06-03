/**
 * useEventStream — SSE hook for real-time events
 *
 * Connects to /api/v1/events/stream and dispatches events to React Query cache.
 * Auto-reconnects on disconnect. Provides event listener registration.
 */

import { useEffect, useCallback, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { sharedSseEventKeys } from '../queryKeys';
import { tasksKeys } from '../../features/tasks/queryKeys';
import { dashboardKeys } from '../../features/dashboard/queryKeys';
import { pathologyKeys } from '../../features/pathology/queryKeys';
import { patientsKeys } from '../../features/patients/queryKeys';

interface StreamEventPayload {
  type?: string;
  action?: string;
  [key: string]: unknown;
}

type EventHandler = (event: StreamEventPayload) => void;
type ConnectionListener = (connected: boolean) => void;

const EVENT_URL = '/api/v1/events/stream';
const EVENT_TYPES = [
  'notification',
  'ai-job-complete', 'ai-job-progress', 'ai-job-failed',
  'patient-arrived', 'task-assigned', 'medication-due',
  'pathology-result', 'escalation', 'message',
  'referral-offer', 'referral-reminder',
] as const;

interface EventStreamRuntimeState {
  sharedSource: EventSource | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectRetryCount: number;
  connectedState: boolean;
  activeAuthSubscribers: number;
  activeQueryClient: QueryClient | null;
  connectionListeners: Set<ConnectionListener>;
  handlers: Map<string, Set<EventHandler>>;
}

type EventStreamGlobal = typeof globalThis & {
  __signacareEventStreamState__?: EventStreamRuntimeState;
};

function createRuntimeState(): EventStreamRuntimeState {
  return {
    sharedSource: null,
    reconnectTimer: null,
    reconnectRetryCount: 0,
    connectedState: false,
    activeAuthSubscribers: 0,
    activeQueryClient: null,
    connectionListeners: new Set<ConnectionListener>(),
    handlers: new Map<string, Set<EventHandler>>(),
  };
}

function getRuntimeState(): EventStreamRuntimeState {
  const globalState = globalThis as EventStreamGlobal;
  if (!globalState.__signacareEventStreamState__) {
    globalState.__signacareEventStreamState__ = createRuntimeState();
  }
  return globalState.__signacareEventStreamState__;
}

const runtimeState = getRuntimeState();

function isStreamEventPayload(value: unknown): value is StreamEventPayload {
  return typeof value === 'object' && value !== null;
}

function setConnectedState(next: boolean): void {
  runtimeState.connectedState = next;
  for (const listener of runtimeState.connectionListeners) {
    listener(next);
  }
}

function dispatchTypedEvent(
  type: string,
  data: StreamEventPayload,
): void {
  runtimeState.handlers.get(type)?.forEach((handler) => handler(data));
  if (runtimeState.activeQueryClient) {
    invalidateForEvent(runtimeState.activeQueryClient, type, data);
  }
}

function teardownSource(): void {
  if (runtimeState.reconnectTimer) {
    clearTimeout(runtimeState.reconnectTimer);
    runtimeState.reconnectTimer = null;
  }
  if (runtimeState.sharedSource) {
    runtimeState.sharedSource.close();
    runtimeState.sharedSource = null;
  }
  runtimeState.reconnectRetryCount = 0;
  setConnectedState(false);
}

function connectSource(): void {
  if (runtimeState.sharedSource || runtimeState.activeAuthSubscribers === 0) return;

  const source = new EventSource(EVENT_URL, { withCredentials: true });
  runtimeState.sharedSource = source;

  source.onopen = () => {
    runtimeState.reconnectRetryCount = 0;
    setConnectedState(true);
  };

  source.onerror = () => {
    setConnectedState(false);
    source.close();
    runtimeState.sharedSource = null;
    if (runtimeState.activeAuthSubscribers === 0) return;
    const delay = Math.min(1000 * Math.pow(2, runtimeState.reconnectRetryCount), 30000);
    runtimeState.reconnectRetryCount += 1;
    runtimeState.reconnectTimer = setTimeout(() => {
      runtimeState.reconnectTimer = null;
      connectSource();
    }, delay);
  };

  EVENT_TYPES.forEach((type) => {
    source.addEventListener(type, (event: MessageEvent) => {
      try {
        const data: unknown = JSON.parse(event.data);
        if (!isStreamEventPayload(data)) return;
        dispatchTypedEvent(type, data);
      } catch {
        // Ignore malformed event payloads.
      }
    });
  });

  source.onmessage = (event: MessageEvent) => {
    try {
      const data: unknown = JSON.parse(event.data);
      if (!isStreamEventPayload(data)) return;
      runtimeState.handlers.get('message')?.forEach((handler) => handler(data));
      if (typeof data.type === 'string') {
        dispatchTypedEvent(data.type, data);
      }
    } catch {
      // Ignore malformed message payloads.
    }
  };
}

export function useEventStream() {
  const qc = useQueryClient();
  const isAuth = useAuthStore(s => s.isAuthenticated);
  const [connected, setConnected] = useState(runtimeState.connectedState);

  // Register event handler
  const on = useCallback((eventType: string, handler: EventHandler) => {
    if (!runtimeState.handlers.has(eventType)) {
      runtimeState.handlers.set(eventType, new Set());
    }
    runtimeState.handlers.get(eventType)?.add(handler);
    return () => {
      runtimeState.handlers.get(eventType)?.delete(handler);
    };
  }, []);

  useEffect(() => {
    runtimeState.connectionListeners.add(setConnected);
    setConnected(runtimeState.connectedState);

    return () => {
      runtimeState.connectionListeners.delete(setConnected);
    };
  }, []);

  useEffect(() => {
    if (!isAuth) return;

    runtimeState.activeAuthSubscribers += 1;
    runtimeState.activeQueryClient = qc;
    connectSource();

    return () => {
      runtimeState.activeAuthSubscribers = Math.max(0, runtimeState.activeAuthSubscribers - 1);
      if (runtimeState.activeAuthSubscribers === 0) {
        runtimeState.activeQueryClient = null;
        teardownSource();
      }
    };
  }, [isAuth, qc]);

  return { connected, on };
}

// Auto-invalidate React Query caches based on event type.
//
// Every invalidation uses a factory key so CLAUDE.md §4.1 holds:
// the key this handler broadcasts is guaranteed to share a prefix
// with the query key the feature components read from. When a
// feature renames its base tuple the broadcast path changes
// together with the read path — no silent drift.
//
// Imports are per-feature (`tasksKeys.all`, `dashboardKeys.all`,
// `pathologyKeys.all`, `patientsKeys.notesAll()`) so the event
// handler stays tied to the owning feature's single-source-of-
// truth factory. The few broadcasts without a natural feature
// home (check-in, MAR, admin-overview) live in
// `apps/web/src/shared/queryKeys.ts → sharedSseEventKeys`.
function invalidateForEvent(qc: QueryClient, type: string, data: StreamEventPayload) {
  const clinicScope = useAuthStore.getState().user?.clinicId ?? '';
  switch (type) {
    case 'patient-arrived':
      qc.invalidateQueries({ queryKey: sharedSseEventKeys.checkinAppointments() });
      qc.invalidateQueries({ queryKey: dashboardKeys.all(clinicScope) });
      break;
    case 'task-assigned':
      qc.invalidateQueries({ queryKey: tasksKeys.all });
      qc.invalidateQueries({ queryKey: dashboardKeys.all(clinicScope) });
      break;
    case 'medication-due':
      qc.invalidateQueries({ queryKey: sharedSseEventKeys.marAdministrations() });
      break;
    case 'pathology-result':
      qc.invalidateQueries({ queryKey: pathologyKeys.all });
      break;
    case 'escalation':
      qc.invalidateQueries({ queryKey: dashboardKeys.all(clinicScope) });
      break;
    case 'ai-job-complete':
      // Specific invalidation based on the AI action
      if (data.action === 'formulation') qc.invalidateQueries({ queryKey: patientsKeys.notesAll() });
      if (data.action === 'admin-report') qc.invalidateQueries({ queryKey: sharedSseEventKeys.adminOverview() });
      break;
  }
}
