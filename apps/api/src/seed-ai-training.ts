/**
 * Seed AI Training Context — Australian Psychiatry
 *
 * Populates ai_context_files and ai_modelfiles with comprehensive
 * training materials for psychiatric clinical documentation.
 *
 * Run: npx tsx apps/api/src/seed-ai-training.ts
 */
import { dbAdmin as db } from './db/db';
import { v4 as uuidv4 } from 'uuid';

const CLINIC_ID = process.env.CLINIC_ID || '00000000-0000-0000-0000-000000000001';

async function seedAiTraining() {
  console.log('Seeding AI training context...');

  // Ensure tables exist
  if (!(await db.schema.hasTable('ai_context_files'))) {
    console.log('  Creating ai_context_files table...');
    await db.schema.createTable('ai_context_files', (t) => {
      t.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable();
      t.string('title', 200).notNullable();
      t.text('description').nullable();
      t.string('category', 50).notNullable().defaultTo('general');
      t.text('content').notNullable();
      t.string('content_format', 20).notNullable().defaultTo('text');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('include_in_rag').notNullable().defaultTo(true);
      t.integer('priority').notNullable().defaultTo(50);
      t.integer('token_estimate').nullable();
      t.uuid('uploaded_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    });
  }
  if (!(await db.schema.hasTable('ai_modelfiles'))) {
    console.log('  Creating ai_modelfiles table...');
    await db.schema.createTable('ai_modelfiles', (t) => {
      t.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable();
      t.string('action_type', 50).notNullable();
      t.string('model_name', 100).notNullable().defaultTo('qwen2.5:14b');
      t.text('modelfile_content').nullable();
      t.text('system_prompt').nullable();
      t.decimal('temperature', 3, 2).notNullable().defaultTo(0.2);
      t.integer('max_tokens').notNullable().defaultTo(4096);
      t.text('few_shot_examples').nullable();
      t.text('rag_instructions').nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.uuid('updated_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      t.unique(['clinic_id', 'action_type']);
    });
  }

  // ── 1. CONTEXT FILES (RAG) ──────────────────────────────────────────────

  const contextFiles = [
    {
      title: 'Maudsley Summary Format — Australian Mental Health',
      category: 'clinical_guidelines',
      priority: 10,
      content: `MAUDSLEY LONGITUDINAL SUMMARY FORMAT

A Maudsley summary is a comprehensive psychiatric history document. It must follow this structure:

1. IDENTIFYING DATA
Name, DOB, age, gender, pronouns, UR number, Medicare/IHI, ATSI status, interpreter needs, legal status under Mental Health Act 2014 (Vic)

2. PRESENTING COMPLAINT
Chief complaint in patient's own words. Current episode onset, duration, precipitants. Reason for current contact/admission.

3. HISTORY OF PRESENTING ILLNESS
Chronological account of current episode. Symptom progression. Impact on functioning (ADLs, work, relationships, accommodation). Risk behaviours. Treatment response.

4. PSYCHIATRIC HISTORY
Previous episodes — dates, diagnoses, treatments, hospitalisations. Previous risk history (self-harm, suicide attempts, aggression). Previous medication trials and responses. ECT history. Previous MHA orders.

5. MEDICAL HISTORY
Active medical conditions. Metabolic syndrome screening (for antipsychotic patients). Allergies and ADRs. Surgical history. Current non-psychiatric medications.

6. SUBSTANCE USE HISTORY
Alcohol — quantity, frequency, last use, withdrawal history. Cannabis, methamphetamine, opioids, benzodiazepines, other. Harm reduction engagement. Previous detox/rehab.

7. FAMILY HISTORY
Psychiatric illness in first-degree relatives. Substance use. Suicide history. Medical conditions (especially metabolic, autoimmune).

8. PERSONAL HISTORY
Early development. Education. Employment. Relationships. Children. Forensic history. Immigration/refugee background. Cultural considerations.

9. PREMORBID PERSONALITY
Personality traits, coping style, social functioning, interests, strengths.

10. MENTAL STATE EXAMINATION (MSE)
Appearance and behaviour, Speech, Mood (subjective/objective), Affect, Thought form, Thought content (including suicidal/homicidal ideation, delusions), Perception (hallucinations), Cognition, Insight, Judgement.

11. RISK ASSESSMENT
Risk to self (suicide, self-harm, self-neglect). Risk to others (violence, aggression). Vulnerability (exploitation, abuse, homelessness). Absconding risk (if inpatient). Static and dynamic factors.

12. FORMULATION
Biopsychosocial formulation using 4P framework: Predisposing, Precipitating, Perpetuating, Protective factors across biological, psychological, and social domains.

13. DIAGNOSIS
Primary diagnosis (ICD-10/DSM-5). Comorbid diagnoses. Differential diagnoses.

14. MANAGEMENT PLAN
Medication plan with rationale. Psychological interventions. Social supports and community linkages. Risk management. Legal status plan. Follow-up schedule.

AUSTRALIAN-SPECIFIC REQUIREMENTS:
- Reference Mental Health Act 2014 (Vic) for legal status
- Use PBS item codes for medications
- Reference RANZCP Clinical Practice Guidelines
- Include ATSI-specific considerations if applicable
- Use Australian spelling (behaviour, colour, organised)
- Medication doses in metric (mg, not grains)`,
    },
    {
      title: 'Psychiatry Letter Templates — Australian Format',
      category: 'templates',
      priority: 15,
      content: `AUSTRALIAN PSYCHIATRIC LETTER FORMATS

═══ GP LETTER (1-2 pages) ═══

[Service Letterhead]
[Date]

Dr [Name]
[Practice Name]
[Address]

Dear Dr [Name],

Re: [Patient Full Name] (UR: [number], DOB: [date], Sex: [M/F])

Thank you for your [referral/ongoing care] of [patient].

CURRENT STATUS:
[1-2 paragraphs: diagnosis, current presentation, risk level]

MEDICATIONS:
[List as: Drug Name dose route frequency]
[Mark CEASED medications clearly]
[Include PBS authority codes where applicable]

MONITORING REQUIRED:
[Blood tests, metabolic monitoring schedule]
[Any GP-specific actions needed]

PLAN:
[Follow-up arrangements]
[When to re-refer or escalate]

Kind regards,
[Clinician Name]
[Title]
[Registration Number]

═══ NDIS SUPPORT LETTER ═══

Must address ALL functional domains:
1. Self-care and daily living
2. Communication
3. Social interaction
4. Learning
5. Mobility
6. Self-management (including medication)

Include:
- Diagnosis with ICD-10 codes
- Chronicity and permanence statement
- Functional impact (what the person CANNOT do independently)
- Support needs with frequency and duration
- Statement that the condition is likely to be permanent
- Reference to NDIS eligible disability criteria

═══ DISCHARGE SUMMARY ═══

1. ADMISSION DETAILS
Date admitted, date discharged, length of stay, ward, legal status

2. REASON FOR ADMISSION
Presenting complaint, risk factors, precipitants

3. DIAGNOSIS
Primary and comorbid diagnoses (ICD-10)

4. TREATMENT PROVIDED
Medication changes (table format: Commenced/Ceased/Continued)
Psychological interventions
OT/social work involvement
Physical health management

5. DISCHARGE MEDICATIONS
Full medication list with doses, routes, frequencies
PBS item codes
Supply provided (e.g., 1 week TCA, scripts provided)

6. RISK ASSESSMENT AT DISCHARGE
Current risk level with rationale
Safety plan in place (Y/N)
Carer/NOK awareness

7. FOLLOW-UP PLAN
Next appointment (date, clinician, location)
GP follow-up needs
Community mental health follow-up
Crisis contact numbers provided

═══ REFERRAL LETTER ═══

Include: Reason for referral, clinical history, current medications, specific questions for the receiving clinician, urgency level, patient consent obtained.

═══ MHRT REPORT (Mental Health Review Tribunal) ═══

Required sections:
- Patient demographics and legal status
- Clinical history and current presentation
- MSE findings
- Risk assessment
- Treatment provided and response
- Recommendation regarding treatment order
- Criteria under s45/s55 MHA 2014 (Vic)`,
    },
    {
      title: 'Clinical Report Structures — Progress Notes & Reviews',
      category: 'clinical_guidelines',
      priority: 20,
      content: `CLINICAL NOTE FORMATS FOR MENTAL HEALTH

═══ PROGRESS NOTE (SOAP) ═══

S (Subjective): Patient's reported symptoms, concerns, mood. Direct quotes where relevant. Carer/family input.

O (Objective): MSE findings. Vital signs if relevant. Observed behaviour. Collateral information. Blood results.

A (Assessment): Clinical impression. Diagnostic formulation. Risk assessment update. Response to treatment.

P (Plan): Medication changes. Next appointment. Tasks delegated. Safety plan reviewed. Referrals made.

═══ WARD ROUND NOTE ═══

ATTENDANCE: [List all attendees with roles]
OVERNIGHT: Sleep, nursing observations, PRN usage, incidents
PRESENTATION: Appearance, engagement, complaints
MSE: Key findings focused on changes
RISK: Current risk assessment with level
MEDICATIONS: Changes, side effects, PRN usage
CONSULTANT DIRECTIVES: Numbered action items
PLAN: Discharge planning status, leave, follow-up

═══ 91-DAY REVIEW ═══

REVIEW PERIOD: [Date range]
TREATMENT GOALS: Review of goals set at last review
PROGRESS: Summary of engagement, presentations, risk events
MEDICATION: Current regimen, efficacy, side effects, adherence
OUTCOME MEASURES: HoNOS, K10, DASS, LSP scores with trends
PSYCHOSOCIAL: Housing, employment, social supports, NDIS, legal
RISK: Current risk profile, changes from last review
PLAN: Goals for next 91 days with delegated tasks

═══ CLINICAL FORMULATION (4P Framework) ═══

BIOLOGICAL:
- Predisposing: Family Hx, genetics, neurodevelopment, birth complications
- Precipitating: Medication non-adherence, substance use, physical illness
- Perpetuating: Ongoing substance use, medication side effects, chronic pain
- Protective: Good physical health, medication response, exercise

PSYCHOLOGICAL:
- Predisposing: Early trauma, attachment difficulties, cognitive style
- Precipitating: Loss, relationship breakdown, workplace stress
- Perpetuating: Avoidance, rumination, poor coping strategies
- Protective: Intelligence, insight, motivation, therapeutic relationship

SOCIAL:
- Predisposing: Social disadvantage, migration, cultural factors
- Precipitating: Housing loss, unemployment, isolation, legal issues
- Perpetuating: Ongoing housing instability, poverty, stigma
- Protective: Family support, employment, peer connections, NDIS

═══ RISK ASSESSMENT FORMAT ═══

RISK TO SELF:
- Suicidal ideation: passive/active, plan, intent, access to means
- Self-harm: method, frequency, escalation pattern
- Self-neglect: nutrition, hygiene, medication, shelter

RISK TO OTHERS:
- Homicidal ideation: target, plan
- Aggression: triggers, pattern, weapons access
- Stalking/harassment

VULNERABILITY:
- Exploitation: financial, sexual, physical
- Homelessness risk
- Child safety concerns

STATIC FACTORS: [List]
DYNAMIC FACTORS: [List — these drive the management plan]
OVERALL RISK LEVEL: Low / Medium / High / Very High
MANAGEMENT PLAN: [Matched to dynamic factors]`,
    },
    {
      title: 'Australian Mental Health Legislation Reference',
      category: 'policies',
      priority: 30,
      content: `MENTAL HEALTH ACT 2014 (VICTORIA) — KEY PROVISIONS

ASSESSMENT ORDERS (s29):
- Duration: up to 24 hours
- Criteria: person appears to have mental illness, needs immediate assessment
- Authorised by: registered medical practitioner or mental health practitioner

TEMPORARY TREATMENT ORDERS (s45):
- Duration: up to 28 days
- Criteria: person has mental illness AND needs immediate treatment to prevent serious deterioration or harm AND no less restrictive means available AND person lacks capacity to consent
- Authorised by: authorised psychiatrist
- Must be reviewed by MHRT within 28 days

TREATMENT ORDERS (s55):
- Duration: up to 6 months (inpatient) or 12 months (community)
- Granted by: Mental Health Tribunal
- Review: at expiry or on patient/carer application

COMMUNITY TREATMENT ORDERS:
- Patient must comply with treatment plan
- Can specify: medication, attendance, drug testing
- Breach may result in return to inpatient care

PATIENT RIGHTS:
- Right to communicate with legal representative
- Right to independent mental health advocacy (IMHA)
- Right to a second psychiatric opinion
- Right to apply for MHRT review
- Right to nominate a support person

RESTRICTIVE INTERVENTIONS (Part 6):
- Seclusion: maximum 4 hours, 15-minute observations
- Restraint: minimum force, minimum duration
- Must be authorised by authorised psychiatrist
- Full documentation required within 2 hours
- Mandatory reporting to Chief Psychiatrist

ADVANCE STATEMENTS:
- Patient can document treatment preferences while well
- Must be considered in treatment decisions
- Can be overridden only by authorised psychiatrist with documentation`,
    },
    {
      title: 'Medication Reference — Psychiatry (Australian PBS)',
      category: 'formulary',
      priority: 25,
      content: `PSYCHIATRIC MEDICATION QUICK REFERENCE — AUSTRALIAN PBS

═══ ANTIPSYCHOTICS ═══

FIRST GENERATION:
- Haloperidol 0.5-20mg/day PO or IM (PBS 5823) — Schizophrenia
- Chlorpromazine 75-800mg/day PO — Schizophrenia, acute psychosis
- Zuclopenthixol decanoate 200-400mg IM q2-4w (PBS 5828) — LAI

SECOND GENERATION:
- Olanzapine 5-20mg/day PO (PBS 5824) — Schizophrenia. HIGH metabolic risk.
- Risperidone 1-6mg/day PO (PBS 5826) — Schizophrenia. EPS risk increases >4mg.
- Quetiapine 150-800mg/day PO (PBS 8418/8419) — Schizophrenia/Bipolar
- Aripiprazole 10-30mg/day PO (PBS 9098) — Schizophrenia. Lower metabolic risk.
- Clozapine 100-900mg/day PO (PBS 1928) — Treatment-resistant schizophrenia ONLY. Requires CPMS registration, weekly FBC for 18 weeks then monthly.
- Paliperidone palmitate 75-150mg IM monthly (PBS 9522) — Schizophrenia LAI
- Aripiprazole LAI 300-400mg IM monthly (PBS 10406) — Schizophrenia LAI
- Lurasidone 40-160mg/day PO (PBS 10574) — Schizophrenia. Take with food.

METABOLIC MONITORING (all antipsychotics):
Baseline: FBC, UEC, LFT, fasting glucose, HbA1c, lipids, weight, waist, BMI, ECG
3 months: weight, waist, fasting glucose, lipids
6 months: weight, waist, fasting glucose, lipids, HbA1c
Annually: Full metabolic panel + ECG

═══ MOOD STABILISERS ═══

- Lithium 450-1200mg/day (PBS 2434) — Bipolar. Target level 0.6-0.8 mmol/L (maintenance). Check levels, renal, thyroid q6m.
- Sodium valproate 500-2000mg/day (PBS 2614) — Bipolar/epilepsy. Target level 50-100 mg/L. Teratogenic — pregnancy risk.
- Lamotrigine 25-200mg/day (PBS 8102) — Bipolar maintenance. SLOW titration (SJS risk). Start 25mg/day, increase q2w.
- Carbamazepine 400-1200mg/day (PBS 1326) — Bipolar/epilepsy. Drug interactions (CYP3A4 inducer).

═══ ANTIDEPRESSANTS ═══

SSRIs:
- Sertraline 50-200mg/day (PBS 8538) — MDD, OCD, PTSD. First-line.
- Fluoxetine 20-80mg/day (PBS 1655) — MDD, OCD. Long half-life.
- Escitalopram 10-20mg/day (PBS 8846) — MDD, GAD. Clean side effect profile.

SNRIs:
- Venlafaxine 75-375mg/day XR (PBS 8296) — MDD, GAD. Check BP at higher doses.
- Desvenlafaxine 50-200mg/day (PBS 9529) — MDD. Fixed dose option.
- Duloxetine 60-120mg/day (PBS 8805) — MDD, GAD, neuropathic pain.

Other:
- Mirtazapine 15-45mg/day (PBS 2553) — MDD. Sedating, weight gain. Good for insomnia/poor appetite.

═══ ANXIOLYTICS / HYPNOTICS (S4/S8) ═══

- Diazepam 2-40mg/day (PBS 1586) — Short-term anxiety. S4 or S8 depending on jurisdiction.
- Temazepam 10-20mg nocte (PBS 2655) — Insomnia (short-term only). S8.
- Melatonin 2mg MR nocte (PBS 10925) — Insomnia in adults ≥55.

LAI REVALIDATION: Every 6 months — review clinical rationale, side effects (TD/AIMS), consent, blood tests.`,
    },
    {
      title: 'ISBAR Clinical Handover Template',
      category: 'templates',
      priority: 20,
      content: `ISBAR CLINICAL HANDOVER FORMAT

I — IDENTIFY
Patient name, DOB, UR number, ward/bed (if inpatient), current legal status, treating team, primary clinician.

S — SITUATION
Why you are handing over. What has changed. Urgency level. Is this routine handover or escalation?

B — BACKGROUND
Diagnosis, current admission reason (if inpatient), relevant psychiatric history, current medications (list key ones), allergies, relevant medical conditions, substance use.

A — ASSESSMENT
Current MSE findings (focus on changes). Current risk level with specific concerns. Physical health status. Medication adherence and response. Recent investigations.

R — RECOMMENDATION
What needs to happen next. Specific tasks for incoming team. Pending results to follow up. Appointments to keep. Safety plan status. When to escalate.

HANDOVER PRIORITIES:
1. Safety — any immediate risk concerns
2. Medication — changes, PRN usage, monitoring due
3. Legal — MHA orders expiring, tribunal dates
4. Physical — vitals concerns, investigations pending
5. Psychosocial — family meetings, leave arrangements, discharge planning`,
    },
    {
      title: 'Outcome Measures Reference — HoNOS, K10, DASS',
      category: 'clinical_guidelines',
      priority: 35,
      content: `CLINICAL OUTCOME MEASURES — AUSTRALIAN MENTAL HEALTH

═══ HoNOS (Health of the Nation Outcome Scales) ═══
12 scales, each rated 0-4:
1. Overactive/aggressive behaviour
2. Non-accidental self-injury
3. Problem drinking or drug-taking
4. Cognitive problems
5. Physical illness or disability
6. Hallucinations and delusions
7. Depressed mood
8. Other mental/behavioural problems
9. Relationships
10. Activities of daily living
11. Living conditions
12. Occupation and activities

Scoring: 0=No problem, 1=Minor, 2=Mild, 3=Moderate, 4=Severe
Total range: 0-48. Higher = more severe.
Clinically significant change: ≥4 point reduction.
Required: at admission, review, discharge (NOCC/ABF reporting).

═══ K10 (Kessler Psychological Distress Scale) ═══
10 questions, each 1-5. Total range: 10-50.
10-19: Likely to be well
20-24: Likely mild disorder
25-29: Likely moderate disorder
30-50: Likely severe disorder

═══ DASS-21 ═══
21 items across 3 scales (multiply by 2 for full DASS scores):
Depression: Normal 0-9, Mild 10-13, Moderate 14-20, Severe 21-27, Extremely Severe 28+
Anxiety: Normal 0-7, Mild 8-9, Moderate 10-14, Severe 15-19, Extremely Severe 20+
Stress: Normal 0-14, Mild 15-18, Moderate 19-25, Severe 26-33, Extremely Severe 34+

═══ LSP-16 (Life Skills Profile) ═══
16 items rated 0-3. Total range: 0-48. Lower = better functioning.
Domains: Self-care, Non-turbulence, Social contact, Communication.
Required for NOCC/ABF reporting alongside HoNOS.`,
    },
  ];

  for (const cf of contextFiles) {
    const existing = await db('ai_context_files')
      .where({ clinic_id: CLINIC_ID, title: cf.title })
      .first();
    if (!existing) {
      await db('ai_context_files').insert({
        id: uuidv4(),
        clinic_id: CLINIC_ID,
        title: cf.title,
        description: `Auto-seeded psychiatry training material`,
        category: cf.category,
        content: cf.content,
        content_format: 'text',
        is_active: true,
        include_in_rag: true,
        priority: cf.priority,
        token_estimate: Math.ceil(cf.content.length / 4),
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`  ✓ ${cf.title}`);
    } else {
      console.log(`  ○ ${cf.title} (exists)`);
    }
  }

  // ── 2. ENHANCED SYSTEM PROMPTS (ai_modelfiles) ──────────────────────────

  const modelfiles = [
    {
      action_type: 'maudsley',
      system_prompt: `You are a senior psychiatric registrar at an Australian public mental health service documenting a Maudsley longitudinal summary.

STRUCTURE: Follow these sections IN ORDER:
1. IDENTIFYING DATA (name, DOB, UR, gender, ATSI, interpreter, legal status)
2. PRESENTING COMPLAINT (patient's words, current episode)
3. HISTORY OF PRESENTING ILLNESS (chronological, symptom progression, functional impact)
4. PSYCHIATRIC HISTORY (past episodes, admissions, medication trials, risk history)
5. MEDICAL HISTORY (conditions, allergies, metabolic monitoring)
6. SUBSTANCE USE (alcohol, cannabis, methamphetamine, opioids — quantity/frequency/last use)
7. FAMILY HISTORY (psychiatric, substance, medical)
8. PERSONAL HISTORY (development, education, employment, relationships, forensic)
9. PREMORBID PERSONALITY
10. MENTAL STATE EXAMINATION (all domains)
11. RISK ASSESSMENT (self, others, vulnerability — static and dynamic factors)
12. FORMULATION (4P biopsychosocial)
13. DIAGNOSIS (ICD-10, primary + comorbid + differential)
14. MANAGEMENT PLAN (medication with rationale, psychological, social, risk management, follow-up)

RULES:
- Only use information provided — never fabricate
- Use Australian English spelling
- Reference Mental Health Act 2014 (Vic) for legal status
- Include PBS codes for medications
- Be concise but thorough — aim for 2-3 pages
- Use plain text formatting, no markdown`,
    },
    {
      action_type: 'letter',
      system_prompt: `You are a consultant psychiatrist writing a clinical letter from an Australian public mental health service.

LETTER FORMAT:
1. Service letterhead: [Service Name], [Address], [Phone]
2. Date
3. Recipient: Dr [Name], [Practice], [Address]
4. Salutation: Dear Dr [Name],
5. Re: line: [Patient Full Name] (UR: [number], DOB: [date], Sex: [M/F])
6. Body: Opening paragraph (purpose), clinical content, medications, plan
7. Sign-off: Kind regards, [Name], [Title], [Registration]

MEDICATION FORMAT:
- List each medication: drug name, dose, route (if not oral), frequency
- Use: nocte, mane, midi, PO, IM, SC, PRN
- Mark CEASED medications clearly
- Include PBS authority codes

LETTER TYPES:
- GP letter: 1 page, concise, focus on what GP needs to do
- NDIS letter: 2-3 pages, address ALL functional domains, permanence statement
- Discharge letter: comprehensive, include medication table
- Referral letter: specific questions, urgency, consent obtained

RULES:
- Australian English spelling
- Professional, respectful tone
- Only use provided clinical information
- Include specific monitoring requests for GP
- No markdown formatting`,
    },
    {
      action_type: 'discharge',
      system_prompt: `You are a psychiatric registrar writing a discharge summary for an Australian mental health inpatient unit.

STRUCTURE:
1. ADMISSION DETAILS: Date in, date out, LOS, ward, legal status at admission and discharge
2. REASON FOR ADMISSION: Presenting complaint, risk factors, precipitants
3. DIAGNOSIS: Primary (ICD-10), comorbid, differential
4. ADMISSION MSE: Key findings
5. TREATMENT PROVIDED:
   - Medication changes (table: Drug | Action | Dose | Rationale)
   - Psychological interventions
   - OT/Social work involvement
   - Physical health management
6. DISCHARGE MSE: Current mental state
7. DISCHARGE MEDICATIONS: Full list with PBS codes, supply provided
8. RISK AT DISCHARGE: Level, rationale, safety plan status
9. FOLLOW-UP:
   - Next appointment (date, clinician, location)
   - GP follow-up (specific requests)
   - Community team handover
   - Crisis contacts provided

RULES:
- Be comprehensive but structured
- Include all medication changes with rationale
- Specify what the GP needs to monitor
- Document risk and safety planning
- Australian formatting and spelling`,
    },
    {
      action_type: 'formulation',
      system_prompt: `You are a clinical psychologist generating a biopsychosocial formulation for an Australian mental health consumer.

USE THE 4P FRAMEWORK across three domains:

BIOLOGICAL DOMAIN:
- Predisposing: Genetics, family Hx, neurodevelopment, perinatal complications
- Precipitating: Medication changes, physical illness, substance intoxication/withdrawal
- Perpetuating: Ongoing substance use, medication non-adherence, chronic pain, sleep disruption
- Protective: Good physical health, medication response, exercise, nutrition

PSYCHOLOGICAL DOMAIN:
- Predisposing: Early trauma, attachment difficulties, cognitive style, personality traits
- Precipitating: Loss, relationship breakdown, workplace stress, identity crisis
- Perpetuating: Avoidance, rumination, maladaptive coping, learned helplessness
- Protective: Intelligence, insight, psychological mindedness, motivation, therapeutic alliance

SOCIAL DOMAIN:
- Predisposing: Social disadvantage, migration stress, cultural displacement, intergenerational trauma
- Precipitating: Housing loss, unemployment, isolation, financial crisis, legal issues
- Perpetuating: Ongoing housing instability, poverty, stigma, limited social network
- Protective: Family support, employment, cultural connections, peer support, NDIS

END WITH:
- Diagnostic impression
- Key maintaining factors (targets for intervention)
- Recommended interventions matched to maintaining factors
- Prognosis

RULES:
- Integrate information coherently — don't just list factors
- Show how factors interact
- Be specific to the individual, not generic
- Use trauma-informed language
- Australian English`,
    },
    {
      action_type: 'ambient',
      system_prompt: `You are a clinical documentation assistant converting a psychiatrist-patient conversation into structured clinical notes for an Australian mental health service.

OUTPUT FORMAT depends on the selected template (SOAP, Ward Round, Collateral, etc).

EXTRACTION RULES:
1. Extract ONLY what was said — never add information
2. Clinical facts get [high confidence], inferred observations get [medium confidence]
3. Medications: extract exact drug name, dose, frequency
4. Risk: any mention of self-harm, suicide, violence, substance use — flag with SAFETY ALERT
5. Separate clinician observations from patient reports

MEDICATION ALERTS:
- Flag if patient reports non-adherence
- Flag if patient reports new side effects
- Flag dose changes mentioned

RISK FLAGS:
- Any suicidal ideation: immediate, passive, or historical
- Any self-harm: current or recent
- Any substance use: type, quantity, last use
- Any violence/aggression: toward whom, triggers

FORMATTING:
- Plain text, no markdown
- Section headers in UPPERCASE
- Bullet points with plain dashes
- Confidence markers: [high], [medium], [low]
- Australian English spelling
- Medication in format: Drug Dose Route Frequency`,
    },
  ];

  for (const mf of modelfiles) {
    const existing = await db('ai_modelfiles')
      .where({ clinic_id: CLINIC_ID, action_type: mf.action_type })
      .first();
    if (!existing) {
      await db('ai_modelfiles').insert({
        id: uuidv4(),
        clinic_id: CLINIC_ID,
        action_type: mf.action_type,
        model_name: 'qwen2.5:14b',
        system_prompt: mf.system_prompt,
        temperature: 0.2,
        max_tokens: 4096,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`  ✓ Modelfile: ${mf.action_type}`);
    } else {
      console.log(`  ○ Modelfile: ${mf.action_type} (exists)`);
    }
  }

  console.log('\nDone! AI training context seeded.');
  process.exit(0);
}

seedAiTraining().catch(err => { console.error(err); process.exit(1); });
