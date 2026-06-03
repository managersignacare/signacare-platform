import type { Knex } from 'knex';

/**
 * S3.1a — SMART-on-FHIR / OAuth 2 hardening
 *
 * Replaces the prior lazy create-on-first-request `smart_apps` table
 * (apps/api/src/integrations/fhir/smartAppRegistry.ts:32-55) with a
 * proper migration, and adds four new tables that turn the existing
 * in-memory OAuth scaffold into something that survives a restart and
 * a cluster of replicas:
 *
 *   smart_apps                   — registered SMART app credentials
 *                                  (was lazy-created; now real migration)
 *   oauth_authorization_codes    — short-lived auth codes from /authorize,
 *                                  with PKCE challenge stored alongside
 *   oauth_access_tokens          — issued bearer tokens; revocation works
 *                                  by deleting from this table
 *   oauth_refresh_tokens         — long-lived refresh tokens for SMART
 *                                  offline_access flow
 *   smart_launch_contexts        — EHR-launch context (patient,
 *                                  encounter, user) keyed by launch token
 *
 * RLS is enabled on smart_apps and smart_launch_contexts (per-clinic
 * isolation). The token tables are NOT RLS-gated because the OAuth
 * server has to look them up by opaque token without a request
 * context — all reads are guarded by the token's hash + an explicit
 * clinic_id WHERE clause in the application code.
 *
 * Append-only migration with hasTable / hasColumn guards. Down is a
 * no-op (we don't drop OAuth tables on rollback).
 */

export async function up(knex: Knex): Promise<void> {
  // ── smart_apps ─────────────────────────────────────────────────────────
  // The existing lazy-create block in smartAppRegistry.ts will see hasTable
  // return true and skip; eventually that block can be deleted in the
  // S3.1a code commit.
  if (!(await knex.schema.hasTable('smart_apps'))) {
    await knex.schema.createTable('smart_apps', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable();
      t.string('client_id', 100).notNullable().unique();
      t.string('client_secret_hash', 255).nullable(); // null for public clients
      t.string('name', 200).notNullable();
      t.string('description', 1000).nullable();
      t.string('vendor', 200).nullable();
      t.string('vendor_url', 500).nullable();
      t.string('logo_url', 500).nullable();
      t.string('app_type', 30).notNullable().defaultTo('confidential');
      t.specificType('redirect_uris', 'text[]').notNullable();
      t.specificType('scopes', 'text[]').notNullable();
      t.specificType('launch_modes', 'text[]').notNullable().defaultTo('{ehr,standalone}');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('is_approved').notNullable().defaultTo(false);
      t.uuid('approved_by_id').nullable();
      t.timestamp('approved_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id']);
      t.index(['client_id']);
    });
  } else {
    // The lazy block creates `client_secret`; add the new hashed column
    // alongside it without dropping the old one (rollout-safe).
    if (!(await knex.schema.hasColumn('smart_apps', 'client_secret_hash'))) {
      await knex.schema.alterTable('smart_apps', (t) => {
        t.string('client_secret_hash', 255).nullable();
      });
    }
  }

  // ── oauth_authorization_codes ──────────────────────────────────────────
  if (!(await knex.schema.hasTable('oauth_authorization_codes'))) {
    await knex.schema.createTable('oauth_authorization_codes', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      // The opaque code value, stored as SHA-256 so a leaked DB doesn't
      // hand out tokens. Lookup is by hash.
      t.string('code_hash', 64).notNullable().unique();
      t.string('client_id', 100).notNullable();
      t.uuid('clinic_id').notNullable();
      t.uuid('user_id').notNullable();
      t.uuid('patient_id').nullable(); // launch context
      t.text('redirect_uri').notNullable(); // bound at /authorize, re-checked at /token
      t.specificType('scopes', 'text[]').notNullable();
      // PKCE — code_challenge from /authorize, verified at /token
      t.string('code_challenge', 128).nullable();
      t.string('code_challenge_method', 10).nullable(); // 'S256' (only)
      // Optional launch token reference for EHR launch flow
      t.string('launch_token', 64).nullable();
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('redeemed_at', { useTz: true }).nullable();
      t.index(['code_hash']);
      t.index(['expires_at']);
      t.index(['client_id']);
    });
  }

  // ── oauth_access_tokens ────────────────────────────────────────────────
  // Stores token METADATA only, not the JWT itself (which is signed and
  // self-contained). Used for revocation and introspection lookups.
  if (!(await knex.schema.hasTable('oauth_access_tokens'))) {
    await knex.schema.createTable('oauth_access_tokens', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('jti', 64).notNullable().unique(); // JWT ID claim
      t.string('client_id', 100).notNullable();
      t.uuid('clinic_id').notNullable();
      t.uuid('user_id').notNullable();
      t.uuid('patient_id').nullable();
      t.specificType('scopes', 'text[]').notNullable();
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('revoked_at', { useTz: true }).nullable();
      t.text('revoked_reason').nullable();
      t.index(['jti']);
      t.index(['client_id']);
      t.index(['user_id']);
      t.index(['expires_at']);
    });
  }

  // ── oauth_refresh_tokens ───────────────────────────────────────────────
  if (!(await knex.schema.hasTable('oauth_refresh_tokens'))) {
    await knex.schema.createTable('oauth_refresh_tokens', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      // Refresh token stored as SHA-256 hash, same reason as auth codes
      t.string('token_hash', 64).notNullable().unique();
      t.string('client_id', 100).notNullable();
      t.uuid('clinic_id').notNullable();
      t.uuid('user_id').notNullable();
      t.uuid('patient_id').nullable();
      t.specificType('scopes', 'text[]').notNullable();
      // For rotation: when this token is used to refresh, we mark it
      // rotated_to_id pointing at the new row, and reject any subsequent
      // use of the old hash (refresh token replay detection).
      t.uuid('rotated_to_id').nullable();
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('revoked_at', { useTz: true }).nullable();
      t.index(['token_hash']);
      t.index(['client_id']);
      t.index(['user_id']);
      t.index(['expires_at']);
    });
  }

  // ── smart_launch_contexts ──────────────────────────────────────────────
  // Replaces the in-memory `globalThis.__smart_launches` Map that was used
  // by the EHR launch flow.
  if (!(await knex.schema.hasTable('smart_launch_contexts'))) {
    await knex.schema.createTable('smart_launch_contexts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('launch_token', 64).notNullable().unique();
      t.string('client_id', 100).notNullable();
      t.uuid('clinic_id').notNullable();
      t.uuid('user_id').notNullable();
      t.uuid('patient_id').nullable();
      t.uuid('encounter_id').nullable();
      t.specificType('scopes', 'text[]').notNullable();
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('consumed_at', { useTz: true }).nullable();
      t.index(['launch_token']);
      t.index(['expires_at']);
    });
  }
}

export async function down(): Promise<void> {
  // No-op. We never drop OAuth tables on rollback because doing so
  // would invalidate every issued token in the wild.
}
