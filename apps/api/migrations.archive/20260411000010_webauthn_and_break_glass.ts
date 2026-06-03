import type { Knex } from 'knex';

/**
 * S6.1 — WebAuthn/FIDO2 credential store + break-glass session tracking.
 *
 * Closes GAP-10 (WebAuthn/FIDO2 MFA) and GAP-04 (emergency break-glass
 * access) from the Gold Standard Gap Analysis. Replaces the runtime
 * `db.schema.createTable` call in webauthnRoutes.ts (violated CLAUDE.md §1.2 —
 * "never write code that references a table you haven't created") with a
 * proper, RLS-enabled, indexed, check-constrained migration.
 *
 * Tables created:
 *
 * 1. `webauthn_credentials` — one row per registered passkey/security key.
 *    A staff member may register multiple authenticators (e.g. a YubiKey
 *    plus Touch ID). Sign-in allows any of them.
 *
 *    Columns:
 *      id              uuid PK
 *      staff_id        uuid NOT NULL → staff(id)
 *      clinic_id       uuid NOT NULL → clinics(id)   (RLS)
 *      credential_id   text NOT NULL UNIQUE  (raw WebAuthn credentialId, base64url)
 *      public_key      text NOT NULL         (COSE public key, base64url)
 *      counter         bigint NOT NULL DEFAULT 0  (signature counter — MUST
 *                                                  monotonically increase)
 *      transports      text[]                (usb / nfc / ble / internal / hybrid)
 *      device_name     text                  (user-facing label)
 *      aaguid          text                  (authenticator vendor identifier)
 *      backup_eligible boolean NOT NULL DEFAULT false
 *      backup_state    boolean NOT NULL DEFAULT false
 *      last_used_at    timestamptz
 *      created_at      timestamptz NOT NULL DEFAULT now()
 *      updated_at      timestamptz NOT NULL DEFAULT now()
 *      deleted_at      timestamptz           (soft delete per §1.4)
 *
 *    Indexes:
 *      - staff_id                        (list credentials by user)
 *      - clinic_id                       (RLS hot path per §7.1)
 *      - credential_id UNIQUE partial WHERE deleted_at IS NULL
 *
 *    RLS: enabled with policy `rls_webauthn_credentials_tenant`
 *    matching `current_setting('app.clinic_id')::uuid`.
 *
 * 2. `break_glass_sessions` — audit-grade record of every emergency
 *    break-glass activation. One row per request, regardless of whether
 *    the request was approved or denied.
 *
 *    Columns:
 *      id                  uuid PK
 *      clinic_id           uuid NOT NULL → clinics(id)   (RLS)
 *      staff_id            uuid NOT NULL → staff(id)
 *      reason              text NOT NULL          (>= 10 chars, enforced
 *                                                  in handler + CHECK)
 *      status              text NOT NULL          (pending / approved /
 *                                                  denied / expired / revoked)
 *      approver_id         uuid → staff(id)       (second staff member,
 *                                                  required for approval)
 *      approved_at         timestamptz
 *      denied_reason       text
 *      token_hash          text                   (SHA-256 of the issued
 *                                                  JWT — never store the
 *                                                  raw token itself)
 *      issued_at           timestamptz
 *      expires_at          timestamptz            (issued_at + 30 min by
 *                                                  default; policy-configurable)
 *      revoked_at          timestamptz
 *      revoked_by          uuid → staff(id)
 *      ip_address          inet
 *      user_agent          text
 *      actions_performed   jsonb                  (list of audit_log row
 *                                                  ids created under this
 *                                                  break-glass session,
 *                                                  populated by middleware)
 *      alerted_at          timestamptz            (when Slack/email alert
 *                                                  was dispatched)
 *      created_at          timestamptz NOT NULL DEFAULT now()
 *
 *    Indexes:
 *      - clinic_id                       (RLS hot path)
 *      - staff_id                        (list by user)
 *      - status WHERE status = 'pending' (pending approval queue)
 *      - expires_at WHERE status = 'approved'  (active break-glass sessions)
 *
 *    RLS: enabled with policy `rls_break_glass_tenant`.
 *
 *    Business uniqueness: `break_glass_sessions_one_pending_per_staff`
 *    UNIQUE INDEX ensures a staff member cannot have two pending
 *    break-glass requests at the same time (§7.2).
 *
 * Append-only. down() drops both tables — safe because they are new in
 * this migration and no other migration depends on them yet.
 *
 * Standards satisfied:
 *   - HIPAA 164.312(a)(2)(ii)      Emergency Access Procedure (break-glass)
 *   - NSQHS Standard 1             Clinical Governance
 *   - ACSC Essential Eight ML3     Phishing-resistant MFA (WebAuthn)
 *   - OWASP ASVS V2.2              Multi-factor authentication
 *   - ISO 27001 A.8.3              Information access restriction
 *   - CLAUDE.md §1.2, §1.6, §6.3, §7.1, §7.2, §7.3
 */
export async function up(knex: Knex): Promise<void> {
  // ── webauthn_credentials ───────────────────────────────────────────────────
  const hasWebauthn = await knex.schema.hasTable('webauthn_credentials');
  if (!hasWebauthn) {
    await knex.schema.createTable('webauthn_credentials', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('staff_id')
        .notNullable()
        .references('id')
        .inTable('staff')
        .onDelete('CASCADE');
      t.uuid('clinic_id')
        .notNullable()
        .references('id')
        .inTable('clinics');
      t.text('credential_id').notNullable();
      t.text('public_key').notNullable();
      t.bigInteger('counter').notNullable().defaultTo(0);
      t.specificType('transports', 'text[]');
      t.text('device_name');
      t.text('aaguid');
      t.boolean('backup_eligible').notNullable().defaultTo(false);
      t.boolean('backup_state').notNullable().defaultTo(false);
      t.timestamp('last_used_at', { useTz: true });
      t.timestamps(true, true);
      t.timestamp('deleted_at', { useTz: true });

      t.index(['staff_id'], 'webauthn_credentials_staff_id_idx');
      t.index(['clinic_id'], 'webauthn_credentials_clinic_id_idx');
    });

    // UNIQUE on credential_id is a partial index — soft-deleted credentials
    // should not block re-registration of a replacement authenticator.
    await knex.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS webauthn_credentials_credential_id_uniq
         ON webauthn_credentials (credential_id)
         WHERE deleted_at IS NULL`,
    );

    // RLS (CLAUDE.md §6.3)
    await knex.raw('ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_webauthn_credentials_tenant ON webauthn_credentials
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);

    // Grant non-owner app role (RLS depends on non-superuser)
    const hasAppUser1 = await knex.raw(`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`);
    if ((hasAppUser1.rows ?? []).length > 0) {
      await knex.raw('GRANT SELECT, INSERT, UPDATE, DELETE ON webauthn_credentials TO app_user');
    }
  }

  // ── break_glass_sessions ──────────────────────────────────────────────────
  const hasBreakGlass = await knex.schema.hasTable('break_glass_sessions');
  if (!hasBreakGlass) {
    await knex.schema.createTable('break_glass_sessions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id')
        .notNullable()
        .references('id')
        .inTable('clinics');
      t.uuid('staff_id')
        .notNullable()
        .references('id')
        .inTable('staff');
      t.text('reason').notNullable();
      t.text('status').notNullable().defaultTo('pending');
      t.uuid('approver_id').references('id').inTable('staff');
      t.timestamp('approved_at', { useTz: true });
      t.text('denied_reason');
      t.text('token_hash');
      t.timestamp('issued_at', { useTz: true });
      t.timestamp('expires_at', { useTz: true });
      t.timestamp('revoked_at', { useTz: true });
      t.uuid('revoked_by').references('id').inTable('staff');
      t.specificType('ip_address', 'inet');
      t.text('user_agent');
      t.jsonb('actions_performed').defaultTo(knex.raw(`'[]'::jsonb`));
      t.timestamp('alerted_at', { useTz: true });
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id'], 'break_glass_sessions_clinic_id_idx');
      t.index(['staff_id'], 'break_glass_sessions_staff_id_idx');
    });

    // Reason length enforced at DB level as defence-in-depth (handler
    // already validates >= 10 chars).
    await knex.raw(`
      ALTER TABLE break_glass_sessions
        ADD CONSTRAINT break_glass_sessions_reason_min_length
        CHECK (char_length(reason) >= 10)
    `);

    // Status enum as a CHECK — no pg_enum churn, simple rollback.
    await knex.raw(`
      ALTER TABLE break_glass_sessions
        ADD CONSTRAINT break_glass_sessions_status_chk
        CHECK (status IN ('pending','approved','denied','expired','revoked'))
    `);

    // Pending approval queue — small, hot index.
    await knex.raw(`
      CREATE INDEX break_glass_sessions_pending_idx
        ON break_glass_sessions (clinic_id, created_at)
        WHERE status = 'pending'
    `);

    // Active break-glass sessions (used by middleware to resolve the
    // staff-side break-glass flag into a session id for audit tagging).
    await knex.raw(`
      CREATE INDEX break_glass_sessions_active_idx
        ON break_glass_sessions (staff_id, expires_at)
        WHERE status = 'approved'
    `);

    // Business uniqueness: one pending request per staff at a time.
    await knex.raw(`
      CREATE UNIQUE INDEX break_glass_sessions_one_pending_per_staff
        ON break_glass_sessions (staff_id)
        WHERE status = 'pending'
    `);

    // RLS
    await knex.raw('ALTER TABLE break_glass_sessions ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_break_glass_sessions_tenant ON break_glass_sessions
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);

    const hasAppUser2 = await knex.raw(`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`);
    if ((hasAppUser2.rows ?? []).length > 0) {
      await knex.raw('GRANT SELECT, INSERT, UPDATE ON break_glass_sessions TO app_user');
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS break_glass_sessions CASCADE');
  await knex.raw('DROP TABLE IF EXISTS webauthn_credentials CASCADE');
}
