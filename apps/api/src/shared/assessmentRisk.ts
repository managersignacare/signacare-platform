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

function isBdiInstrument(value: string | null | undefined): boolean {
  const name = normaliseInstrumentName(value);
  return name.includes('bdi-ii') || name.includes('bdi ii') || name.includes('beck depression');
}

function isEpdsInstrument(value: string | null | undefined): boolean {
  const name = normaliseInstrumentName(value);
  return name.includes('epds') || name.includes('edinburgh postnatal');
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

function extractNumberedRiskItemScoreFromObject(obj: UnknownRecord, itemNumber: number): number | null {
  const directKeys = [
    `q${itemNumber}`,
    `question${itemNumber}`,
    `item${itemNumber}`,
    String(itemNumber),
    `risk_item_${itemNumber}`,
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

function extractNumberedRiskItemScoreFromArray(
  values: unknown[],
  itemNumber: number,
  labelFragments: readonly string[],
): number | null {
  for (const item of values) {
    const rec = toRecord(item);
    if (!rec) continue;
    const id = String(rec.id ?? rec.itemId ?? rec.questionId ?? '').toLowerCase();
    const label = String(rec.label ?? rec.question ?? '').toLowerCase();
    const matchesNumber = id === String(itemNumber) || id === `q${itemNumber}` || id === `item${itemNumber}`;
    const matchesLabel = labelFragments.some((fragment) => label.includes(fragment));
    if (!matchesNumber && !matchesLabel) continue;
    return asNumber(rec.score ?? rec.value ?? rec.selectedValue ?? rec.answer);
  }
  return null;
}

function deriveRiskItemScore(input: {
  responses: unknown;
  measureType?: string | null;
  templateName?: string | null;
}): { instrument: 'PHQ-9' | 'BDI-II' | 'EPDS' | null; score: number | null } {
  const name = `${input.measureType ?? ''} ${input.templateName ?? ''}`;
  const spec = isPhq9Instrument(name)
    ? { instrument: 'PHQ-9' as const, itemNumber: 9, fragments: ['better off dead', 'self harm', 'self-harm'] }
    : isBdiInstrument(name)
      ? { instrument: 'BDI-II' as const, itemNumber: 9, fragments: ['suicidal thoughts', 'suicide'] }
      : isEpdsInstrument(name)
        ? { instrument: 'EPDS' as const, itemNumber: 10, fragments: ['harming myself', 'self harm', 'self-harm'] }
        : null;
  if (!spec) return { instrument: null, score: null };
  if (Array.isArray(input.responses)) {
    return {
      instrument: spec.instrument,
      score: extractNumberedRiskItemScoreFromArray(input.responses, spec.itemNumber, spec.fragments),
    };
  }
  const rec = toRecord(input.responses);
  if (!rec) return { instrument: spec.instrument, score: null };
  return {
    instrument: spec.instrument,
    score: extractNumberedRiskItemScoreFromObject(rec, spec.itemNumber),
  };
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
  const riskItem = deriveRiskItemScore(input);
  const totalScore = deriveAssessmentTotalScore(input.responses);
  const submittedTotalScore = asNumber(input.submittedTotalScore);
  const hasScoreMismatch =
    submittedTotalScore != null
    && totalScore != null
    && Math.abs(submittedTotalScore - totalScore) > Number.EPSILON;
  const q9Score = riskItem.score;
  if (!riskItem.instrument) {
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

  const riskItemPositive = q9Score != null && q9Score >= 1;
  const severeTotal = riskItem.instrument === 'PHQ-9' && totalScore != null && totalScore >= 20;
  const triggered = riskItemPositive || severeTotal;

  let reason: string | null = null;
  if (riskItemPositive && severeTotal) {
    reason = 'PHQ-9 Q9 positive and total score >= 20';
  } else if (riskItemPositive) {
    reason = `${riskItem.instrument} self-harm/suicide item positive`;
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
