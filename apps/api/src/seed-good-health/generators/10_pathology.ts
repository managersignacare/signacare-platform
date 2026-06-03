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

// Phase 0.8 generator 10 — pathology (80 orders + 320 results = 400).
//
// One annual metabolic panel per patient. Ordered by the team lead,
// collected + resulted a year ago. Every order carries 4 result
// rows — Sodium, Potassium, Fasting glucose, HbA1c — all within
// normal reference ranges because the generator seeds the healthy
// steady-state rather than edge cases.
//
// Order metadata:
//   panel_name = "Annual metabolic screen"
//   urgency    = routine
//   status     = completed
//   fasting    = true (HbA1c + fasting glucose)
//   order_number = ORD-<CLINIC3>-<TEAM1>-<NNN>
//
// Dates are fixed constants so reseeds are trivially diffable.
// Later generators can add clozapine weekly FBCs, lithium levels,
// and abnormal rows for specific sub-cohorts.

interface PathologyOrderRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string;
  ordered_by_id: string;
  order_number: string;
  panel_name: string;
  tests: string[];
  urgency: string;
  clinical_notes: string | null;
  fasting: boolean;
  copy_to_gp: boolean;
  status: string;
}

interface PathologyResultRow {
  id: string;
  clinic_id: string;
  pathology_order_id: string;
  patient_id: string;
  test_code: string;
  test_name: string;
  result_value: string;
  result_unit: string;
  reference_range: string;
  abnormal_flag: string;
  result_status: string;
  collection_date: string;
  result_date: string;
  performing_lab: string;
  is_critical: boolean;
}

export interface PathologyBuild {
  readonly orderRows: PathologyOrderRow[];
  readonly resultRows: PathologyResultRow[];
}

interface ResultTemplate {
  readonly slug: string;
  readonly code: string;
  readonly name: string;
  readonly value: string;
  readonly unit: string;
  readonly range: string;
}

const RESULT_TEMPLATES: readonly ResultTemplate[] = [
  { slug: 'na',   code: 'NA',    name: 'Sodium',            value: '139', unit: 'mmol/L', range: '135-145' },
  { slug: 'k',    code: 'K',     name: 'Potassium',         value: '4.2', unit: 'mmol/L', range: '3.5-5.1' },
  { slug: 'fbg',  code: 'GLUC',  name: 'Fasting glucose',   value: '5.1', unit: 'mmol/L', range: '3.9-5.5' },
  { slug: 'hba1c',code: 'HBA1C', name: 'HbA1c',             value: '5.4', unit: '%',      range: '<5.7' },
];

const PANEL_NAME = 'Annual metabolic screen';
const PANEL_TESTS = RESULT_TEMPLATES.map((t) => t.name);
const COLLECTION_DATE = '2025-04-15';
const RESULT_DATE = '2025-04-16';
const PERFORMING_LAB = 'Good Health Pathology (demo)';

function clinicPrefix(slug: string): string {
  return slug.slice(0, 3).toUpperCase();
}

export function buildPathology(): PathologyBuild {
  const orderRows: PathologyOrderRow[] = [];
  const resultRows: PathologyResultRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const team of TEAM_SLUGS) {
      const orderedById = staffId(clinic.slug, `${team}.team-lead`);
      for (let i = 1; i <= PATIENTS_PER_TEAM; i++) {
        const pid = patientId(clinic.slug, team, i);
        const ep2Uuid = episodeId(pid, 2);
        const orderUuid = derive(pid, 'pathology.annual-metabolic.2025');
        const orderNumber = `ORD-${clinicPrefix(clinic.slug)}-${team === 'alpha' ? 'A' : 'B'}-${String(i).padStart(3, '0')}`;

        orderRows.push({
          id: orderUuid,
          clinic_id: cid,
          patient_id: pid,
          episode_id: ep2Uuid,
          ordered_by_id: orderedById,
          order_number: orderNumber,
          panel_name: PANEL_NAME,
          tests: [...PANEL_TESTS],
          urgency: 'routine',
          clinical_notes: 'Annual metabolic screen — routine demo seed.',
          fasting: true,
          copy_to_gp: true,
          status: 'completed',
        });

        for (const template of RESULT_TEMPLATES) {
          resultRows.push({
            id: derive(orderUuid, `result.${template.slug}`),
            clinic_id: cid,
            pathology_order_id: orderUuid,
            patient_id: pid,
            test_code: template.code,
            test_name: template.name,
            result_value: template.value,
            result_unit: template.unit,
            reference_range: template.range,
            abnormal_flag: 'normal',
            result_status: 'final',
            collection_date: COLLECTION_DATE,
            result_date: RESULT_DATE,
            performing_lab: PERFORMING_LAB,
            is_critical: false,
          });
        }
      }
    }
  }

  return { orderRows, resultRows };
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

export async function runPathologyStep(knex: Knex): Promise<GeneratorResult> {
  const { orderRows, resultRows } = buildPathology();
  // Orders first — results FK to orders via pathology_order_id.
  const o = await upsertById(knex, 'pathology_orders', orderRows);
  const r = await upsertById(knex, 'pathology_results', resultRows);
  return {
    inserted: o.inserted + r.inserted,
    updated: o.updated + r.updated,
  };
}
