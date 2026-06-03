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

// Phase 0.8 generator 12 — outcome measures (640 rows).
//
// Two measures per timepoint × 4 timepoints × 80 patients = 640.
//
// Measures:
//   HoNOS  (clinician-rated, 12 items × 0-4, total 0-48, lower better)
//   K10    (patient-reported, 10 items × 1-5, total 10-50, lower better)
//
// Every patient gets the same 4-timepoint arc matching the risk
// assessment trajectory from generator 11 so "mood improving but
// risk dipped mid-Episode 2" reads as a consistent clinical story:
//
//   #1 2021-06-01  Episode 1   HoNOS 18 | K10 32  — entry, moderate
//   #2 2022-03-15  Episode 1   HoNOS 10 | K10 18  — end, low
//   #3 2024-12-01  Episode 2   HoNOS 16 | K10 28  — re-engagement
//   #4 2026-03-01  Episode 2   HoNOS  8 | K10 16  — current, stable
//
// collection_occasion mirrors the Australian AMHOCN classification
// pattern: initial / review / discharge / review.
//
// Every row is anchored to the team-lead staff as the recording
// clinician. Reseeds upsert via a derived id so the row is
// addressable by test code.

interface OutcomeRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  episode_id: string;
  staff_id: string;
  measure_type: string;
  collection_occasion: string;
  total_score: number;
  notes: string | null;
}

export interface OutcomesBuild {
  readonly rows: OutcomeRow[];
}

type MeasureType = 'honos' | 'k10';

interface TimepointTemplate {
  readonly index: number;
  readonly episodeNumber: 1 | 2;
  readonly collectionOccasion: 'initial' | 'review' | 'discharge';
  readonly honos: number;
  readonly k10: number;
}

const TIMEPOINTS: readonly TimepointTemplate[] = [
  { index: 1, episodeNumber: 1, collectionOccasion: 'initial',   honos: 18, k10: 32 },
  { index: 2, episodeNumber: 1, collectionOccasion: 'discharge', honos: 10, k10: 18 },
  { index: 3, episodeNumber: 2, collectionOccasion: 'initial',   honos: 16, k10: 28 },
  { index: 4, episodeNumber: 2, collectionOccasion: 'review',    honos:  8, k10: 16 },
];

export function buildOutcomeMeasures(): OutcomesBuild {
  const rows: OutcomeRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const team of TEAM_SLUGS) {
      const recorderId = staffId(clinic.slug, `${team}.team-lead`);
      for (let i = 1; i <= PATIENTS_PER_TEAM; i++) {
        const pid = patientId(clinic.slug, team, i);

        for (const tp of TIMEPOINTS) {
          const epUuid = episodeId(pid, tp.episodeNumber);

          for (const measure of ['honos', 'k10'] as const) {
            rows.push({
              id: derive(pid, `outcome.${tp.index}.${measure}`),
              patient_id: pid,
              clinic_id: cid,
              episode_id: epUuid,
              staff_id: recorderId,
              measure_type: measure,
              collection_occasion: tp.collectionOccasion,
              total_score: measure === 'honos' ? tp.honos : tp.k10,
              notes: null,
            });
          }
        }
      }
    }
  }

  return { rows };
}

function measureKey(m: MeasureType): MeasureType {
  return m;
}
void measureKey;

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

export async function runOutcomeMeasuresStep(
  knex: Knex,
): Promise<GeneratorResult> {
  const { rows } = buildOutcomeMeasures();
  return upsertById(knex, 'outcome_measures', rows);
}
