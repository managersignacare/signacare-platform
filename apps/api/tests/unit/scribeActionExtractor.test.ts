import { describe, expect, it } from 'vitest';
import { extractScribeActions } from '../../src/shared/scribeActionExtractor';

describe('scribeActionExtractor', () => {
  it('deduplicates pathology requests and preserves canonical test names', () => {
    const actions = extractScribeActions(
      [],
      [],
      'Please arrange pathology: FBC, U&E this week. Request FBC again if needed.',
    );
    const pathology = actions.filter((action) => action.type === 'pathology');
    expect(pathology).toHaveLength(2);
    expect(pathology.map((action) => action.details.test)).toEqual(['FBC', 'U&E']);
  });

  it('preserves follow-up modality and timeframe for agentic drafts', () => {
    const actions = extractScribeActions(
      [],
      [],
      'Book follow-up telehealth in 2 weeks.',
    );
    const followUp = actions.find((action) => action.type === 'appointment');
    expect(followUp).toBeDefined();
    expect(followUp?.details.timeframe).toBe('2 weeks');
    expect(followUp?.details.mode).toBe('telehealth');
    expect(followUp?.description.toLowerCase()).toContain('telehealth');
  });
});
