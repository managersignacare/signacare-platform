import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

const moduleKeysSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'shared', 'moduleKeys.ts'),
  'utf8',
);

const moduleToPermissionSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'shared', 'moduleToPermission.ts'),
  'utf8',
);

const routeSource = readFileSync(
  resolve(__dirname, '..', '..', 'src', 'features', 'llm', 'agenticScribeRoutes.ts'),
  'utf8',
);

describe('BUG-AGENTIC-SCRIBE-MODULE-GUARD-RAILS', () => {
  test('canonical module key exists', () => {
    expect(moduleKeysSource).toContain("AGENTIC_AI_SCRIBE:   'agentic-ai-scribe'");
  });

  test('permission fallback map includes agentic-ai-scribe', () => {
    expect(moduleToPermissionSource).toContain("'agentic-ai-scribe': {");
  });

  test('route enforces clinic module toggle fail-closed for missing rows', () => {
    expect(routeSource).toContain('missingRowPolicy: \'disabled\'');
    expect(routeSource).toContain('requireClinicModuleEnabled(MODULE_KEYS.AGENTIC_AI_SCRIBE');
  });

  test('task materialization endpoint requires module write grant', () => {
    expect(routeSource).toContain('requireModuleWrite(MODULE_KEYS.AGENTIC_AI_SCRIBE)');
    expect(routeSource).toContain("'/tasks/from-drafts'");
  });
});
