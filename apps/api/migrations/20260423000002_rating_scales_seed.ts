// apps/api/migrations/20260423000002_rating_scales_seed.ts
//
// USER-D.1 / BUG-USER-ITEM-8 — seed canonical rating-scale templates.
//
// Diagnostic: pre-migration `SELECT COUNT(*) FROM templates WHERE
// category = 'Rating Scales'` returned 0 per-clinic, causing the
// AssessmentsTab dropdown to render empty ("No rating scale templates
// available"). User item 8 reported "rating scales dropdown blank".
//
// Fix: seed 5 canonical psychiatric rating scales per clinic — PHQ-9,
// GAD-7, HAM-D, MADRS, YMRS. Each template has structured items so
// the scoring + per-item storage introduced in USER-D.2/D.5 can use
// them immediately.
//
// Idempotent: skips clinics that already have templates in this
// category (ON CONFLICT DO NOTHING would also work but a per-clinic
// SELECT-then-INSERT surface is clearer for this one-time seed).

import { Knex } from 'knex';

interface ScaleItem { key: string; prompt: string; min: number; max: number }

interface ScaleTemplate {
  name: string;
  description: string;
  items: ScaleItem[];
}

const SCALES: ScaleTemplate[] = [
  {
    name: 'PHQ-9',
    description: 'Patient Health Questionnaire-9 — depression severity (0-27). Score: 0-4 none/minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe, 20-27 severe.',
    items: [
      { key: 'anhedonia', prompt: 'Little interest or pleasure in doing things', min: 0, max: 3 },
      { key: 'depressed_mood', prompt: 'Feeling down, depressed, or hopeless', min: 0, max: 3 },
      { key: 'sleep', prompt: 'Trouble falling or staying asleep, or sleeping too much', min: 0, max: 3 },
      { key: 'fatigue', prompt: 'Feeling tired or having little energy', min: 0, max: 3 },
      { key: 'appetite', prompt: 'Poor appetite or overeating', min: 0, max: 3 },
      { key: 'self_worth', prompt: 'Feeling bad about yourself', min: 0, max: 3 },
      { key: 'concentration', prompt: 'Trouble concentrating on things', min: 0, max: 3 },
      { key: 'psychomotor', prompt: 'Moving or speaking so slowly / being so fidgety that others noticed', min: 0, max: 3 },
      { key: 'suicidal_ideation', prompt: 'Thoughts that you would be better off dead or of hurting yourself', min: 0, max: 3 },
    ],
  },
  {
    name: 'GAD-7',
    description: 'Generalised Anxiety Disorder-7 — anxiety severity (0-21). Score: 0-4 minimal, 5-9 mild, 10-14 moderate, 15-21 severe.',
    items: [
      { key: 'nervous', prompt: 'Feeling nervous, anxious, or on edge', min: 0, max: 3 },
      { key: 'worry_uncontrol', prompt: 'Not being able to stop or control worrying', min: 0, max: 3 },
      { key: 'worry_various', prompt: 'Worrying too much about different things', min: 0, max: 3 },
      { key: 'relax', prompt: 'Trouble relaxing', min: 0, max: 3 },
      { key: 'restless', prompt: 'Being so restless that it is hard to sit still', min: 0, max: 3 },
      { key: 'irritable', prompt: 'Becoming easily annoyed or irritable', min: 0, max: 3 },
      { key: 'afraid', prompt: 'Feeling afraid as if something awful might happen', min: 0, max: 3 },
    ],
  },
  {
    name: 'HAM-D',
    description: 'Hamilton Depression Rating Scale — 17-item (0-52). Score: 0-7 normal, 8-13 mild, 14-18 moderate, 19-22 severe, ≥23 very severe.',
    items: [
      { key: 'depressed_mood', prompt: 'Depressed mood', min: 0, max: 4 },
      { key: 'guilt', prompt: 'Feelings of guilt', min: 0, max: 4 },
      { key: 'suicide', prompt: 'Suicide', min: 0, max: 4 },
      { key: 'early_insomnia', prompt: 'Insomnia — early night', min: 0, max: 2 },
      { key: 'middle_insomnia', prompt: 'Insomnia — middle of night', min: 0, max: 2 },
      { key: 'late_insomnia', prompt: 'Insomnia — early morning', min: 0, max: 2 },
      { key: 'work', prompt: 'Work and activities', min: 0, max: 4 },
      { key: 'retardation', prompt: 'Retardation (slowness of thought, speech, movement)', min: 0, max: 4 },
      { key: 'agitation', prompt: 'Agitation', min: 0, max: 4 },
      { key: 'anxiety_psychic', prompt: 'Anxiety (psychic)', min: 0, max: 4 },
      { key: 'anxiety_somatic', prompt: 'Anxiety (somatic)', min: 0, max: 4 },
      { key: 'somatic_gi', prompt: 'Somatic symptoms (gastrointestinal)', min: 0, max: 2 },
      { key: 'somatic_general', prompt: 'Somatic symptoms (general)', min: 0, max: 2 },
      { key: 'sexual', prompt: 'Genital symptoms', min: 0, max: 2 },
      { key: 'hypochondriasis', prompt: 'Hypochondriasis', min: 0, max: 4 },
      { key: 'weight_loss', prompt: 'Loss of weight', min: 0, max: 2 },
      { key: 'insight', prompt: 'Insight', min: 0, max: 2 },
    ],
  },
  {
    name: 'MADRS',
    description: 'Montgomery-Åsberg Depression Rating Scale — 10-item (0-60). Score: 0-6 none, 7-19 mild, 20-34 moderate, ≥35 severe.',
    items: [
      { key: 'apparent_sadness', prompt: 'Apparent sadness', min: 0, max: 6 },
      { key: 'reported_sadness', prompt: 'Reported sadness', min: 0, max: 6 },
      { key: 'inner_tension', prompt: 'Inner tension', min: 0, max: 6 },
      { key: 'reduced_sleep', prompt: 'Reduced sleep', min: 0, max: 6 },
      { key: 'reduced_appetite', prompt: 'Reduced appetite', min: 0, max: 6 },
      { key: 'concentration', prompt: 'Concentration difficulties', min: 0, max: 6 },
      { key: 'lassitude', prompt: 'Lassitude', min: 0, max: 6 },
      { key: 'feelings', prompt: 'Inability to feel', min: 0, max: 6 },
      { key: 'pessimism', prompt: 'Pessimistic thoughts', min: 0, max: 6 },
      { key: 'suicidal', prompt: 'Suicidal thoughts', min: 0, max: 6 },
    ],
  },
  {
    name: 'YMRS',
    description: 'Young Mania Rating Scale — 11-item (0-60). Score: <12 remission, 12-20 mild, 21-25 moderate, >25 severe mania.',
    items: [
      { key: 'elevated_mood', prompt: 'Elevated mood', min: 0, max: 4 },
      { key: 'motor_activity', prompt: 'Increased motor activity / energy', min: 0, max: 4 },
      { key: 'sexual_interest', prompt: 'Sexual interest', min: 0, max: 4 },
      { key: 'sleep', prompt: 'Sleep', min: 0, max: 4 },
      { key: 'irritability', prompt: 'Irritability', min: 0, max: 8 },
      { key: 'speech', prompt: 'Speech (rate and amount)', min: 0, max: 8 },
      { key: 'language_disorder', prompt: 'Language / thought disorder', min: 0, max: 4 },
      { key: 'content', prompt: 'Content (of thought)', min: 0, max: 8 },
      { key: 'disruptive', prompt: 'Disruptive / aggressive behaviour', min: 0, max: 8 },
      { key: 'appearance', prompt: 'Appearance', min: 0, max: 4 },
      { key: 'insight', prompt: 'Insight', min: 0, max: 4 },
    ],
  },
];

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: introspection
  const clinicsResult = await knex.raw<{ rows: Array<{ id: string }> }>(
    `SELECT id FROM clinics WHERE deleted_at IS NULL OR deleted_at IS NULL`,
  );
  const clinicIds: string[] = clinicsResult.rows.map((r) => r.id);

  let seededRows = 0;
  let skippedClinics = 0;

  for (const clinicId of clinicIds) {
    // Skip clinics that already have rating-scale templates
    const existing = await knex('templates')
      .where({ clinic_id: clinicId, category: 'Rating Scales' })
      .whereNull('deleted_at')
      .count<{ count: string }>('id as count')
      .first();
    if (existing && parseInt(existing.count, 10) > 0) {
      skippedClinics++;
      continue;
    }

    const rows = SCALES.map((s, idx) => ({
      clinic_id: clinicId,
      name: s.name,
      type: 'rating_scale',
      description: s.description,
      category: 'Rating Scales',
      content: JSON.stringify(s.items),
      is_active: true,
      status: 'published',
      sort_order: idx,
      published_at: new Date(),
    }));
    await knex('templates').insert(rows);
    seededRows += rows.length;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[USER-D.1 seed] Rating Scales: ${seededRows} templates inserted across ${clinicIds.length - skippedClinics} clinics (${skippedClinics} clinics skipped — already had templates).`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // Reversibility: remove only the canonical names from the Rating
  // Scales category. Clinic-authored custom rating scales survive.
  await knex('templates')
    .where({ category: 'Rating Scales', type: 'rating_scale' })
    .whereIn('name', SCALES.map((s) => s.name))
    .delete();
}
