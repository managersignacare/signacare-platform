import { describe, expect, it } from 'vitest';
import {
  findAvailableRatingScaleDefinition,
  listAvailableRatingScaleDefinitions,
  makeBuiltinAssessmentTemplateId,
} from './builtinAssessmentDefinitions';
import type { TemplateRowLike } from './assessmentRegistry';

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
