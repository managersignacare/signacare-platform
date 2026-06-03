#!/usr/bin/env tsx
/**
 * check-cross-project-boundary — BUG-D10-GUARD-XPROJECT-BOUNDARY (S1)
 *
 * Prevent direct source imports across runtime project boundaries.
 * Allowed cross-project sharing must go through published contracts
 * (e.g. package names like @signacare/shared), not raw path imports.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

type Root = {
  name: string;
  relPath: string;
};

const ROOTS: Root[] = [
  { name: 'api', relPath: 'apps/api' },
  { name: 'web', relPath: 'apps/web' },
  { name: 'gateway', relPath: 'apps/emr-gateway' },
  { name: 'mobile-sara', relPath: 'apps/mobile' },
  { name: 'mobile-viva', relPath: 'apps/patient-app' },
  { name: 'pkg-shared', relPath: 'packages/shared' },
  { name: 'pkg-ui-components', relPath: 'packages/ui-components' },
];

const TS_LIKE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

function listTrackedFiles(): string[] {
  const out = execSync('git ls-files -z', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.split('\0').filter(Boolean);
}

function rootForFile(filePath: string): Root | null {
  return ROOTS.find((root) => filePath === root.relPath || filePath.startsWith(`${root.relPath}/`)) ?? null;
}

function extractModuleSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specs.add(match[1]);
    }
  }
  return [...specs];
}

function getTargetRootFromRelativeImport(sourceFile: string, spec: string): Root | null {
  const baseDir = path.dirname(sourceFile);
  const resolved = path.normalize(path.resolve(baseDir, spec));
  const relResolved = path.relative(process.cwd(), resolved);
  return rootForFile(relResolved);
}

function getTargetRootFromAbsoluteLikeImport(spec: string): Root | null {
  if (spec.startsWith('apps/') || spec.startsWith('packages/')) {
    return rootForFile(spec);
  }
  return null;
}

function isScannableSource(filePath: string): boolean {
  if (!filePath.includes('/src/')) return false;
  return TS_LIKE_EXTENSIONS.has(path.extname(filePath));
}

function isAllowedContractImport(spec: string): boolean {
  return spec.startsWith('@signacare/');
}

function main(): void {
  console.log('→ check-cross-project-boundary');

  const tracked = listTrackedFiles();
  const offenders: string[] = [];

  for (const file of tracked) {
    if (!isScannableSource(file)) continue;
    const sourceRoot = rootForFile(file);
    if (!sourceRoot) continue;
    if (!existsSync(file)) continue; // supports local staged deletions cleanly

    const content = readFileSync(file, 'utf8');
    const specs = extractModuleSpecifiers(content);

    for (const spec of specs) {
      if (isAllowedContractImport(spec)) continue;

      let targetRoot: Root | null = null;
      if (spec.startsWith('.')) {
        targetRoot = getTargetRootFromRelativeImport(file, spec);
      } else {
        targetRoot = getTargetRootFromAbsoluteLikeImport(spec);
      }

      if (!targetRoot) continue;
      if (targetRoot.name === sourceRoot.name) continue;

      offenders.push(
        `${file}: "${spec}" crosses boundary (${sourceRoot.relPath} -> ${targetRoot.relPath})`,
      );
    }
  }

  if (offenders.length > 0) {
    console.error(`✗ cross-project-boundary guard failed (${offenders.length} violation(s))`);
    for (const offender of offenders) console.error(`  - ${offender}`);
    console.error('Use published contracts (e.g. @signacare/shared) instead of raw cross-project source imports.');
    process.exit(1);
  }

  console.log('✓ No raw cross-project source imports detected.');
}

main();
