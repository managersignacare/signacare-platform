/**
 * Server-Sent Events (SSE) — Real-time push to frontend
 *
 * Replaces polling for:
 *   - AI job progress and completion
 *   - Patient arrival notifications
 *   - Task assignments
 *   - Medication due alerts
 *   - Pathology results
 *   - Escalation alerts
 *
 * Each authenticated user gets a persistent SSE connection.
 * Events are scoped by clinic_id via Redis pub/sub.
 *
 * Uses a SHARED Redis subscriber (not one per connection) to prevent
 * Redis connection exhaustion. Max 500 concurrent SSE connections.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import IORedis from 'ioredis';
import { logger } from '../../utils/logger';

const router = Router();

const MAX_SSE_CONNECTIONS = parseInt(process.env.SSE_MAX_CONNECTIONS ?? '5000', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.SSE_IDLE_TIMEOUT_MS ?? String(5 * 60 * 1000), 10);

// Track active connections for graceful shutdown
interface SseConnection {
  res: Response;
  userId: string;
  clinicId: string;
  channels: string[];
  heartbeat: ReturnType<typeof setInterval>;
  lastActivity: number;
}
const activeConnections = new Map<Response, SseConnection>();

// ── Shared Redis subscriber ──────────────────────────────────────────────────
// One subscriber for ALL SSE connections, instead of one per connection.
let sharedSubscriber: IORedis | null = null;
const subscribedChannels = new Map<string, number>(); // channel → refcount

function getSharedSubscriber(): IORedis {
  if (!sharedSubscriber) {
    sharedSubscriber = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    sharedSubscriber.connect().catch((err) => {
      logger.error({ err: err.message }, 'SSE shared subscriber connect failed');
    });

    sharedSubscriber.on('message', (channel: string, message: string) => {
      // Broadcast to all connections subscribed to this channel
      for (const [, conn] of activeConnections) {
        if (!conn.channels.includes(channel)) continue;
        try {
          const event = JSON.parse(message);
          // Filter: AI results only for the requesting user
          if (event.staffId && event.staffId !== conn.userId && channel.startsWith('ai-events:')) {
            continue;
          }
          conn.res.write(`event: ${event.type ?? 'message'}\n`);
          conn.res.write(`data: ${message}\n\n`);
          conn.lastActivity = Date.now();
        } catch {
          conn.res.write(`data: ${message}\n\n`);
        }
      }
    });
  }
  return sharedSubscriber;
}

function subscribeChannel(channel: string): void {
  const count = subscribedChannels.get(channel) ?? 0;
  subscribedChannels.set(channel, count + 1);
  if (count === 0) {
    getSharedSubscriber().subscribe(channel).catch(err => { logger.debug({ err, channel }, 'SSE subscribe'); });
  }
}

function unsubscribeChannel(channel: string): void {
  const count = subscribedChannels.get(channel) ?? 0;
  if (count <= 1) {
    subscribedChannels.delete(channel);
    sharedSubscriber?.unsubscribe(channel).catch(err => { logger.debug({ err, channel }, 'SSE unsubscribe'); });
  } else {
    subscribedChannels.set(channel, count - 1);
  }
}

// ── Idle connection cleanup ─────────────────────────────────────────────────
setInterval(() => {
  try {
    const now = Date.now();
    for (const [res, conn] of activeConnections) {
      if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
        logger.info({ userId: conn.userId }, 'SSE idle timeout — disconnecting');
        res.end();
      }
    }
  } catch (err) {
    logger.error({ err }, 'SSE idle cleanup error');
  }
}, 60_000);

// ── SSE Route ───────────────────────────────────────────────────────────────
router.get(
  '/stream',
  authMiddleware,
  (req: Request, res: Response) => {
    // Enforce connection limit
    if (activeConnections.size >= MAX_SSE_CONNECTIONS) {
      res.status(503).json({ error: 'Too many SSE connections', code: 'SSE_LIMIT' });
      return;
    }

    const clinicId = req.clinicId;
    const userId = req.user!.id;

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', userId, timestamp: new Date().toISOString() })}\n\n`);

    const channels = [
      `ai-events:${clinicId}`,
      `clinic-events:${clinicId}`,
      `user-events:${userId}`,
    ];

    // Audit Tier 9.4 (HIGH-A2) — heartbeat setInterval. A write error
    // means the client socket is dead; silently retrying the write
    // just spams error logs while the connection leaks (it stays in
    // activeConnections). Cleanly tear down: clear the interval,
    // release the channel subscriptions, end the response, drop the
    // entry from the connection map. req.on('close') may not fire
    // for half-open sockets, so the heartbeat failure IS the signal.
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), userId },
          'SSE heartbeat write failed — tearing down connection',
        );
        clearInterval(heartbeat);
        const conn = activeConnections.get(res);
        if (conn) {
          for (const ch of conn.channels) unsubscribeChannel(ch);
          activeConnections.delete(res);
        }
        try { res.end(); } catch { /* already closed */ }
      }
    }, 30_000);

    const conn: SseConnection = { res, userId, clinicId, channels, heartbeat, lastActivity: Date.now() };
    activeConnections.set(res, conn);

    // Subscribe via shared subscriber
    for (const ch of channels) subscribeChannel(ch);

    logger.info({ userId, connections: activeConnections.size }, 'SSE connection established');

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      activeConnections.delete(res);
      for (const ch of channels) unsubscribeChannel(ch);
      logger.info({ userId, connections: activeConnections.size }, 'SSE connection closed');
    });
  }
);

// ── Publish helpers ─────────────────────────────────────────────────────────
// Re-exported from ssePublisher.ts so existing importers from this
// file keep working. New code should import from ssePublisher directly.
export { publishClinicEvent, publishUserEvent } from './ssePublisher';

export function getActiveConnectionCount(): number {
  return activeConnections.size;
}

export default router;
