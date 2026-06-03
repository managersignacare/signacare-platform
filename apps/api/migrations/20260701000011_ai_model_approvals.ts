import { Knex } from 'knex';

/**
 * Audit Tier 4.4 (CRIT-G3 part 1) — scribe model-version audit.
 *
 * Creates `ai_model_approvals` — a vendor/clinic-global audit table
 * tracking which (model_name, model_digest) pairs are explicitly
 * approved for clinical use. The Tier 19 full model-registry
 * platform subsumes this, but CRIT-G3 requires the per-doc
 * model-version stamp landing NOW (v1.2.0). This table is the minimum
 * needed to let an admin record "yes, Ollama just shipped
 * qwen:14b@sha256:abc… and we've reviewed it."
 *
 * Schema:
 *   - id: uuid PK
 *   - clinic_id: nullable — null rows are vendor-global approvals
 *     (every clinic trusts them); non-null rows are clinic-scoped
 *     overrides.
 *   - model_name: e.g. 'qwen2.5:14b'
 *   - model_digest: sha256 from Ollama /api/show (includes 'sha256:' prefix)
 *   - approved_by_staff_id: FK staff — the admin who approved
 *   - approved_at: timestamptz
 *   - notes: free-text rationale
 *   - created_at: timestamptz
 *
 * No updated_at / no soft-delete — append-only audit per §G6.
 *
 * Index: (model_name, model_digest) — the per-interaction lookup
 * "is this pair approved?".
 *
 * RLS: per-clinic scoping only applies to clinic-non-null rows. Since
 * NULL clinic_id means vendor-global, the RLS predicate is permissive
 * for those. Expressed via `clinic_id IS NULL OR
 * clinic_id = current_setting('app.clinic_id')::uuid`.
 *
 * Reversible: down() drops the table + policy.
 *
 * 13-point audit: #5 Confidentiality (clinical-grade audit trail on AI
 * use), #7 Security (append-only), #8 DB (indexed + RLS + reversible).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ai_model_approvals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id')
      .nullable()
      .references('id').inTable('clinics').onDelete('CASCADE');
    t.string('model_name', 200).notNullable();
    t.string('model_digest', 100).notNullable();  // e.g. sha256:abcdef…
    t.uuid('approved_by_staff_id')
      .nullable()
      .references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('approved_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // §7.1 — every FK indexed + the per-interaction lookup key.
    t.index(['clinic_id']);
    t.index(['approved_by_staff_id']);
    t.index(['model_name', 'model_digest'], 'idx_ai_model_approvals_name_digest');
  });

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE ai_model_approvals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ai_model_approvals_tenant ON ai_model_approvals
      FOR ALL
      USING (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      )
      WITH CHECK (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_ai_model_approvals_tenant ON ai_model_approvals');
  await knex.schema.dropTableIfExists('ai_model_approvals');
}
