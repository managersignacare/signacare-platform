import type { ContextDocumentType, ContextFactDomain } from '@signacare/shared';
// @jsonb-extraction-exempt: internal clinical-context reader builds derived prompt facts and does not expose raw table rows as API responses.

import { db } from '../../../db/db';
import type { EpisodesRow } from '../../../db/types/episodes';
import type { ScribeConsentsRow } from '../../../db/types/scribe_consents';
import type { SafetyPlansRow } from '../../../db/types/safety_plans';
import type { AllergyRow } from '../../allergies/allergyRepository';
import type { MedicationRow } from '../../medications/medicationRepository';
import type { RiskAssessmentRow } from '../../risk/riskRepository';
import { getContextPolicy, type ContextPolicy } from './contextPolicyRegistry';
import {
  createFact,
  createRequiredSentinelFact,
  loadAnchorPatient,
  noData,
  parseJsonRecord,
  toIsoString,
  type MinimalAnchorPatient,
  type SourceReaderContext,
  type SourceReaderResult,
} from './contextReaderSupport';
import {
  readFullEpisodeArc,
  readRecentAppointments,
  readRecentAssessments,
  readRecentCorrespondence,
  readRecentNotes,
  readRecentPathology,
  readRecentReview,
  readTreatmentPathway,
  readUnavailableOverlay,
} from './contextHistoricalReaders';

const OPEN_EPISODE_STATUSES = ['open', 'active', 'admitted'] as const;
const REQUIRED_SENTINEL_DOMAINS = new Set<ContextFactDomain>([
  'active_episodes',
  'active_medications',
  'allergies',
  'risk_assessment',
  'safety_plan',
  'consent_state',
  'care_team',
]);

export interface ReadClinicalContextFactsInput {
  readonly clinicId: string;
  readonly patientId: string;
  readonly episodeId?: string;
  readonly builtAt: string;
  readonly documentType: ContextDocumentType;
  readonly lookbackDaysOverride?: number;
  readonly requestedOptionalDomains?: readonly ContextFactDomain[];
}

export interface ReadClinicalContextFactsResult {
  readonly anchorPatient: MinimalAnchorPatient;
  readonly facts: ReturnType<typeof createFact>[];
  readonly preExcluded: ReturnType<typeof noData>[];
}

async function readDemographics(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  return {
    facts: [
      createFact({
        domain: 'demographics',
        tier: 'A',
        trustLevel: 'authoritative',
        sourceTable: 'patients',
        sourceId: ctx.patient.id,
        sourceDate: toIsoString(ctx.patient.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          givenName: ctx.patient.given_name,
          familyName: ctx.patient.family_name,
          preferredName: ctx.patient.preferred_name,
          dateOfBirth: ctx.patient.date_of_birth,
          emrNumber: ctx.patient.emr_number,
        },
      }),
    ],
    excluded: [],
  };
}

async function readActiveEpisodes(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const rows = await db<EpisodesRow>('episodes')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .whereNull('deleted_at')
    .whereIn('status', OPEN_EPISODE_STATUSES as unknown as string[])
    .modify((query) => {
      if (ctx.episodeId) query.where('id', ctx.episodeId);
    })
    .orderBy('start_date', 'desc');

  if (rows.length === 0) {
    return {
      facts: [
        createRequiredSentinelFact('active_episodes', ctx.patient, ctx.builtAt, {
          status: 'no_open_episode_found',
        }),
      ],
      excluded: [],
    };
  }

  return {
    facts: rows.map((row: EpisodesRow) =>
      createFact({
        domain: 'active_episodes',
        tier: 'A',
        trustLevel: 'authoritative',
        sourceTable: 'episodes',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          title: row.title,
          episodeNumber: row.episode_number,
          episodeType: row.episode_type,
          status: row.status,
          presentingProblem: row.presenting_problem,
          primaryDiagnosis: row.primary_diagnosis,
          specialtyCode: row.specialty_code,
          startDate: row.start_date,
          endDate: row.end_date ?? null,
          teamId: row.team_id ?? null,
          primaryClinicianId: row.primary_clinician_id ?? null,
          keyWorkerId: row.key_worker_id ?? null,
        },
      }),
    ),
    excluded: [],
  };
}

async function readActiveMedications(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const rows = await db<MedicationRow>('patient_medications')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId, status: 'active' })
    .whereNull('deleted_at')
    .orderBy('start_date', 'desc')
    .orderBy('created_at', 'desc')
    .limit(50);

  if (rows.length === 0) {
    return {
      facts: [
        createRequiredSentinelFact('active_medications', ctx.patient, ctx.builtAt, {
          medications: [],
          status: 'no_active_medications_on_file',
        }),
      ],
      excluded: [],
    };
  }

  return {
    facts: rows.map((row: MedicationRow) =>
      createFact({
        domain: 'active_medications',
        tier: 'A',
        trustLevel: 'authoritative',
        sourceTable: 'patient_medications',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          drugLabel: row.drug_label,
          genericName: row.generic_name,
          brandName: row.brand_name,
          dose: row.dose,
          doseUnit: row.dose_unit,
          route: row.route,
          frequency: row.frequency,
          instructions: row.instructions,
          indication: row.indication,
          startDate: row.start_date,
          isRegular: row.is_regular,
          isPrn: row.is_prn,
          isLai: row.is_lai,
          category: row.category,
          prescribedBySpecialtyCode: row.prescribed_by_specialty_code,
        },
        citationRequired: true,
      }),
    ),
    excluded: [],
  };
}

async function readAllergies(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const rows = await db<AllergyRow>('patient_allergies')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId, status: 'active' })
    .whereNull('deleted_at')
    .orderBy('recorded_at', 'desc')
    .limit(30);

  if (rows.length === 0) {
    return {
      facts: [
        createRequiredSentinelFact('allergies', ctx.patient, ctx.builtAt, {
          allergies: [],
          status: 'no_active_allergies_on_file',
        }),
      ],
      excluded: [],
    };
  }

  return {
    facts: rows.map((row: AllergyRow) =>
      createFact({
        domain: 'allergies',
        tier: 'A',
        trustLevel: 'authoritative',
        sourceTable: 'patient_allergies',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          allergen: row.allergen,
          allergenType: row.allergen_type,
          reaction: row.reaction,
          severity: row.severity,
          notes: row.notes,
          recordedAt: row.recorded_at,
        },
      }),
    ),
    excluded: [],
  };
}

async function readRiskAssessment(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const row = await db<RiskAssessmentRow>('risk_assessments')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .whereNull('deleted_at')
    .orderBy('assessment_date', 'desc')
    .first();

  if (!row) {
    return {
      facts: [
        createRequiredSentinelFact('risk_assessment', ctx.patient, ctx.builtAt, {
          status: 'no_risk_assessment_on_file',
        }),
      ],
      excluded: [],
    };
  }

  return {
    facts: [
      createFact({
        domain: 'risk_assessment',
        tier: 'A',
        trustLevel: 'authoritative',
        sourceTable: 'risk_assessments',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          assessmentType: row.assessment_type,
          overallRiskLevel: row.overall_risk_level,
          totalScore: row.total_score,
          scoreBand: row.score_band,
          suicideRisk: row.suicide_risk,
          selfHarmRisk: row.self_harm_risk,
          harmToOthersRisk: row.harm_to_others_risk,
          abscondingRisk: row.absconding_risk,
          vulnerabilityRisk: row.vulnerability_risk,
          protectiveFactors: row.protective_factors,
          riskNarrative: row.risk_narrative,
          riskManagementPlan: row.risk_management_plan,
          safetyPlanInPlace: row.safety_plan_in_place,
          safetyPlanSummary: row.safety_plan_summary,
          assessmentDate: row.assessment_date,
          reviewDate: row.review_date,
        },
        citationRequired: true,
      }),
    ],
    excluded: [],
  };
}

async function readSafetyPlan(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const row = await db<SafetyPlansRow>('safety_plans')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .whereIn('status', ['active', 'signed'])
    .orderBy('created_at', 'desc')
    .first();

  if (!row) {
    return {
      facts: [
        createRequiredSentinelFact('safety_plan', ctx.patient, ctx.builtAt, {
          status: 'no_active_safety_plan_on_file',
        }),
      ],
      excluded: [],
    };
  }

  const content = parseJsonRecord(row.content);
  return {
    facts: [
      createFact({
        domain: 'safety_plan',
        tier: 'A',
        trustLevel: 'authoritative',
        sourceTable: 'safety_plans',
        sourceId: row.id,
        sourceDate: toIsoString(row.updated_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          status: row.status,
          warningSigns: content?.['warning_signs'] ?? content?.['warningSign'] ?? null,
          copingStrategies: content?.['coping_strategies'] ?? content?.['copingStrategies'] ?? null,
          peopleToContact: content?.['people_to_contact'] ?? content?.['peopleToContact'] ?? null,
          professionalsToContact:
            content?.['professionals_to_contact'] ?? content?.['professionalsToContact'] ?? null,
          emergencyServices:
            content?.['emergency_services'] ?? content?.['emergencyServices'] ?? null,
          makingEnvironmentSafe:
            content?.['making_environment_safe'] ?? content?.['makingEnvironmentSafe'] ?? null,
          reasonsForLiving: content?.['reasons_for_living'] ?? content?.['reasonsForLiving'] ?? null,
          reviewDate: content?.['review_date'] ?? content?.['reviewDate'] ?? null,
        },
      }),
    ],
    excluded: [],
  };
}

async function readConsentState(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const row = await db<ScribeConsentsRow>('scribe_consents')
    .where({ clinic_id: ctx.clinicId, patient_id: ctx.patientId })
    .orderBy('attested_at', 'desc')
    .orderBy('created_at', 'desc')
    .first();

  if (!row) {
    return {
      facts: [
        createRequiredSentinelFact('consent_state', ctx.patient, ctx.builtAt, {
          status: 'missing',
        }),
      ],
      excluded: [],
    };
  }

  const status = row.revoked_at ? 'revoked' : row.attested_at ? 'active' : 'missing_attestation';

  return {
    facts: [
      createFact({
        domain: 'consent_state',
        tier: 'A',
        trustLevel: 'authoritative',
        sourceTable: 'scribe_consents',
        sourceId: row.id,
        sourceDate: toIsoString(row.attested_at ?? row.created_at, ctx.builtAt),
        builtAt: ctx.builtAt,
        payload: {
          status,
          mode: row.mode,
          attestedAt: row.attested_at ?? null,
          revokedAt: row.revoked_at ?? null,
          revokeReason: row.revoke_reason ?? null,
        },
      }),
    ],
    excluded: [],
  };
}

async function readCareTeam(ctx: SourceReaderContext): Promise<SourceReaderResult> {
  const teamAnchor = await db('episodes as e')
    // @fk-join-exempt: episodes.team_id is a legacy org_unit pointer without a DB FK constraint in the current schema.
    .leftJoin('org_units as ou', 'ou.id', 'e.team_id')
    .leftJoin('staff as primary_staff', 'primary_staff.id', 'e.primary_clinician_id')
    .leftJoin('staff as key_worker_staff', 'key_worker_staff.id', 'e.key_worker_id')
    .where('e.clinic_id', ctx.clinicId)
    .andWhere('e.patient_id', ctx.patientId)
    .whereNull('e.deleted_at')
    .whereIn('e.status', OPEN_EPISODE_STATUSES as unknown as string[])
    .orderBy('e.created_at', 'desc')
    .select(
      'e.id',
      'e.team_id',
      'e.primary_clinician_id',
      'e.key_worker_id',
      'ou.name as team_name',
      db.raw("COALESCE(primary_staff.given_name || ' ' || primary_staff.family_name, '') as primary_clinician_name"),
      db.raw("COALESCE(key_worker_staff.given_name || ' ' || key_worker_staff.family_name, '') as key_worker_name"),
      'e.updated_at',
    )
    .first();

  const assignmentAnchor = !teamAnchor
    ? await db('patient_team_assignments as pta')
      .join('org_units as ou', 'ou.id', 'pta.org_unit_id')
      .leftJoin('staff as assignment_staff', 'assignment_staff.id', 'pta.primary_clinician_id')
      .where('pta.patient_id', ctx.patientId)
      .andWhere('ou.clinic_id', ctx.clinicId)
      .andWhere('pta.is_active', true)
      .orderBy('pta.updated_at', 'desc')
      .select(
        'pta.id',
        'pta.org_unit_id as team_id',
        'pta.primary_clinician_id',
        'ou.name as team_name',
        db.raw("COALESCE(assignment_staff.given_name || ' ' || assignment_staff.family_name, '') as primary_clinician_name"),
        'pta.updated_at',
      )
      .first()
    : null;

  const teamId = (teamAnchor?.team_id as string | null | undefined)
    ?? (assignmentAnchor?.team_id as string | null | undefined)
    ?? null;

  if (!teamAnchor && !assignmentAnchor) {
    return {
      facts: [
        createRequiredSentinelFact('care_team', ctx.patient, ctx.builtAt, {
          status: 'unassigned',
        }),
      ],
      excluded: [],
    };
  }

  const mdtMembers = teamId
    ? await db('staff_role_assignments as sra')
      .join('staff as staff_member', 'staff_member.id', 'sra.staff_id')
      .join('clinical_roles as cr', 'cr.id', 'sra.clinical_role_id')
      .where('sra.clinic_id', ctx.clinicId)
      .andWhere('sra.org_unit_id', teamId)
      .andWhere('sra.is_active', true)
      .select(
        'sra.staff_id',
        'sra.role_type',
        'cr.name as clinical_role_name',
        db.raw("COALESCE(staff_member.given_name || ' ' || staff_member.family_name, '') as staff_name"),
      )
    : [];

  const sourceId = String(teamAnchor?.id ?? assignmentAnchor?.id);
  const sourceDate = toIsoString(
    (teamAnchor?.updated_at as string | Date | null | undefined)
      ?? (assignmentAnchor?.updated_at as string | Date | null | undefined)
      ?? ctx.patient.updated_at,
    ctx.builtAt,
  );

  return {
    facts: [
      createFact({
        domain: 'care_team',
        tier: 'A',
        trustLevel: 'derived',
        sourceTable: teamAnchor ? 'episodes' : 'patient_team_assignments',
        sourceId,
        sourceDate,
        builtAt: ctx.builtAt,
        payload: {
          teamId,
          teamName: (teamAnchor?.team_name as string | null | undefined)
            ?? (assignmentAnchor?.team_name as string | null | undefined)
            ?? null,
          primaryClinicianId: (teamAnchor?.primary_clinician_id as string | null | undefined)
            ?? (assignmentAnchor?.primary_clinician_id as string | null | undefined)
            ?? null,
          primaryClinicianName: (teamAnchor?.primary_clinician_name as string | null | undefined)
            ?? (assignmentAnchor?.primary_clinician_name as string | null | undefined)
            ?? null,
          keyWorkerId: (teamAnchor?.key_worker_id as string | null | undefined) ?? null,
          keyWorkerName: (teamAnchor?.key_worker_name as string | null | undefined) ?? null,
          mdtMembers: mdtMembers.map((row: {
            staff_id: string;
            staff_name: string;
            role_type: string | null;
            clinical_role_name: string;
          }) => ({
            staffId: row.staff_id,
            staffName: row.staff_name,
            roleType: row.role_type,
            clinicalRoleName: row.clinical_role_name,
          })),
        },
      }),
    ],
    excluded: [],
  };
}

const DOMAIN_READERS: Record<
  ContextFactDomain,
  (ctx: SourceReaderContext) => Promise<SourceReaderResult>
> = {
  demographics: readDemographics,
  active_episodes: readActiveEpisodes,
  active_medications: readActiveMedications,
  allergies: readAllergies,
  risk_assessment: readRiskAssessment,
  safety_plan: readSafetyPlan,
  lai_schedule: async () => ({ facts: [], excluded: [noData('lai_schedule')] }),
  clozapine_state: async () => ({ facts: [], excluded: [noData('clozapine_state')] }),
  mha_orders: async () => ({ facts: [], excluded: [noData('mha_orders')] }),
  tasks: async () => ({ facts: [], excluded: [noData('tasks')] }),
  care_team: readCareTeam,
  consent_state: readConsentState,
  recent_notes: readRecentNotes,
  recent_pathology: readRecentPathology,
  recent_assessments: readRecentAssessments,
  recent_review: readRecentReview,
  treatment_pathway: readTreatmentPathway,
  recent_appointments: readRecentAppointments,
  outstanding_referrals: async () => ({ facts: [], excluded: [noData('outstanding_referrals')] }),
  recent_correspondence: readRecentCorrespondence,
  full_episode_arc: readFullEpisodeArc,
  historical_medications: async () => ({ facts: [], excluded: [noData('historical_medications')] }),
  forensic_history: async () => ({ facts: [], excluded: [noData('forensic_history')] }),
  family_social: async () => ({ facts: [], excluded: [noData('family_social')] }),
  capacity_assessments: async () => ({ facts: [], excluded: [noData('capacity_assessments')] }),
  advance_directives: async () => ({ facts: [], excluded: [noData('advance_directives')] }),
  risk_history: async () => ({ facts: [], excluded: [noData('risk_history')] }),
  bed_board: async () => ({ facts: [], excluded: [noData('bed_board')] }),
  reading_level: async () => readUnavailableOverlay('reading_level'),
  preferred_language: async () => readUnavailableOverlay('preferred_language'),
  communication_preference: async () => ({ facts: [], excluded: [noData('communication_preference')] }),
  clinic_letterhead: async () => ({ facts: [], excluded: [noData('clinic_letterhead')] }),
  clinician_style_hint: async () => ({ facts: [], excluded: [noData('clinician_style_hint')] }),
};

function listRequestedDomains(
  policy: ContextPolicy,
  requestedOptionalDomains?: readonly ContextFactDomain[],
): ContextFactDomain[] {
  const requestedOptional = (requestedOptionalDomains ?? []).filter((domain) =>
    policy.optional.includes(domain),
  );
  return [...policy.required, ...policy.recommended, ...requestedOptional];
}

export async function readClinicalContextFacts(
  input: ReadClinicalContextFactsInput,
): Promise<ReadClinicalContextFactsResult> {
  const policy = getContextPolicy(input.documentType);
  const lookbackDays = input.lookbackDaysOverride ?? policy.defaultLookbackDays;
  const anchorPatient = await loadAnchorPatient(input.clinicId, input.patientId);
  const ctx: SourceReaderContext = {
    clinicId: input.clinicId,
    patientId: input.patientId,
    episodeId: input.episodeId,
    builtAt: input.builtAt,
    lookbackDays,
    patient: anchorPatient,
  };

  const domains = listRequestedDomains(policy, input.requestedOptionalDomains);
  const results = await Promise.all(domains.map(async (domain) => DOMAIN_READERS[domain](ctx)));
  const facts = results.flatMap((result) => result.facts);
  const preExcluded = results.flatMap((result) => result.excluded);

  for (const domain of policy.required) {
    if (!facts.some((fact) => fact.domain === domain) && REQUIRED_SENTINEL_DOMAINS.has(domain)) {
      facts.push(
        createRequiredSentinelFact(domain, anchorPatient, input.builtAt, {
          status: 'reader_returned_no_fact',
          domain,
        }),
      );
    }
  }

  return {
    anchorPatient,
    facts,
    preExcluded,
  };
}
