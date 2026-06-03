import { db } from './db/db'

// Seed only reads `.id` off each returning row — explicit list avoids
// returning the full row (Phase R3 / CLAUDE.md §1.7).
const ID_ONLY = ['id'] as const;

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const cid = clinic.id

  // Categories
  const cats = ['Clinical Notes', 'Rating Scales', 'Assessments', 'Letters', 'Reports', 'Messages', 'Certificates']
  const catMap = new Map<string, string>()
  for (let i = 0; i < cats.length; i++) {
    const existing = await db('template_categories').where({ clinic_id: cid, name: cats[i] }).first()
    if (existing) { catMap.set(cats[i], existing.id); continue }
    const [row] = await db('template_categories').insert({ id: db.raw('gen_random_uuid()'), clinic_id: cid, name: cats[i], is_active: true, sort_order: i, created_at: new Date() }).returning(ID_ONLY)
    catMap.set(cats[i], row.id)
  }
  console.log('Categories seeded:', cats.length)

  const templates = [
    // Rating Scales
    { name: 'PHQ-9 (Patient Health Questionnaire)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'PHQ-9 Depression Severity' },
      { type: 'instruction', text: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?' },
      ...[
        'Little interest or pleasure in doing things',
        'Feeling down, depressed, or hopeless',
        'Trouble falling or staying asleep, or sleeping too much',
        'Feeling tired or having little energy',
        'Poor appetite or overeating',
        'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
        'Trouble concentrating on things, such as reading the newspaper or watching television',
        'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless',
        'Thoughts that you would be better off dead, or of hurting yourself in some way',
      ].map((q) => ({ type: 'likert', label: q, min: 0, max: 3, options: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'] })),
      { type: 'score', label: 'Total Score', formula: 'sum', ranges: [{ min: 0, max: 4, label: 'Minimal' }, { min: 5, max: 9, label: 'Mild' }, { min: 10, max: 14, label: 'Moderate' }, { min: 15, max: 19, label: 'Moderately Severe' }, { min: 20, max: 27, label: 'Severe' }] },
    ]},
    { name: 'GAD-7 (Generalised Anxiety Disorder)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'GAD-7 Anxiety Severity' },
      { type: 'instruction', text: 'Over the last 2 weeks, how often have you been bothered by the following problems?' },
      ...['Feeling nervous, anxious or on edge', 'Not being able to stop or control worrying', 'Worrying too much about different things', 'Trouble relaxing', 'Being so restless that it is hard to sit still', 'Becoming easily annoyed or irritable', 'Feeling afraid as if something awful might happen']
        .map(q => ({ type: 'likert', label: q, min: 0, max: 3, options: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'] })),
      { type: 'score', label: 'Total Score', formula: 'sum', ranges: [{ min: 0, max: 4, label: 'Minimal' }, { min: 5, max: 9, label: 'Mild' }, { min: 10, max: 14, label: 'Moderate' }, { min: 15, max: 21, label: 'Severe' }] },
    ]},
    { name: 'K10 (Kessler Psychological Distress Scale)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'K10 Psychological Distress' },
      ...['Tired out for no good reason', 'Nervous', 'So nervous nothing could calm you down', 'Hopeless', 'Restless or fidgety', 'So restless you could not sit still', 'Depressed', 'Everything was an effort', 'So sad nothing could cheer you up', 'Worthless']
        .map(q => ({ type: 'likert', label: `How often did you feel ${q.toLowerCase()}?`, min: 1, max: 5, options: ['None of the time', 'A little', 'Some of the time', 'Most of the time', 'All of the time'] })),
    ]},
    { name: 'HoNOS (Health of the Nation Outcome Scales)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'HoNOS' },
      ...['Overactive, aggressive, disruptive behaviour', 'Non-accidental self-injury', 'Problem drinking or drug-taking', 'Cognitive problems', 'Physical illness or disability', 'Hallucinations and delusions', 'Depressed mood', 'Other mental and behavioural problems', 'Relationships', 'Activities of daily living', 'Living conditions', 'Occupation and activities']
        .map(q => ({ type: 'likert', label: q, min: 0, max: 4, options: ['No problem', 'Minor problem', 'Mild problem', 'Moderately severe', 'Severe to very severe'] })),
    ]},
    { name: 'LSP-16 (Life Skills Profile)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'LSP-16 Life Skills' },
      { type: 'instruction', text: 'Rate each item based on the last 3 months.' },
    ]},
    { name: 'BPRS (Brief Psychiatric Rating Scale)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'BPRS-24' },
    ]},

    // Assessments
    { name: 'Mental State Examination (MSE)', type: 'assessment', category: 'Assessments', content: [
      { type: 'heading', text: 'Mental State Examination' },
      { type: 'multiple_choice', label: 'Appearance', options: ['Well-groomed', 'Dishevelled', 'Bizarre', 'Inappropriate for weather'] },
      { type: 'multiple_choice', label: 'Behaviour', options: ['Cooperative', 'Guarded', 'Agitated', 'Withdrawn', 'Hostile'] },
      { type: 'multiple_choice', label: 'Speech', options: ['Normal rate/volume', 'Pressured', 'Slow', 'Monotonous', 'Loud'] },
      { type: 'short_answer', label: 'Mood (subjective)' },
      { type: 'multiple_choice', label: 'Affect', options: ['Euthymic', 'Depressed', 'Anxious', 'Irritable', 'Elevated', 'Flat', 'Blunted', 'Labile', 'Incongruent'] },
      { type: 'multiple_choice', label: 'Thought Form', options: ['Linear and goal-directed', 'Circumstantial', 'Tangential', 'Flight of ideas', 'Loosening of associations', 'Thought block'] },
      { type: 'multiple_choice', label: 'Thought Content', options: ['No abnormality', 'Suicidal ideation', 'Homicidal ideation', 'Delusions', 'Overvalued ideas', 'Obsessions', 'Ruminations'] },
      { type: 'multiple_choice', label: 'Perception', options: ['No abnormality', 'Auditory hallucinations', 'Visual hallucinations', 'Command hallucinations', 'Illusions'] },
      { type: 'multiple_choice', label: 'Cognition', options: ['Intact', 'Impaired orientation', 'Impaired attention', 'Impaired memory', 'Not formally tested'] },
      { type: 'multiple_choice', label: 'Insight', options: ['Full', 'Partial', 'Nil'] },
      { type: 'multiple_choice', label: 'Judgement', options: ['Intact', 'Impaired'] },
    ]},
    { name: 'Risk Assessment', type: 'assessment', category: 'Assessments', content: [
      { type: 'heading', text: 'Risk Assessment' },
      { type: 'yes_no', label: 'Current suicidal ideation' }, { type: 'short_answer', label: 'Suicidal ideation details' },
      { type: 'yes_no', label: 'Current self-harm urges' }, { type: 'yes_no', label: 'Homicidal ideation' },
      { type: 'yes_no', label: 'Command hallucinations' }, { type: 'yes_no', label: 'Access to means' },
      { type: 'multiple_choice', label: 'Overall risk level', options: ['Low', 'Moderate', 'High', 'Extreme'] },
      { type: 'short_answer', label: 'Risk management plan' },
    ]},
    { name: 'AIMS (Abnormal Involuntary Movement Scale)', type: 'assessment', category: 'Rating Scales', content: [
      { type: 'heading', text: 'AIMS Assessment' },
      ...['Muscles of facial expression', 'Lips and perioral area', 'Jaw', 'Tongue', 'Upper extremities', 'Lower extremities', 'Trunk']
        .map(q => ({ type: 'likert', label: q, min: 0, max: 4, options: ['None', 'Minimal', 'Mild', 'Moderate', 'Severe'] })),
    ]},

    // Clinical Notes
    { name: 'Progress Note (SOAP)', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'Progress Note' },
      { type: 'short_answer', label: 'Subjective' }, { type: 'short_answer', label: 'Objective' },
      { type: 'short_answer', label: 'Assessment' }, { type: 'short_answer', label: 'Plan' },
    ]},
    { name: 'Ward Round Note', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'Ward Round Note' },
      { type: 'short_answer', label: 'Overnight events' }, { type: 'short_answer', label: 'Current presentation' },
      { type: 'short_answer', label: 'MSE summary' }, { type: 'short_answer', label: 'Medication changes' },
      { type: 'short_answer', label: 'Plan' }, { type: 'short_answer', label: 'Estimated discharge' },
    ]},
    { name: 'Intake Assessment Note', type: 'note', category: 'Clinical Notes', content: [
      { type: 'heading', text: 'Intake Assessment' },
      { type: 'short_answer', label: 'Presenting problem' }, { type: 'short_answer', label: 'History of presenting complaint' },
      { type: 'short_answer', label: 'Past psychiatric history' }, { type: 'short_answer', label: 'Substance use' },
      { type: 'short_answer', label: 'Risk assessment summary' }, { type: 'short_answer', label: 'Formulation' },
      { type: 'short_answer', label: 'Plan' },
    ]},

    // Letters
    { name: 'GP Letter', type: 'letter', category: 'Letters', content: [{ type: 'text_block', text: 'Dear Dr [GP Name],\n\nRe: [Patient Name], DOB [DOB]\n\nI am writing to update you regarding...' }] },
    { name: 'Discharge Summary', type: 'report', category: 'Reports', content: [{ type: 'text_block', text: 'DISCHARGE SUMMARY\n\nPatient: [Name]\nAdmission Date: [Date]\nDischarge Date: [Date]\n\nDIAGNOSIS:\n\nSUMMARY OF ADMISSION:\n\nDISCHARGE MEDICATIONS:\n\nFOLLOW-UP PLAN:' }] },

    // Certificates
    { name: 'Medical Certificate (Sick Leave)', type: 'certificate', category: 'Certificates', content: [{ type: 'text_block', text: 'MEDICAL CERTIFICATE\n\nThis is to certify that [Patient Name] was/is unfit for work/study from [Start Date] to [End Date].\n\nDiagnosis: [As appropriate — may state "medical condition" for privacy]\n\nRecommendations:\n\nClinician: [Name]\nProvider Number: [Number]\nDate: [Date]' }] },
    { name: 'Centrelink Medical Certificate (SU415)', type: 'certificate', category: 'Certificates', content: [{ type: 'text_block', text: 'CENTRELINK MEDICAL CERTIFICATE (SU415)\n\nPatient Details:\nCondition affecting capacity to work:\nExpected duration:\nWork capacity:\n\nDoctor Details:\nSignature:\nDate:' }] },
    { name: 'Carer Certificate', type: 'certificate', category: 'Certificates', content: [{ type: 'text_block', text: 'CARER ATTENDANCE CERTIFICATE\n\nThis is to certify that [Carer Name] attended [Service] with/for [Patient Name] on [Date].\n\nDuration: [Time]\nReason: [Carer support / Family meeting / etc.]\n\nClinician: [Name]\nDate: [Date]' }] },

    // Messages
    { name: 'Appointment Reminder', type: 'message', category: 'Messages', content: [{ type: 'text_block', text: 'Dear [Patient Name],\n\nThis is a reminder of your appointment on [Date] at [Time] with [Clinician] at [Location].\n\nIf you are unable to attend, please contact us on [Phone].\n\nKind regards,\n[Service Name]' }] },
    { name: 'Missed Appointment Follow-up', type: 'message', category: 'Messages', content: [{ type: 'text_block', text: 'Dear [Patient Name],\n\nWe noticed you were unable to attend your appointment on [Date]. We would like to reschedule.\n\nPlease contact us on [Phone] at your earliest convenience.\n\nKind regards,\n[Service Name]' }] },
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
  console.log('Templates seeded:', added)
  await db.destroy()
}

seed().catch(e => { console.error('Error:', e); process.exit(1) })
