import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const templateRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'templates', 'template.routes.ts'),
  'utf8',
);

describe('template category routes contract', () => {
  it('mounts the static categories routes before the generic /:id route', () => {
    const categoriesIndex = templateRoutesSource.indexOf("router.get('/categories'");
    const detailIndex = templateRoutesSource.indexOf("router.get('/:id'");

    expect(categoriesIndex).toBeGreaterThan(-1);
    expect(detailIndex).toBeGreaterThan(-1);
    expect(categoriesIndex).toBeLessThan(detailIndex);
  });

  it('requires admin role for template category mutations', () => {
    expect(templateRoutesSource).toContain("const admin = requireRole('admin', 'superadmin');");
    expect(templateRoutesSource).toContain("router.post('/categories',          admin, ctrl.createCategory);");
    expect(templateRoutesSource).toContain("router.patch('/categories/:id',     admin, ctrl.updateCategory);");
    expect(templateRoutesSource).toContain("router.delete('/categories/:id',    admin, ctrl.deleteCategory);");
  });
});
