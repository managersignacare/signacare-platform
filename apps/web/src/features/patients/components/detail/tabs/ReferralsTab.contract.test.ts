import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ReferralsTab template contract', () => {
  const source = readFileSync(resolve(__dirname, './ReferralsTab.tsx'), 'utf8');

  it('uses canonical published referral-letter templates instead of the legacy staff-settings feed', () => {
    expect(source).toContain('useTemplates({');
    expect(source).toContain("status: 'published'");
    expect(source).toContain("category: 'Referral Letters'");
    expect(source).not.toContain("staff-settings/templates");
  });

  it('renders selected referral templates through the canonical section-to-draft mapper', () => {
    expect(source).toContain('templateSectionsToDraftText(');
  });
});
