#!/usr/bin/env tsx
/**
 * BUG-355 / A2-0 closure guard:
 * enforce SSoT parity between TS OPERATIONAL_ONLY roles and SQL literals.
 *
 * Contract:
 * 1) TS source set (packages/shared/src/permissions.ts: OPERATIONAL_ONLY)
 *    is authoritative.
 * 2) Every tracked SQL file that contains operational-role literals must
 *    exactly match the TS set.
 * 3) Any untracked migration file that introduces an operational-role
 *    `role IN (...)` literal fails closed until it is explicitly tracked.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

interface Manifest {
  version: number;
  lane: string;
  bugId: string;
  updatedAt: string;
  tsSourcePath: string;
  tsExportName: string;
  trackedSqlFiles: string[];
  roleListPattern: string;
}

interface ScanResult {
  hasRoleInLiteral: boolean;
  relevantRoleLists: string[][];
  mismatches: string[];
}

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST = resolve(ROOT, '.github', 'operational-role-ssot.json');
const DEFAULT_MIGRATIONS_DIR = resolve(ROOT, 'apps', 'api', 'migrations');

function resolvePath(input: string): string {
  return isAbsolute(input) ? input : resolve(ROOT, input);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function parseQuotedRoles(raw: string): string[] {
  const roles: string[] = [];
  const matcher = /['"`]([^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(raw)) !== null) {
    roles.push(match[1]!.trim());
  }
  return sortUnique(roles.filter((r) => r.length > 0));
}

function sameRoleSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function intersects(a: string[], bSet: Set<string>): boolean {
  return a.some((item) => bSet.has(item));
}

function loadManifest(manifestPath: string): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

function validateManifest(manifest: Manifest, violations: string[]): void {
  if (manifest.version !== 1) violations.push('manifest.version must be 1');
  if (manifest.lane !== 'A2') violations.push('manifest.lane must be A2');
  if (manifest.bugId !== 'BUG-355') violations.push('manifest.bugId must be BUG-355');
  if (!isIsoDate(manifest.updatedAt)) violations.push('manifest.updatedAt must be YYYY-MM-DD');
  if (!manifest.tsSourcePath) violations.push('manifest.tsSourcePath is required');
  if (!manifest.tsExportName) violations.push('manifest.tsExportName is required');
  if (!Array.isArray(manifest.trackedSqlFiles) || manifest.trackedSqlFiles.length === 0) {
    violations.push('manifest.trackedSqlFiles must have at least one file');
  }
  if (!manifest.roleListPattern) violations.push('manifest.roleListPattern is required');
}

function extractTsRoles(source: string, exportName: string): string[] | null {
  const pattern = new RegExp(
    `export\\s+const\\s+${escapeRegex(exportName)}\\s*:[^=]*=\\s*new\\s+Set\\s*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`,
    'm',
  );
  const match = source.match(pattern);
  if (!match?.[1]) return null;
  return parseQuotedRoles(match[1]);
}

function scanFileForRoleLists(
  source: string,
  roleListRegex: RegExp,
  expectedSet: string[],
): ScanResult {
  const expected = new Set(expectedSet);
  const mismatches: string[] = [];
  const relevantRoleLists: string[][] = [];
  let hasRoleInLiteral = false;

  let match: RegExpExecArray | null;
  while ((match = roleListRegex.exec(source)) !== null) {
    hasRoleInLiteral = true;
    const listRaw = match[1] ?? '';
    const parsed = parseQuotedRoles(listRaw);
    if (parsed.length === 0) continue;
    if (!intersects(parsed, expected)) continue;
    relevantRoleLists.push(parsed);
    if (!sameRoleSet(parsed, expectedSet)) {
      mismatches.push(parsed.join(', '));
    }
  }

  return { hasRoleInLiteral, relevantRoleLists, mismatches };
}

function main(): number {
  const manifestPath = process.argv[2] ? resolvePath(process.argv[2]) : DEFAULT_MANIFEST;
  const migrationsDir = process.argv[3] ? resolvePath(process.argv[3]) : DEFAULT_MIGRATIONS_DIR;
  const violations: string[] = [];

  let manifest: Manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (error) {
    console.error(
      `✗ failed to load manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  validateManifest(manifest, violations);
  if (violations.length > 0) {
    console.error('✗ check-operational-role-ssot');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  const tsPath = resolvePath(manifest.tsSourcePath);
  const tsSource = readFileSync(tsPath, 'utf8');
  const tsRoles = extractTsRoles(tsSource, manifest.tsExportName);
  if (!tsRoles || tsRoles.length === 0) {
    console.error('✗ check-operational-role-ssot');
    console.error(
      `  - unable to parse ${manifest.tsExportName} roles from ${relative(ROOT, tsPath)}`,
    );
    return 1;
  }

  const roleListRegex = new RegExp(manifest.roleListPattern, 'gi');
  const trackedAbsolute = new Set(manifest.trackedSqlFiles.map((p) => resolvePath(p)));
  let trackedRelevantCount = 0;

  for (const filePath of trackedAbsolute) {
    const relPath = relative(ROOT, filePath);
    const source = readFileSync(filePath, 'utf8');
    roleListRegex.lastIndex = 0;
    const scan = scanFileForRoleLists(source, roleListRegex, tsRoles);
    if (!scan.hasRoleInLiteral || scan.relevantRoleLists.length === 0) {
      violations.push(
        `tracked SQL file has no operational-role role-list match: ${relPath}`,
      );
      continue;
    }
    trackedRelevantCount += scan.relevantRoleLists.length;
    for (const mismatch of scan.mismatches) {
      violations.push(
        `SQL/TS operational-role mismatch in ${relPath}: found [${mismatch}], expected [${tsRoles.join(
          ', ',
        )}]`,
      );
    }
  }

  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => resolve(migrationsDir, name));

  for (const filePath of migrationFiles) {
    if (trackedAbsolute.has(filePath)) continue;
    const source = readFileSync(filePath, 'utf8');
    roleListRegex.lastIndex = 0;
    const scan = scanFileForRoleLists(source, roleListRegex, tsRoles);
    if (scan.relevantRoleLists.length > 0) {
      const relPath = relative(ROOT, filePath);
      const sample = scan.relevantRoleLists[0]!.join(', ');
      violations.push(
        `untracked operational-role SQL literal in ${relPath}: [${sample}] (add file to .github/operational-role-ssot.json)`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-operational-role-ssot');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  console.log('✓ check-operational-role-ssot');
  console.log(`  manifest: ${manifestPath}`);
  console.log(`  tsSource: ${tsPath}`);
  console.log(`  operationalRoles: ${tsRoles.join(', ')}`);
  console.log(`  trackedSqlFiles: ${trackedAbsolute.size}`);
  console.log(`  checkedOperationalLiterals: ${trackedRelevantCount}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
