/**
 * Enterprise Rating Scale Seed
 *
 * Seeds the canonical built-in psychiatric rating scales into BOTH:
 * - templates (used by /api/v1/templates and assessment surfaces)
 * - clinical_templates (used by staff-settings template surfaces)
 */

import { randomUUID } from 'crypto';
import { dbAdmin as db, appPoolRaw, clearPoolMonitor } from './db/db';
import {
  BUILTIN_RATING_SCALE_DEFINITIONS,
  STALE_LEGACY_SCALE_NAMES,
} from './features/assessments/builtinAssessmentDefinitions';

async function ensureRatingScaleCategory(clinicId: string): Promise<string> {
  const existing = await db('template_categories')
    .where({ clinic_id: clinicId, name: 'Rating Scales' })
    .first('id');
  if (existing?.id) return String(existing.id);

  const id = randomUUID();
  await db('template_categories').insert({
    id,
    clinic_id: clinicId,
    name: 'Rating Scales',
    is_active: true,
    sort_order: 1,
    created_at: new Date(),
  });
  return id;
}

async function upsertTemplatesForClinic(clinicId: string, ratingCategoryId: string): Promise<void> {
  const now = new Date();
  for (let index = 0; index < BUILTIN_RATING_SCALE_DEFINITIONS.length; index += 1) {
    const scale = BUILTIN_RATING_SCALE_DEFINITIONS[index]!;
    const contentJson = JSON.stringify(scale.content);

    const existingTemplate = await db('templates')
      .where({ clinic_id: clinicId, name: scale.name })
      .first('id');

    if (existingTemplate?.id) {
      await db('templates').where({ id: existingTemplate.id }).update({
        type: scale.type,
        category: scale.category,
        description: scale.description,
        content: contentJson,
        is_active: true,
        status: 'published',
        sort_order: index,
        deleted_at: null,
        retired_at: null,
        published_at: now,
        updated_at: now,
      });
    } else {
      await db('templates').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: scale.name,
        type: scale.type,
        category: scale.category,
        description: scale.description,
        content: contentJson,
        is_active: true,
        status: 'published',
        sort_order: index,
        created_by_id: null,
        published_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    const existingClinicalTemplate = await db('clinical_templates')
      .where({ clinic_id: clinicId, name: scale.name })
      .first('id');

    if (existingClinicalTemplate?.id) {
      await db('clinical_templates').where({ id: existingClinicalTemplate.id }).update({
        category_id: ratingCategoryId,
        type: scale.type,
        description: scale.description,
        content: contentJson,
        is_active: true,
        is_system: true,
        sort_order: index,
        updated_at: now,
      });
    } else {
      await db('clinical_templates').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        category_id: ratingCategoryId,
        name: scale.name,
        type: scale.type,
        description: scale.description,
        content: contentJson,
        is_active: true,
        is_system: true,
        sort_order: index,
        created_by_id: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  await db('templates')
    .where({ clinic_id: clinicId, category: 'Rating Scales', type: 'assessment' })
    .whereIn('name', STALE_LEGACY_SCALE_NAMES)
    .update({ is_active: false, updated_at: now });

  await db('clinical_templates')
    .where({ clinic_id: clinicId, type: 'assessment' })
    .whereIn('name', STALE_LEGACY_SCALE_NAMES)
    .update({ is_active: false, updated_at: now });
}

async function run(): Promise<void> {
  const clinics = await db('clinics')
    .where({ is_active: true })
    .whereNull('deleted_at')
    .select('id', 'name')
    .orderBy('name', 'asc');

  console.log(`Seeding enterprise rating scales for ${clinics.length} clinics...`);
  for (const clinic of clinics) {
    const categoryId = await ensureRatingScaleCategory(clinic.id);
    await upsertTemplatesForClinic(clinic.id, categoryId);
    console.log(`  ✓ ${clinic.name}: ${BUILTIN_RATING_SCALE_DEFINITIONS.length} rating scales upserted`);
  }

  console.log('Enterprise rating scale seeding complete.');
}

run()
  .then(async () => {
    clearPoolMonitor();
    await db.destroy();
    await appPoolRaw.destroy();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    clearPoolMonitor();
    await db.destroy();
    await appPoolRaw.destroy();
    process.exit(1);
  });
