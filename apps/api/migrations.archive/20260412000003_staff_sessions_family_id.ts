import type { Knex } from 'knex';

/**
 * RFC 6819 §5.2.2.3 — refresh token reuse detection with session
 * tree (family) invalidation.
 *
 * When a refresh token is rotated, the old token is revoked and a
 * new one is issued. If the OLD token is then presented again (i.e.
 * the attacker stole it before the legitimate client rotated), the
 * server now knows at least one party in the session chain is
 * compromised. The OAuth 2 Security BCP requires the server to
 * revoke the ENTIRE chain of sessions descended from the original
 * login — not just the single rotated row — because the attacker
 * may also hold the rotated token.
 *
 * Implementation:
 *   - Every session row carries a `family_id` UUID.
 *   - A fresh login (POST /auth/login or /auth/mfa-verify) allocates
 *     a new family_id.
 *   - A refresh (POST /auth/refresh) PROPAGATES the family_id from
 *     the rotated session to the newly-created session.
 *   - On refresh, if the presented token matches an already-revoked
 *     session, authService.revokeSessionFamily(family_id) revokes
 *     every active session in the chain and returns 401.
 *
 * Schema:
 *   - family_id  uuid NOT NULL DEFAULT gen_random_uuid()
 *   - INDEX      on family_id for fast chain revocation
 *
 * Existing rows get a unique family_id via the DEFAULT so every
 * pre-migration session is treated as its own family of size 1 —
 * safe backwards-compat.
 *
 * Append-only. down() is a no-op because rolling back the column
 * mid-production would silently disable reuse detection and allow
 * a stolen token family to persist.
 *
 * Standard satisfied: OWASP A07 (Auth Failures), RFC 6819 §5.2.2.3,
 *                     ACHS Standard 1 (clinical session integrity).
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('staff_sessions', 'family_id'))) {
    await knex.schema.alterTable('staff_sessions', (t) => {
      t.uuid('family_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    });
  }
  // Create the index idempotently — Knex's t.index() will create
  // a duplicate if called twice, so we use raw IF NOT EXISTS.
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS staff_sessions_family_id_idx ON staff_sessions (family_id)',
  );
}

export async function down(): Promise<void> {
  // No-op. Removing family_id mid-production re-introduces the
  // exact HAZARD that RFC 6819 §5.2.2.3 exists to mitigate.
}
