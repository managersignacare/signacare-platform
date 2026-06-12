import { db } from './db/db'

// Seed only reads `.id` off the returning row — explicit list avoids
// returning the full row (Phase R3 / CLAUDE.md §1.7).
const ID_ONLY = ['id'] as const;

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const cid = clinic.id

  // Get or create categories
  const catMap = new Map<string, string>()
  for (const name of ['Clinical Notes', 'Reports', 'Rating Scales', 'Assessments']) {
    const existing = await db('template_categories').where({ clinic_id: cid, name }).first()
    if (existing) catMap.set(name, existing.id)
    else { const [r] = await db('template_categories').insert({ id: db.raw('gen_random_uuid()'), clinic_id: cid, name, is_active: true, sort_order: 0, created_at: new Date() }).returning(ID_ONLY); catMap.set(name, r.id) }
  }

  const templates = [
    // Clinical Notes
    { name: 'Initial Psychiatric Assessment', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'INITIAL PSYCHIATRIC ASSESSMENT' },
      { type: 'short_answer', label: 'Referral Source & Reason for Assessment' },
      { type: 'heading', text: 'HISTORY OF PRESENTING COMPLAINT' },
      { type: 'short_answer', label: 'Presenting problem (in patient\'s words)' },
      { type: 'short_answer', label: 'Duration and course' },
      { type: 'short_answer', label: 'Precipitating factors' },
      { type: 'short_answer', label: 'Associated symptoms' },
      { type: 'heading', text: 'PAST PSYCHIATRIC HISTORY' },
      { type: 'short_answer', label: 'Previous diagnoses' },
      { type: 'short_answer', label: 'Previous admissions' },
      { type: 'short_answer', label: 'Previous treatments & response' },
      { type: 'short_answer', label: 'Previous suicide attempts / self-harm' },
      { type: 'heading', text: 'PAST MEDICAL HISTORY' },
      { type: 'short_answer', label: 'Medical conditions' },
      { type: 'short_answer', label: 'Surgical history' },
      { type: 'heading', text: 'DRUG & ALCOHOL HISTORY' },
      { type: 'short_answer', label: 'Current substance use' },
      { type: 'short_answer', label: 'History of substance use disorders' },
      { type: 'heading', text: 'FORENSIC HISTORY' },
      { type: 'short_answer', label: 'Legal history, charges, orders' },
      { type: 'heading', text: 'FAMILY HISTORY' },
      { type: 'short_answer', label: 'Family psychiatric history' },
      { type: 'short_answer', label: 'Family medical history' },
      { type: 'heading', text: 'PERSONAL HISTORY' },
      { type: 'short_answer', label: 'Early development & childhood' },
      { type: 'short_answer', label: 'Education' },
      { type: 'short_answer', label: 'Employment' },
      { type: 'short_answer', label: 'Relationships & children' },
      { type: 'heading', text: 'CURRENT MEDICATIONS' },
      { type: 'short_answer', label: 'List current medications with doses' },
      { type: 'heading', text: 'MENTAL STATE EXAMINATION' },
      { type: 'multiple_choice', label: 'Appearance', options: ['Well-groomed', 'Dishevelled', 'Bizarre', 'Underweight', 'Overweight'] },
      { type: 'multiple_choice', label: 'Behaviour', options: ['Cooperative', 'Guarded', 'Agitated', 'Withdrawn', 'Hostile', 'Psychomotor retardation'] },
      { type: 'multiple_choice', label: 'Speech', options: ['Normal', 'Pressured', 'Slow', 'Monotonous', 'Loud', 'Soft'] },
      { type: 'short_answer', label: 'Mood (subjective)' },
      { type: 'multiple_choice', label: 'Affect', options: ['Euthymic', 'Depressed', 'Anxious', 'Irritable', 'Elevated', 'Flat', 'Blunted', 'Labile', 'Incongruent'] },
      { type: 'multiple_choice', label: 'Thought Form', options: ['Linear', 'Circumstantial', 'Tangential', 'Flight of ideas', 'Loosening', 'Thought block'] },
      { type: 'short_answer', label: 'Thought Content' },
      { type: 'short_answer', label: 'Perception' },
      { type: 'multiple_choice', label: 'Cognition', options: ['Intact', 'Impaired orientation', 'Impaired attention', 'Impaired memory'] },
      { type: 'multiple_choice', label: 'Insight', options: ['Full', 'Partial', 'Nil'] },
      { type: 'multiple_choice', label: 'Judgement', options: ['Intact', 'Impaired'] },
      { type: 'heading', text: 'RISK ASSESSMENT' },
      { type: 'yes_no', label: 'Current suicidal ideation' },
      { type: 'yes_no', label: 'Current self-harm' },
      { type: 'yes_no', label: 'Homicidal ideation' },
      { type: 'multiple_choice', label: 'Risk Level', options: ['Low', 'Moderate', 'High', 'Extreme'] },
      { type: 'short_answer', label: 'Risk management plan' },
      { type: 'heading', text: 'FORMULATION' },
      { type: 'short_answer', label: 'Diagnostic impression' },
      { type: 'short_answer', label: 'Predisposing factors' },
      { type: 'short_answer', label: 'Precipitating factors' },
      { type: 'short_answer', label: 'Perpetuating factors' },
      { type: 'short_answer', label: 'Protective factors' },
      { type: 'heading', text: 'MANAGEMENT PLAN' },
      { type: 'short_answer', label: 'Immediate plan' },
      { type: 'short_answer', label: 'Medication plan' },
      { type: 'short_answer', label: 'Psychological interventions' },
      { type: 'short_answer', label: 'Follow-up arrangements' },
    ]},
    { name: 'Medical Review Note', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'MEDICAL REVIEW' },
      { type: 'short_answer', label: 'Reason for review' },
      { type: 'short_answer', label: 'Current presentation' },
      { type: 'short_answer', label: 'MSE summary' },
      { type: 'short_answer', label: 'Risk assessment' },
      { type: 'short_answer', label: 'Medication review' },
      { type: 'short_answer', label: 'Physical health' },
      { type: 'short_answer', label: 'Investigations ordered/reviewed' },
      { type: 'short_answer', label: 'Plan' },
    ]},
    { name: 'LAI Administration Note', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'LAI ADMINISTRATION NOTE' },
      { type: 'short_answer', label: 'Medication name and dose' },
      { type: 'short_answer', label: 'Injection site' },
      { type: 'short_answer', label: 'Batch number and expiry' },
      { type: 'short_answer', label: 'Pre-injection assessment' },
      { type: 'short_answer', label: 'Post-injection observation (30 min)' },
      { type: 'yes_no', label: 'Adverse reaction observed' },
      { type: 'short_answer', label: 'Next due date' },
      { type: 'short_answer', label: 'Additional notes' },
    ]},
    { name: 'Clozapine Review Note', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'CLOZAPINE MONITORING REVIEW' },
      { type: 'short_answer', label: 'Current dose' },
      { type: 'short_answer', label: 'WCC / ANC results' },
      { type: 'short_answer', label: 'Blood date' },
      { type: 'multiple_choice', label: 'Monitoring frequency', options: ['Weekly', 'Fortnightly', 'Monthly', '4-weekly'] },
      { type: 'short_answer', label: 'Metabolic parameters (weight, BMI, BP, glucose, lipids)' },
      { type: 'short_answer', label: 'Constipation assessment' },
      { type: 'short_answer', label: 'Side effects' },
      { type: 'short_answer', label: 'Compliance assessment' },
      { type: 'short_answer', label: 'Plan' },
    ]},
    { name: 'Clinician Review Note', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'CLINICIAN REVIEW' },
      { type: 'short_answer', label: 'Purpose of review' },
      { type: 'short_answer', label: 'Subjective — patient report' },
      { type: 'short_answer', label: 'Objective — clinician observations' },
      { type: 'short_answer', label: 'Assessment' },
      { type: 'short_answer', label: 'Plan' },
      { type: 'short_answer', label: 'Goals progress' },
    ]},

    // Reports
    { name: 'MHRT Report (Victoria)', type: 'report', category: 'Reports', content: [
      { type: 'heading', text: 'MENTAL HEALTH REVIEW TRIBUNAL — REPORT OF TREATING PSYCHIATRIST' },
      { type: 'text_block', text: 'TO: Mental Health Review Tribunal of Victoria\n\nRe: [Patient Name], DOB [DOB]\nHearing Date: [Date]\nOrder Type: [Treatment Order / Temporary Treatment Order]\n\n1. DIAGNOSIS\n[ICD-10 diagnosis with supporting clinical features]\n\n2. TREATMENT CRITERIA (s5 Mental Health Act 2014)\na) The person appears to have mental illness:\n[Clinical evidence]\n\nb) The person needs immediate treatment to prevent serious deterioration or serious harm:\n[Evidence of risk without treatment]\n\nc) The treatment cannot be provided in a less restrictive way:\n[Why community treatment / less restrictive options are insufficient]\n\n3. CURRENT TREATMENT\n[Current medications, psychological interventions, social supports]\n\n4. PROPOSED TREATMENT PLAN\n[Planned treatment for the order period]\n\n5. PATIENT\'S VIEWS\n[Patient\'s stated views on treatment, if known]\n\n6. ADVANCE STATEMENT\n[Whether an advance statement exists and has been considered]\n\n7. NOMINATED PERSON\n[Nominated person details and their views]\n\nPrepared by:\nDr [Name]\nConsultant Psychiatrist\nProvider No: [Number]\nDate: [Date]' },
    ]},
    { name: 'Discharge Summary', type: 'report', category: 'Reports', content: [
      { type: 'text_block', text: 'DISCHARGE SUMMARY\n\nPatient: [Name]\nDOB: [DOB]\nMRN: [MRN]\nAdmission Date: [Date]\nDischarge Date: [Date]\nLength of Stay: [Days]\nWard: [Ward]\n\nADMITTING DIAGNOSIS:\n\nDISCHARGE DIAGNOSIS:\n\nReason for Admission:\n\nSummary of Admission:\n\nMedications on Discharge:\n\nPending Investigations:\n\nFollow-up Plan:\n- Community team:\n- Outpatient appointment:\n- GP follow-up:\n\nRisk Assessment at Discharge:\n\nDischarge Destination:\n\nPrepared by:\nDate:' },
    ]},
    { name: 'NDIS Support Letter', type: 'report', category: 'Reports', content: [
      { type: 'text_block', text: 'TO: National Disability Insurance Agency\n\nRe: [Patient Name], DOB [DOB], NDIS No: [Number]\n\nI am writing in support of [Patient Name]\'s NDIS application/plan review.\n\nDIAGNOSIS:\n[Primary psychiatric diagnosis with ICD-10 code]\n\nFUNCTIONAL IMPACT:\n[How the condition affects daily living, social participation, employment, self-care]\n\nTREATMENT HISTORY:\n[Duration of treatment, medications, therapies]\n\nPROGNOSIS:\n[Expected course, likelihood of improvement, permanent vs episodic nature]\n\nSUPPORTS RECOMMENDED:\n[Specific NDIS supports recommended — psychosocial support, supported accommodation, etc.]\n\nDr [Name]\nConsultant Psychiatrist\nDate: [Date]' },
    ]},
    { name: 'Disability Pension Support Letter', type: 'report', category: 'Reports', content: [
      { type: 'text_block', text: 'TO: Services Australia — Disability Support Pension\n\nRe: [Patient Name], DOB [DOB]\n\nDIAGNOSIS:\n[Primary diagnosis]\n\nDURATION OF CONDITION:\n[How long treated, chronicity]\n\nFUNCTIONAL IMPAIRMENT:\n[Impact on capacity to work — cognitive, social, sustained activity]\n\nTREATMENT PROVIDED:\n[Treatment history, current treatment plan]\n\nPROGNOSIS:\n[Expected trajectory, whether condition is fully treated and stabilised]\n\nWORK CAPACITY:\n[Current work capacity — unable / 0-7 hrs / 8-14 hrs / 15+ hrs per week]\n\nDr [Name]\nDate: [Date]' },
    ]},
    { name: 'Treating Doctor Report', type: 'report', category: 'Reports', content: [
      { type: 'text_block', text: 'TREATING DOCTOR REPORT\n\nPatient: [Name]\nDOB: [DOB]\n\nDIAGNOSIS:\n[Current diagnoses]\n\nDATE OF FIRST CONSULTATION:\n\nFREQUENCY OF CONSULTATIONS:\n\nCURRENT TREATMENT:\n- Medications:\n- Psychological interventions:\n- Other:\n\nENGAGEMENT WITH TREATMENT:\n[Attendance, adherence, therapeutic alliance]\n\nCLINICAL PROGRESS:\n[Response to treatment, symptom trajectory]\n\nRISK ASSESSMENT:\n[Current risk profile]\n\nFURTHER COMMENTS:\n\nDr [Name]\nConsultant Psychiatrist\nAHPRA Registration: [Number]\nDate: [Date]' },
    ]},

    // Rating Scales
    { name: 'AIMS (Abnormal Involuntary Movement Scale)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'AIMS ASSESSMENT' },
      { type: 'instruction', text: 'Rate the highest severity of observed movement on the following scale: 0=None, 1=Minimal, 2=Mild, 3=Moderate, 4=Severe' },
      { type: 'heading', text: 'FACIAL AND ORAL MOVEMENTS' },
      ...['Muscles of facial expression (e.g. movements of forehead, eyebrows, periorbital area, cheeks)', 'Lips and perioral area (e.g. puckering, pouting, smacking)', 'Jaw (e.g. biting, clenching, chewing, mouth opening, lateral movement)', 'Tongue (rate only increases in movement both in and out of mouth; not inability to sustain movement)']
        .map(q => ({ type: 'likert', label: q, min: 0, max: 4, options: ['0 - None', '1 - Minimal', '2 - Mild', '3 - Moderate', '4 - Severe'] })),
      { type: 'heading', text: 'EXTREMITY MOVEMENTS' },
      ...['Upper (arms, wrists, hands, fingers) — Include choreic movements and athetoid movements', 'Lower (legs, knees, ankles, toes) — Include choreic movements, athetoid movements, stamping, heel-dropping, squirming']
        .map(q => ({ type: 'likert', label: q, min: 0, max: 4, options: ['0 - None', '1 - Minimal', '2 - Mild', '3 - Moderate', '4 - Severe'] })),
      { type: 'heading', text: 'TRUNK MOVEMENTS' },
      { type: 'likert', label: 'Neck, shoulders, hips (e.g. rocking, twisting, squirming, pelvic gyrations)', min: 0, max: 4, options: ['0 - None', '1 - Minimal', '2 - Mild', '3 - Moderate', '4 - Severe'] },
      { type: 'heading', text: 'GLOBAL JUDGEMENTS' },
      { type: 'likert', label: 'Severity of abnormal movements overall', min: 0, max: 4, options: ['0 - None', '1 - Minimal', '2 - Mild', '3 - Moderate', '4 - Severe'] },
      { type: 'likert', label: 'Incapacitation due to abnormal movements', min: 0, max: 4, options: ['0 - None', '1 - Minimal', '2 - Mild', '3 - Moderate', '4 - Severe'] },
      { type: 'multiple_choice', label: "Patient's awareness of abnormal movements", options: ['No awareness', 'Aware, no distress', 'Aware, mild distress', 'Aware, moderate distress', 'Aware, severe distress'] },
      { type: 'heading', text: 'DENTAL STATUS' },
      { type: 'yes_no', label: 'Current problems with teeth and/or dentures' },
      { type: 'yes_no', label: 'Does patient usually wear dentures' },
      { type: 'score', label: 'Total AIMS Score (sum of items 1–7)' },
      { type: 'short_answer', label: 'Clinical notes / observations' },
    ]},
    // HoNOS, K10+, LSP-16 removed from Rating Scales seed — they are outcome measures
    // and are surfaced via the Outcome Measures tab (canonical SSoT: packages/shared/src/assessmentTaxonomy.ts)
  ]

  let added = 0
  for (const t of templates) {
    const catId = catMap.get(t.category) ?? null
    const existing = await db('clinical_templates').where({ clinic_id: cid, name: t.name }).first()
    if (!existing) {
      await db('clinical_templates').insert({
        id: db.raw('gen_random_uuid()'), clinic_id: cid, category_id: catId,
        name: t.name, type: t.type, content: JSON.stringify(t.content),
        is_active: true, is_system: true, created_at: new Date(), updated_at: new Date(),
      })
      added++
    }
  }
  console.log('Clinical templates seeded:', added)
  await db.destroy()
}

seed().catch(e => { console.error('Error:', e); process.exit(1) })
