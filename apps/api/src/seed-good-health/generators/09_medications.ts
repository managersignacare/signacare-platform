import type { Knex } from 'knex';
import {
  MENTAL_HEALTH_CLINICS,
  TEAM_SLUGS,
  PATIENTS_PER_TEAM,
} from '../config/catalog';
import {
  clinicId,
  patientId,
  episodeId,
  staffId,
  derive,
} from '../config/ids';
import type { GeneratorResult } from './01_clinics';

// Phase 0.8 generator 09 — medications (240 rows: 3 per patient).
//
// Baseline cohort, no LAI/clozapine/taper subtypes yet. Every patient
// on the current open episode carries:
//
//   1. Sertraline 100mg PO daily — anxiety/depression regular
//   2. Lorazepam 0.5mg PO PRN    — anxiety PRN rescue
//   3. Melatonin 5mg PO nocte    — sleep aid regular
//
// All meds attach to the open Episode 2 (2024-11-10 →). All are
// status='active' with a start_date matching the episode start. The
// prescribing clinician is the team lead — matches the single
// point-of-prescribing accountability pattern the real tenants use.
//
// Later generators can layer clozapine / LAI / taper sub-cohorts
// on top by extending MEDICATION_TEMPLATES and emitting additional
// rows keyed by a rng draw. For now the baseline is fixed so
// reseeds are byte-stable and easy to diff.

interface MedicationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string;
  drug_label: string;
  generic_name: string;
  brand_name: string | null;
  dose: string;
  dose_unit: string;
  route: string;
  frequency: string;
  instructions: string | null;
  indication: string;
  start_date: string;
  end_date: string | null;
  status: string;
  is_regular: boolean;
  is_prn: boolean;
  is_lai: boolean;
  source: string;
  prescribed_by_staff_id: string;
  notes: string | null;
}

export interface MedicationsBuild {
  readonly rows: MedicationRow[];
}

interface MedicationTemplate {
  readonly slug: string;
  readonly drug_label: string;
  readonly generic_name: string;
  readonly brand_name: string | null;
  readonly dose: string;
  readonly dose_unit: string;
  readonly route: string;
  readonly frequency: string;
  readonly instructions: string | null;
  readonly indication: string;
  readonly is_regular: boolean;
  readonly is_prn: boolean;
}

const MEDICATION_TEMPLATES: readonly MedicationTemplate[] = [
  {
    slug: 'sertraline',
    drug_label: 'Sertraline 100mg',
    generic_name: 'Sertraline',
    brand_name: 'Zoloft',
    dose: '100',
    dose_unit: 'mg',
    route: 'oral',
    frequency: 'daily',
    instructions: 'Take one tablet in the morning with food.',
    indication: 'Major depressive disorder',
    is_regular: true,
    is_prn: false,
  },
  {
    slug: 'lorazepam-prn',
    drug_label: 'Lorazepam 0.5mg',
    generic_name: 'Lorazepam',
    brand_name: 'Ativan',
    dose: '0.5',
    dose_unit: 'mg',
    route: 'oral',
    frequency: 'prn',
    instructions: 'Take one tablet as needed for acute anxiety, max 3 per day.',
    indication: 'Acute anxiety',
    is_regular: false,
    is_prn: true,
  },
  {
    slug: 'melatonin',
    drug_label: 'Melatonin 5mg',
    generic_name: 'Melatonin',
    brand_name: null,
    dose: '5',
    dose_unit: 'mg',
    route: 'oral',
    frequency: 'nocte',
    instructions: 'Take one tablet 30 minutes before bedtime.',
    indication: 'Sleep disturbance',
    is_regular: true,
    is_prn: false,
  },
];

const EPISODE_2_START = '2024-11-10';

export function buildMedications(): MedicationsBuild {
  const rows: MedicationRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const team of TEAM_SLUGS) {
      const leadClinicianId = staffId(clinic.slug, `${team}.team-lead`);
      for (let i = 1; i <= PATIENTS_PER_TEAM; i++) {
        const pid = patientId(clinic.slug, team, i);
        const ep2Uuid = episodeId(pid, 2);

        for (const template of MEDICATION_TEMPLATES) {
          rows.push({
            id: derive(pid, `med.${template.slug}`),
            clinic_id: cid,
            patient_id: pid,
            episode_id: ep2Uuid,
            drug_label: template.drug_label,
            generic_name: template.generic_name,
            brand_name: template.brand_name,
            dose: template.dose,
            dose_unit: template.dose_unit,
            route: template.route,
            frequency: template.frequency,
            instructions: template.instructions,
            indication: template.indication,
            start_date: EPISODE_2_START,
            end_date: null,
            status: 'active',
            is_regular: template.is_regular,
            is_prn: template.is_prn,
            is_lai: false,
            source: 'seed',
            prescribed_by_staff_id: leadClinicianId,
            notes: null,
          });
        }
      }
    }
  }

  return { rows };
}

async function upsertById<T extends { id: string }>(
  knex: Knex,
  table: string,
  rows: readonly T[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const existing = await knex(table).where({ id: row.id }).first();
    if (existing) {
      await knex(table).where({ id: row.id }).update(row);
      updated++;
    } else {
      await knex(table).insert(row);
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function runMedicationsStep(
  knex: Knex,
): Promise<GeneratorResult> {
  const { rows } = buildMedications();
  return upsertById(knex, 'patient_medications', rows);
}
