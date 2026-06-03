import { Knex } from 'knex';

/**
 * Audit Tier 1.3 (CRIT-H4 / GAP-B4) — close the psychiatric confidentiality
 * leak on `clinical_formulations`.
 *
 * Before this migration: the 5P diagnostic formulation table was readable by
 * every member of CLINICAL_ROLES (includes psychologists registered as
 * `role='clinician' + specialty='psychology'`). Psychiatric reasoning,
 * differential diagnoses and treatment implications could leak to clinicians
 * outside the psychiatry specialty even when the author intended the
 * formulation to be private to themselves.
 *
 * Structural fix (this migration + companion code change in
 * psychiatristFeatureRoutes.ts):
 *
 *   (a) Add `shared_with_clinicians boolean NOT NULL DEFAULT false` — author
 *       can opt-in to share a formulation with the wider clinical team.
 *   (b) Add index `(clinic_id, shared_with_clinicians)` to keep the
 *       author-or-shared read filter fast on large clinics.
 *   (c) GET query side: `WHERE author_id = auth.staffId OR
 *       shared_with_clinicians = true` (enforced in route handler).
 *   (d) Service-layer `requireSpecialty(auth, ['psychiatry'])` on every
 *       formulation handler (excludes non-psychiatrists regardless of
 *       shared_with_clinicians — non-psychiatry clinicians never see
 *       formulations).
 *
 * Existing `shared_with_patient` column is parallel and unchanged — it
 * controls patient-facing visibility in the portal, not clinician-team
 * visibility.
 *
 * Reversible: down() drops the index and the column. No data loss because
 * the column is additive and the default is false.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinical_formulations', (t) => {
    t.boolean('shared_with_clinicians').notNullable().defaultTo(false);
    t.index(['clinic_id', 'shared_with_clinicians']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinical_formulations', (t) => {
    t.dropIndex(['clinic_id', 'shared_with_clinicians']);
    t.dropColumn('shared_with_clinicians');
  });
}
