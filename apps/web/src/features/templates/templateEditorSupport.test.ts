import { describe, expect, it } from 'vitest';
import {
  buildTemplateCategoryList,
  cloneSectionsForEdit,
  createEmptySection,
  filterTemplates,
  normalizeTemplateForSave,
} from './templateEditorSupport';
import type { TemplateResponse } from './types/templateTypes';

const baseTemplate: TemplateResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  clinicId: '22222222-2222-2222-2222-222222222222',
  name: 'Mental State Examination',
  description: 'Standard review template',
  category: 'Clinical Notes',
  status: 'draft',
  createdById: '33333333-3333-3333-3333-333333333333',
  publishedAt: null,
  retiredAt: null,
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
  sections: [
    {
      id: '44444444-4444-4444-4444-444444444444',
      templateId: '11111111-1111-1111-1111-111111111111',
      label: 'Subjective',
      fieldType: 'text',
      soapField: 'subjective',
      required: true,
      position: 0,
      options: undefined,
      minValue: undefined,
      maxValue: undefined,
      placeholder: 'Summarise symptoms',
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    },
  ],
};

describe('createEmptySection', () => {
  it('seeds select sections with canonical starter options', () => {
    const section = createEmptySection('single_select', 2);

    expect(section.position).toBe(2);
    expect(section.options).toEqual([
      { label: 'Option 1', value: 'option_1' },
      { label: 'Option 2', value: 'option_2' },
    ]);
  });

  it('seeds likert sections with a numeric range', () => {
    const section = createEmptySection('likert', 1);

    expect(section.minValue).toBe(0);
    expect(section.maxValue).toBe(5);
  });
});

describe('cloneSectionsForEdit', () => {
  it('maps response sections back into editable template sections', () => {
    expect(cloneSectionsForEdit(baseTemplate)).toEqual([
      {
        id: '44444444-4444-4444-4444-444444444444',
        label: 'Subjective',
        fieldType: 'text',
        soapField: 'subjective',
        required: true,
        position: 0,
        options: undefined,
        minValue: undefined,
        maxValue: undefined,
        placeholder: 'Summarise symptoms',
      },
    ]);
  });
});

describe('normalizeTemplateForSave', () => {
  it('trims strings, normalizes options, and reindexes positions', () => {
    const dto = normalizeTemplateForSave({
      name: '  Intake letter  ',
      category: '  Letters ',
      description: '  Used after assessment  ',
      sections: [
        {
          label: '  Recipient type  ',
          fieldType: 'single_select',
          required: true,
          position: 99,
          options: [
            { label: ' Patient ', value: '' },
            { label: ' ', value: 'discard-me' },
            { label: ' Provider ', value: 'provider' },
          ],
        },
      ],
    });

    expect(dto).toEqual({
      name: 'Intake letter',
      category: 'Letters',
      description: 'Used after assessment',
      sections: [
        {
          label: 'Recipient type',
          fieldType: 'single_select',
          required: true,
          position: 0,
          soapField: undefined,
          placeholder: undefined,
          minValue: undefined,
          maxValue: undefined,
          options: [
            { label: 'Patient', value: 'patient', score: undefined },
            { label: 'Provider', value: 'provider', score: undefined },
          ],
        },
      ],
    });
  });
});

describe('filterTemplates', () => {
  const templates: TemplateResponse[] = [
    baseTemplate,
    {
      ...baseTemplate,
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Discharge summary',
      category: 'Reports',
      status: 'published',
      description: 'Final discharge report',
    },
  ];

  it('matches by status, category, and free-text query', () => {
    const filtered = filterTemplates({
      templates,
      status: 'published',
      category: 'Reports',
      query: 'discharge',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('55555555-5555-5555-5555-555555555555');
  });
});

describe('buildTemplateCategoryList', () => {
  it('returns unique sorted category names', () => {
    expect(buildTemplateCategoryList({
      managedCategories: ['Care Planning', 'Letters'],
      currentCategory: 'Referral Letters',
    })).toEqual([
      'Care Planning',
      'Letters',
      'Referral Letters',
    ]);
  });

  it('returns the current category even when the managed catalogue is otherwise empty', () => {
    expect(buildTemplateCategoryList({
      managedCategories: [],
      currentCategory: 'Clinical Notes',
    })).toEqual(['Clinical Notes']);
  });
});
