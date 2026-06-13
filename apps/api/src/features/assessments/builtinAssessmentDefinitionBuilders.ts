export type RespondentType = 'self' | 'clinician';

export interface ScaleField {
  type:
    | 'heading'
    | 'instruction'
    | 'text_block'
    | 'short_answer'
    | 'yes_no'
    | 'multiple_choice'
    | 'multi_select'
    | 'likert'
    | 'score'
    /**
     * Real tablet drawing capture (P-CLAUDE-LANE 4B). Used by MMSE
     * intersecting pentagons + MoCA cube / clock items. The stored
     * value is a serialised DrawingPayload (see
     * packages/shared/src/drawingPayload.ts) in the FormValues string
     * slot; the renderer round-trips via tryParseDrawingPayload /
     * serializeDrawingPayload. Not scorable (isScorableField excludes
     * 'drawing'). formValuesToText emits a "[drawing captured]" /
     * "[drawing not captured]" marker so the exported clinical record
     * carries the signal without embedding the raw strokes.
     */
    | 'drawing';
  label?: string;
  text?: string;
  min?: number;
  max?: number;
  options?: string[];
  formula?: 'sum' | 'mean';
  itemIndexes?: number[];
  ranges?: Array<{ min: number; max: number; label: string }>;
}

export interface SubscaleSpec {
  label: string;
  itemNumbers: number[];
  formula?: 'sum' | 'mean';
  ranges?: Array<{ min: number; max: number; label: string }>;
}

export interface LikertScaleSpec {
  name: string;
  respondentType: RespondentType;
  ageGroup: string;
  focus: string;
  instruction: string;
  items: string[];
  min: number;
  max: number;
  options: string[];
  subscales?: SubscaleSpec[];
  totalLabel?: string;
  totalRanges?: Array<{ min: number; max: number; label: string }>;
}

export interface BuiltinAssessmentTemplate {
  name: string;
  type: 'assessment';
  category: 'Rating Scales';
  description: string;
  content: ScaleField[];
}

export const FOUR_POINT_FREQ = [
  'Not at all (0)',
  'Several days (1)',
  'More than half the days (2)',
  'Nearly every day (3)',
];

export const FIVE_POINT_SEVERITY_0_4 = [
  'None (0)',
  'Mild (1)',
  'Moderate (2)',
  'Marked (3)',
  'Severe (4)',
];

export const FIVE_POINT_EXTENT = [
  'Not at all (0)',
  'A little bit (1)',
  'Moderately (2)',
  'Quite a bit (3)',
  'Extremely (4)',
];

export const SEVEN_POINT_CLINICAL = [
  'Absent (1)',
  'Minimal (2)',
  'Mild (3)',
  'Moderate (4)',
  'Moderately severe (5)',
  'Severe (6)',
  'Extremely severe (7)',
];

export function descriptor(
  respondentType: RespondentType,
  ageGroup: string,
  focus: string,
): string {
  const typeLabel = respondentType === 'self' ? 'Self-rated' : 'Clinician-rated';
  return `Type: ${typeLabel} | Age: ${ageGroup} | Focus: ${focus}`;
}

export function buildLikertScale(spec: LikertScaleSpec): BuiltinAssessmentTemplate {
  const questionStartIndex = 2;
  const content: ScaleField[] = [
    { type: 'heading', text: spec.name },
    { type: 'instruction', text: spec.instruction },
    ...spec.items.map((item) => ({
      type: 'likert' as const,
      label: item,
      min: spec.min,
      max: spec.max,
      options: spec.options,
    })),
  ];

  for (const subscale of spec.subscales ?? []) {
    content.push({
      type: 'score',
      label: subscale.label,
      formula: subscale.formula ?? 'sum',
      itemIndexes: subscale.itemNumbers.map((n) => questionStartIndex + n - 1),
      ranges: subscale.ranges,
    });
  }

  content.push({
    type: 'score',
    label: spec.totalLabel ?? 'Total Score',
    formula: 'sum',
    ranges: spec.totalRanges,
  });

  return {
    name: spec.name,
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor(spec.respondentType, spec.ageGroup, spec.focus),
    content,
  };
}

export function buildYesNoScale(input: {
  name: string;
  respondentType: RespondentType;
  ageGroup: string;
  focus: string;
  instruction: string;
  items: string[];
  totalLabel?: string;
  totalRanges?: Array<{ min: number; max: number; label: string }>;
}): BuiltinAssessmentTemplate {
  const content: ScaleField[] = [
    { type: 'heading', text: input.name },
    { type: 'instruction', text: input.instruction },
    ...input.items.map((item) => ({ type: 'yes_no' as const, label: item })),
    {
      type: 'score',
      label: input.totalLabel ?? 'Total Score',
      formula: 'sum',
      ranges: input.totalRanges,
    },
  ];
  return {
    name: input.name,
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor(input.respondentType, input.ageGroup, input.focus),
    content,
  };
}
