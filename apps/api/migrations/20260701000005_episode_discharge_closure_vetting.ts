import { Knex } from 'knex';

/**
 * Phase R follow-up (2026-04-18) — episodeRoutes has the discharge-summary
 * and close-with-vetting workflows since Phase 0. Both write columns that
 * were never added to the R2 baseline:
 *
 *   Discharge vetting flow (save-discharge-summary, send-for-vetting, sign):
 *     - discharge_summary_content
 *     - discharge_vetting_status   (draft | pending_review | signed)
 *     - discharge_vetted_by_id
 *     - discharge_vetted_at
 *     - discharge_signature
 *
 *   Closure vetting flow (close-with-vetting, sign-closure):
 *     - closure_vetting_status     (draft | pending_review | signed)
 *     - closure_vetted_by_id
 *     - closure_vetted_at
 *     - closure_signature
 *
 * `@code-columns-exempt` annotations on 4+ UPDATE sites claimed "baseline
 * is the fix". It wasn't. Every discharge save and close-with-vetting call
 * silently failed (trapped by a try/catch in some paths; 500'd in others).
 * The EpisodesTab UI in apps/web wires `POST /episodes/:id/discharge-summary/submit`
 * and `POST /episodes/:id/close-with-vetting` directly — both live.
 *
 * Existing signature-related columns on `episodes` (discharge_signature_data,
 * discharge_signed_by_id, discharge_signed_at) cover a DIFFERENT concept
 * (electronic signature on the discharge document itself). The vetting
 * columns track consultant review + sign-off on the content. Both remain.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('episodes', (t) => {
    t.text('discharge_summary_content').nullable();
    t.string('discharge_vetting_status', 40).nullable();
    t.uuid('discharge_vetted_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('discharge_vetted_at', { useTz: true }).nullable();
    t.text('discharge_signature').nullable();

    t.string('closure_vetting_status', 40).nullable();
    t.uuid('closure_vetted_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('closure_vetted_at', { useTz: true }).nullable();
    t.text('closure_signature').nullable();

    t.index(['clinic_id', 'discharge_vetting_status']);
    t.index(['clinic_id', 'closure_vetting_status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('episodes', (t) => {
    t.dropIndex(['clinic_id', 'closure_vetting_status']);
    t.dropIndex(['clinic_id', 'discharge_vetting_status']);
    t.dropColumn('closure_signature');
    t.dropColumn('closure_vetted_at');
    t.dropColumn('closure_vetted_by_id');
    t.dropColumn('closure_vetting_status');
    t.dropColumn('discharge_signature');
    t.dropColumn('discharge_vetted_at');
    t.dropColumn('discharge_vetted_by_id');
    t.dropColumn('discharge_vetting_status');
    t.dropColumn('discharge_summary_content');
  });
}
