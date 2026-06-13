import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CareProvisionPanel source contract', () => {
  const source = readFileSync(resolve(__dirname, './CareProvisionPanel.tsx'), 'utf8');

  it('shows the review and contact recency cards in the care provision summary', () => {
    expect(source).toContain('Last Key Clinician Review');
    expect(source).toContain('Medical Review');
    expect(source).toContain('Consultant Psychiatrist Review');
    expect(source).toContain('Last GP Contact');
    expect(source).toContain('Last Family Contact');
  });

  it('hydrates the review cadence cards from episode allocation plus patient notes', () => {
    expect(source).toContain('episodesKeys.allocation');
    expect(source).toContain('staff/lookup');
    expect(source).toContain('findLatestNote');
  });
});
