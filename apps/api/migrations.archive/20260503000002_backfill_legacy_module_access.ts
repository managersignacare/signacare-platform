/**
 * Second-wave backfill for staff_module_access.
 *
 * The first wave (20260503000001_backfill_staff_module_access.ts)
 * only seeded grants for three new module keys — medical-scribe,
 * ai, ai-agent — because those were the only modules the new
 * moduleAccessMiddleware was gating at the time.
 *
 * This migration extends the backfill to cover the full legacy
 * module-key set (advance_directives, appointments, audit, beds,
 * billing, carers, clinical_notes, clozapine, correspondence, ect,
 * episodes, escalations, group_therapy, lai, legal_orders,
 * medications, messages, nursing_assessments, outcomes, pathology,
 * patients, prescriptions, referrals, reports, risk_assessments,
 * safety_plans, settings, tasks, templates, tms, voice) plus the
 * two newest additions the first wave predates (imports,
 * patient-allocations) so the admin matrix in Org Settings has a
 * complete editable surface for every clinic.
 *
 * Policy:
 *
 *   - Every active clinician / admin / superadmin in the clinic
 *     gets `write` on every legacy + new module key they don't
 *     already have a row for.
 *   - Existing rows are NEVER touched — onConflict().ignore() so
 *     a pre-seeded custom grant (including any 'read' / 'full' /
 *     explicit 'none' row) wins over the migration default.
 *   - Idempotent — safe to re-run on any clinic that has partial
 *     coverage.
 *   - Same role-filter as the first wave (clinician / admin /
 *     superadmin). Receptionist / manager / referral_coordinator /
 *     readonly get nothing by default; a clinic admin extends that
 *     via the matrix UI.
 *
 * Enforcement note: these legacy module keys are MANAGEMENT-ONLY
 * as of this migration — the middleware doesn't read them at
 * request time. They exist so the admin matrix can surface the
 * full access intent for a staff member, and so a follow-up
 * commit can start gating the corresponding routes without
 * locking anyone out. See docs/fix-registry.md SPEC-MOD-LEGACY1
 * for the authoritative list of what is currently enforced.
 */
import type { Knex } from 'knex';

const LEGACY_MODULE_KEYS = [
  'advance_directives',
  'appointments',
  'audit',
  'beds',
  'billing',
  'carers',
  'clinical_notes',
  'clozapine',
  'correspondence',
  'ect',
  'episodes',
  'escalations',
  'group_therapy',
  'lai',
  'legal_orders',
  'medications',
  'messages',
  'nursing_assessments',
  'outcomes',
  'pathology',
  'patients',
  'prescriptions',
  'referrals',
  'reports',
  'risk_assessments',
  'safety_plans',
  'settings',
  'tasks',
  'templates',
  'tms',
  'voice',
  // New-style kebab-case keys the first-wave backfill was written
  // before these features landed.
  'imports',
  'patient-allocations',
] as const;

const GRANT_ROLES = ['clinician', 'admin', 'superadmin'] as const;

export async function up(knex: Knex): Promise<void> {
  const staffRows = await knex('staff')
    .whereIn('role', GRANT_ROLES as unknown as string[])
    .andWhere({ is_active: true })
    .whereNull('deleted_at')
    .select('id', 'clinic_id') as Array<{ id: string; clinic_id: string }>;

  if (staffRows.length === 0) return;

  const grants: Array<{
    staff_id: string;
    clinic_id: string;
    module: string;
    access_level: string;
    can_delegate_this: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];
  const now = new Date();
  for (const row of staffRows) {
    for (const mod of LEGACY_MODULE_KEYS) {
      grants.push({
        staff_id: row.id,
        clinic_id: row.clinic_id,
        module: mod,
        access_level: 'write',
        can_delegate_this: false,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // Batch insert to keep round-trips bounded. 500 rows per batch
  // comfortably fits under the default parameter-count ceiling.
  // The unique index is (staff_id, module) so onConflict matches
  // the live shape and lets us preserve any hand-edited rows.
  const BATCH = 500;
  for (let i = 0; i < grants.length; i += BATCH) {
    const chunk = grants.slice(i, i + BATCH);
    await knex('staff_module_access')
      .insert(chunk)
      .onConflict(['staff_id', 'module'])
      .ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  // Rolling back removes the `write / non-delegated` grants we
  // inserted. Hand-edited rows (any other access_level or
  // can_delegate_this=true) are preserved.
  await knex('staff_module_access')
    .whereIn('module', LEGACY_MODULE_KEYS as unknown as string[])
    .andWhere({ access_level: 'write', can_delegate_this: false })
    .delete();
}
