/**
 * S2.3 — JobBus facade
 *
 * Thin abstraction over BullMQ's `Queue.add` so that all job-producing
 * call sites in the codebase eventually go through ONE interface. The
 * point is NOT to be cleverer than BullMQ at runtime — it is to make
 * a future migration to Kafka, NATS, RabbitMQ, or any other message
 * bus a 2-week env-flag swap instead of a multi-month rewrite scattered
 * across 20+ producer call sites.
 *
 * Insurance, not investment. The reversibility analysis in the upgrade
 * plan flagged this as "1 day of work, saves 2 months later" — that
 * estimate assumes the facade is in place BEFORE any feature with
 * unusual queue semantics ships.
 *
 * Two implementations:
 *
 *   - BullMqJobBus    — wraps the existing Queue.add code path, used in
 *                       dev / production / integration tests
 *   - InMemoryJobBus  — collects emitted jobs in a Map, used by unit
 *                       tests so they can assert on payloads without
 *                       a Redis instance
 *
 * Naming compliance:
 *   - DB-side queue names stay kebab-case (BullMQ idiom)
 *   - TS interface + class names camelCase
 *   - Header / config keys snake_case where they hit env vars
 *
 * What this facade does NOT abstract:
 *   - BullMQ-specific features used by individual workers (concurrency,
 *     rate limit per queue, dependency graphs). Those features are still
 *     accessed via `new Queue(...)` / `new Worker(...)` directly in the
 *     8 existing worker files. Migrating each worker is a separate,
 *     opt-in step that can happen as each feature is touched.
 *
 *   - Scheduling semantics (cron, repeatable jobs). The current node-cron
 *     scheduler files in apps/api/src/jobs/schedulers/ already abstract
 *     scheduling at a higher level; the facade is only for one-shot job
 *     enqueue (with optional `delay`).
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

// ── Queue allowlist ──────────────────────────────────────────────────────
//
// Phase 10F — every queue name that the JobBus is willing to enqueue
// onto must be listed here. An unknown name throws synchronously so
// a stray `addJob('sms', {...})` or a future typo like
// `addJob('slack-webhook', {...})` fails loudly at call time rather
// than getting silently dropped into a no-op queue.
//
// The raw 'sms' queue name is DELIBERATELY absent. Patient-destined
// SMS (the only compliant SMS lane in this codebase) goes through
// the 'patient-outreach' dispatcher queue introduced in Phase 12,
// which decides FCM vs ACS SMS vs audit-logged skip. Staff-destined
// SMS is forbidden period.
//
// When a new feature genuinely needs a new queue, add it here AND
// document why in docs/fix-registry.md under NO-SMS.
const ALLOWED_QUEUES: ReadonlySet<string> = new Set([
  'email',
  'ai',
  'flag',
  'hl7',
  'llm',
  'mh-expiry',
  'outlook',
  'session-cleanup',
  'ocr',
  'notification',
  'patient-outreach',
  // Test sentinel used by apps/api/tests/jobBus.test.ts. Kept
  // intentionally narrow — don't use this in production code paths.
  'test-queue',
]);

function assertAllowedQueue(queueName: string): void {
  if (!ALLOWED_QUEUES.has(queueName)) {
    throw new Error(
      `jobBus.enqueue: queue '${queueName}' is not in ALLOWED_QUEUES. ` +
      `If this is intentional, add it to ALLOWED_QUEUES in apps/api/src/shared/jobBus.ts ` +
      `AND document why in docs/fix-registry.md (§NO-SMS). Forbidden legacy name 'sms' ` +
      `must NEVER be re-added — patient SMS flows through the 'patient-outreach' dispatcher.`,
    );
  }
}

/** Optional per-job options that the facade understands. */
export interface EnqueueOptions {
  /** Delay before the worker can pick up the job, in milliseconds. */
  delay?: number;
  /**
   * BullMQ-style job ID. If provided and a job with the same ID already
   * exists in the queue, BullMQ will reject it (idempotent enqueue).
   * Useful for cases where the producer wants to dedupe at enqueue time.
   */
  jobId?: string;
}

// Queue states where jobs are removable without interfering with
// actively running workers. We intentionally exclude `active`,
// `completed`, and `failed`.
export type RemovableQueueState =
  | 'wait'
  | 'waiting'
  | 'delayed'
  | 'prioritized'
  | 'paused'
  | 'waiting-children';

export interface RemoveByMatchOptions {
  /**
   * Optional state filter. Default removes from wait/delayed style states.
   * Caller can narrow this if needed.
   */
  states?: ReadonlyArray<RemovableQueueState>;
}

/** The narrow surface every backend must implement. */
export interface JobBus {
  /** Implementation tag. Useful for diagnostics + tests. */
  readonly backendName: 'bullmq' | 'in-memory';

  /** Enqueue a job onto a named queue. */
  enqueue(queueName: string, data: Record<string, unknown>, opts?: EnqueueOptions): Promise<void>;

  /**
   * Remove queued jobs whose payload contains all matcher key/value pairs.
   * Returns the number of jobs removed.
   */
  removeByMatch(
    queueName: string,
    matcher: Record<string, unknown>,
    opts?: RemoveByMatchOptions,
  ): Promise<number>;
}

function payloadMatches(data: Record<string, unknown>, matcher: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(matcher)) {
    if (data[key] !== expected) return false;
  }
  return true;
}

const DEFAULT_REMOVABLE_STATES: ReadonlyArray<RemovableQueueState> = [
  'wait',
  'waiting',
  'delayed',
  'prioritized',
  'paused',
  'waiting-children',
];

// ── BullMqJobBus ─────────────────────────────────────────────────────────────

/**
 * The production implementation. Reuses the same connection-pooling
 * pattern as the prior `addJob` helper so this is a drop-in replacement.
 */
export class BullMqJobBus implements JobBus {
  readonly backendName = 'bullmq' as const;
  private readonly connection: IORedis;
  private readonly queues: Map<string, Queue> = new Map();

  constructor(redisUrl?: string) {
    const url = redisUrl ?? (config as Record<string, unknown>).REDIS_URL ?? 'redis://localhost:6379';
    this.connection = new IORedis(String(url), { maxRetriesPerRequest: null });
  }

  private getQueue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue(queueName: string, data: Record<string, unknown>, opts?: EnqueueOptions): Promise<void> {
    assertAllowedQueue(queueName);
    const queue = this.getQueue(queueName);
    await queue.add(queueName, data, {
      delay: opts?.delay,
      jobId: opts?.jobId,
    });
  }

  async removeByMatch(
    queueName: string,
    matcher: Record<string, unknown>,
    opts?: RemoveByMatchOptions,
  ): Promise<number> {
    assertAllowedQueue(queueName);
    const queue = this.getQueue(queueName);
    const states = (opts?.states ?? DEFAULT_REMOVABLE_STATES).slice();
    const jobs = await queue.getJobs(states, 0, -1, false);
    let removed = 0;
    for (const job of jobs) {
      const data = (job.data ?? {}) as Record<string, unknown>;
      if (!payloadMatches(data, matcher)) continue;
      await job.remove();
      removed += 1;
    }
    return removed;
  }

  /** Test/diagnostic helper — close the underlying connection. */
  async close(): Promise<void> {
    for (const q of this.queues.values()) {
      try { await q.close(); } catch { /* best-effort */ }
    }
    try { await this.connection.quit(); } catch { /* best-effort */ }
  }
}

// ── InMemoryJobBus ───────────────────────────────────────────────────────────

interface InMemoryJob {
  queueName: string;
  data: Record<string, unknown>;
  opts?: EnqueueOptions;
}

/**
 * Test-only implementation. Stores every enqueued job in memory so unit
 * tests can assert "did the handler emit the right payload?" without
 * spinning up a real Redis. Never used outside the test environment.
 *
 * Use it via the singleton when NODE_ENV=test, or instantiate directly
 * in a test file:
 *
 *     const bus = new InMemoryJobBus();
 *     await someService.runWithBus(bus);
 *     expect(bus.dump('email')).toHaveLength(2);
 */
export class InMemoryJobBus implements JobBus {
  readonly backendName = 'in-memory' as const;
  private readonly jobs: InMemoryJob[] = [];
  private readonly seenJobIds: Set<string> = new Set();

  private static dedupeKey(queueName: string, jobId: string): string {
    return `${queueName}::${jobId}`;
  }

  async enqueue(queueName: string, data: Record<string, unknown>, opts?: EnqueueOptions): Promise<void> {
    assertAllowedQueue(queueName);
    if (typeof opts?.jobId === 'string' && opts.jobId.trim().length > 0) {
      const key = InMemoryJobBus.dedupeKey(queueName, opts.jobId);
      if (this.seenJobIds.has(key)) {
        return;
      }
      this.seenJobIds.add(key);
    }
    this.jobs.push({ queueName, data, opts });
  }

  async removeByMatch(
    queueName: string,
    matcher: Record<string, unknown>,
    _opts?: RemoveByMatchOptions,
  ): Promise<number> {
    let removed = 0;
    this.jobs.splice(
      0,
      this.jobs.length,
      ...this.jobs.filter((job) => {
        if (job.queueName !== queueName) return true;
        const matches = payloadMatches(job.data, matcher);
        if (matches) {
          removed += 1;
          const jobId = job.opts?.jobId;
          if (typeof jobId === 'string' && jobId.length > 0) {
            this.seenJobIds.delete(InMemoryJobBus.dedupeKey(queueName, jobId));
          }
        }
        return !matches;
      }),
    );
    return removed;
  }

  /** Test helper — return all jobs enqueued onto a given queue. */
  dump(queueName?: string): ReadonlyArray<InMemoryJob> {
    if (!queueName) return this.jobs.slice();
    return this.jobs.filter((j) => j.queueName === queueName);
  }

  /** Test helper — clear the job log between cases. */
  reset(): void {
    this.jobs.length = 0;
    this.seenJobIds.clear();
  }
}

// ── Default singleton ────────────────────────────────────────────────────────

/**
 * The process-wide JobBus. Resolved at module load time so every
 * importer gets the same instance. Tests that need an isolated bus
 * should instantiate `new InMemoryJobBus()` directly and pass it as a
 * dependency rather than touching this singleton.
 */
function buildDefaultJobBus(): JobBus {
  if (process.env.NODE_ENV === 'test') {
    logger.info({ backend: 'in-memory' }, 'jobBus: using InMemoryJobBus (NODE_ENV=test)');
    return new InMemoryJobBus();
  }
  logger.info({ backend: 'bullmq' }, 'jobBus: using BullMqJobBus');
  return new BullMqJobBus();
}

export const jobBus: JobBus = buildDefaultJobBus();
