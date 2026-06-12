/**
 * Backfill reference data for all existing clinics.
 * Seeds: template_categories, appointment_modes, templates, clinical_templates
 * Run: npx ts-node -r dotenv/config --project tsconfig.node.json src/seed-reference-data-backfill.ts
 */
import { dbAdmin as db } from './db/db';
import { randomUUID } from 'crypto';

const CATEGORIES = ['Clinical Notes', 'Rating Scales', 'Assessments', 'Letters', 'Reports', 'Messages', 'Certificates'];
const MODES = ['Initial', 'Follow-up', 'Assessment', 'Telehealth', 'Group', 'Clinical Review'];

const TEMPLATES = [
  { name: 'PHQ-9 (Patient Health Questionnaire)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Little interest or pleasure', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling down, depressed, or hopeless', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Trouble falling or staying asleep', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling tired or having little energy', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Poor appetite or overeating', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling bad about yourself', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Trouble concentrating', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Moving or speaking slowly / being fidgety', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Thoughts of self-harm', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
  ] },
  { name: 'GAD-7 (Generalised Anxiety Disorder)', category: 'Rating Scales', type: 'assessment', content: [
    { label: 'Feeling nervous, anxious, or on edge', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Not being able to stop worrying', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Worrying too much about different things', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Trouble relaxing', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Being so restless it is hard to sit still', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Becoming easily annoyed or irritable', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
    { label: 'Feeling afraid something awful might happen', fieldType: 'likert', options: ['Not at all','Several days','More than half the days','Nearly every day'], scores: [0,1,2,3] },
  ] },
  // K10, HoNOS, LSP-16 removed from Rating Scales seed — they are outcome measures
  // and are surfaced via the Outcome Measures tab (canonical SSoT: packages/shared/src/assessmentTaxonomy.ts)
  // BPRS/AIMS are intentionally not backfilled here. Complete clinician-rated
  // instrument definitions are managed by seed-rating-scales.ts; partial
  // placeholders create non-comparable clinical scores.
  { name: 'Management Plan', category: 'Management Plans', type: 'management_plan', content: [
    { label: 'Current Issues', fieldType: 'textarea' }, { label: 'Goals', fieldType: 'textarea' },
    { label: 'Interventions', fieldType: 'textarea' }, { label: 'Review Date', fieldType: 'date' },
  ] },
  { name: 'Safety Plan', category: 'Safety Plans', type: 'safety_plan', content: [
    { label: 'Warning signs', fieldType: 'textarea' }, { label: 'Coping strategies', fieldType: 'textarea' },
    { label: 'Reasons for living', fieldType: 'textarea' }, { label: 'People I can contact', fieldType: 'textarea' },
    { label: 'Emergency contacts', fieldType: 'textarea' },
  ] },
  { name: 'Relapse Prevention Plan', category: 'Management Plans', type: 'relapse_prevention', content: [
    { label: 'Early warning signs', fieldType: 'textarea' }, { label: 'Triggers', fieldType: 'textarea' },
    { label: 'Action plan', fieldType: 'textarea' },
  ] },
  { name: 'Discharge Summary', category: 'Letters', type: 'discharge_summary', content: [
    { label: 'Admission date', fieldType: 'date' }, { label: 'Discharge date', fieldType: 'date' },
    { label: 'Diagnosis', fieldType: 'textarea' }, { label: 'Treatment provided', fieldType: 'textarea' },
    { label: 'Follow-up plan', fieldType: 'textarea' },
  ] },
];

interface TemplateCategoryRow {
  id: string;
  name: string;
}

async function backfill() {
  const clinics = await db('clinics').select('id', 'name').orderBy('name');
  console.log(`\nBackfilling reference data for ${clinics.length} clinics...\n`);

  for (const clinic of clinics) {
    const cid = clinic.id;
    console.log(`── ${clinic.name} ──`);

    // 1. Template categories
    let catCount = 0;
    const allCats = [...CATEGORIES, 'Management Plans', 'Safety Plans'];
    for (let i = 0; i < allCats.length; i++) {
      const exists = await db('template_categories').where({ clinic_id: cid, name: allCats[i] }).first();
      if (!exists) {
        await db('template_categories').insert({ id: randomUUID(), clinic_id: cid, name: allCats[i], is_active: true, sort_order: i, created_at: new Date() });
        catCount++;
      }
    }
    console.log(`  ✓ template_categories: ${catCount} created`);

    // 2. Appointment modes
    let modeCount = 0;
    for (let i = 0; i < MODES.length; i++) {
      const exists = await db('appointment_modes').where({ clinic_id: cid, name: MODES[i] }).first();
      if (!exists) {
        await db('appointment_modes').insert({ id: randomUUID(), clinic_id: cid, name: MODES[i], is_active: true, sort_order: i, created_at: new Date(), updated_at: new Date() });
        modeCount++;
      }
    }
    console.log(`  ✓ appointment_modes: ${modeCount} created`);

    // 3. Templates (admin table)
    let tmplCount = 0;
    for (let i = 0; i < TEMPLATES.length; i++) {
      const t = TEMPLATES[i];
      const exists = await db('templates').where({ clinic_id: cid, name: t.name }).first();
      if (!exists) {
        await db('templates').insert({
          id: randomUUID(), clinic_id: cid, name: t.name, type: t.type, category: t.category,
          content: JSON.stringify(t.content), is_active: true, status: 'published', sort_order: i,
          published_at: new Date(), created_at: new Date(), updated_at: new Date(),
        });
        tmplCount++;
      }
    }
    console.log(`  ✓ templates: ${tmplCount} created`);

    // 4. Clinical templates (staff-settings table) with category_id FK
    const catRows = await db('template_categories')
      .where({ clinic_id: cid })
      .select('id', 'name') as TemplateCategoryRow[];
    const catMap = new Map(catRows.map((category) => [category.name, category.id]));
    let clinTmplCount = 0;
    for (let i = 0; i < TEMPLATES.length; i++) {
      const t = TEMPLATES[i];
      const exists = await db('clinical_templates').where({ clinic_id: cid, name: t.name }).first();
      if (!exists) {
        await db('clinical_templates').insert({
          id: randomUUID(), clinic_id: cid, category_id: catMap.get(t.category) ?? null,
          name: t.name, type: t.type, content: JSON.stringify(t.content),
          is_active: true, is_system: true, sort_order: i,
          created_at: new Date(), updated_at: new Date(),
        });
        clinTmplCount++;
      }
    }
    console.log(`  ✓ clinical_templates: ${clinTmplCount} created`);
  }

  console.log('\n✓ Backfill complete.\n');
  await db.destroy();
}

backfill().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
