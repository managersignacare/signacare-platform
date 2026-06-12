import type { Knex } from 'knex';

const TABLE = 'patient_app_registration_requests';
const ENCRYPTED_PHI_PATTERN =
  '^([^:]{1,64}:)?[A-Za-z0-9+/]{20,}={0,2}:[A-Za-z0-9+/]{20,}={0,2}:[A-Za-z0-9+/]{4,}={0,2}$';
const JSON_PHI_ENCODING = 'phi-aes-256-gcm-json-v1';
const JSON_PHI_ALLOWED_KEYS = ['encoding', 'ciphertext'] as const;
const STRING_PHI_COLUMNS = [
  'given_name',
  'family_name',
  'preferred_name',
  'date_of_birth',
  'gender',
  'phone_mobile',
  'email',
  'reason',
] as const;
const JSON_PHI_COLUMNS = ['address', 'next_of_kin', 'gp', 'support_person'] as const;

/**
 * BUG-240 forward fix.
 *
 * Early staging/local runs may already have applied an older registration
 * migration shape before the review-chain hardening widened encrypted PHI
 * ciphertext columns and added the generated `lock_version` row contract.
 * This migration reconciles table shape without editing an already-applied
 * migration. If an old staging table contains plaintext-like registration
 * PHI, it fails closed so operators must quarantine/encrypt those rows before
 * continuing.
 */
async function assertNoPlaintextRegistrationPhi(knex: Knex): Promise<void> {
  const existingStringColumns: string[] = [];
  for (const column of STRING_PHI_COLUMNS) {
    if (await knex.schema.hasColumn(TABLE, column)) existingStringColumns.push(column);
  }

  const existingJsonColumns: string[] = [];
  for (const column of JSON_PHI_COLUMNS) {
    if (await knex.schema.hasColumn(TABLE, column)) existingJsonColumns.push(column);
  }

  if (existingStringColumns.length === 0 && existingJsonColumns.length === 0) return;

  const query = knex(TABLE).where((qb) => {
    for (const column of existingStringColumns) {
      qb.orWhereRaw('?? IS NOT NULL AND ?? <> ? AND ?? !~ ?', [
        column,
        column,
        '',
        column,
        ENCRYPTED_PHI_PATTERN,
      ]);
    }
    for (const column of existingJsonColumns) {
      qb.orWhereRaw(`
        ?? IS NOT NULL
        AND ?? <> ?::jsonb
        AND NOT (
          jsonb_typeof(??) = ?
          AND jsonb_exists(??, ?)
          AND jsonb_exists(??, ?)
          AND ?? ->> ? = ?
          AND ?? ->> ? ~ ?
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_object_keys(??) AS phi_key(key_name)
            WHERE phi_key.key_name NOT IN (?, ?)
          )
        )
      `, [
        column,
        column,
        '{}',
        column,
        'object',
        column,
        'encoding',
        column,
        'ciphertext',
        column,
        'encoding',
        JSON_PHI_ENCODING,
        column,
        'ciphertext',
        ENCRYPTED_PHI_PATTERN,
        column,
        ...JSON_PHI_ALLOWED_KEYS,
      ]);
    }
  });

  const row = await query.count<{ count: string }>('* as count').first();
  const plaintextLikeRows = Number(row?.count ?? 0);
  if (plaintextLikeRows > 0) {
    throw new Error(
      `${TABLE} contains ${plaintextLikeRows} plaintext-like PHI row(s); quarantine or encrypt them before applying BUG-240 forward fix`,
    );
  }
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TABLE))) return;

  await assertNoPlaintextRegistrationPhi(knex);

  await knex.schema.alterTable(TABLE, (t) => {
    t.string('given_name', 512).notNullable().alter();
    t.string('family_name', 512).notNullable().alter();
    t.string('preferred_name', 512).nullable().alter();
    t.string('date_of_birth', 512).notNullable().alter();
    t.string('gender', 512).nullable().alter();
    t.string('phone_mobile', 512).notNullable().alter();
    t.string('email', 512).nullable().alter();
  });

  if (!(await knex.schema.hasColumn(TABLE, 'lock_version'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.integer('lock_version').notNullable().defaultTo(0);
    });
  }

  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_app_reg_requests_pending_dedupe
      ON patient_app_registration_requests (clinic_id, dedupe_key)
      WHERE deleted_at IS NULL AND status = 'pending';
  `);
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TABLE))) return;

  // @migration-raw-exempt: index_partial
  await knex.raw(`
    DROP INDEX IF EXISTS uq_patient_app_reg_requests_pending_dedupe;
  `);
}
