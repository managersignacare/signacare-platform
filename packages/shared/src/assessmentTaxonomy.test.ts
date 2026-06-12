/**
 * Property tests for the assessment-taxonomy SSoT.
 *
 * Proves the operator-required invariants:
 *   - every entry passes the Zod cross-validation
 *   - no duplicate slugs
 *   - outcome measures never carry raterType / diagnosisCategory
 *   - rating_scale entries always carry raterType
 *   - clinician_rated rating_scale entries always carry diagnosisCategory
 *   - alias matching resolves the historical seed names to the right entry
 *   - the diagnosis grouping helper never surfaces a non-clinician-rated
 *     scale or an outcome measure
 */
import { describe, expect, it } from 'vitest';
import {
  DiagnosisCategorySchema,
  groupClinicianRatedByDiagnosis,
  listClinicianRatedScales,
  listOutcomeMeasures,
  listSelfRatedScales,
  normaliseScaleName,
  resolveScaleByTemplateName,
  ScaleRegistryEntrySchema,
  SCALE_REGISTRY,
} from './assessmentTaxonomy';

describe('SCALE_REGISTRY — invariants', () => {
  it('every entry passes the Zod cross-validation', () => {
    for (const entry of SCALE_REGISTRY) {
      expect(() => ScaleRegistryEntrySchema.parse(entry)).not.toThrow();
    }
  });

  it('contains no duplicate slugs', () => {
    const slugs = SCALE_REGISTRY.map((entry) => entry.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('outcome_measure entries never carry raterType or diagnosisCategory', () => {
    for (const entry of listOutcomeMeasures()) {
      expect(entry.raterType).toBeUndefined();
      expect(entry.diagnosisCategory).toBeUndefined();
    }
    expect(listOutcomeMeasures().length).toBeGreaterThan(0);
  });

  it('every rating_scale entry carries a raterType', () => {
    const ratingScales = SCALE_REGISTRY.filter((e) => e.family === 'rating_scale');
    expect(ratingScales.length).toBeGreaterThan(0);
    for (const entry of ratingScales) {
      expect(entry.raterType).toBeDefined();
    }
  });

  it('every clinician_rated entry carries a diagnosisCategory', () => {
    for (const entry of listClinicianRatedScales()) {
      expect(entry.diagnosisCategory).toBeDefined();
      // And the category is one of the closed enum values.
      expect(DiagnosisCategorySchema.options).toContain(entry.diagnosisCategory!);
    }
    expect(listClinicianRatedScales().length).toBeGreaterThan(0);
  });
});

describe('Operator-mandated separation invariants', () => {
  it('outcome measures and rating scales are disjoint sets', () => {
    const outcomeSlugs = new Set(listOutcomeMeasures().map((e) => e.slug));
    const ratingSlugs = new Set([
      ...listSelfRatedScales().map((e) => e.slug),
      ...listClinicianRatedScales().map((e) => e.slug),
    ]);
    for (const slug of outcomeSlugs) expect(ratingSlugs.has(slug)).toBe(false);
  });

  it('canonical outcome measures (HoNOS, K10+, LSP-16) live in the outcome_measure family', () => {
    const expected = ['honos', 'honos65', 'honosca', 'k10', 'k10plus', 'lsp16'];
    for (const slug of expected) {
      const entry = SCALE_REGISTRY.find((e) => e.slug === slug);
      expect(entry, `missing entry for ${slug}`).toBeDefined();
      expect(entry!.family).toBe('outcome_measure');
    }
  });

  it('PHQ-9, GAD-7, DASS-21 are self_rated rating_scales (Viva surface)', () => {
    for (const slug of ['phq9', 'gad7', 'dass21']) {
      const entry = SCALE_REGISTRY.find((e) => e.slug === slug);
      expect(entry, `missing entry for ${slug}`).toBeDefined();
      expect(entry!.family).toBe('rating_scale');
      expect(entry!.raterType).toBe('self_rated');
    }
  });

  it('seeded clinician-rated instruments are clinician_rated rating_scales with diagnosisCategory', () => {
    for (const slug of ['hamd17', 'madrs', 'bprs24', 'panss', 'aims', 'gaf', 'mmse', 'moca']) {
      const entry = SCALE_REGISTRY.find((e) => e.slug === slug);
      expect(entry, `missing entry for ${slug}`).toBeDefined();
      expect(entry!.family).toBe('rating_scale');
      expect(entry!.raterType).toBe('clinician_rated');
      expect(entry!.diagnosisCategory).toBeDefined();
    }
  });
});

describe('normaliseScaleName + resolveScaleByTemplateName', () => {
  it('resolves historical seed names to the right registry entry', () => {
    // These are the literal names used by seed-rating-scales.ts /
    // seed-templates.ts today — the resolver MUST match each one.
    const cases: Array<[string, string]> = [
      ['PHQ-9 (Patient Health Questionnaire-9)', 'phq9'],
      ['PHQ-9 (Patient Health Questionnaire)', 'phq9'],
      ['GAD-7 (Generalized Anxiety Disorder-7)', 'gad7'],
      ['GAD-7 (Generalised Anxiety Disorder)', 'gad7'],
      ['HoNOS (Health of the Nation Outcome Scales)', 'honos'],
      ['HoNOS 65+ (Older Persons)', 'honos65'],
      ['K10 (Kessler Psychological Distress Scale)', 'k10'],
      ['K10+ (Extended)', 'k10plus'],
      ['LSP-16 (Life Skills Profile)', 'lsp16'],
      ['BPRS (Brief Psychiatric Rating Scale)', 'bprs24'],
      ['BPRS-24 (Brief Psychiatric Rating Scale)', 'bprs24'],
      ['AIMS (Abnormal Involuntary Movement Scale)', 'aims'],
      ['MADRS (Montgomery-Åsberg Depression Rating Scale)', 'madrs'],
      ['HAM-D', 'hamd17'],
      ['GAF (Global Assessment of Functioning)', 'gaf'],
      ['MMSE (Mini-Mental State Examination)', 'mmse'],
      ['MoCA (Montreal Cognitive Assessment)', 'moca'],
    ];
    for (const [name, expectedSlug] of cases) {
      const entry = resolveScaleByTemplateName(name);
      expect(entry, `expected resolver to find ${expectedSlug} for "${name}"`).toBeDefined();
      expect(entry!.slug).toBe(expectedSlug);
    }
  });

  it('returns undefined for unknown scale names (no silent fallback)', () => {
    expect(resolveScaleByTemplateName('definitely-not-a-scale')).toBeUndefined();
    expect(resolveScaleByTemplateName('')).toBeUndefined();
  });

  it('normaliseScaleName is case-insensitive + strips punctuation', () => {
    expect(normaliseScaleName('PHQ-9 (Patient Health Questionnaire-9)')).toBe('phq 9 patient health questionnaire 9');
    expect(normaliseScaleName('HoNOS 65+')).toBe('honos 65');
  });
});

describe('groupClinicianRatedByDiagnosis', () => {
  it('only surfaces clinician_rated rating_scale entries', () => {
    const groups = groupClinicianRatedByDiagnosis();
    for (const group of groups) {
      for (const scale of group.scales) {
        expect(scale.family).toBe('rating_scale');
        expect(scale.raterType).toBe('clinician_rated');
        expect(scale.diagnosisCategory).toBe(group.diagnosis);
      }
    }
  });

  it('emits buckets in diagnosis-enum order with non-empty scales arrays', () => {
    const groups = groupClinicianRatedByDiagnosis();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group.scales.length).toBeGreaterThan(0);
    // Order = order of DiagnosisCategorySchema.options (first-occurrence wins).
    const seenIndexes = groups.map((g) => DiagnosisCategorySchema.options.indexOf(g.diagnosis));
    const sorted = [...seenIndexes].sort((a, b) => a - b);
    expect(seenIndexes).toEqual(sorted);
  });

  it('every clinician-rated registry entry surfaces in exactly one group', () => {
    const groups = groupClinicianRatedByDiagnosis();
    const flat = groups.flatMap((g) => g.scales.map((s) => s.slug));
    const allClinicianRated = listClinicianRatedScales().map((e) => e.slug);
    expect(new Set(flat)).toEqual(new Set(allClinicianRated));
    expect(flat.length).toBe(allClinicianRated.length); // no duplicates
  });
});
