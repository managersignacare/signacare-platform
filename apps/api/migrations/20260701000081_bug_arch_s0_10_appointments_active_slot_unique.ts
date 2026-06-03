import type { Knex } from 'knex';

const ACTIVE_SLOT_STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_session'] as const;

/**
 * ARCH-S0-10 — DB-level appointment slot race shield.
 *
 * Problem:
 * App-layer overlap checks are not sufficient under concurrent writes.
 * Two requests can pass the read-check and both insert a row for the
 * same clinician + exact same slot.
 *
 * Fix:
 * Add a partial unique index across active slot occupancy states.
 * Cancelled/no-show rows remain outside the uniqueness envelope.
 *
 * Safety:
 * Fail migration loudly if active duplicates already exist so we don't
 * silently clamp production data.
 */
export async function up(knex: Knex): Promise<void> {
  const duplicate = await knex('appointments')
    .whereNull('deleted_at')
    .whereIn('status', ACTIVE_SLOT_STATUSES as readonly string[])
    .select('clinic_id', 'clinician_id', 'start_time', 'end_time')
    .count<{ count: string }[]>('* as count')
    .groupBy('clinic_id', 'clinician_id', 'start_time', 'end_time')
    .havingRaw('COUNT(*) > 1')
    .first();

  if (duplicate) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ARCH-S0-10: cannot create appointments_active_slot_unique index because duplicate active slots already exist. Resolve duplicates before production rollout.',
      );
    }

    // Non-production safety valve: normalize duplicate active slots so
    // developers can apply the hardening migration on seeded/demo data.
    // Keep the oldest row in each slot and mark later duplicates as
    // "rescheduled" with an explicit system reason.
    // @migration-raw-exempt: data_backfill_update
    await knex.raw(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY clinic_id, clinician_id, start_time, end_time
            ORDER BY created_at ASC, id ASC
          ) AS rn
        FROM appointments
        WHERE deleted_at IS NULL
          AND status IN ('scheduled', 'confirmed', 'arrived', 'in_session')
      )
      UPDATE appointments AS a
      SET
        status = 'rescheduled',
        cancellation_reason = COALESCE(
          a.cancellation_reason,
          'Auto-rescheduled by ARCH-S0-10 duplicate-slot hardening (non-production only).'
        ),
        updated_at = NOW()
      FROM ranked AS r
      WHERE a.id = r.id
        AND r.rn > 1
    `);
  }

  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_slot_unique
      ON appointments (clinic_id, clinician_id, start_time, end_time)
      WHERE deleted_at IS NULL
        AND status IN ('scheduled', 'confirmed', 'arrived', 'in_session');
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS appointments_active_slot_unique');
}
