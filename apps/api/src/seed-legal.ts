import { db } from './db/db'

const ORDER_TYPES = [
  // Mental Health Act 2014 (Vic)
  { name: 'Assessment Order (s29)', category: 'mha' },
  { name: 'Court Assessment Order (s30)', category: 'mha' },
  { name: 'Temporary Treatment Order (s45)', category: 'mha' },
  { name: 'Treatment Order (s55)', category: 'mha' },
  { name: 'Variation of Treatment Order (s56)', category: 'mha' },
  { name: 'Revocation of Treatment Order (s57)', category: 'mha' },
  { name: 'Community Treatment Order (s47)', category: 'mha' },
  { name: 'Inpatient Treatment Order (s47)', category: 'mha' },
  { name: 'Electro-convulsive Treatment (ECT) Consent (s92)', category: 'mha' },
  { name: 'ECT Non-consent/Emergency (s93-94)', category: 'mha' },
  { name: 'Neurosurgery for Mental Illness (s96)', category: 'mha' },
  { name: 'Restrictive Intervention Authorisation (s110)', category: 'mha' },
  { name: 'Seclusion Authorisation (s111)', category: 'mha' },
  { name: 'Bodily Restraint Authorisation (s113)', category: 'mha' },
  { name: 'Security Conditions (s64)', category: 'mha' },
  { name: 'Transfer Order — Interstate (s77)', category: 'mha' },
  { name: 'Leave of Absence (s61)', category: 'mha' },

  // Forensic
  { name: 'Custodial Supervision Order (CSO)', category: 'forensic' },
  { name: 'Non-Custodial Supervision Order (NCSO)', category: 'forensic' },
  { name: 'Court Conditional Order (CCO)', category: 'forensic' },
  { name: 'Fitness to Stand Trial Assessment', category: 'forensic' },
  { name: 'Forensic Patient Transfer (s74)', category: 'forensic' },
  { name: 'Governor\'s Pleasure Order', category: 'forensic' },
  { name: 'Extended Supervision Order', category: 'forensic' },

  // Guardianship & Administration
  { name: 'Guardianship Order (VCAT)', category: 'guardianship' },
  { name: 'Administration Order (VCAT)', category: 'guardianship' },
  { name: 'Temporary Guardianship Order', category: 'guardianship' },
  { name: 'Enduring Power of Attorney (Medical)', category: 'guardianship' },
  { name: 'Enduring Power of Attorney (Financial)', category: 'guardianship' },
  { name: 'Enduring Guardian Appointment', category: 'guardianship' },
  { name: 'Supportive Guardian/Administrator', category: 'guardianship' },

  // Other
  { name: 'Intervention Order (Family Violence)', category: 'other' },
  { name: 'Personal Safety Intervention Order', category: 'other' },
  { name: 'Compulsory Treatment Order — AOD (Severe Substance Dependence)', category: 'other' },
  { name: 'Disability Worker Exclusion Order', category: 'other' },
  { name: 'NDIS Restrictive Practices Authorisation', category: 'other' },
]

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const clinicId = clinic.id

  for (let i = 0; i < ORDER_TYPES.length; i++) {
    const o = ORDER_TYPES[i]
    const existing = await db('legal_order_type_configs').where({ clinic_id: clinicId, name: o.name }).first()
    if (!existing) {
      await db('legal_order_type_configs').insert({
        id: db.raw('gen_random_uuid()'), clinic_id: clinicId,
        name: o.name, category: o.category, is_active: true, sort_order: i,
        created_at: new Date(), updated_at: new Date(),
      })
    }
  }
  console.log('Legal order types seeded:', ORDER_TYPES.length)
  await db.destroy()
}

seed().catch(e => { console.error('Error:', e); process.exit(1) })
