import { Knex } from 'knex';

/**
 * ARCH-S0-7 — signed clinical-note content integrity hash.
 *
 * Adds a deterministic SHA-256 hash over signed-note payload fields and
 * enforces immutability for signed content at the DB layer. This closes
 * the "signed note can be silently altered in DB" gap by making the hash
 * first-class and rejecting payload mutations once status='signed'.
 */

const TABLE = 'clinical_notes';
const HASH_COL = 'signed_content_hash';
const HASH_ALG_COL = 'signed_content_hash_alg';
const HASH_FN = 'clinical_note_signed_payload_hash';
const TRIGGER_FN = 'clinical_note_signed_hash_enforce';
const TRIGGER_NAME = 'trg_clinical_note_signed_hash_enforce';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) return;

  const hasHash = await knex.schema.hasColumn(TABLE, HASH_COL);
  if (!hasHash) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.string(HASH_COL, 64).nullable();
    });
  }

  const hasHashAlg = await knex.schema.hasColumn(TABLE, HASH_ALG_COL);
  if (!hasHashAlg) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.string(HASH_ALG_COL, 16).nullable();
    });
  }

  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${HASH_FN}(p_row clinical_notes)
    RETURNS text
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_payload jsonb;
    BEGIN
      v_payload := jsonb_build_object(
        'title', p_row.title,
        'note_type', p_row.note_type,
        'note_date_time', p_row.note_date_time,
        'content', p_row.content,
        'soap_subjective', p_row.soap_subjective,
        'soap_objective', p_row.soap_objective,
        'soap_assessment', p_row.soap_assessment,
        'soap_plan', p_row.soap_plan,
        'structured_fields', p_row.structured_fields,
        'template_id', p_row.template_id,
        'consent_id', p_row.consent_id
      );
      RETURN encode(digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
    END;
    $$;
  `);

  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE ${TABLE}
       SET ${HASH_COL} = ${HASH_FN}(${TABLE}),
           ${HASH_ALG_COL} = 'sha256'
     WHERE status = 'signed'
       AND (${HASH_COL} IS NULL OR ${HASH_ALG_COL} IS NULL);
  `);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${TRIGGER_FN}()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_new_hash text;
    BEGIN
      IF NEW.status = 'signed' THEN
        v_new_hash := ${HASH_FN}(NEW);
        NEW.${HASH_COL} := v_new_hash;
        NEW.${HASH_ALG_COL} := 'sha256';

        IF TG_OP = 'UPDATE' AND OLD.status = 'signed' THEN
          IF OLD.${HASH_COL} IS NOT NULL AND v_new_hash <> OLD.${HASH_COL} THEN
            RAISE EXCEPTION 'Signed clinical note payload is immutable once signed'
              USING ERRCODE = '23514';
          END IF;
        END IF;
      ELSE
        NEW.${HASH_COL} := NULL;
        NEW.${HASH_ALG_COL} := NULL;
      END IF;

      RETURN NEW;
    END;
    $$;
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${TABLE}`);
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER ${TRIGGER_NAME}
      BEFORE INSERT OR UPDATE ON ${TABLE}
      FOR EACH ROW
      EXECUTE FUNCTION ${TRIGGER_FN}();
  `);

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS clinical_notes_signed_hash_integrity`);
  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE ${TABLE}
      ADD CONSTRAINT clinical_notes_signed_hash_integrity
      CHECK (
        status <> 'signed' OR (${HASH_COL} IS NOT NULL AND ${HASH_ALG_COL} = 'sha256')
      );
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) return;

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS clinical_notes_signed_hash_integrity`);
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON ${TABLE}`);
  // @migration-raw-exempt: function_drop
  await knex.raw(`DROP FUNCTION IF EXISTS ${TRIGGER_FN}()`);
  // @migration-raw-exempt: function_drop
  await knex.raw(`DROP FUNCTION IF EXISTS ${HASH_FN}(clinical_notes)`);

  const hasHashAlg = await knex.schema.hasColumn(TABLE, HASH_ALG_COL);
  if (hasHashAlg) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.dropColumn(HASH_ALG_COL);
    });
  }
  const hasHash = await knex.schema.hasColumn(TABLE, HASH_COL);
  if (hasHash) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.dropColumn(HASH_COL);
    });
  }
}

