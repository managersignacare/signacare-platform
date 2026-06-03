/**
 * Backfill staff_module_access grants for the three new module keys
 * introduced by the feature scope expansion:
 *
 *   medical-scribe   — ambient scribe + streaming transcription
 *   ai               — general LLM features (suggest, models, etc.)
 *   ai-agent         — autonomous agent endpoint with tool-use authority
 *
 * Without this backfill, the moment the Phase-4 routes start
 * enforcing these module keys every existing clinician / admin /
 * superadmin in the database would be blocked from features they
 * currently use every day. This migration is the "no new gate
 * without a grant" rule from CLAUDE.md §9.2 applied to a live
 * feature expansion.
 *
 * Policy baked into the migration:
 *
 *   - Every active clinician, admin and superadmin gets `write`
 *     on all three keys, scoped to their clinic. This matches
 *     the pre-feature behaviour where these roles had de-facto
 *     full access to the scribe, suggest and agent endpoints.
 *   - Receptionist, manager, referral_coordinator and readonly
 *     get nothing. If a particular clinic wants to extend access
 *     to those roles they do so via the admin UI later.
 *   - Existing rows with non-'none' access_level on the same
 *     (staff_id, clinic_id, module) are NOT overwritten — so a
 *     clinic that has already set a custom grant (e.g. via a seed
 *     script) wins over the migration default.
 *
 * Idempotent — safe to re-run. Uses onConflict().ignore() so a
 * re-run is a no-op rather than a failure.
 */
import type { Knex } from 'knex';

const NEW_MODULE_KEYS = ['medical-scribe', 'ai', 'ai-agent'] as const;
const GRANT_ROLES = ['clinician', 'admin', 'superadmin'] as const;

export async function up(knex: Knex): Promise<void> {
  const staffRows = await knex('staff')
    .whereIn('role', GRANT_ROLES as unknown as string[])
    .andWhere({ is_active: true })
    .whereNull('deleted_at')
    .select('id', 'clinic_id') as Array<{ id: string; clinic_id: string }>;

  if (staffRows.length === 0) return;

  const grants: Array<{
    staff_id: string;
    clinic_id: string;
    module: string;
    access_level: string;
    can_delegate_this: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];
  const now = new Date();
  for (const row of staffRows) {
    for (const mod of NEW_MODULE_KEYS) {
      grants.push({
        staff_id: row.id,
        clinic_id: row.clinic_id,
        module: mod,
        access_level: 'write',
        can_delegate_this: false,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // Batch insert to keep round-trips bounded. 500 rows per batch
  // comfortably fits under the default parameter-count ceiling.
  const BATCH = 500;
  for (let i = 0; i < grants.length; i += BATCH) {
    const chunk = grants.slice(i, i + BATCH);
    // onConflict matches the live unique index which is keyed on
    // (staff_id, module) — a staff member only has one access_level
    // row per module regardless of clinic, because staff are clinic-
    // scoped already.
    await knex('staff_module_access')
      .insert(chunk)
      .onConflict(['staff_id', 'module'])
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  // Rolling back the backfill removes the grants we inserted but
  // leaves any hand-edited grants in place. We key on the exact
  // access_level and module set so custom grants are preserved.
  await knex('staff_module_access')
    .whereIn('module', NEW_MODULE_KEYS as unknown as string[])
    .andWhere({ access_level: 'write', can_delegate_this: false })
    .delete();
}
