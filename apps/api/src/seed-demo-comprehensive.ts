/**
 * Comprehensive Demo Data Seeding Script
 * Seeds 3 years of rich clinical history across ALL verticals.
 *
 * Run:
 *   cd /Users/drprakashkamath/Projects/Signacare/apps/api && \
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *   -r dotenv/config src/seed-demo-comprehensive.ts
 */

import knex from 'knex';
import crypto from 'crypto';

// Phase 0.7.2 (#31): Production safety gate — same pattern as seed-good-health
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== '1') {
  console.error('REFUSED: seed-demo-comprehensive cannot run in production without ALLOW_DEMO_SEED=1');
  process.exit(1);
}

const uuid = () => crypto.randomUUID();
type SeedRow = Record<string, unknown>;
type StaffSeedRow = {
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  role: string;
};
type PatientIdentityRow = {
  id: string;
  emr_number: string;
  given_name: string;
  family_name: string;
};
type EpisodeSeedRow = {
  id: string;
  patient_id: string;
  status: string;
  start_date: string;
  episode_type: string;
};

// Phase 0.7.2: Use env vars instead of hardcoded legacy credentials
const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    user: process.env.DB_USER ?? 'signacare_owner',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'signacaredb',
  },
  pool: { min: 1, max: 5 },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function d(y: number, m: number, day: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(iso: string, n: number) {
  const dt = new Date(iso);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function tableExists(name: string): Promise<boolean> {
  const res = await db.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=?) as exists`,
    [name],
  );
  return res.rows[0].exists;
}

async function safeInsert(table: string, rows: SeedRow[]) {
  if (rows.length === 0) return 0;
  const exists = await tableExists(table);
  if (!exists) {
    console.log(`  [skip] Table "${table}" does not exist`);
    return 0;
  }
  let inserted = 0;
  for (const row of rows) {
    try {
      await db(table).insert(row);
      inserted++;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('duplicate') || message.includes('unique')) {
        // skip
      } else {
        console.error(`  [err] ${table}: ${message.substring(0, 120)}`);
      }
    }
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Comprehensive Demo Data Seed ===\n');

  // ── Fetch existing data ──────────────────────────────────────────────────
  const [clinic] = await db('clinics').select('id').limit(1);
  const C = clinic.id;
  console.log(`Clinic: ${C}`);

  const staffRows: StaffSeedRow[] = await db('staff').where({ clinic_id: C }).select('id', 'email', 'given_name', 'family_name', 'role');
  const staffIds = staffRows.map((s) => s.id);
  const clinicianIds = staffRows.filter((s) => s.role === 'clinician').map((s) => s.id);
  if (clinicianIds.length === 0) clinicianIds.push(...staffIds);
  const staffMap: Record<string, string> = {};
  for (const s of staffRows) {
    staffMap[s.email] = s.id;
    staffMap[`${s.given_name} ${s.family_name}`] = s.id;
  }
  console.log(`Staff: ${staffRows.length} found (${clinicianIds.length} clinicians)`);

  const existingPatients: PatientIdentityRow[] = await db('patients').where({ clinic_id: C }).select('id', 'emr_number', 'given_name', 'family_name');
  const existingEmrs = new Set(existingPatients.map((p) => p.emr_number));
  console.log(`Existing patients: ${existingPatients.length}`);

  // Org units
  const orgUnits = await db('org_units').select('id', 'name');
  const orgUnitMap: Record<string, string> = {};
  for (const u of orgUnits) orgUnitMap[u.name] = u.id;

  // ── 1. NEW PATIENTS (15 additional) ──────────────────────────────────────
  console.log('\n--- Seeding Patients ---');
  const newPatientDefs = [
    { given: 'Tran', family: 'Vo', dob: '1958-06-12', gender: 'male', emr: 'EMR-009', phone: '0412 111 222', address: '14 Springvale Rd', suburb: 'Springvale', state: 'VIC', postcode: '3171', interpreter: true, interpLang: 'Vietnamese', indigenous: 'not_indigenous', status: 'active', emergency_name: 'Mai Vo', emergency_phone: '0412 111 333', emergency_rel: 'Wife' },
    { given: 'Nadia', family: 'Khoury', dob: '1975-03-28', gender: 'female', emr: 'EMR-010', phone: '0423 222 333', address: '22 Sydney Rd', suburb: 'Brunswick', state: 'VIC', postcode: '3056', interpreter: true, interpLang: 'Arabic', indigenous: 'not_indigenous', status: 'active', emergency_name: 'Samir Khoury', emergency_phone: '0423 222 444', emergency_rel: 'Brother' },
    { given: 'Stavros', family: 'Papadopoulos', dob: '1942-11-03', gender: 'male', emr: 'EMR-011', phone: '0434 333 444', address: '7 Greek Quarter', suburb: 'Oakleigh', state: 'VIC', postcode: '3166', interpreter: true, interpLang: 'Greek', indigenous: 'not_indigenous', status: 'active', emergency_name: 'Maria Papadopoulos', emergency_phone: '0434 333 555', emergency_rel: 'Daughter' },
    { given: 'Kylie', family: 'Murray', dob: '1990-09-15', gender: 'female', emr: 'EMR-012', phone: '0445 444 555', address: '88 Bourke St', suburb: 'Fitzroy', state: 'VIC', postcode: '3065', interpreter: false, interpLang: null, indigenous: 'aboriginal', status: 'active', emergency_name: 'Jake Murray', emergency_phone: '0445 444 666', emergency_rel: 'Partner' },
    { given: 'Shane', family: 'Collins', dob: '1968-01-22', gender: 'male', emr: 'EMR-013', phone: '0456 555 666', address: '5 Industrial Av', suburb: 'Sunshine', state: 'VIC', postcode: '3020', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Denise Collins', emergency_phone: '0456 555 777', emergency_rel: 'Sister' },
    { given: 'Rebecca', family: 'Taylor', dob: '2004-05-18', gender: 'female', emr: 'EMR-014', phone: '0467 666 777', address: '102 Chapel St', suburb: 'Prahran', state: 'VIC', postcode: '3181', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Karen Taylor', emergency_phone: '0467 666 888', emergency_rel: 'Mother' },
    { given: 'Derek', family: 'Hutchinson', dob: '1950-07-30', gender: 'male', emr: 'EMR-015', phone: '0478 777 888', address: '33 Swan St', suburb: 'Richmond', state: 'VIC', postcode: '3121', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'deceased', emergency_name: 'Sandra Hutchinson', emergency_phone: '0478 777 999', emergency_rel: 'Wife' },
    { given: 'Lisa', family: 'Pearce', dob: '1983-12-01', gender: 'female', emr: 'EMR-016', phone: '0489 888 999', address: '17 Beach Rd', suburb: 'Frankston', state: 'VIC', postcode: '3199', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Craig Pearce', emergency_phone: '0489 888 000', emergency_rel: 'Husband' },
    { given: 'Jarrod', family: 'West', dob: '1995-04-09', gender: 'male', emr: 'EMR-017', phone: '0490 999 000', address: '49 Church St', suburb: 'Hawthorn', state: 'VIC', postcode: '3122', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Claire West', emergency_phone: '0490 999 111', emergency_rel: 'Mother' },
    { given: 'Amara', family: 'Okafor', dob: '1988-08-20', gender: 'female', emr: 'EMR-018', phone: '0401 000 111', address: '61 Lygon St', suburb: 'Carlton', state: 'VIC', postcode: '3053', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Emeka Okafor', emergency_phone: '0401 000 222', emergency_rel: 'Husband' },
    { given: 'Graham', family: 'Fitzgerald', dob: '1947-02-14', gender: 'male', emr: 'EMR-019', phone: '0412 010 111', address: '2 Veteran Pl', suburb: 'Heidelberg', state: 'VIC', postcode: '3084', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Joan Fitzgerald', emergency_phone: '0412 010 222', emergency_rel: 'Wife' },
    { given: 'Samira', family: 'Ahmadi', dob: '1997-10-05', gender: 'female', emr: 'EMR-020', phone: '0423 020 222', address: '15 Hope St', suburb: 'Dandenong', state: 'VIC', postcode: '3175', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'transferred', emergency_name: 'Reza Ahmadi', emergency_phone: '0423 020 333', emergency_rel: 'Father' },
    { given: 'Brian', family: 'OBrien', dob: '1960-06-19', gender: 'male', emr: 'EMR-021', phone: '0434 030 333', address: '88 Station Rd', suburb: 'Box Hill', state: 'VIC', postcode: '3128', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Margaret OBrien', emergency_phone: '0434 030 444', emergency_rel: 'Wife' },
    { given: 'Chloe', family: 'Armstrong', dob: '2001-03-27', gender: 'female', emr: 'EMR-022', phone: '0445 040 444', address: '4 River Walk', suburb: 'Abbotsford', state: 'VIC', postcode: '3067', interpreter: false, interpLang: null, indigenous: 'torres_strait_islander', status: 'active', emergency_name: 'Paul Armstrong', emergency_phone: '0445 040 555', emergency_rel: 'Father' },
    { given: 'Victor', family: 'Lam', dob: '1972-12-08', gender: 'male', emr: 'EMR-023', phone: '0456 050 555', address: '38 Albert St', suburb: 'Footscray', state: 'VIC', postcode: '3011', interpreter: false, interpLang: null, indigenous: 'not_indigenous', status: 'active', emergency_name: 'Anna Lam', emergency_phone: '0456 050 666', emergency_rel: 'Wife' },
  ];

  const allPatientIds: string[] = existingPatients.map((p) => p.id);
  const patientNameToId: Record<string, string> = {};
  for (const p of existingPatients) patientNameToId[`${p.given_name} ${p.family_name}`] = p.id;

  for (const p of newPatientDefs) {
    if (existingEmrs.has(p.emr)) {
      const ex = existingPatients.find((ep) => ep.emr_number === p.emr);
      if (ex) {
        patientNameToId[`${p.given} ${p.family}`] = ex.id;
        console.log(`  [exists] ${p.given} ${p.family} (${p.emr})`);
      }
      continue;
    }
    const id = uuid();
    await db('patients').insert({
      id,
      clinic_id: C,
      given_name: p.given,
      family_name: p.family,
      date_of_birth: p.dob,
      gender: p.gender,
      emr_number: p.emr,
      phone_mobile: p.phone,
      address_line1: p.address,
      suburb: p.suburb,
      state: p.state,
      postcode: p.postcode,
      country: 'AU',
      status: p.status,
      interpreter_required: p.interpreter,
      interpreter_language: p.interpLang,
      indigenous_status: p.indigenous,
      emergency_contact_name: p.emergency_name,
      emergency_contact_phone: p.emergency_phone,
      emergency_contact_relationship: p.emergency_rel,
      created_at: new Date(),
      updated_at: new Date(),
    });
    allPatientIds.push(id);
    patientNameToId[`${p.given} ${p.family}`] = id;
    console.log(`  [new] ${p.given} ${p.family} (${p.emr})`);
  }

  // Refresh full patient list
  const allPatients: PatientIdentityRow[] = await db('patients').where({ clinic_id: C }).select('id', 'emr_number', 'given_name', 'family_name');
  const patientIdToName: Record<string, string> = {};
  for (const p of allPatients) {
    patientIdToName[p.id] = `${p.given_name} ${p.family_name}`;
    patientNameToId[`${p.given_name} ${p.family_name}`] = p.id;
  }
  const pids = allPatients.map((p) => p.id);
  console.log(`Total patients now: ${pids.length}`);

  // ── 2. EPISODES ──────────────────────────────────────────────────────────
  console.log('\n--- Seeding Episodes ---');
  const episodeTypes = ['community', 'inpatient', 'community', 'community'];
  const episodeDefs: SeedRow[] = [];

  // Create 2-4 historical episodes per patient (plus keep existing open ones)
  for (const pid of pids) {
    const numEp = randomInt(2, 4);
    const startYear = randomInt(2023, 2024);
    for (let i = 0; i < numEp; i++) {
      const sYear = startYear + Math.floor(i / 2);
      const sMonth = randomInt(1, 12);
      const sDay = randomInt(1, 28);
      const start = d(sYear, sMonth, sDay);
      const isClosed = i < numEp - 1;
      const etype = i === 1 && Math.random() > 0.6 ? 'inpatient' : randomFrom(episodeTypes);
      episodeDefs.push({
        id: uuid(),
        patient_id: pid,
        clinic_id: C,
        title: etype === 'inpatient' ? 'Inpatient Admission' : 'Community Treatment',
        episode_type: etype,
        status: isClosed ? 'closed' : 'open',
        start_date: start,
        end_date: isClosed ? addDays(start, randomInt(14, 180)) : null,
        primary_clinician_id: randomFrom(clinicianIds),
        created_at: new Date(start),
        updated_at: new Date(),
      });
    }
  }

  const epInserted = await safeInsert('episodes', episodeDefs);
  console.log(`  Inserted ${epInserted} episodes`);

  // Refresh episodes
  const allEpisodes: EpisodeSeedRow[] = await db('episodes').where({ clinic_id: C }).select('id', 'patient_id', 'status', 'start_date', 'episode_type');
  const openEpisodeByPatient: Record<string, string> = {};
  for (const ep of allEpisodes) {
    if (ep.status === 'open') openEpisodeByPatient[ep.patient_id] = ep.id;
  }

  // ── 3. CLINICAL NOTES (200+) ────────────────────────────────────────────
  console.log('\n--- Seeding Clinical Notes ---');
  const noteTypes = ['progress', 'progress', 'progress', 'assessment', 'soap', 'progress', 'progress'];
  const noteStatuses = ['signed', 'signed', 'signed', 'signed', 'signed', 'signed', 'draft'];

  const progressTemplates = [
    (name: string) => `Patient ${name} reviewed in community clinic. Mental state examination demonstrates euthymic mood with congruent affect. Sleep pattern remains regular at 7-8 hours per night. Appetite stable. Denies any suicidal ideation or self-harm urges. Medication compliance reported as good with no significant side effects noted. Continuing to engage with psychosocial activities through the Clubhouse program.\n\nPlan: Continue current medications unchanged. Follow-up appointment in 2 weeks. Encourage ongoing engagement with psychosocial supports. Will review blood results at next appointment.`,
    (name: string) => `Home visit conducted. ${name} was at home and appeared well-groomed and settled in the home environment. Reports maintaining daily routine including walking 30 minutes per day. Sleep remains good. Described mood as "okay, getting on with things." No psychotic symptoms elicited. Rapport is good and the therapeutic relationship continues to be a stabilising factor.\n\nCollateral from carer: partner reports no concerns, notes improvement in motivation over the past month. Carer support needs assessed — no immediate needs identified.\n\nPlan: Continue fortnightly home visits. Review medications at next psychiatrist appointment. Encourage continued physical activity.`,
    (name: string) => `Telephone review with ${name}. Patient reports feeling anxious over the past week following a disagreement with a family member. Sleep has been disrupted — averaging 5 hours per night. Appetite reduced. Denies suicidal ideation but acknowledges feeling "low and flat." Currently using diaphragmatic breathing and grounding techniques from previous CBT sessions.\n\nRisk: Low — no active suicidal ideation, has safety plan in place, good social supports. Will monitor closely.\n\nPlan: Increase contact frequency to twice weekly for the next fortnight. Offered telehealth appointment with psychologist this week — patient accepted. Review anxiolytic PRN at next face-to-face. Safety plan remains accessible.`,
    (name: string) => `Ward round review. ${name} continues on inpatient unit day 5. Some improvement in mental state since admission. Paranoid ideation less prominent. Engaging better with nursing staff. Accepted morning medication without resistance. Still guarded in interview but able to discuss discharge planning. Family meeting held — mother and sister attended, supportive of continuing treatment.\n\nMSE: Appearance — adequate self-care, eye contact improved. Speech — normal rate and volume. Mood — "alright." Affect — restricted range, reactive to humour. Thought form — goal-directed. Thought content — residual paranoid ideation about neighbours (less fixed). Perception — denies current AVH. Cognition — intact. Insight — partial, accepting of need for medication.\n\nPlan: Continue current medications. Begin leave planning with escorted walks. Target discharge in 5-7 days if trajectory maintained.`,
    (name: string) => `Annual comprehensive review for ${name}. This review covers clinical progress, medication efficacy, physical health monitoring, psychosocial functioning, and care planning.\n\nClinical progress: ${name} has maintained stability over the past 12 months with no hospital admissions and no presentations to emergency services. Engagement with the community team has been consistent.\n\nPhysical health: Weight stable. Metabolic monitoring completed — fasting glucose, lipid panel, and HbA1c within acceptable ranges. ECG: normal sinus rhythm, QTc within limits. Smoking status: ex-smoker (ceased 18 months ago).\n\nPsychosocial: Living independently in rental accommodation. Receiving NDIS-funded psychosocial support 10 hours per week. Attends peer support group fortnightly. Employment: part-time volunteer work at community garden.\n\nPlan: Continue current treatment plan. Next comprehensive review in 12 months. GP letter sent for shared care.`,
    (name: string) => `Crisis assessment completed in Emergency Department. ${name} presented with acute distress following a conflict at supported residential accommodation. Staff at accommodation contacted CATT after patient expressed thoughts of self-harm and was observed punching walls.\n\nOn assessment, ${name} was distressed but able to engage. Expressed frustration with living situation but denied active suicidal intent. Self-harm urges had settled by the time of assessment. No psychotic symptoms identified. Blood alcohol level 0.00.\n\nRisk assessment: Moderate risk in context of emotional dysregulation and expressed self-harm ideation. Protective factors include willingness to engage with support, appointment scheduled with key clinician tomorrow.\n\nPlan: Safe to return to accommodation with safety plan reinforced. Key clinician notified. CATT follow-up call in the morning. If escalation, represent to ED.`,
    (name: string) => `Intake assessment completed for ${name}. Referral received from GP Dr Simmons at Mill Park Medical Centre citing worsening depression and anxiety symptoms over the preceding 3 months.\n\nHistory of presenting complaint: ${name} describes a gradual onset of low mood, anhedonia, and persistent worry about finances and family relationships. Sleep onset insomnia (taking 1-2 hours to fall asleep). Appetite reduced with 3kg weight loss over 2 months. Concentration difficulties impacting work performance.\n\nPast psychiatric history: One previous episode of depression in 2020, treated by GP with sertraline 100mg for 6 months — discontinued after remission. No prior hospital admissions. No history of self-harm or suicide attempts.\n\nSubstance use: Alcohol 10 standard drinks per week, cannabis nil, other substances nil.\n\nPlan: Commence in community mental health team. Initial psychiatrist appointment within 2 weeks. Psychology referral for CBT. GP correspondence sent.`,
    (name: string) => `Physical health assessment completed for ${name}. This is part of routine annual metabolic monitoring as per antipsychotic prescribing guidelines.\n\nVitals: BP 134/86 mmHg, HR 78 bpm, Temp 36.5, RR 16. Weight 89.4kg, Height 172cm, BMI 30.2 (obese class I). Waist circumference 104cm.\n\nBlood results: Fasting glucose 5.9 mmol/L (borderline), HbA1c 5.7% (pre-diabetes range), Total cholesterol 5.4 mmol/L (elevated), LDL 3.3 mmol/L (elevated), HDL 1.1 mmol/L (low), Triglycerides 2.1 mmol/L (elevated). FBC normal. Renal function normal. LFTs: GGT mildly elevated at 55 U/L.\n\nAssessment: Metabolic syndrome criteria met (3 of 5: waist circumference, fasting glucose, triglycerides). Cardiovascular risk requires management.\n\nPlan: Refer to dietitian. Lifestyle advice provided re: exercise and diet. GP letter for consideration of statin therapy. Repeat metabolic panel in 3 months. Consider antipsychotic with more favourable metabolic profile if weight gain continues.`,
  ];

  const noteRows: SeedRow[] = [];
  for (const pid of pids) {
    const numNotes = randomInt(5, 15);
    const patientEpisodes = allEpisodes.filter((e) => e.patient_id === pid);
    const openEp = openEpisodeByPatient[pid];
    const pName = patientIdToName[pid] || 'the patient';

    for (let i = 0; i < numNotes; i++) {
      const yearOffset = Math.floor(i / 5);
      const noteYear = 2023 + yearOffset;
      const noteMonth = randomInt(1, 12);
      const noteDay = randomInt(1, 28);
      const noteDate = d(Math.min(noteYear, 2026), noteMonth, noteDay);
      const noteType = randomFrom(noteTypes);
      const status = randomFrom(noteStatuses);
      const authorId = randomFrom(clinicianIds);
      const template = randomFrom(progressTemplates);
      const content = template(pName);
      const epForNote = yearOffset >= 2 && openEp ? openEp : patientEpisodes.length > 0 ? randomFrom(patientEpisodes).id : openEp;

      const contactMeta = {
        contactDate: noteDate,
        contactTime: `${randomInt(8, 17).toString().padStart(2, '0')}:${randomFrom(['00', '15', '30', '45'])}`,
        durationMin: randomFrom([15, 20, 30, 45, 60]),
        contactMedium: randomFrom(['face_to_face', 'phone', 'telehealth', 'home_visit']),
        location: randomFrom(['Community Clinic', 'Patient Home', 'Inpatient Unit', 'Telehealth']),
      };

      noteRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        episode_id: epForNote || null,
        author_id: authorId,
        title: noteType === 'assessment' ? 'Assessment Note' : noteType === 'soap' ? 'SOAP Note' : 'Progress Note',
        note_type: noteType,
        content,
        status,
        is_reportable_contact: Math.random() > 0.15,
        contact_meta: JSON.stringify(contactMeta),
        foi_exempt: false,
        did_not_attend: Math.random() < 0.05,
        is_ai_draft: false,
        signed_at: status === 'signed' ? new Date(noteDate) : null,
        signed_by: status === 'signed' ? authorId : null,
        created_at: new Date(noteDate),
        updated_at: new Date(noteDate),
      });
    }
  }

  const notesInserted = await safeInsert('clinical_notes', noteRows);
  console.log(`  Inserted ${notesInserted} clinical notes`);

  // ── 4. MEDICATIONS ───────────────────────────────────────────────────────
  console.log('\n--- Seeding Medications ---');
  const medDefs = [
    { drug: 'Olanzapine 10mg', generic: 'Olanzapine', dose: '10', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'Psychosis' },
    { drug: 'Olanzapine 20mg', generic: 'Olanzapine', dose: '20', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'Psychosis' },
    { drug: 'Risperidone 2mg', generic: 'Risperidone', dose: '2', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'Psychosis' },
    { drug: 'Risperidone 4mg', generic: 'Risperidone', dose: '4', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'Psychosis' },
    { drug: 'Lithium Carbonate 450mg', generic: 'Lithium', dose: '450', unit: 'mg', freq: 'BD', route: 'oral', indication: 'Bipolar disorder' },
    { drug: 'Sodium Valproate 500mg', generic: 'Sodium Valproate', dose: '500', unit: 'mg', freq: 'BD', route: 'oral', indication: 'Mood stabilisation' },
    { drug: 'Sertraline 100mg', generic: 'Sertraline', dose: '100', unit: 'mg', freq: 'Mane', route: 'oral', indication: 'Depression' },
    { drug: 'Sertraline 200mg', generic: 'Sertraline', dose: '200', unit: 'mg', freq: 'Mane', route: 'oral', indication: 'Depression' },
    { drug: 'Fluoxetine 20mg', generic: 'Fluoxetine', dose: '20', unit: 'mg', freq: 'Mane', route: 'oral', indication: 'Depression' },
    { drug: 'Venlafaxine 150mg', generic: 'Venlafaxine', dose: '150', unit: 'mg', freq: 'Mane', route: 'oral', indication: 'Depression / Anxiety' },
    { drug: 'Venlafaxine 300mg', generic: 'Venlafaxine', dose: '300', unit: 'mg', freq: 'Mane', route: 'oral', indication: 'Depression / Anxiety' },
    { drug: 'Clozapine 450mg', generic: 'Clozapine', dose: '450', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'Treatment-resistant schizophrenia' },
    { drug: 'Aripiprazole 15mg', generic: 'Aripiprazole', dose: '15', unit: 'mg', freq: 'Mane', route: 'oral', indication: 'Psychosis' },
    { drug: 'Quetiapine 300mg', generic: 'Quetiapine', dose: '300', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'Bipolar depression / Psychosis' },
    { drug: 'Quetiapine 50mg', generic: 'Quetiapine', dose: '50', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'Insomnia / Adjunctive' },
    { drug: 'Diazepam 5mg', generic: 'Diazepam', dose: '5', unit: 'mg', freq: 'PRN (max TDS)', route: 'oral', indication: 'Anxiety / Agitation' },
    { drug: 'Temazepam 10mg', generic: 'Temazepam', dose: '10', unit: 'mg', freq: 'Nocte PRN', route: 'oral', indication: 'Insomnia' },
    { drug: 'Metformin 500mg', generic: 'Metformin', dose: '500', unit: 'mg', freq: 'BD', route: 'oral', indication: 'Metabolic syndrome / Weight management' },
    { drug: 'Benztropine 2mg', generic: 'Benztropine', dose: '2', unit: 'mg', freq: 'BD', route: 'oral', indication: 'Extrapyramidal side effects' },
    { drug: 'Prazosin 2mg', generic: 'Prazosin', dose: '2', unit: 'mg', freq: 'Nocte', route: 'oral', indication: 'PTSD-related nightmares' },
  ];

  const medRows: SeedRow[] = [];
  for (const pid of pids) {
    // 2-4 current meds, 1-3 historical
    const numCurrent = randomInt(1, 3);
    const numCeased = randomInt(1, 3);
    const shuffled = [...medDefs].sort(() => Math.random() - 0.5);

    for (let i = 0; i < numCurrent + numCeased && i < shuffled.length; i++) {
      const m = shuffled[i];
      const isCeased = i >= numCurrent;
      const startDate = isCeased ? d(randomInt(2023, 2024), randomInt(1, 12), randomInt(1, 28)) : d(randomInt(2024, 2025), randomInt(1, 12), randomInt(1, 28));
      medRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        episode_id: openEpisodeByPatient[pid] || null,
        drug_label: m.drug,
        generic_name: m.generic,
        dose: m.dose,
        dose_unit: m.unit,
        route: m.route,
        frequency: m.freq,
        indication: m.indication,
        start_date: startDate,
        end_date: isCeased ? addDays(startDate, randomInt(30, 180)) : null,
        status: isCeased ? 'ceased' : 'active',
        reason_for_cessation: isCeased ? randomFrom(['Side effects', 'Inadequate response', 'Patient request', 'Dose optimisation', 'Switched to alternative']) : null,
        is_regular: !m.freq.includes('PRN'),
        is_prn: m.freq.includes('PRN'),
        is_lai: false,
        source: 'manual',
        prescribed_by_staff_id: randomFrom(clinicianIds),
        recorded_by_staff_id: randomFrom(clinicianIds),
        created_at: new Date(startDate),
        updated_at: new Date(),
      });
    }
  }

  const medsInserted = await safeInsert('patient_medications', medRows);
  console.log(`  Inserted ${medsInserted} medications`);

  // ── 5. RISK ASSESSMENTS ──────────────────────────────────────────────────
  console.log('\n--- Seeding Risk Assessments ---');
  const riskLevels: ('low' | 'medium' | 'high' | 'very_high')[] = ['low', 'medium', 'high'];
  const riskRows: SeedRow[] = [];

  for (const pid of pids) {
    const numRa = randomInt(2, 3);
    for (let i = 0; i < numRa; i++) {
      const raDate = d(2023 + i, randomInt(1, 12), randomInt(1, 28));
      const level = randomFrom(riskLevels);
      riskRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        episode_id: openEpisodeByPatient[pid] || null,
        assessment_type: 'clinical',
        overall_risk_level: level,
        suicide_risk: level === 'high',
        self_harm_risk: level !== 'low',
        harm_to_others_risk: Math.random() < 0.15,
        absconding_risk: Math.random() < 0.1,
        vulnerability_risk: Math.random() < 0.3,
        protective_factors: randomFrom([
          'Supportive family. Engaged with treatment team. Stable accommodation. NDIS support in place.',
          'Strong therapeutic alliance. Employment provides routine and purpose. Partner supportive.',
          'Regular attendance at appointments. Medication adherent. Peer support network through Clubhouse.',
          'Good insight into illness. Safety plan in place and practised. No substance use.',
          'Strong cultural connections. Engaged with Aboriginal Health Worker. Family support.',
        ]),
        risk_narrative: level === 'high'
          ? 'Elevated risk in context of recent deterioration in mental state. History of suicide attempt. Current passive suicidal ideation without plan. Impulsive when distressed. Substance use increases risk. Reduced social contact over past fortnight.'
          : level === 'medium'
          ? 'Moderate risk based on historical factors including previous self-harm and medication non-adherence. Currently stable but remains vulnerable during periods of psychosocial stress. Ongoing monitoring required.'
          : 'Low current risk. No active suicidal ideation or self-harm urges. Good engagement with treatment. Stable mental state. Protective factors outweigh risk factors at this time.',
        risk_management_plan: randomFrom([
          'Continue current treatment plan. Safety plan reviewed and updated. Key clinician contact fortnightly. Psychiatrist review monthly. If deterioration, present to ED or contact CATT.',
          'Maintain regular contact. Monitor medication adherence via depot clinic. Family to contact CATT if concerns. Review risk at each contact. NDIS support to maintain structure.',
          'Safety plan accessible. Crisis contacts provided. Weekly contact for next 4 weeks then review. Restrict access to means. GP notified of risk level.',
        ]),
        safety_plan_in_place: level !== 'low',
        assessed_by_id: randomFrom(clinicianIds),
        assessment_date: raDate,
        review_date: addDays(raDate, level === 'high' ? 7 : level === 'medium' ? 30 : 90),
        created_at: new Date(raDate),
        updated_at: new Date(raDate),
      });
    }
  }

  const riskInserted = await safeInsert('risk_assessments', riskRows);
  console.log(`  Inserted ${riskInserted} risk assessments`);

  // ── 6. PATIENT FLAGS ─────────────────────────────────────────────────────
  console.log('\n--- Seeding Patient Flags ---');
  const flagDefs = [
    { category: 'allergy' as const, severity: 'high' as const, title: 'Allergic to Penicillin', desc: 'Documented anaphylaxis to penicillin. Avoid all beta-lactam antibiotics.' },
    { category: 'safety' as const, severity: 'high' as const, title: 'Falls risk', desc: 'History of falls related to sedating medication. Mobility assessment completed.' },
    { category: 'safety' as const, severity: 'critical' as const, title: 'Absconding risk', desc: 'History of absconding from inpatient unit during previous admissions. Requires 1:1 nursing on IPU.' },
    { category: 'clinical' as const, severity: 'high' as const, title: 'Suicidal ideation history', desc: 'Previous suicide attempt by overdose (2023). Requires restricted medication access and weekly dispensing.' },
    { category: 'safety' as const, severity: 'medium' as const, title: 'Aggression risk when unwell', desc: 'History of physical aggression during psychotic relapse. De-escalation approach preferred.' },
    { category: 'clinical' as const, severity: 'medium' as const, title: 'Clozapine — requires blood monitoring', desc: 'On clozapine. FBC monitoring as per clozapine protocol. Do not dispense without current blood results.' },
    { category: 'allergy' as const, severity: 'medium' as const, title: 'Allergy to Sulfonamides', desc: 'Documented rash with sulfonamide antibiotics.' },
    { category: 'legal' as const, severity: 'high' as const, title: 'Treatment Order in effect', desc: 'Community Treatment Order s45 in effect. Mandatory depot antipsychotic. Review due at MHRT.' },
    { category: 'clinical' as const, severity: 'low' as const, title: 'Interpreter required — Vietnamese', desc: 'Vietnamese interpreter required for all clinical encounters. TIS booking needed 48 hours in advance.' },
    { category: 'clinical' as const, severity: 'low' as const, title: 'Advance directive on file', desc: 'Advance statement registered. Patient has nominated person. See advance directives section.' },
  ];

  const flagRows: SeedRow[] = [];
  for (let i = 0; i < pids.length; i++) {
    const numFlags = randomInt(1, 3);
    const shuffledFlags = [...flagDefs].sort(() => Math.random() - 0.5);
    for (let j = 0; j < numFlags; j++) {
      const f = shuffledFlags[j];
      flagRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pids[i],
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.desc,
        status: 'active',
        raised_by_staff_id: randomFrom(clinicianIds),
        is_header_flag: f.severity === 'critical' || f.severity === 'high',
        raised_at: new Date(d(randomInt(2023, 2025), randomInt(1, 12), randomInt(1, 28))),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  const flagsInserted = await safeInsert('patient_flags', flagRows);
  console.log(`  Inserted ${flagsInserted} patient flags`);

  // ── 7. APPOINTMENTS (60+) ────────────────────────────────────────────────
  console.log('\n--- Seeding Appointments ---');
  const apptTypes: ('initial' | 'follow_up' | 'assessment' | 'telehealth' | 'clinical_review')[] = ['follow_up', 'follow_up', 'clinical_review', 'telehealth', 'assessment', 'initial'];
  const apptStatuses: ('scheduled' | 'completed' | 'cancelled' | 'no_show')[] = ['completed', 'completed', 'completed', 'completed', 'scheduled', 'scheduled', 'cancelled', 'no_show'];
  const apptRows: SeedRow[] = [];

  // Past month appointments
  for (let dayOffset = -30; dayOffset <= 14; dayOffset++) {
    const numAppts = randomInt(1, 4);
    for (let j = 0; j < numAppts; j++) {
      const apptDate = addDays('2026-03-27', dayOffset);
      const hour = randomInt(8, 16);
      const startTime = new Date(`${apptDate}T${String(hour).padStart(2, '0')}:00:00+11:00`);
      const endTime = new Date(startTime.getTime() + randomFrom([30, 45, 60]) * 60000);
      const isFuture = dayOffset > 0;
      const status = isFuture ? randomFrom(['scheduled', 'scheduled', 'confirmed'] as const) : randomFrom(apptStatuses);

      apptRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: randomFrom(pids),
        clinician_id: randomFrom(clinicianIds),
        episode_id: null,
        start_time: startTime,
        end_time: endTime,
        status,
        type: randomFrom(apptTypes),
        notes: isFuture ? null : randomFrom([
          'Routine follow-up. Patient appeared well.',
          'Medication review appointment.',
          'Risk assessment review.',
          'Care plan discussion.',
          null,
        ]),
        cancellation_reason: status === 'cancelled' ? randomFrom(['Patient unwell', 'Patient request', 'Clinician unavailable', 'No reason given']) : null,
        created_at: new Date(apptDate),
        updated_at: new Date(apptDate),
      });
    }
  }

  const apptsInserted = await safeInsert('appointments', apptRows);
  console.log(`  Inserted ${apptsInserted} appointments`);

  // ── 8. REFERRALS (12+) ──────────────────────────────────────────────────
  console.log('\n--- Seeding Referrals ---');
  const referralStatuses = ['received', 'under_review', 'accepted', 'discussed', 'appointment_booked', 'accepted', 'accepted'] as const;
  const referralUrgencies = ['routine', 'routine', 'urgent', 'soon'] as const;
  const referralRows: SeedRow[] = [];
  const referralDefs = [
    { from: 'Mill Park Medical Centre', provider: 'Dr Simmons', reason: 'Worsening depression, poor response to SSRI. PHQ-9 score 22. Requesting specialist psychiatric assessment.' },
    { from: 'Box Hill Hospital ED', provider: 'Dr Tran', reason: 'Acute psychotic presentation. First episode. Stabilised in ED, requires community follow-up and FEP pathway.' },
    { from: 'Sunshine Medical Clinic', provider: 'Dr Patel', reason: 'Bipolar disorder — recent manic episode. Non-adherent with lithium. GP unable to manage safely in primary care.' },
    { from: 'Heidelberg Repatriation Hospital', provider: 'Dr Wong', reason: 'Complex PTSD following military service. Requiring specialist trauma-focused therapy beyond primary care capacity.' },
    { from: 'Footscray Community Health', provider: 'Ms Henderson (SW)', reason: 'Complex psychosocial needs. Homelessness risk. Co-occurring substance use and anxiety. Requires assertive outreach.' },
    { from: 'Royal Melbourne Hospital', provider: 'Dr Nguyen', reason: 'Schizoaffective disorder — discharge from acute unit. Requires LAI depot administration and community monitoring.' },
    { from: 'Northern Hospital ED', provider: 'Dr Smith', reason: 'Deliberate self-harm — laceration to forearm. Sutured in ED. Psychiatric assessment completed, safe for discharge to community team.' },
    { from: 'Self-referral', provider: null, reason: 'Consumer self-referral. Reports increasing anxiety and insomnia over 3 months. Previously treated by private psychiatrist (no longer attending).' },
    { from: 'Monash Health Adult MH', provider: 'Dr Li', reason: 'Transfer of care — patient relocated to catchment area. Diagnosis: Paranoid Schizophrenia, stable on paliperidone LAI.' },
    { from: 'Preston Medical Clinic', provider: 'Dr Ahmed', reason: 'Treatment-resistant depression. Failed two adequate SSRI trials. Requesting tertiary assessment and consideration of augmentation strategies.' },
    { from: 'Dandenong Hospital', provider: 'Dr Kumar', reason: 'Eating disorder with comorbid depression. BMI 16.2. Medically stabilised, requires community mental health follow-up.' },
    { from: 'Alfred Hospital', provider: 'Dr Taylor', reason: 'Post-partum psychosis. Discharged from mother-baby unit. Requires intensive community follow-up for first 6 weeks.' },
  ];

  for (let i = 0; i < referralDefs.length; i++) {
    const r = referralDefs[i];
    const refDate = d(2023 + Math.floor(i / 4), randomInt(1, 12), randomInt(1, 28));
    referralRows.push({
      id: uuid(),
      clinic_id: C,
      patient_id: pids[i % pids.length],
      referral_number: `REF-${2023 + Math.floor(i / 4)}-${String(i + 1).padStart(4, '0')}`,
      referral_date: refDate,
      source: r.from === 'Self-referral' ? 'self' : 'external',
      from_service: r.from,
      from_provider_name: r.provider,
      reason: r.reason,
      urgency: randomFrom(referralUrgencies),
      status: randomFrom(referralStatuses),
      received_at: new Date(refDate),
      assigned_to_staff_id: randomFrom(clinicianIds),
      sla_due_date: addDays(refDate, 14),
      created_at: new Date(refDate),
      updated_at: new Date(),
    });
  }

  const referralsInserted = await safeInsert('referrals', referralRows);
  console.log(`  Inserted ${referralsInserted} referrals`);

  // ── 9. LAI SCHEDULES + ADMINISTRATIONS ───────────────────────────────────
  console.log('\n--- Seeding LAI Data ---');
  const laiPatients = pids.slice(0, 4); // First 4 patients get LAI
  const laiDrugs = [
    { drug: 'Paliperidone Palmitate', dose: '150', freq: 28, site: 'deltoid' },
    { drug: 'Zuclopenthixol Decanoate', dose: '200', freq: 14, site: 'gluteal' },
    { drug: 'Aripiprazole LAI (Abilify Maintena)', dose: '400', freq: 28, site: 'gluteal' },
    { drug: 'Paliperidone Palmitate', dose: '100', freq: 28, site: 'deltoid' },
  ];

  const laiScheduleRows: SeedRow[] = [];
  const laiGivenRows: SeedRow[] = [];

  for (let i = 0; i < laiPatients.length; i++) {
    const pid = laiPatients[i];
    const drug = laiDrugs[i];
    const schedId = uuid();
    const startDate = d(2025, randomInt(1, 6), randomInt(1, 28));

    // Calculate last given and next due
    const monthsHistory = 8;
    let lastGivenDate = startDate;
    const givenDates: string[] = [];
    let curDate = startDate;
    for (let m = 0; m < monthsHistory; m++) {
      givenDates.push(curDate);
      lastGivenDate = curDate;
      curDate = addDays(curDate, drug.freq);
    }

    const nextDue = addDays(lastGivenDate, drug.freq);

    laiScheduleRows.push({
      id: schedId,
      clinic_id: C,
      patient_id: pid,
      prescriber_staff_id: randomFrom(clinicianIds),
      drug_name: drug.drug,
      dose_mg: drug.dose,
      frequency_days: drug.freq,
      injection_site: drug.site,
      injection_technique: 'IM',
      indication: 'Maintenance antipsychotic for schizophrenia / schizoaffective disorder',
      start_date: startDate,
      first_due_date: startDate,
      next_due_date: nextDue,
      last_given_date: lastGivenDate,
      status: 'active',
      notes: `${drug.drug} ${drug.dose}mg every ${drug.freq} days. Good tolerance. Continue indefinitely per treatment plan.`,
      created_at: new Date(startDate),
      updated_at: new Date(),
    });

    // LAI administrations
    for (const gDate of givenDates) {
      if (new Date(gDate) > new Date('2026-03-27')) continue;
      laiGivenRows.push({
        id: uuid(),
        clinic_id: C,
        lai_schedule_id: schedId,
        patient_id: pid,
        administered_by_staff_id: randomFrom(clinicianIds),
        outcome: Math.random() < 0.9 ? 'given' : 'deferred',
        given_date: gDate,
        dose_given_mg: drug.dose,
        injection_site: drug.site,
        batch_number: `BATCH-${randomInt(10000, 99999)}`,
        expires_at: addDays(gDate, 365),
        next_due_date: addDays(gDate, drug.freq),
        notes: 'Administered without complication. Patient tolerated well. Observed for 30 minutes post-injection.',
        created_at: new Date(gDate),
        updated_at: new Date(gDate),
      });
    }
  }

  const laiSchedInserted = await safeInsert('lai_schedules', laiScheduleRows);
  const laiGivenInserted = await safeInsert('lai_given', laiGivenRows);
  console.log(`  Inserted ${laiSchedInserted} LAI schedules, ${laiGivenInserted} LAI administrations`);

  // ── 10. CLOZAPINE REGISTRATIONS + BLOOD RESULTS ─────────────────────────
  console.log('\n--- Seeding Clozapine Data ---');
  const clozPatients = pids.slice(4, 6); // patients 5 & 6 on clozapine
  const clozRegRows: SeedRow[] = [];
  const clozBloodRows: SeedRow[] = [];

  for (let i = 0; i < clozPatients.length; i++) {
    const pid = clozPatients[i];
    const regId = uuid();
    const regDate = d(2025, i + 3, 1);

    clozRegRows.push({
      id: regId,
      clinic_id: C,
      patient_id: pid,
      prescriber_staff_id: randomFrom(clinicianIds),
      registration_date: regDate,
      dispenser_pharmacy: randomFrom(['Chemist Warehouse Box Hill', 'Priceline Pharmacy Fitzroy', 'Amcal Pharmacy Heidelberg']),
      current_dose_mg: i === 0 ? 450 : 350,
      titration_phase: 'maintenance',
      monitoring_week: 40 + i * 10,
      monitoring_frequency: 'monthly',
      anc_status: 'normal',
      next_blood_due_date: addDays('2026-03-27', randomInt(1, 14)),
      physical_health_check_due: addDays('2026-03-27', randomInt(30, 90)),
      notes: `Registered with Clozapine Monitoring Service. ${i === 0 ? 'Dose stable at 450mg for 12 months.' : 'Dose recently increased from 300mg to 350mg.'}`,
      created_at: new Date(regDate),
      updated_at: new Date(),
    });

    // Blood results over 8 months
    for (let m = 0; m < 8; m++) {
      const collDate = addDays(regDate, m * 28);
      if (new Date(collDate) > new Date('2026-03-27')) continue;
      const anc = parseFloat((3.0 + Math.random() * 2.5).toFixed(2));
      const wbc = parseFloat((5.5 + Math.random() * 3).toFixed(2));
      const ancStatus = anc < 1.5 ? 'amber' : anc < 0.5 ? 'red' : 'normal';

      clozBloodRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        registration_id: regId,
        recorded_by_staff_id: randomFrom(clinicianIds),
        collection_date: collDate,
        resulted_date: addDays(collDate, 1),
        anc_value: anc,
        wbc_value: wbc,
        neutrophils_pct: parseFloat((45 + Math.random() * 20).toFixed(2)),
        anc_status: ancStatus,
        flag_raised: ancStatus !== 'normal',
        lab_name: 'Melbourne Pathology',
        clinical_notes: `Routine clozapine monitoring. ANC ${anc}, WBC ${wbc}. ${ancStatus === 'normal' ? 'Within normal limits — safe to dispense.' : 'ALERT: ANC below threshold. Repeat FBC urgently.'}`,
        created_at: new Date(collDate),
        updated_at: new Date(collDate),
      });
    }
  }

  const clozRegInserted = await safeInsert('clozapine_registrations', clozRegRows);
  const clozBloodInserted = await safeInsert('clozapine_blood_results', clozBloodRows);
  console.log(`  Inserted ${clozRegInserted} clozapine registrations, ${clozBloodInserted} blood results`);

  // ── 11. PATHOLOGY ORDERS + RESULTS ───────────────────────────────────────
  console.log('\n--- Seeding Pathology ---');
  const pathPanels = [
    { panel: 'Lithium Level', tests: ['Lithium'], results: [{ code: 'Li', name: 'Lithium Level', val: () => (0.5 + Math.random() * 0.6).toFixed(2), unit: 'mmol/L', ref: '0.6 - 1.0', abnFn: (v: string) => parseFloat(v) < 0.6 ? 'low' : parseFloat(v) > 1.0 ? 'high' : 'normal' }] },
    { panel: 'Full Blood Count', tests: ['FBC'], results: [
      { code: 'WBC', name: 'White Cell Count', val: () => (4.0 + Math.random() * 7).toFixed(1), unit: 'x10^9/L', ref: '4.0 - 11.0', abnFn: (v: string) => parseFloat(v) < 4 ? 'low' : parseFloat(v) > 11 ? 'high' : 'normal' },
      { code: 'Hb', name: 'Haemoglobin', val: () => (120 + Math.random() * 40).toFixed(0), unit: 'g/L', ref: '120 - 160', abnFn: (v: string) => parseFloat(v) < 120 ? 'low' : parseFloat(v) > 160 ? 'high' : 'normal' },
    ]},
    { panel: 'Metabolic Panel', tests: ['Glucose', 'HbA1c', 'Lipids'], results: [
      { code: 'GLU', name: 'Fasting Glucose', val: () => (4.0 + Math.random() * 3).toFixed(1), unit: 'mmol/L', ref: '3.5 - 6.0', abnFn: (v: string) => parseFloat(v) > 6 ? 'high' : 'normal' },
      { code: 'HbA1c', name: 'HbA1c', val: () => (4.5 + Math.random() * 2).toFixed(1), unit: '%', ref: '< 6.0', abnFn: (v: string) => parseFloat(v) > 6 ? 'high' : 'normal' },
      { code: 'CHOL', name: 'Total Cholesterol', val: () => (3.5 + Math.random() * 3).toFixed(1), unit: 'mmol/L', ref: '< 5.5', abnFn: (v: string) => parseFloat(v) > 5.5 ? 'high' : 'normal' },
    ]},
    { panel: 'Liver Function Tests', tests: ['LFT'], results: [
      { code: 'ALT', name: 'Alanine Aminotransferase', val: () => (10 + Math.random() * 50).toFixed(0), unit: 'U/L', ref: '< 40', abnFn: (v: string) => parseFloat(v) > 40 ? 'high' : 'normal' },
      { code: 'GGT', name: 'Gamma GT', val: () => (15 + Math.random() * 60).toFixed(0), unit: 'U/L', ref: '< 50', abnFn: (v: string) => parseFloat(v) > 50 ? 'high' : 'normal' },
    ]},
    { panel: 'Thyroid Function', tests: ['TFT'], results: [
      { code: 'TSH', name: 'Thyroid Stimulating Hormone', val: () => (0.5 + Math.random() * 4).toFixed(2), unit: 'mIU/L', ref: '0.5 - 4.5', abnFn: (v: string) => parseFloat(v) < 0.5 ? 'low' : parseFloat(v) > 4.5 ? 'high' : 'normal' },
    ]},
    { panel: 'Renal Function', tests: ['UEC'], results: [
      { code: 'Creat', name: 'Creatinine', val: () => (50 + Math.random() * 60).toFixed(0), unit: 'umol/L', ref: '50 - 100', abnFn: (v: string) => parseFloat(v) > 100 ? 'high' : 'normal' },
      { code: 'eGFR', name: 'eGFR', val: () => (60 + Math.random() * 50).toFixed(0), unit: 'mL/min', ref: '> 60', abnFn: (v: string) => parseFloat(v) < 60 ? 'low' : 'normal' },
    ]},
    { panel: 'Clozapine Level', tests: ['Clozapine'], results: [
      { code: 'CLOZ', name: 'Clozapine Level', val: () => (300 + Math.random() * 200).toFixed(0), unit: 'mcg/L', ref: '350 - 600', abnFn: (v: string) => parseFloat(v) < 350 ? 'low' : parseFloat(v) > 600 ? 'high' : 'normal' },
    ]},
    { panel: 'Prolactin', tests: ['Prolactin'], results: [
      { code: 'PRL', name: 'Prolactin', val: () => (100 + Math.random() * 800).toFixed(0), unit: 'mIU/L', ref: '< 500', abnFn: (v: string) => parseFloat(v) > 500 ? 'high' : 'normal' },
    ]},
  ];

  const pathOrderRows: SeedRow[] = [];
  const pathResultRows: SeedRow[] = [];
  let orderNum = 1;

  for (const pid of pids.slice(0, 15)) {
    const numOrders = randomInt(2, 5);
    for (let j = 0; j < numOrders; j++) {
      const panel = randomFrom(pathPanels);
      const orderDate = d(2024 + Math.floor(j / 3), randomInt(1, 12), randomInt(1, 28));
      const orderId = uuid();
      const orderNumber = `PATH-${String(orderNum++).padStart(6, '0')}`;

      pathOrderRows.push({
        id: orderId,
        clinic_id: C,
        patient_id: pid,
        ordered_by_id: randomFrom(clinicianIds),
        order_number: orderNumber,
        panel_name: panel.panel,
        tests: panel.tests,
        urgency: 'routine',
        clinical_notes: `Routine ${panel.panel.toLowerCase()} monitoring. Please fax results to clinic.`,
        fasting: panel.panel.includes('Metabolic') || panel.panel.includes('Lithium'),
        copy_to_gp: true,
        status: 'complete',
        created_at: new Date(orderDate),
        updated_at: new Date(orderDate),
      });

      // Results for each test in panel
      for (const r of panel.results) {
        const val = r.val();
        pathResultRows.push({
          id: uuid(),
          clinic_id: C,
          pathology_order_id: orderId,
          patient_id: pid,
          test_code: r.code,
          test_name: r.name,
          result_value: val,
          result_unit: r.unit,
          reference_range: r.ref,
          abnormal_flag: r.abnFn(val),
          result_status: 'final',
          collection_date: orderDate,
          result_date: addDays(orderDate, randomInt(1, 3)),
          performing_lab: randomFrom(['Melbourne Pathology', 'Dorevitch Pathology', 'Australian Clinical Labs']),
          is_critical: false,
          created_at: new Date(orderDate),
          updated_at: new Date(orderDate),
        });
      }
    }
  }

  const pathOrdersInserted = await safeInsert('pathology_orders', pathOrderRows);
  const pathResultsInserted = await safeInsert('pathology_results', pathResultRows);
  console.log(`  Inserted ${pathOrdersInserted} pathology orders, ${pathResultsInserted} results`);

  // ── 12. CORRESPONDENCE LETTERS ───────────────────────────────────────────
  console.log('\n--- Seeding Correspondence ---');
  const letterDefs = [
    { type: 'gp_letter', subj: 'Community Treatment Update', recipient: 'Dr Simmons, Mill Park Medical Centre' },
    { type: 'gp_letter', subj: 'Discharge Summary — Inpatient Admission', recipient: 'Dr Patel, Box Hill Medical Centre' },
    { type: 'referral', subj: 'Referral to Psychology — Trauma-Focused CBT', recipient: 'Ms Henderson, Clinical Psychologist' },
    { type: 'gp_letter', subj: 'Annual Review and Medication Update', recipient: 'Dr Tran, Springvale Family Practice' },
    { type: 'general', subj: 'Report for NDIS Plan Review', recipient: 'NDIS Planning Team' },
    { type: 'gp_letter', subj: 'Clozapine Initiation Notification', recipient: 'Dr Wong, Heidelberg Medical Centre' },
    { type: 'referral', subj: 'Referral to Dietitian — Metabolic Monitoring', recipient: 'Ms Pearce, APD, Community Health' },
    { type: 'general', subj: 'MHRT Report — Treatment Order Review', recipient: 'Mental Health Review Tribunal, Victoria' },
    { type: 'gp_letter', subj: 'LAI Depot Commencement Notification', recipient: 'Dr Ahmed, Preston Medical Clinic' },
    { type: 'general', subj: 'Medico-legal Report — Fitness for Work', recipient: 'Employer HR Department' },
    { type: 'referral', subj: 'Referral to Occupational Therapy', recipient: 'OT Department, Community Health' },
    { type: 'gp_letter', subj: 'Medication Change Notification', recipient: 'Dr Li, Dandenong Medical' },
  ];

  const letterRows: SeedRow[] = [];
  for (let i = 0; i < letterDefs.length; i++) {
    const l = letterDefs[i];
    const lDate = d(randomInt(2024, 2026), randomInt(1, 12), randomInt(1, 28));
    letterRows.push({
      id: uuid(),
      patient_id: pids[i % pids.length],
      clinic_id: C,
      episode_id: openEpisodeByPatient[pids[i % pids.length]] || null,
      author_id: randomFrom(clinicianIds),
      recipient_name: l.recipient,
      letter_type: l.type,
      subject: l.subj,
      content: `Dear ${l.recipient.split(',')[0]},\n\nRe: ${patientIdToName[pids[i % pids.length]] || 'Patient'}\n\nI am writing to provide an update regarding the above-named patient who is under the care of our community mental health service.\n\nThe patient has been attending regular appointments and their mental state has been [stable/improving/fluctuating]. Current medications include [see medication list]. Recent pathology results are [within normal limits/notable for...].\n\nPlease do not hesitate to contact our team if you have any concerns.\n\nKind regards,\nCommunity Mental Health Team\nGood Health MH`,
      status: randomFrom(['sent', 'sent', 'draft']),
      created_at: new Date(lDate),
      sent_at: Math.random() > 0.3 ? new Date(lDate) : null,
    });
  }

  const lettersInserted = await safeInsert('correspondence_letters', letterRows);
  console.log(`  Inserted ${lettersInserted} correspondence letters`);

  // ── 13. OUTCOME MEASURES ─────────────────────────────────────────────────
  console.log('\n--- Seeding Outcome Measures ---');
  const measureRows: SeedRow[] = [];
  const occasions = ['admission', 'review', '91_day', 'discharge'];

  for (const pid of pids.slice(0, 15)) {
    // HoNOS at 2-3 time points
    const numHonos = randomInt(2, 3);
    for (let j = 0; j < numHonos; j++) {
      const mDate = d(2024 + Math.floor(j / 2), randomInt(1, 12), randomInt(1, 28));
      const baseScore = 20 - j * randomInt(2, 5); // Improvement over time
      measureRows.push({
        id: uuid(),
        patient_id: pid,
        clinic_id: C,
        episode_id: openEpisodeByPatient[pid] || null,
        staff_id: randomFrom(clinicianIds),
        measure_type: 'HoNOS',
        collection_occasion: occasions[j % occasions.length],
        total_score: Math.max(baseScore, 4),
        items: JSON.stringify({
          overactive_behaviour: randomInt(0, 4),
          non_accidental_self_injury: randomInt(0, 3),
          problem_drinking: randomInt(0, 3),
          cognitive_problems: randomInt(0, 3),
          physical_illness: randomInt(0, 3),
          hallucinations_delusions: randomInt(0, 4),
          depressed_mood: randomInt(0, 4),
          other_mental: randomInt(0, 3),
          relationships: randomInt(0, 3),
          activities_daily_living: randomInt(0, 3),
          living_conditions: randomInt(0, 3),
          occupation: randomInt(0, 3),
        }),
        notes: `HoNOS completed at ${occasions[j % occasions.length]}. Total score ${Math.max(baseScore, 4)}.`,
        created_at: new Date(mDate),
      });
    }

    // K10 at 2 time points
    for (let j = 0; j < 2; j++) {
      const mDate = d(2024 + j, randomInt(1, 6), randomInt(1, 28));
      const score = 30 - j * randomInt(3, 8);
      measureRows.push({
        id: uuid(),
        patient_id: pid,
        clinic_id: C,
        episode_id: openEpisodeByPatient[pid] || null,
        staff_id: randomFrom(clinicianIds),
        measure_type: 'K10',
        collection_occasion: occasions[j],
        total_score: Math.max(score, 10),
        items: JSON.stringify({ k10_total: Math.max(score, 10) }),
        notes: `K10 score ${Math.max(score, 10)}. ${score > 25 ? 'Very high level of psychological distress.' : score > 20 ? 'High level of psychological distress.' : score > 15 ? 'Moderate level of psychological distress.' : 'Low level of psychological distress.'}`,
        created_at: new Date(mDate),
      });
    }

    // PHQ-9 for some patients
    if (Math.random() > 0.4) {
      for (let j = 0; j < 2; j++) {
        const mDate = d(2024 + j, randomInt(6, 12), randomInt(1, 28));
        const score = 18 - j * randomInt(3, 7);
        measureRows.push({
          id: uuid(),
          patient_id: pid,
          clinic_id: C,
          episode_id: openEpisodeByPatient[pid] || null,
          staff_id: randomFrom(clinicianIds),
          measure_type: 'PHQ-9',
          collection_occasion: 'review',
          total_score: Math.max(score, 2),
          items: JSON.stringify({ phq9_total: Math.max(score, 2) }),
          notes: `PHQ-9 score ${Math.max(score, 2)}. ${score > 19 ? 'Severe depression.' : score > 14 ? 'Moderately severe depression.' : score > 9 ? 'Moderate depression.' : score > 4 ? 'Mild depression.' : 'Minimal depression.'}`,
          created_at: new Date(mDate),
        });
      }
    }

    // GAD-7 for some patients
    if (Math.random() > 0.5) {
      const mDate = d(2025, randomInt(1, 12), randomInt(1, 28));
      const score = randomInt(3, 18);
      measureRows.push({
        id: uuid(),
        patient_id: pid,
        clinic_id: C,
        episode_id: openEpisodeByPatient[pid] || null,
        staff_id: randomFrom(clinicianIds),
        measure_type: 'GAD-7',
        collection_occasion: 'review',
        total_score: score,
        items: JSON.stringify({ gad7_total: score }),
        notes: `GAD-7 score ${score}. ${score > 14 ? 'Severe anxiety.' : score > 9 ? 'Moderate anxiety.' : score > 4 ? 'Mild anxiety.' : 'Minimal anxiety.'}`,
        created_at: new Date(mDate),
      });
    }
  }

  const measuresInserted = await safeInsert('outcome_measures', measureRows);
  console.log(`  Inserted ${measuresInserted} outcome measures`);

  // ── 14. CONTACT RECORDS ──────────────────────────────────────────────────
  console.log('\n--- Seeding Contact Records ---');
  const contactTypes = ['face_to_face', 'phone', 'telehealth', 'home_visit', 'group'];
  const contactMedia = ['in_person', 'telephone', 'video', 'in_person', 'in_person'];
  const contactRows: SeedRow[] = [];

  for (const pid of pids.slice(0, 18)) {
    const numContacts = randomInt(4, 10);
    for (let j = 0; j < numContacts; j++) {
      const cDate = d(2024 + Math.floor(j / 5), randomInt(1, 12), randomInt(1, 28));
      const cType = randomFrom(contactTypes);
      const cIdx = contactTypes.indexOf(cType);
      contactRows.push({
        id: uuid(),
        patient_id: pid,
        clinic_id: C,
        episode_id: openEpisodeByPatient[pid] || null,
        staff_id: randomFrom(clinicianIds),
        contact_type: cType,
        contact_date: cDate,
        contact_time: `${randomInt(8, 17).toString().padStart(2, '0')}:${randomFrom(['00', '15', '30', '45'])}`,
        duration_min: randomFrom([15, 20, 30, 45, 60, 90]),
        location: randomFrom(['Community Clinic', 'Patient Home', 'Inpatient Unit', 'Phone', 'Video Conference']),
        contact_medium: contactMedia[cIdx],
        program: randomFrom(['Adult Community', 'ACIS', 'Inpatient', null]),
        service_recipients: randomFrom(['Consumer', 'Consumer and Carer', 'Carer only']),
        is_reportable: true,
        num_providing: 1,
        num_receiving: cType === 'group' ? randomInt(3, 8) : 1,
        content: `${cType.replace(/_/g, ' ')} contact completed. Patient ${randomFrom(['engaged well', 'was guarded initially but warmed up', 'was cooperative', 'presented as distressed but settled with support'])}. ${randomFrom(['No immediate concerns.', 'Risk reviewed — unchanged.', 'Medication adherence discussed.', 'Follow-up arranged.'])}`,
        status: 'signed',
        created_at: new Date(cDate),
      });
    }
  }

  const contactsInserted = await safeInsert('contact_records', contactRows);
  console.log(`  Inserted ${contactsInserted} contact records`);

  // ── 15. SAFETY PLANS ─────────────────────────────────────────────────────
  console.log('\n--- Seeding Safety Plans ---');
  const safetyRows: SeedRow[] = [];
  const highRiskPatients = pids.slice(0, 6);

  for (const pid of highRiskPatients) {
    const pName = patientIdToName[pid] || 'patient';
    safetyRows.push({
      id: uuid(),
      patient_id: pid,
      clinic_id: C,
      content: JSON.stringify({
        warning_signs: [
          'Increased irritability or agitation',
          'Withdrawing from friends and family',
          'Not sleeping or sleeping too much',
          'Increase in substance use',
          'Talking about feeling hopeless or being a burden',
        ],
        coping_strategies: [
          'Go for a walk or exercise',
          'Practice deep breathing (4-7-8 technique)',
          'Call a friend or family member',
          'Listen to calming music',
          'Use grounding techniques (5 senses exercise)',
          'Write in journal',
        ],
        people_to_contact: [
          { name: 'Key Clinician', phone: '03 9876 5432', role: 'Mental health clinician' },
          { name: 'CATT (Crisis Team)', phone: '1300 000 000', role: 'After-hours crisis service' },
          { name: 'Lifeline', phone: '13 11 14', role: '24/7 crisis support' },
          { name: 'Emergency', phone: '000', role: 'If in immediate danger' },
        ],
        professional_contacts: [
          { name: 'Community Mental Health', phone: '03 9876 5432' },
          { name: 'Psychiatrist', phone: '03 9876 5400' },
          { name: 'GP', phone: '03 9870 0000' },
        ],
        making_environment_safe: [
          'Remove or lock away medications (weekly dispensing in place)',
          'Remove sharps from home',
          'Stay with someone trusted when feeling unsafe',
          'Go to a safe place (e.g., family member\'s home)',
        ],
        reasons_for_living: [
          `${pName}'s family and children`,
          'Pets',
          'Wanting to get better',
          'Goals for the future (employment, study)',
          'Spiritual beliefs',
        ],
      }),
      status: 'active',
      created_at: new Date(d(2025, randomInt(1, 12), randomInt(1, 28))),
      updated_at: new Date(),
    });
  }

  const safetyInserted = await safeInsert('safety_plans', safetyRows);
  console.log(`  Inserted ${safetyInserted} safety plans`);

  // ── 16. LEGAL ORDERS ─────────────────────────────────────────────────────
  console.log('\n--- Seeding Legal Orders ---');
  // First ensure we have legal_order_types
  let orderTypes = await db('legal_order_types').select('id', 'name');
  if (orderTypes.length === 0) {
    const types = [
      { id: uuid(), code: 'AO_S29', name: 'Assessment Order (s29)', jurisdiction: 'VIC', max_duration_days: 28, requires_tribunal: false, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: uuid(), code: 'TTO_S45', name: 'Temporary Treatment Order (s45)', jurisdiction: 'VIC', max_duration_days: 28, requires_tribunal: false, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: uuid(), code: 'TO_S55', name: 'Treatment Order (s55)', jurisdiction: 'VIC', max_duration_days: 180, requires_tribunal: true, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: uuid(), code: 'CTO', name: 'Community Treatment Order', jurisdiction: 'VIC', max_duration_days: 365, requires_tribunal: true, is_active: true, created_at: new Date(), updated_at: new Date() },
      { id: uuid(), code: 'STO', name: 'Secure Treatment Order', jurisdiction: 'VIC', max_duration_days: 180, requires_tribunal: true, is_active: true, created_at: new Date(), updated_at: new Date() },
    ];
    try {
      await db('legal_order_types').insert(types);
      orderTypes = types;
      console.log('  Created legal_order_types');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`  [warn] Could not create legal_order_types: ${message.substring(0, 80)}`);
      orderTypes = [];
    }
  }

  if (orderTypes.length > 0) {
    const legalRows: SeedRow[] = [];
    const legalPatients = pids.slice(0, 3);

    for (let i = 0; i < 3; i++) {
      const pid = legalPatients[i];
      const orderType = orderTypes[i % orderTypes.length];
      const startDate = d(2025, randomInt(1, 8), randomInt(1, 28));
      const isExpired = i === 2;

      legalRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        order_type_id: orderType.id,
        order_number: `MHA-${2025}-${String(i + 1).padStart(4, '0')}`,
        start_date: startDate,
        expires_at: addDays(startDate, i === 0 ? 28 : 180),
        review_date: addDays(startDate, i === 0 ? 14 : 90),
        status: isExpired ? 'expired' : 'active',
        issuing_authority: 'Mental Health Tribunal Victoria',
        conditions: randomFrom([
          'Patient must attend all scheduled appointments. Must accept prescribed medication including depot antipsychotic. Must reside at approved address. Must abstain from illicit substances.',
          'Community treatment order. Must attend fortnightly appointments with treating team. Must accept prescribed oral medication. Random UDS may be conducted.',
          'Involuntary inpatient treatment. Patient to remain on gazetted unit. Leave at discretion of treating team. Medication as prescribed.',
        ]),
        notes: `Legal order created following ${randomFrom(['MHRT hearing', 'clinical deterioration and risk assessment', 'assessment by authorised psychiatrist'])}. ${isExpired ? 'Order has expired and was not renewed.' : 'Order is active. Next review scheduled.'}`,
        created_by_staff_id: randomFrom(clinicianIds),
        created_at: new Date(startDate),
        updated_at: new Date(),
      });
    }

    const legalInserted = await safeInsert('legal_orders', legalRows);
    console.log(`  Inserted ${legalInserted} legal orders`);

    // MHA Reviews
    const allLegalOrders = await db('legal_orders').where({ clinic_id: C }).select('id', 'patient_id', 'start_date');
    const mhaRows: SeedRow[] = [];

    for (const lo of allLegalOrders) {
      const numReviews = randomInt(1, 3);
      for (let j = 0; j < numReviews; j++) {
        const revDate = addDays(lo.start_date, (j + 1) * 30);
        mhaRows.push({
          id: uuid(),
          clinic_id: C,
          patient_id: lo.patient_id,
          legal_order_id: lo.id,
          review_type: randomFrom(['psychiatrist_review', 'tribunal_hearing', 'clinical_review']),
          review_date: revDate,
          outcome: randomFrom(['order_continued', 'order_varied', 'order_revoked', 'adjourned']),
          notes: `Review conducted as per Mental Health Act requirements. ${randomFrom(['Patient continues to meet criteria for involuntary treatment.', 'Patient showing improvement. Consider voluntary status at next review.', 'Treatment order continued — patient lacks insight and would likely disengage if order revoked.'])}`,
          reviewed_by_staff_id: randomFrom(clinicianIds),
          created_at: new Date(revDate),
          updated_at: new Date(revDate),
        });
      }
    }

    const mhaInserted = await safeInsert('mha_reviews', mhaRows);
    console.log(`  Inserted ${mhaInserted} MHA reviews`);
  }

  // ── 17. AUDIT LOG ────────────────────────────────────────────────────────
  console.log('\n--- Seeding Audit Log ---');
  const auditActions = ['login', 'logout', 'view_patient', 'view_patient', 'view_patient', 'create_note', 'sign_note', 'prescribe', 'view_referral', 'update_patient', 'create_appointment', 'view_dashboard', 'export_report', 'update_risk_assessment'];
  const auditModules = ['auth', 'auth', 'patient', 'patient', 'patient', 'clinical_notes', 'clinical_notes', 'prescriptions', 'referrals', 'patient', 'appointments', 'dashboard', 'reports', 'risk_assessment'];
  const auditRows: SeedRow[] = [];

  for (let dayOffset = -1095; dayOffset <= 0; dayOffset += randomInt(1, 3)) {
    const numEvents = randomInt(3, 12);
    for (let j = 0; j < numEvents; j++) {
      const idx = randomInt(0, auditActions.length - 1);
      const eventDate = addDays('2026-03-27', dayOffset);
      const staff = randomFrom(staffRows);
      auditRows.push({
        id: uuid(),
        clinic_id: C,
        userid: staff.id,
        username: `${staff.given_name} ${staff.family_name}`,
        action: auditActions[idx],
        module: auditModules[idx],
        entitytype: auditModules[idx] === 'patient' ? 'patient' : auditModules[idx] === 'clinical_notes' ? 'clinical_note' : auditModules[idx],
        entityid: randomFrom(pids),
        details: JSON.stringify({ ip: '10.0.0.' + randomInt(1, 254), userAgent: 'Mozilla/5.0 Chrome/120' }),
        ipaddress: '10.0.0.' + randomInt(1, 254),
        useragent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120',
        created_at: new Date(`${eventDate}T${String(randomInt(7, 18)).padStart(2, '0')}:${String(randomInt(0, 59)).padStart(2, '0')}:00+11:00`),
      });
    }
  }

  const auditInserted = await safeInsert('audit_log', auditRows);
  console.log(`  Inserted ${auditInserted} audit log entries`);

  // ── 18. DIAGNOSES ────────────────────────────────────────────────────────
  console.log('\n--- Seeding Diagnoses ---');
  const diagDefs = [
    { icd: 'F20.0', desc: 'Paranoid Schizophrenia', primary: true },
    { icd: 'F25.0', desc: 'Schizoaffective Disorder, Manic Type', primary: true },
    { icd: 'F31.3', desc: 'Bipolar Affective Disorder, Current Episode Mild or Moderate Depression', primary: true },
    { icd: 'F33.2', desc: 'Major Depressive Disorder, Recurrent, Severe', primary: true },
    { icd: 'F43.1', desc: 'Post-Traumatic Stress Disorder', primary: true },
    { icd: 'F40.1', desc: 'Social Anxiety Disorder', primary: false },
    { icd: 'F10.2', desc: 'Alcohol Dependence Syndrome', primary: false },
    { icd: 'F60.3', desc: 'Emotionally Unstable Personality Disorder, Borderline Type', primary: true },
    { icd: 'F41.1', desc: 'Generalised Anxiety Disorder', primary: false },
    { icd: 'F50.0', desc: 'Anorexia Nervosa', primary: false },
    { icd: 'F32.1', desc: 'Moderate Depressive Episode', primary: true },
    { icd: 'F20.5', desc: 'Residual Schizophrenia', primary: false },
    { icd: 'F42', desc: 'Obsessive-Compulsive Disorder', primary: false },
    { icd: 'F31.1', desc: 'Bipolar Affective Disorder, Current Episode Manic Without Psychotic Symptoms', primary: true },
    { icd: 'F19.1', desc: 'Multiple Drug Use — Harmful Use', primary: false },
    { icd: 'E66.0', desc: 'Obesity due to excess calories (metabolic complication of antipsychotic)', primary: false },
    { icd: 'E11', desc: 'Type 2 Diabetes Mellitus (medication-related)', primary: false },
  ];

  const diagRows: SeedRow[] = [];
  for (const pid of pids) {
    const numDx = randomInt(1, 3);
    const shuffledDx = [...diagDefs].sort(() => Math.random() - 0.5);
    let hasPrimary = false;
    for (let j = 0; j < numDx; j++) {
      const dx = shuffledDx[j];
      const isPrimary = !hasPrimary && dx.primary;
      if (isPrimary) hasPrimary = true;
      const dxDate = d(randomInt(2023, 2025), randomInt(1, 12), randomInt(1, 28));
      diagRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        episode_id: openEpisodeByPatient[pid] || null,
        created_by_id: randomFrom(clinicianIds),
        icdcode: dx.icd,
        description: dx.desc,
        diagnoseddate: dxDate,
        status: 'active',
        is_primary: isPrimary,
        notes: `Diagnosed based on clinical assessment and longitudinal observation. ${dx.primary ? 'Primary diagnosis.' : 'Comorbid condition.'}`,
        created_at: new Date(dxDate),
        updated_at: new Date(),
      });
    }
  }

  const diagInserted = await safeInsert('diagnoses', diagRows);
  console.log(`  Inserted ${diagInserted} diagnoses`);

  // ── 19. PATIENT CONTACTS (Emergency / Carers) ───────────────────────────
  console.log('\n--- Seeding Patient Contacts & Carers ---');
  const pcRows: SeedRow[] = [];
  const carerRows: SeedRow[] = [];

  for (const pid of pids) {
    // Emergency contact
    pcRows.push({
      id: uuid(),
      patient_id: pid,
      given_name: randomFrom(['Mary', 'John', 'Susan', 'David', 'Linda', 'Michael', 'Jennifer', 'Robert']),
      family_name: randomFrom(['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Thomas', 'White']),
      relationship: randomFrom(['Mother', 'Father', 'Partner', 'Sister', 'Brother', 'Friend', 'Son', 'Daughter']),
      phone_mobile: `04${randomInt(10, 99)} ${randomInt(100, 999)} ${randomInt(100, 999)}`,
      is_emergency_contact: true,
      is_carer: Math.random() > 0.5,
      has_consent: true,
      created_at: new Date(),
    });

    // Carer for some patients
    if (Math.random() > 0.4) {
      const cGiven = randomFrom(['Julie', 'Craig', 'Wendy', 'Paul', 'Angela', 'Peter', 'Diane', 'Mark']);
      const cFamily = randomFrom(['Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Hall', 'Allen']);
      carerRows.push({
        id: uuid(),
        patient_id: pid,
        clinic_id: C,
        given_name: cGiven,
        family_name: cFamily,
        relationship: randomFrom(['Partner', 'Mother', 'Father', 'Sibling', 'Friend']),
        phone: `04${randomInt(10, 99)} ${randomInt(100, 999)} ${randomInt(100, 999)}`,
        email: `${cGiven.toLowerCase()}.${cFamily.toLowerCase()}@email.com`,
        is_primary: true,
        created_at: new Date(),
      });
    }
  }

  const pcInserted = await safeInsert('patient_contacts', pcRows);
  const carerInserted = await safeInsert('carers', carerRows);
  console.log(`  Inserted ${pcInserted} patient contacts, ${carerInserted} carers`);

  // ── 20. PATIENT ALLERGIES ────────────────────────────────────────────────
  console.log('\n--- Seeding Patient Allergies ---');
  const allergyDefs = [
    { allergen: 'Penicillin', type: 'medication', reaction: 'Anaphylaxis', severity: 'life_threatening' as const },
    { allergen: 'Sulfonamides', type: 'medication', reaction: 'Skin rash', severity: 'moderate' as const },
    { allergen: 'Codeine', type: 'medication', reaction: 'Nausea and vomiting', severity: 'moderate' as const },
    { allergen: 'Ibuprofen', type: 'medication', reaction: 'Asthma exacerbation', severity: 'severe' as const },
    { allergen: 'Latex', type: 'environmental', reaction: 'Contact dermatitis', severity: 'moderate' as const },
    { allergen: 'Peanuts', type: 'food', reaction: 'Anaphylaxis', severity: 'life_threatening' as const },
    { allergen: 'Haloperidol', type: 'medication', reaction: 'Acute dystonia', severity: 'severe' as const },
    { allergen: 'Chlorpromazine', type: 'medication', reaction: 'Photosensitivity', severity: 'mild' as const },
  ];

  const allergyRows: SeedRow[] = [];
  for (const pid of pids.slice(0, 12)) {
    const numAllergies = randomInt(0, 2);
    const shuffledAl = [...allergyDefs].sort(() => Math.random() - 0.5);
    for (let j = 0; j < numAllergies; j++) {
      const a = shuffledAl[j];
      allergyRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        allergen: a.allergen,
        allergen_type: a.type,
        reaction: a.reaction,
        severity: a.severity,
        status: 'active',
        recorded_by_staff_id: randomFrom(clinicianIds),
        recorded_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  const allergyInserted = await safeInsert('patient_allergies', allergyRows);
  console.log(`  Inserted ${allergyInserted} patient allergies`);

  // ── 21. MESSAGE THREADS ──────────────────────────────────────────────────
  console.log('\n--- Seeding Message Threads ---');
  const threadSubjects = [
    'Medication change for patient — please review',
    'Urgent: Patient did not attend depot appointment',
    'Handover note — covering leave next week',
    'Blood results — action required',
    'Clozapine monitoring — ANC borderline',
    'Family meeting request',
    'Risk escalation — please review',
    'NDIS plan review documentation',
    'Discharge planning discussion',
    'New referral — high priority',
  ];

  const threadRows: SeedRow[] = [];
  const participantRows: SeedRow[] = [];

  for (let i = 0; i < 10; i++) {
    const threadId = uuid();
    const creatorId = randomFrom(staffIds);
    const mDate = d(2025 + Math.floor(i / 5), randomInt(1, 12), randomInt(1, 28));

    threadRows.push({
      id: threadId,
      clinic_id: C,
      created_by_id: creatorId,
      patient_id: i < 7 ? randomFrom(pids) : null,
      subject: threadSubjects[i],
      last_message_at: new Date(mDate),
      created_at: new Date(mDate),
      updated_at: new Date(mDate),
    });

    // 2-3 participants per thread
    const participantIds = new Set<string>([creatorId]);
    const numParticipants = randomInt(1, 3);
    for (let j = 0; j < numParticipants; j++) {
      const sid = randomFrom(staffIds);
      participantIds.add(sid);
    }

    for (const sid of participantIds) {
      participantRows.push({
        id: uuid(),
        thread_id: threadId,
        user_id: sid,
        last_read_at: Math.random() > 0.3 ? new Date(mDate) : null,
        created_at: new Date(mDate),
      });
    }
  }

  const threadsInserted = await safeInsert('message_threads', threadRows);
  const participantsInserted = await safeInsert('message_thread_participants', participantRows);
  console.log(`  Inserted ${threadsInserted} message threads, ${participantsInserted} participants`);

  // ── 22. ADVANCE DIRECTIVES ───────────────────────────────────────────────
  console.log('\n--- Seeding Advance Directives ---');
  const advRows: SeedRow[] = [];
  for (const pid of pids.slice(0, 5)) {
    advRows.push({
      id: uuid(),
      patient_id: pid,
      clinic_id: C,
      type: randomFrom(['Advance Statement', 'Nominated Persons', 'Advance Statement']),
      content: JSON.stringify({
        preferences: [
          'If I become unwell, I prefer to be treated with oral medication rather than intramuscular injection where possible.',
          'I would like my family to be contacted and involved in treatment decisions.',
          'I prefer to be admitted to a single room if inpatient treatment is required.',
          'I do not consent to electroconvulsive therapy under any circumstances.',
        ],
        nominated_person: {
          name: randomFrom(['Mary Johnson', 'David Chen', 'Susan Williams']),
          relationship: randomFrom(['Mother', 'Partner', 'Sister']),
          phone: `04${randomInt(10, 99)} ${randomInt(100, 999)} ${randomInt(100, 999)}`,
        },
        witnessed_by: randomFrom(['Dr Sarah Chen', 'Dr James Wilson', 'Priya Sharma']),
        witnessed_date: d(2025, randomInt(1, 12), randomInt(1, 28)),
      }),
      status: 'active',
      valid_from: d(2025, 1, 1),
      valid_until: d(2027, 12, 31),
      created_at: new Date(),
    });
  }

  const advInserted = await safeInsert('advance_directives', advRows);
  console.log(`  Inserted ${advInserted} advance directives`);

  // ── 23. TREATMENT PATHWAYS ───────────────────────────────────────────────
  console.log('\n--- Seeding Treatment Pathways ---');
  const pathwayRows: SeedRow[] = [];
  const pathwayNames = [
    'First Episode Psychosis (FEP) Pathway',
    'Clozapine Initiation Pathway',
    'Suicide Prevention Pathway',
    'Eating Disorder Recovery Pathway',
    'PTSD Treatment Pathway',
    'Bipolar Disorder Maintenance Pathway',
    'Substance Use Co-occurring Treatment',
    'Early Intervention Pathway',
  ];

  for (let i = 0; i < 8; i++) {
    pathwayRows.push({
      id: uuid(),
      patient_id: pids[i],
      clinic_id: C,
      name: pathwayNames[i],
      status: i < 6 ? 'active' : 'completed',
      milestones: JSON.stringify([
        { name: 'Initial Assessment', date: d(2024, randomInt(1, 6), randomInt(1, 28)), completed: true },
        { name: 'Treatment Plan Agreed', date: d(2024, randomInt(6, 12), randomInt(1, 28)), completed: true },
        { name: '91-Day Review', date: d(2025, randomInt(1, 6), randomInt(1, 28)), completed: i < 5 },
        { name: '6-Month Review', date: d(2025, randomInt(6, 12), randomInt(1, 28)), completed: i < 3 },
        { name: '12-Month Comprehensive Review', date: d(2026, randomInt(1, 3), randomInt(1, 28)), completed: false },
      ]),
      created_at: new Date(),
    });
  }

  const pathwayInserted = await safeInsert('treatment_pathways', pathwayRows);
  console.log(`  Inserted ${pathwayInserted} treatment pathways`);

  // ── 24. GROUP SESSIONS + ATTENDEES ───────────────────────────────────────
  console.log('\n--- Seeding Group Sessions ---');
  const groupDefs = [
    { name: 'DBT Skills Group', type: 'dbt', program: 'Adult Community' },
    { name: 'Hearing Voices Group', type: 'support', program: 'Adult Community' },
    { name: 'Social Skills Training', type: 'skills', program: 'Rehabilitation' },
    { name: 'Mindfulness Meditation', type: 'wellbeing', program: 'Adult Community' },
    { name: 'Art Therapy Group', type: 'creative', program: 'Inpatient' },
    { name: 'Carer Support Group', type: 'carer', program: 'Family Support' },
  ];

  const groupRows: SeedRow[] = [];
  const attendeeRows: SeedRow[] = [];

  for (let week = -12; week <= 2; week++) {
    for (const g of groupDefs) {
      if (Math.random() < 0.4) continue; // Not every group runs every week
      const sessionId = uuid();
      const sessionDate = addDays('2026-03-27', week * 7 + randomInt(0, 4));

      groupRows.push({
        id: sessionId,
        clinic_id: C,
        facilitator_id: randomFrom(clinicianIds),
        name: g.name,
        group_type: g.type,
        program: g.program,
        session_date: sessionDate,
        start_time: '10:00',
        end_time: '11:30',
        duration_min: 90,
        location: randomFrom(['Community Clinic Room 1', 'Group Room', 'Inpatient Day Room', 'Video Conference']),
        notes: `${g.name} session facilitated. ${randomFrom(['Good attendance.', 'Smaller group this week.', 'New members attended.', 'Lively group discussion.'])}`,
        status: new Date(sessionDate) <= new Date('2026-03-27') ? 'completed' : 'scheduled',
        created_at: new Date(sessionDate),
        updated_at: new Date(sessionDate),
      });

      // 3-6 attendees per group
      const attendeeCount = randomInt(3, 6);
      const attendeePids = [...pids].sort(() => Math.random() - 0.5).slice(0, attendeeCount);
      for (const apid of attendeePids) {
        attendeeRows.push({
          id: uuid(),
          group_session_id: sessionId,
          patient_id: apid,
          attendance_status: randomFrom(['attended', 'attended', 'attended', 'absent', 'late']),
          notes: null,
          created_at: new Date(sessionDate),
        });
      }
    }
  }

  const groupInserted = await safeInsert('group_sessions', groupRows);
  const attendeeInserted = await safeInsert('group_session_attendees', attendeeRows);
  console.log(`  Inserted ${groupInserted} group sessions, ${attendeeInserted} attendees`);

  // ── 25. BEDS + BED MOVEMENTS ─────────────────────────────────────────────
  console.log('\n--- Seeding Beds ---');
  const ipuOrgUnit = orgUnitMap['Inpatient Unit'];
  const bedRows: SeedRow[] = [];
  const bedIds: string[] = [];

  for (let w = 1; w <= 2; w++) {
    for (let r = 1; r <= 5; r++) {
      for (let b = 1; b <= 2; b++) {
        const bedId = uuid();
        bedIds.push(bedId);
        bedRows.push({
          id: bedId,
          clinic_id: C,
          org_unit_id: ipuOrgUnit || null,
          ward: `Ward ${w}`,
          room: `Room ${w}${String(r).padStart(2, '0')}`,
          bed_label: `W${w}-R${r}-B${b}`,
          bed_type: b === 1 ? 'standard' : 'high_dependency',
          status: Math.random() > 0.3 ? 'available' : 'occupied',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }
  }

  const bedsInserted = await safeInsert('beds', bedRows);
  console.log(`  Inserted ${bedsInserted} beds`);

  // Bed movements
  if (bedIds.length > 0) {
    const bedMoveRows: SeedRow[] = [];
    for (let i = 0; i < 10; i++) {
      const mvDate = addDays('2026-03-27', -randomInt(1, 60));
      bedMoveRows.push({
        id: uuid(),
        bed_id: randomFrom(bedIds),
        patient_id: randomFrom(pids.slice(0, 8)),
        clinic_id: C,
        movement_type: randomFrom(['admission', 'transfer', 'discharge']),
        movement_at: new Date(`${mvDate}T${String(randomInt(8, 20)).padStart(2, '0')}:00:00+11:00`),
        authorised_by_id: randomFrom(clinicianIds),
        notes: randomFrom(['Admitted to IPU.', 'Transferred from HDU.', 'Discharged to community.', 'Bed swap for clinical reasons.']),
        created_at: new Date(mvDate),
      });
    }

    const bedMovesInserted = await safeInsert('bed_movements', bedMoveRows);
    console.log(`  Inserted ${bedMovesInserted} bed movements`);
  }

  // ── 26. CONSULTATIONS ────────────────────────────────────────────────────
  console.log('\n--- Seeding Consultations ---');
  const consultRows: SeedRow[] = [];

  for (const pid of pids.slice(0, 12)) {
    const numConsults = randomInt(3, 8);
    for (let j = 0; j < numConsults; j++) {
      const cDate = d(2024 + Math.floor(j / 4), randomInt(1, 12), randomInt(1, 28));
      consultRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        episode_id: openEpisodeByPatient[pid] || null,
        clinicianid: randomFrom(clinicianIds),
        encounterdate: new Date(`${cDate}T${String(randomInt(8, 16)).padStart(2, '0')}:00:00+11:00`),
        encountertype: randomFrom(['consultation', 'review', 'assessment', 'follow_up']),
        durationminutes: randomFrom([15, 20, 30, 45, 60]),
        presentingcomplaints: randomFrom([
          'Routine follow-up. No acute concerns.',
          'Reports increased anxiety and sleep disturbance.',
          'Medication review appointment.',
          'Requested review of treatment plan.',
          'Concerns about side effects from current medication.',
        ]),
        mse: JSON.stringify({
          appearance: randomFrom(['Well-groomed', 'Adequate self-care', 'Dishevelled']),
          behaviour: randomFrom(['Cooperative', 'Guarded', 'Restless']),
          speech: randomFrom(['Normal rate and tone', 'Reduced output', 'Pressured']),
          mood: randomFrom(['Euthymic', 'Low', 'Anxious', 'Irritable']),
          affect: randomFrom(['Congruent', 'Restricted', 'Reactive']),
          thought_form: randomFrom(['Goal-directed', 'Circumstantial', 'Tangential']),
          thought_content: randomFrom(['No suicidal ideation', 'Passive SI, no plan', 'Nil psychotic symptoms']),
          perception: randomFrom(['No hallucinations', 'Nil abnormality', 'Reports occasional AVH']),
          cognition: randomFrom(['Intact', 'Mild inattention', 'Grossly intact']),
          insight: randomFrom(['Good', 'Partial', 'Poor']),
          judgement: randomFrom(['Fair', 'Good', 'Impaired']),
        }),
        plantext: randomFrom([
          'Continue current management. Review in 2 weeks.',
          'Increase medication dose. Monitor for side effects. Review in 1 week.',
          'Referral to psychologist for CBT. Continue current medications.',
          'Safety plan reviewed. Increase contact frequency to weekly.',
          'Blood tests ordered. GP letter sent. Review when results available.',
        ]),
        status: 'signed',
        created_at: new Date(cDate),
        updated_at: new Date(cDate),
      });
    }
  }

  const consultInserted = await safeInsert('consultations', consultRows);
  console.log(`  Inserted ${consultInserted} consultations`);

  // ── 27. WAITLIST ENTRIES ─────────────────────────────────────────────────
  console.log('\n--- Seeding Waitlist ---');
  const waitlistRows: SeedRow[] = [];
  for (let i = 0; i < 8; i++) {
    const wDate = d(2026, randomInt(1, 3), randomInt(1, 28));
    waitlistRows.push({
      id: uuid(),
      clinic_id: C,
      patient_id: pids[pids.length - 1 - i] || randomFrom(pids),
      priority: randomFrom(['low', 'medium', 'high', 'urgent'] as const),
      preferred_time_of_day: randomFrom(['morning', 'afternoon', 'any'] as const),
      added_date: wDate,
      target_appointment_by: addDays(wDate, randomInt(7, 30)),
      status: randomFrom(['waiting', 'waiting', 'offered'] as const),
      notes: randomFrom([
        'New referral awaiting initial assessment.',
        'Waiting for psychiatrist appointment.',
        'Awaiting psychology group commencement.',
        'Transfer of care — waiting for key clinician allocation.',
      ]),
      created_at: new Date(wDate),
      updated_at: new Date(),
    });
  }

  const waitlistInserted = await safeInsert('waitlist_entries', waitlistRows);
  console.log(`  Inserted ${waitlistInserted} waitlist entries`);

  // ── 28. PRESCRIPTIONS ────────────────────────────────────────────────────
  console.log('\n--- Seeding Prescriptions ---');
  const rxRows: SeedRow[] = [];
  const rxDrugs = [
    { generic: 'Olanzapine', brand: 'Zyprexa', dose: '10mg', route: 'oral', freq: 'Nocte', qty: 30, repeats: 5, s8: false },
    { generic: 'Risperidone', brand: 'Risperdal', dose: '2mg', route: 'oral', freq: 'BD', qty: 60, repeats: 5, s8: false },
    { generic: 'Lithium Carbonate', brand: 'Lithicarb', dose: '450mg', route: 'oral', freq: 'BD', qty: 60, repeats: 5, s8: false },
    { generic: 'Sertraline', brand: 'Zoloft', dose: '100mg', route: 'oral', freq: 'Mane', qty: 30, repeats: 5, s8: false },
    { generic: 'Diazepam', brand: 'Valium', dose: '5mg', route: 'oral', freq: 'TDS PRN', qty: 50, repeats: 0, s8: true },
    { generic: 'Temazepam', brand: 'Normison', dose: '10mg', route: 'oral', freq: 'Nocte PRN', qty: 25, repeats: 0, s8: true },
    { generic: 'Clozapine', brand: 'Clopine', dose: '100mg', route: 'oral', freq: 'Nocte', qty: 30, repeats: 5, s8: false },
    { generic: 'Venlafaxine', brand: 'Efexor XR', dose: '150mg', route: 'oral', freq: 'Mane', qty: 30, repeats: 5, s8: false },
    { generic: 'Quetiapine', brand: 'Seroquel', dose: '300mg', route: 'oral', freq: 'Nocte', qty: 30, repeats: 5, s8: false },
    { generic: 'Aripiprazole', brand: 'Abilify', dose: '15mg', route: 'oral', freq: 'Mane', qty: 30, repeats: 5, s8: false },
  ];

  for (const pid of pids.slice(0, 15)) {
    const numRx = randomInt(1, 3);
    const shuffledRx = [...rxDrugs].sort(() => Math.random() - 0.5);
    for (let j = 0; j < numRx; j++) {
      const rx = shuffledRx[j];
      const rxDate = d(randomInt(2024, 2026), randomInt(1, 12), randomInt(1, 28));
      rxRows.push({
        id: uuid(),
        clinic_id: C,
        patient_id: pid,
        episode_id: openEpisodeByPatient[pid] || null,
        prescribed_by_staff_id: randomFrom(clinicianIds),
        generic_name: rx.generic,
        brand_name: rx.brand,
        dose: rx.dose,
        route: rx.route,
        frequency: rx.freq,
        directions: `Take ${rx.dose} ${rx.freq.toLowerCase()}`,
        quantity: rx.qty,
        repeats: rx.repeats,
        is_s8: rx.s8,
        prescription_type: 'standard',
        status: randomFrom(['active', 'active', 'dispensed', 'dispensed'] as const),
        is_electronic: true,
        prescribed_date: rxDate,
        expires_at: addDays(rxDate, 365),
        created_at: new Date(rxDate),
        updated_at: new Date(rxDate),
      });
    }
  }

  const rxInserted = await safeInsert('prescriptions', rxRows);
  console.log(`  Inserted ${rxInserted} prescriptions`);

  // ── 29. eREFERRALS ───────────────────────────────────────────────────────
  console.log('\n--- Seeding eReferrals ---');
  const erefRows: SeedRow[] = [];
  for (let i = 0; i < 6; i++) {
    const eDate = d(2025 + Math.floor(i / 3), randomInt(1, 12), randomInt(1, 28));
    erefRows.push({
      id: uuid(),
      patient_id: pids[i + 5],
      clinic_id: C,
      referrer_name: randomFrom(['Dr Simmons', 'Dr Patel', 'Dr Tran', 'Dr Ahmed', 'Ms Henderson (SW)']),
      referrer_org: randomFrom(['Mill Park Medical', 'Box Hill Hospital', 'Sunshine Medical', 'Community Health']),
      referrer_phone: `03 9${randomInt(100, 999)} ${randomInt(1000, 9999)}`,
      priority: randomFrom(['routine', 'urgent'] as const),
      status: randomFrom(['received', 'triaged', 'accepted'] as const),
      reason: randomFrom([
        'Worsening depression, poor GP response to treatment. Requesting specialist assessment.',
        'Acute psychotic presentation requiring community follow-up.',
        'Complex PTSD — requires specialist trauma-focused therapy.',
        'Medication review — multiple psychotropics, unclear rationale.',
        'Eating disorder with comorbid depression.',
        'Post-partum mood disorder.',
      ]),
      clinical_summary: 'See attached referral documentation.',
      created_at: new Date(eDate),
    });
  }

  const erefInserted = await safeInsert('ereferrals', erefRows);
  console.log(`  Inserted ${erefInserted} eReferrals`);

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  console.log('\n====================================================');
  console.log('Comprehensive demo data seeding complete!');
  console.log('====================================================');

  await db.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  db.destroy().then(() => process.exit(1));
});
