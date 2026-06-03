import type { Knex } from 'knex';

/**
 * S7.1 — Patient duplicate detection infrastructure.
 *
 * Closes the identity-management gap around duplicate patients. The existing
 * implementation (apps/api/src/features/patients/patientRepository.ts
 * findPotentialDuplicates) did a case-insensitive ILIKE on given_name +
 * family_name + exact date_of_birth. That misses:
 *
 *   - Nickname and variant spellings (Bob/Robert, Aleksandr/Alexander)
 *   - DOB off-by-one data entry errors
 *   - Deterministic matches on Medicare/IHI/DVA (encrypted — IVs are random
 *     per row so two identical Medicare numbers encrypt to different
 *     ciphertext, blocking a simple SELECT)
 *   - Phone number or address matches
 *
 * This migration adds:
 *
 * 1. Blind-index columns for Medicare / IHI / DVA. A blind index is an
 *    HMAC-SHA-256 of the normalised plaintext value, stored alongside the
 *    encrypted column. It lets the application do deterministic equality
 *    lookups ("does any patient in this clinic have Medicare X?") without
 *    ever decrypting the ciphertext. See RFC 2104 §2 for HMAC; the
 *    technique is described in Paragon's "Why encryption is hard" and is
 *    how Have-I-Been-Pwned stores email addresses at rest.
 *
 *    Columns added (each as text — 64 hex chars from HMAC-SHA-256):
 *      - medicare_number_lookup
 *      - ihi_number_lookup
 *      - dva_number_lookup
 *
 *    Partial unique indexes per clinic enforce "at most one active row
 *    in a clinic per Medicare/IHI/DVA" — the final safety net if the
 *    application layer forgets to dedupe. Partial on deleted_at IS NULL
 *    so soft-deleted rows don't block re-registration.
 *
 * 2. Trigram indexes on given_name + family_name for fuzzy matching via
 *    pg_trgm similarity() and % operator. Enables "Aleks" -> "Alexander"
 *    style matching that the current ILIKE cannot do.
 *
 * 3. Composite index on (clinic_id, date_of_birth) for the hot path
 *    "find patients born on this date in this clinic" query — used by
 *    the fuzzy matcher as an initial filter before trigram ranking.
 *
 * 4. `patient_merges` table recording every merge event: source row,
 *    destination row, reason, approver (superadmin required per the
 *    4-eyes rule), and a JSONB snapshot of the source at merge time
 *    for unwind. Append-only via GRANT (INSERT only to app_user).
 *
 * The blind-index columns are populated lazily — on every patient INSERT
 * or UPDATE the application will compute and write the HMAC. A one-off
 * backfill script (scripts/privacy/backfill-blind-indexes.ts) handles
 * existing rows.
 *
 * Standards:
 *   - Australian Privacy Act 1988 APP 10 (quality of personal information)
 *   - NSQHS Std 1 (correct patient identification)
 *   - HL7 Australia Healthcare Identifiers implementation guide
 *   - CLAUDE.md §1.3, §1.4, §6.3, §7.1, §7.2
 */
export async function up(knex: Knex): Promise<void> {
  // ── Ensure pg_trgm is available (no-op if already installed) ──────────────
  //
  // Knex wraps every migration in a transaction by default, and a failed
  // statement inside a Postgres transaction poisons the whole transaction
  // — a subsequent JS `.catch()` suppresses the rejection but does NOT
  // recover the transaction, so every later statement fails with 25P02
  // "current transaction is aborted". Wrapping the CREATE EXTENSION in a
  // PL/pgSQL DO block with an EXCEPTION handler contains the failure
  // inside the block so it never leaks into the outer transaction, even
  // when the current role lacks superuser privileges (dev environments).
  await knex.raw(`
    DO $$
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'pg_trgm not installed — trigram search will fall back to ILIKE';
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_trgm extension install skipped: %', SQLERRM;
    END $$;
  `);

  // ── Blind-index columns ───────────────────────────────────────────────────
  const hasMedicareLookup = await knex.schema.hasColumn('patients', 'medicare_number_lookup');
  if (!hasMedicareLookup) {
    await knex.schema.alterTable('patients', (t) => {
      t.text('medicare_number_lookup');
      t.text('ihi_number_lookup');
      t.text('dva_number_lookup');
    });
  }

  // Partial unique indexes — one active patient per clinic per identifier.
  // Partial WHERE clauses avoid blocking soft-deleted rows and avoid
  // over-constraining rows with NULL identifiers.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS patients_medicare_lookup_uniq
      ON patients (clinic_id, medicare_number_lookup)
      WHERE deleted_at IS NULL AND medicare_number_lookup IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS patients_ihi_lookup_uniq
      ON patients (clinic_id, ihi_number_lookup)
      WHERE deleted_at IS NULL AND ihi_number_lookup IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS patients_dva_lookup_uniq
      ON patients (clinic_id, dva_number_lookup)
      WHERE deleted_at IS NULL AND dva_number_lookup IS NOT NULL
  `);

  // ── Trigram indexes on name columns (fuzzy fallback) ─────────────────────
  const hasTrgm = await knex.raw(
    `SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`,
  );
  if ((hasTrgm.rows ?? []).length > 0) {
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS patients_given_name_trgm
         ON patients USING gin (given_name gin_trgm_ops)`,
    );
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS patients_family_name_trgm
         ON patients USING gin (family_name gin_trgm_ops)`,
    );
  }

  // ── Composite (clinic_id, date_of_birth) for the DOB-anchored fast path ──
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS patients_clinic_dob_idx
      ON patients (clinic_id, date_of_birth)
      WHERE deleted_at IS NULL
  `);

  // ── patient_merges audit table ────────────────────────────────────────────
  const hasMerges = await knex.schema.hasTable('patient_merges');
  if (!hasMerges) {
    await knex.schema.createTable('patient_merges', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      // source_patient_id is the row that was merged AWAY (soft-deleted post-merge)
      t.uuid('source_patient_id').notNullable().references('id').inTable('patients');
      // destination_patient_id is the surviving row
      t.uuid('destination_patient_id').notNullable().references('id').inTable('patients');
      t.uuid('merged_by').notNullable().references('id').inTable('staff');
      t.text('reason').notNullable();
      t.jsonb('source_snapshot').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id'], 'patient_merges_clinic_idx');
      t.index(['source_patient_id'], 'patient_merges_source_idx');
      t.index(['destination_patient_id'], 'patient_merges_destination_idx');
    });

    // Enforce reason length at DB level as defence-in-depth.
    await knex.raw(`
      ALTER TABLE patient_merges
        ADD CONSTRAINT patient_merges_reason_min_length
        CHECK (char_length(reason) >= 10)
    `);

    // Source and destination must be distinct — prevent silly bugs.
    await knex.raw(`
      ALTER TABLE patient_merges
        ADD CONSTRAINT patient_merges_distinct
        CHECK (source_patient_id <> destination_patient_id)
    `);

    // RLS — same tenant-isolation policy as every other clinic-scoped table.
    await knex.raw('ALTER TABLE patient_merges ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_patient_merges_tenant ON patient_merges
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);

    // Append-only: INSERT + SELECT only. No UPDATE, no DELETE — a merge is
    // immutable historical evidence. Unwind is a new row in the other direction.
    const hasAppUser = await knex.raw(`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`);
    if ((hasAppUser.rows ?? []).length > 0) {
      await knex.raw('GRANT SELECT, INSERT ON patient_merges TO app_user');
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS patient_merges CASCADE');
  await knex.raw('DROP INDEX IF EXISTS patients_clinic_dob_idx');
  await knex.raw('DROP INDEX IF EXISTS patients_family_name_trgm');
  await knex.raw('DROP INDEX IF EXISTS patients_given_name_trgm');
  await knex.raw('DROP INDEX IF EXISTS patients_dva_lookup_uniq');
  await knex.raw('DROP INDEX IF EXISTS patients_ihi_lookup_uniq');
  await knex.raw('DROP INDEX IF EXISTS patients_medicare_lookup_uniq');
  const hasCol = await knex.schema.hasColumn('patients', 'medicare_number_lookup');
  if (hasCol) {
    await knex.schema.alterTable('patients', (t) => {
      t.dropColumn('medicare_number_lookup');
      t.dropColumn('ihi_number_lookup');
      t.dropColumn('dva_number_lookup');
    });
  }
}
