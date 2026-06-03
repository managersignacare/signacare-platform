import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pathwayRoutesSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'treatment-pathways', 'pathwayRoutes.ts'),
  'utf8',
);
const clinicModuleMiddlewareSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'middleware', 'clinicModuleMiddleware.ts'),
  'utf8',
);
const moduleKeysSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'shared', 'moduleKeys.ts'),
  'utf8',
);
const moduleToPermissionSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'shared', 'moduleToPermission.ts'),
  'utf8',
);

describe('BUG-PATHWAYS-MODULE-GUARDS', () => {
  test('pathway routes enforce tenant + module-read at router level', () => {
    expect(pathwayRoutesSource).toContain('router.use(authMiddleware, tenantMiddleware);');
    expect(pathwayRoutesSource).toContain('router.use(requireClinicModuleEnabled(MODULE_KEYS.PATHWAYS));');
    expect(pathwayRoutesSource).toContain('router.use(requireModuleRead(MODULE_KEYS.PATHWAYS));');
  });

  test('pathway write routes enforce module-write rails', () => {
    expect(pathwayRoutesSource).toContain("router.post('/', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS)");
    expect(pathwayRoutesSource).toContain("router.patch('/:id', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS)");
    expect(pathwayRoutesSource).toContain("router.post('/:id/session', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS)");
    expect(pathwayRoutesSource).toContain("router.post('/:id/digital-interventions/assign', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS)");
    expect(pathwayRoutesSource).toContain("router.post('/:id/digital-interventions/:packId/items/:itemId', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS)");
    expect(pathwayRoutesSource).toContain("router.post('/:id/thought-diary', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS)");
    expect(pathwayRoutesSource).toContain("router.post('/:id/sleep-hygiene/check-in', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS)");
  });

  test('module key and fallback permission mapping include pathways', () => {
    expect(moduleKeysSource).toContain("PATHWAYS:            'pathways'");
    expect(moduleToPermissionSource).toContain('pathways: {');
    expect(moduleToPermissionSource).toContain("read: ['note:read']");
    expect(moduleToPermissionSource).toContain("write: ['note:create', 'note:update']");
  });

  test('clinic module middleware returns MODULE_DISABLED when a module row is explicitly disabled', () => {
    expect(clinicModuleMiddlewareSource).toContain("code: 'MODULE_DISABLED'");
    expect(clinicModuleMiddlewareSource).toContain('module_key: moduleKey');
    expect(clinicModuleMiddlewareSource).toContain('row.is_enabled === false');
  });
});
