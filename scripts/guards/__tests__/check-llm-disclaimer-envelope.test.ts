import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-llm-disclaimer-envelope';

const TMP_BASE = join(tmpdir(), 'bug285-llm-disclaimer-envelope-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function fixtureRoot(name: string): string {
  const root = join(TMP_BASE, name);
  mkdirSync(root, { recursive: true });
  return root;
}

function writePassFixture(root: string): void {
  writeFixtureFile(
    root,
    'apps/api/src/features/llm/llmController.ts',
    `import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
export async function suggest(_req: unknown, res: { json: (x: unknown) => void }) {
  res.json({ ok: true, disclaimer: CLINICAL_AI_DISCLAIMER });
}
`,
  );

  writeFixtureFile(
    root,
    'apps/api/src/features/llm/llmRoutes.ts',
    `import { Router } from 'express';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
import { suggest } from './llmController';
const router = Router();
router.post('/suggest', suggest);
router.post('/clinical-ai', async (_req, res) => {
  res.json({ result: 'x', disclaimer: CLINICAL_AI_DISCLAIMER });
});
router.post('/agent', async (_req, res) => {
  res.json({ answer: 'x', disclaimer: CLINICAL_AI_DISCLAIMER });
});
export default router;
`,
  );

  writeFixtureFile(
    root,
    'apps/api/src/features/llm/scribeRoutes.ts',
    `import { Router } from 'express';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
const router = Router();
router.post('/patient-summary', async (_req, res) => {
  res.json({ summary: 'x', disclaimer: CLINICAL_AI_DISCLAIMER });
});
router.post('/referral-letter', async (_req, res) => {
  res.json({ letter: 'x', disclaimer: CLINICAL_AI_DISCLAIMER });
});
export default router;
`,
  );
}

describe('check-llm-disclaimer-envelope guard', () => {
  it('passes when all required LLM AI envelopes carry canonical disclaimer', () => {
    const root = fixtureRoot('pass');
    writePassFixture(root);

    const result = runGuard(root);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when /clinical-ai inline route loses disclaimer envelope', () => {
    const root = fixtureRoot('missing_clinical_ai_disclaimer');
    writePassFixture(root);
    writeFixtureFile(
      root,
      'apps/api/src/features/llm/llmRoutes.ts',
      `import { Router } from 'express';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
import { suggest } from './llmController';
const router = Router();
router.post('/suggest', suggest);
router.post('/clinical-ai', async (_req, res) => {
  res.json({ result: 'x' });
});
router.post('/agent', async (_req, res) => {
  res.json({ answer: 'x', disclaimer: CLINICAL_AI_DISCLAIMER });
});
export default router;
`,
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('/clinical-ai'))).toBe(true);
  });

  it('fails when suggest handler envelope loses disclaimer', () => {
    const root = fixtureRoot('missing_suggest_disclaimer');
    writePassFixture(root);
    writeFixtureFile(
      root,
      'apps/api/src/features/llm/llmController.ts',
      `export async function suggest(_req: unknown, res: { json: (x: unknown) => void }) {
  res.json({ ok: true });
}
`,
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('suggest handler'))).toBe(true);
  });
});
