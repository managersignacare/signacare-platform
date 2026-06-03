import { db } from './db/db'
import bcrypt from 'bcryptjs'

// Minimal column lists — seed only needs `id` from the returning rows for
// FK wiring. Explicit list avoids returning the full row (Phase R3 /
// CLAUDE.md §1.7) and prevents future ghost-column drift.
const ID_ONLY = ['id'] as const;

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const clinicId = clinic.id
  console.log('Clinic ID:', clinicId)

  // Level Labels
  const labels = [
    { level: 1, label: 'Organisation' },
    { level: 2, label: 'Division' },
    { level: 3, label: 'Unit / Team' },
  ]
  for (const l of labels) {
    await db('org_level_labels')
      .insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, level: l.level, label: l.label, created_at: new Date(), updated_at: new Date() })
      .onConflict(['clinic_id', 'level']).merge({ label: l.label, updated_at: new Date() })
  }
  console.log('Level labels done')

  // Org tree
  const [org] = await db('org_units').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, parent_id: null, name: 'Good Health Service', level: 1, sort_order: 0, is_active: true, created_at: new Date(), updated_at: new Date() }).returning(ID_ONLY)
  const [div] = await db('org_units').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, parent_id: org.id, name: 'Good Mental Health Division', level: 2, sort_order: 0, is_active: true, created_at: new Date(), updated_at: new Date() }).returning(ID_ONLY)

  const unitNames = [
    'Inpatient Unit - Good Hospital',
    'Continuing Care Team 1 (CCT1)',
    'Continuing Care Team 2 (CCT2)',
    'Continuing Care Team 3 (CCT3)',
    'Community Care Unit (CCU)',
    'Acute Intervention Team 1 (AIT1)',
    'Acute Intervention Team 2 (AIT2)',
    'Acute Intervention Team 3 (AIT3)',
    'Prevention and Recovery Care Unit (PARC)',
  ]
  const unitMap = new Map<string, string>()
  unitMap.set('Good Mental Health Division', div.id)
  for (let i = 0; i < unitNames.length; i++) {
    const [u] = await db('org_units').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, parent_id: div.id, name: unitNames[i], level: 3, sort_order: i, is_active: true, created_at: new Date(), updated_at: new Date() }).returning(ID_ONLY)
    unitMap.set(unitNames[i], u.id)
  }
  console.log('Org units done:', unitMap.size)

  // Disciplines
  const disciplines = [
    'Psychiatry', 'Psychology', 'Clinical Psychology', 'Nursing', 'Mental Health Nursing',
    'Social Work', 'Occupational Therapy', 'Pharmacy', 'Dietetics',
    'Exercise Physiology', 'Speech Pathology', 'Peer Support Work',
    'Aboriginal Health Work', 'Art Therapy', 'Music Therapy', 'Administration', 'Medical (Other)',
  ]
  for (let i = 0; i < disciplines.length; i++) {
    await db('professional_disciplines').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, name: disciplines[i], is_active: true, sort_order: i, created_at: new Date(), updated_at: new Date() })
  }
  console.log('Disciplines done:', disciplines.length)

  // Clinical Roles
  const roles = [
    'Consultant Psychiatrist', 'Psychiatry Registrar', 'Psychiatric Trainee',
    'Key Clinician', 'Care Coordinator', 'Clinical Lead',
    'Team Leader', 'Clinical Director', 'Nurse Unit Manager',
    'Clinical Nurse Specialist', 'Clinical Nurse Consultant',
    'Senior Clinician', 'Senior Psychologist', 'Senior Social Worker',
    'Allied Health Lead', 'Manager', 'Deputy Director',
    'Intake Clinician', 'Triage Clinician', 'On-Call Clinician',
    'Peer Support Worker', 'Consumer Consultant',
  ]
  const roleMap = new Map<string, string>()
  for (let i = 0; i < roles.length; i++) {
    const [r] = await db('clinical_roles').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, name: roles[i], is_active: true, sort_order: i, created_at: new Date(), updated_at: new Date() }).returning(ID_ONLY)
    roleMap.set(roles[i], r.id)
  }
  console.log('Clinical roles done:', roles.length)

  // Staff
  const hash = await bcrypt.hash('Password1!', 10)
  const staffList = [
    { given_name: 'Sarah', family_name: 'Chen', email: 'sarah.chen@goodhealth.demo', role: 'clinician' },
    { given_name: 'James', family_name: 'Patel', email: 'james.patel@goodhealth.demo', role: 'clinician' },
    { given_name: 'Emma', family_name: 'Williams', email: 'emma.williams@goodhealth.demo', role: 'clinician' },
    { given_name: 'Michael', family_name: "O'Brien", email: 'michael.obrien@goodhealth.demo', role: 'clinician' },
    { given_name: 'Lisa', family_name: 'Nguyen', email: 'lisa.nguyen@goodhealth.demo', role: 'clinician' },
    { given_name: 'David', family_name: 'Kumar', email: 'david.kumar@goodhealth.demo', role: 'clinician' },
    { given_name: 'Rachel', family_name: 'Thompson', email: 'rachel.thompson@goodhealth.demo', role: 'clinician' },
    { given_name: 'Ben', family_name: 'Fitzgerald', email: 'ben.fitzgerald@goodhealth.demo', role: 'clinician' },
    { given_name: 'Amy', family_name: 'Walker', email: 'amy.walker@goodhealth.demo', role: 'manager' },
    { given_name: 'Tom', family_name: 'Singh', email: 'tom.singh@goodhealth.demo', role: 'clinician' },
    { given_name: 'Kate', family_name: 'Morrison', email: 'kate.morrison@goodhealth.demo', role: 'clinician' },
    { given_name: 'Daniel', family_name: 'Brown', email: 'daniel.brown@goodhealth.demo', role: 'clinician' },
    { given_name: 'Sophie', family_name: 'Lee', email: 'sophie.lee@goodhealth.demo', role: 'clinician' },
    { given_name: 'Andrew', family_name: 'Hughes', email: 'andrew.hughes@goodhealth.demo', role: 'admin' },
    { given_name: 'Megan', family_name: 'Taylor', email: 'megan.taylor@goodhealth.demo', role: 'clinician' },
  ]
  const staffMap = new Map<string, string>()
  for (const s of staffList) {
    const existing = await db('staff').where({ email: s.email }).first()
    if (!existing) {
      const [row] = await db('staff').insert({
        id: db.raw('gen_random_uuid()'), clinic_id: clinicId,
        given_name: s.given_name, family_name: s.family_name, email: s.email,
        password_hash: hash, role: s.role, is_active: true, failed_login_attempts: 0,
        created_at: new Date(), updated_at: new Date(),
      }).returning(ID_ONLY)
      staffMap.set(s.email, row.id)
    } else {
      staffMap.set(s.email, existing.id)
    }
  }
  console.log('Staff done:', staffMap.size)

  // Team Assignments
  const today = new Date().toISOString().split('T')[0]
  const teamAssigns = [
    ['andrew.hughes@goodhealth.demo', 'Good Mental Health Division'],
    ['sarah.chen@goodhealth.demo', 'Inpatient Unit - Good Hospital'],
    ['michael.obrien@goodhealth.demo', 'Inpatient Unit - Good Hospital'],
    ['rachel.thompson@goodhealth.demo', 'Inpatient Unit - Good Hospital'],
    ['james.patel@goodhealth.demo', 'Continuing Care Team 1 (CCT1)'],
    ['lisa.nguyen@goodhealth.demo', 'Continuing Care Team 1 (CCT1)'],
    ['emma.williams@goodhealth.demo', 'Continuing Care Team 2 (CCT2)'],
    ['david.kumar@goodhealth.demo', 'Continuing Care Team 2 (CCT2)'],
    ['tom.singh@goodhealth.demo', 'Continuing Care Team 3 (CCT3)'],
    ['ben.fitzgerald@goodhealth.demo', 'Continuing Care Team 1 (CCT1)'],
    ['kate.morrison@goodhealth.demo', 'Community Care Unit (CCU)'],
    ['amy.walker@goodhealth.demo', 'Acute Intervention Team 1 (AIT1)'],
    ['daniel.brown@goodhealth.demo', 'Prevention and Recovery Care Unit (PARC)'],
    ['sophie.lee@goodhealth.demo', 'Prevention and Recovery Care Unit (PARC)'],
    ['megan.taylor@goodhealth.demo', 'Acute Intervention Team 2 (AIT2)'],
  ]
  for (const [email, unit] of teamAssigns) {
    const sid = staffMap.get(email); const uid = unitMap.get(unit)
    if (sid && uid) await db('staff_team_assignments').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, staff_id: sid, org_unit_id: uid, start_date: today, end_date: null, is_active: true, created_at: new Date(), updated_at: new Date() })
  }
  console.log('Team assignments done')

  // Role Assignments
  const roleAssigns: [string, string, string, string][] = [
    ['andrew.hughes@goodhealth.demo', 'Good Mental Health Division', 'Clinical Director', 'primary'],
    ['sarah.chen@goodhealth.demo', 'Inpatient Unit - Good Hospital', 'Consultant Psychiatrist', 'primary'],
    ['michael.obrien@goodhealth.demo', 'Inpatient Unit - Good Hospital', 'Nurse Unit Manager', 'primary'],
    ['rachel.thompson@goodhealth.demo', 'Inpatient Unit - Good Hospital', 'Clinical Nurse Specialist', 'primary'],
    ['james.patel@goodhealth.demo', 'Continuing Care Team 1 (CCT1)', 'Senior Psychologist', 'primary'],
    ['james.patel@goodhealth.demo', 'Continuing Care Team 1 (CCT1)', 'Clinical Lead', 'additional'],
    ['lisa.nguyen@goodhealth.demo', 'Continuing Care Team 1 (CCT1)', 'Key Clinician', 'primary'],
    ['emma.williams@goodhealth.demo', 'Continuing Care Team 2 (CCT2)', 'Senior Psychologist', 'primary'],
    ['david.kumar@goodhealth.demo', 'Continuing Care Team 2 (CCT2)', 'Key Clinician', 'primary'],
    ['tom.singh@goodhealth.demo', 'Continuing Care Team 3 (CCT3)', 'Consultant Psychiatrist', 'primary'],
    ['tom.singh@goodhealth.demo', 'Inpatient Unit - Good Hospital', 'On-Call Clinician', 'delegated'],
    ['kate.morrison@goodhealth.demo', 'Community Care Unit (CCU)', 'Peer Support Worker', 'primary'],
    ['amy.walker@goodhealth.demo', 'Acute Intervention Team 1 (AIT1)', 'Team Leader', 'primary'],
    ['ben.fitzgerald@goodhealth.demo', 'Continuing Care Team 1 (CCT1)', 'Key Clinician', 'additional'],
    ['daniel.brown@goodhealth.demo', 'Prevention and Recovery Care Unit (PARC)', 'Key Clinician', 'primary'],
    ['megan.taylor@goodhealth.demo', 'Acute Intervention Team 2 (AIT2)', 'Key Clinician', 'primary'],
  ]
  for (const [email, unit, role, type] of roleAssigns) {
    const sid = staffMap.get(email); const uid = unitMap.get(unit); const rid = roleMap.get(role)
    // BUG-STAFF-SETTINGS-CLINIC-ID-FILTER (S1) 2026-05-06:
    //   - Added clinic_id (now NOT NULL after migration 20260701000054)
    //   - Fixed role_id → clinical_role_id (pre-existing ghost-column drift; the
    //     prior @code-columns-exempt was incorrect — actual column IS
    //     clinical_role_id per schema-snapshot.json + psql verification).
    if (sid && uid && rid) await db('staff_role_assignments').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, staff_id: sid, org_unit_id: uid, clinical_role_id: rid, role_type: type, start_date: today, end_date: null, is_active: true, created_at: new Date(), updated_at: new Date() })
  }
  console.log('Role assignments done')

  // Programs
  const programNames = ['Clozapine Clinic', 'LAI Program', 'ECT Program', 'Neuropsychiatry', 'Perinatal MH', 'Forensic Liaison']
  const progIds: string[] = []
  for (const name of programNames) {
    const [p] = await db('programs').insert({ id: db.raw('gen_random_uuid()'), clinic_id: clinicId, name, description: null, is_active: true, created_at: new Date(), updated_at: new Date() }).returning(ID_ONLY)
    progIds.push(p.id)
  }
  const inpId = unitMap.get('Inpatient Unit - Good Hospital')!
  const cct1 = unitMap.get('Continuing Care Team 1 (CCT1)')!
  const cct2 = unitMap.get('Continuing Care Team 2 (CCT2)')!
  const parc = unitMap.get('Prevention and Recovery Care Unit (PARC)')!
  // @code-columns-exempt: pre-R2 drift on org_unit_programs: programid (real column is program_id). Baseline 20260701000000 is the fix.
  await db('org_unit_programs').insert({ id: db.raw('gen_random_uuid()'), org_unit_id: inpId, programid: progIds[0], created_at: new Date() }).onConflict(['org_unit_id','programid']).ignore()
  // @code-columns-exempt: pre-R2 drift on org_unit_programs: programid (real column is program_id). Baseline 20260701000000 is the fix.
  await db('org_unit_programs').insert({ id: db.raw('gen_random_uuid()'), org_unit_id: inpId, programid: progIds[2], created_at: new Date() }).onConflict(['org_unit_id','programid']).ignore()
  // @code-columns-exempt: pre-R2 drift on org_unit_programs: programid (real column is program_id). Baseline 20260701000000 is the fix.
  await db('org_unit_programs').insert({ id: db.raw('gen_random_uuid()'), org_unit_id: cct1, programid: progIds[0], created_at: new Date() }).onConflict(['org_unit_id','programid']).ignore()
  // @code-columns-exempt: pre-R2 drift on org_unit_programs: programid (real column is program_id). Baseline 20260701000000 is the fix.
  await db('org_unit_programs').insert({ id: db.raw('gen_random_uuid()'), org_unit_id: cct1, programid: progIds[1], created_at: new Date() }).onConflict(['org_unit_id','programid']).ignore()
  // @code-columns-exempt: pre-R2 drift on org_unit_programs: programid (real column is program_id). Baseline 20260701000000 is the fix.
  await db('org_unit_programs').insert({ id: db.raw('gen_random_uuid()'), org_unit_id: cct2, programid: progIds[1], created_at: new Date() }).onConflict(['org_unit_id','programid']).ignore()
  // @code-columns-exempt: pre-R2 drift on org_unit_programs: programid (real column is program_id). Baseline 20260701000000 is the fix.
  await db('org_unit_programs').insert({ id: db.raw('gen_random_uuid()'), org_unit_id: cct2, programid: progIds[3], created_at: new Date() }).onConflict(['org_unit_id','programid']).ignore()
  // @code-columns-exempt: pre-R2 drift on org_unit_programs: programid (real column is program_id). Baseline 20260701000000 is the fix.
  await db('org_unit_programs').insert({ id: db.raw('gen_random_uuid()'), org_unit_id: parc, programid: progIds[4], created_at: new Date() }).onConflict(['org_unit_id','programid']).ignore()
  console.log('Programs done')

  console.log('\nAll demo data seeded successfully!')
  await db.destroy()
}

seed().catch((e) => { console.error('Seed error:', e); process.exit(1) })
