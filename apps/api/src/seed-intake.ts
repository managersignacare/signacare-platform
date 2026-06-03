import { db } from './db/db'

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const clinicId = clinic.id

  // Referral Sources — Internal
  const internalSources = [
    'Internal Transfer',
    'Inpatient Unit',
    'Emergency Department',
    'Consultation-Liaison',
    'Other Internal Team',
  ]
  for (let i = 0; i < internalSources.length; i++) {
    await db('referral_sources')
      .insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, category: 'internal', name: internalSources[i], is_active: true, sort_order: i, created_at: new Date(), updated_at: new Date() })
  }
  console.log('Internal referral sources:', internalSources.length)

  // Referral Sources — External
  const externalSources = [
    'Self', 'Carer / Family Member', 'Next of Kin',
    'General Practitioner', 'Private Psychiatrist', 'Private Psychologist',
    'Community Health Centre', 'headspace', 'Drug & Alcohol Service',
    'Police / Victoria Police', 'Ambulance Victoria', 'Child Protection',
    'Corrections / Justice Health', 'Housing / Homelessness Service',
    'Disability Service', 'Aged Care Service', 'NDIS Provider',
    'Commonwealth Rehabilitation', 'Other External',
  ]
  for (let i = 0; i < externalSources.length; i++) {
    await db('referral_sources')
      .insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, category: 'external', name: externalSources[i], is_active: true, sort_order: i, created_at: new Date(), updated_at: new Date() })
  }
  console.log('External referral sources:', externalSources.length)

  // Get some patient IDs and staff for demo referrals
  const patients = await db('patients').where({ clinic_id: clinicId }).select('id', 'given_name', 'family_name').limit(5)
  const staff = await db('staff').where({ clinic_id: clinicId }).select('id').limit(3)

  // Demo referrals
  const referrals = [
    { patientIdx: 0, source: 'General Practitioner', urgency: 'routine', status: 'received', reason: 'Persistent depressive symptoms, not responding to SSRI. Requesting psychiatric review and consideration of medication change.', fromService: 'General Practitioner', referrerName: 'Dr Jane Smith' },
    { patientIdx: 1, source: 'Self', urgency: 'urgent', status: 'under_review', reason: 'Self-referral. Experiencing worsening anxiety, panic attacks, and difficulty leaving home. Previously seen by private psychologist.', fromService: 'Self', referrerName: '' },
    { patientIdx: 2, source: 'Emergency Department', urgency: 'emergency', status: 'received', reason: 'Presented to ED with acute psychotic episode. First presentation. Stabilised and discharged. Requires urgent community follow-up.', fromService: 'Emergency Department', referrerName: 'Dr Ahmed Hassan' },
    { patientIdx: 3, source: 'Private Psychiatrist', urgency: 'soon', status: 'accepted', reason: 'Transfer of care. Patient relocating to area. Diagnosis: Bipolar I disorder, stable on lithium. Requires ongoing monitoring.', fromService: 'Private Psychiatrist', referrerName: 'Dr Robert Park' },
    { patientIdx: null, source: 'General Practitioner', urgency: 'routine', status: 'received', reason: 'New patient. 45yo male. Chronic PTSD symptoms following workplace incident. Requesting assessment for PTSD and treatment planning.', fromService: 'General Practitioner', referrerName: 'Dr Maria Costa' },
    { patientIdx: null, source: 'Police / Victoria Police', urgency: 'urgent', status: 'received', reason: 'Police referral under s351 MHA. Found in distressed state. History of schizophrenia per LEAP check. No current treating team identified.', fromService: 'Police / Victoria Police', referrerName: 'Sgt J Williams' },
  ]

  let refNum = 1000
  for (const r of referrals) {
    refNum++
    const patientId = r.patientIdx !== null && patients[r.patientIdx] ? patients[r.patientIdx].id : null
    // @code-columns-exempt: pre-R2 drift on referrals: referrer_name, referrer_organisation, presenting_problem, source_type, assigned_to_id. Baseline 20260701000000 is the fix.
    await db('referrals').insert({
      id: db.raw('gen_random_uuid()'),
      clinic_id: clinicId,
      patient_id: patientId,
      referral_number: `REF-${refNum}`,
      referrer_name: r.referrerName,
      referrer_organisation: r.fromService,
      referral_date: new Date().toISOString().split('T')[0],
      urgency: r.urgency,
      status: r.status,
      presenting_problem: r.reason,
      source_type: r.source,
      assigned_to_id: staff.length ? staff[0].id : null,
      created_at: new Date(),
      updated_at: new Date(),
    })
  }
  console.log('Demo referrals seeded:', referrals.length)

  console.log('\nIntake demo data seeded!')
  await db.destroy()
}

seed().catch((e) => { console.error('Seed error:', e); process.exit(1) })
