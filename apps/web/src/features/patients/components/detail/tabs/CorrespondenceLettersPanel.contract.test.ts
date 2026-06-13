import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CorrespondenceLettersPanel template contract', () => {
  const source = readFileSync(resolve(__dirname, './CorrespondenceLettersPanel.tsx'), 'utf8');

  it('uses canonical published letter templates instead of the legacy staff-settings feed', () => {
    expect(source).toContain('useTemplates({');
    expect(source).toContain("status: 'published'");
    expect(source).toContain("category: 'Letters'");
    expect(source).not.toContain("staff-settings/templates");
  });

  it('renders selected letter templates through the canonical section-to-draft mapper', () => {
    expect(source).toContain('templateSectionsToDraftText(');
  });
});
