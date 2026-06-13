import type {
  DiagnosisCategory,
  RaterType,
} from '@signacare/shared';
import { resolveScaleByTemplateName } from '@signacare/shared';
import {
  buildLikertScale,
  buildYesNoScale,
  descriptor,
  FIVE_POINT_EXTENT,
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
        // P-CLAUDE-LANE 4B: tablet capture of the intersecting-pentagons
        // figure. The 0-1 likert above remains the score item; this
        // drawing field carries the clinical artefact for later review.
        // Stored as a DrawingPayload (see
        // packages/shared/src/drawingPayload.ts); not scorable
        // (isScorableField excludes 'drawing').
        type: 'drawing',
        label: 'Intersecting pentagons — copy the figure (tablet capture)',
      },
      {
        // Standard Folstein MMSE interpretation thresholds. Bands are
        // CLOSED intervals [min, max] inclusive at both ends. These bands
        // mirror the canonical scoring SSoT at
        // packages/shared/src/assessmentScoring.ts (slug 'mmse'); the
        // regression test in builtinAssessmentDefinitions.test.ts pins
        // the alignment so the two surfaces cannot drift again.
        type: 'score',
        label: 'Total MMSE Score (0-30)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 9, label: 'Severe impairment' },
          { min: 10, max: 18, label: 'Moderate impairment' },
          { min: 19, max: 23, label: 'Mild impairment' },
          { min: 24, max: 30, label: 'Normal' },
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
      {
        // P-CLAUDE-LANE 4B: tablet capture of the visuospatial cube
        // copy item. The 0-5 visuospatial/executive likert above remains
        // the score item; this drawing field carries the clinical
        // artefact for later review. Stored as a DrawingPayload
        // (packages/shared/src/drawingPayload.ts); not scorable.
        type: 'drawing',
        label: 'Visuospatial — copy the cube (tablet capture)',
      },
      {
        // P-CLAUDE-LANE 4B: tablet capture of the clock-draw 11:10
        // item (executive function component of the visuospatial
        // subscore). The 0-5 visuospatial/executive likert above
        // remains the score item; this drawing field carries the
        // clinical artefact.
        type: 'drawing',
        label: 'Visuospatial — draw the clock showing 11:10 (tablet capture)',
      },
      { type: 'likert', label: 'Naming (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Attention (0-6)', min: 0, max: 6, options: [] },
      { type: 'likert', label: 'Language (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Abstraction (0-2)', min: 0, max: 2, options: [] },
      { type: 'likert', label: 'Delayed recall (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Orientation (0-6)', min: 0, max: 6, options: [] },
      { type: 'likert', label: 'Education correction (+1 if <=12 years education)', min: 0, max: 1, options: [] },
      {
        // Standard Nasreddine MoCA interpretation. The published cutoff
        // is ≥26/30 = within normal limits; <26/30 = below cognitive
        // threshold (clinical follow-up indicated). Bands are CLOSED
        // intervals [min, max] inclusive at both ends. These bands
        // mirror the canonical scoring SSoT at
        // packages/shared/src/assessmentScoring.ts (slug 'moca'); the
        // regression test in builtinAssessmentDefinitions.test.ts pins
        // the alignment so the two surfaces cannot drift again.
        type: 'score',
        label: 'Total MoCA Score (0-30)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 25, label: 'Below cognitive threshold' },
          { min: 26, max: 30, label: 'Normal' },
        ],
      },
    ],
  },
  // P-CLAUDE-LANE 4B/6: Mini-Cog (Borson et al., 2000) — 3-minute
  // primary-care cognitive screen. Two-item structure:
  //
  //   1. 3-word recall (clinician administers per the protocol; scores
  //      0-3, one point per word recalled after distraction).
  //   2. Clock Drawing Test (binary: 0 abnormal, 2 normal).
  //
  // Total 0-5. Cutoff ≤2 = positive screen (further workup indicated),
  // ≥3 = negative. The clock-drawing item carries a tablet-capture
  // drawing field adjacent to the 0-or-2 likert (the likert remains
  // the SCORED item; the drawing is the clinical artefact for later
  // review). Drawing field is non-scorable so the 0-5 total cannot be
  // perturbed.
  //
  // Bands mirror the canonical scoring SSoT at
  // packages/shared/src/assessmentScoring.ts (slug 'minicog'); the
  // regression test in builtinAssessmentDefinitions.test.ts pins the
  // alignment so the two surfaces cannot drift.
  {
    name: 'Mini-Cog (3-word recall + clock drawing)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult/General', 'Cognitive screening — primary care'),
    content: [
      { type: 'heading', text: 'Mini-Cog (3-word recall + clock drawing)' },
      { type: 'instruction', text: 'Administer per the standard Mini-Cog protocol. Score recall 0-3 (one point per word recalled after distraction). Score clock drawing 0 (abnormal) or 2 (normal).' },
      { type: 'likert', label: 'Three-word recall (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Clock drawing (0 abnormal / 2 normal)', min: 0, max: 2, options: [] },
      {
        type: 'drawing',
        label: 'Clock drawing — draw a clock face with numbers and set the hands to 11:10 (tablet capture)',
      },
      {
        type: 'score',
        label: 'Total Mini-Cog Score (0-5)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 2, label: 'Positive screen — further workup indicated' },
          { min: 3, max: 5, label: 'Negative screen' },
        ],
      },
    ],
  },
  // P-CLAUDE-LANE 4B/7: Standalone Clock Drawing Test scored by the
  // Shulman 6-band rubric (Shulman et al., 1993). Distinct from the
  // embedded clock items in MoCA + Mini-Cog: this is the standalone
  // instrument administered when the clinician wants to assess
  // visuospatial / executive function without running a full
  // cognitive battery. The single likert (0-5) carries the Shulman
  // grade; the drawing field captures the patient's actual figure
  // for review and longitudinal comparison. Drawing is non-scorable
  // (isScorableField excludes 'drawing') so the 0-5 total cannot be
  // perturbed.
  //
  // Bands mirror the canonical scoring SSoT at
  // packages/shared/src/assessmentScoring.ts (slug 'cdt-shulman');
  // the regression test in builtinAssessmentDefinitions.test.ts pins
  // the alignment so the two surfaces cannot drift.
  {
    name: 'CDT (Shulman Clock Drawing Test, 6-band)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult/General', 'Visuospatial / executive function — standalone clock'),
    content: [
      { type: 'heading', text: 'CDT (Shulman Clock Drawing Test, 6-band)' },
      { type: 'instruction', text: 'Ask the patient: "Draw a clock face with the numbers on it. Set the hands to 10 past 11." Score the result using the Shulman 6-band rubric (0-5). The tablet capture below preserves the patient\'s drawing for review.' },
      {
        type: 'drawing',
        label: 'Clock drawing — draw a clock face with the numbers and set the hands to 10 past 11 (tablet capture)',
      },
      { type: 'likert', label: 'Shulman grade (0-5)', min: 0, max: 5, options: [] },
      {
        type: 'score',
        label: 'Total CDT (Shulman) Score (0-5)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 0, label: 'No reasonable representation' },
          { min: 1, max: 1, label: 'Severe disorganization' },
          { min: 2, max: 2, label: 'Moderate visuospatial disorganization' },
          { min: 3, max: 3, label: 'Inaccurate representation of 10 past 11' },
          { min: 4, max: 4, label: 'Minor visuospatial errors' },
          { min: 5, max: 5, label: 'Perfect' },
        ],
      },
    ],
  },
  buildLikertScale({
    name: 'Altman Clinician-Rated Mania Scale',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Mania / hypomania symptom severity',
    instruction: 'Rate the severity of manic symptoms over the past week using interview and observation.',
    items: [
      'Elevated / expansive mood',
      'Increased self-confidence or grandiosity',
      'Reduced need for sleep',
      'Pressured speech / talkativeness',
      'Increased activity / psychomotor acceleration',
    ],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score (0-20)',
    totalRanges: [
      { min: 0, max: 5, label: 'Below mania screening threshold' },
      { min: 6, max: 9, label: 'Possible hypomania' },
      { min: 10, max: 14, label: 'Moderate mania symptom burden' },
      { min: 15, max: 20, label: 'High mania symptom burden' },
    ],
  }),
  buildLikertScale({
    name: 'ACSA (Amphetamine Cessation Symptom Assessment)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Amphetamine withdrawal / cessation symptom burden',
    instruction: 'Rate the severity of amphetamine cessation symptoms observed or reported during the current review period.',
    items: [
      'Craving for amphetamines',
      'Fatigue or reduced energy',
      'Hypersomnia / sleeping more than usual',
      'Vivid or unpleasant dreams',
      'Increased appetite',
      'Psychomotor slowing',
      'Anxiety / tension',
      'Irritability',
      'Low mood / dysphoria',
      'Anhedonia / reduced interest',
      'Poor concentration',
      'Restlessness',
      'Agitation',
      'Suspiciousness / paranoia',
      'Thoughts of self-harm',
      'Physical discomfort / aches',
    ],
    min: 0,
    max: 3,
    options: ['None (0)', 'Mild (1)', 'Moderate (2)', 'Severe (3)'],
    totalLabel: 'Total Score (0-48)',
  }),
  buildLikertScale({
    name: 'AUDIT (Alcohol Use Disorders Identification Test — Clinician Administered)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Alcohol use risk',
    instruction: 'Complete the AUDIT using interview data and collateral history where available.',
    items: [
      'How often does the person have a drink containing alcohol?',
      'How many standard drinks are taken on a typical drinking day?',
      'How often are 6 or more drinks taken on one occasion?',
      'How often are they unable to stop drinking once started?',
      'How often do they fail expected responsibilities because of drinking?',
      'How often is a morning drink needed after heavy drinking?',
      'How often is there guilt or remorse after drinking?',
      'How often can they not remember the night before because of drinking?',
      'Has anyone been injured because of the drinking?',
      'Has someone else expressed concern or suggested cutting down?',
    ],
    min: 0,
    max: 4,
    options: ['Never (0)', 'Monthly or less (1)', '2-4 times a month / sometimes (2)', 'Weekly / often (3)', 'Daily or almost daily / very often (4)'],
    totalLabel: 'Total Score (0-40)',
    totalRanges: [
      { min: 0, max: 7, label: 'Low risk' },
      { min: 8, max: 15, label: 'Hazardous use' },
      { min: 16, max: 19, label: 'Harmful use' },
      { min: 20, max: 40, label: 'Likely dependence' },
    ],
  }),
  buildLikertScale({
    name: 'ASSQ (Autism Spectrum Screening Questionnaire)',
    respondentType: 'clinician',
    ageGroup: 'Child/Adolescent',
    focus: 'Autism spectrum screening',
    instruction: 'Rate how true each social communication or restricted-interest item is for the child or adolescent.',
    items: [
      'Old-fashioned or precocious manner',
      'Regarded as different by other children',
      'Lives in an idiosyncratic world of special interests',
      'Accumulates facts on unusual topics',
      'Poor awareness of social cues',
      'Overly literal understanding of language',
      'Problems with reciprocal conversation',
      'One-sided communication style',
      'Difficulties making or keeping friends',
      'Limited or awkward facial expression',
      'Motor clumsiness or odd gait',
      'Unusual sensory sensitivities',
      'Insists on routines or sameness',
      'Becomes upset by change',
      'Repetitive questions or comments',
      'Peculiar or pedantic speech',
      'Limited imagination in play',
      'Difficulty understanding humour or sarcasm',
      'Appears naive or socially vulnerable',
      'Takes things very personally',
      'Narrow range of emotional expression',
      'Intense focus on preferred topics',
      'Rarely joins group activities spontaneously',
      'Does not easily read others’ intentions',
      'Rigid thinking style',
      'Odd posture or body movements',
      'Overall autism-spectrum concern',
    ],
    min: 0,
    max: 2,
    options: ['No (0)', 'Somewhat / sometimes (1)', 'Certainly / often (2)'],
    totalLabel: 'Total Score (0-54)',
  }),
  buildLikertScale({
    name: 'DSS-B (Dissociative Symptom Scale — Brief)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Brief dissociative symptom burden',
    instruction: 'Rate how much each dissociative symptom was present during the assessment period.',
    items: [
      'Feeling disconnected from body or self',
      'Feeling the world is unreal or dreamlike',
      'Memory gaps for part of the day',
      'Losing track of what happened during conversations',
      'Acting on “autopilot” without recall',
      'Feeling emotionally numb or detached',
      'Hearing internal voices or inner parts arguing',
      'Sense of identity confusion or switching',
    ],
    min: 0,
    max: 4,
    options: FIVE_POINT_EXTENT,
    totalLabel: 'Total Score (0-32)',
  }),
  buildYesNoScale({
    name: 'BTQ (Brief Trauma Questionnaire)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Trauma exposure screening',
    instruction: 'Mark Yes for each lifetime exposure category that applies.',
    items: [
      'Serious accident, fire, or explosion',
      'Natural disaster',
      'Life-threatening illness or medical emergency',
      'Physical assault',
      'Assault with a weapon',
      'Sexual assault or unwanted sexual contact',
      'Combat or war-zone exposure',
      'Captivity, coercive control, or torture',
      'Witnessing severe injury or death',
      'Learning of violent or accidental death of someone close',
    ],
    totalLabel: 'Total Exposure Categories (0-10)',
  }),
  {
    name: 'GDS-15 (Geriatric Depression Scale-15)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult', 'Late-life depression screening'),
    content: [
      { type: 'heading', text: 'GDS-15 (Geriatric Depression Scale-15)' },
      { type: 'instruction', text: 'Ask each question and record the depressive response shown in brackets.' },
      { type: 'likert', label: '1. Are you basically satisfied with your life?', min: 0, max: 1, options: ['Yes (0)', 'No (1)'] },
      { type: 'likert', label: '2. Have you dropped many of your activities and interests?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '3. Do you feel that your life is empty?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '4. Do you often get bored?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '5. Are you in good spirits most of the time?', min: 0, max: 1, options: ['Yes (0)', 'No (1)'] },
      { type: 'likert', label: '6. Are you afraid that something bad is going to happen to you?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '7. Do you feel happy most of the time?', min: 0, max: 1, options: ['Yes (0)', 'No (1)'] },
      { type: 'likert', label: '8. Do you often feel helpless?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '9. Do you prefer to stay at home rather than going out and doing new things?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '10. Do you feel you have more problems with memory than most?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '11. Do you think it is wonderful to be alive now?', min: 0, max: 1, options: ['Yes (0)', 'No (1)'] },
      { type: 'likert', label: '12. Do you feel pretty worthless the way you are now?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '13. Do you feel full of energy?', min: 0, max: 1, options: ['Yes (0)', 'No (1)'] },
      { type: 'likert', label: '14. Do you feel that your situation is hopeless?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      { type: 'likert', label: '15. Do you think that most people are better off than you are?', min: 0, max: 1, options: ['No (0)', 'Yes (1)'] },
      {
        type: 'score',
        label: 'Total GDS-15 Score (0-15)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 4, label: 'Within normal range' },
          { min: 5, max: 8, label: 'Mild depression range' },
          { min: 9, max: 11, label: 'Moderate depression range' },
          { min: 12, max: 15, label: 'Severe depression range' },
        ],
      },
    ],
  },
  {
    name: 'IQCODE Short (Informant Questionnaire on Cognitive Decline in the Elderly)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult', 'Informant-rated cognitive decline'),
    content: [
      { type: 'heading', text: 'IQCODE Short (Informant Questionnaire on Cognitive Decline in the Elderly)' },
      { type: 'instruction', text: 'Compared with 10 years ago, how is the person now at each task? Use an informant who knows the person well.' },
      ...[
        'Remembering things about family and friends',
        'Remembering recent events',
        'Recalling conversations a few days later',
        'Remembering their address or phone number',
        'Remembering the day, date, month, and year',
        'Knowing where things are usually kept',
        'Understanding what is going on and what people mean',
        'Following a story in a book, television program, or film',
        'Making decisions on everyday matters',
        'Handling money for shopping',
        'Managing financial matters (bills, banking, balancing accounts)',
        'Using gadgets or household appliances',
        'Learning how to use a new device or routine',
        'Finding the way around familiar streets',
        'Finding the way around an unfamiliar place',
        'Using words and following conversations',
      ].map((item) => ({
        type: 'likert' as const,
        label: item,
        min: 1,
        max: 5,
        options: [
          'Much improved (1)',
          'A bit improved (2)',
          'Not much change (3)',
          'A bit worse (4)',
          'Much worse (5)',
        ],
      })),
      {
        type: 'score',
        label: 'Average IQCODE Score (1-5)',
        formula: 'mean',
        itemIndexes: Array.from({ length: 16 }, (_, index) => index + 2),
        ranges: [
          { min: 1, max: 3, label: 'No significant decline reported' },
          { min: 3.01, max: 3.3, label: 'Borderline decline signal' },
          { min: 3.31, max: 5, label: 'Likely cognitive decline' },
        ],
      },
    ],
  },
  buildLikertScale({
    name: 'IPF-Brief (Inventory of Psychosocial Functioning)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Psychosocial functioning impairment',
    instruction: 'Rate impairment over the review period across the major functioning domains.',
    items: [
      'Work or study functioning',
      'Home and daily responsibilities',
      'Intimate relationship functioning',
      'Family relationship functioning',
      'Friendship / social network functioning',
      'Parenting or caregiving functioning',
      'Self-care, community participation, and leisure functioning',
    ],
    min: 0,
    max: 6,
    options: ['No impairment (0)', 'Very mild (1)', 'Mild (2)', 'Moderate (3)', 'Marked (4)', 'Severe (5)', 'Extreme / unable (6)'],
    totalLabel: 'Total Score (0-42)',
  }),
  buildLikertScale({
    name: 'Padua Inventory',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Obsessive-compulsive symptoms',
    instruction: 'Rate how strongly each obsessive or compulsive symptom has been present recently.',
    items: [
      'Intrusive contamination thoughts',
      'Excessive hand washing',
      'Checking doors, locks, or appliances repeatedly',
      'Checking that no mistakes were made',
      'Re-reading or re-doing tasks repeatedly',
      'Need to arrange or order objects exactly',
      'Compulsive counting or repeating',
      'Fear of losing control over aggressive impulses',
      'Fear of acting on socially embarrassing impulses',
      'Disturbing taboo or blasphemous thoughts',
      'Fear of accidental harm to others',
      'Excessive doubt about having caused harm',
      'Urges to collect or keep useless items',
      'Superstitious need to perform rituals',
      'Mental rituals to neutralize thoughts',
      'Need for certainty before making decisions',
      'Obsessive rumination over insignificant details',
      'Avoidance because of obsessional fears',
      'Difficulty stopping compulsive acts once started',
      'Overall interference from obsessions / compulsions',
    ],
    min: 0,
    max: 4,
    options: FIVE_POINT_EXTENT,
    totalLabel: 'Total Score (0-80)',
  }),
  buildYesNoScale({
    name: 'TSQ (Trauma Screening Questionnaire)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Post-traumatic stress screening',
    instruction: 'Mark Yes for symptoms present at least twice in the past week.',
    items: [
      'Upsetting thoughts or memories about the event',
      'Upsetting dreams about the event',
      'Acting or feeling as if the event were happening again',
      'Feeling upset by reminders of the event',
      'Bodily reactions to reminders of the event',
      'Difficulty falling or staying asleep',
      'Irritability or outbursts of anger',
      'Difficulty concentrating',
      'Heightened alertness / hypervigilance',
      'Being jumpy or easily startled',
    ],
    totalLabel: 'Total TSQ Score (0-10)',
    totalRanges: [
      { min: 0, max: 5, label: 'Below positive screening threshold' },
      { min: 6, max: 10, label: 'Positive trauma screen — assess further' },
    ],
  }),
  {
    name: 'ZUNG SDS (Zung Self-Rating Depression Scale)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Adult', 'Depression symptom severity'),
    content: [
      { type: 'heading', text: 'ZUNG SDS (Zung Self-Rating Depression Scale)' },
      { type: 'instruction', text: 'Rate how often each statement applied during the recent period. Positively worded items are reverse-scored in the response options below.' },
      { type: 'likert', label: '1. I feel down-hearted and blue.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '2. Morning is when I feel the best.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '3. I have crying spells or feel like it.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '4. I have trouble sleeping at night.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '5. I eat as much as I used to.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '6. I still enjoy sex.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '7. I notice that I am losing weight.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '8. I have trouble with constipation.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '9. My heart beats faster than usual.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '10. I get tired for no reason.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '11. My mind is as clear as it used to be.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '12. I find it easy to do the things I used to.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '13. I am restless and cannot keep still.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '14. I feel hopeful about the future.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '15. I am more irritable than usual.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '16. I find it easy to make decisions.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '17. I feel that I am useful and needed.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '18. My life is pretty full.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      { type: 'likert', label: '19. I feel that others would be better off if I were dead.', min: 1, max: 4, options: ['A little of the time (1)', 'Some of the time (2)', 'Good part of the time (3)', 'Most of the time (4)'] },
      { type: 'likert', label: '20. I still enjoy the things I used to do.', min: 1, max: 4, options: ['A little of the time (4)', 'Some of the time (3)', 'Good part of the time (2)', 'Most of the time (1)'] },
      {
        type: 'score',
        label: 'Total ZUNG SDS Score (20-80)',
        formula: 'sum',
        ranges: [
          { min: 20, max: 39, label: 'Within normal range' },
          { min: 40, max: 47, label: 'Mild depression range' },
          { min: 48, max: 55, label: 'Moderate depression range' },
          { min: 56, max: 80, label: 'Severe depression range' },
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
