/**
 * Extensive 3-5 Year Clinical History Seed
 * Run: npx ts-node -T -r dotenv/config -r tsconfig-paths/register --project tsconfig.node.json src/seed-history-data.ts
 */
import { db } from './db/db';
import { v4 as uuid } from 'uuid';

const C = '11111111-1111-1111-1111-111111111111';
const S = {
  sarah: '30a05d60-f949-42ec-b0a8-066c51e35770',
  james: 'dd2482b3-38f0-43cf-9531-f9709857b7df',
  emma: '17dd364b-f611-406f-8d93-d737d76f0ad6',
  michael: '9fae2bc2-4e69-400e-92a1-e0224a00c13f',
  lisa: 'fae7a0e2-bcda-42fe-b59f-72cece04b438',
};
const P = {
  marcus: '2764e3e4-d6ad-419a-a2f0-4ddece72708f',
  priya: '90a9f913-90b0-45c4-82fb-fb14ead93d4a',
  william: '1dcebfb8-4ac2-444b-8ee5-b582e754725d',
  jessica: '26e210b5-9193-464c-8171-dbad94584fad',
  thomas: '0e166801-c7e9-4e0f-80d0-113243c253dd',
  aisha: 'd700f7a8-d8db-43c3-be07-6642327de7b3',
  daniel: 'ccd06519-f5ba-4c1a-8df9-5c215044d709',
};

function d(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }

function note(pid: string, epId: string | null, cat: string, date: string, html: string, author: string, signed = true) {
  return {
    id: uuid(), clinic_id: C, patient_id: pid, episode_id: epId, author_id: author,
    note_category: cat, source_type: 'manual', content_html: html,
    is_signed: signed, is_draft: !signed,
    signed_by_id: signed ? author : null, signed_at: signed ? new Date(date) : null,
    note_date: date, created_at: new Date(date), updated_at: new Date(date),
  };
}

type ClinicalNoteSeedRow = ReturnType<typeof note>;
interface HistoricalMedicationSeed {
  patient_id: string;
  medication_name: string;
  dose: string;
  frequency: string;
  route: string;
  status: string;
  prescribed_at: string;
  prescriber: string;
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return null;
}

async function seed() {
  console.log('Seeding 3-5 year clinical history...');
  const notes: ClinicalNoteSeedRow[] = [];

  // ======== MARCUS JOHNSON — 5 year history (paranoid schizophrenia) ========
  const epMarcus = await db('episodes').where({ patient_id: P.marcus, status: 'open' }).first().then(r => r?.id);

  // 2021 — First presentation
  notes.push(note(P.marcus, null, 'Intake Assessment', d(2021,6,10),
    `<h3>Intake Assessment — ACIS</h3><p><b>Referral source:</b> GP Dr Mehta, Box Hill Medical</p>
<p><b>Presenting:</b> 28yo male, brought by mother. 3-month history of increasing paranoia, social withdrawal, talking to himself. Dropped out of TAFE. Cannabis use daily x 2 years. FHx: paternal uncle — schizophrenia.</p>
<p><b>MSE:</b> Guarded, poor eye contact, thought-disordered, persecutory delusions (believes workmates are plotting against him), AVH (2 male voices giving commands), blunted affect, nil insight.</p>
<p><b>Risk:</b> Moderate — command hallucinations but denies intent to act, no plan. Vulnerable due to substance use and social isolation.</p>
<p><b>Impression:</b> First episode psychosis. Commence antipsychotic. FEP pathway.</p>
<p><b>Plan:</b> Risperidone 1mg nocte → titrate to 3mg. Bloods, UDS, CT brain. ACIS FU 48hrs.</p>`, S.michael));

  notes.push(note(P.marcus, null, 'Progress Note', d(2021,7,15),
    `<h3>FEP Clinic — 6 Week Review</h3><p>Partial response to risperidone 3mg. AVH reduced but still present. Persecutory delusions persistent. Sleep improved. Cannabis ceased 2 weeks ago. Weight gain 2kg. Prolactin elevated (890).</p>
<p><b>Plan:</b> Increase risperidone to 4mg. Repeat prolactin in 4 weeks. OT assessment for social activity.</p>`, S.michael));

  notes.push(note(P.marcus, null, 'Progress Note', d(2021,10,20),
    `<h3>Psychiatrist Review</h3><p>Risperidone 4mg x 3 months. Positive symptoms 50% improved but residual AVH persistent. PANSS total: 72 (baseline 95). Side effects: significant weight gain (+8kg), galactorrhoea, sedation. Patient requesting medication change.</p>
<p><b>Plan:</b> Cross-titrate to olanzapine 10mg. Monitor metabolic parameters. Dietary advice.</p>`, S.sarah));

  // 2022 — Hospitalisation
  notes.push(note(P.marcus, null, 'Progress Note', d(2022,3,5),
    `<h3>ED Presentation — Acute Psychotic Relapse</h3><p>Brought by police. Found wandering streets at 2am, agitated, responding to hallucinations. Ceased olanzapine 3 weeks ago (felt "cured"). Mother reports progressive deterioration over 2 weeks. Assaulted security guard in ED (punched to face).</p>
<p><b>MSE:</b> Agitated, pacing, pressure of speech, floridly psychotic — paranoid delusions, command AVH telling him to "defend himself." Nil insight.</p>
<p><b>Risk:</b> HIGH — active aggression, command hallucinations, nil insight, medication non-adherent.</p>
<p><b>Plan:</b> Admit IPU under Assessment Order s29. Olanzapine 20mg stat, then 10mg BD. Lorazepam 2mg PRN. 1:1 nursing. Notify MHRT.</p>`, S.james));

  notes.push(note(P.marcus, null, 'Ward Round', d(2022,3,12),
    `<h3>IPU Ward Round — Day 7</h3><p><b>Present:</b> Dr Chen, Dr Patel, RN Nguyen, OT Williams</p>
<p>Settling on IPU. Olanzapine 20mg stabilising symptoms. AVH reducing. No further aggression. Accepting medication reluctantly. Family meeting held — parents supportive but exhausted.</p>
<p><b>Legal:</b> TTO s45 applied for. Hearing scheduled 18/03.</p>
<p><b>Plan:</b> Continue olanzapine 20mg. Begin psychoeducation. Plan for depot antipsychotic on discharge to prevent future non-adherence. Family therapy referral.</p>`, S.sarah));

  notes.push(note(P.marcus, null, 'Progress Note', d(2022,3,25),
    `<h3>Discharge Summary — IPU Admission</h3><p><b>Admitted:</b> 05/03/2022 | <b>Discharged:</b> 25/03/2022 | <b>LOS:</b> 20 days</p>
<p><b>Diagnosis:</b> Paranoid Schizophrenia (F20.0) — acute exacerbation due to medication non-adherence.</p>
<p><b>Treatment:</b> Olanzapine 20mg → stabilised → cross-titrated to paliperidone palmitate 100mg loading doses, then 150mg monthly. Lorazepam PRN (used x4).</p>
<p><b>Discharge medications:</b> Paliperidone palmitate 150mg monthly (next due 22/04), Olanzapine 10mg nocte (tapering), Benztropine 2mg BD.</p>
<p><b>Follow-up:</b> CCT1 within 7 days. Dr Chen monthly. Key clinician Lisa Nguyen fortnightly. Depot clinic monthly.</p>
<p><b>Legal:</b> Treatment Order s55 granted by MHRT — community-based, mandatory depot.</p>`, S.james));

  // 2022-2023 — Community treatment
  const progressDates2022 = ['2022-05-10','2022-07-15','2022-09-20','2022-11-18'];
  for (const dt of progressDates2022) {
    notes.push(note(P.marcus, null, 'Progress Note', dt,
      `<h3>Key Clinician Review</h3><p><b>Date:</b> ${new Date(dt).toLocaleDateString('en-AU')}</p>
<p>Marcus attended home visit. Depot adherent — administered at clinic. Living in PDRSS supported unit. Symptoms well-controlled — nil AVH or delusions. Negative symptoms persist (avolition, social withdrawal). PHQ-9: 8 (mild). Cannabis-free since March. Weight stable at 98kg.</p>
<p><b>Plan:</b> Continue current regimen. OT vocational assessment. Encourage social activities through Clubhouse program. Next psychiatrist review ${new Date(new Date(dt).getTime() + 30*86400000).toLocaleDateString('en-AU')}.</p>`, S.lisa));
  }

  notes.push(note(P.marcus, null, '91-Day Review', d(2022,9,5),
    `<h3>91-Day Review</h3><p><b>Period:</b> 06/06/2022 — 05/09/2022</p>
<p><b>Summary:</b> Stable period. 6 clinical encounters, all attended. Depot adherent x6 administrations. No hospital presentations. PANSS: 58 (improved from 72). Negative symptoms main concern. NDIS application submitted — approved for 15hrs/week psychosocial support. Cannabis-free 6 months.</p>
<p><b>Risk:</b> Low. Historical risk of aggression when unwell — currently well-managed with depot. No SI.</p>
<p><b>Plan next 91d:</b> Continue paliperidone 150mg. Commence Clubhouse program. OT vocational assessment. Consider olanzapine dose reduction. MHRT review due December.</p>`, S.sarah));

  // 2023 — Stable with minor events
  const progressDates2023 = ['2023-01-18','2023-03-22','2023-05-17','2023-07-12','2023-09-06','2023-11-15'];
  for (let i = 0; i < progressDates2023.length; i++) {
    const dt = progressDates2023[i];
    const special = i === 2 ? '\nBrief increase in suspiciousness last week — triggered by new neighbour. Resolved within 3 days without medication change. Discussed coping strategies.' : '';
    notes.push(note(P.marcus, null, 'Progress Note', dt,
      `<h3>Community Review</h3><p>Routine review. Marcus stable on paliperidone LAI 150mg. Olanzapine reduced to 10mg nocte (from 20mg — tapered successfully). Attending Clubhouse 3x/week. Commenced volunteer work at op shop. Social connections improving.${special}</p>
<p>Metabolic: Weight 95kg (down 3kg), fasting glucose 5.4, lipids within range. HbA1c 5.2%.</p>`, S.lisa));
  }

  notes.push(note(P.marcus, null, '91-Day Review', d(2023,6,1),
    `<h3>91-Day Review</h3><p><b>Period:</b> 01/03/2023 — 01/06/2023</p>
<p><b>Summary:</b> Excellent period. 8 encounters, 7 attended (1 rescheduled due to volunteer work — positive reason). Depot 100% adherent. No psychotic symptoms. Commenced volunteer work. Weight loss 3kg. One brief spike in suspiciousness (May) — self-managed with coping strategies, no medication change needed.</p>
<p><b>Recommendation:</b> Continue Treatment Order — although functioning well, history of rapid relapse when non-adherent. Review TO necessity at next MHRT (December). Consider NDIS plan review — may be eligible for employment support.</p>`, S.sarah));

  notes.push(note(P.marcus, null, '91-Day Review', d(2023,12,1),
    `<h3>91-Day Review</h3><p><b>Period:</b> 01/09/2023 — 01/12/2023</p>
<p>Sustained stability. Commenced paid part-time employment at charity shop (8hrs/week). Social network expanding — joined community cricket. No psychotic symptoms for 12+ months. TO renewed at MHRT — panel acknowledged improvement but agreed continued monitoring warranted given severity of 2022 relapse.</p>
<p><b>Plan:</b> Continue current. Discuss with MHRT possibility of CTO cessation at next review if stability maintained. Increase employment hours gradually.</p>`, S.sarah));

  // 2024 — Continued stability, medication optimisation
  const progressDates2024 = ['2024-02-14','2024-04-10','2024-06-19','2024-08-14','2024-10-16','2024-12-11'];
  for (const dt of progressDates2024) {
    notes.push(note(P.marcus, null, 'Progress Note', dt,
      `<h3>Psychiatrist Review</h3><p>Marcus continues well. Paliperidone LAI 150mg — well-tolerated. Olanzapine 10mg nocte maintained for sleep and residual negative symptoms. PANSS: 48 (near-remission). Working 12hrs/week. Relationship with parents improved. Attending cricket training regularly.</p>
<p>Discussed TO — Marcus now expressing desire to continue medication voluntarily. Will discuss with MHRT at next hearing.</p>`, S.sarah));
  }

  // 2025-2026 — Recent history (already seeded some, add more)
  notes.push(note(P.marcus, epMarcus, 'Progress Note', d(2025,3,10),
    `<h3>Annual Metabolic Review</h3><p><b>Results:</b> Weight 92kg (BMI 29.1), BP 128/82, Fasting glucose 5.8 (borderline), HbA1c 5.5%, Total cholesterol 5.2, LDL 3.1 (slightly elevated), HDL 1.2, Triglycerides 1.8.</p>
<p><b>Assessment:</b> Metabolic syndrome risk — borderline. Weight improved from peak 98kg. Dietary changes and exercise having effect.</p>
<p><b>Plan:</b> Continue lifestyle modifications. Dietitian review. Repeat in 6 months. Consider statin if LDL remains >3.0.</p>`, S.sarah));

  // ======== JESSICA NGUYEN — 4 year depression/suicide history ========
  // Episode ID for Jessica (used for note context below)
  await db('episodes').where({ patient_id: P.jessica, status: 'open' }).first();

  notes.push(note(P.jessica, null, 'Intake Assessment', d(2022,4,1),
    `<h3>Intake — GP Referral</h3><p>29yo female referred by GP for severe depression with psychotic features. PHQ-9: 24 (severe). GAD-7: 18. Employed as teacher — on sick leave 6 weeks. Hx of childhood sexual abuse (disclosed to GP). First presentation to specialist mental health.</p>
<p><b>Medications from GP:</b> Sertraline 100mg (6 weeks, minimal response).</p>
<p><b>Plan:</b> Increase sertraline to 150mg. Psychologist referral — trauma-informed CBT. Safety plan. Review 2 weeks.</p>`, S.emma));

  notes.push(note(P.jessica, null, 'Progress Note', d(2022,8,15),
    `<h3>ED Presentation — Deliberate Self-Poisoning</h3><p>Presented to ED after paracetamol overdose (32 tablets). Found by partner. Toxicology: paracetamol level 180mg/L at 4hrs — commenced NAC protocol. Medically cleared after 48hrs ICU.</p>
<p><b>Precipitant:</b> Anniversary of childhood abuse. Relationship conflict. Felt "everything would be easier if I wasn't here."</p>
<p><b>MSE:</b> Tearful, hopeless, nihilistic. "I'm a burden." Passive SI — no current active plan. Regrets attempt.</p>
<p><b>Plan:</b> Admit IPU voluntary. Increase sertraline to 200mg. Commence quetiapine 25mg nocte for sleep. Psychology — trauma-focused. Safety plan reviewed. Restricted medication access on discharge.</p>`, S.james));

  notes.push(note(P.jessica, null, 'Discharge Summary', d(2022,9,5),
    `<h3>Discharge Summary</h3><p><b>Admission:</b> 15/08 — 05/09/2022 (21 days). Voluntary.</p>
<p><b>Diagnosis:</b> Major Depressive Disorder, recurrent, severe with psychotic features (F33.3). PTSD (F43.1). History of deliberate self-harm.</p>
<p><b>Medications at discharge:</b> Sertraline 200mg mane, Quetiapine 50mg nocte.</p>
<p><b>Follow-up:</b> CCT2 within 48hrs. Dr Williams fortnightly. Psychologist weekly. Safety plan active. Weekly dispensing.</p>`, S.james));

  // 2023 — Second overdose, intensive treatment
  notes.push(note(P.jessica, null, 'Progress Note', d(2023,3,20),
    `<h3>ED Presentation — Second Overdose</h3><p>Mixed medication overdose (sertraline 40 tablets + quetiapine 20 tablets). Found unconscious by partner. GCS 6 on arrival. ICU admission 4 days — intubated. Serotonin syndrome features. Prolonged QTc.</p>
<p>Medically stabilised. Transferred to IPU. Very high risk. Family meeting — partner very distressed, considering leaving relationship.</p>`, S.emma));

  notes.push(note(P.jessica, null, 'Ward Round', d(2023,4,1),
    `<h3>IPU MDT — Day 12</h3><p>Mood slightly improved with structured environment. Commenced mirtazapine 30mg (sertraline ceased due to overdose toxicity). DBT group commenced. 1:1 therapy with psychologist re: trauma processing.</p>
<p>Partner visited — relationship under significant strain. Social worker involved for housing contingency planning.</p>
<p><b>Plan:</b> Step-down to PARC when stable. Cross-titrate to venlafaxine (SNRI — different class after SSRI failures). Commence weekly dispensing permanently.</p>`, S.emma));

  // 2023-2024 — Gradual improvement
  const jessicaDates = ['2023-06-15','2023-09-01','2023-12-10','2024-03-20','2024-06-15','2024-09-10','2024-12-05'];
  for (let i = 0; i < jessicaDates.length; i++) {
    const dt = jessicaDates[i];
    const phq = [18, 16, 14, 13, 11, 10, 9][i];
    notes.push(note(P.jessica, null, 'Progress Note', dt,
      `<h3>Psychiatrist Review</h3><p>PHQ-9: ${phq}${phq <= 10 ? ' (mild — best score since presentation)' : phq <= 14 ? ' (moderate)' : ' (moderately severe)'}. GAD-7: ${phq - 3}.</p>
<p>Venlafaxine ${i < 3 ? '225mg' : '300mg'} — ${i < 3 ? 'partial response, consider dose increase' : 'improved response since increase'}. Quetiapine 50mg nocte — helpful for sleep. ${i > 4 ? 'Self-harm urges rare — not acted on for 6 months.' : 'Intermittent self-harm urges — using ice/elastic band coping strategies from DBT.'}</p>
<p>${i >= 5 ? 'Commenced volunteer work at school reading program. Considering return to teaching part-time.' : 'Continuing DBT skills group. Behavioural activation — gradually increasing activities.'}</p>`, S.emma));
  }

  notes.push(note(P.jessica, null, '91-Day Review', d(2024,6,1),
    `<h3>91-Day Review</h3><p><b>Period:</b> March — June 2024</p>
<p>Significant improvement. PHQ-9 down from 13 to 11. No hospital presentations this period. No suicide attempts for 14 months. Self-harm urges reducing — using DBT distress tolerance skills effectively. Commenced volunteer work. Relationship with partner stabilised after couples therapy.</p>
<p><b>Risk:</b> Low-moderate (reduced from high). Safety plan current. Weekly dispensing maintained as precaution.</p>`, S.emma));

  // ======== AISHA — 3 year clozapine history ========
  notes.push(note(P.aisha, null, 'Progress Note', d(2023,5,1),
    `<h3>Treatment-Resistance Review</h3><p>Aisha has now failed adequate trials of: risperidone 6mg (8 weeks — partial response), olanzapine 30mg (12 weeks — minimal response), aripiprazole 30mg (8 weeks — no response). Persistent positive symptoms despite adherence.</p>
<p><b>Assessment:</b> Treatment-resistant schizophrenia by Conley criteria. Meets criteria for clozapine trial.</p>
<p><b>Plan:</b> Discuss clozapine with patient and family. Register with CMS. Baseline bloods including FBC, metabolic panel, ECG. Commence clozapine titration protocol — admit to IPU for initiation.</p>`, S.sarah));

  notes.push(note(P.aisha, null, 'Progress Note', d(2023,6,15),
    `<h3>Clozapine Initiation — Day 14</h3><p>Titration proceeding. Current dose: clozapine 200mg nocte. Tolerating well. Side effects: sedation (improving), sialorrhoea at night, mild constipation. FBC Day 14: WCC 7.2 (normal), ANC 4.1 (normal). ECG: QTc 420ms (normal). No myocarditis features.</p>
<p><b>Plan:</b> Continue titration to 300mg over next week. Daily FBC for first 18 weeks (as per protocol). Monitor bowel function closely.</p>`, S.sarah));

  notes.push(note(P.aisha, null, 'Progress Note', d(2023,8,10),
    `<h3>Clozapine — 2 Month Review</h3><p>Dose: 400mg nocte. First meaningful improvement in positive symptoms since illness onset. AVH reduced from constant to intermittent (2-3 times/week). Delusions less intense — beginning to question them. Affect more reactive. Engaging in ward activities.</p>
<p>Side effects: Weight gain 6kg, constipation (Movicol BD), sedation (moderate, improving). Clozapine level: 380 mcg/L (therapeutic). FBC stable.</p>
<p><b>Plan:</b> Increase to 450mg if residual symptoms persist. Plan for discharge to supported accommodation. Weekly bloods continue.</p>`, S.sarah));

  // 2024 — Community clozapine monitoring
  const aishaDates = ['2024-01-15','2024-04-10','2024-07-15','2024-10-10'];
  for (let i = 0; i < aishaDates.length; i++) {
    const dt = aishaDates[i];
    notes.push(note(P.aisha, null, 'Clozapine Monitoring', dt,
      `<h3>Clozapine Clinic</h3><p><b>Dose:</b> 450mg nocte. <b>Level:</b> ${[420, 445, 460, 450][i]} mcg/L. <b>WCC:</b> ${(6.5 + Math.random()).toFixed(1)}. <b>ANC:</b> ${(3.0 + Math.random()).toFixed(1)}.</p>
<p><b>Side effects:</b> Weight ${92 + i}kg (total gain 12kg since start). Constipation managed with Movicol. Sialorrhoea — hyoscine patch at night. Metabolic: fasting glucose ${(5.6 + i*0.1).toFixed(1)}, commenced metformin 500mg BD.</p>
<p><b>Clinical:</b> Sustained improvement. AVH now rare (1-2x/month, can dismiss). No delusions. Engaging in NDIS activities. Living in supported unit. ${i >= 2 ? 'Monthly bloods now (no longer weekly).' : 'Fortnightly bloods.'}</p>`, S.sarah));
  }

  // ======== WILLIAM — 4 year bipolar history ========
  notes.push(note(P.william, null, 'Progress Note', d(2022,5,1),
    `<h3>First Manic Episode</h3><p>32yo male. First psychiatric presentation. GP referral — wife noticed 2 weeks of reduced sleep, increased energy, grandiosity, reckless spending. FHx: mother — bipolar disorder.</p>
<p><b>Diagnosis:</b> Bipolar I Disorder — manic episode (F31.1). No psychotic features at this stage.</p>
<p><b>Plan:</b> Commence lithium 450mg BD. Olanzapine 5mg nocte PRN for sleep/agitation. Psychoeducation. Fortnightly reviews.</p>`, S.james));

  notes.push(note(P.william, null, 'Progress Note', d(2023,8,20),
    `<h3>Depressive Episode</h3><p>Following 12 months of euthymia, William presents with 6-week depressive episode. PHQ-9: 19 (severe). On sick leave from accounting firm. Lithium level therapeutic at 0.7. Sleep disrupted — early morning waking.</p>
<p><b>Plan:</b> Add quetiapine 300mg (bipolar depression evidence). Continue lithium. Psychologist referral — CBT for bipolar. Review in 2 weeks. Risk assessment — passive SI, no plan, strong protective factors (wife, 2 children).</p>`, S.james));

  notes.push(note(P.william, null, 'Progress Note', d(2024,11,5),
    `<h3>Pre-Manic Symptoms Detected</h3><p>Wife called — William has been sleeping only 4hrs for 3 nights, started a "business venture" at 2am, more talkative than usual. Early warning signs per relapse prevention plan.</p>
<p><b>Plan:</b> Increased olanzapine to 10mg. Lithium level checked — 0.6 (slightly below therapeutic). Increase lithium to 500mg BD. Daily phone check-ins for 1 week. Wife briefed on when to present to ED.</p>
<p>Averted full manic episode through early intervention — symptoms resolved within 5 days.</p>`, S.james));

  // ======== DANIEL — 3 year PTSD treatment ========
  const danielDates = ['2022-10-01','2023-02-15','2023-06-20','2023-10-10','2024-02-20','2024-06-15','2024-10-05','2025-02-10','2025-06-15','2025-10-20'];
  for (let i = 0; i < danielDates.length; i++) {
    const dt = danielDates[i];
    const pcl = [58, 52, 48, 42, 38, 35, 32, 30, 28, 25][i];
    const drinks = [45, 40, 35, 28, 20, 16, 14, 12, 10, 8][i];
    notes.push(note(P.daniel, null, i % 3 === 0 ? 'Psychology Review' : 'Progress Note', dt,
      `<h3>${i % 3 === 0 ? 'Psychology' : 'Psychiatrist'} Review — PTSD Treatment</h3>
<p><b>PCL-5:</b> ${pcl}/80 ${pcl < 33 ? '(below clinical threshold — significant improvement)' : pcl < 40 ? '(moderate)' : '(above clinical threshold)'}. <b>Alcohol:</b> ${drinks} std drinks/week ${drinks <= 14 ? '(within NHMRC guidelines)' : '(above guidelines)'}.</p>
<p>${i < 4 ? `Prolonged exposure therapy — session ${i * 3 + 1}. Processing index trauma (MVA). SUDS reducing. Nightmares ${['nightly','5-6/week','4-5/week','3-4/week'][i]}. Avoidance of driving remains primary functional impairment.` :
  i < 7 ? `Maintenance phase. Exposure to driving progressing — now driving short distances independently. Nightmares ${['2-3/week','1-2/week','1/week'][i-4]}. AA meetings ${['weekly','fortnightly','monthly'][i-4]}. Prazosin ${i >= 6 ? '3mg (reduced from 5mg)' : '5mg'} nocte.` :
  `Sustained improvement. Driving independently. Returned to part-time work as electrician. Nightmares rare. Alcohol within guidelines. Prazosin ${i >= 9 ? 'ceased' : '2mg nocte — tapering'}. Considering discharge from service.`}</p>`, i % 3 === 0 ? S.lisa : S.michael));
  }

  // Insert all notes
  let inserted = 0;
  for (const n of notes) {
    try {
      await db('clinical_notes').insert(n);
      inserted++;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message && !message.includes('duplicate')) {
        console.error(`Note insert error: ${message.substring(0, 60)}`);
      }
    }
  }
  console.log(`  ✓ ${inserted} clinical history notes (${notes.length} attempted)`);

  // ======== Historical medications (ceased) ========
  const histMeds: HistoricalMedicationSeed[] = [
    { patient_id: P.marcus, medication_name: 'Risperidone 3mg', dose: '3mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2021-06-10', prescriber: 'Dr Michael O\'Brien' },
    { patient_id: P.marcus, medication_name: 'Risperidone 4mg', dose: '4mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2021-07-15', prescriber: 'Dr Michael O\'Brien' },
    { patient_id: P.marcus, medication_name: 'Olanzapine 20mg', dose: '20mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2022-03-05', prescriber: 'Dr James Patel' },
    { patient_id: P.jessica, medication_name: 'Sertraline 100mg', dose: '100mg', frequency: 'Mane', route: 'oral', status: 'ceased', prescribed_at: '2022-02-15', prescriber: 'GP Dr Singh' },
    { patient_id: P.jessica, medication_name: 'Sertraline 150mg', dose: '150mg', frequency: 'Mane', route: 'oral', status: 'ceased', prescribed_at: '2022-04-01', prescriber: 'Dr Emma Williams' },
    { patient_id: P.jessica, medication_name: 'Sertraline 200mg', dose: '200mg', frequency: 'Mane', route: 'oral', status: 'ceased', prescribed_at: '2022-08-15', prescriber: 'Dr James Patel' },
    { patient_id: P.jessica, medication_name: 'Quetiapine 25mg', dose: '25mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2022-08-15', prescriber: 'Dr James Patel' },
    { patient_id: P.jessica, medication_name: 'Mirtazapine 30mg', dose: '30mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2023-04-01', prescriber: 'Dr Emma Williams' },
    { patient_id: P.jessica, medication_name: 'Venlafaxine 225mg', dose: '225mg', frequency: 'Mane', route: 'oral', status: 'ceased', prescribed_at: '2023-06-01', prescriber: 'Dr Emma Williams' },
    { patient_id: P.aisha, medication_name: 'Risperidone 6mg', dose: '6mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2022-06-01', prescriber: 'Dr Sarah Chen' },
    { patient_id: P.aisha, medication_name: 'Olanzapine 30mg', dose: '30mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2022-10-01', prescriber: 'Dr Sarah Chen' },
    { patient_id: P.aisha, medication_name: 'Aripiprazole 30mg', dose: '30mg', frequency: 'Mane', route: 'oral', status: 'ceased', prescribed_at: '2023-02-01', prescriber: 'Dr Sarah Chen' },
    { patient_id: P.aisha, medication_name: 'Clozapine 200mg', dose: '200mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2023-06-01', prescriber: 'Dr Sarah Chen' },
    { patient_id: P.aisha, medication_name: 'Clozapine 400mg', dose: '400mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2023-08-01', prescriber: 'Dr Sarah Chen' },
    { patient_id: P.william, medication_name: 'Lithium 450mg BD', dose: '900mg', frequency: 'BD (twice daily)', route: 'oral', status: 'ceased', prescribed_at: '2022-05-01', prescriber: 'Dr James Patel' },
    { patient_id: P.william, medication_name: 'Olanzapine 5mg', dose: '5mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2022-05-01', prescriber: 'Dr James Patel' },
    { patient_id: P.william, medication_name: 'Quetiapine 300mg', dose: '300mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2023-08-20', prescriber: 'Dr James Patel' },
    { patient_id: P.daniel, medication_name: 'Prazosin 3mg', dose: '3mg', frequency: 'Nocte', route: 'oral', status: 'ceased', prescribed_at: '2022-10-01', prescriber: 'Dr Michael O\'Brien' },
    { patient_id: P.daniel, medication_name: 'Sertraline 100mg', dose: '100mg', frequency: 'Mane', route: 'oral', status: 'ceased', prescribed_at: '2022-10-01', prescriber: 'Dr Michael O\'Brien' },
  ];

  let medInserted = 0;
  for (const m of histMeds) {
    try {
      // @code-columns-exempt: pre-R2 drift on patient_medications: is_clozapine, is_s8. Baseline 20260701000000 is the fix.
      await db('patient_medications').insert({ id: uuid(), clinic_id: C, ...m, generic_name: null, is_lai: false, is_clozapine: m.medication_name.toLowerCase().includes('clozapine'), is_s8: false, created_at: new Date(m.prescribed_at), updated_at: new Date(m.prescribed_at) });
      medInserted++;
    } catch {
      continue;
    }
  }
  console.log(`  ✓ ${medInserted} historical medications`);

  console.log('\n✅ 3-5 year clinical history seeded!');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
