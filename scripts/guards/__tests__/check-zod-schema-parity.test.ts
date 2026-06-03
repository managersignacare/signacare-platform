/*
 * scripts/guards/__tests__/check-zod-schema-parity.test.ts
 *
 * Phase R1 PR-R1-11 — symmetric vitest spec for the convention-based
 * Zod schema parity guard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findConventionalRule } from '../check-zod-schema-parity';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const GUARD_PATH = join(REPO_ROOT, 'scripts', 'guards', 'check-zod-schema-parity.ts');
const SYNTH_DIR = join(REPO_ROOT, 'packages', 'shared', 'src', '_zsynth_test_pr_r1_11');

/**
 * The guard's SCAN_ROOT is `packages/shared/src/`, so synthetic
 * fixtures must live there to be scanned. Cycle-2 absorb of L3
 * observation #3: SIGKILL during a prior run could leave residue.
 * `beforeAll` / `afterAll` clean up any stale fixture dir; each
 * test's `try/finally` removes its own residue too.
 */
beforeAll(() => {
  if (existsSync(SYNTH_DIR)) rmSync(SYNTH_DIR, { recursive: true, force: true });
});
afterAll(() => {
  if (existsSync(SYNTH_DIR)) rmSync(SYNTH_DIR, { recursive: true, force: true });
});

function runGuardOnSynthetic(content: string): { code: number; stderr: string } {
  mkdirSync(SYNTH_DIR, { recursive: true });
  const synthFile = join(SYNTH_DIR, '_zsynth.schemas.ts');
  writeFileSync(synthFile, content, 'utf-8');
  try {
    const r = spawnSync('npx', ['tsx', GUARD_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: 'development' },
      encoding: 'utf-8',
    });
    return { code: r.status ?? -1, stderr: r.stderr ?? '' };
  } finally {
    rmSync(SYNTH_DIR, { recursive: true, force: true });
  }
}

describe('findConventionalRule — *Id fields require .uuid()', () => {
  it('matches `id`', () => {
    const rule = findConventionalRule('id');
    expect(rule).not.toBeNull();
    expect(rule!.check('z.string().uuid()')).toBeNull();
    expect(rule!.check('z.string()')).toContain('uuid');
    expect(rule!.check('z.number()')).toContain('z.string()');
  });

  it('matches `clinicId`', () => {
    const rule = findConventionalRule('clinicId');
    expect(rule).not.toBeNull();
    expect(rule!.check('z.string().uuid().nullable()')).toBeNull();
    expect(rule!.check('z.string()')).toContain('uuid');
  });

  it('matches `patientId`', () => {
    const rule = findConventionalRule('patientId');
    expect(rule).not.toBeNull();
    expect(rule!.check('z.string().uuid()')).toBeNull();
  });

  it('matches `episodeId`', () => {
    expect(findConventionalRule('episodeId')).not.toBeNull();
  });

  it('does NOT match `medicareNumber` (not Id-suffixed)', () => {
    expect(findConventionalRule('medicareNumber')).toBeNull();
  });
});

describe('findConventionalRule — *At fields require .datetime()', () => {
  it('matches `createdAt`', () => {
    const rule = findConventionalRule('createdAt');
    expect(rule).not.toBeNull();
    expect(rule!.check('z.string().datetime()')).toBeNull();
    expect(rule!.check('z.date()')).toBeNull();
    expect(rule!.check('z.string()')).toContain('datetime');
  });

  it('matches `updatedAt`, `signedAt`', () => {
    expect(findConventionalRule('updatedAt')).not.toBeNull();
    expect(findConventionalRule('signedAt')).not.toBeNull();
  });

  it('rejects bare z.string() for *At fields', () => {
    const rule = findConventionalRule('createdAt');
    expect(rule!.check('z.string()')).toContain('datetime');
  });

  it('does NOT match `at` (single-word)', () => {
    expect(findConventionalRule('at')).toBeNull();
  });
});

describe('findConventionalRule — `lockVersion` requires .int().nonnegative()', () => {
  it('accepts canonical `z.number().int().nonnegative()`', () => {
    const rule = findConventionalRule('lockVersion');
    expect(rule).not.toBeNull();
    expect(rule!.check('z.number().int().nonnegative()')).toBeNull();
  });

  it('accepts `.min(0)` as alternate non-negative', () => {
    const rule = findConventionalRule('lockVersion');
    expect(rule!.check('z.number().int().min(0)')).toBeNull();
  });

  it('rejects `z.string()`', () => {
    const rule = findConventionalRule('lockVersion');
    expect(rule!.check('z.string()')).toContain('z.number()');
  });

  it('rejects `z.number()` without .int()', () => {
    const rule = findConventionalRule('lockVersion');
    expect(rule!.check('z.number().nonnegative()')).toContain('.int()');
  });

  it('rejects `z.number().int()` without .nonnegative()', () => {
    const rule = findConventionalRule('lockVersion');
    expect(rule!.check('z.number().int()')).toContain('nonnegative');
  });
});

describe('findConventionalRule — `is*` fields require z.boolean()', () => {
  it('matches `isActive`, `isDeleted`, `isPrescriber`', () => {
    expect(findConventionalRule('isActive')).not.toBeNull();
    expect(findConventionalRule('isDeleted')).not.toBeNull();
    expect(findConventionalRule('isPrescriber')).not.toBeNull();
  });

  it('accepts `z.boolean()`', () => {
    const rule = findConventionalRule('isActive');
    expect(rule!.check('z.boolean()')).toBeNull();
  });

  it('rejects `z.string()`', () => {
    const rule = findConventionalRule('isActive');
    expect(rule!.check('z.string()')).toContain('z.boolean()');
  });

  it('does NOT match `is` (degenerate single-word)', () => {
    expect(findConventionalRule('is')).toBeNull();
  });
});

describe('findConventionalRule — out-of-convention fields', () => {
  it('returns null for free-form field names', () => {
    expect(findConventionalRule('name')).toBeNull();
    expect(findConventionalRule('description')).toBeNull();
    expect(findConventionalRule('content')).toBeNull();
    expect(findConventionalRule('milestones')).toBeNull();
  });
});

// ── AST walker integration tests (cycle-2 absorb of L3 advisory #3) ──────
// Cycle-1 tested findConventionalRule directly but not the AST walker
// (scanFile + iterFields + isZodFieldsObjectLiteralCall). Cycle-2 adds
// synthetic-fixture coverage so a future ts-API change is caught.

describe('AST walker — direct z.object() detection', () => {
  it('flags violation in `export const X = z.object({...})`', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      export const TestSchema = z.object({
        clinicId: z.string(),
      });
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('TestSchema.clinicId');
  });

  it('passes for canonical z.object', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      export const TestSchema = z.object({
        clinicId: z.string().uuid(),
      });
    `);
    expect(r.code).toBe(0);
  });
});

describe('AST walker — .extend({...}) coverage (cycle-2 absorb of L3 advisory #4)', () => {
  it('flags violation inside .extend({...}) bare object literal', () => {
    // CYCLE-1 BLIND SPOT: bare object literals inside .extend({...})
    // were silently uncovered. 18+ schemas in shared/ use this pattern.
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      const Base = z.object({ name: z.string() });
      export const ExtendedSchema = Base.extend({
        clinicId: z.string(),
      });
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ExtendedSchema.clinicId');
  });

  it('flags violation inside chained .partial().extend({...})', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      const Base = z.object({ name: z.string() });
      export const ChainedSchema = Base.partial().extend({
        episodeId: z.string(),
      });
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ChainedSchema.episodeId');
  });

  it('flags violation inside .merge({...}) bare object literal', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      const Base = z.object({ name: z.string() });
      export const MergedSchema = Base.merge({
        patientId: z.string(),
      });
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('MergedSchema.patientId');
  });

  it('passes when .extend({...}) uses canonical types', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      const Base = z.object({ name: z.string() });
      export const ExtendedSchema = Base.extend({
        clinicId: z.string().uuid(),
        createdAt: z.string().datetime(),
      });
    `);
    expect(r.code).toBe(0);
  });
});

describe('AST walker — chain methods (.passthrough, .strict)', () => {
  it('scans z.object({...}).passthrough()', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      export const PassThroughSchema = z.object({
        clinicId: z.string(),
      }).passthrough();
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('PassThroughSchema.clinicId');
  });

  it('scans z.object({...}).strict()', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      export const StrictSchema = z.object({
        patientId: z.string(),
      }).strict();
    `);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('StrictSchema.patientId');
  });
});

describe('AST walker — exempt annotation honored', () => {
  it('does NOT flag fields with @zod-convention-exempt annotation', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      export const ExemptSchema = z.object({
        // @zod-convention-exempt: external system identifier (not a UUID)
        externalId: z.string(),
      });
    `);
    // externalId doesn't match *Id convention since it contains uppercase
    // already — but let's verify the annotation works for a field that does
    // match.
    expect(r.code).toBe(0);
  });

  it('honors annotation for genuine match (e.g., dspId)', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      export const VendorSchema = z.object({
        // @zod-convention-exempt: external NPDS identifier (vendor-protocol contract)
        dspId: z.string(),
      });
    `);
    expect(r.code).toBe(0);
  });

  it('does NOT honor empty exempt annotation (no reason)', () => {
    const r = runGuardOnSynthetic(`
      import { z } from 'zod';
      export const BadExemptSchema = z.object({
        // @zod-convention-exempt:
        clinicId: z.string(),
      });
    `);
    expect(r.code).toBe(1); // empty annotation does NOT bypass
  });
});
