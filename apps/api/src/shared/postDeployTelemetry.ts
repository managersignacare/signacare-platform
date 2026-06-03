import {
  type AlertCalibrationFeedbackSignal,
  AlertCalibrationFeedbackSignalSchema,
  type ClinicalIntelligenceSource,
  type ClinicalIntelligenceState,
  type DiagnosisProgramBucket,
  type ReadabilityBand,
  type ReadabilityLanguageBucket,
  type ServiceProgramBucket,
  type ScribeReadabilitySignal,
  ScribeReadabilitySignalSchema,
} from '@signacare/shared';

import {
  aiAlertCalibrationFeedbackTotal,
  aiSummaryReadabilityTotal,
  clinicalIntelligenceSourceFailureTotal,
  clinicalIntelligenceSummaryStateTotal,
} from '../observability/metrics';
import { logger } from '../utils/logger';

const ENGLISH_STOPWORDS = new Set([
  'the', 'and', 'with', 'for', 'from', 'that', 'this', 'was', 'were', 'are', 'has',
  'have', 'had', 'patient', 'review', 'plan', 'risk', 'mental', 'mood', 'today',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasNonLatinScript(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  for (const letter of letters) {
    if (!/\p{Script=Latin}/u.test(letter)) return true;
  }
  return false;
}

function tokenizeWords(text: string): string[] {
  const words = text.match(/\b[\p{L}\p{M}'-]+\b/gu);
  return words ?? [];
}

function countSyllablesEnglish(word: string): number {
  const cleaned = word
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = cleaned.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function classifyReadabilityLanguage(text: string): ReadabilityLanguageBucket {
  if (!text.trim()) return 'unknown';
  if (hasNonLatinScript(text)) return 'non_latin';

  const words = tokenizeWords(text);
  if (words.length === 0) return 'unknown';
  const lower = words.map((w) => w.toLowerCase());
  const englishHits = lower.filter((w) => ENGLISH_STOPWORDS.has(w)).length;
  return englishHits >= 3 ? 'english' : 'latin_non_english';
}

export function computeEnglishReadability(text: string): number | null {
  const words = tokenizeWords(text);
  if (words.length < 20) return null;
  const sentences = text
    .split(/[.!?]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceCount = Math.max(1, sentences.length);
  const syllables = words.reduce((sum, word) => sum + countSyllablesEnglish(word), 0);
  const score = 206.835
    - (1.015 * (words.length / sentenceCount))
    - (84.6 * (syllables / words.length));
  return Number(clamp(score, 0, 120).toFixed(2));
}

export function classifyReadabilityBand(
  language: ReadabilityLanguageBucket,
  score: number | null,
): ReadabilityBand {
  if (language === 'non_latin') return 'unscored_non_english';
  if (score == null) return 'unscored_unknown';
  if (score >= 60) return 'clear';
  if (score >= 45) return 'borderline';
  return 'dense';
}

export function toDiagnosisProgramBucket(value: string | null | undefined): DiagnosisProgramBucket {
  const input = String(value ?? '').toLowerCase();
  if (!input) return 'unknown';
  if (/\bbipolar\b|\bmania\b|\bdepression\b|\bmood\b/.test(input)) return 'mood';
  if (/\bpsychosis\b|\bschizo/.test(input)) return 'psychotic';
  if (/\banxiety\b|\bptsd\b|\btrauma\b|\bocd\b/.test(input)) return 'anxiety_trauma';
  if (/\bpersonality\b|\bbpd\b/.test(input)) return 'personality';
  if (/\bsubstance\b|\balcohol\b|\baod\b/.test(input)) return 'substance';
  if (/\badhd\b|\bautis/.test(input)) return 'neurodevelopmental';
  return 'other';
}

export function toServiceProgramBucket(value: string | null | undefined): ServiceProgramBucket {
  const input = String(value ?? '').toLowerCase();
  if (!input) return 'unknown';
  if (/\binpatient\b|\bward\b|\badmission\b/.test(input)) return 'inpatient';
  if (/\bcrisis\b|\bacis\b|\bemergency\b/.test(input)) return 'crisis';
  if (/\bcommunity\b|\boutreach\b|\bambulatory\b/.test(input)) return 'community';
  if (/\bday\b|\bprogram\b|\bgroup\b/.test(input)) return 'day_program';
  return 'other';
}

export function recordClinicalIntelligenceSummarySignal(args: {
  state: ClinicalIntelligenceState;
  failedSources: ClinicalIntelligenceSource[];
  diagnosisProgramBucket: DiagnosisProgramBucket;
  serviceProgramBucket: ServiceProgramBucket;
}): void {
  clinicalIntelligenceSummaryStateTotal.inc({
    state: args.state,
    diagnosis_bucket: args.diagnosisProgramBucket,
    program_bucket: args.serviceProgramBucket,
  });
  for (const source of args.failedSources) {
    clinicalIntelligenceSourceFailureTotal.inc({ source });
  }
}

export function recordScribeReadabilitySignal(input: {
  feature: string;
  text: string;
}): ScribeReadabilitySignal {
  const language = classifyReadabilityLanguage(input.text);
  const score = language === 'english' ? computeEnglishReadability(input.text) : null;
  const band = classifyReadabilityBand(language, score);
  const signal = ScribeReadabilitySignalSchema.parse({
    feature: input.feature,
    language,
    band,
    score,
    generatedAt: new Date().toISOString(),
  });
  aiSummaryReadabilityTotal.inc({
    feature: signal.feature,
    language: signal.language,
    band: signal.band,
  });
  if (signal.band === 'dense') {
    logger.warn(
      { feature: signal.feature, language: signal.language, score: signal.score, kind: 'ai_summary_readability_dense' },
      'AI summary readability scored as dense',
    );
  }
  return signal;
}

export function recordAlertCalibrationFeedback(signal: AlertCalibrationFeedbackSignal): void {
  const parsed = AlertCalibrationFeedbackSignalSchema.parse(signal);
  aiAlertCalibrationFeedbackTotal.inc({
    signal_type: parsed.signalType,
    outcome: parsed.outcome,
  });
}
