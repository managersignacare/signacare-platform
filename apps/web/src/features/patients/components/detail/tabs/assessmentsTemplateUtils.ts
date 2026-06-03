import type { TemplateField } from '../../../../../shared/components/TemplateFormRenderer';

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

export interface ContactMeta {
  ratingScale?: RatingScaleMeta;
  itemScores?: Record<string, number>;
  planType?: string;
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
    const validTypes = new Set([
      'heading', 'instruction', 'text_block', 'short_answer', 'yes_no',
      'multiple_choice', 'multi_select', 'likert', 'score',
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
