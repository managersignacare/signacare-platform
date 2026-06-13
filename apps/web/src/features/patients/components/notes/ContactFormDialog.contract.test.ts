import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ContactFormDialog template contract', () => {
  const source = readFileSync(resolve(__dirname, './ContactFormDialog.tsx'), 'utf8');

  it('uses canonical published contact-form templates instead of the legacy staff-settings feed', () => {
    expect(source).toContain('useTemplates({');
    expect(source).toContain("status: 'published'");
    expect(source).toContain("category: 'Contact Forms'");
    expect(source).not.toContain("staff-settings/templates");
  });

  it('renders selected templates through the canonical section-to-draft mapper', () => {
    expect(source).toContain('templateSectionsToDraftText(');
  });
});
