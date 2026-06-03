import type { Knex } from 'knex';

/**
 * BUG-287 follow-up:
 * The scope-state trigger advanced chain tail in BEFORE INSERT, even when
 * INSERT ... ON CONFLICT DO NOTHING skipped persistence (dedupe collisions).
 * That produced ghost tail advancement and hash-chain divergence.
 *
 * Fix:
 * 1) BEFORE INSERT trigger computes NEW.prev_hash/NEW.row_hash only.
 * 2) AFTER INSERT trigger advances scope-state tail only for committed rows.
 * 3) Reseal existing rows by chain_ordinal and rebuild scope state.
 */

const SYSTEM_SCOPE = '__system__';
const BASELINE_MARKER = 'system_reconciliation_baseline';
const CHAIN_LOCK_NAMESPACE = 287001;
const CHAIN_ORDINAL_SEQUENCE = 'audit_log_chain_ordinal_seq';
const BEFORE_TRIGGER_NAME = 'trg_audit_hash_chain';
const AFTER_TRIGGER_NAME = 'trg_audit_hash_chain_state_after_insert';
const AFTER_TRIGGER_FN = 'audit_log_hash_chain_after_insert_state';

async function dropAuditUpdateGuard(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
}

async function restoreAuditUpdateGuard(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()
  `);
}

async function resealAuditChainByOrdinal(knex: Knex): Promise<void> {
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

async function rebuildScopeState(knex: Knex): Promise<void> {
  // @migration-raw-exempt: data_backfill_update
  await knex.raw('TRUNCATE TABLE audit_log_chain_scope_state');
  // @migration-raw-exempt: data_backfill_insert
  await knex.raw(`
    INSERT INTO audit_log_chain_scope_state (
      scope_key,
      last_chain_ordinal,
      last_row_hash,
      updated_at
    )
    SELECT
      s.scope_key,
      s.max_chain_ordinal,
      a.row_hash,
      NOW()
    FROM (
      SELECT
        COALESCE(clinic_id::text, '${SYSTEM_SCOPE}') AS scope_key,
        MAX(chain_ordinal)::bigint AS max_chain_ordinal
      FROM audit_log
      GROUP BY 1
    ) s
    JOIN audit_log a
      ON COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}') = s.scope_key
     AND a.chain_ordinal = s.max_chain_ordinal
  `);
}

async function createBeforeTriggerFunction(knex: Knex): Promise<void> {
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

      SELECT s.last_row_hash
        INTO v_prev_hash
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

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql
  `);
}

async function createAfterTriggerFunction(knex: Knex): Promise<void> {
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${AFTER_TRIGGER_FN}()
    RETURNS TRIGGER AS $fn$
    DECLARE
      v_scope_key text;
    BEGIN
      v_scope_key := COALESCE(NEW.clinic_id::text, '${SYSTEM_SCOPE}');

      PERFORM pg_advisory_xact_lock(${CHAIN_LOCK_NAMESPACE}, hashtext(v_scope_key));

      INSERT INTO audit_log_chain_scope_state (
        scope_key,
        last_chain_ordinal,
        last_row_hash,
        updated_at
      )
      VALUES (
        v_scope_key,
        NEW.chain_ordinal,
        NEW.row_hash,
        NOW()
      )
      ON CONFLICT (scope_key) DO UPDATE
      SET
        last_chain_ordinal = GREATEST(
          audit_log_chain_scope_state.last_chain_ordinal,
          EXCLUDED.last_chain_ordinal
        ),
        last_row_hash = CASE
          WHEN EXCLUDED.last_chain_ordinal >= audit_log_chain_scope_state.last_chain_ordinal
            THEN EXCLUDED.last_row_hash
          ELSE audit_log_chain_scope_state.last_row_hash
        END,
        updated_at = NOW();

      RETURN NULL;
    END;
    $fn$ LANGUAGE plpgsql
  `);
}

async function swapChainTriggers(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${BEFORE_TRIGGER_NAME} ON audit_log`);
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${AFTER_TRIGGER_NAME} ON audit_log`);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER ${BEFORE_TRIGGER_NAME}
      BEFORE INSERT ON audit_log
      FOR EACH ROW
      EXECUTE FUNCTION audit_log_hash_chain()
  `);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER ${AFTER_TRIGGER_NAME}
      AFTER INSERT ON audit_log
      FOR EACH ROW
      EXECUTE FUNCTION ${AFTER_TRIGGER_FN}()
  `);
}

async function resetChainSequence(knex: Knex): Promise<void> {
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    SELECT setval(
      '${CHAIN_ORDINAL_SEQUENCE}',
      GREATEST(COALESCE((SELECT MAX(chain_ordinal) FROM audit_log), 1), 1),
      COALESCE((SELECT MAX(chain_ordinal) FROM audit_log), 0) > 0
    )
  `);
}

export async function up(knex: Knex): Promise<void> {
  await dropAuditUpdateGuard(knex);
  try {
    await resealAuditChainByOrdinal(knex);
    await rebuildScopeState(knex);
    await resetChainSequence(knex);
    await createBeforeTriggerFunction(knex);
    await createAfterTriggerFunction(knex);
    await swapChainTriggers(knex);
  } finally {
    await restoreAuditUpdateGuard(knex);
  }
}

export async function down(knex: Knex): Promise<void> {
  await dropAuditUpdateGuard(knex);
  try {
    // @migration-raw-exempt: trigger_drop
    await knex.raw(`DROP TRIGGER IF EXISTS ${AFTER_TRIGGER_NAME} ON audit_log`);
    // @migration-raw-exempt: function_drop
    await knex.raw(`DROP FUNCTION IF EXISTS ${AFTER_TRIGGER_FN}()`);

    // Restore the prior single BEFORE trigger behavior.
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

    // @migration-raw-exempt: trigger_drop
    await knex.raw(`DROP TRIGGER IF EXISTS ${BEFORE_TRIGGER_NAME} ON audit_log`);
    // @migration-raw-exempt: trigger_create
    await knex.raw(`
      CREATE TRIGGER ${BEFORE_TRIGGER_NAME}
        BEFORE INSERT ON audit_log
        FOR EACH ROW
        EXECUTE FUNCTION audit_log_hash_chain()
    `);
  } finally {
    await restoreAuditUpdateGuard(knex);
  }
}
