import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const templateRepositorySource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'templates', 'template.repository.ts'),
  'utf8',
);

const templateServiceSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'templates', 'template.service.ts'),
  'utf8',
);

describe('template category persistence contract', () => {
  it('propagates managed category renames into canonical templates', () => {
    expect(templateRepositorySource).toContain("await trx('templates')");
    expect(templateRepositorySource).toContain(".where({ clinic_id: clinicId, category: existing.name })");
    expect(templateRepositorySource).toContain(".update({ category: patch.name, updated_at: trx.fn.now() })");
  });

  it('blocks category deletion while templates still reference it', () => {
    expect(templateServiceSource).toContain('countTemplatesUsingCategory');
    expect(templateServiceSource).toContain("'TEMPLATE_CATEGORY_IN_USE'");
    expect(templateServiceSource).toContain('Template category is still in use by existing templates');
  });

  it('blocks duplicate category names before create or rename can make template ownership ambiguous', () => {
    expect(templateRepositorySource).toContain('findCategoryByName');
    expect(templateRepositorySource).toContain("whereRaw('LOWER(name) = LOWER(?)'");
    expect(templateServiceSource).toContain("'TEMPLATE_CATEGORY_NAME_CONFLICT'");
    expect(templateServiceSource).toContain('Template category name already exists');
  });
});
