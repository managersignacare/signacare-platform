#!/usr/bin/env tsx
/**
 * Compute affected build surfaces for CI.
 *
 * Safety guards still run broadly. This planner only narrows production build
 * work so docs-only or operations-only PRs do not rebuild every application.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

type OutputKey =
  | 'build_any'
  | 'build_shared'
  | 'build_ui_components'
  | 'build_api'
  | 'build_web'
  | 'build_gateway'
  | 'build_mobile_sara'
  | 'build_mobile_viva'
  | 'deploy';

type Outputs = Record<OutputKey, boolean>;

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function hasCommit(ref: string): boolean {
  try {
    git(['rev-parse', '--verify', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function diffFiles(base: string | null): string[] {
  const committed = (() => {
    if (!base) return git(['ls-files']).split('\n').filter(Boolean);
    try {
      return git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
    } catch {
      return git(['diff', '--name-only', `${base}..HEAD`]).split('\n').filter(Boolean);
    }
  })();

  const dirty = [
    ...git(['diff', '--name-only']).split('\n').filter(Boolean),
    ...git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean),
    ...git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean),
  ];

  return [...new Set([...committed, ...dirty])];
}

function resolveBase(): string | null {
  const explicit = process.env.AFFECTED_BASE?.trim();
  if (explicit && hasCommit(explicit)) return explicit;

  const before = process.env.GITHUB_EVENT_BEFORE?.trim();
  const zeroSha = /^0{40}$/;
  if (before && !zeroSha.test(before) && hasCommit(before)) return before;

  const baseRef = process.env.GITHUB_BASE_REF?.trim();
  if (baseRef) {
    const remoteRef = `origin/${baseRef}`;
    if (hasCommit(remoteRef)) {
      try {
        return git(['merge-base', remoteRef, 'HEAD']);
      } catch {
        return remoteRef;
      }
    }
  }

  if (hasCommit('HEAD~1')) return 'HEAD~1';
  return null;
}

function touches(files: string[], prefixes: string[]): boolean {
  return files.some((file) => prefixes.some((prefix) => file === prefix || file.startsWith(prefix)));
}

function compute(files: string[]): Outputs {
  const globalBuild = touches(files, [
    'package.json',
    'package-lock.json',
    'tsconfig.base.json',
    'tsconfig.json',
    '.dependency-cruiser.cjs',
    '.github/workflows/ci.yml',
    'scripts/ci/',
  ]);

  const sharedChanged = globalBuild || touches(files, ['packages/shared/']);
  const uiChanged = globalBuild || touches(files, ['packages/ui-components/']);
  const apiChanged = globalBuild || sharedChanged || touches(files, ['apps/api/']);
  const webChanged = globalBuild || sharedChanged || uiChanged || touches(files, ['apps/web/']);
  const gatewayChanged = globalBuild || touches(files, ['apps/emr-gateway/']);
  const saraChanged = globalBuild || sharedChanged || touches(files, ['apps/mobile/']);
  const vivaChanged = globalBuild || sharedChanged || touches(files, ['apps/patient-app/']);
  const deployChanged = touches(files, ['deploy/', '.github/workflows/azure-deploy.yml']);

  const buildShared = sharedChanged || apiChanged || webChanged || saraChanged || vivaChanged;
  const buildUi = uiChanged || webChanged;
  const buildAny = buildShared || buildUi || apiChanged || webChanged || gatewayChanged || saraChanged || vivaChanged;

  return {
    build_any: buildAny,
    build_shared: buildShared,
    build_ui_components: buildUi,
    build_api: apiChanged,
    build_web: webChanged,
    build_gateway: gatewayChanged,
    build_mobile_sara: saraChanged,
    build_mobile_viva: vivaChanged,
    deploy: deployChanged,
  };
}

function main(): void {
  const base = resolveBase();
  const files = diffFiles(base);
  const outputs = compute(files);

  console.log(`Affected base: ${base ?? '<none; full repository>'}`);
  console.log(`Changed files: ${files.length}`);
  for (const [key, value] of Object.entries(outputs)) {
    console.log(`${key}=${value}`);
  }

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(
      outputPath,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
      'utf8',
    );
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const rows = Object.entries(outputs)
      .map(([key, value]) => `| ${key} | ${value ? 'yes' : 'no'} |`)
      .join('\n');
    appendFileSync(
      summaryPath,
      `## Affected workspace build plan\n\nBase: \`${base ?? 'full repository'}\`\n\n| Output | Build? |\n|---|---|\n${rows}\n`,
      'utf8',
    );
  }
}

main();
