import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AlertsPlansTab template contract', () => {
  const source = readFileSync(resolve(__dirname, './AlertsPlansTab.internal.tsx'), 'utf8');

  it('uses canonical published plan templates instead of the legacy staff-settings feed', () => {
    expect(source).toContain('useTemplates({');
    expect(source).toContain("status: 'published'");
    expect(source).not.toContain("staff-settings/templates");
  });

  it('renders selected plan templates through the canonical section-to-draft mapper', () => {
    expect(source).toContain('templateSectionsToDraftText(');
  });
});
