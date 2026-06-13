import type { TemplateField, FormValues } from '../../../../../shared/components/TemplateFormRenderer';
import { describeDrawingFieldForText } from '../../../../../shared/components/drawingField';

export interface RatingScaleTemplate {
  id: string;
  name: string;
  category?: string;
  categoryName?: string;
  description?: string | null;
  content: TemplateField[] | string | null;
}

export interface TemplatesResponse {
  templates?: RatingScaleTemplate[];
  data?: RatingScaleTemplate[];
}

export interface RatingScaleMeta {
  templateName?: string;
  respondentType?: 'self' | 'clinician';
  totalScore?: number;
  severity?: string;
  itemCount?: number;
  itemScores?: Record<string, number>;
  scoreBreakdowns?: Array<{
    label: string;
    score: number;
    formula?: 'sum' | 'mean';
    severity?: string;
    itemCount?: number;
    itemIndexes?: number[];
  }>;
}

/**
 * Captured drawing artefact persisted alongside the assessment
 * (P-CLAUDE-LANE 4B/4). One entry per drawing field on the template
 * that was actually populated by the clinician — empty payloads are
 * NOT persisted to keep the saved record lean.
 *
 * `payload` is the serialised DrawingPayload (see
 * packages/shared/src/drawingPayload.ts) — the same wire shape the
 * canvas writes to the FormValues string slot, round-tripped through
 * serializeDrawingPayload / tryParseDrawingPayload.
 *
 * `label` carries the source field's label so the read-back surface
 * can describe each drawing without needing the template definition
 * to be loaded (self-describing persisted artefacts).
 */
export interface CapturedDrawingArtefact {
  label: string;
  payload: string;
}

export interface ContactMeta {
  ratingScale?: RatingScaleMeta;
  itemScores?: Record<string, number>;
  planType?: string;
  /**
   * Drawing artefacts captured during the assessment (MMSE pentagons,
   * MoCA cube / clock). Persisted on save by AssessmentsTab so the
   * expand-view read-back surface can render the patient's actual
   * figures via DrawingFieldCanvas in readOnly mode. Optional — present
   * only when the template contained drawing fields AND at least one
   * was populated.
   */
  drawings?: CapturedDrawingArtefact[];
}

export interface CompletedAssessment {
  id: string;
  title: string;
  noteType: string;
  content: string;
  status: string;
  authorName: string;
  createdAt: string;
  episodeTitle: string;
  contactMeta?: ContactMeta | string | null;
}

export interface ParsedTemplateDescriptor {
  respondentType: 'self' | 'clinician' | 'unknown';
  ageGroup: string;
  focus: string;
}

export function parseContactMeta(raw: ContactMeta | string | null | undefined): ContactMeta | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as ContactMeta) : null;
    } catch {
      return null;
    }
  }
  return raw ?? null;
}

export function parseTemplateFields(content: TemplateField[] | string | null | undefined): TemplateField[] {
  const normalizeField = (rawField: unknown): TemplateField | null => {
    if (typeof rawField !== 'object' || rawField == null) return null;
    const field = rawField as Record<string, unknown>;
    const fieldType = typeof field.type === 'string'
      ? field.type
      : typeof field.fieldType === 'string'
        ? field.fieldType
        : null;
    if (!fieldType) return null;

    const mappedType = fieldType === 'textarea'
      ? 'short_answer'
      : fieldType === 'date'
        ? 'short_answer'
        : fieldType;
    // 'drawing' supports the MMSE pentagons + MoCA cube/clock tablet
    // capture (P-CLAUDE-LANE 4B). Must stay in sync with the
    // TemplateField union at apps/web/src/shared/components/
    // TemplateFormRenderer.tsx and ScaleField in
    // apps/api/src/features/assessments/builtinAssessmentDefinitionBuilders.ts.
    const validTypes = new Set([
      'heading', 'instruction', 'text_block', 'short_answer', 'yes_no',
      'multiple_choice', 'multi_select', 'likert', 'score', 'drawing',
    ]);
    if (!validTypes.has(mappedType)) return null;

    const numericScores = Array.isArray(field.scores)
      ? field.scores.filter((value): value is number => typeof value === 'number')
      : [];
    const fallbackMin = numericScores.length > 0 ? Math.min(...numericScores) : 0;
    const fallbackMax = numericScores.length > 0 ? Math.max(...numericScores) : Math.max((Array.isArray(field.options) ? field.options.length : 1) - 1, 0);
    const rawOptions = Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === 'string')
      : undefined;
    const options = rawOptions && numericScores.length === rawOptions.length
      ? rawOptions.map((option, index) => `${option} (${numericScores[index]})`)
      : rawOptions;

    return {
      type: mappedType as TemplateField['type'],
      label: typeof field.label === 'string' ? field.label : undefined,
      text: typeof field.text === 'string' ? field.text : undefined,
      min: typeof field.min === 'number' ? field.min : (mappedType === 'likert' ? fallbackMin : undefined),
      max: typeof field.max === 'number' ? field.max : (mappedType === 'likert' ? fallbackMax : undefined),
      options,
      formula: field.formula === 'mean' ? 'mean' : field.formula === 'sum' ? 'sum' : undefined,
      itemIndexes: Array.isArray(field.itemIndexes)
        ? field.itemIndexes.filter((value): value is number => Number.isInteger(value))
        : undefined,
      ranges: Array.isArray(field.ranges)
        ? field.ranges
          .map((range) => {
            if (typeof range !== 'object' || range == null) return null;
            const typedRange = range as Record<string, unknown>;
            if (typeof typedRange.min !== 'number' || typeof typedRange.max !== 'number' || typeof typedRange.label !== 'string') return null;
            return {
              min: typedRange.min,
              max: typedRange.max,
              label: typedRange.label,
            };
          })
          .filter((range): range is { min: number; max: number; label: string } => Boolean(range))
        : undefined,
    };
  };

  if (Array.isArray(content)) {
    return content
      .map((rawField) => normalizeField(rawField))
      .filter((field): field is TemplateField => Boolean(field));
  }
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((rawField) => normalizeField(rawField))
        .filter((field): field is TemplateField => Boolean(field));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Extract captured drawing artefacts from the FormValues at save
 * time (P-CLAUDE-LANE 4B/4).
 *
 * One entry per template drawing field where the FormValues slot
 * carries a populated payload (`describeDrawingFieldForText` returns
 * 'captured'). Empty payloads — including drawing fields the
 * clinician opened but did not draw into — are skipped so the
 * persisted record stays lean and the read-back surface does not show
 * empty placeholder canvases.
 *
 * Labels are sourced from the field. The persisted artefacts are
 * self-describing: the read-back path does not need the template
 * definition to re-render the captured figures.
 */
export function extractCapturedDrawings(
  fields: TemplateField[],
  values: FormValues,
): CapturedDrawingArtefact[] {
  const out: CapturedDrawingArtefact[] = [];
  fields.forEach((field, index) => {
    if (field.type !== 'drawing') return;
    const slot = values[String(index)];
    if (typeof slot !== 'string' || slot.length === 0) return;
    if (describeDrawingFieldForText(slot) !== 'captured') return;
    out.push({
      label: field.label ?? `Drawing ${index + 1}`,
      payload: slot,
    });
  });
  return out;
}

export function parseTemplateDescriptor(description: string | null | undefined): ParsedTemplateDescriptor {
  const text = (description ?? '').trim();
  if (!text) {
    return { respondentType: 'unknown', ageGroup: 'General', focus: 'General mental health' };
  }
  const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
  const map = new Map(
    parts
      .map((part) => {
        const [k, ...rest] = part.split(':');
        if (!k || rest.length === 0) return null;
        return [k.trim().toLowerCase(), rest.join(':').trim()] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );
  const rawType = (map.get('type') ?? '').toLowerCase();
  const respondentType: 'self' | 'clinician' | 'unknown' =
    rawType.includes('self') ? 'self' : rawType.includes('clinician') ? 'clinician' : 'unknown';
  return {
    respondentType,
    ageGroup: map.get('age') ?? 'General',
    focus: map.get('focus') ?? 'General mental health',
  };
}
