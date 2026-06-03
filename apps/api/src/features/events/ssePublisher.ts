// apps/api/src/features/events/ssePublisher.ts
//
// Phase 0.7.1 — publish helpers extracted from sseRoutes.ts so
// service files can import them without a service→route dependency
// (dep-cruiser no-service-to-route rule).
//
// These are pure Redis pub/sub calls — they don't touch Express
// request/response objects and have no reason to live in a route
// file.

import { redis } from '../../config/redis';

export async function publishClinicEvent(
  clinicId: string,
  event: Record<string, unknown>,
): Promise<void> {
  try {
    await redis.publish(`clinic-events:${clinicId}`, JSON.stringify(event));
  } catch { /* non-critical — SSE delivery is best-effort */ }
}

export async function publishUserEvent(
  userId: string,
  event: Record<string, unknown>,
): Promise<void> {
  try {
    await redis.publish(`user-events:${userId}`, JSON.stringify(event));
  } catch { /* non-critical — SSE delivery is best-effort */ }
}
