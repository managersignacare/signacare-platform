import { db } from './db/db'

// Fixed reference date so re-runs produce identical seed data (determinism).
// Chosen to be stable across re-seeds — NOT the wall clock. See
// Phase 0.7.5 plan — Seed determinism (I6 in the bug inventory).
const SEED_REFERENCE_DATE = new Date('2026-04-15T00:00:00Z');
const daysAgo = (n: number) => new Date(SEED_REFERENCE_DATE.getTime() - n * 86400000).toISOString().split('T')[0];
const daysAhead = (n: number) => new Date(SEED_REFERENCE_DATE.getTime() + n * 86400000).toISOString().split('T')[0];

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const clinicId = clinic.id

  // Find Marcus Johnson (first demo patient)
  const patient = await db('patients').where({ clinic_id: clinicId, given_name: 'Marcus' }).first()
  if (!patient) { console.log('Marcus Johnson not found'); await db.destroy(); return }

  // Check if medications table exists
  const hasMeds = await db.schema.hasTable('patient_medications')
  if (!hasMeds) {
    // Create a simple medications table
    await db.schema.createTable('patient_medications', (t) => {
      t.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'))
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE')
      t.uuid('clinic_id').notNullable()
      t.string('medication_name', 300).notNullable()
      t.string('generic_name', 300).nullable()
      t.string('dose', 100).notNullable()
      t.string('frequency', 100).notNullable()
      t.string('route', 50).notNullable().defaultTo('oral')
      t.string('status', 30).notNullable().defaultTo('active')
      t.boolean('is_lai').notNullable().defaultTo(false)
      t.boolean('is_clozapine').notNullable().defaultTo(false)
      t.boolean('is_s8').notNullable().defaultTo(false)
      t.string('lai_frequency', 50).nullable()
      t.date('lai_next_due').nullable()
      t.date('lai_last_admin').nullable()
      t.date('prescribed_at').nullable()
      t.string('prescriber', 200).nullable()
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(db.fn.now())
      t.index(['patient_id'])
    })
    console.log('Created patient_medications table')
  }

  // Add two LAIs for Marcus Johnson
  const lai1 = await db('patient_medications').where({ patient_id: patient.id, drug_label: 'Paliperidone Palmitate' }).first()
  if (!lai1) {
    // @code-columns-exempt: pre-R2 drift on patient_medications: medication_name, lai_frequency, lai_last_admin, lai_next_due, prescribed_at, prescriber. Baseline 20260701000000 is the fix.
    await db('patient_medications').insert({
      id: db.raw('gen_random_uuid()'), patient_id: patient.id, clinic_id: clinicId,
      medication_name: 'Paliperidone Palmitate', generic_name: 'Invega Sustenna',
      dose: '150mg', frequency: 'Monthly', route: 'IM', status: 'active',
      is_lai: true, lai_frequency: 'monthly',
      lai_last_admin: daysAgo(25),
      lai_next_due: daysAhead(5),
      prescribed_at: SEED_REFERENCE_DATE.toISOString().split('T')[0], prescriber: 'Dr Sarah Chen',
      created_at: SEED_REFERENCE_DATE, updated_at: SEED_REFERENCE_DATE,
    })
    console.log('Added LAI 1: Paliperidone Palmitate')
  }

  const lai2 = await db('patient_medications').where({ patient_id: patient.id, drug_label: 'Aripiprazole Monohydrate' }).first()
  if (!lai2) {
    // @code-columns-exempt: pre-R2 drift on patient_medications: medication_name, lai_frequency, lai_last_admin, lai_next_due, prescribed_at, prescriber. Baseline 20260701000000 is the fix.
    await db('patient_medications').insert({
      id: db.raw('gen_random_uuid()'), patient_id: patient.id, clinic_id: clinicId,
      medication_name: 'Aripiprazole Monohydrate', generic_name: 'Abilify Maintena',
      dose: '400mg', frequency: 'Monthly', route: 'IM', status: 'active',
      is_lai: true, lai_frequency: 'monthly',
      lai_last_admin: daysAgo(20),
      lai_next_due: daysAhead(10),
      prescribed_at: SEED_REFERENCE_DATE.toISOString().split('T')[0], prescriber: 'Dr Tom Singh',
      created_at: SEED_REFERENCE_DATE, updated_at: SEED_REFERENCE_DATE,
    })
    console.log('Added LAI 2: Aripiprazole Monohydrate')
  }

  // Add some regular meds too
  const meds = [
    { name: 'Olanzapine', dose: '10mg', freq: 'Nocte', route: 'oral' },
    { name: 'Sodium Valproate', dose: '500mg', freq: 'BD', route: 'oral', is_s8: false },
  ]
  for (const m of meds) {
    const exists = await db('patient_medications').where({ patient_id: patient.id, drug_label: m.name }).first()
    if (!exists) {
      // @code-columns-exempt: pre-R2 drift on patient_medications: medication_name, prescribed_at. Baseline 20260701000000 is the fix.
      await db('patient_medications').insert({
        id: db.raw('gen_random_uuid()'), patient_id: patient.id, clinic_id: clinicId,
        medication_name: m.name, dose: m.dose, frequency: m.freq, route: m.route,
        status: 'active', prescribed_at: new Date().toISOString().split('T')[0],
        created_at: new Date(), updated_at: new Date(),
      })
    }
  }
  console.log('Regular medications added')

  console.log('\nDual LAI demo data seeded for Marcus Johnson!')
  await db.destroy()
}

seed().catch(e => { console.error('Error:', e); process.exit(1) })
