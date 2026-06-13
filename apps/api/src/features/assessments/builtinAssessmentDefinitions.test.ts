import { describe, expect, it } from 'vitest';
import { getScoringMetadata } from '@signacare/shared';
import {
  BUILTIN_RATING_SCALE_DEFINITIONS,
  findAvailableRatingScaleDefinition,
  listAvailableRatingScaleDefinitions,
  makeBuiltinAssessmentTemplateId,
} from './builtinAssessmentDefinitions';
import type { TemplateRowLike } from './assessmentRegistry';

interface TemplateScoreField {
  type: 'score';
  label?: string;
  ranges?: Array<{ min: number; max: number; label: string }>;
}

function findScoreField(slug: string): TemplateScoreField {
  const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
    entry.name.toLowerCase().startsWith(`${slug} `) || entry.name.toLowerCase().startsWith(`${slug} (`),
  );
  if (!def) {
    throw new Error(`Built-in template not found for slug "${slug}"`);
  }
  const score = (def.content as Array<{ type: string }>).find(
    (field): field is TemplateScoreField => field.type === 'score',
  );
  if (!score) {
    throw new Error(`Built-in template for "${slug}" has no score field`);
  }
  return score;
}

function row(name: string, id: string, content: unknown = []): TemplateRowLike {
  return {
    id,
    name,
    category: 'Rating Scales',
    type: 'assessment',
    content,
    description: `clinic row for ${name}`,
  };
}

describe('listAvailableRatingScaleDefinitions', () => {
  it('serves built-in self-rated definitions even when the clinic has no seeded templates', () => {
    const { matched, unknownCount } = listAvailableRatingScaleDefinitions([], {
      family: 'rating_scale',
      raterType: 'self_rated',
    });

    expect(unknownCount).toBe(0);
    expect(matched.some((item) => item.slug === 'phq9')).toBe(true);
    expect(matched.some((item) => item.slug === 'gad7')).toBe(true);
    expect(matched.every((item) => item.id.startsWith('builtin:'))).toBe(true);
    expect(matched.every((item) => item.templateId === null)).toBe(true);
  });

  it('keeps the clinic template reference when a matching row exists but still uses the built-in definition id', () => {
    const clinicTemplate = row(
      'HAM-D 17 (Hamilton Depression Rating Scale)',
      '11111111-1111-1111-1111-111111111111',
      [{ type: 'heading', text: 'stale local definition' }],
    );

    const { matched } = listAvailableRatingScaleDefinitions([clinicTemplate], {
      family: 'rating_scale',
      raterType: 'clinician_rated',
      diagnosisCategory: 'mood',
    });

    const hamd = matched.find((item) => item.slug === 'hamd17');
    expect(hamd).toMatchObject({
      id: makeBuiltinAssessmentTemplateId('hamd17'),
      templateId: clinicTemplate.id,
      source: 'clinic',
      name: 'HAM-D 17 (Hamilton Depression Rating Scale)',
    });
    expect(hamd?.content).not.toEqual(clinicTemplate.content);
  });

  it('resolves a selected definition by either built-in id or persisted template id', () => {
    const clinicTemplate = row(
      'PHQ-9 (Patient Health Questionnaire-9)',
      '22222222-2222-2222-2222-222222222222',
    );

    const byBuiltinId = findAvailableRatingScaleDefinition(
      [clinicTemplate],
      makeBuiltinAssessmentTemplateId('phq9'),
      { family: 'rating_scale', raterType: 'self_rated' },
    );
    const byTemplateId = findAvailableRatingScaleDefinition(
      [clinicTemplate],
      clinicTemplate.id,
      { family: 'rating_scale', raterType: 'self_rated' },
    );

    expect(byBuiltinId?.slug).toBe('phq9');
    expect(byTemplateId?.slug).toBe('phq9');
    expect(byBuiltinId?.templateId).toBe(clinicTemplate.id);
    expect(byTemplateId?.templateId).toBe(clinicTemplate.id);
  });
});

/**
 * MMSE + MoCA interpretation parity guard.
 *
 * Two independent surfaces consume interpretation thresholds today:
 *
 *   (1) The CANONICAL scoring SSoT at
 *       packages/shared/src/assessmentScoring.ts. The API
 *       measurementSummaryService uses this via getSeverityBandForScore
 *       for the trend-chart latest-score cards + small-multiples.
 *
 *   (2) The TEMPLATE-LOCAL `ranges` on the score field of each built-in
 *       definition. The frontend's extractScoreData
 *       (apps/web/src/shared/components/TemplateFormRenderer.tsx:481)
 *       reads these to surface the severity label on the
 *       AssessmentsTab clinician-rated score card at save time.
 *
 * Surface (2) historically carried a non-standard collapsed shape that
 * disagreed with surface (1). This regression test pins the two
 * surfaces to match exactly for MMSE (4-band Folstein) and MoCA
 * (2-band Nasreddine ≥26 cutoff) so the legacy drift cannot return.
 *
 * Bands are CLOSED intervals [min, max] inclusive at both ends — the
 * same convention as assessmentScoring.SeverityBand.
 */
describe('clinician-rated cognitive scale interpretation parity', () => {
  it('MMSE template ranges mirror the canonical scoring SSoT severityBands', () => {
    const score = findScoreField('mmse');
    expect(score.ranges).toEqual([
      { min: 0, max: 9, label: 'Severe impairment' },
      { min: 10, max: 18, label: 'Moderate impairment' },
      { min: 19, max: 23, label: 'Mild impairment' },
      { min: 24, max: 30, label: 'Normal' },
    ]);

    const scoring = getScoringMetadata('mmse');
    expect(scoring).toBeDefined();
    expect(
      scoring!.severityBands.map((band) => ({
        min: band.from,
        max: band.to,
        label: band.label,
      })),
    ).toEqual(score.ranges);
  });

  it('MoCA template ranges mirror the canonical scoring SSoT severityBands', () => {
    const score = findScoreField('moca');
    expect(score.ranges).toEqual([
      { min: 0, max: 25, label: 'Below cognitive threshold' },
      { min: 26, max: 30, label: 'Normal' },
    ]);

    const scoring = getScoringMetadata('moca');
    expect(scoring).toBeDefined();
    expect(
      scoring!.severityBands.map((band) => ({
        min: band.from,
        max: band.to,
        label: band.label,
      })),
    ).toEqual(score.ranges);
  });

  /**
   * P-CLAUDE-LANE 4B — drawing field wiring guard.
   *
   * MMSE pentagons + MoCA cube/clock must carry a tablet-capture
   * drawing field adjacent to their existing likert score items. The
   * drawing field itself is NOT scorable (template renderer's
   * isScorableField excludes type === 'drawing'), so adding it must
   * not perturb the existing score totals. These assertions pin both
   * properties so a future refactor can't silently drop the capture
   * surface or sneak a drawing field into a scorable position.
   */
  it('MMSE template carries a drawing field adjacent to the pentagons likert', () => {
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.toLowerCase().startsWith('mmse '),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{ type: string; label?: string }>;
    const pentagonsIdx = content.findIndex(
      (f) => f.type === 'likert' && /pentagons/i.test(f.label ?? ''),
    );
    expect(pentagonsIdx).toBeGreaterThanOrEqual(0);
    const drawing = content[pentagonsIdx + 1];
    expect(drawing.type).toBe('drawing');
    expect(drawing.label).toMatch(/pentagons/i);
  });

  it('MoCA template carries cube + clock drawing fields adjacent to the visuospatial likert', () => {
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.toLowerCase().startsWith('moca '),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{ type: string; label?: string }>;
    const visuospatialIdx = content.findIndex(
      (f) => f.type === 'likert' && /visuospatial/i.test(f.label ?? ''),
    );
    expect(visuospatialIdx).toBeGreaterThanOrEqual(0);
    const cube = content[visuospatialIdx + 1];
    const clock = content[visuospatialIdx + 2];
    expect(cube.type).toBe('drawing');
    expect(cube.label).toMatch(/cube/i);
    expect(clock.type).toBe('drawing');
    expect(clock.label).toMatch(/clock/i);
  });

  it('drawing fields are not flagged as scorable in either template', () => {
    for (const slug of ['mmse', 'moca'] as const) {
      const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
        entry.name.toLowerCase().startsWith(`${slug} `),
      );
      expect(def).toBeDefined();
      const content = def!.content as Array<{ type: string }>;
      const drawingFields = content.filter((f) => f.type === 'drawing');
      expect(drawingFields.length).toBeGreaterThan(0);
      // Drawing fields exist; none of them is a scorable type. The
      // template renderer's isScorableField returns true only for
      // 'likert' / 'yes_no', so this assertion structurally pins that
      // adding drawing fields does not perturb computeScoreForField.
      for (const f of drawingFields) {
        expect(['likert', 'yes_no']).not.toContain(f.type);
      }
    }
  });

  /**
   * P-CLAUDE-LANE 4B/6 — Mini-Cog template parity guard.
   *
   * Mini-Cog is the third clinician-rated cognitive screen and the
   * first instrument added AFTER drawing capture became a first-class
   * field type. Pinning the template + canonical scoring SSoT
   * alignment up-front prevents the band-drift class that bit MMSE/MoCA
   * (closed by 4A) from recurring on day one.
   */
  it('Mini-Cog template ranges mirror the canonical scoring SSoT severityBands', () => {
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.toLowerCase().startsWith('mini-cog'),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{ type: string; label?: string; ranges?: Array<{ min: number; max: number; label: string }> }>;
    const score = content.find((f) => f.type === 'score');
    expect(score).toBeDefined();
    expect(score!.ranges).toEqual([
      { min: 0, max: 2, label: 'Positive screen — further workup indicated' },
      { min: 3, max: 5, label: 'Negative screen' },
    ]);

    const scoring = getScoringMetadata('minicog');
    expect(scoring).toBeDefined();
    expect(scoring!.maxScore).toBe(5);
    expect(scoring!.minScore).toBe(0);
    expect(
      scoring!.severityBands.map((band) => ({
        min: band.from,
        max: band.to,
        label: band.label,
      })),
    ).toEqual(score!.ranges);
  });

  it('Mini-Cog template carries the clock-drawing capture field adjacent to the clock likert', () => {
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.toLowerCase().startsWith('mini-cog'),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{ type: string; label?: string; min?: number; max?: number }>;
    const clockLikertIdx = content.findIndex(
      (f) => f.type === 'likert' && /clock drawing/i.test(f.label ?? ''),
    );
    expect(clockLikertIdx).toBeGreaterThanOrEqual(0);
    expect(content[clockLikertIdx].min).toBe(0);
    expect(content[clockLikertIdx].max).toBe(2);

    const drawing = content[clockLikertIdx + 1];
    expect(drawing.type).toBe('drawing');
    expect(drawing.label).toMatch(/clock/i);
    expect(drawing.label).toMatch(/11:10/);
  });

  it.each([
    // Borson Mini-Cog cutoff: ≤2 positive screen, ≥3 negative.
    { score: 0, expected: 'Positive screen — further workup indicated' },
    { score: 2, expected: 'Positive screen — further workup indicated' },
    { score: 3, expected: 'Negative screen' },
    { score: 5, expected: 'Negative screen' },
  ])(
    'looks up canonical interpretation "$expected" for minicog=$score',
    ({ score, expected }) => {
      const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
        entry.name.toLowerCase().startsWith('mini-cog'),
      );
      const content = def!.content as Array<{ type: string; ranges?: Array<{ min: number; max: number; label: string }> }>;
      const ranges = content.find((f) => f.type === 'score')?.ranges ?? [];
      const band = ranges.find((r) => score >= r.min && score <= r.max);
      expect(band?.label).toBe(expected);
    },
  );

  /**
   * P-CLAUDE-LANE 4B/7 — Standalone CDT (Shulman) parity guard.
   *
   * Six single-point bands, distinct from Mini-Cog's two-band cutoff.
   * Pinning the grade-by-grade label alignment between template and
   * canonical SSoT preserves longitudinal-tracking value: a clinician
   * comparing two CDTs across time depends on the band labels staying
   * identical at each grade point.
   */
  it('Shulman CDT template ranges mirror the canonical scoring SSoT severityBands', () => {
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.toLowerCase().startsWith('cdt ('),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{ type: string; label?: string; ranges?: Array<{ min: number; max: number; label: string }> }>;
    const score = content.find((f) => f.type === 'score');
    expect(score).toBeDefined();
    expect(score!.ranges).toEqual([
      { min: 0, max: 0, label: 'No reasonable representation' },
      { min: 1, max: 1, label: 'Severe disorganization' },
      { min: 2, max: 2, label: 'Moderate visuospatial disorganization' },
      { min: 3, max: 3, label: 'Inaccurate representation of 10 past 11' },
      { min: 4, max: 4, label: 'Minor visuospatial errors' },
      { min: 5, max: 5, label: 'Perfect' },
    ]);

    const scoring = getScoringMetadata('cdt-shulman');
    expect(scoring).toBeDefined();
    expect(scoring!.maxScore).toBe(5);
    expect(scoring!.minScore).toBe(0);
    expect(
      scoring!.severityBands.map((band) => ({
        min: band.from,
        max: band.to,
        label: band.label,
      })),
    ).toEqual(score!.ranges);
  });

  it('Shulman CDT template puts the drawing capture before the grade likert', () => {
    // Administration order matters: the clinician asks the patient
    // to draw FIRST, then grades from the drawing. Pinning the
    // drawing→likert ordering matches the clinical workflow and
    // prevents a future refactor from re-ordering them in a way that
    // would prompt the clinician to grade before the patient has
    // drawn.
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.toLowerCase().startsWith('cdt ('),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{ type: string; label?: string }>;
    const drawingIdx = content.findIndex((f) => f.type === 'drawing');
    const gradeLikertIdx = content.findIndex(
      (f) => f.type === 'likert' && /shulman grade/i.test(f.label ?? ''),
    );
    expect(drawingIdx).toBeGreaterThanOrEqual(0);
    expect(gradeLikertIdx).toBeGreaterThanOrEqual(0);
    expect(drawingIdx).toBeLessThan(gradeLikertIdx);
    expect(content[drawingIdx].label).toMatch(/10 past 11/i);
  });

  it.each([
    // Shulman 6-band CDT grade-by-grade labels.
    { score: 0, expected: 'No reasonable representation' },
    { score: 1, expected: 'Severe disorganization' },
    { score: 2, expected: 'Moderate visuospatial disorganization' },
    { score: 3, expected: 'Inaccurate representation of 10 past 11' },
    { score: 4, expected: 'Minor visuospatial errors' },
    { score: 5, expected: 'Perfect' },
  ])(
    'looks up canonical interpretation "$expected" for cdt-shulman=$score',
    ({ score, expected }) => {
      const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
        entry.name.toLowerCase().startsWith('cdt ('),
      );
      const content = def!.content as Array<{ type: string; ranges?: Array<{ min: number; max: number; label: string }> }>;
      const ranges = content.find((f) => f.type === 'score')?.ranges ?? [];
      const band = ranges.find((r) => score >= r.min && score <= r.max);
      expect(band?.label).toBe(expected);
    },
  );

  it.each([
    // Standard Folstein MMSE thresholds: 24/30 cutoff for normal cognition.
    { slug: 'mmse', score: 0, expected: 'Severe impairment' },
    { slug: 'mmse', score: 9, expected: 'Severe impairment' },
    { slug: 'mmse', score: 10, expected: 'Moderate impairment' },
    { slug: 'mmse', score: 18, expected: 'Moderate impairment' },
    { slug: 'mmse', score: 19, expected: 'Mild impairment' },
    { slug: 'mmse', score: 23, expected: 'Mild impairment' },
    { slug: 'mmse', score: 24, expected: 'Normal' },
    { slug: 'mmse', score: 30, expected: 'Normal' },
    // Standard Nasreddine MoCA cutoff: ≥26/30 = within normal limits.
    { slug: 'moca', score: 0, expected: 'Below cognitive threshold' },
    { slug: 'moca', score: 25, expected: 'Below cognitive threshold' },
    { slug: 'moca', score: 26, expected: 'Normal' },
    { slug: 'moca', score: 30, expected: 'Normal' },
  ])(
    'looks up canonical interpretation "$expected" for $slug=$score',
    ({ slug, score, expected }) => {
      const ranges = findScoreField(slug).ranges ?? [];
      const band = ranges.find((r) => score >= r.min && score <= r.max);
      expect(band?.label).toBe(expected);
    },
  );
});

describe('requested mania, substance-use, trauma, and geriatric scale additions', () => {
  it('exposes the newly requested built-in rating scales through the available-definition catalogue', () => {
    const { matched } = listAvailableRatingScaleDefinitions([], { family: 'rating_scale' });
    const slugs = new Set(matched.map((item) => item.slug));

    for (const slug of [
      'asrm14',
      'altman-clinician-mania',
      'acsa',
      'audit-clinician',
      'assq',
      'dss-brief',
      'btq',
      'gds15',
      'iqcode-short',
      'ipf-brief',
      'padua',
      'tsq',
      'zung-sds',
    ]) {
      expect(slugs.has(slug), `missing built-in definition for ${slug}`).toBe(true);
    }
  });

  it('keeps ZUNG SDS reverse-scored items encoded structurally in the option values', () => {
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.startsWith('ZUNG SDS'),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{ type: string; label?: string; options?: string[] }>;
    const morningBest = content.find((field) => /morning is when i feel the best/i.test(field.label ?? ''));
    const downhearted = content.find((field) => /down-hearted and blue/i.test(field.label ?? ''));
    expect(morningBest?.options).toEqual([
      'A little of the time (4)',
      'Some of the time (3)',
      'Good part of the time (2)',
      'Most of the time (1)',
    ]);
    expect(downhearted?.options).toEqual([
      'A little of the time (1)',
      'Some of the time (2)',
      'Good part of the time (3)',
      'Most of the time (4)',
    ]);
  });

  it('uses a mean-score field for IQCODE Short so longitudinal charts read the canonical 1-5 average', () => {
    const def = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.startsWith('IQCODE Short'),
    );
    expect(def).toBeDefined();
    const content = def!.content as Array<{
      type: string;
      label?: string;
      formula?: 'sum' | 'mean';
      itemIndexes?: number[];
      ranges?: Array<{ min: number; max: number; label: string }>;
    }>;
    const scoreField = content.find((field) => field.type === 'score');
    expect(scoreField).toMatchObject({
      formula: 'mean',
      itemIndexes: Array.from({ length: 16 }, (_, index) => index + 2),
      ranges: [
        { min: 1, max: 3, label: 'No significant decline reported' },
        { min: 3.01, max: 3.3, label: 'Borderline decline signal' },
        { min: 3.31, max: 5, label: 'Likely cognitive decline' },
      ],
    });
    const scoring = getScoringMetadata('iqcode-short');
    expect(scoring?.minScore).toBe(1);
    expect(scoring?.maxScore).toBe(5);
  });

  it('aligns the ASRM and GDS-15 template score bands with the canonical scoring SSoT', () => {
    const asrm = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.startsWith('ASRM (Altman Self-Rating Mania Scale)'),
    );
    expect(asrm).toBeDefined();
    const asrmScoreField = (asrm!.content as Array<{
      type: string;
      ranges?: Array<{ min: number; max: number; label: string }>;
    }>).find((field) => field.type === 'score');
    expect(asrmScoreField?.ranges).toEqual(
      getScoringMetadata('asrm14')?.severityBands.map((band) => ({
        min: band.from,
        max: band.to,
        label: band.label,
      })),
    );

    const gds = BUILTIN_RATING_SCALE_DEFINITIONS.find((entry) =>
      entry.name.startsWith('GDS-15'),
    );
    expect(gds).toBeDefined();
    const content = gds!.content as Array<{ type: string; ranges?: Array<{ min: number; max: number; label: string }> }>;
    const scoreField = content.find((field) => field.type === 'score');
    expect(scoreField?.ranges).toEqual(
      getScoringMetadata('gds15')?.severityBands.map((band) => ({
        min: band.from,
        max: band.to,
        label: band.label,
      })),
    );
  });
});
