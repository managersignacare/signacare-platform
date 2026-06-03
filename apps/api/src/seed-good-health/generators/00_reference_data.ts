import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import {
  AU_DISCIPLINES,
  AU_CLINICAL_ROLES,
  AU_REFERRAL_SOURCES,
  AU_INVESTIGATION_TYPES,
  AU_ALERT_TYPES,
  AU_LEGAL_ORDER_TYPES,
  AU_APPOINTMENT_TYPES,
  AU_TEMPLATE_CATEGORIES,
} from '@signacare/shared';
import type { GeneratorResult } from './01_clinics';

// Phase R follow-up — reference data seed step. Runs FIRST (step 00)
// because downstream generators (patients, episodes, alerts, LAI schedules,
// legal orders, etc.) reference the category slugs by name.
//
// Behavior:
//   - Iterates every currently-active clinic (not just clinics the seed
//     creates) so existing Good Health tenants receive the reference data
//     too. Pre-R2 Good Health databases had zero rows in most of these
//     tables because `provisioningService.ts` only ran the seed on
//     first tenant create — existing clinics never got touched.
//
//   - Deterministic uuidv5 ids derived from
//     `${clinicId}:${category-slug}:${row.slug}` so reseeds upsert in
//     place. A rename of `row.slug` moves the id — treat slugs as stable.
//
//   - Per CLAUDE.md §no-abstraction-shortcuts: each category has its own
//     inline block with the full SELECT-then-UPDATE-or-INSERT loop inline.
//     No shared helper — each block self-documents which table it targets
//     AND the exact columns it writes, so the "does column X get written
//     to table Y?" question is answered by a single-screen read per block.
//     Guard D.1 (check-query-builder-columns) cross-checks every column
//     name here against the schema snapshot at commit time.
//
//   - `legal_order_types` is tenant-GLOBAL (no clinic_id column in
//     baseline). The block for legal_order_types is outside the per-clinic
//     loop. Every other category is per-tenant.

const NAMESPACE = '1f3c9a4e-0000-5000-8000-000000000001';

function refId(clinicId: string, categorySlug: string, rowSlug: string): string {
  return uuidv5(`${clinicId}:${categorySlug}:${rowSlug}`, NAMESPACE);
}

function globalRefId(categorySlug: string, rowSlug: string): string {
  return uuidv5(`global:${categorySlug}:${rowSlug}`, NAMESPACE);
}

interface Clinic {
  readonly id: string;
}

interface RunReferenceDataStepOptions {
  clinicIds?: readonly string[];
}

export async function runReferenceDataStep(
  knex: Knex,
  options?: RunReferenceDataStepOptions,
): Promise<GeneratorResult> {
  let clinicQuery = knex<Clinic>('clinics')
    .select('id')
    .where('is_active', true);

  if (options?.clinicIds && options.clinicIds.length > 0) {
    clinicQuery = clinicQuery.whereIn('id', options.clinicIds);
  }

  const clinics = await clinicQuery;

  let totalInserted = 0;
  let totalUpdated = 0;

  for (const clinic of clinics) {
    const cid = clinic.id;
    const now = new Date();

    // ── professional_disciplines ────────────────────────────────────────
    for (const r of AU_DISCIPLINES) {
      const row = {
        id: refId(cid, 'disciplines', r.slug),
        clinic_id: cid,
        name: r.displayName,
        is_active: true,
        sort_order: r.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const existingByNaturalKey = await knex('professional_disciplines')
        .where({ clinic_id: row.clinic_id, name: row.name })
        .first('id');
      const existingById =
        existingByNaturalKey ?? (await knex('professional_disciplines').where({ id: row.id }).first('id'));
      if (existingById) {
        await knex('professional_disciplines').where({ id: existingById.id }).update({
          clinic_id: row.clinic_id,
          name: row.name,
          is_active: row.is_active,
          sort_order: row.sort_order,
          updated_at: row.updated_at,
        });
        totalUpdated++;
      } else {
        await knex('professional_disciplines').insert(row);
        totalInserted++;
      }
    }

    // ── clinical_roles ───────────────────────────────────────────────────
    for (const r of AU_CLINICAL_ROLES) {
      const row = {
        id: refId(cid, 'clinical-roles', r.slug),
        clinic_id: cid,
        name: r.displayName,
        is_active: true,
        sort_order: r.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const existingByNaturalKey = await knex('clinical_roles')
        .where({ clinic_id: row.clinic_id, name: row.name })
        .first('id');
      const existingById = existingByNaturalKey ?? (await knex('clinical_roles').where({ id: row.id }).first('id'));
      if (existingById) {
        await knex('clinical_roles').where({ id: existingById.id }).update({
          clinic_id: row.clinic_id,
          name: row.name,
          is_active: row.is_active,
          sort_order: row.sort_order,
          updated_at: row.updated_at,
        });
        totalUpdated++;
      } else {
        await knex('clinical_roles').insert(row);
        totalInserted++;
      }
    }

    // ── referral_sources — carries metadata.category (internal/external) ─
    for (const r of AU_REFERRAL_SOURCES) {
      const row = {
        id: refId(cid, 'referral-sources', r.slug),
        clinic_id: cid,
        category: (r.metadata.category as 'internal' | 'external') ?? 'external',
        name: r.displayName,
        is_active: true,
        sort_order: r.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const existingByNaturalKey = await knex('referral_sources')
        .where({ clinic_id: row.clinic_id, category: row.category, name: row.name })
        .first('id');
      const existingById =
        existingByNaturalKey ?? (await knex('referral_sources').where({ id: row.id }).first('id'));
      if (existingById) {
        await knex('referral_sources').where({ id: existingById.id }).update({
          clinic_id: row.clinic_id,
          category: row.category,
          name: row.name,
          is_active: row.is_active,
          sort_order: row.sort_order,
          updated_at: row.updated_at,
        });
        totalUpdated++;
      } else {
        await knex('referral_sources').insert(row);
        totalInserted++;
      }
    }

    // ── investigation_types ─────────────────────────────────────────────
    for (const r of AU_INVESTIGATION_TYPES) {
      const row = {
        id: refId(cid, 'investigation-types', r.slug),
        clinic_id: cid,
        name: r.displayName,
        is_active: true,
        sort_order: r.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const existingByNaturalKey = await knex('investigation_types')
        .where({ clinic_id: row.clinic_id, name: row.name })
        .first('id');
      const existingById =
        existingByNaturalKey ?? (await knex('investigation_types').where({ id: row.id }).first('id'));
      if (existingById) {
        await knex('investigation_types').where({ id: existingById.id }).update({
          clinic_id: row.clinic_id,
          name: row.name,
          is_active: row.is_active,
          sort_order: row.sort_order,
          updated_at: row.updated_at,
        });
        totalUpdated++;
      } else {
        await knex('investigation_types').insert(row);
        totalInserted++;
      }
    }

    // ── alert_types — extra severity/color/plan_template cols from metadata ─
    for (const r of AU_ALERT_TYPES) {
      const row = {
        id: refId(cid, 'alert-types', r.slug),
        clinic_id: cid,
        name: r.displayName,
        severity: (r.metadata.severity as string | undefined) ?? 'medium',
        color: (r.metadata.color as string | undefined) ?? null,
        plan_template: (r.metadata.planTemplate as string | undefined) ?? null,
        is_active: true,
        sort_order: r.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const existingByNaturalKey = await knex('alert_types')
        .where({ clinic_id: row.clinic_id, name: row.name })
        .first('id');
      const existingById = existingByNaturalKey ?? (await knex('alert_types').where({ id: row.id }).first('id'));
      if (existingById) {
        await knex('alert_types').where({ id: existingById.id }).update({
          clinic_id: row.clinic_id,
          name: row.name,
          severity: row.severity,
          color: row.color,
          plan_template: row.plan_template,
          is_active: row.is_active,
          sort_order: row.sort_order,
          updated_at: row.updated_at,
        });
        totalUpdated++;
      } else {
        await knex('alert_types').insert(row);
        totalInserted++;
      }
    }

    // ── appointment_modes ───────────────────────────────────────────────
    for (const r of AU_APPOINTMENT_TYPES) {
      const row = {
        id: refId(cid, 'appointment-modes', r.slug),
        clinic_id: cid,
        name: r.displayName,
        is_active: true,
        sort_order: r.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const existingByNaturalKey = await knex('appointment_modes')
        .where({ clinic_id: row.clinic_id, name: row.name })
        .first('id');
      const existingById =
        existingByNaturalKey ?? (await knex('appointment_modes').where({ id: row.id }).first('id'));
      if (existingById) {
        await knex('appointment_modes').where({ id: existingById.id }).update({
          clinic_id: row.clinic_id,
          name: row.name,
          is_active: row.is_active,
          sort_order: row.sort_order,
          updated_at: row.updated_at,
        });
        totalUpdated++;
      } else {
        await knex('appointment_modes').insert(row);
        totalInserted++;
      }
    }

    // ── template_categories ─────────────────────────────────────────────
    for (const r of AU_TEMPLATE_CATEGORIES) {
      const row = {
        id: refId(cid, 'template-categories', r.slug),
        clinic_id: cid,
        name: r.displayName,
        is_active: true,
        sort_order: r.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const existingByNaturalKey = await knex('template_categories')
        .where({ clinic_id: row.clinic_id, name: row.name })
        .first('id');
      const existingById =
        existingByNaturalKey ?? (await knex('template_categories').where({ id: row.id }).first('id'));
      if (existingById) {
        await knex('template_categories').where({ id: existingById.id }).update({
          clinic_id: row.clinic_id,
          name: row.name,
          is_active: row.is_active,
          sort_order: row.sort_order,
          updated_at: row.updated_at,
        });
        totalUpdated++;
      } else {
        await knex('template_categories').insert(row);
        totalInserted++;
      }
    }
  }

  // ── legal_order_types (GLOBAL — no clinic_id) ─────────────────────────
  const nowGlobal = new Date();
  for (const r of AU_LEGAL_ORDER_TYPES) {
    const row = {
      id: globalRefId('legal-order-types', r.slug),
      code: (r.metadata.code as string | undefined) ?? r.slug.toUpperCase(),
      name: r.displayName,
      jurisdiction: (r.metadata.jurisdiction as string | undefined) ?? 'NATIONAL',
      max_duration_days: (r.metadata.maxDurationDays as number | null | undefined) ?? null,
      requires_tribunal: (r.metadata.requiresTribunal as boolean | undefined) ?? false,
      is_active: true,
      created_at: nowGlobal,
      updated_at: nowGlobal,
    };
    const existingByNaturalKey = await knex('legal_order_types')
      .where({ code: row.code, jurisdiction: row.jurisdiction })
      .first('id');
    const existingById = existingByNaturalKey ?? (await knex('legal_order_types').where({ id: row.id }).first('id'));
    if (existingById) {
      await knex('legal_order_types').where({ id: existingById.id }).update({
        code: row.code,
        name: row.name,
        jurisdiction: row.jurisdiction,
        max_duration_days: row.max_duration_days,
        requires_tribunal: row.requires_tribunal,
        is_active: row.is_active,
        updated_at: row.updated_at,
      });
      totalUpdated++;
    } else {
      await knex('legal_order_types').insert(row);
      totalInserted++;
    }
  }

  return { inserted: totalInserted, updated: totalUpdated };
}
