import { describe, expect, it } from 'vitest';
import { applyLetterDraftSafetyFilter } from '../../src/features/llm/letterDraftSafety';

describe('letterDraftSafety', () => {
  it('LDS-1: removes identifier/contact/header lines from AI draft body', () => {
    const input = [
      'Dear Dr Smith,',
      'Re: John Citizen, DOB: 01/01/1980, UR: 12345678',
      'Please email me at specialist@example.com',
      'Phone: +61 3 9123 4567',
      '',
      'Medication was adjusted to quetiapine 50 mg nocte.',
      'Follow-up is planned in 2 weeks.',
      '',
      'Kind regards,',
    ].join('\n');

    const result = applyLetterDraftSafetyFilter(input);

    expect(result.hadSensitiveContent).toBe(true);
    expect(result.removedLineCount).toBe(5);
    expect(result.sanitisedBody).toContain('Medication was adjusted');
    expect(result.sanitisedBody).toContain('Follow-up is planned');
    expect(result.sanitisedBody).not.toMatch(/dob|ur:|email|phone|dear|regards/i);
  });

  it('LDS-2: preserves clinically-relevant body text when no sensitive markers exist', () => {
    const input = [
      'The patient reports improved sleep and fewer panic symptoms.',
      'No adverse effects reported on current dose.',
      'Recommend continuing current therapy and review in four weeks.',
    ].join('\n');

    const result = applyLetterDraftSafetyFilter(input);

    expect(result.hadSensitiveContent).toBe(false);
    expect(result.removedLineCount).toBe(0);
    expect(result.sanitisedBody).toBe(input);
  });

  it('LDS-3: emits manual-review fallback if all lines are filtered', () => {
    const input = [
      'Re: Jane Doe DOB: 12/12/1981',
      'Email: jane@example.com',
      'Phone: 0400 000 000',
    ].join('\n');

    const result = applyLetterDraftSafetyFilter(input);

    expect(result.hadSensitiveContent).toBe(true);
    expect(result.removedLineCount).toBe(3);
    expect(result.sanitisedBody).toContain('Clinical summary drafted from consultation notes');
  });
});
