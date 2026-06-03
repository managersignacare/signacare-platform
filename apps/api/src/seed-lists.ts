import { db } from './db/db'

// Fixed reference date for seed determinism. See seed-dual-lai.ts for
// rationale. Re-running the seed at different wall-clock times must
// not produce different rows — tests rely on stable demo data.
const SEED_REFERENCE_DATE = new Date('2026-04-15T00:00:00Z');

interface ClinicRow { id: string }
interface PatientRow { id: string; clinic_id: string; given_name: string; family_name: string }
interface OrgUnitRow { id: string; clinic_id: string; name: string }
interface StaffRow { id: string; clinic_id: string; email: string }

async function seed() {
  const [clinic] = await db<ClinicRow>('clinics').select('id').limit(1)
  const clinicId = clinic.id

  const patients = await db<PatientRow>('patients').where({ clinic_id: clinicId }).select('id', 'given_name', 'family_name')
  const units = await db<OrgUnitRow>('org_units').where({ clinic_id: clinicId }).select('id', 'name')
  const unitMap = new Map(units.map((u) => [u.name, u.id]))
  const staff = await db<StaffRow>('staff').where({ clinic_id: clinicId }).select('id', 'email')
  const staffMap = new Map(staff.map((s) => [s.email, s.id]))

  if (patients.length < 10) { console.log('Need at least 10 patients'); await db.destroy(); return }

  // Ensure patients are spread across different teams for list pages
  const teamAssignments = [
    // ACIS patients (Acute Intervention Teams)
    { patientIdx: 7, unit: 'Acute Intervention Team 1 (AIT1)', clinician: 'amy.walker@goodhealth.demo' },
    { patientIdx: 3, unit: 'Acute Intervention Team 2 (AIT2)', clinician: 'megan.taylor@goodhealth.demo' },

    // PARC patients
    { patientIdx: 8, unit: 'Prevention and Recovery Care Unit (PARC)', clinician: 'daniel.brown@goodhealth.demo' },
    { patientIdx: 5, unit: 'Prevention and Recovery Care Unit (PARC)', clinician: 'sophie.lee@goodhealth.demo' },

    // CCU patients
    { patientIdx: 9, unit: 'Community Care Unit (CCU)', clinician: 'kate.morrison@goodhealth.demo' },

    // IPU patients
    { patientIdx: 0, unit: 'Inpatient Unit - Good Hospital', clinician: 'sarah.chen@goodhealth.demo' },
    { patientIdx: 4, unit: 'Inpatient Unit - Good Hospital', clinician: 'michael.obrien@goodhealth.demo' },
    { patientIdx: 6, unit: 'Inpatient Unit - Good Hospital', clinician: 'rachel.thompson@goodhealth.demo' },
  ]

  let added = 0
  for (const ta of teamAssignments) {
    const pid = patients[ta.patientIdx]?.id
    const uid = unitMap.get(ta.unit)
    const sid = staffMap.get(ta.clinician)
    if (pid && uid) {
      const existing = await db('patient_team_assignments').where({ patient_id: pid, org_unit_id: uid }).first()
      if (!existing) {
        await db('patient_team_assignments').insert({
          id: db.raw('gen_random_uuid()'), patient_id: pid, org_unit_id: uid,
          primary_clinician_id: sid || null, is_active: true, created_at: SEED_REFERENCE_DATE, updated_at: SEED_REFERENCE_DATE,
        })
        added++
      }
    }
  }
  console.log('Team assignments added:', added)

  // Add some MH Act orders for MHA list
  const orderTypes = await db('legal_order_type_configs').where({ clinic_id: clinicId }).limit(5)
  if (orderTypes.length > 0) {
    const mhaOrders = [
      { patientIdx: 0, orderIdx: 0, status: 'active' }, // Assessment Order
      { patientIdx: 4, orderIdx: 2, status: 'active' }, // Temporary Treatment Order
      { patientIdx: 6, orderIdx: 3, status: 'active' }, // Treatment Order
    ]
    let ordersAdded = 0
    for (const o of mhaOrders) {
      const pid = patients[o.patientIdx]?.id
      const ot = orderTypes[o.orderIdx]
      if (pid && ot) {
        const existing = await db('patient_legal_orders').where({ patient_id: pid, order_type_id: ot.id }).first()
        if (!existing) {
          await db('patient_legal_orders').insert({
            id: db.raw('gen_random_uuid()'), patient_id: pid, clinic_id: clinicId,
            order_type_id: ot.id, entered_by_id: staff[0]?.id ?? null,
            start_date: SEED_REFERENCE_DATE.toISOString().split('T')[0],
            review_date: new Date(SEED_REFERENCE_DATE.getTime() + 14 * 86400000).toISOString().split('T')[0],
            status: o.status, created_at: SEED_REFERENCE_DATE, updated_at: SEED_REFERENCE_DATE,
          })
          ordersAdded++
        }
      }
    }
    console.log('MH Act orders added:', ordersAdded)
  }

  // Add some alerts for patients (for flag display and alert lists)
  const alertTypes = await db('alert_types').where({ clinic_id: clinicId, is_active: true }).limit(5)
  if (alertTypes.length > 0) {
    const alerts = [
      { patientIdx: 0, alertIdx: 0, title: 'Aggression risk — known history' },
      { patientIdx: 4, alertIdx: 2, title: 'Suicide risk — active safety plan' },
      { patientIdx: 6, alertIdx: 4, title: 'Absconding risk — previous elopement' },
      { patientIdx: 7, alertIdx: 6, title: 'Home visit safety alert' },
    ]
    let alertsAdded = 0
    for (const a of alerts) {
      const pid = patients[a.patientIdx]?.id
      const at = alertTypes[a.alertIdx]
      if (pid && at) {
        const existing = await db('patient_alerts').where({ patient_id: pid, alert_type_id: at.id }).first()
        if (!existing) {
          await db('patient_alerts').insert({
            id: db.raw('gen_random_uuid()'), patient_id: pid, clinic_id: clinicId,
            alert_type_id: at.id, entered_by_id: staff[0]?.id ?? null,
            title: a.title, severity: at.severity, is_active: true, show_flag: true,
            created_at: SEED_REFERENCE_DATE, updated_at: SEED_REFERENCE_DATE,
          })
          alertsAdded++
        }
      }
    }
    console.log('Patient alerts added:', alertsAdded)
  }

  // Add episodes for patients in various teams
  const episodeData = [
    { patientIdx: 0, title: 'Inpatient Care Episode', type: 'inpatient', team: 'Inpatient Unit - Good Hospital' },
    { patientIdx: 1, title: 'CCT1 Community Episode', type: 'community', team: 'Continuing Care Team 1 (CCT1)' },
    { patientIdx: 3, title: 'ACIS Crisis Episode', type: 'community', team: 'Acute Intervention Team 2 (AIT2)' },
    { patientIdx: 7, title: 'ACIS Assessment Episode', type: 'community', team: 'Acute Intervention Team 1 (AIT1)' },
    { patientIdx: 8, title: 'PARC Recovery Episode', type: 'parc', team: 'Prevention and Recovery Care Unit (PARC)' },
    { patientIdx: 9, title: 'CCU Rehabilitation Episode', type: 'residential', team: 'Community Care Unit (CCU)' },
    { patientIdx: 4, title: 'Inpatient Acute Episode', type: 'inpatient', team: 'Inpatient Unit - Good Hospital' },
  ]
  let epsAdded = 0
  for (const e of episodeData) {
    const pid = patients[e.patientIdx]?.id
    const uid = unitMap.get(e.team)
    if (pid) {
      const existing = await db('episodes').where({ patient_id: pid, presenting_problem: e.title }).first()
      if (!existing) {
        // @code-columns-exempt: pre-R2 drift on episodes: team (real column is team_id). Baseline 20260701000000 is the fix.
        await db('episodes').insert({
          id: db.raw('gen_random_uuid()'), clinic_id: clinicId, patient_id: pid,
          primary_clinician_id: staff[0]?.id ?? null,
          episode_number: `EP-${1000 + epsAdded}`, episode_type: e.type,
          status: 'open', presenting_problem: e.title, team: uid ?? null,
          start_date: SEED_REFERENCE_DATE.toISOString().split('T')[0],
          created_at: SEED_REFERENCE_DATE, updated_at: SEED_REFERENCE_DATE,
        })
        epsAdded++
      }
    }
  }
  console.log('Episodes added:', epsAdded)

  console.log('\nList demo data seeded!')
  await db.destroy()
}

seed().catch(e => { console.error('Error:', e); process.exit(1) })
