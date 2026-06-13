import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('template category wiring', () => {
  const dialogSource = readFileSync(
    resolve(__dirname, './components/TemplateEditorDialog.tsx'),
    'utf8',
  );
  const pageSource = readFileSync(
    resolve(__dirname, './pages/TemplatesPage.tsx'),
    'utf8',
  );

  it('drives editor category suggestions from the managed template category catalogue', () => {
    expect(dialogSource).toContain('useTemplateCategories');
    expect(dialogSource).toContain('.filter((item) => item.isActive)');
    expect(dialogSource).toContain('.map((item) => item.name)');
    expect(dialogSource).toContain('buildTemplateCategoryList');
    expect(dialogSource).not.toContain('useFallbackSuggestions');
    expect(dialogSource).not.toContain('TEMPLATE_CATEGORY_SUGGESTIONS');
  });

  it('drives the page category filter from the managed catalogue only', () => {
    expect(pageSource).toContain('useTemplateCategories');
    expect(pageSource).toContain('.filter((item) => item.isActive)');
    expect(pageSource).toContain('.map((item) => item.name)');
    expect(pageSource).toContain('buildTemplateCategoryList');
    expect(pageSource).not.toContain('useFallbackSuggestions');
    expect(pageSource).not.toContain('TEMPLATE_CATEGORY_SUGGESTIONS');
  });
});
