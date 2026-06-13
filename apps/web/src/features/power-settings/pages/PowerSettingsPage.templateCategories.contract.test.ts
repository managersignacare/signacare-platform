import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PowerSettingsPage template-category ownership', () => {
  const source = readFileSync(resolve(__dirname, './PowerSettingsPage.tsx'), 'utf8');

  it('uses the canonical templates feature for template-category admin', () => {
    expect(source).toContain('templateApi.listCategories()');
    expect(source).toContain('templateApi.createCategory');
    expect(source).toContain('templateApi.updateCategory');
    expect(source).toContain('templateApi.deleteCategory');
    expect(source).toContain('qc.invalidateQueries({ queryKey: templateKeys.all })');
    expect(source).not.toContain('staff-settings/template-categories');
  });
});
