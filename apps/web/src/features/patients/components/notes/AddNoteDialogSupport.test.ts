import { describe, expect, it } from 'vitest';
import { templateSectionsToDraftText } from './AddNoteDialogSupport';
import type { TemplateSectionResponse } from '../../../templates/types/templateTypes';

const baseSection = {
  id: '11111111-1111-1111-1111-111111111111',
  templateId: '22222222-2222-2222-2222-222222222222',
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
  required: false,
  position: 0,
} satisfies Omit<TemplateSectionResponse, 'label' | 'fieldType'>;

describe('templateSectionsToDraftText', () => {
  it('renders canonical text, select, and likert sections into clinician-ready draft text', () => {
    const text = templateSectionsToDraftText([
      {
        ...baseSection,
        label: 'Mental State Examination',
        fieldType: 'heading',
      },
      {
        ...baseSection,
        label: 'Subjective',
        fieldType: 'text',
        soapField: 'subjective',
        position: 1,
      },
      {
        ...baseSection,
        label: 'Risk discussed',
        fieldType: 'yes_no',
        position: 2,
      },
      {
        ...baseSection,
        label: 'Plan',
        fieldType: 'single_select',
        position: 3,
        options: [
          { label: 'Continue', value: 'continue' },
          { label: 'Escalate', value: 'escalate' },
        ],
      },
      {
        ...baseSection,
        label: 'Engagement',
        fieldType: 'likert',
        position: 4,
        minValue: 1,
        maxValue: 10,
      },
    ]);

    expect(text).toContain('=== Mental State Examination ===');
    expect(text).toContain('Subjective:\n\n');
    expect(text).toContain('Risk discussed: [ ] Yes  [ ] No');
    expect(text).toContain('Plan: [ ] Continue  [ ] Escalate');
    expect(text).toContain('Engagement: [1-10]');
  });

  it('includes placeholder guidance for free-text fields without SOAP mapping', () => {
    const text = templateSectionsToDraftText([
      {
        ...baseSection,
        label: 'Summary',
        fieldType: 'text',
        placeholder: 'Brief narrative',
      },
    ]);

    expect(text).toBe('Summary — Brief narrative\n\n');
  });
});
