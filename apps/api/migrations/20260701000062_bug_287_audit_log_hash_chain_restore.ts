import type { Knex } from 'knex';

/**
 * BUG-287 / A2-3 — restore audit_log SHA-256 hash chain.
 *
 * Design notes:
 * - Chain scope is per-tenant (`clinic_id`) plus a system scope for NULL clinic rows.
 * - Genesis for each scope is a signed baseline marker
 *   (`system_reconciliation_baseline`) recorded in `audit_log_chain_baselines`.
 * - Existing rows are backfilled deterministically (created_at, id order).
 * - Future inserts are chained by a BEFORE INSERT trigger with per-scope
 *   advisory locking to prevent concurrent forked tails.
 */

const BASELINE_MARKER = 'system_reconciliation_baseline';
const SYSTEM_SCOPE = '__system__';
const CHAIN_LOCK_NAMESPACE = 287001;

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: extension_create
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  const hasPrevHash = await knex.schema.hasColumn('audit_log', 'prev_hash');
  if (!hasPrevHash) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.string('prev_hash', 64).nullable();
    });
  }

  const hasRowHash = await knex.schema.hasColumn('audit_log', 'row_hash');
  if (!hasRowHash) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.string('row_hash', 64).nullable();
    });
  }

  const hasBaselineTable = await knex.schema.hasTable('audit_log_chain_baselines');
  if (!hasBaselineTable) {
    await knex.schema.createTable('audit_log_chain_baselines', (t) => {
      t.text('scope_key').primary();
      t.text('baseline_marker').notNullable();
      t.string('marker_signature', 64).notNullable();
      t.integer('source_row_count').notNullable();
      t.timestamp('min_created_at', { useTz: true }).nullable();
      t.timestamp('max_created_at', { useTz: true }).nullable();
      t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  // @migration-raw-exempt: data_backfill_insert
  await knex.raw(
    `
    WITH scope_rows AS (
      SELECT
        COALESCE(clinic_id::text, '${SYSTEM_SCOPE}') AS scope_key,
        COUNT(*)::int AS row_count,
        MIN(created_at) AS min_created_at,
        MAX(created_at) AS max_created_at
      FROM audit_log
      GROUP BY 1
    ),
    signed AS (
      SELECT
        sr.scope_key,
        '${BASELINE_MARKER}'::text AS baseline_marker,
        encode(
          digest(
            convert_to(
              '${BASELINE_MARKER}' || '|' ||
              sr.scope_key || '|' ||
              sr.row_count::text || '|' ||
              COALESCE(to_char(sr.min_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'null') || '|' ||
              COALESCE(to_char(sr.max_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'null'),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) AS marker_signature,
        sr.row_count AS source_row_count,
        sr.min_created_at,
        sr.max_created_at,
        NOW() AS computed_at
      FROM scope_rows sr
    )
    INSERT INTO audit_log_chain_baselines (
      scope_key,
      baseline_marker,
      marker_signature,
      source_row_count,
      min_created_at,
      max_created_at,
      computed_at
    )
    SELECT
      s.scope_key,
      s.baseline_marker,
      s.marker_signature,
      s.source_row_count,
      s.min_created_at,
      s.max_created_at,
      s.computed_at
    FROM signed s
    ON CONFLICT (scope_key) DO UPDATE SET
      baseline_marker = EXCLUDED.baseline_marker,
      marker_signature = EXCLUDED.marker_signature,
      source_row_count = EXCLUDED.source_row_count,
      min_created_at = EXCLUDED.min_created_at,
      max_created_at = EXCLUDED.max_created_at,
      computed_at = EXCLUDED.computed_at
  `,
  );

  // Temporarily lift ONLY the UPDATE mutation guard so one-time deterministic
  // chain backfill can populate prev_hash/row_hash on existing immutable rows.
  //
  // Note: our migration runner uses `disableTransactions: true`, so this must
  // be self-healing via try/finally instead of relying on transaction rollback.
  let updateGuardLifted = false;
  let chainAggCreated = false;
  let chainAggFunctionCreated = false;
  try {
    // @migration-raw-exempt: trigger_drop
    await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
    updateGuardLifted = true;

    // Set-based rolling-hash state function used by a window aggregate.
    // @migration-raw-exempt: function_create
    await knex.raw(`
      CREATE OR REPLACE FUNCTION audit_log_hash_chain_state_sfunc(
        state text,
        baseline text,
        payload jsonb
      ) RETURNS text AS $fn$
      DECLARE
        v_prev text;
      BEGIN
        v_prev := COALESCE(state, baseline);
        RETURN encode(
          digest(convert_to(v_prev || '|' || payload::text, 'UTF8'), 'sha256'),
          'hex'
        );
      END;
      $fn$ LANGUAGE plpgsql IMMUTABLE
    `);
    chainAggFunctionCreated = true;

    // @migration-raw-exempt: function_drop
    await knex.raw('DROP AGGREGATE IF EXISTS audit_log_hash_chain_state_agg(text, jsonb)');
    // @migration-raw-exempt: function_create
    await knex.raw(`
      CREATE AGGREGATE audit_log_hash_chain_state_agg(text, jsonb) (
        SFUNC = audit_log_hash_chain_state_sfunc,
        STYPE = text
      )
    `);
    chainAggCreated = true;

    // @migration-raw-exempt: data_backfill_update
    await knex.raw(`
      WITH ordered AS (
        SELECT
          a.id,
          COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') AS scope_key,
          a.created_at,
          b.marker_signature::text AS marker_signature,
          audit_log_hash_chain_state_agg(
            b.marker_signature::text,
            (to_jsonb(a) - ARRAY['prev_hash', 'row_hash'])
          ) OVER (
            PARTITION BY COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}')
            ORDER BY a.created_at, a.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS computed_row_hash
        FROM audit_log a
        JOIN audit_log_chain_baselines b
          ON b.scope_key = COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}')
      ),
      hashed AS (
        SELECT
          id,
          COALESCE(
            LAG(computed_row_hash) OVER (PARTITION BY scope_key ORDER BY created_at, id),
            marker_signature
          ) AS computed_prev_hash,
          computed_row_hash
        FROM ordered
      )
      UPDATE audit_log a
         SET prev_hash = h.computed_prev_hash,
             row_hash = h.computed_row_hash
        FROM hashed h
       WHERE a.id = h.id
    `);
  } finally {
    if (chainAggCreated) {
      // @migration-raw-exempt: function_drop
      await knex.raw('DROP AGGREGATE IF EXISTS audit_log_hash_chain_state_agg(text, jsonb)');
    }
    if (chainAggFunctionCreated) {
      // @migration-raw-exempt: function_drop
      await knex.raw('DROP FUNCTION IF EXISTS audit_log_hash_chain_state_sfunc(text, text, jsonb)');
    }
    if (updateGuardLifted) {
      // Re-enable BUG-039 immutability guard immediately after backfill.
      // @migration-raw-exempt: trigger_drop
      await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
      // @migration-raw-exempt: trigger_create
      await knex.raw(`
        CREATE TRIGGER audit_log_no_update
          BEFORE UPDATE ON audit_log
          FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()
      `);
    }
  }

  await knex.schema.alterTable('audit_log', (t) => {
    t.string('prev_hash', 64).notNullable().alter();
    t.string('row_hash', 64).notNullable().alter();
  });

  // @migration-raw-exempt: function_create
  await knex.raw(
    `
    CREATE OR REPLACE FUNCTION audit_log_hash_chain()
    RETURNS TRIGGER AS $fn$
    DECLARE
      v_scope_key text;
      v_prev_hash varchar(64);
      v_payload jsonb;
    BEGIN
      v_scope_key := COALESCE(NEW.clinic_id::text, '${SYSTEM_SCOPE}');

      PERFORM pg_advisory_xact_lock(${CHAIN_LOCK_NAMESPACE}, hashtext(v_scope_key));

      SELECT a.row_hash
        INTO v_prev_hash
        FROM audit_log a
       WHERE COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') = v_scope_key
         AND a.row_hash IS NOT NULL
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1;

      IF v_prev_hash IS NULL THEN
        INSERT INTO audit_log_chain_baselines (
          scope_key,
          baseline_marker,
          marker_signature,
          source_row_count,
          min_created_at,
          max_created_at,
          computed_at
        )
        VALUES (
          v_scope_key,
          '${BASELINE_MARKER}',
          encode(digest(convert_to('${BASELINE_MARKER}' || '|' || v_scope_key, 'UTF8'), 'sha256'), 'hex'),
          0,
          NULL,
          NULL,
          NOW()
        )
        ON CONFLICT (scope_key) DO NOTHING;

        SELECT b.marker_signature
          INTO v_prev_hash
          FROM audit_log_chain_baselines b
         WHERE b.scope_key = v_scope_key;
      END IF;

      v_payload := to_jsonb(NEW) - ARRAY['prev_hash', 'row_hash'];
      NEW.prev_hash := v_prev_hash;
      NEW.row_hash := encode(digest(convert_to(v_prev_hash || '|' || v_payload::text, 'UTF8'), 'sha256'), 'hex');

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql
  `,
  );

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(
    `
    CREATE TRIGGER trg_audit_hash_chain
      BEFORE INSERT ON audit_log
      FOR EACH ROW
      EXECUTE FUNCTION audit_log_hash_chain()
  `,
  );
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit_log');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS audit_log_hash_chain()');

  const hasBaselineTable = await knex.schema.hasTable('audit_log_chain_baselines');
  if (hasBaselineTable) {
    await knex.schema.dropTableIfExists('audit_log_chain_baselines');
  }

  const hasRowHash = await knex.schema.hasColumn('audit_log', 'row_hash');
  if (hasRowHash) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.dropColumn('row_hash');
    });
  }

  const hasPrevHash = await knex.schema.hasColumn('audit_log', 'prev_hash');
  if (hasPrevHash) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.dropColumn('prev_hash');
    });
  }
}
