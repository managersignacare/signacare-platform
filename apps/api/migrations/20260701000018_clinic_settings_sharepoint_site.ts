import { Knex } from 'knex';

/**
 * Audit Tier 7.5 (MED-I4) — per-clinic Sharepoint site.
 *
 * Multi-tenant deployments where each clinic has its own Sharepoint
 * tenant / site were forced to share the single env-var
 * O365_SHAREPOINT_SITE (defaulted to 'root'). Adding
 * `clinic_settings.sharepoint_site_id` lets each clinic admin pick
 * their own site; the uploadToSharePoint helper reads this value
 * before falling back to the env-var default.
 *
 * Nullable — `null` means "use the platform default from O365_SHAREPOINT_SITE".
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.string('sharepoint_site_id', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('sharepoint_site_id');
  });
}
