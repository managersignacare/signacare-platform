/**
 * Comprehensive Test Data Seed
 * Run: npx ts-node -r dotenv/config src/seed-test-data.ts
 */
import { db } from './db/db';
import { v4 as uuid } from 'uuid';

const CLINIC = '11111111-1111-1111-1111-111111111111';

// Staff IDs from existing data
const STAFF = {
  sarah: '30a05d60-f949-42ec-b0a8-066c51e35770',
  james: 'dd2482b3-38f0-43cf-9531-f9709857b7df',
  emma: '17dd364b-f611-406f-8d93-d737d76f0ad6',
  michael: '9fae2bc2-4e69-400e-92a1-e0224a00c13f',
  lisa: 'fae7a0e2-bcda-42fe-b59f-72cece04b438',
};

// Patient IDs
const PAT = {
  marcus: '2764e3e4-d6ad-419a-a2f0-4ddece72708f',
  priya: '90a9f913-90b0-45c4-82fb-fb14ead93d4a',
  william: '1dcebfb8-4ac2-444b-8ee5-b582e754725d',
  jessica: '26e210b5-9193-464c-8171-dbad94584fad',
  thomas: '0e166801-c7e9-4e0f-80d0-113243c253dd',
  aisha: 'd700f7a8-d8db-43c3-be07-6642327de7b3',
  daniel: 'ccd06519-f5ba-4c1a-8df9-5c215044d709',
  sophie: '60b2c661-5e3b-4a33-aeb6-6bb93d5dd748',
  liam: '206da0e2-d380-4aef-a364-b6ccb4ed98b4',
  mei: '4e1b984d-26b4-4510-bccf-bb772b2c048d',
};

interface SeedEpisode {
  id: string;
  clinic_id: string;
  patient_id: string;
  primary_clinician_id: string;
  episode_number: string;
  episode_type: string;
  status: string;
  stream: string;
  team: string;
  presenting_problem: string;
  primary_diagnosis: string;
  icd10_code: string;
  start_date: string;
  created_at: Date;
  updated_at: Date;
}

interface MedicationSeedOptions {
  generic?: string;
  lai?: boolean;
  cloz?: boolean;
  s8?: boolean;
  laiFreq?: string;
  date?: string;
  prescriber?: string;
}

interface SeedMedication {
  id: string;
  clinic_id: string;
  patient_id: string;
  medication_name: string;
  generic_name: string | null;
  dose: string;
  frequency: string;
  route: string;
  status: string;
  is_lai: boolean;
  is_clozapine: boolean;
  is_s8: boolean;
  lai_frequency: string | null;
  prescribed_at: string;
  prescriber: string;
  created_at: Date;
  updated_at: Date;
}

interface SeedClinicalNote {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string;
  author_id: string;
  note_category: string;
  source_type: string;
  content_html: string;
  is_signed: boolean;
  is_draft: boolean;
  signed_by_id: string | null;
  signed_at: Date | null;
  note_date: string;
  created_at: Date;
  updated_at: Date;
}

interface SeedAlert {
  id: string;
  patient_id: string;
  clinic_id: string;
  alert_type_id: string;
  entered_by_id: string;
  title: string;
  notes: string;
  management_plan: string;
  severity: string;
  is_active: boolean;
  show_flag: boolean;
  created_at: Date;
  updated_at: Date;
}

interface SeedTreatmentPlan {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string;
  author_id: string;
  status: string;
  plan_date: string;
  review_date: string;
  is_signed: boolean;
  signed_by_id: string;
  signed_at: Date;
  goals: string;
  interventions: string;
  risk_management: string;
  medication_plan: string;
  support_services: string;
  created_at: Date;
  updated_at: Date;
}

interface SeedLegalOrder {
  id: string;
  patient_id: string;
  clinic_id: string;
  order_type_id: string;
  entered_by_id: string;
  order_number: string;
  start_date: string;
  end_date: string;
  review_date: string;
  next_application_date?: string;
  status: string;
  notes: string;
  created_at: Date;
  updated_at: Date;
}

interface SeedAppointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  staff_id: string;
  appointment_type: string;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  location: string;
  notes: string;
  created_at: Date;
  updated_at: Date;
}

function requireLookupId(map: Record<string, string>, key: string, mapName: string): string {
  const id = map[key];
  if (!id) {
    throw new Error(`Missing ${mapName} lookup for "${key}"`);
  }
  return id;
}

async function seed() {
  console.log('Seeding comprehensive test data...');

  // ============ EPISODES ============
  const episodes: SeedEpisode[] = [];
  const ep = (patientId: string, type: string, team: string, dx: string, icd: string, start: string, status = 'open', clinician = STAFF.sarah) => {
    const id = uuid();
    episodes.push({ id, clinic_id: CLINIC, patient_id: patientId, primary_clinician_id: clinician, episode_number: `EP-${episodes.length + 1}`, episode_type: type, status, stream: 'Adult', team, presenting_problem: dx, primary_diagnosis: dx, icd10_code: icd, start_date: start, created_at: new Date(), updated_at: new Date() });
    return id;
  };

  const epMarcus = ep(PAT.marcus, 'community', 'CCT1', 'Paranoid Schizophrenia', 'F20.0', '2025-06-15');
  const epPriya = ep(PAT.priya, 'community', 'CCT1', 'Schizoaffective Disorder — Depressive Type', 'F25.1', '2025-09-01', 'open', STAFF.lisa);
  const epWilliam = ep(PAT.william, 'inpatient', 'IPU', 'Bipolar I Disorder — Current Manic Episode with Psychosis', 'F31.2', '2026-02-10', 'open', STAFF.james);
  const epJessica = ep(PAT.jessica, 'community', 'CCT2', 'Major Depressive Disorder — Recurrent, Severe with Psychotic Features', 'F33.3', '2025-04-20', 'open', STAFF.emma);
  const epThomas = ep(PAT.thomas, 'community', 'ACIS', 'First Episode Psychosis', 'F23', '2026-01-05', 'open', STAFF.michael);
  const epAisha = ep(PAT.aisha, 'inpatient', 'IPU', 'Treatment-Resistant Schizophrenia', 'F20.5', '2025-11-10', 'open', STAFF.sarah);
  const epDaniel = ep(PAT.daniel, 'community', 'CCT1', 'PTSD with Comorbid Alcohol Use Disorder', 'F43.1', '2025-07-22', 'open', STAFF.lisa);
  ep(PAT.sophie, 'community', 'PARC', 'Borderline Personality Disorder', 'F60.3', '2026-01-15', 'open', STAFF.emma);
  ep(PAT.liam, 'community', 'CCT2', 'Generalised Anxiety Disorder with Panic', 'F41.1', '2025-12-01', 'open', STAFF.james);
  ep(PAT.mei, 'inpatient', 'IPU', 'Brief Psychotic Disorder', 'F23.0', '2026-03-01', 'open', STAFF.michael);

  // Closed episodes
  ep(PAT.marcus, 'inpatient', 'IPU', 'Acute Psychotic Episode', 'F23', '2024-11-01', 'closed', STAFF.james);
  ep(PAT.jessica, 'inpatient', 'IPU', 'Suicidal Crisis', 'F32.3', '2024-08-15', 'closed', STAFF.sarah);

  await db('episodes').insert(episodes).onConflict('id').ignore();
  console.log(`  ✓ ${episodes.length} episodes`);

  // ============ MEDICATIONS ============
  const meds: SeedMedication[] = [];
  const med = (pid: string, name: string, dose: string, freq: string, route = 'oral', status = 'active', opts: MedicationSeedOptions = {}) => {
    meds.push({ id: uuid(), clinic_id: CLINIC, patient_id: pid, medication_name: name, generic_name: opts.generic ?? null, dose, frequency: freq, route, status, is_lai: opts.lai ?? false, is_clozapine: opts.cloz ?? false, is_s8: opts.s8 ?? false, lai_frequency: opts.laiFreq ?? null, prescribed_at: opts.date ?? '2026-01-15', prescriber: opts.prescriber ?? 'Dr Sarah Chen', created_at: new Date(), updated_at: new Date() });
  };

  // Marcus — paranoid schizophrenia
  med(PAT.marcus, 'Paliperidone Palmitate 150mg', '150mg', '4-weekly (monthly)', 'im', 'active', { lai: true, laiFreq: '4-weekly', generic: 'paliperidone' });
  med(PAT.marcus, 'Olanzapine 10mg', '10mg', 'Nocte', 'oral', 'active', { generic: 'olanzapine' });
  med(PAT.marcus, 'Risperidone 4mg', '4mg', 'BD (twice daily)', 'oral', 'ceased', { generic: 'risperidone', date: '2025-01-10' });
  med(PAT.marcus, 'Benztropine 2mg', '2mg', 'BD (twice daily)', 'oral', 'active', { generic: 'benztropine' });

  // Priya — schizoaffective
  med(PAT.priya, 'Aripiprazole 400mg LAI', '400mg', '4-weekly (monthly)', 'im', 'active', { lai: true, laiFreq: '4-weekly', generic: 'aripiprazole' });
  med(PAT.priya, 'Sertraline 200mg', '200mg', 'Mane', 'oral', 'active', { generic: 'sertraline' });
  med(PAT.priya, 'Sodium Valproate 1000mg', '1000mg', 'BD (twice daily)', 'oral', 'active', { generic: 'sodium valproate' });
  med(PAT.priya, 'Melatonin 2mg', '2mg', 'Nocte', 'oral', 'active', { generic: 'melatonin' });

  // William — bipolar mania
  med(PAT.william, 'Lithium Carbonate 900mg', '900mg', 'Nocte', 'oral', 'active', { generic: 'lithium', s8: false });
  med(PAT.william, 'Olanzapine 20mg', '20mg', 'Nocte', 'oral', 'tapering', { generic: 'olanzapine' });
  med(PAT.william, 'Quetiapine 400mg', '400mg', 'Nocte', 'oral', 'ceased', { generic: 'quetiapine', date: '2025-12-01' });
  med(PAT.william, 'Lorazepam 1mg', '1mg', 'PRN', 'oral', 'active', { generic: 'lorazepam', s8: true });

  // Aisha — treatment-resistant schizophrenia (clozapine)
  med(PAT.aisha, 'Clozapine 450mg', '450mg', 'Nocte', 'oral', 'active', { cloz: true, generic: 'clozapine' });
  med(PAT.aisha, 'Metformin 500mg', '500mg', 'BD (twice daily)', 'oral', 'active', { generic: 'metformin' });
  med(PAT.aisha, 'Movicol Sachets', '1 sachet', 'BD (twice daily)', 'oral', 'active');

  // Thomas — FEP
  med(PAT.thomas, 'Risperidone 3mg', '3mg', 'Nocte', 'oral', 'active', { generic: 'risperidone' });
  med(PAT.thomas, 'Benztropine 1mg', '1mg', 'BD (twice daily)', 'oral', 'active', { generic: 'benztropine' });

  // Jessica — severe depression
  med(PAT.jessica, 'Venlafaxine 300mg', '300mg', 'Mane', 'oral', 'active', { generic: 'venlafaxine' });
  med(PAT.jessica, 'Quetiapine 50mg', '50mg', 'Nocte', 'oral', 'active', { generic: 'quetiapine' });
  med(PAT.jessica, 'Mirtazapine 30mg', '30mg', 'Nocte', 'oral', 'ceased', { generic: 'mirtazapine', date: '2025-10-01' });

  // Daniel — PTSD
  med(PAT.daniel, 'Prazosin 5mg', '5mg', 'Nocte', 'oral', 'active', { generic: 'prazosin' });
  med(PAT.daniel, 'Sertraline 150mg', '150mg', 'Mane', 'oral', 'active', { generic: 'sertraline' });
  med(PAT.daniel, 'Diazepam 5mg', '5mg', 'PRN', 'oral', 'active', { generic: 'diazepam', s8: true });

  // Sophie — BPD
  med(PAT.sophie, 'Lamotrigine 200mg', '200mg', 'Once daily', 'oral', 'active', { generic: 'lamotrigine' });

  // Liam — GAD
  med(PAT.liam, 'Escitalopram 20mg', '20mg', 'Mane', 'oral', 'active', { generic: 'escitalopram' });
  med(PAT.liam, 'Propranolol 40mg', '40mg', 'PRN', 'oral', 'active', { generic: 'propranolol' });

  // Mei — brief psychosis
  med(PAT.mei, 'Aripiprazole 15mg', '15mg', 'Mane', 'oral', 'active', { generic: 'aripiprazole' });

  await db('patient_medications').insert(meds).onConflict('id').ignore();
  console.log(`  ✓ ${meds.length} medications`);

  // ============ CLINICAL NOTES ============
  const notes: SeedClinicalNote[] = [];
  const note = (pid: string, epId: string, cat: string, _title: string, html: string, author = STAFF.sarah, date = '2026-03-15', signed = true) => {
    notes.push({ id: uuid(), clinic_id: CLINIC, patient_id: pid, episode_id: epId, author_id: author, note_category: cat, source_type: 'manual', content_html: html, is_signed: signed, is_draft: !signed, signed_by_id: signed ? author : null, signed_at: signed ? new Date() : null, note_date: date, created_at: new Date(), updated_at: new Date() });
  };

  // Marcus — extensive notes
  note(PAT.marcus, epMarcus, 'Progress Note', 'Key Clinician Review — Marcus Johnson',
    `<h3>Progress Note — Community Review</h3>
<p><strong>Date:</strong> 15/03/2026 | <strong>Clinician:</strong> Dr Sarah Chen | <strong>Location:</strong> CCT1 Outpatient</p>

<h4>Subjective</h4>
<p>Marcus presents for routine fortnightly review. Reports stable mood, sleeping 7-8 hours. Denies auditory hallucinations for past 3 weeks — significant improvement from baseline. States "the voices have been quiet since the depot increase." Appetite improved. No suicidal ideation. Concerned about weight gain (5kg in 3 months) since paliperidone increase.</p>

<h4>Objective</h4>
<p>Appearance: Well-groomed, appropriate attire. Behaviour: Cooperative, good eye contact, no psychomotor agitation. Speech: Normal rate and volume. Mood: "Pretty good actually." Affect: Euthymic, reactive. Thought form: Linear, goal-directed. Thought content: No delusions elicited. Perception: Nil AVH/VH currently. Cognition: Alert, oriented x4. Insight: Good — acknowledges illness, agrees with treatment. Judgement: Intact.</p>

<h4>Assessment</h4>
<p>Paranoid schizophrenia (F20.0) — in partial remission on current regimen. Paliperidone LAI 150mg 4-weekly providing good symptom control. Weight gain side effect being monitored. Risk: LOW — no current suicidal ideation, no aggression, stable accommodation, good engagement.</p>

<h4>Plan</h4>
<ol>
<li>Continue paliperidone palmitate 150mg 4-weekly — next LAI due 12/04/2026</li>
<li>Continue olanzapine 10mg nocte — consider dose reduction if symptoms remain stable</li>
<li>Refer to dietitian for weight management — metabolic monitoring due April</li>
<li>FBC, EUC, LFT, fasting glucose, lipids — order for next visit</li>
<li>Review in 2 weeks — discuss employment goals with OT</li>
<li>MHRT review: 91-day review due 14/06/2026</li>
</ol>`);

  note(PAT.marcus, epMarcus, 'Progress Note', 'LAI Administration — Paliperidone',
    `<h3>LAI Administration Note</h3>
<p><strong>Medication:</strong> Paliperidone Palmitate (Invega Sustenna) 150mg IM</p>
<p><strong>Date:</strong> 01/03/2026 | <strong>Administered by:</strong> Lisa Nguyen, RN</p>
<p><strong>Site:</strong> Left deltoid | <strong>Batch:</strong> PKL89234</p>
<p><strong>Observations:</strong> No adverse reaction. Patient tolerated well. Waited 30 minutes post-injection — no injection site reactions. Next due: 29/03/2026.</p>
<p><strong>Post-injection monitoring:</strong> BP 125/78, HR 72, no sedation observed.</p>`, STAFF.lisa, '2026-03-01');

  note(PAT.marcus, epMarcus, 'Ward Round', 'MDT Review — Marcus Johnson',
    `<h3>MDT Ward Round Note</h3>
<p><strong>Present:</strong> Dr Chen (Psychiatrist), James Patel (Registrar), Lisa Nguyen (Key Clinician), OT student</p>
<p><strong>Diagnosis:</strong> Paranoid Schizophrenia (F20.0)</p>
<p><strong>Current Medications:</strong> Paliperidone Palmitate 150mg 4-weekly, Olanzapine 10mg nocte, Benztropine 2mg BD</p>
<p><strong>Discussion:</strong> Marcus has shown good progress over the past month. Positive symptoms significantly reduced. Negative symptoms (avolition, social withdrawal) remain — OT to commence supported employment program. Weight gain to be addressed with dietitian referral. Consider olanzapine dose reduction at next review if positive symptoms remain controlled on depot alone.</p>
<p><strong>Risk:</strong> Low risk. Historical risk of aggression when acutely unwell — currently well-managed.</p>
<p><strong>Actions:</strong> OT referral for employment support. Dietitian referral. Metabolic monitoring bloods. 91-day review preparation.</p>`, STAFF.sarah, '2026-03-10');

  // Priya — schizoaffective
  note(PAT.priya, epPriya, 'Progress Note', 'Psychiatrist Review — Priya Sharma',
    `<h3>Psychiatrist Review</h3>
<p><strong>Diagnosis:</strong> Schizoaffective Disorder, Depressive Type (F25.1)</p>
<p>Priya presents for monthly review. Reports persistent low mood despite sertraline 200mg — PHQ-9 score 14 (moderate). Sleep disrupted — waking 3-4am. Denies psychotic symptoms currently. Describes ongoing worry about her children's wellbeing. No suicidal ideation but expresses hopelessness about the future. Aripiprazole LAI 400mg administered today — no side effects reported.</p>
<p><strong>Assessment:</strong> Depressive phase of schizoaffective disorder. Antidepressant response partial. Consider augmentation strategy.</p>
<p><strong>Plan:</strong> Add sodium valproate 500mg BD for mood stabilisation. Continue sertraline 200mg. Continue aripiprazole LAI. Psychologist referral for CBT. Review in 2 weeks.</p>`, STAFF.lisa, '2026-03-12');

  // William — bipolar mania inpatient
  note(PAT.william, epWilliam, 'Progress Note', 'Admission Note — William Chen',
    `<h3>Inpatient Admission Note</h3>
<p><strong>Date:</strong> 10/02/2026 | <strong>Admitted from:</strong> ED via ACIS assessment | <strong>Legal status:</strong> Temporary Treatment Order s45</p>
<p><strong>Presenting complaint:</strong> Brought by police after being found wandering on a freeway at 3am, grandiose, disorganised. Family report 2 weeks of escalating mania — reduced sleep (2hrs/night), excessive spending ($15,000 on credit cards), grandiose plans to "restructure the Australian banking system."</p>
<p><strong>MSE:</strong> Dishevelled, psychomotor agitation, pressure of speech, flight of ideas, grandiose delusions (believes he is an advisor to the Reserve Bank), mood "fantastic," affect elated and labile, no hallucinations, poor insight and judgement.</p>
<p><strong>Risk:</strong> HIGH — vulnerable due to mania, impaired judgement, absconding risk, historical aggression when manic (assaulted security guard 2023 admission).</p>
<p><strong>Plan:</strong> Admit IPU under TTO. Commence lithium 450mg BD, olanzapine 20mg nocte. Lorazepam 1mg PRN for acute agitation. Cease quetiapine. Lithium level in 5 days. EUC, TFT baseline. 1:1 nursing obs first 24hrs. Contact family.</p>`, STAFF.james, '2026-02-10');

  note(PAT.william, epWilliam, 'Progress Note', 'Inpatient Progress — Day 14',
    `<h3>Inpatient Progress Note</h3>
<p><strong>Day 14 of admission. Lithium level:</strong> 0.8 mmol/L (therapeutic). Olanzapine being tapered — currently 15mg, plan to reduce to 10mg this week.</p>
<p>Significant improvement in manic symptoms. Sleep normalising (6hrs). No longer grandiose. Speech rate reduced. Beginning to recognise the episode. Expressing remorse about spending. Family meeting held — wife and parents attended. Discussed relapse prevention plan.</p>
<p>Ready for discharge planning. PARC referral being considered for step-down.</p>`, STAFF.james, '2026-02-24');

  // Aisha — clozapine
  note(PAT.aisha, epAisha, 'Progress Note', 'Clozapine Monitoring — Aisha Mohamed',
    `<h3>Clozapine Monitoring Note</h3>
<p><strong>Current dose:</strong> Clozapine 450mg nocte | <strong>Duration:</strong> 4 months</p>
<p><strong>Bloods:</strong> WCC 6.8 (normal), ANC 3.2 (normal), Fasting glucose 5.9 (borderline). Clozapine level: 450 mcg/L (therapeutic 350-600).</p>
<p><strong>Side effects:</strong> Constipation (managed with Movicol BD), moderate sedation (improving), weight gain 8kg since commencement. Sialorrhoea at night — trialling hyoscine patch.</p>
<p><strong>Clinical response:</strong> Significant reduction in positive symptoms. Previously treatment-resistant — failed adequate trials of risperidone, olanzapine, and aripiprazole. First meaningful improvement with clozapine. Still hears occasional voices but can dismiss them. Functioning improved.</p>
<p><strong>Plan:</strong> Continue clozapine 450mg. Monthly FBC/ANC. Metabolic monitoring quarterly. Dietitian involved. Consider dose increase if residual symptoms persist at next review.</p>`, STAFF.sarah, '2026-03-05');

  // Thomas — FEP with ISBAR
  note(PAT.thomas, epThomas, 'Progress Note', 'ACIS Assessment — Thomas Wright (FEP)',
    `<h3>ACIS Acute Assessment</h3>
<p><strong>I — IDENTIFY:</strong> Dr Michael O'Brien, ACIS Psychiatrist, regarding Thomas Wright, 24yo male, UR000105.</p>
<p><strong>S — SITUATION:</strong> Referred by GP after family reported 3 months of progressive social withdrawal, suspicious behaviour, talking to himself. First presentation to mental health services.</p>
<p><strong>B — BACKGROUND:</strong> Nil previous psychiatric history. University student (suspended due to poor performance). Cannabis use — daily for 2 years. Family history: uncle with schizophrenia. No medical comorbidities.</p>
<p><strong>A — ASSESSMENT:</strong> MSE: Guarded, poor eye contact, thought-disordered (tangential), persecutory delusions (neighbours monitoring him), AVH (voice commenting on actions), blunted affect. Insight: Nil. Risk: moderate — no active suicidal ideation but vulnerable, socially isolated.</p>
<p><strong>R — RECOMMENDATION:</strong> Commence risperidone 1mg nocte, titrate to 3mg. FEP pathway — comprehensive assessment. CT brain to exclude organic cause. Bloods: FBC, EUC, TFT, fasting lipids/glucose, HbA1c, prolactin. Urine drug screen. ACIS follow-up 48hrs. Family psychoeducation. If deterioration, consider TTO and IPU admission.</p>`, STAFF.michael, '2026-01-05');

  // Daniel — PTSD
  note(PAT.daniel, epDaniel, 'Progress Note', 'Trauma-Focused Review — Daniel O\'Connor',
    `<h3>Psychology Review — Trauma-Focused CBT Progress</h3>
<p><strong>Session 8 of 12</strong> | <strong>Clinician:</strong> Lisa Nguyen, Psychologist</p>
<p>Daniel engaged well in today's session. Completed exposure hierarchy — able to discuss index trauma (motor vehicle accident) with moderate distress (SUDS 5/10, down from 8/10 at session 1). PCL-5 score 38 (reduced from 52 at baseline). Nightmares reduced from nightly to 2-3 per week since prazosin commenced.</p>
<p>Ongoing avoidance of driving — exposure plan in progress. Alcohol use reduced from 40 standard drinks/week to 12/week — significant progress. Attending AA meetings weekly.</p>
<p><strong>Plan:</strong> Continue PE protocol. In vivo exposure: passenger in car next session. Discuss driving exposure for session 10. Continue prazosin 5mg nocte. Sertraline stable at 150mg. Drug & alcohol review next month.</p>`, STAFF.lisa, '2026-03-08');

  // Jessica — 91-day review content
  note(PAT.jessica, epJessica, 'Progress Note', '91-Day Review — Jessica Nguyen',
    `<h3>91-Day Clinical Review</h3>
<p><strong>Review period:</strong> 15/12/2025 — 15/03/2026 | <strong>Reviewer:</strong> Dr Emma Williams</p>

<h4>Summary of Period</h4>
<p>Jessica has shown gradual improvement over this review period. PHQ-9 reduced from 22 (severe) to 15 (moderate). GAD-7 reduced from 18 to 12. No hospital admissions during period. Two crisis contacts (January — passive suicidal ideation during anniversary of father's death).</p>

<h4>Treatment Progress</h4>
<ul>
<li>Venlafaxine increased from 225mg to 300mg — tolerated well</li>
<li>Quetiapine 50mg nocte added for sleep augmentation — helpful</li>
<li>Mirtazapine ceased due to excessive sedation and weight gain</li>
<li>Psychologist: completed 6/12 sessions of behavioural activation</li>
<li>OT: commenced supported employment program at Workways</li>
</ul>

<h4>Risk Assessment</h4>
<p>Historical: Multiple admissions for suicidal ideation/overdose. Recent: Passive ideation in January, nil since. Current: Low-moderate. Safety plan reviewed and updated. Emergency contacts current. No access to means.</p>

<h4>Goals for Next 91 Days</h4>
<ol>
<li>PHQ-9 target: below 10</li>
<li>Complete behavioural activation program</li>
<li>Commence volunteer work placement</li>
<li>Review venlafaxine dose — consider maintaining or reducing if improved</li>
<li>Relapse prevention plan to be developed</li>
</ol>

<h4>Recommendation</h4>
<p>Continue current treatment. Community Treatment Order not required — Jessica engaging voluntarily. Next 91-day review: 14/06/2026.</p>`, STAFF.emma, '2026-03-15');

  await db('clinical_notes').insert(notes).onConflict('id').ignore();
  console.log(`  ✓ ${notes.length} clinical notes`);

  // ============ ALERTS ============
  const alertTypeIds = await db('alert_types').select('id', 'name');
  const atMap: Record<string, string> = {};
  for (const at of alertTypeIds) atMap[at.name] = at.id;

  const alerts: SeedAlert[] = [
    { id: uuid(), patient_id: PAT.marcus, clinic_id: CLINIC, alert_type_id: requireLookupId(atMap, 'Aggression and Violence Risk', 'alert_types'), entered_by_id: STAFF.sarah, title: 'History of aggression when acutely psychotic', notes: 'Assaulted security guard during 2023 admission. Verbal threats to staff during 2024 relapse. No incidents since depot commenced. Risk mitigated by medication adherence.', management_plan: '1. Maintain antipsychotic depot adherence\n2. Avoid confrontational approach when unwell\n3. PRN sedation available if acutely agitated\n4. Male staff preferred during acute presentations\n5. Duress alarm access for all clinical interactions during acute phase', severity: 'high', is_active: true, show_flag: true, created_at: new Date(), updated_at: new Date() },
    { id: uuid(), patient_id: PAT.marcus, clinic_id: CLINIC, alert_type_id: requireLookupId(atMap, 'Carried Weapons History', 'alert_types'), entered_by_id: STAFF.sarah, title: 'Carried knife during 2023 psychotic episode', notes: 'Found with kitchen knife in backpack during acute psychosis. No assault with weapon. Surrendered voluntarily when asked. Risk associated with acute psychotic state only.', management_plan: '1. Search policy applies during acute presentations\n2. Risk reassessment at each contact during relapse\n3. Ensure no weapons access in clinical settings', severity: 'medium', is_active: true, show_flag: true, created_at: new Date(), updated_at: new Date() },
    { id: uuid(), patient_id: PAT.william, clinic_id: CLINIC, alert_type_id: requireLookupId(atMap, 'Absconding Risk', 'alert_types'), entered_by_id: STAFF.james, title: 'Absconded from IPU twice during 2024 manic episode', notes: 'Left IPU via fire escape during manic episode. Found at Crown Casino. Second absconding — walked out during medication round. High risk when manic.', management_plan: '1. 15-minute observations during manic phase\n2. Secure ward placement\n3. Door alarm activated\n4. Consider 1:1 if escalating agitation', severity: 'high', is_active: true, show_flag: true, created_at: new Date(), updated_at: new Date() },
    { id: uuid(), patient_id: PAT.jessica, clinic_id: CLINIC, alert_type_id: requireLookupId(atMap, 'Suicide Risk', 'alert_types'), entered_by_id: STAFF.emma, title: 'Multiple suicide attempts — overdose', notes: 'Three overdose attempts: 2022 (paracetamol), 2023 (venlafaxine), 2024 (mixed medications). ICU admission 2023. Chronic suicidal ideation with plans during depressive episodes.', management_plan: '1. Safety plan in place — reviewed quarterly\n2. Restricted medication supply (weekly dispensing)\n3. Emergency contacts: mother (0412 XXX XXX), partner (0413 XXX XXX)\n4. Crisis plan: present to ED or call 000/Lifeline 13 11 14\n5. Means restriction: no stockpiling of medications\n6. Clinician to assess SI at every contact', severity: 'high', is_active: true, show_flag: true, created_at: new Date(), updated_at: new Date() },
    { id: uuid(), patient_id: PAT.jessica, clinic_id: CLINIC, alert_type_id: requireLookupId(atMap, 'Self-Harm Risk', 'alert_types'), entered_by_id: STAFF.emma, title: 'History of self-harm — cutting', notes: 'Cutting to forearms during depressive episodes. Last episode November 2025. Uses as emotional regulation strategy. Receiving DBT skills training.', management_plan: '1. Assess self-harm at every contact\n2. Wound care if needed\n3. Continue DBT skills group\n4. Distress tolerance plan in safety plan', severity: 'medium', is_active: true, show_flag: true, created_at: new Date(), updated_at: new Date() },
    { id: uuid(), patient_id: PAT.aisha, clinic_id: CLINIC, alert_type_id: requireLookupId(atMap, 'Suicide Risk', 'alert_types'), entered_by_id: STAFF.sarah, title: 'History of suicidal ideation with plan', notes: 'Expressed suicidal ideation with plan (jumping) during 2024 psychotic relapse. Ideation resolved with clozapine commencement. Nil ideation for 4 months.', management_plan: '1. Ongoing monitoring of suicidal ideation\n2. Clozapine adherence critical\n3. Safety plan reviewed monthly\n4. Family aware and supportive', severity: 'medium', is_active: true, show_flag: true, created_at: new Date(), updated_at: new Date() },
  ];

  await db('patient_alerts').insert(alerts).onConflict('id').ignore();
  console.log(`  ✓ ${alerts.length} alerts with management plans`);

  // ============ TREATMENT PLANS ============
  const plans: SeedTreatmentPlan[] = [
    { id: uuid(), clinic_id: CLINIC, patient_id: PAT.marcus, episode_id: epMarcus, author_id: STAFF.sarah, status: 'active', plan_date: '2026-03-10', review_date: '2026-06-10', is_signed: true, signed_by_id: STAFF.sarah, signed_at: new Date(),
      goals: '1. Maintain psychotic symptom remission\n2. Address weight gain (target: lose 3kg in 3 months)\n3. Engage in supported employment\n4. Improve social connections\n5. Maintain independent living',
      interventions: '1. Paliperidone LAI 150mg 4-weekly — psychiatrist review monthly\n2. Key clinician fortnightly home visits\n3. OT employment support program — weekly\n4. Psychoeducation group — monthly\n5. Family therapy sessions — monthly',
      risk_management: '1. Depot adherence monitoring — clinic to be notified if DNA\n2. Relapse signature monitoring (sleep disruption, suspiciousness, social withdrawal)\n3. Crisis plan: present to ED, call CATT, family to call 000 if acutely unwell\n4. MHRT review scheduled 14/06/2026',
      medication_plan: 'Paliperidone Palmitate 150mg 4-weekly\nOlanzapine 10mg nocte — consider dose reduction if stable\nBenztropine 2mg BD\nMetabolic monitoring: FBC, EUC, LFT, fasting glucose, lipids — quarterly',
      support_services: 'Housing: Independent unit via PDRSS\nNDIS: Psychosocial support 10hrs/week\nIncome: DSP + Rent Assistance\nFamily: Parents supportive, weekly contact\nMental Health Community Support: Mind Australia',
      created_at: new Date(), updated_at: new Date() },
    { id: uuid(), clinic_id: CLINIC, patient_id: PAT.jessica, episode_id: epJessica, author_id: STAFF.emma, status: 'active', plan_date: '2026-03-15', review_date: '2026-06-15', is_signed: true, signed_by_id: STAFF.emma, signed_at: new Date(),
      goals: '1. Reduce depressive symptoms (PHQ-9 below 10)\n2. Eliminate suicidal ideation\n3. Resume part-time employment\n4. Strengthen social support network\n5. Develop relapse prevention plan',
      interventions: '1. Venlafaxine 300mg — psychiatrist monthly review\n2. Psychologist: behavioural activation — weekly x 12\n3. OT: supported employment program\n4. DBT skills group — weekly\n5. Social worker: housing and financial support',
      risk_management: '1. Weekly medication dispensing (restrict supply)\n2. Safety plan — reviewed at every contact\n3. SI assessment at every appointment\n4. Emergency contacts: mother, partner\n5. Crisis: ED, CATT, Lifeline 13 11 14',
      medication_plan: 'Venlafaxine 300mg mane\nQuetiapine 50mg nocte\nNil PRN\nConsider dose reduction if PHQ-9 < 10 sustained for 6 months',
      support_services: 'Housing: Renting with partner\nIncome: Centrelink Jobseeker (medical certificate)\nWorkways supported employment\nBeyondblue forum peer support',
      created_at: new Date(), updated_at: new Date() },
  ];

  await db('treatment_plans').insert(plans).onConflict('id').ignore();
  console.log(`  ✓ ${plans.length} treatment plans`);

  // ============ LEGAL ORDERS ============
  const legalTypeIds = await db('legal_order_type_configs').select('id', 'name');
  const ltMap: Record<string, string> = {};
  for (const lt of legalTypeIds) ltMap[lt.name] = lt.id;

  const legalOrders: SeedLegalOrder[] = [
    { id: uuid(), patient_id: PAT.william, clinic_id: CLINIC, order_type_id: requireLookupId(ltMap, 'Temporary Treatment Order (s45)', 'legal_order_type_configs'), entered_by_id: STAFF.james, order_number: 'TTO-2026-0142', start_date: '2026-02-10', end_date: '2026-03-10', review_date: '2026-03-08', status: 'active', notes: 'Temporary Treatment Order made under s45 MHA 2014 (Vic). Patient lacks capacity to consent to treatment during acute manic episode. Criteria: Mental illness (Bipolar I — manic with psychosis), significant risk of harm to self (impaired judgement, financial harm, vulnerability), treatment available. Patient to be notified of rights. MHRT hearing scheduled. Authorised treatments: antipsychotic medication (olanzapine, lithium), sedation PRN, physical monitoring.', created_at: new Date(), updated_at: new Date() },
    { id: uuid(), patient_id: PAT.marcus, clinic_id: CLINIC, order_type_id: requireLookupId(ltMap, 'Treatment Order (s55)', 'legal_order_type_configs'), entered_by_id: STAFF.sarah, order_number: 'TO-2025-0891', start_date: '2025-06-15', end_date: '2026-06-14', review_date: '2026-06-10', next_application_date: '2026-05-15', status: 'active', notes: 'Treatment Order under s55 MHA 2014 (Vic). Community-based. Patient has paranoid schizophrenia with history of treatment non-adherence leading to psychotic relapse and aggression. Community treatment includes: paliperidone LAI 150mg 4-weekly (mandatory), psychiatric review monthly, key clinician fortnightly. Order reviewed at MHRT — continued 6-monthly. Next MHRT review due.', created_at: new Date(), updated_at: new Date() },
  ];

  await db('patient_legal_orders').insert(legalOrders).onConflict('id').ignore();
  console.log(`  ✓ ${legalOrders.length} legal orders`);

  // ============ APPOINTMENTS ============
  const appts: SeedAppointment[] = [];
  const appt = (pid: string, staffId: string, type: string, date: string, time: string, dur: number, status = 'scheduled') => {
    appts.push({ id: uuid(), clinic_id: CLINIC, patient_id: pid, staff_id: staffId, appointment_type: type, appointment_date: date, start_time: time, duration_minutes: dur, status, location: 'Outpatient Clinic', notes: '', created_at: new Date(), updated_at: new Date() });
  };

  appt(PAT.marcus, STAFF.sarah, 'Psychiatrist Review', '2026-03-25', '09:00', 30);
  appt(PAT.marcus, STAFF.lisa, 'Key Clinician', '2026-03-28', '14:00', 60);
  appt(PAT.priya, STAFF.lisa, 'Key Clinician + LAI', '2026-03-26', '10:00', 45);
  appt(PAT.william, STAFF.james, 'Registrar Review', '2026-03-24', '11:00', 30);
  appt(PAT.jessica, STAFF.emma, 'Psychiatrist Review', '2026-03-27', '09:30', 30);
  appt(PAT.jessica, STAFF.lisa, 'Psychologist — BA Session 7', '2026-03-22', '13:00', 50);
  appt(PAT.thomas, STAFF.michael, 'FEP Clinic — 12 Week Review', '2026-03-29', '10:30', 45);
  appt(PAT.aisha, STAFF.sarah, 'Clozapine Clinic', '2026-04-02', '09:00', 30);
  appt(PAT.daniel, STAFF.lisa, 'Psychology — PE Session 9', '2026-03-22', '15:00', 50);
  appt(PAT.sophie, STAFF.emma, 'PARC Review', '2026-03-26', '14:30', 30);
  appt(PAT.liam, STAFF.james, 'Anxiety Clinic', '2026-03-31', '11:00', 30);
  appt(PAT.mei, STAFF.michael, 'Inpatient Review', '2026-03-23', '08:30', 30);

  // Past completed appointments
  appt(PAT.marcus, STAFF.sarah, 'Psychiatrist Review', '2026-03-11', '09:00', 30, 'completed');
  appt(PAT.jessica, STAFF.emma, 'Psychiatrist Review', '2026-02-27', '09:30', 30, 'completed');
  appt(PAT.thomas, STAFF.michael, 'ACIS Follow-Up', '2026-01-07', '10:00', 45, 'completed');

  // Check if appointments table has these columns
  try {
    await db('appointments').insert(appts).onConflict('id').ignore();
    console.log(`  ✓ ${appts.length} appointments`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`  ⚠ Appointments skipped: ${message.substring(0, 80)}`);
  }

  console.log('\n✅ Test data seeded successfully!');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
