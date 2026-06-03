type UnknownRecord = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function normaliseInstrumentName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isPhq9Instrument(value: string | null | undefined): boolean {
  const name = normaliseInstrumentName(value);
  return name.includes('phq-9') || name.includes('phq9');
}

function sumNumericValuesFromObject(obj: UnknownRecord): number {
  let total = 0;
  for (const value of Object.values(obj)) {
    const numeric = asNumber(value);
    if (numeric != null) {
      total += numeric;
      continue;
    }
    const nested = toRecord(value);
    if (nested) {
      const nestedScore = asNumber(nested.score ?? nested.value ?? nested.selectedValue);
      if (nestedScore != null) total += nestedScore;
    }
  }
  return total;
}

function sumNumericValuesFromArray(values: unknown[]): number {
  let total = 0;
  for (const item of values) {
    const numeric = asNumber(item);
    if (numeric != null) {
      total += numeric;
      continue;
    }
    const rec = toRecord(item);
    if (!rec) continue;
    const score = asNumber(rec.score ?? rec.value ?? rec.selectedValue);
    if (score != null) total += score;
  }
  return total;
}

function extractQ9ScoreFromObject(obj: UnknownRecord): number | null {
  const directKeys = [
    'q9',
    'question9',
    'item9',
    'phq9_q9',
    'phq9_item_9',
    '9',
  ];
  for (const key of directKeys) {
    const raw = obj[key];
    const numeric = asNumber(raw);
    if (numeric != null) return numeric;
    const nested = toRecord(raw);
    if (!nested) continue;
    const nestedNumeric = asNumber(
      nested.score ?? nested.value ?? nested.selectedValue ?? nested.answer,
    );
    if (nestedNumeric != null) return nestedNumeric;
  }
  return null;
}

function extractQ9ScoreFromArray(values: unknown[]): number | null {
  for (const item of values) {
    const rec = toRecord(item);
    if (!rec) continue;
    const id = String(rec.id ?? rec.itemId ?? rec.questionId ?? '').toLowerCase();
    const label = String(rec.label ?? rec.question ?? '').toLowerCase();
    if (id === '9' || id === 'q9' || label.includes('thoughts that you would be better off dead')) {
      return asNumber(rec.score ?? rec.value ?? rec.selectedValue ?? rec.answer);
    }
  }
  return null;
}

export function deriveAssessmentTotalScore(
  responses: unknown,
): number | null {
  if (Array.isArray(responses)) {
    return sumNumericValuesFromArray(responses);
  }
  const rec = toRecord(responses);
  if (!rec) return null;

  const explicitTotal = asNumber(
    rec.totalScore ??
      rec.total_score ??
      rec.phq9_total ??
      rec.scoreTotal,
  );
  if (explicitTotal != null) return explicitTotal;
  return sumNumericValuesFromObject(rec);
}

export function derivePhq9Q9Score(responses: unknown): number | null {
  if (Array.isArray(responses)) {
    return extractQ9ScoreFromArray(responses);
  }
  const rec = toRecord(responses);
  if (!rec) return null;
  return extractQ9ScoreFromObject(rec);
}

export function detectSuicideRiskSignal(input: {
  measureType?: string | null;
  templateName?: string | null;
  responses: unknown;
  submittedTotalScore?: number | null;
}): {
  isPhq9: boolean;
  totalScore: number | null;
  submittedTotalScore: number | null;
  hasScoreMismatch: boolean;
  q9Score: number | null;
  triggered: boolean;
  reason: string | null;
} {
  const isPhq9 = isPhq9Instrument(input.measureType) || isPhq9Instrument(input.templateName);
  const totalScore = deriveAssessmentTotalScore(input.responses);
  const submittedTotalScore = asNumber(input.submittedTotalScore);
  const hasScoreMismatch =
    submittedTotalScore != null
    && totalScore != null
    && Math.abs(submittedTotalScore - totalScore) > Number.EPSILON;
  const q9Score = derivePhq9Q9Score(input.responses);
  if (!isPhq9) {
    return {
      isPhq9: false,
      totalScore,
      submittedTotalScore,
      hasScoreMismatch,
      q9Score,
      triggered: false,
      reason: null,
    };
  }

  const q9Positive = q9Score != null && q9Score >= 1;
  const severeTotal = totalScore != null && totalScore >= 20;
  const triggered = q9Positive || severeTotal;

  let reason: string | null = null;
  if (q9Positive && severeTotal) {
    reason = 'PHQ-9 Q9 positive and total score >= 20';
  } else if (q9Positive) {
    reason = 'PHQ-9 Q9 positive';
  } else if (severeTotal) {
    reason = 'PHQ-9 total score >= 20';
  }

  return {
    isPhq9,
    totalScore,
    submittedTotalScore,
    hasScoreMismatch,
    q9Score,
    triggered,
    reason,
  };
}
