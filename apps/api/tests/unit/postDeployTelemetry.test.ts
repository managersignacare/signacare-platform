import { describe, expect, it } from 'vitest';

import {
  classifyReadabilityBand,
  classifyReadabilityLanguage,
  computeEnglishReadability,
  recordScribeReadabilitySignal,
  toDiagnosisProgramBucket,
  toServiceProgramBucket,
} from '../../src/shared/postDeployTelemetry';

describe('postDeployTelemetry', () => {
  it('classifies language buckets deterministically', () => {
    expect(classifyReadabilityLanguage('')).toBe('unknown');
    expect(classifyReadabilityLanguage('Patient was reviewed today and the plan was updated.')).toBe('english');
    expect(classifyReadabilityLanguage('المريض اليوم مستقر مع متابعة نفسية')).toBe('non_latin');
    expect(classifyReadabilityLanguage('Clinique suivi humeur sommeil appétit')).toBe('latin_non_english');
  });

  it('scores english readability and leaves short text unscored', () => {
    expect(computeEnglishReadability('Short text only')).toBeNull();
    const score = computeEnglishReadability(
      'The patient attended review today and reported improved sleep over the past week. ' +
      'Mood remained stable, appetite improved, and there were no active safety concerns. ' +
      'We reviewed medication adherence and agreed to continue current treatment with follow-up next week.',
    );
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(120);
  });

  it('maps readability band by score and language', () => {
    expect(classifyReadabilityBand('non_latin', null)).toBe('unscored_non_english');
    expect(classifyReadabilityBand('english', null)).toBe('unscored_unknown');
    expect(classifyReadabilityBand('english', 70)).toBe('clear');
    expect(classifyReadabilityBand('english', 50)).toBe('borderline');
    expect(classifyReadabilityBand('english', 30)).toBe('dense');
  });

  it('maps diagnosis and service buckets from free text', () => {
    expect(toDiagnosisProgramBucket('Bipolar affective disorder')).toBe('mood');
    expect(toDiagnosisProgramBucket('schizoaffective psychosis')).toBe('psychotic');
    expect(toDiagnosisProgramBucket('')).toBe('unknown');
    expect(toServiceProgramBucket('ACIS crisis team')).toBe('crisis');
    expect(toServiceProgramBucket('Community outreach')).toBe('community');
    expect(toServiceProgramBucket(undefined)).toBe('unknown');
  });

  it('records readability signal with validated contract shape', () => {
    const signal = recordScribeReadabilitySignal({
      feature: 'scribe-patient-summary',
      text:
        'The patient attended a structured follow-up today. Mood and energy were reviewed in detail, ' +
        'sleep patterns were documented, and medication side effects were assessed. The agreed plan ' +
        'includes continuity of current treatment, psychoeducation, and next review with risk checks.',
    });
    expect(signal.feature).toBe('scribe-patient-summary');
    expect(signal.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
