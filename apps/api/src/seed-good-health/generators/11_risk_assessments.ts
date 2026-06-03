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

// Phase 0.8 generator 11 — risk assessments (320 rows).
//
// Four assessments per patient tracing a recovery-then-relapse-then-
// recovery trajectory across both episodes:
//
//   #1  2021-06-01  Episode 1  overall_risk_level='medium'
//         Entry assessment — patient newly engaged, mood is poor
//   #2  2022-03-15  Episode 1  overall_risk_level='low'
//         End-of-episode assessment — improvement, discharged
//   #3  2024-12-01  Episode 2  overall_risk_level='medium'
//         Re-engagement — mild relapse, resurgent anxiety
//   #4  2026-03-01  Episode 2  overall_risk_level='low'
//         Current assessment — stable on current regime
//
// The medium-risk rows carry suicide_risk=true + a safety_plan
// narrative so later generators can check "patients with an
// active safety plan" queries. The low-risk rows have safety
// flags cleared.
//
// Every assessment:
//   - Deterministic id via derive(patient, `risk.${index}`)
//   - assessed_by_id = team lead for consistent accountability
//   - episode_id matches the date window (1 or 2)
//   - review_date = assessment_date + 90 days (fixed cadence)

type RiskLevel = 'low' | 'medium' | 'high';

interface RiskAssessmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string;
  assessment_type: string;
  overall_risk_level: RiskLevel;
  suicide_risk: boolean;
  self_harm_risk: boolean;
  harm_to_others_risk: boolean;
  absconding_risk: boolean;
  vulnerability_risk: boolean;
  protective_factors: string | null;
  risk_narrative: string | null;
  risk_management_plan: string | null;
  safety_plan_in_place: boolean;
  safety_plan_summary: string | null;
  assessed_by_id: string;
  assessment_date: string;
  review_date: string;
}

export interface RiskAssessmentsBuild {
  readonly rows: RiskAssessmentRow[];
}

interface AssessmentTemplate {
  readonly index: number;
  readonly episodeNumber: 1 | 2;
  readonly assessmentDate: string;
  readonly reviewDate: string;
  readonly level: RiskLevel;
  readonly suicide: boolean;
  readonly selfHarm: boolean;
  readonly narrative: string;
  readonly protective: string;
  readonly safetyPlan: boolean;
  readonly safetySummary: string | null;
}

const ASSESSMENTS: readonly AssessmentTemplate[] = [
  {
    index: 1,
    episodeNumber: 1,
    assessmentDate: '2021-06-01',
    reviewDate: '2021-08-30',
    level: 'medium',
    suicide: true,
    selfHarm: false,
    narrative:
      'Entry assessment — low mood, passive suicidal ideation without intent or plan. No prior attempts.',
    protective: 'Supportive family, engaged with GP, no access to lethal means.',
    safetyPlan: true,
    safetySummary:
      'Identified warning signs, internal coping strategies, social supports, professional help. Emergency contacts documented.',
  },
  {
    index: 2,
    episodeNumber: 1,
    assessmentDate: '2022-03-15',
    reviewDate: '2022-06-13',
    level: 'low',
    suicide: false,
    selfHarm: false,
    narrative:
      'End-of-episode assessment — mood stabilised, SI resolved, returning to baseline function.',
    protective: 'Good treatment response, stable housing and employment, strong GP relationship.',
    safetyPlan: false,
    safetySummary: null,
  },
  {
    index: 3,
    episodeNumber: 2,
    assessmentDate: '2024-12-01',
    reviewDate: '2025-03-01',
    level: 'medium',
    suicide: true,
    selfHarm: false,
    narrative:
      'Re-engagement following reported mild relapse. Sleep disturbance, resurgent anxiety, fleeting passive SI denied.',
    protective: 'Previous treatment success, engaged family, insight into illness.',
    safetyPlan: true,
    safetySummary:
      'Reviewed and updated safety plan. Escalation plan agreed with family. Restricted access to medications overnight.',
  },
  {
    index: 4,
    episodeNumber: 2,
    assessmentDate: '2026-03-01',
    reviewDate: '2026-05-30',
    level: 'low',
    suicide: false,
    selfHarm: false,
    narrative:
      'Routine review — patient stable on current regime, denies ideation or intent, sleep restored.',
    protective: 'Sustained response to medication, active in recovery plan, good social network.',
    safetyPlan: false,
    safetySummary: null,
  },
];

export function buildRiskAssessments(): RiskAssessmentsBuild {
  const rows: RiskAssessmentRow[] = [];

  for (const clinic of MENTAL_HEALTH_CLINICS) {
    const cid = clinicId(clinic.slug);
    for (const team of TEAM_SLUGS) {
      const assessedById = staffId(clinic.slug, `${team}.team-lead`);
      for (let i = 1; i <= PATIENTS_PER_TEAM; i++) {
        const pid = patientId(clinic.slug, team, i);

        for (const template of ASSESSMENTS) {
          const epUuid = episodeId(pid, template.episodeNumber);
          rows.push({
            id: derive(pid, `risk.${template.index}`),
            clinic_id: cid,
            patient_id: pid,
            episode_id: epUuid,
            assessment_type: 'clinical',
            overall_risk_level: template.level,
            suicide_risk: template.suicide,
            self_harm_risk: template.selfHarm,
            harm_to_others_risk: false,
            absconding_risk: false,
            vulnerability_risk: false,
            protective_factors: template.protective,
            risk_narrative: template.narrative,
            risk_management_plan:
              'Monitor weekly, continue current medication, review with team lead in 4 weeks.',
            safety_plan_in_place: template.safetyPlan,
            safety_plan_summary: template.safetySummary,
            assessed_by_id: assessedById,
            assessment_date: template.assessmentDate,
            review_date: template.reviewDate,
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

export async function runRiskAssessmentsStep(
  knex: Knex,
): Promise<GeneratorResult> {
  const { rows } = buildRiskAssessments();
  return upsertById(knex, 'risk_assessments', rows);
}
