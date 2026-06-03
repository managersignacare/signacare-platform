// apps/api/src/shared/tenantContext.ts
//
// Provides RLS tenant context for code running OUTSIDE HTTP requests
// (BullMQ workers, cron jobs, background tasks).
//
// Usage:
//   await withTenantContext(clinicId, async () => {
//     const rows = await db('patients').where({ ... });
//     // RLS enforced — only sees this clinic's data
//   });

import { appPoolRaw, rlsStore } from '../db/db';

/**
 * Execute a function within a tenant-scoped database transaction.
 * Sets app.clinic_id via SET LOCAL so all queries through the `db` proxy
 * are automatically RLS-scoped.
 *
 * @param clinicId - The clinic UUID to scope to
 * @param fn - The async function to execute within the scoped transaction
 * @param userId - Optional staff UUID for audit trail
 */
export async function withTenantContext<T>(
  clinicId: string,
  fn: () => Promise<T>,
  userId?: string,
): Promise<T> {
  return appPoolRaw.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    if (userId) {
      await trx.raw("SELECT set_config('app.user_id', ?, true)", [userId]);
    }

    return new Promise<T>((resolve, reject) => {
      rlsStore.run(trx, async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
    });
  });
}
