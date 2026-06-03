import type { Knex } from 'knex';

/**
 * BUG-287 structural follow-up:
 * - Prevent per-scope chain branching under concurrent/same-batch inserts.
 * - Keep deterministic chain ordering by assigning chain_ordinal inside trigger
 *   after scope lock acquisition.
 *
 * Why:
 * - Prior trigger looked up predecessor from persisted rows only.
 * - Under specific timing, two rows in the same scope could select the same
 *   predecessor and create a branch, breaking end-to-end chain validation.
 */

const SYSTEM_SCOPE = '__system__';
const BASELINE_MARKER = 'system_reconciliation_baseline';
const CHAIN_LOCK_NAMESPACE = 287001;
const CHAIN_ORDINAL_SEQUENCE = 'audit_log_chain_ordinal_seq';

async function dropAuditMutationGuardForBackfill(knex: Knex): Promise<boolean> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
  return true;
}

async function restoreAuditMutationGuardAfterBackfill(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()
  `);
}

async function ensureChainScopeStateTable(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('audit_log_chain_scope_state');
  if (!hasTable) {
    await knex.schema.createTable('audit_log_chain_scope_state', (t) => {
      t.text('scope_key').primary();
      t.bigInteger('last_chain_ordinal').notNullable();
      t.string('last_row_hash', 64).notNullable();
      t.timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
    });
  }
}

async function resealChainByScopeOrdinal(knex: Knex): Promise<void> {
  let chainAggFunctionCreated = false;
  let chainAggCreated = false;
  try {
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
          a.chain_ordinal,
          b.marker_signature::text AS marker_signature,
          audit_log_hash_chain_state_agg(
            b.marker_signature::text,
            (to_jsonb(a) - ARRAY['prev_hash', 'row_hash'])
          ) OVER (
            PARTITION BY COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}')
            ORDER BY a.chain_ordinal
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
            LAG(computed_row_hash) OVER (
              PARTITION BY scope_key
              ORDER BY chain_ordinal
            ),
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
  }
}

async function rebuildScopeStateFromCurrentChain(knex: Knex): Promise<void> {
  // @migration-raw-exempt: data_backfill_update
  await knex.raw('TRUNCATE TABLE audit_log_chain_scope_state');
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    WITH tails AS (
      SELECT DISTINCT ON (COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}'))
        COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') AS scope_key,
        a.chain_ordinal,
        a.row_hash
      FROM audit_log a
      ORDER BY COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}'), a.chain_ordinal DESC
    )
    INSERT INTO audit_log_chain_scope_state (
      scope_key,
      last_chain_ordinal,
      last_row_hash,
      updated_at
    )
    SELECT
      b.scope_key,
      COALESCE(t.chain_ordinal, 0)::bigint AS last_chain_ordinal,
      COALESCE(t.row_hash, b.marker_signature) AS last_row_hash,
      NOW()
    FROM audit_log_chain_baselines b
    LEFT JOIN tails t
      ON t.scope_key = b.scope_key
    ON CONFLICT (scope_key) DO UPDATE
      SET last_chain_ordinal = EXCLUDED.last_chain_ordinal,
          last_row_hash = EXCLUDED.last_row_hash,
          updated_at = NOW()
  `);
}

async function createStateAwareChainTriggerFunction(knex: Knex): Promise<void> {
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION audit_log_hash_chain()
    RETURNS TRIGGER AS $fn$
    DECLARE
      v_scope_key text;
      v_prev_hash varchar(64);
      v_payload jsonb;
      v_state_ordinal bigint;
    BEGIN
      v_scope_key := COALESCE(NEW.clinic_id::text, '${SYSTEM_SCOPE}');

      PERFORM pg_advisory_xact_lock(${CHAIN_LOCK_NAMESPACE}, hashtext(v_scope_key));

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

      INSERT INTO audit_log_chain_scope_state (
        scope_key,
        last_chain_ordinal,
        last_row_hash,
        updated_at
      )
      SELECT
        v_scope_key,
        COALESCE((
          SELECT MAX(a.chain_ordinal)
          FROM audit_log a
          WHERE COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') = v_scope_key
        ), 0)::bigint,
        COALESCE((
          SELECT a.row_hash
          FROM audit_log a
          WHERE COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') = v_scope_key
          ORDER BY a.chain_ordinal DESC
          LIMIT 1
        ), (
          SELECT b.marker_signature
          FROM audit_log_chain_baselines b
          WHERE b.scope_key = v_scope_key
        )),
        NOW()
      ON CONFLICT (scope_key) DO NOTHING;

      SELECT s.last_chain_ordinal, s.last_row_hash
        INTO v_state_ordinal, v_prev_hash
      FROM audit_log_chain_scope_state s
      WHERE s.scope_key = v_scope_key
      FOR UPDATE;

      NEW.chain_ordinal := nextval('${CHAIN_ORDINAL_SEQUENCE}');
      NEW.prev_hash := v_prev_hash;
      v_payload := to_jsonb(NEW) - ARRAY['prev_hash', 'row_hash'];
      NEW.row_hash := encode(
        digest(convert_to(NEW.prev_hash || '|' || v_payload::text, 'UTF8'), 'sha256'),
        'hex'
      );

      UPDATE audit_log_chain_scope_state
         SET last_chain_ordinal = NEW.chain_ordinal,
             last_row_hash = NEW.row_hash,
             updated_at = NOW()
       WHERE scope_key = v_scope_key;

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql
  `);
}

async function createOrdinalLookupChainTriggerFunction(knex: Knex): Promise<void> {
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION audit_log_hash_chain()
    RETURNS TRIGGER AS $fn$
    DECLARE
      v_scope_key text;
      v_prev_hash varchar(64);
      v_payload jsonb;
    BEGIN
      v_scope_key := COALESCE(NEW.clinic_id::text, '${SYSTEM_SCOPE}');

      IF NEW.chain_ordinal IS NULL THEN
        NEW.chain_ordinal := nextval('${CHAIN_ORDINAL_SEQUENCE}');
      END IF;

      PERFORM pg_advisory_xact_lock(${CHAIN_LOCK_NAMESPACE}, hashtext(v_scope_key));

      SELECT a.row_hash
        INTO v_prev_hash
        FROM audit_log a
       WHERE COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') = v_scope_key
         AND a.row_hash IS NOT NULL
         AND a.chain_ordinal < NEW.chain_ordinal
       ORDER BY a.chain_ordinal DESC
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
      NEW.row_hash := encode(
        digest(convert_to(v_prev_hash || '|' || v_payload::text, 'UTF8'), 'sha256'),
        'hex'
      );

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql
  `);
}

export async function up(knex: Knex): Promise<void> {
  await ensureChainScopeStateTable(knex);

  // Ensure trigger-assigned ordinals stay ahead of all persisted rows.
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    SELECT setval(
      '${CHAIN_ORDINAL_SEQUENCE}',
      GREATEST(COALESCE((SELECT MAX(chain_ordinal) FROM audit_log), 1), 1),
      COALESCE((SELECT MAX(chain_ordinal) FROM audit_log), 0) > 0
    )
  `);

  let updateGuardLifted = false;
  try {
    updateGuardLifted = await dropAuditMutationGuardForBackfill(knex);
    await resealChainByScopeOrdinal(knex);
    await rebuildScopeStateFromCurrentChain(knex);
  } finally {
    if (updateGuardLifted) {
      await restoreAuditMutationGuardAfterBackfill(knex);
    }
  }

  await createStateAwareChainTriggerFunction(knex);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_audit_hash_chain
      BEFORE INSERT ON audit_log
      FOR EACH ROW
      EXECUTE FUNCTION audit_log_hash_chain()
  `);
}

export async function down(knex: Knex): Promise<void> {
  await createOrdinalLookupChainTriggerFunction(knex);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_audit_hash_chain
      BEFORE INSERT ON audit_log
      FOR EACH ROW
      EXECUTE FUNCTION audit_log_hash_chain()
  `);

  // Keep table teardown in down-path for explicit rollback semantics.
  await knex.schema.dropTableIfExists('audit_log_chain_scope_state');
}
