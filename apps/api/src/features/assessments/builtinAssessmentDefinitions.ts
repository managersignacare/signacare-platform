import type {
  DiagnosisCategory,
  RaterType,
} from '@signacare/shared';
import { resolveScaleByTemplateName } from '@signacare/shared';
import {
  buildLikertScale,
  descriptor,
  FIVE_POINT_SEVERITY_0_4,
  SEVEN_POINT_CLINICAL,
  type BuiltinAssessmentTemplate,
} from './builtinAssessmentDefinitionBuilders';
import { SELF_RATED_BUILTIN_RATING_SCALE_DEFINITIONS } from './builtinSelfRatedAssessmentDefinitions';
import {
  filterTemplates,
  type FilterTemplatesOptions,
  type TemplateRowLike,
} from './assessmentRegistry';

export const BUILTIN_ASSESSMENT_TEMPLATE_ID_PREFIX = 'builtin:' as const;

export interface AvailableBuiltinAssessmentDefinition {
  id: string;
  templateId: string | null;
  slug: string;
  name: string;
  raterType: RaterType;
  diagnosisCategory?: DiagnosisCategory;
  description: string | null;
  content: unknown;
  source: 'builtin' | 'clinic';
}

interface BuiltinAssessmentTemplateRow extends TemplateRowLike {
  builtinSlug: string;
}

export const STALE_LEGACY_SCALE_NAMES = [
  'BPRS (Brief Psychiatric Rating Scale)',
  'CGI (Clinical Global Impression)',
  'GAD-7 (Generalised Anxiety Disorder)',
  'LSP-16 (Life Skills Profile)',
  'PHQ-9 (Patient Health Questionnaire)',
  'HoNOS (Health of the Nation Outcome Scales)',
  'HoNOS 65+ (Older Persons)',
  'HoNOSCA (Child and Adolescent)',
  'K10 (Kessler Psychological Distress Scale)',
  'K10+ (Kessler Psychological Distress Scale)',
  'BASIS-32 (Behaviour and Symptom Identification Scale)',
] as const;

const CLINICIAN_RATED_BUILTIN_RATING_SCALE_DEFINITIONS: readonly BuiltinAssessmentTemplate[] = [
  buildLikertScale({
    name: 'HAM-D 17 (Hamilton Depression Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Clinician-rated depression severity',
    instruction: 'Clinician-rated depression interview over the past week.',
    items: ['Depressed mood', 'Feelings of guilt', 'Suicide', 'Insomnia early', 'Insomnia middle', 'Insomnia late', 'Work and activities', 'Retardation', 'Agitation', 'Anxiety psychic', 'Anxiety somatic', 'Somatic symptoms gastrointestinal', 'Somatic symptoms general', 'Genital symptoms', 'Hypochondriasis', 'Loss of weight', 'Insight'],
    min: 0,
    max: 4,
    options: ['0', '1', '2', '3', '4'],
    totalLabel: 'Total Score (0-52)',
    totalRanges: [
      { min: 0, max: 7, label: 'Normal' },
      { min: 8, max: 13, label: 'Mild depression' },
      { min: 14, max: 18, label: 'Moderate depression' },
      { min: 19, max: 22, label: 'Severe depression' },
      { min: 23, max: 52, label: 'Very severe depression' },
    ],
  }),
  buildLikertScale({
    name: 'HAM-A (Hamilton Anxiety Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Clinician-rated anxiety severity',
    instruction: 'Rate severity of each anxiety symptom cluster over the past week.',
    items: ['Anxious mood', 'Tension', 'Fears', 'Insomnia', 'Intellectual (cognitive)', 'Depressed mood', 'Somatic muscular', 'Somatic sensory', 'Cardiovascular symptoms', 'Respiratory symptoms', 'Gastrointestinal symptoms', 'Genitourinary symptoms', 'Autonomic symptoms', 'Behavior at interview'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score (0-56)',
    totalRanges: [
      { min: 0, max: 17, label: 'Mild severity' },
      { min: 18, max: 24, label: 'Mild to moderate severity' },
      { min: 25, max: 30, label: 'Moderate to severe' },
      { min: 31, max: 56, label: 'Severe anxiety' },
    ],
  }),
  buildLikertScale({
    name: 'MADRS (Montgomery-Åsberg Depression Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Depression severity',
    instruction: 'Clinician-rated depression severity (0 to 6 each item).',
    items: ['Apparent sadness', 'Reported sadness', 'Inner tension', 'Reduced sleep', 'Reduced appetite', 'Concentration difficulties', 'Lassitude', 'Inability to feel', 'Pessimistic thoughts', 'Suicidal thoughts'],
    min: 0,
    max: 6,
    options: ['0', '1', '2', '3', '4', '5', '6'],
    totalLabel: 'Total Score (0-60)',
    totalRanges: [
      { min: 0, max: 6, label: 'Normal/symptom absent' },
      { min: 7, max: 19, label: 'Mild depression' },
      { min: 20, max: 34, label: 'Moderate depression' },
      { min: 35, max: 60, label: 'Severe depression' },
    ],
  }),
  buildLikertScale({
    name: 'YMRS (Young Mania Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Mania severity',
    instruction: 'Clinician-rated mania severity over the last 48 hours.',
    items: ['Elevated mood', 'Increased motor activity/energy', 'Sexual interest', 'Sleep', 'Irritability', 'Speech (rate and amount)', 'Language-thought disorder', 'Content', 'Disruptive-aggressive behavior', 'Appearance', 'Insight'],
    min: 0,
    max: 8,
    options: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
    totalLabel: 'Total Score (0-60)',
    totalRanges: [
      { min: 0, max: 12, label: 'Remission/minimal symptoms' },
      { min: 13, max: 19, label: 'Subthreshold mania' },
      { min: 20, max: 25, label: 'Mild mania' },
      { min: 26, max: 37, label: 'Moderate mania' },
      { min: 38, max: 60, label: 'Severe mania' },
    ],
  }),
  buildLikertScale({
    name: 'BPRS-24 (Brief Psychiatric Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Psychosis and global symptom burden',
    instruction: 'Rate each symptom severity from 1 to 7 using interview and observation.',
    items: ['Somatic concern', 'Anxiety', 'Depression', 'Suicidality', 'Guilt', 'Hostility', 'Elevated mood', 'Grandiosity', 'Suspiciousness', 'Hallucinations', 'Unusual thought content', 'Bizarre behavior', 'Self-neglect', 'Disorientation', 'Conceptual disorganization', 'Blunted affect', 'Emotional withdrawal', 'Motor retardation', 'Tension', 'Uncooperativeness', 'Excitement', 'Distractibility', 'Motor hyperactivity', 'Mannerisms/posturing'],
    min: 1,
    max: 7,
    options: SEVEN_POINT_CLINICAL,
    totalLabel: 'Total Score (24-168)',
  }),
  buildLikertScale({
    name: 'PANSS (Positive and Negative Syndrome Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Schizophrenia spectrum severity',
    instruction: 'Rate each PANSS item from 1 to 7.',
    items: ['P1 Delusions', 'P2 Conceptual disorganization', 'P3 Hallucinatory behavior', 'P4 Excitement', 'P5 Grandiosity', 'P6 Suspiciousness/persecution', 'P7 Hostility', 'N1 Blunted affect', 'N2 Emotional withdrawal', 'N3 Poor rapport', 'N4 Passive/apathetic social withdrawal', 'N5 Difficulty in abstract thinking', 'N6 Lack of spontaneity', 'N7 Stereotyped thinking', 'G1 Somatic concern', 'G2 Anxiety', 'G3 Guilt feelings', 'G4 Tension', 'G5 Mannerisms and posturing', 'G6 Depression', 'G7 Motor retardation', 'G8 Uncooperativeness', 'G9 Unusual thought content', 'G10 Disorientation', 'G11 Poor attention', 'G12 Lack of judgment and insight', 'G13 Disturbance of volition', 'G14 Poor impulse control', 'G15 Preoccupation', 'G16 Active social avoidance'],
    min: 1,
    max: 7,
    options: SEVEN_POINT_CLINICAL,
    subscales: [
      { label: 'Positive Subscale (P1-P7)', itemNumbers: [1, 2, 3, 4, 5, 6, 7] },
      { label: 'Negative Subscale (N1-N7)', itemNumbers: [8, 9, 10, 11, 12, 13, 14] },
      { label: 'General Psychopathology Subscale (G1-G16)', itemNumbers: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] },
    ],
    totalLabel: 'Total Score (30-210)',
  }),
  buildLikertScale({
    name: 'AIMS (Abnormal Involuntary Movement Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Tardive dyskinesia / movement disorder monitoring',
    instruction: 'Rate each observed involuntary movement item from 0 to 4.',
    items: ['Facial and oral movements: muscles of facial expression', 'Facial and oral movements: lips/perioral area', 'Facial and oral movements: jaw', 'Facial and oral movements: tongue', 'Extremity movements: upper', 'Extremity movements: lower', 'Trunk movements', 'Global severity of abnormal movements', 'Incapacitation due to abnormal movements', 'Patient awareness/distress of abnormal movements'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score',
  }),
  buildLikertScale({
    name: 'SAS (Simpson-Angus Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Extrapyramidal side effects',
    instruction: 'Rate each EPS sign from 0 (normal) to 4 (extreme).',
    items: ['Gait', 'Arm dropping', 'Shoulder shaking', 'Elbow rigidity', 'Wrist rigidity', 'Leg pendulousness', 'Head dropping', 'Glabellar tap', 'Tremor', 'Salivation'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Mean Score (sum/10)',
    subscales: [
      {
        label: 'Mean EPS Score',
        itemNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        formula: 'mean',
        ranges: [
          { min: 0, max: 0.3, label: 'Normal range' },
          { min: 0.31, max: 4, label: 'Clinically significant EPS' },
        ],
      },
    ],
  }),
  buildLikertScale({
    name: 'CGI (Clinical Global Impression - Severity/Improvement)',
    respondentType: 'clinician',
    ageGroup: 'General',
    focus: 'Global clinical status',
    instruction: 'Rate severity and improvement from 1 to 7.',
    items: ['CGI-Severity (1=Normal, 7=Among the most extremely ill)', 'CGI-Improvement (1=Very much improved, 7=Very much worse)'],
    min: 1,
    max: 7,
    options: ['1', '2', '3', '4', '5', '6', '7'],
    totalLabel: 'Combined CGI Score',
  }),
  buildLikertScale({
    name: 'GAF (Global Assessment of Functioning)',
    respondentType: 'clinician',
    ageGroup: 'General',
    focus: 'Global functioning',
    instruction: 'Rate current functioning on a continuum from 1 to 100.',
    items: ['Current GAF score'],
    min: 1,
    max: 100,
    options: [],
    totalLabel: 'GAF Score (1-100)',
    totalRanges: [
      { min: 1, max: 20, label: 'Severe dysfunction / danger range' },
      { min: 21, max: 40, label: 'Major impairment' },
      { min: 41, max: 60, label: 'Moderate symptoms/impairment' },
      { min: 61, max: 80, label: 'Mild/transient symptoms' },
      { min: 81, max: 100, label: 'Minimal symptoms / superior functioning' },
    ],
  }),
  {
    name: 'MMSE (Mini-Mental State Examination)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult/General', 'Cognitive screening'),
    content: [
      { type: 'heading', text: 'MMSE (Mini-Mental State Examination)' },
      { type: 'instruction', text: 'Score each domain according to standard MMSE administration.' },
      { type: 'likert', label: 'Orientation to time (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Orientation to place (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Registration (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Attention/calculation (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Recall (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Language naming (0-2)', min: 0, max: 2, options: [] },
      { type: 'likert', label: 'Repetition (0-1)', min: 0, max: 1, options: [] },
      { type: 'likert', label: '3-stage command (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Read and obey (0-1)', min: 0, max: 1, options: [] },
      { type: 'likert', label: 'Write a sentence (0-1)', min: 0, max: 1, options: [] },
      { type: 'likert', label: 'Copy intersecting pentagons (0-1)', min: 0, max: 1, options: [] },
      {
        type: 'score',
        label: 'Total MMSE Score (0-30)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 17, label: 'Severe cognitive impairment' },
          { min: 18, max: 23, label: 'Mild cognitive impairment range' },
          { min: 24, max: 30, label: 'Cognition broadly intact' },
        ],
      },
    ],
  },
  {
    name: 'MoCA (Montreal Cognitive Assessment)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult/General', 'Mild cognitive impairment screening'),
    content: [
      { type: 'heading', text: 'MoCA (Montreal Cognitive Assessment)' },
      { type: 'instruction', text: 'Score each domain according to standard MoCA administration.' },
      { type: 'likert', label: 'Visuospatial/executive (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Naming (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Attention (0-6)', min: 0, max: 6, options: [] },
      { type: 'likert', label: 'Language (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Abstraction (0-2)', min: 0, max: 2, options: [] },
      { type: 'likert', label: 'Delayed recall (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Orientation (0-6)', min: 0, max: 6, options: [] },
      { type: 'likert', label: 'Education correction (+1 if <=12 years education)', min: 0, max: 1, options: [] },
      {
        type: 'score',
        label: 'Total MoCA Score (0-30)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 17, label: 'Moderate/severe impairment range' },
          { min: 18, max: 25, label: 'Mild impairment range' },
          { min: 26, max: 30, label: 'Normal range' },
        ],
      },
    ],
  },
] as const;

export const BUILTIN_RATING_SCALE_DEFINITIONS: readonly BuiltinAssessmentTemplate[] = [
  ...SELF_RATED_BUILTIN_RATING_SCALE_DEFINITIONS,
  ...CLINICIAN_RATED_BUILTIN_RATING_SCALE_DEFINITIONS,
] as const;

export function makeBuiltinAssessmentTemplateId(slug: string): string {
  return `${BUILTIN_ASSESSMENT_TEMPLATE_ID_PREFIX}${slug}`;
}

const BUILTIN_RATING_SCALE_TEMPLATE_ROWS: readonly BuiltinAssessmentTemplateRow[] =
  BUILTIN_RATING_SCALE_DEFINITIONS.map((definition) => {
    const resolved = resolveScaleByTemplateName(definition.name);
    if (!resolved || resolved.family !== 'rating_scale') {
      throw new Error(
        `Builtin assessment definition "${definition.name}" does not resolve to a rating_scale registry entry`,
      );
    }
    return {
      id: makeBuiltinAssessmentTemplateId(resolved.slug),
      builtinSlug: resolved.slug,
      name: definition.name,
      type: definition.type,
      category: definition.category,
      description: definition.description,
      content: definition.content,
    };
  });

export function getBuiltinRatingScaleTemplateRows(): readonly BuiltinAssessmentTemplateRow[] {
  return BUILTIN_RATING_SCALE_TEMPLATE_ROWS;
}

export function listAvailableRatingScaleDefinitions(
  clinicTemplates: readonly TemplateRowLike[],
  options: FilterTemplatesOptions,
): { matched: AvailableBuiltinAssessmentDefinition[]; unknownCount: number } {
  const clinicResult = filterTemplates(clinicTemplates, options);
  const clinicTemplateIdBySlug = new Map<string, string>();
  for (const item of clinicResult.matched) {
    if (!item.slug) continue;
    if (!clinicTemplateIdBySlug.has(item.slug)) {
      clinicTemplateIdBySlug.set(item.slug, String(item.template.id));
    }
  }

  const builtinResult = filterTemplates(BUILTIN_RATING_SCALE_TEMPLATE_ROWS, options);
  const matched = builtinResult.matched.map((item) => {
    const templateId = item.slug ? (clinicTemplateIdBySlug.get(item.slug) ?? null) : null;
    return {
      id: String(item.template.id),
      templateId,
      slug: item.slug!,
      name: item.displayName ?? item.template.name,
      raterType: item.raterType!,
      diagnosisCategory: item.diagnosisCategory,
      description: item.template.description ?? null,
      content: item.template.content,
      source: templateId ? 'clinic' : 'builtin',
    } satisfies AvailableBuiltinAssessmentDefinition;
  });

  return { matched, unknownCount: clinicResult.unknownCount };
}

export function findAvailableRatingScaleDefinition(
  clinicTemplates: readonly TemplateRowLike[],
  definitionId: string,
  options: FilterTemplatesOptions,
): AvailableBuiltinAssessmentDefinition | undefined {
  const { matched } = listAvailableRatingScaleDefinitions(clinicTemplates, options);
  return matched.find((item) => item.id === definitionId || item.templateId === definitionId);
}
