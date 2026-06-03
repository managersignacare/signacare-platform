import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-hook-enforcement';

const TMP = join(tmpdir(), 'check-hook-enforcement');

function write(rel: string, content: string): void {
  const full = join(TMP, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

beforeAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

describe('check-hook-enforcement', () => {
  it('passes when required hook and script wiring exists', () => {
    write(
      '.husky/pre-commit',
      `#!/usr/bin/env sh
npm run guard:claude-discipline --silent
bash .github/scripts/check-fix-registry.sh
`,
    );
    write(
      '.husky/commit-msg',
      `#!/usr/bin/env sh
npm run guard:commit-claims --silent -- --commit-msg "$1"
npm run guard:review-attestation --silent -- --commit-msg "$1"
`,
    );
    write(
      'package.json',
      JSON.stringify(
        {
          scripts: {
            'guard:claude-discipline': 'echo ok',
            'guard:commit-claims': 'echo ok',
            'guard:review-attestation': 'echo ok',
          },
        },
        null,
        2,
      ),
    );

    const out = runGuard({ repoRoot: TMP });
    expect(out.violations).toHaveLength(0);
  });

  it('fails when required hook command is missing', () => {
    write('.husky/pre-commit', `#!/usr/bin/env sh\necho "missing"\n`);
    write(
      '.husky/commit-msg',
      `#!/usr/bin/env sh
npm run guard:commit-claims --silent -- --commit-msg "$1"
`,
    );
    write(
      'package.json',
      JSON.stringify(
        {
          scripts: {
            'guard:claude-discipline': 'echo ok',
            'guard:commit-claims': 'echo ok',
          },
        },
        null,
        2,
      ),
    );

    const out = runGuard({ repoRoot: TMP });
    expect(out.violations.length).toBeGreaterThan(0);
    const reasons = out.violations.map((v) => v.reason).join(' | ');
    expect(reasons).toContain('guard:review-attestation');
    expect(reasons).toContain('guard:claude-discipline');
  });
});
