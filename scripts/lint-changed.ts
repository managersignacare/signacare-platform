import { existsSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';

type Mode = 'workspace' | 'staged' | 'base';

const LINTABLE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;

function runGit(command: string): string[] {
  const out = execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function lintable(files: string[]): string[] {
  return files.filter((file) => LINTABLE_PATTERN.test(file) && existsSync(file));
}

function parseArgs(argv: string[]): { mode: Mode; baseRef?: string } {
  if (argv.includes('--staged')) return { mode: 'staged' };
  const baseIndex = argv.findIndex((arg) => arg === '--base');
  if (baseIndex >= 0) {
    const baseRef = argv[baseIndex + 1];
    if (!baseRef) {
      throw new Error('Missing value for --base <git-ref>');
    }
    return { mode: 'base', baseRef };
  }
  return { mode: 'workspace' };
}

function collectFiles(mode: Mode, baseRef?: string): string[] {
  if (mode === 'staged') {
    return runGit('git diff --cached --name-only --diff-filter=ACMR');
  }
  if (mode === 'base') {
    return runGit(`git diff --name-only --diff-filter=ACMR ${baseRef}...HEAD`);
  }

  const changed = runGit('git diff --name-only --diff-filter=ACMR HEAD');
  const untracked = runGit('git ls-files --others --exclude-standard');
  return unique([...changed, ...untracked]);
}

function runEslint(files: string[]): number {
  // Chunk calls to avoid command-length limits on very large diffs.
  const CHUNK_SIZE = 150;
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const chunk = files.slice(i, i + CHUNK_SIZE);
    const result = spawnSync('npx', ['eslint', ...chunk], {
      stdio: 'inherit',
      env: process.env,
    });
    if ((result.status ?? 1) !== 0) return result.status ?? 1;
  }
  return 0;
}

function main() {
  const { mode, baseRef } = parseArgs(process.argv.slice(2));
  const candidates = collectFiles(mode, baseRef);
  const files = lintable(candidates);

  if (files.length === 0) {
    console.log(`lint:changed (${mode}) — no lintable changed files found.`);
    return;
  }

  console.log(
    `lint:changed (${mode}) — linting ${files.length} file(s)${
      baseRef ? ` against ${baseRef}` : ''
    }.`,
  );
  const code = runEslint(files);
  process.exit(code);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`lint:changed failed: ${message}`);
  process.exit(1);
}
