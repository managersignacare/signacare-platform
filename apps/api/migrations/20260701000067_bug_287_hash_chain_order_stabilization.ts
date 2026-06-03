import type { Knex } from 'knex';

/**
 * BUG-287 hardening follow-up:
 * - Add deterministic `chain_ordinal` ordering for audit hash-chain evaluation.
 * - Re-seal existing rows to the new ordering contract.
 * - Switch append trigger predecessor lookup to indexed scope+ordinal lookup.
 *
 * Why:
 * - Prior chain validation used (created_at, id) ordering while append-time
 *   linking used latest-tail lookup. Bulk multi-row writes with identical
 *   timestamps can diverge under that model and are expensive to append
 *   because predecessor lookup had no stable ordering index.
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

async function resealChainByOrdering(
  knex: Knex,
  orderedExpr: string,
  hashedExpr: string,
  chainOrdinalSelectExpr: string,
): Promise<void> {
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
          a.created_at,
          ${chainOrdinalSelectExpr} AS chain_ordinal,
          b.marker_signature::text AS marker_signature,
          audit_log_hash_chain_state_agg(
            b.marker_signature::text,
            (to_jsonb(a) - ARRAY['prev_hash', 'row_hash'])
          ) OVER (
            PARTITION BY COALESCE(a.clinic_id::text, '${SYSTEM_SCOPE}')
            ORDER BY ${orderedExpr}
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
              ORDER BY ${hashedExpr}
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

async function createChainTriggerFunctionWithOrdinalLookup(knex: Knex): Promise<void> {
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
      NEW.row_hash := encode(digest(convert_to(v_prev_hash || '|' || v_payload::text, 'UTF8'), 'sha256'), 'hex');

      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql
  `);
}

async function createLegacyChainTriggerFunction(knex: Knex): Promise<void> {
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
  `);
}

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: function_create
  await knex.raw(`CREATE SEQUENCE IF NOT EXISTS ${CHAIN_ORDINAL_SEQUENCE} AS bigint`);

  const hasChainOrdinal = await knex.schema.hasColumn('audit_log', 'chain_ordinal');
  if (!hasChainOrdinal) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.bigInteger('chain_ordinal').nullable();
    });
  }

  await knex.schema.alterTable('audit_log', (t) => {
    t.bigInteger('chain_ordinal')
      .defaultTo(knex.raw(`nextval('${CHAIN_ORDINAL_SEQUENCE}')`))
      .alter();
  });

  let updateGuardLifted = false;
  try {
    updateGuardLifted = await dropAuditMutationGuardForBackfill(knex);

    // Deterministic global ordinal for existing rows.
    // @migration-raw-exempt: data_backfill_update
    await knex.raw(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (ORDER BY created_at, id)::bigint AS ordinal_value
        FROM audit_log
      )
      UPDATE audit_log a
         SET chain_ordinal = r.ordinal_value
        FROM ranked r
       WHERE a.id = r.id
         AND (a.chain_ordinal IS NULL OR a.chain_ordinal IS DISTINCT FROM r.ordinal_value)
    `);

    // @migration-raw-exempt: data_backfill_update
    await knex.raw(`
      SELECT setval(
        '${CHAIN_ORDINAL_SEQUENCE}',
        GREATEST(COALESCE((SELECT MAX(chain_ordinal) FROM audit_log), 1), 1),
        COALESCE((SELECT MAX(chain_ordinal) FROM audit_log), 0) > 0
      )
    `);

    await resealChainByOrdering(knex, 'a.chain_ordinal', 'chain_ordinal', 'a.chain_ordinal');
  } finally {
    if (updateGuardLifted) {
      await restoreAuditMutationGuardAfterBackfill(knex);
    }
  }

  await knex.schema.alterTable('audit_log', (t) => {
    t.bigInteger('chain_ordinal').notNullable().alter();
  });

  // @migration-raw-exempt: index_functional
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_chain_ordinal_unique
      ON audit_log (chain_ordinal)
  `);

  // @migration-raw-exempt: index_functional
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_chain_scope_ordinal_desc
      ON audit_log ((COALESCE(clinic_id::text, '${SYSTEM_SCOPE}')), chain_ordinal DESC)
  `);

  await createChainTriggerFunctionWithOrdinalLookup(knex);

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
  // Revert to the previous hash-chain trigger semantics.
  await createLegacyChainTriggerFunction(knex);

  let updateGuardLifted = false;
  const hasChainOrdinal = await knex.schema.hasColumn('audit_log', 'chain_ordinal');
  if (hasChainOrdinal) {
    try {
      updateGuardLifted = await dropAuditMutationGuardForBackfill(knex);

      // @migration-raw-exempt: index_functional
      await knex.raw('DROP INDEX IF EXISTS idx_audit_log_chain_scope_ordinal_desc');
      // @migration-raw-exempt: index_functional
      await knex.raw('DROP INDEX IF EXISTS idx_audit_log_chain_ordinal_unique');

      // Remove ordinal before reseal so payload hashing mirrors legacy schema.
      await knex.schema.alterTable('audit_log', (t) => {
        t.bigInteger('chain_ordinal').defaultTo(null).alter();
      });
      await knex.schema.alterTable('audit_log', (t) => {
        t.dropColumn('chain_ordinal');
      });

      await resealChainByOrdering(
        knex,
        'a.created_at, a.id',
        'created_at, id',
        'NULL::bigint',
      );
    } finally {
      if (updateGuardLifted) {
        await restoreAuditMutationGuardAfterBackfill(knex);
      }
    }
  }

  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
    AS $$
    BEGIN
      INSERT INTO audit_log (id, clinic_id, user_id, action, table_name, record_id, old_data, new_data, created_at)
      VALUES (
        gen_random_uuid(),
        COALESCE(current_setting('app.clinic_id', true)::uuid, NULL),
        COALESCE(current_setting('app.user_id', true)::uuid, NULL),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        now()
      );
      RETURN COALESCE(NEW, OLD);
    EXCEPTION WHEN OTHERS THEN
      RETURN COALESCE(NEW, OLD);
    END;
    $$
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_audit_hash_chain ON audit_log');
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_audit_hash_chain
      BEFORE INSERT ON audit_log
      FOR EACH ROW
      EXECUTE FUNCTION audit_log_hash_chain()
  `);

  // @migration-raw-exempt: function_drop
  await knex.raw(`DROP SEQUENCE IF EXISTS ${CHAIN_ORDINAL_SEQUENCE}`);
}
