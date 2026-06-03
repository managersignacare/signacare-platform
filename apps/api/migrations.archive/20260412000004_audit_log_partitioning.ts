import type { Knex } from 'knex';

/**
 * Convert audit_log to a monthly-range-partitioned table.
 *
 * Why: audit_log is append-only and retained for 7 years (APP 11.2,
 * ACHS Standard 1). Over a multi-year clinical deployment the table
 * will grow to hundreds of millions of rows, making routine queries
 * slow, VACUUM expensive, and retention deletes catastrophic.
 *
 * Partitioning strategy:
 *   - PARTITION BY RANGE (created_at) with monthly child partitions.
 *   - A nightly job (or pg_partman) creates N+1 month ahead.
 *   - Retention: DROP PARTITION on anything > 84 months old — O(1)
 *     instead of O(N) DELETE.
 *
 * Postgres requires the primary key to include the partition column,
 * so the PK becomes (id, created_at) instead of (id).
 *
 * Postgres DOES NOT allow INSTEAD NOTHING rewrite rules on
 * partitioned tables — the previous tamper-evidence (DELETE/UPDATE
 * NOTHING rules) is replaced with BEFORE-row triggers that RAISE
 * EXCEPTION.
 *
 * Procedure:
 *   1. Save nothing — all original definitions are hardcoded below.
 *   2. DROP existing triggers / rules / policy / indexes / FKs.
 *   3. RENAME audit_log → audit_log_pre_partition.
 *   4. CREATE TABLE audit_log (... PARTITION BY RANGE (created_at)).
 *   5. Create monthly partitions covering the existing data span
 *      plus one month ahead, plus a DEFAULT partition as a safety
 *      net for unexpected dates.
 *   6. Re-create indexes on parent.
 *   7. INSERT INTO audit_log SELECT * FROM audit_log_pre_partition.
 *   8. Re-enable RLS policy on parent.
 *   9. Re-create tamper-evident BEFORE triggers and the hash-chain
 *      BEFORE INSERT trigger.
 *  10. Re-grant app_user SELECT + INSERT only (UPDATE/DELETE stay
 *      revoked — HIPAA §164.312(c)(1) integrity).
 *  11. DROP audit_log_pre_partition.
 *
 * The migration is GUARDED: if audit_log is already partitioned
 * (pg_partitioned_table lookup returns a row) the migration
 * becomes a no-op. Idempotent + safe to re-run.
 *
 * down() is a NO-OP. Reverting partitioning mid-production would
 * require moving data back into a non-partitioned table and
 * discarding the 7-year retention optimisation.
 *
 * Standard satisfied: APP 11.2 (7-year retention), ACHS Standard 1,
 *                     ISO 27001 A.12.3, HIPAA §164.312(c)(1).
 */

export async function up(knex: Knex): Promise<void> {
  // Idempotent guard: skip if already partitioned.
  const existing = await knex.raw<{ rows: Array<unknown> }>(
    `SELECT 1 FROM pg_partitioned_table WHERE partrelid = 'public.audit_log'::regclass`,
  );
  if (existing.rows.length > 0) return;

  // Guard: skip on fresh v2 databases. The v2 baseline creates
  // audit_log with snake_case columns (clinic_id). This migration
  // was written for the pre-v2 camelCase schema (clinicid). Running
  // it against a v2 DB would recreate audit_log with camelCase
  // columns, causing a type mismatch on the INSERT ... SELECT.
  // Partitioning of the v2 schema should be done in a future
  // migration that uses the correct column names.
  const hasLegacyCol = await knex.schema.hasColumn('audit_log', 'clinicid');
  if (!hasLegacyCol) return;

  // We must know the data span to create covering partitions.
  const span = await knex.raw<{
    rows: Array<{ min_month: string | null; max_month: string | null }>;
  }>(
    `SELECT
       to_char(MIN(created_at), 'YYYY-MM-01') AS min_month,
       to_char(MAX(created_at), 'YYYY-MM-01') AS max_month
     FROM audit_log WHERE created_at IS NOT NULL`,
  );
  const minMonth = span.rows[0]?.min_month ?? new Date().toISOString().slice(0, 7) + '-01';
  const maxMonth = span.rows[0]?.max_month ?? minMonth;

  // Build a list of YYYY-MM-01 month-start strings from minMonth to
  // maxMonth + 1 month (inclusive) so every row finds a home and we
  // have one partition ahead for fresh writes.
  const months: string[] = [];
  const cursor = new Date(minMonth + 'T00:00:00Z');
  const end = new Date(maxMonth + 'T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1);
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  function nextMonth(ym: string): string {
    const d = new Date(ym + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  }
  function partName(ym: string): string {
    return 'audit_log_y' + ym.slice(0, 4) + 'm' + ym.slice(5, 7);
  }

  await knex.raw('BEGIN');
  try {
    // Drop tamper-evident rules (replaced with triggers on parent)
    await knex.raw('DROP RULE IF EXISTS audit_log_no_delete ON audit_log');
    await knex.raw('DROP RULE IF EXISTS audit_log_no_update ON audit_log');
    // Drop hash-chain trigger (will recreate on new parent)
    await knex.raw('DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit_log');
    // Drop RLS policy — must be re-created on the new parent
    await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON audit_log');
    // Drop FK constraints — will recreate on partitioned parent
    await knex.raw('ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_clinic_id_fk');
    await knex.raw('ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_staff_id_fk');

    // Rename original table
    await knex.raw('ALTER TABLE audit_log RENAME TO audit_log_pre_partition');

    // Create new partitioned parent. PK must include partition key.
    await knex.raw(`
      CREATE TABLE audit_log (
        id          uuid NOT NULL DEFAULT gen_random_uuid(),
        clinicid    uuid,
        userid      uuid,
        user_name   varchar(200),
        action      varchar(50),
        module      varchar(100),
        entitytype  varchar(100),
        entityid    varchar(100),
        details     jsonb,
        ipaddress   varchar(50),
        user_agent  varchar(500),
        createdat   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        clinic_id   uuid,
        staff_id    uuid,
        user_id     uuid,
        table_name  varchar(100),
        record_id   varchar(100),
        operation   varchar(50),
        ip_address  varchar(50),
        old_data    jsonb,
        new_data    jsonb,
        entity_type varchar(100),
        entity_id   varchar(100),
        created_at  timestamptz NOT NULL DEFAULT now(),
        prev_hash   varchar(64),
        row_hash    varchar(64),
        PRIMARY KEY (id, created_at)
      ) PARTITION BY RANGE (created_at)
    `);

    // Indexes on the partitioned parent — PG propagates them to
    // every partition. The composite (clinic_id, created_at) is
    // the hot query path for "recent audit rows for tenant X".
    // @migration-raw-exempt: indexes on partitioned parent alongside PARTITION BY RANGE DDL; raw for consistency in partition-migration context
    await knex.raw('CREATE INDEX audit_log_clinic_id_created_at_idx ON audit_log (clinic_id, created_at DESC)');
    // @migration-raw-exempt: index on partitioned parent; partition-migration context
    await knex.raw('CREATE INDEX audit_log_clinic_id_idx ON audit_log (clinic_id)');
    // @migration-raw-exempt: index on partitioned parent; partition-migration context
    await knex.raw('CREATE INDEX audit_log_action_idx ON audit_log (action)');
    // @migration-raw-exempt: index on partitioned parent; partition-migration context
    await knex.raw('CREATE INDEX audit_log_table_record_idx ON audit_log (table_name, record_id)');
    // @migration-raw-exempt: index on partitioned parent; partition-migration context
    await knex.raw('CREATE INDEX audit_log_created_at_idx ON audit_log (created_at)');
    // @migration-raw-exempt: index on partitioned parent; partition-migration context
    await knex.raw('CREATE INDEX audit_log_user_id_idx ON audit_log (user_id)');

    // Monthly partitions for the full historical span.
    for (const ym of months) {
      const name = partName(ym);
      const to = nextMonth(ym);
      await knex.raw(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF audit_log FOR VALUES FROM ('${ym}') TO ('${to}')`,
      );
    }
    // Default partition — catches rows with a created_at outside
    // any explicit range (shouldn't happen but protects against
    // clock drift + the nightly partition-creation job falling
    // behind).
    await knex.raw(
      `CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT`,
    );

    // FK constraints on parent — PG 12+ supports these; they are
    // propagated to every partition.
    await knex.raw(
      `ALTER TABLE audit_log ADD CONSTRAINT audit_log_clinic_id_fk
       FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL`,
    );
    await knex.raw(
      `ALTER TABLE audit_log ADD CONSTRAINT audit_log_staff_id_fk
       FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE RESTRICT`,
    );

    // Copy data from the renamed legacy table. INSERT into the
    // partitioned parent routes each row to the correct child
    // partition automatically. We deliberately DO NOT fire the
    // hash-chain trigger here — the rows already have their
    // prev_hash / row_hash computed from the pre-migration write
    // path, and re-firing would corrupt the chain.
    //
    // TRIGGER USER (not TRIGGER ALL) — we only need to suppress
    // user-defined triggers (the hash chain). ALL would also try
    // to disable system RI constraint triggers, which requires
    // superuser and is not the intent.
    await knex.raw('ALTER TABLE audit_log DISABLE TRIGGER USER');
    await knex.raw('INSERT INTO audit_log SELECT * FROM audit_log_pre_partition');
    await knex.raw('ALTER TABLE audit_log ENABLE TRIGGER USER');

    // Re-enable RLS + policy on the parent. PG propagates to
    // partitions automatically.
    await knex.raw('ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY tenant_isolation ON audit_log
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
    `);

    // Tamper-evidence. Partitioned tables DO NOT support rewrite
    // rules, so we replace INSTEAD NOTHING with BEFORE-row triggers
    // that RAISE EXCEPTION. Any UPDATE or DELETE at the parent
    // level is rejected. This preserves HIPAA §164.312(c)(1)
    // integrity semantics exactly.
    await knex.raw(`
      CREATE OR REPLACE FUNCTION audit_log_prevent_mutation() RETURNS TRIGGER AS $fn$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only (tamper-evident)';
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await knex.raw(`
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()
    `);
    await knex.raw(`
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()
    `);

    // Re-create the hash-chain BEFORE INSERT trigger. The function
    // audit_log_hash_chain() already exists; we just re-attach it.
    await knex.raw(`
      CREATE TRIGGER trg_audit_hash_chain BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_hash_chain()
    `);

    // Re-grant runtime DB role, then REVOKE UPDATE/DELETE/TRUNCATE
    // so audit_log is tamper-evident at the grant layer. Postgres
    // grants these implicitly on CREATE TABLE to roles that had them
    // on the old table, so the REVOKE is not redundant.
    // HIPAA §164.312(c)(1) + APP 11.2.
    await knex.raw('GRANT SELECT, INSERT ON audit_log TO app_user');
    await knex.raw('REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user');
    // Also revoke on each child partition because Postgres
    // privilege checks happen per-partition on partition-routed
    // writes.
    const partitionRows = await knex.raw<{ rows: Array<{ relname: string }> }>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = 'public.audit_log'::regclass`,
    );
    for (const { relname } of partitionRows.rows) {
      await knex.raw(`REVOKE UPDATE, DELETE, TRUNCATE ON ${relname} FROM app_user`);
    }

    // Drop the legacy table. Data is fully migrated at this point.
    // @migration-raw-exempt: cleanup of pre-partition snapshot table inside partitioning migration; raw for context consistency
    await knex.raw('DROP TABLE audit_log_pre_partition');

    await knex.raw('COMMIT');
  } catch (err) {
    await knex.raw('ROLLBACK');
    throw err;
  }
}

export async function down(): Promise<void> {
  // No-op. Reverting partitioning would require moving every row
  // back into a non-partitioned table and discarding the retention
  // optimisation the partitioning exists to enable.
}
