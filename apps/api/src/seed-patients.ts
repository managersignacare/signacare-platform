import { db } from './db/db'

// Seed only reads `.id` off the returning row — explicit list avoids
// returning the full row (Phase R3 / CLAUDE.md §1.7).
const ID_ONLY = ['id'] as const;

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const clinicId = clinic.id

  // Get org units
  const units = await db('org_units').where({ clinic_id: clinicId })
  const unitMap = new Map(units.map((u) => [u.name, u.id]))

  // Get staff
  const staff = await db('staff').where({ clinic_id: clinicId }).select('id', 'email', 'given_name', 'family_name')
  const staffMap = new Map(staff.map((s) => [s.email, s.id]))
  const staffNameMap = new Map(staff.map((s) => [s.email, `${s.given_name} ${s.family_name}`]))

  const patients = [
    { given_name: 'Marcus', family_name: 'Johnson', dob: '1985-03-14', gender: 'male', medicare: '2345 67890 1', emr: 'UR000101', phone: '0412 345 678' },
    { given_name: 'Priya', family_name: 'Sharma', dob: '1992-07-22', gender: 'female', medicare: '3456 78901 2', emr: 'UR000102', phone: '0423 456 789' },
    { given_name: 'William', family_name: 'Chen', dob: '1978-11-05', gender: 'male', medicare: '4567 89012 3', emr: 'UR000103', phone: '0434 567 890' },
    { given_name: 'Jessica', family_name: 'Nguyen', dob: '2001-01-30', gender: 'female', medicare: '5678 90123 4', emr: 'UR000104', phone: '0445 678 901' },
    { given_name: 'Thomas', family_name: 'Wright', dob: '1965-09-18', gender: 'male', medicare: '6789 01234 5', emr: 'UR000105', phone: '0456 789 012' },
    { given_name: 'Aisha', family_name: 'Mohamed', dob: '1990-04-12', gender: 'female', medicare: '7890 12345 6', emr: 'UR000106', phone: '0467 890 123' },
    { given_name: "Daniel", family_name: "O'Connor", dob: '1973-06-25', gender: 'male', medicare: '8901 23456 7', emr: 'UR000107', phone: '0478 901 234' },
    { given_name: 'Sophie', family_name: 'Papadopoulos', dob: '1988-12-08', gender: 'female', medicare: '9012 34567 8', emr: 'UR000108', phone: '0489 012 345' },
    { given_name: 'Liam', family_name: 'Kelly', dob: '1955-02-19', gender: 'male', medicare: '0123 45678 9', emr: 'UR000109', phone: '0490 123 456' },
    { given_name: 'Mei', family_name: 'Zhang', dob: '1998-08-03', gender: 'female', medicare: '1234 56789 0', emr: 'UR000110', phone: '0401 234 567' },
  ]

  const patientIds: string[] = []
  for (const p of patients) {
    const existing = await db('patients').where({ emr_number: p.emr, clinic_id: clinicId }).first()
    if (existing) {
      patientIds.push(existing.id)
      console.log(`Patient ${p.given_name} ${p.family_name} already exists`)
      continue
    }
    const [row] = await db('patients').insert({
      id: db.raw('gen_random_uuid()'),
      clinic_id: clinicId,
      emr_number: p.emr,
      given_name: p.given_name,
      family_name: p.family_name,
      date_of_birth: p.dob,
      gender: p.gender,
      medicare_number: p.medicare,
      phone_mobile: p.phone,
      interpreter_required: false,
      consent_to_treatment: true,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning(ID_ONLY)
    patientIds.push(row.id)
    console.log(`Created patient: ${p.given_name} ${p.family_name} (${p.emr})`)
  }

  // patient_team_assignments is a first-class baseline table (R2b).
  // The pre-R2 `hasTable + createTable` DDL-in-script block (CLAUDE.md
  // §7.3 violation) has been removed.

  // Assign patients to teams with primary clinicians
  const assignments: { idx: number; unit: string; clinician: string }[] = [
    { idx: 0, unit: 'Inpatient Unit - Good Hospital', clinician: 'sarah.chen@goodhealth.demo' },
    { idx: 1, unit: 'Continuing Care Team 1 (CCT1)', clinician: 'james.patel@goodhealth.demo' },
    { idx: 2, unit: 'Continuing Care Team 1 (CCT1)', clinician: 'lisa.nguyen@goodhealth.demo' },
    { idx: 3, unit: 'Continuing Care Team 2 (CCT2)', clinician: 'emma.williams@goodhealth.demo' },
    { idx: 4, unit: 'Inpatient Unit - Good Hospital', clinician: 'michael.obrien@goodhealth.demo' },
    { idx: 5, unit: 'Continuing Care Team 2 (CCT2)', clinician: 'david.kumar@goodhealth.demo' },
    { idx: 6, unit: 'Continuing Care Team 3 (CCT3)', clinician: 'tom.singh@goodhealth.demo' },
    { idx: 7, unit: 'Acute Intervention Team 1 (AIT1)', clinician: 'amy.walker@goodhealth.demo' },
    { idx: 8, unit: 'Prevention and Recovery Care Unit (PARC)', clinician: 'daniel.brown@goodhealth.demo' },
    { idx: 9, unit: 'Community Care Unit (CCU)', clinician: 'kate.morrison@goodhealth.demo' },
    // Some patients in multiple teams
    { idx: 0, unit: 'Continuing Care Team 1 (CCT1)', clinician: 'ben.fitzgerald@goodhealth.demo' },
    { idx: 6, unit: 'Inpatient Unit - Good Hospital', clinician: 'rachel.thompson@goodhealth.demo' },
  ]

  for (const a of assignments) {
    const pid = patientIds[a.idx]
    const uid = unitMap.get(a.unit)
    const sid = staffMap.get(a.clinician)
    if (pid && uid) {
      const existing = await db('patient_team_assignments').where({ patient_id: pid, org_unit_id: uid }).first()
      if (!existing) {
        await db('patient_team_assignments').insert({
          id: db.raw('gen_random_uuid()'),
          patient_id: pid,
          org_unit_id: uid,
          primary_clinician_id: sid || null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        const name = patients[a.idx].given_name + ' ' + patients[a.idx].family_name
        const clinicianName = staffNameMap.get(a.clinician) ?? 'unknown'
        console.log(`  Assigned ${name} → ${a.unit} (clinician: ${clinicianName})`)
      }
    }
  }

  console.log('\nAll patient demo data seeded!')
  await db.destroy()
}

seed().catch((e) => { console.error('Seed error:', e); process.exit(1) })
