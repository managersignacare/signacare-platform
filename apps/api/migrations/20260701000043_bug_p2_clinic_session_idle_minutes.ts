/*
 * apps/api/migrations/20260701000043_bug_p2_clinic_session_idle_minutes.ts
 *
 * BUG-P2 — per-clinic session-idle-timeout configuration (PRES-6 DH-3869).
 *
 * AHPRA prescribing-compliance mandate: clinical terminals must idle
 * out within 15 minutes (PRES-6). Pre-fix the production server-default
 * was 30 minutes; deployments could override via env var but had no
 * per-clinic configurability.
 *
 * Two-part fix (this migration is part 2; sessionIdleMiddleware default
 * change is part 1):
 *   - Server default lowered 30 → 15 (PRES-6 ceiling) in middleware
 *   - Per-clinic override via this column allows clinics to TIGHTEN
 *     below 15 (e.g. high-acuity ward → 5 min) but never loosen above
 *
 * Column shape:
 *   - `session_idle_minutes int NULL` — NULL means "use server default"
 *   - CHECK constraint: NULL OR (>= 5 AND <= 15) — enforces:
 *     - floor 5 prevents pathological lockouts (clinician typing a long
 *       clinical note → idle out mid-sentence)
 *     - ceiling 15 enforces the PRES-6 mandate at the DB level (4-layer
 *       defence: Zod L1 + service L2 + DB CHECK L3 + middleware L4)
 *
 * The middleware reads the per-clinic value at LOGIN time (from
 * authController) and stores it in the Redis idle-window value.
 * Subsequent Power Settings changes apply on next login — NOT to
 * already-active sessions. Documented in middleware JSDoc.
 *
 * Builder-first per CLAUDE.md §12.1 — uses only `knex.schema.alterTable
 * + t.integer().nullable()`. CHECK constraint via raw + taxonomy
 * annotation per §12.4.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('clinics', 'session_idle_minutes');
  if (!has) {
    await knex.schema.alterTable('clinics', (t) => {
      t.integer('session_idle_minutes').nullable();
    });
    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE clinics
        ADD CONSTRAINT clinics_session_idle_minutes_pres6
        CHECK (session_idle_minutes IS NULL OR (session_idle_minutes >= 5 AND session_idle_minutes <= 15))
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_session_idle_minutes_pres6',
  );
  const has = await knex.schema.hasColumn('clinics', 'session_idle_minutes');
  if (has) {
    await knex.schema.alterTable('clinics', (t) => {
      t.dropColumn('session_idle_minutes');
    });
  }
}
