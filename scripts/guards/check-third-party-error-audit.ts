#!/usr/bin/env tsx
/**
 * BUG-313 — third-party logger PHI audit guard.
 *
 * Contract:
 * - Worker/queue failure logging must pass `err` objects to pino
 *   (`logger.error({ err }, ...)`) so BUG-267 serializer can redact PHI.
 * - Direct `err.message` wiring inside logger metadata/message templates
 *   on these third-party paths is forbidden.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');

type Violation = {
  file: string;
  line: number;
  snippet: string;
  reason: string;
};

type GuardResult = {
  exitCode: number;
  violations: Violation[];
};

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    // logger.error({ err: err.message }, ...) / logger.warn({ err: x?.message }, ...)
    re: /logger\.(?:error|warn)\(\s*\{[\s\S]{0,1200}?\berr\s*:\s*[^}\n]{0,240}\.message[\s\S]{0,400}?\}\s*,/g,
    reason: 'logger metadata uses err.message; pass the Error object via `err` instead',
  },
  {
    // logger.error(..., `... ${err.message} ...`)
    re: /logger\.(?:error|warn)\([\s\S]{0,1200}?`[^`]*\$\{\s*err(?:\?\.|\.?)message\s*\}[^`]*`/g,
    reason: 'logger message interpolates err.message; keep message static and pass err object',
  },
];

function walkTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    files.push(full);
  }
  return files;
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function lineSnippet(source: string, line: number): string {
  return (source.split('\n')[line - 1] ?? '').trim();
}

export function runGuard(repoRoot: string = REPO_ROOT): GuardResult {
  const targetDirs = [
    resolve(repoRoot, 'apps', 'api', 'src', 'jobs', 'workers'),
    resolve(repoRoot, 'apps', 'api', 'src', 'queues'),
  ];
  const targetFilesExplicit = [
    resolve(repoRoot, 'apps', 'api', 'src', 'features', 'patient-outreach', 'patientOutreachWorker.ts'),
    resolve(repoRoot, 'apps', 'api', 'src', 'jobs', 'bootstrap.ts'),
  ];

  const targetFiles = new Set<string>();

  for (const dir of targetDirs) {
    if (!existsSync(dir)) continue;
    for (const file of walkTsFiles(dir)) targetFiles.add(file);
  }
  for (const file of targetFilesExplicit) {
    if (existsSync(file)) targetFiles.add(file);
  }

  const violations: Violation[] = [];
  for (const file of targetFiles) {
    const source = readFileSync(file, 'utf8');
    const relPath = relative(repoRoot, file).replaceAll('\\', '/');

    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.re.exec(source)) !== null) {
        const line = lineNumberAt(source, match.index);
        violations.push({
          file: relPath,
          line,
          snippet: lineSnippet(source, line),
          reason: pattern.reason,
        });
      }
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  const result = runGuard();
  if (result.exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.error('check-third-party-error-audit: FAIL');
    // eslint-disable-next-line no-console
    console.error('  Found BUG-313 violations (logger uses err.message on third-party paths):');
    for (const violation of result.violations) {
      // eslint-disable-next-line no-console
      console.error(`  - ${violation.file}:${violation.line}`);
      // eslint-disable-next-line no-console
      console.error(`    ${violation.snippet}`);
      // eslint-disable-next-line no-console
      console.error(`    reason: ${violation.reason}`);
    }
    return 1;
  }
  // eslint-disable-next-line no-console
  console.error('check-third-party-error-audit: PASS');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
