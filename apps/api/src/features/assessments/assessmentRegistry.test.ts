/**
 * Phase 8 — pure-unit tests for the server-side template classifier.
 *
 * Proves the three operator-required filter invariants:
 *   - outcome measures are EXCLUDED from rating-scale queries
 *   - self_rated filter returns ONLY self-rated rating scales
 *   - clinician_rated + diagnosis filter returns ONLY that diagnosis
 *
 * And the fail-loud invariant:
 *   - unknown template names are reported in `unknownCount`, not
 *     silently classified as a default family.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyTemplate,
  filterTemplates,
  type TemplateRowLike,
} from './assessmentRegistry';

function row(name: string, id: string = name): TemplateRowLike {
  return { id, name, category: 'Rating Scales', content: [] };
}

describe('classifyTemplate', () => {
  it('classifies HoNOS as outcome_measure (no raterType, no diagnosisCategory)', () => {
    const c = classifyTemplate(row('HoNOS (Health of the Nation Outcome Scales)'));
    expect(c.family).toBe('outcome_measure');
    expect(c.slug).toBe('honos');
    expect(c.raterType).toBeUndefined();
    expect(c.diagnosisCategory).toBeUndefined();
  });

  it('classifies PHQ-9 as self_rated rating_scale (mood)', () => {
    const c = classifyTemplate(row('PHQ-9 (Patient Health Questionnaire-9)'));
    expect(c.family).toBe('rating_scale');
    expect(c.raterType).toBe('self_rated');
    expect(c.diagnosisCategory).toBe('mood');
  });

  it('classifies HAM-D as clinician_rated rating_scale (mood)', () => {
    const c = classifyTemplate(row('HAM-D 17 (Hamilton Depression Rating Scale)'));
    expect(c.family).toBe('rating_scale');
    expect(c.raterType).toBe('clinician_rated');
    expect(c.diagnosisCategory).toBe('mood');
  });

  it('flags unknown templates as family=unknown (no silent default)', () => {
    const c = classifyTemplate(row('Acme Custom Scale'));
    expect(c.family).toBe('unknown');
    expect(c.slug).toBeUndefined();
  });
});

describe('filterTemplates — outcome measures NEVER appear in rating-scale queries', () => {
  const corpus: TemplateRowLike[] = [
    row('HoNOS (Health of the Nation Outcome Scales)'),
    row('K10 (Kessler Psychological Distress Scale)'),
    row('K10+ (Extended)'),
    row('LSP-16 (Life Skills Profile)'),
    row('PHQ-9 (Patient Health Questionnaire-9)'),
    row('GAD-7 (Generalised Anxiety Disorder-7)'),
    row('HAM-D 17 (Hamilton Depression Rating Scale)'),
    row('MADRS (Montgomery-Åsberg Depression Rating Scale)'),
    row('BPRS-24 (Brief Psychiatric Rating Scale)'),
    row('PANSS (Positive and Negative Syndrome Scale)'),
    row('AIMS (Abnormal Involuntary Movement Scale)'),
  ];

  it('rating_scale + clinician_rated returns only clinician-rated scales (no outcome measures)', () => {
    const { matched, unknownCount } = filterTemplates(corpus, {
      family: 'rating_scale',
      raterType: 'clinician_rated',
    });
    expect(unknownCount).toBe(0);
    const slugs = matched.map((m) => m.slug);
    // HAM-D, MADRS, BPRS-24, PANSS, AIMS are clinician_rated rating_scales.
    expect(slugs.sort()).toEqual(['aims', 'bprs24', 'hamd17', 'madrs', 'panss']);
    // No outcome measures bled in.
    for (const slug of slugs) {
      expect(['honos', 'honos65', 'honosca', 'k10', 'k10plus', 'lsp16', 'basis32']).not.toContain(slug);
    }
  });

  it('rating_scale + self_rated returns only self-rated scales (no outcome measures, no clinician-rated)', () => {
    const { matched } = filterTemplates(corpus, {
      family: 'rating_scale',
      raterType: 'self_rated',
    });
    const slugs = matched.map((m) => m.slug);
    expect(slugs.sort()).toEqual(['gad7', 'phq9']);
  });

  it('outcome_measure family returns only outcome measures', () => {
    const { matched } = filterTemplates(corpus, { family: 'outcome_measure' });
    const slugs = matched.map((m) => m.slug);
    expect(slugs.sort()).toEqual(['honos', 'k10', 'k10plus', 'lsp16']);
    for (const m of matched) {
      expect(m.raterType).toBeUndefined();
      expect(m.diagnosisCategory).toBeUndefined();
    }
  });

  it('clinician_rated + diagnosis=mood returns only mood-classified clinician-rated scales', () => {
    const { matched } = filterTemplates(corpus, {
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'mood',
    });
    const slugs = matched.map((m) => m.slug);
    expect(slugs.sort()).toEqual(['hamd17', 'madrs']);
  });

  it('clinician_rated + diagnosis=psychosis returns only psychosis-classified clinician-rated scales', () => {
    const { matched } = filterTemplates(corpus, {
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'psychosis',
    });
    const slugs = matched.map((m) => m.slug);
    expect(slugs.sort()).toEqual(['bprs24', 'panss']);
  });
});

describe('filterTemplates — unknown templates surface in unknownCount (fail-loud)', () => {
  it('counts unknown rows without silently dropping or mis-classifying', () => {
    const corpus: TemplateRowLike[] = [
      row('PHQ-9 (Patient Health Questionnaire-9)'),
      row('Definitely not in registry'),
      row('Another unknown'),
      row('GAD-7 (Generalised Anxiety Disorder-7)'),
    ];
    const { matched, unknownCount } = filterTemplates(corpus, {
      family: 'rating_scale',
      raterType: 'self_rated',
    });
    expect(unknownCount).toBe(2);
    expect(matched.map((m) => m.slug).sort()).toEqual(['gad7', 'phq9']);
  });
});
