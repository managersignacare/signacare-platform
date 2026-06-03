import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-safety-route-integration-coverage';

const TMP_BASE = join(tmpdir(), 'check-safety-route-integration-coverage-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(
  name: string,
  params?: {
    routeInTest?: string;
    routeInManifest?: string;
    safetySurfacePath?: string;
    sourceRefs?: string[];
    testHasExpect?: boolean;
  },
): {
  manifestPath: string;
  safetySurfacesPath: string;
  l4ChecklistPath: string;
} {
  const dir = join(TMP_BASE, name);
  const testDir = join(dir, 'apps', 'api', 'tests', 'integration');
  mkdirSync(testDir, { recursive: true });

  const testSource = [
    "import { it, expect } from 'vitest';",
    "import request from 'supertest';",
    "it('mapped route is asserted', async () => {",
    `  const res = await request({} as never).post('${params?.routeInTest ?? '/api/v1/llm/agent'}');`,
    params?.testHasExpect === false ? '' : '  expect(res).toBeDefined();',
    '});',
  ].join('\n');
  writeFileSync(join(testDir, 'fixture.int.test.ts'), testSource, 'utf8');

  const manifest = {
    version: 1,
    generatedAt: '2026-05-11',
    purpose: 'test fixture',
    entries: [
      {
        id: 'SR-TEST-001',
        owner: 'api-safety',
        harmClass: 'S1',
        method: 'POST',
        route: params?.routeInManifest ?? '/api/v1/llm/agent',
        safetySurfacePath: params?.safetySurfacePath ?? 'apps/api/src/features/llm/',
        sourceRefs: params?.sourceRefs ?? [
          '.github/safety-surfaces.txt',
          'docs/quality/l4-reviewer-checklist.md#f',
        ],
        expectedIntegrationTests: [
          join(testDir, 'fixture.int.test.ts'),
        ],
      },
    ],
  };
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const safetySurfacesPath = join(dir, 'safety-surfaces.txt');
  writeFileSync(
    safetySurfacesPath,
    [
      '# fixture safety surfaces',
      'apps/api/src/features/llm/',
    ].join('\n'),
    'utf8',
  );

  const l4ChecklistPath = join(dir, 'l4-reviewer-checklist.md');
  writeFileSync(
    l4ChecklistPath,
    [
      '# fixture checklist',
      'apps/api/src/features/llm/',
    ].join('\n'),
    'utf8',
  );

  return { manifestPath, safetySurfacesPath, l4ChecklistPath };
}

describe('check-safety-route-integration-coverage', () => {
  it('passes for valid mapped route coverage', () => {
    const fixture = writeFixture('pass');
    const result = runGuard(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when mapped test does not cover the declared route', () => {
    const fixture = writeFixture('uncovered-route', {
      routeInManifest: '/api/v1/llm/clinical-ai',
      routeInTest: '/api/v1/llm/agent',
    });
    const result = runGuard(fixture);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('no mapped integration assertion'))).toBe(true);
  });

  it('fails when sourceRefs are missing the required anchors', () => {
    const fixture = writeFixture('missing-source-refs', {
      sourceRefs: ['.github/safety-surfaces.txt'],
    });
    const result = runGuard(fixture);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('missing required sourceRef'))).toBe(true);
  });
});
