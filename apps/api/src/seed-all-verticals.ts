/**
 * Comprehensive Demo Data — All Vertical Slices (v3)
 * Exact column names matched to database schema.
 * Run: npx ts-node -r dotenv/config --project tsconfig.node.json src/seed-all-verticals.ts
 */
import { db } from './db/db';
import { v4 as uuid } from 'uuid';

const CL = '11111111-1111-1111-1111-111111111111';
const now = new Date();
const ago = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const future = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const ds = (d: Date) => d.toISOString().split('T')[0];

type SeedInsertRow = Record<string, unknown>;
interface MedicationRefRow { id: string; patient_id: string }
interface EpisodeRefRow { id: string; patient_id: string }

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return null;
}

const S = { sarah:'30a05d60-f949-42ec-b0a8-066c51e35770', james:'dd2482b3-38f0-43cf-9531-f9709857b7df', emma:'17dd364b-f611-406f-8d93-d737d76f0ad6', michael:'9fae2bc2-4e69-400e-92a1-e0224a00c13f', lisa:'fae7a0e2-bcda-42fe-b59f-72cece04b438' };
const P = { marcus:'2764e3e4-d6ad-419a-a2f0-4ddece72708f', priya:'90a9f913-90b0-45c4-82fb-fb14ead93d4a', william:'1dcebfb8-4ac2-444b-8ee5-b582e754725d', jessica:'26e210b5-9193-464c-8171-dbad94584fad', thomas:'0e166801-c7e9-4e0f-80d0-113243c253dd', aisha:'d700f7a8-d8db-43c3-be07-6642327de7b3', daniel:'ccd06519-f5ba-4c1a-8df9-5c215044d709', sophie:'60b2c661-5e3b-4a33-aeb6-6bb93d5dd748', liam:'206da0e2-d380-4aef-a364-b6ccb4ed98b4', mei:'4e1b984d-26b4-4510-bccf-bb772b2c048d' };
void Object.values(P); void Object.values(S);

async function ins(t: string, rows: SeedInsertRow[]) {
  let ok = 0;
  for (const r of rows) {
    try {
      await db(t).insert(r);
      ok++;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message && !message.includes('duplicate') && !message.includes('unique')) {
        console.log(`  ! ${t}: ${message.substring(0, 100)}`);
      }
    }
  }
  console.log(`  ✓ ${t}: ${ok}/${rows.length}`);
}

async function seed() {
  console.log('\n═══ Seeding All Verticals ═══\n');

  // Get existing medication IDs for FK references
  const medRows = await db<MedicationRefRow>('patient_medications')
    .select('id', 'patient_id')
    .limit(20)
    .catch((): MedicationRefRow[] => []);
  const medFor = (pid: string) => medRows.find((m) => m.patient_id === pid)?.id ?? uuid();

  // Get existing episode IDs
  const epRows = await db<EpisodeRefRow>('episodes')
    .where('status', 'open')
    .select('id', 'patient_id')
    .catch((): EpisodeRefRow[] => []);
  const epFor = (pid: string) => epRows.find((e) => e.patient_id === pid)?.id;

  // ── 1. Pathology Orders ──
  console.log('1. Pathology');
  const po = [
    { patient_id: P.marcus, ordered_by_id: S.sarah, urgency: 'routine', order_date: ds(ago(5)), tests_requested: JSON.stringify([{name:'FBC'},{name:'UEC'},{name:'LFT'},{name:'TFT'},{name:'Lipids'}]), status: 'completed', fasting_required: true },
    { patient_id: P.aisha, ordered_by_id: S.sarah, urgency: 'urgent', order_date: ds(ago(2)), tests_requested: JSON.stringify([{name:'FBC (Clozapine monitoring)'},{name:'ANC'}]), status: 'completed', fasting_required: false },
    { patient_id: P.william, ordered_by_id: S.james, urgency: 'routine', order_date: ds(ago(4)), tests_requested: JSON.stringify([{name:'Lithium level'},{name:'UEC'},{name:'TFT'}]), status: 'completed', fasting_required: true },
    { patient_id: P.daniel, ordered_by_id: S.lisa, urgency: 'routine', order_date: ds(ago(7)), tests_requested: JSON.stringify([{name:'LFT'},{name:'GGT'}]), status: 'completed', fasting_required: false },
    { patient_id: P.priya, ordered_by_id: S.lisa, urgency: 'routine', order_date: ds(ago(1)), tests_requested: JSON.stringify([{name:'FBC'},{name:'HbA1c'},{name:'Lipids'}]), status: 'pending', fasting_required: true },
  ].map(o => ({ id: uuid(), clinic_id: CL, ...o, created_at: now, updated_at: now }));
  await ins('pathology_orders', po);

  await ins('pathology_results', [
    { patient_id: P.marcus, order_id: po[0].id, test_name: 'Haemoglobin', value: '142', unit: 'g/L', reference_range: '130-170', flag: 'normal', status: 'reviewed', result_date: ds(ago(3)), is_critical: false, flag_raised: false },
    { patient_id: P.marcus, order_id: po[0].id, test_name: 'Total Cholesterol', value: '5.8', unit: 'mmol/L', reference_range: '<5.5', flag: 'high', status: 'reviewed', result_date: ds(ago(3)), is_critical: false, flag_raised: true },
    { patient_id: P.marcus, order_id: po[0].id, test_name: 'TSH', value: '2.1', unit: 'mIU/L', reference_range: '0.5-4.0', flag: 'normal', status: 'reviewed', result_date: ds(ago(3)), is_critical: false, flag_raised: false },
    { patient_id: P.aisha, order_id: po[1].id, test_name: 'WCC', value: '5.2', unit: '×10⁹/L', reference_range: '4.0-11.0', flag: 'normal', status: 'reviewed', result_date: ds(ago(1)), is_critical: false, flag_raised: false },
    { patient_id: P.aisha, order_id: po[1].id, test_name: 'ANC', value: '3.1', unit: '×10⁹/L', reference_range: '>1.5', flag: 'normal', status: 'reviewed', result_date: ds(ago(1)), is_critical: false, flag_raised: false },
    { patient_id: P.william, order_id: po[2].id, test_name: 'Lithium Level', value: '0.9', unit: 'mmol/L', reference_range: '0.6-1.0', flag: 'normal', status: 'reviewed', result_date: ds(ago(2)), is_critical: false, flag_raised: false },
    { patient_id: P.william, order_id: po[2].id, test_name: 'Creatinine', value: '98', unit: 'µmol/L', reference_range: '60-110', flag: 'normal', status: 'reviewed', result_date: ds(ago(2)), is_critical: false, flag_raised: false },
    { patient_id: P.daniel, order_id: po[3].id, test_name: 'GGT', value: '78', unit: 'U/L', reference_range: '<60', flag: 'high', status: 'pending_review', result_date: ds(ago(5)), is_critical: false, flag_raised: true },
    { patient_id: P.daniel, order_id: po[3].id, test_name: 'ALT', value: '45', unit: 'U/L', reference_range: '<40', flag: 'high', status: 'pending_review', result_date: ds(ago(5)), is_critical: false, flag_raised: true },
  ].map(r => ({ id: uuid(), clinic_id: CL, ...r, created_at: now, updated_at: now })));

  // ── 2. LAI Schedules & Administrations ──
  console.log('2. LAI');
  const lais = [
    { patient_id: P.marcus, medication_id: medFor(P.marcus), prescribed_by_id: S.sarah, drug_name: 'Paliperidone Palmitate', dose: '150', dose_unit: 'mg', route: 'IM', interval_days: 28, start_date: ds(ago(180)), status: 'active', next_due_date: ds(future(5)), overdue_flag_raised: false },
    { patient_id: P.priya, medication_id: medFor(P.priya), prescribed_by_id: S.lisa, drug_name: 'Aripiprazole LAI (Abilify Maintena)', dose: '400', dose_unit: 'mg', route: 'IM', interval_days: 28, start_date: ds(ago(120)), status: 'active', next_due_date: ds(future(12)), overdue_flag_raised: false },
    { patient_id: P.liam, medication_id: medFor(P.liam), prescribed_by_id: S.sarah, drug_name: 'Zuclopenthixol Decanoate', dose: '200', dose_unit: 'mg', route: 'IM', interval_days: 14, start_date: ds(ago(90)), status: 'active', next_due_date: ds(future(0)), overdue_flag_raised: true },
  ].map(s => ({ id: uuid(), clinic_id: CL, ...s, created_at: now, updated_at: now }));
  await ins('lai_schedules', lais);

  await ins('lai_given', [
    { schedule_id: lais[0].id, patient_id: P.marcus, administered_by_id: S.sarah, given_date: ds(ago(23)), dose_given: '150mg IM left deltoid', outcome: 'given', site: 'Left deltoid', aims_due: false, aims_completed: false },
    { schedule_id: lais[0].id, patient_id: P.marcus, administered_by_id: S.sarah, given_date: ds(ago(51)), dose_given: '150mg IM right gluteal', outcome: 'given', site: 'Right gluteal', aims_due: true, aims_completed: true },
    { schedule_id: lais[1].id, patient_id: P.priya, administered_by_id: S.lisa, given_date: ds(ago(16)), dose_given: '400mg IM left gluteal', outcome: 'given', site: 'Left gluteal', aims_due: false, aims_completed: false },
    { schedule_id: lais[2].id, patient_id: P.liam, administered_by_id: S.sarah, given_date: ds(ago(14)), dose_given: '200mg IM right gluteal', outcome: 'given', site: 'Right gluteal', aims_due: false, aims_completed: false },
  ].map(a => ({ id: uuid(), clinic_id: CL, ...a, created_at: now, updated_at: now })));

  // ── 3. Clozapine ──
  console.log('3. Clozapine');
  const clozReg = [{ id: uuid(), clinic_id: CL, patient_id: P.aisha, registered_by_id: S.sarah, registration_date: ds(ago(120)), status: 'active', monitoring_frequency: 'monthly', current_dose: '300mg', target_dose: '400mg', next_blood_due: ds(future(3)), overdue_flag_raised: false, created_at: now, updated_at: now }];
  await ins('clozapine_registrations', clozReg);

  await ins('clozapine_blood_results', [
    { registration_id: clozReg[0].id, patient_id: P.aisha, recorded_by_id: S.sarah, result_date: ds(ago(1)), wcc: 5.2, anc: 3.1, anc_status: 'green', flag_raised: false, forced_review: false },
    { registration_id: clozReg[0].id, patient_id: P.aisha, recorded_by_id: S.sarah, result_date: ds(ago(30)), wcc: 4.8, anc: 2.9, anc_status: 'green', flag_raised: false, forced_review: false },
    { registration_id: clozReg[0].id, patient_id: P.aisha, recorded_by_id: S.sarah, result_date: ds(ago(60)), wcc: 5.5, anc: 3.4, anc_status: 'green', flag_raised: false, forced_review: false },
  ].map(r => ({ id: uuid(), clinic_id: CL, ...r, created_at: now, updated_at: now })));

  // ── 4. Correspondence ──
  console.log('4. Correspondence');
  await ins('correspondence', [
    { id: uuid(), clinic_id: CL, patient_id: P.marcus, author_staff_id: S.sarah, letter_number: 'LTR-2026-001', letter_type: 'outbound', status: 'sent', recipient_name: 'Dr Smith', recipient_organisation: 'Collins St Medical', subject: 'Re: Marcus Johnson — Medication Review', body_html: '<p>Dear Dr Smith,</p><p>Olanzapine increased to 20mg with good tolerability. Metabolic monitoring attached.</p>', letter_date: ds(ago(5)), send_method: 'email', is_confidential: false, sent_at: ago(5), created_at: ago(5), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.jessica, author_staff_id: S.emma, letter_number: 'LTR-2026-002', letter_type: 'outbound', status: 'draft', recipient_name: 'NDIA', recipient_organisation: 'National Disability Insurance Agency', subject: 'NDIS Functional Capacity Report — Jessica Nguyen', body_html: '<p>To Whom It May Concern,</p><p>This report outlines functional impact of major depressive disorder.</p>', letter_date: ds(ago(2)), send_method: 'post', is_confidential: false, created_at: ago(2), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.william, author_staff_id: S.james, letter_number: 'LTR-2026-003', letter_type: 'outbound', status: 'draft', recipient_name: 'Mental Health Tribunal', recipient_organisation: 'MHT Victoria', subject: 'Clinical Report — Treatment Order Hearing', body_html: '<p>Dear Tribunal Members,</p><p>This clinical report is for the Treatment Order hearing for William Chen.</p>', letter_date: ds(ago(1)), send_method: 'secure_upload', is_confidential: true, created_at: ago(1), updated_at: now },
  ]);

  // ── 5. Waitlist ──
  console.log('5. Waitlist');
  await ins('waitlist_entries', [
    { id: uuid(), clinic_id: CL, patient_id: P.sophie, priority: 'routine', status: 'waiting', date_added: ds(ago(21)), reason: 'Anxiety and depression — GP referral', created_at: ago(21), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.mei, priority: 'urgent', status: 'waiting', date_added: ds(ago(3)), reason: 'Acute psychosis — ED referral', created_at: ago(3), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.liam, priority: 'semi-urgent', status: 'waiting', date_added: ds(ago(10)), reason: 'Bipolar instability — private psychiatrist referral', created_at: ago(10), updated_at: now },
  ]);

  // ── 6. Advance Directives ──
  console.log('6. Advance Directives');
  await ins('advance_directives', [
    { id: uuid(), clinic_id: CL, patient_id: P.marcus, type: 'advance_statement', status: 'active', valid_from: ds(ago(90)), content: JSON.stringify({ notes: 'If unwell, prefer olanzapine. No ECT. Contact mother first. Music therapy helpful.' }), created_at: ago(90), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.jessica, type: 'nominated_person', status: 'active', valid_from: ds(ago(60)), content: JSON.stringify({ notes: 'Nominated person: Margaret Nguyen (mother), Ph 0412 XXX XXX.' }), created_at: ago(60), updated_at: now },
  ]);

  // ── 7. Beds (clean and re-insert) ──
  console.log('7. Beds');
  await db('beds').whereIn('bed_label', ['IPU-01','IPU-02','IPU-03','IPU-04','HDU-01','HDU-02']).del().catch(() => {});
  await ins('beds', [
    { id: uuid(), clinic_id: CL, ward: 'IPU', bed_label: 'IPU-01', status: 'occupied', current_patient_id: P.william, current_episode_id: epFor(P.william) },
    { id: uuid(), clinic_id: CL, ward: 'IPU', bed_label: 'IPU-02', status: 'occupied', current_patient_id: P.aisha, current_episode_id: epFor(P.aisha) },
    { id: uuid(), clinic_id: CL, ward: 'IPU', bed_label: 'IPU-03', status: 'available' },
    { id: uuid(), clinic_id: CL, ward: 'IPU', bed_label: 'IPU-04', status: 'available' },
    { id: uuid(), clinic_id: CL, ward: 'HDU', bed_label: 'HDU-01', status: 'available' },
    { id: uuid(), clinic_id: CL, ward: 'HDU', bed_label: 'HDU-02', status: 'maintenance' },
  ]);

  // ── 8. Bed Movements ──
  console.log('8. Bed Movements');
  const bedW = await db('beds').where({ bed_label: 'IPU-01', clinic_id: CL }).first().then(r => r?.id).catch(() => uuid());
  const bedA = await db('beds').where({ bed_label: 'IPU-02', clinic_id: CL }).first().then(r => r?.id).catch(() => uuid());
  await ins('bed_movements', [
    { id: uuid(), clinic_id: CL, bed_id: bedW, patient_id: P.william, episode_id: epFor(P.william), movement_type: 'admission', movement_datetime: ago(14) },
    { id: uuid(), clinic_id: CL, bed_id: bedA, patient_id: P.aisha, episode_id: epFor(P.aisha), movement_type: 'admission', movement_datetime: ago(30) },
  ]);

  // ── 9. Group Sessions + Attendees ──
  console.log('9. Group Sessions');
  const gs = [
    { id: uuid(), clinic_id: CL, name: 'Hearing Voices Group', facilitator_id: S.emma, session_date: ds(ago(3)), duration_mins: 60, group_type: 'therapeutic', max_attendees: 10, topic: 'Coping with auditory hallucinations', status: 'completed', created_at: ago(3), updated_at: ago(3) },
    { id: uuid(), clinic_id: CL, name: 'DBT Skills Group', facilitator_id: S.lisa, session_date: ds(ago(1)), duration_mins: 90, group_type: 'therapeutic', max_attendees: 8, topic: 'Distress tolerance — TIPP skills', status: 'completed', created_at: ago(1), updated_at: ago(1) },
    { id: uuid(), clinic_id: CL, name: 'Relapse Prevention', facilitator_id: S.lisa, session_date: ds(future(2)), duration_mins: 60, group_type: 'psychoeducation', max_attendees: 12, topic: 'Identifying early warning signs', status: 'scheduled', created_at: now, updated_at: now },
  ];
  await ins('group_sessions', gs);

  await ins('group_session_attendees', [
    { id: uuid(), session_id: gs[0].id, patient_id: P.thomas, attendance: 'present', notes: 'First session, engaged well.' },
    { id: uuid(), session_id: gs[0].id, patient_id: P.marcus, attendance: 'present', notes: 'Shared coping strategies.' },
    { id: uuid(), session_id: gs[0].id, patient_id: P.priya, attendance: 'absent', notes: 'DNA — unwell.' },
    { id: uuid(), session_id: gs[1].id, patient_id: P.jessica, attendance: 'present', notes: 'Practised TIPP effectively.' },
    { id: uuid(), session_id: gs[1].id, patient_id: P.daniel, attendance: 'present' },
  ].map(a => ({ ...a, created_at: now })));

  // ── 10. Restrictive Interventions ──
  console.log('10. Restrictive Interventions');
  await ins('restrictive_interventions', [
    { id: uuid(), clinic_id: CL, patient_id: P.william, episode_id: epFor(P.william), intervention_type: 'seclusion', start_time: ago(2), end_time: new Date(ago(2).getTime() + 2 * 3600000), duration_mins: 120, reason: 'Severe agitation, verbal aggression toward staff, not redirectable.', authorised_by_id: S.james, created_at: ago(2), updated_at: ago(2) },
    { id: uuid(), clinic_id: CL, patient_id: P.william, episode_id: epFor(P.william), intervention_type: 'physical_restraint', start_time: ago(5), end_time: new Date(ago(5).getTime() + 15 * 60000), duration_mins: 15, reason: 'Attempted to assault another patient. Brief restraint to administer IM sedation.', authorised_by_id: S.james, created_at: ago(5), updated_at: ago(5) },
  ]);

  // ── 11. Carers ──
  console.log('11. Carers');
  await ins('carers', [
    { id: uuid(), clinic_id: CL, patient_id: P.marcus, carer_name: 'Margaret Johnson', relationship: 'Mother', phone: '0412 345 678', email: 'margaret.j@email.com', is_primary: true, status: 'active', created_at: ago(200), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.jessica, carer_name: 'Margaret Nguyen', relationship: 'Mother', phone: '0412 567 890', is_primary: true, status: 'active', created_at: ago(100), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.william, carer_name: 'David Chen', relationship: 'Father', phone: '0423 456 789', is_primary: true, status: 'active', created_at: ago(60), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.daniel, carer_name: 'Kate O\'Connor', relationship: 'Partner', phone: '0445 678 901', is_primary: true, status: 'active', created_at: ago(180), updated_at: now },
  ]);

  // ── 12. Treatment Pathways ──
  console.log('12. Treatment Pathways');
  await ins('treatment_pathways', [
    { id: uuid(), clinic_id: CL, patient_id: P.jessica, clinician_id: S.lisa, pathway_type: 'dbt', pathway_name: 'Dialectical Behaviour Therapy', total_sessions: 20, completed_sessions: 8, status: 'active', start_date: ds(ago(60)), created_at: ago(60), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.daniel, clinician_id: S.lisa, pathway_type: 'pe', pathway_name: 'Prolonged Exposure Therapy', total_sessions: 12, completed_sessions: 9, status: 'active', start_date: ds(ago(90)), created_at: ago(90), updated_at: now },
    { id: uuid(), clinic_id: CL, patient_id: P.marcus, clinician_id: S.emma, pathway_type: 'cbt', pathway_name: 'CBT for Psychosis', total_sessions: 16, completed_sessions: 4, status: 'active', start_date: ds(ago(30)), created_at: ago(30), updated_at: now },
  ]);

  console.log('\n═══ Done ═══\n');
  await db.destroy();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
