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
  teamId,
  staffId,
} from '../config/ids';
import type { GeneratorResult } from './01_clinics';

// Phase 0.8 generator 07 — episodes (160 rows across 80 patients).
//
// Each patient gets two episodes, capturing a historical arc that's
// already closed plus a currently-open episode to demo the "active
// caseload" views:
//
//   Episode 1 — 2021 historical                 status='closed'
//     start_date: 2021-03-15
//     end_date:   2022-04-20
//     Encodes "the patient's first encounter with the service".
//
//   Episode 2 — 2024 current                    status='open'
//     start_date: 2024-11-10
//     end_date:   null
//     Encodes "the patient's current live episode" that later
//     generators (clinical notes, medications, risk assessments)
//     will attach rows to.
//
// Every episode:
//   - Deterministic id via episodeId(patientUuid, index)
//   - team_id set to the team's org_unit uuid from generator 01
//   - primary_clinician_id set to the team-lead staff uuid from
//     generator 04. Constant per (clinic, team) so every patient
//     in the same team shares the same lead clinician — matches
//     real caseload distribution.
//   - specialty_code='mental_health' (NOT NULL, required by
//     Phase 3 specialty migration)
//   - episode_type='mental_health' for routing to MH-specific tabs
//   - episode_number deterministic by sequence position
//
// Dates are hard-coded constants rather than rng-derived so the
// closure_summary + presenting_problem strings read naturally and
// reseeds are trivially diffable.

interface EpisodeRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  title: string;
  episode_number: string;
  episode_type: string;
  status: string;
  presenting_problem: string;
  primary_diagnosis: string | null;
  start_date: string;
  end_date: string | null;
  closure_reason: string | null;
  closure_summary: string | null;
  team_id: string;
  primary_clinician_id: string;
  specialty_code: string;
}

export interface EpisodesBuild {
  readonly rows: EpisodeRow[];
}

const EPISODE_1_START = '2021-03-15';
const EPISODE_1_END   = '2022-04-20';
const EPISODE_2_START = '2024-11-10';

const PRESENTING_1 = 'Initial presentation via GP referral — anxiety + low mood, functional decline at work/home.';
const PRESENTING_2 = 'Re-engagement after relapse — sleep disturbance, resurgent anxiety, medication review requested.';

const CLOSURE_REASON_1  = 'Goals achieved';
const CLOSURE_SUMMARY_1 =
  'Episode closed after 13 months. Patient reported sustained improvement in PHQ-9/GAD-7 scores and returned to baseline function. Discharged with GP-shared relapse prevention plan.';

const PRIMARY_DIAGNOSIS = 'F33.1 — Major depressive disorder, recurrent, moderate';

export function buildEpisodes(): EpisodesBuild {
  const rows: EpisodeRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const team of TEAM_SLUGS) {
      const tid = teamId(clinic.slug, team);
      const leadClinicianId = staffId(clinic.slug, `${team}.team-lead`);

      for (let i = 1; i <= PATIENTS_PER_TEAM; i++) {
        const pid = patientId(clinic.slug, team, i);

        rows.push({
          id: episodeId(pid, 1),
          patient_id: pid,
          clinic_id: cid,
          title: 'Initial mental health episode',
          episode_number: `EP-${clinic.slug.toUpperCase().slice(0, 3)}-${team === 'alpha' ? 'A' : 'B'}-${String(i).padStart(3, '0')}-01`,
          episode_type: 'mental_health',
          status: 'closed',
          presenting_problem: PRESENTING_1,
          primary_diagnosis: PRIMARY_DIAGNOSIS,
          start_date: EPISODE_1_START,
          end_date: EPISODE_1_END,
          closure_reason: CLOSURE_REASON_1,
          closure_summary: CLOSURE_SUMMARY_1,
          team_id: tid,
          primary_clinician_id: leadClinicianId,
          specialty_code: 'mental_health',
        });

        rows.push({
          id: episodeId(pid, 2),
          patient_id: pid,
          clinic_id: cid,
          title: 'Current mental health episode',
          episode_number: `EP-${clinic.slug.toUpperCase().slice(0, 3)}-${team === 'alpha' ? 'A' : 'B'}-${String(i).padStart(3, '0')}-02`,
          episode_type: 'mental_health',
          status: 'open',
          presenting_problem: PRESENTING_2,
          primary_diagnosis: PRIMARY_DIAGNOSIS,
          start_date: EPISODE_2_START,
          end_date: null,
          closure_reason: null,
          closure_summary: null,
          team_id: tid,
          primary_clinician_id: leadClinicianId,
          specialty_code: 'mental_health',
        });
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

export async function runEpisodesStep(knex: Knex): Promise<GeneratorResult> {
  const { rows } = buildEpisodes();
  return upsertById(knex, 'episodes', rows);
}
