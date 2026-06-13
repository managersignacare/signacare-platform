import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NinetyOneDayReviewTab source contract', () => {
  const source = readFileSync(resolve(__dirname, './NinetyOneDayReviewTab.tsx'), 'utf8');

  it('renders recency cards for review and contact cadence instead of a medications quick card', () => {
    expect(source).toContain('Last Key Clinician Review');
    expect(source).toContain('Medical Review');
    expect(source).toContain('Consultant Psychiatrist Review');
    expect(source).toContain('Last GP Contact');
    expect(source).toContain('Last Family Contact');
    expect(source).not.toContain("label: 'Medications'");
  });

  it('feeds the review cadence data into the AI review summary', () => {
    expect(source).toContain('REVIEW & CONTACT CADENCE:');
    expect(source).toContain('Key clinician review:');
    expect(source).toContain('Consultant psychiatrist review:');
    expect(source).toContain('GP contact:');
    expect(source).toContain('Family contact:');
  });
});
