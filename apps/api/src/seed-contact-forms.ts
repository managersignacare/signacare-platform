import { db } from './db/db'

// Seed only reads `.id` off each returning row — explicit list avoids
// returning the full row (Phase R3 / CLAUDE.md §1.7).
const ID_ONLY = ['id'] as const;

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const cid = clinic.id

  // Get or create Contact Forms category
  let catId: string
  const existingCat = await db('template_categories').where({ clinic_id: cid, name: 'Contact Forms' }).first()
  if (existingCat) { catId = existingCat.id }
  else {
    const [cat] = await db('template_categories').insert({ id: db.raw('gen_random_uuid()'), clinic_id: cid, name: 'Contact Forms', is_active: true, sort_order: 10, created_at: new Date() }).returning(ID_ONLY)
    catId = cat.id
  }

  const templates = [
    // ─── Generic community contact ───────────────────────────────────────────
    {
      name: 'Community Mental Health Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'COMMUNITY MENTAL HEALTH CONTACT FORM' },
        { type: 'instruction', text: 'Complete for every patient contact (mandatory for ABF reporting)' },
        { type: 'multiple_choice', label: 'Service Contact Type', options: ['Face to face — Individual', 'Face to face — Group', 'Telephone', 'Video conference', 'Home visit', 'Outreach', 'Case conference (without patient)', 'Non-face-to-face — Clinical documentation'] },
        { type: 'multiple_choice', label: 'Service Setting', options: ['Community mental health centre', 'Patient home', 'Outpatient clinic', 'Emergency department', 'Inpatient unit', 'Residential facility', 'School/Education', 'Correctional facility', 'Other community setting'] },
        { type: 'multiple_choice', label: 'Contact Duration', options: ['< 15 minutes', '15–30 minutes', '30–45 minutes', '45–60 minutes', '60–90 minutes', '> 90 minutes'] },
        { type: 'multiple_choice', label: 'Principal Practitioner', options: ['Psychiatrist', 'Psychiatry Registrar', 'Psychologist', 'Clinical Psychologist', 'Mental Health Nurse', 'Social Worker', 'Occupational Therapist', 'Other Allied Health', 'Peer Support Worker'] },
        { type: 'yes_no', label: 'Interpreter Used' },
        { type: 'multiple_choice', label: 'Contact Participants (select all)', options: ['Patient', 'Carer/Family', 'Other service provider', 'Police', 'Ambulance', 'Other'] },
        { type: 'multiple_choice', label: 'Mental Health Legal Status', options: ['Voluntary', 'Involuntary — Assessment Order', 'Involuntary — Temporary Treatment Order', 'Involuntary — Treatment Order', 'Involuntary — Community Treatment Order', 'Forensic — CSO', 'Forensic — NCSO', 'Not applicable'] },
        { type: 'multiple_choice', label: 'Principal Diagnosis (ICD-10 Chapter)', options: ['F00-F09 Organic', 'F10-F19 Substance use', 'F20-F29 Schizophrenia spectrum', 'F30-F39 Mood disorders', 'F40-F48 Anxiety/stress', 'F50-F59 Behavioural syndromes', 'F60-F69 Personality disorders', 'F70-F79 Intellectual disability', 'F80-F89 Developmental', 'F90-F98 Childhood onset', 'F99 Unspecified', 'Other/Medical'] },
        { type: 'multiple_choice', label: 'Intervention Type (select all)', options: ['Assessment', 'Medication management', 'Psychoeducation', 'Supportive therapy', 'CBT', 'DBT', 'Family intervention', 'Crisis intervention', 'Risk assessment', 'Care coordination', 'Discharge planning', 'Physical health assessment', 'Metabolic monitoring', 'LAI administration', 'Clozapine monitoring', 'Other'] },
        { type: 'multiple_choice', label: 'Outcome Measures Completed', options: ['HoNOS', 'LSP-16', 'K10', 'PHQ-9', 'GAD-7', 'None this contact'] },
        { type: 'yes_no', label: 'Did Not Attend (DNA)' },
        { type: 'short_answer', label: 'Brief Contact Summary' },
      ],
    },

    // ─── Inpatient ───────────────────────────────────────────────────────────
    {
      name: 'Inpatient Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'INPATIENT CONTACT FORM' },
        { type: 'multiple_choice', label: 'Ward Round Type', options: ['Consultant ward round', 'Registrar review', 'Nursing review', 'Allied health review', 'MDT review', 'Discharge planning meeting'] },
        { type: 'multiple_choice', label: 'Contact Duration', options: ['< 15 minutes', '15–30 minutes', '30–45 minutes', '45–60 minutes', '> 60 minutes'] },
        { type: 'multiple_choice', label: 'Principal Practitioner', options: ['Consultant Psychiatrist', 'Psychiatry Registrar', 'Mental Health Nurse', 'Psychologist', 'Social Worker', 'Occupational Therapist', 'Other'] },
        { type: 'multiple_choice', label: 'Intervention', options: ['Medication review', 'Risk assessment', 'MSE', 'Ward round review', 'Family meeting', 'Discharge planning', 'Leave assessment', 'Physical health review', 'Seclusion review', 'Restraint review', 'ECT', 'Other'] },
        { type: 'multiple_choice', label: 'Legal Status', options: ['Voluntary', 'Assessment Order', 'Temporary Treatment Order', 'Treatment Order', 'Forensic'] },
        { type: 'yes_no', label: 'Restrictive Intervention Used' },
        { type: 'short_answer', label: 'Contact Notes' },
      ],
    },

    // ─── ACIS / Crisis ───────────────────────────────────────────────────────
    {
      name: 'ACIS/Crisis Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'CRISIS/ACIS CONTACT FORM' },
        { type: 'multiple_choice', label: 'Referral Source', options: ['Self', 'Carer/Family', 'GP', 'Emergency Department', 'Police', 'Ambulance', 'Other MH service', 'Inpatient unit', 'Other'] },
        { type: 'multiple_choice', label: 'Contact Type', options: ['Phone triage', 'Face to face assessment', 'Home visit', 'Emergency Department assessment', 'Police attendance', 'Transport/escort'] },
        { type: 'multiple_choice', label: 'Urgency', options: ['Emergency (within 1 hour)', 'Urgent (within 4 hours)', 'Semi-urgent (within 24 hours)', 'Routine'] },
        { type: 'multiple_choice', label: 'Intervention', options: ['Crisis assessment', 'Safety planning', 'De-escalation', 'Medication administration', 'Involuntary assessment', 'Referral to inpatient', 'Referral to community team', 'Brief intervention', 'Carer support', 'Police welfare check'] },
        { type: 'multiple_choice', label: 'Outcome', options: ['Resolved — no further action', 'Referred to community team', 'Admitted to inpatient', 'Referred to ED', 'Ongoing ACIS follow-up', 'Referred to PARC', 'Voluntary admission'] },
        { type: 'multiple_choice', label: 'Risk Level at Contact End', options: ['Low', 'Moderate', 'High', 'Extreme'] },
        { type: 'short_answer', label: 'Contact Summary' },
      ],
    },

    // ─── Group therapy ───────────────────────────────────────────────────────
    {
      name: 'Group Session Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'GROUP SESSION CONTACT FORM' },
        { type: 'short_answer', label: 'Group Name/Program' },
        { type: 'multiple_choice', label: 'Group Type', options: ['Psychoeducation', 'CBT group', 'DBT skills', 'Social skills', 'Creative therapy', 'Exercise/movement', 'Peer support', 'Carer support group', 'Other'] },
        { type: 'short_answer', label: 'Number of Participants' },
        { type: 'multiple_choice', label: 'Duration', options: ['30 minutes', '45 minutes', '60 minutes', '90 minutes', '120 minutes'] },
        { type: 'multiple_choice', label: 'Facilitator Discipline', options: ['Psychologist', 'OT', 'Social Worker', 'Nurse', 'Peer Worker', 'Other'] },
        { type: 'yes_no', label: 'Patient Actively Participated' },
        { type: 'short_answer', label: 'Session Summary' },
      ],
    },

    // ─── LAI Administration ──────────────────────────────────────────────────
    {
      name: 'LAI Administration Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'LONG-ACTING INJECTABLE (LAI) ADMINISTRATION CONTACT' },
        { type: 'instruction', text: 'Reportable ABF contact — complete all mandatory fields. Patient must be present.' },
        { type: 'multiple_choice', label: 'Setting', options: ['Community mental health centre', 'Patient home', 'GP clinic', 'Outpatient clinic', 'Inpatient ward', 'Residential facility', 'Other'] },
        { type: 'multiple_choice', label: 'Contact Duration', options: ['< 15 minutes', '15–30 minutes', '30–45 minutes', '> 45 minutes'] },
        { type: 'multiple_choice', label: 'Administering Clinician', options: ['Mental Health Nurse', 'Registered Nurse', 'Psychiatrist', 'Psychiatry Registrar', 'GP', 'Other'] },
        { type: 'short_answer', label: 'Medication Name' },
        { type: 'short_answer', label: 'Dose (mg)' },
        { type: 'multiple_choice', label: 'Injection Site', options: ['Deltoid — Left', 'Deltoid — Right', 'Gluteal — Left', 'Gluteal — Right', 'Vastus lateralis — Left', 'Vastus lateralis — Right'] },
        { type: 'short_answer', label: 'Batch/Lot Number' },
        { type: 'short_answer', label: 'Expiry Date' },
        { type: 'short_answer', label: 'Next Injection Due Date' },
        { type: 'yes_no', label: 'Consent Confirmed (written/verbal)' },
        { type: 'multiple_choice', label: 'Pre-Injection Assessment', options: ['No concerns', 'EPSE symptoms noted', 'Injection site reaction — previous site', 'Patient reluctant — counselled', 'Vital signs abnormal — reviewed', 'Contraindication reviewed'] },
        { type: 'yes_no', label: 'Adverse Reaction Observed Post-Injection' },
        { type: 'short_answer', label: 'Post-Injection Observations (including 3-minute observation if applicable)' },
        { type: 'multiple_choice', label: 'Legal Status', options: ['Voluntary', 'Community Treatment Order', 'Treatment Order', 'Other involuntary', 'Forensic — CSO/NCSO'] },
        { type: 'multiple_choice', label: 'Mental State at Contact', options: ['Settled/Stable', 'Mildly distressed', 'Moderately unwell', 'Acutely unwell'] },
        { type: 'short_answer', label: 'Contact Notes' },
      ],
    },

    // ─── Clozapine Monitoring ────────────────────────────────────────────────
    {
      name: 'Clozapine Monitoring Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'CLOZAPINE MONITORING CONTACT' },
        { type: 'instruction', text: 'Reportable ABF contact — mandatory REMS monitoring data required. Patient present.' },
        { type: 'multiple_choice', label: 'Setting', options: ['Community mental health centre', 'Outpatient clinic', 'Patient home', 'GP clinic', 'Inpatient ward', 'Pathology service', 'Other'] },
        { type: 'multiple_choice', label: 'Contact Duration', options: ['< 15 minutes', '15–30 minutes', '30–45 minutes', '> 45 minutes'] },
        { type: 'multiple_choice', label: 'Monitoring Clinician', options: ['Mental Health Nurse', 'Psychiatrist', 'Psychiatry Registrar', 'GP', 'Other'] },
        { type: 'short_answer', label: 'Clozapine Dose (mg/day)' },
        { type: 'short_answer', label: 'WBC Count (×10⁹/L)' },
        { type: 'short_answer', label: 'ANC — Absolute Neutrophil Count (×10⁹/L)' },
        { type: 'multiple_choice', label: 'Monitoring Outcome (REMS Category)', options: ['Green — Continue (WBC ≥ 3.5, ANC ≥ 2.0)', 'Amber — Increased monitoring required', 'Red — Clozapine suspended (WBC < 3.0 or ANC < 1.5)', 'Inconclusive — repeat test required'] },
        { type: 'multiple_choice', label: 'Monitoring Frequency', options: ['Weekly (initiation or amber)', 'Fortnightly (3–12 months)', 'Monthly (> 12 months, stable green)'] },
        { type: 'short_answer', label: 'Next Blood Test Due Date' },
        { type: 'yes_no', label: 'Blood drawn at this contact' },
        { type: 'yes_no', label: 'Side effects discussed (hypersalivation, constipation, metabolic, myocarditis risk)' },
        { type: 'multiple_choice', label: 'Metabolic Monitoring (if applicable)', options: ['Weight/BMI recorded', 'BP recorded', 'Fasting glucose/lipids reviewed', 'ECG reviewed', 'Not required this contact'] },
        { type: 'multiple_choice', label: 'Mental State at Contact', options: ['Settled/Stable', 'Mildly distressed', 'Moderately unwell', 'Acutely unwell'] },
        { type: 'short_answer', label: 'Contact Notes' },
      ],
    },

    // ─── Collateral Contact ──────────────────────────────────────────────────
    {
      name: 'Collateral Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'COLLATERAL CONTACT (CARER/FAMILY/THIRD PARTY)' },
        { type: 'instruction', text: 'Non-face-to-face contact with carer/family or third party without patient present. Check reportability under local ABF rules.' },
        { type: 'short_answer', label: 'Contact Person Name' },
        { type: 'multiple_choice', label: 'Relationship to Patient', options: ['Parent', 'Spouse/Partner', 'Sibling', 'Adult child', 'Friend/Carer', 'Support worker', 'GP', 'Other treating clinician', 'School/education', 'Employer', 'Police', 'Housing/support service', 'Other'] },
        { type: 'multiple_choice', label: 'Mode of Contact', options: ['Phone call', 'Face to face (clinic)', 'Face to face (home/community)', 'Video call', 'Email', 'SMS', 'Letter', 'Other'] },
        { type: 'multiple_choice', label: 'Contact Duration', options: ['< 15 minutes', '15–30 minutes', '30–45 minutes', '> 45 minutes'] },
        { type: 'yes_no', label: 'Patient aware of this contact' },
        { type: 'yes_no', label: 'Patient consent obtained for information sharing' },
        { type: 'multiple_choice', label: 'Purpose of Contact', options: ['Carer update / welfare check', 'Safety concerns raised by carer', 'Care coordination', 'Medication information', 'Mental health education', 'Discharge planning', 'Family meeting preparation', 'Complaint / concern raised', 'Carer wellbeing check', 'Other'] },
        { type: 'multiple_choice', label: 'Information Shared', options: ['General wellbeing (non-specific)', 'Appointment reminders', 'Safety plan information', 'Carer support resources', 'No clinical information shared', 'Clinical information shared (with consent)'] },
        { type: 'multiple_choice', label: 'Outcome / Follow-up', options: ['No further action required', 'Referral to carer support services', 'Family meeting scheduled', 'Escalation to treating team', 'Documentation for clinical record', 'Crisis plan activated'] },
        { type: 'short_answer', label: 'Contact Summary' },
      ],
    },

    // ─── Home Visit ──────────────────────────────────────────────────────────
    {
      name: 'Home Visit Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'HOME VISIT CONTACT FORM' },
        { type: 'instruction', text: 'Reportable ABF contact — complete environmental and safety sections.' },
        { type: 'short_answer', label: 'Visit Address (suburb only for privacy)' },
        { type: 'multiple_choice', label: 'Visiting Clinician', options: ['Mental Health Nurse', 'Social Worker', 'Occupational Therapist', 'Peer Support Worker', 'Psychiatrist', 'Case Manager', 'Two clinicians (joint visit)', 'Other'] },
        { type: 'multiple_choice', label: 'Contact Duration (excluding travel)', options: ['< 15 minutes', '15–30 minutes', '30–45 minutes', '45–60 minutes', '60–90 minutes', '> 90 minutes'] },
        { type: 'multiple_choice', label: 'Travel Time (one way)', options: ['< 15 min', '15–30 min', '30–45 min', '> 45 min'] },
        { type: 'yes_no', label: 'Patient Home at Time of Visit' },
        { type: 'yes_no', label: 'Others Present (carer, family, support worker)' },
        { type: 'multiple_choice', label: 'Environmental Safety Assessment', options: ['Safe — no concerns', 'Cluttered/hoarding — moderate concern', 'Significant safety hazard identified', 'Inadequate food/utilities', 'Evidence of substance use', 'Other safety concern'] },
        { type: 'yes_no', label: 'Clinician Safety Concern at Visit' },
        { type: 'multiple_choice', label: 'Intervention Provided', options: ['Welfare check', 'Medication management/administration', 'Risk assessment', 'Care coordination', 'Practical support/ADL assistance', 'Mental state examination', 'Carer support', 'Safety planning', 'Referral to community service'] },
        { type: 'multiple_choice', label: 'Mental State at Contact', options: ['Settled/Stable', 'Mildly distressed', 'Moderately unwell', 'Acutely unwell', 'Not available/unable to assess'] },
        { type: 'multiple_choice', label: 'Legal Status', options: ['Voluntary', 'Community Treatment Order', 'Treatment Order', 'Assessment Order', 'Forensic', 'Not applicable'] },
        { type: 'short_answer', label: 'Contact Summary and Follow-up Plan' },
      ],
    },

    // ─── Phone / Telehealth ──────────────────────────────────────────────────
    {
      name: 'Phone/Telehealth Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'PHONE / TELEHEALTH CONTACT FORM' },
        { type: 'instruction', text: 'Reportable ABF contact — patient must be present and contact clinically meaningful (≥ 5 minutes for phone, ≥ 15 minutes recommended for telehealth).' },
        { type: 'multiple_choice', label: 'Contact Modality', options: ['Telephone (audio only)', 'Video — Coviu', 'Video — Microsoft Teams', 'Video — Zoom', 'Video — other platform'] },
        { type: 'multiple_choice', label: 'Contact Duration', options: ['5–14 minutes', '15–30 minutes', '30–45 minutes', '45–60 minutes', '> 60 minutes'] },
        { type: 'multiple_choice', label: 'Clinician', options: ['Psychiatrist', 'Psychiatry Registrar', 'Psychologist', 'Mental Health Nurse', 'Social Worker', 'OT', 'Case Manager', 'Peer Worker', 'Other'] },
        { type: 'yes_no', label: 'Patient Initiated Call' },
        { type: 'yes_no', label: 'Technical Issues Experienced' },
        { type: 'yes_no', label: 'Interpreter Used' },
        { type: 'multiple_choice', label: 'Purpose of Contact', options: ['Scheduled review', 'Medication management', 'Risk check-in', 'Crisis support', 'Care coordination', 'Psychoeducation', 'Results/pathology discussion', 'Appointment booking', 'Other'] },
        { type: 'multiple_choice', label: 'Mental State at Contact', options: ['Settled/Stable', 'Mildly distressed', 'Moderately unwell', 'Acutely unwell', 'Unable to assess remotely'] },
        { type: 'multiple_choice', label: 'Legal Status', options: ['Voluntary', 'Community Treatment Order', 'Treatment Order', 'Forensic', 'Not applicable'] },
        { type: 'multiple_choice', label: 'Outcome', options: ['No immediate concerns', 'In-person review arranged', 'Medication changed', 'Referral made', 'Crisis plan activated', 'Emergency services contacted'] },
        { type: 'short_answer', label: 'Contact Summary' },
      ],
    },

    // ─── Case Conference / MDT ───────────────────────────────────────────────
    {
      name: 'Case Conference/MDT Contact (ABF)',
      type: 'note',
      content: [
        { type: 'heading', text: 'CASE CONFERENCE / MDT MEETING CONTACT FORM' },
        { type: 'multiple_choice', label: 'Meeting Type', options: ['Internal MDT', 'External case conference', 'Care team meeting', 'Discharge planning meeting', 'Interagency meeting', 'NDIS planning meeting', 'Housing/support services meeting', 'Other'] },
        { type: 'multiple_choice', label: 'Patient Present', options: ['Yes — attended in person', 'Yes — attended by phone/video', 'No — discussed with consent', 'No — emergency discussion (safety)'] },
        { type: 'multiple_choice', label: 'Duration', options: ['< 30 minutes', '30–60 minutes', '60–90 minutes', '> 90 minutes'] },
        { type: 'short_answer', label: 'Attendees and Disciplines' },
        { type: 'multiple_choice', label: 'Purpose', options: ['Review of care plan', 'Risk review', 'Discharge planning', 'NDIS/support coordination', 'Medication review', 'Crisis planning', 'Housing review', 'Interagency coordination', 'Other'] },
        { type: 'short_answer', label: 'Key Decisions Made' },
        { type: 'short_answer', label: 'Follow-up Actions (with responsible person and timeframe)' },
        { type: 'short_answer', label: 'Next Meeting Date/Frequency' },
      ],
    },
  ]

  let added = 0
  for (const t of templates) {
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
  console.log('Contact form templates seeded:', added)
  await db.destroy()
}

seed().catch(e => { console.error('Error:', e); process.exit(1) })
