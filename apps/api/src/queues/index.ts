/**
 * apps/api/src/queues/index.ts
 *
 * Backwards-compatible producer entry point. As of S2.3, this file is
 * a thin shim around the new JobBus facade in apps/api/src/shared/jobBus.ts.
 *
 * Existing call sites (`import { addJob } from '../../queues'`) keep
 * working unchanged. New code should prefer importing `jobBus` directly:
 *
 *     import { jobBus } from '../../shared/jobBus';
 *     await jobBus.enqueue('email', { ... });
 *
 * The reason we did NOT delete the addJob helper outright: there are 4
 * call sites today, all of which work fine, and rewriting them as part
 * of this PR would balloon the diff. Future PRs that touch those
 * features can swap them over to `jobBus.enqueue` opportunistically.
 */

import { jobBus } from '../shared/jobBus';

export async function addJob(
  queueName: string,
  data: Record<string, unknown>,
  opts?: { delay?: number; jobId?: string },
): Promise<void> {
  await jobBus.enqueue(queueName, data, opts);
}

// Re-export the singleton for any caller that already wants the new API.
export { jobBus } from '../shared/jobBus';
