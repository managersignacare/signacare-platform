import type { Knex } from 'knex';

/**
 * S3.4 — Inbound webhook receiver
 *
 * Two new tables:
 *
 *   webhook_secrets       — per-source HMAC secret + per-source config
 *                           (rate limit, IP allowlist, retention).
 *                           Admin-managed.
 *
 *   webhook_audit_log     — append-only ledger of every webhook
 *                           invocation: payload hash, signature
 *                           verification result, replay-protection
 *                           outcome, processing status. Becomes the
 *                           single source of truth for "did this
 *                           webhook ever fire?" questions.
 *
 * Multi-tenancy: webhook_secrets carries clinic_id and is RLS-eligible.
 * The receiver MUST set the request context to the secret's clinic_id
 * after a successful HMAC verification (NOT from an HTTP header — that
 * would let an attacker forge tenant identity by setting their own
 * X-Clinic-Id).
 *
 * Append-only with hasTable guards. Down is a no-op.
 */

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('webhook_secrets'))) {
    await knex.schema.createTable('webhook_secrets', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable();
      // 'source' is the URL slug, e.g. 'cerner-orders' or 'lab-results'.
      // The receiver mounts at /webhooks/:source so the slug must match
      // the URL pattern (snake_case + hyphen, no slashes).
      t.string('source', 100).notNullable();
      // The HMAC secret in the clear. Hospital partners ship us the
      // secret over a separate channel (PGP email, secure portal); we
      // store it because we need it to compute the expected signature
      // on every request. Encryption-at-rest of the column is the
      // production hardening (S4.1).
      t.text('hmac_secret').notNullable();
      // Header name the partner uses for the signature (varies: GitHub
      // uses X-Hub-Signature-256, Stripe uses Stripe-Signature, FHIR
      // partners often use X-Signature). Default to X-Signature.
      t.string('signature_header', 100).notNullable().defaultTo('x-signature');
      // Timestamp header for replay protection. Some partners include
      // this; others don't (in which case we use the wire-receipt time).
      t.string('timestamp_header', 100).nullable();
      // Replay window in seconds. Reject any payload whose timestamp
      // is more than this far in the past or future. Default 5 minutes.
      t.integer('replay_window_seconds').notNullable().defaultTo(300);
      // Per-source rate limit (requests per minute). 0 = unlimited.
      t.integer('rate_limit_per_minute').notNullable().defaultTo(60);
      // Optional source IP allowlist (CIDR notation, comma separated).
      t.text('ip_allowlist').nullable();
      // Which queue to enqueue jobs onto when a webhook arrives.
      // Defaults to a generic 'webhook-inbound' queue; partners with
      // bespoke processing can point at their own queue name.
      t.string('queue_name', 100).notNullable().defaultTo('webhook-inbound');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.unique(['clinic_id', 'source']);
      t.index(['source']);
    });
  }

  if (!(await knex.schema.hasTable('webhook_audit_log'))) {
    await knex.schema.createTable('webhook_audit_log', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').nullable(); // null if HMAC verification failed
      t.string('source', 100).notNullable();
      // SHA-256 hash of the raw request body. Replay protection looks
      // up matching hash + nonce within the replay window.
      t.string('payload_hash', 64).notNullable();
      // Optional nonce header (X-Nonce). Combined with payload_hash
      // for replay detection.
      t.string('nonce', 128).nullable();
      // Outcome: 'accepted' | 'rejected_signature' | 'rejected_replay'
      // | 'rejected_timestamp' | 'rejected_rate_limit' | 'rejected_ip'
      // | 'rejected_unknown_source' | 'rejected_inactive' | 'enqueued'
      // | 'processing_failed' | 'processed'
      t.string('outcome', 32).notNullable();
      t.text('error_text').nullable();
      // Job ID returned by JobBus.enqueue, if outcome is enqueued+
      t.string('job_id', 100).nullable();
      // Headers + body size for diagnostics (no full payload — that
      // would balloon the table and might contain PHI).
      t.integer('body_size').nullable();
      t.string('source_ip', 64).nullable();
      t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['source']);
      t.index(['received_at']);
      t.index(['outcome']);
      // Composite index used by the replay-protection lookup
      t.index(['source', 'payload_hash', 'received_at']);
    });
  }
}

export async function down(): Promise<void> {
  // No-op. Audit logs are operational history and never dropped.
}
