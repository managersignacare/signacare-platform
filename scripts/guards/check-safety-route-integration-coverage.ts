#!/usr/bin/env tsx
/**
 * C3-2 / BUG-451 guard:
 * - Enforce machine-readable clinical-safety route->integration-test mapping.
 * - Ensure every required route has at least one deterministic integration assertion.
 * - Ensure route classification is anchored to L4 checklist + safety-surfaces SSoT.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST = resolve(ROOT, '.github', 'safety-route-integration-manifest.json');
const DEFAULT_SAFETY_SURFACES = resolve(ROOT, '.github', 'safety-surfaces.txt');
const DEFAULT_L4_CHECKLIST = resolve(ROOT, 'docs', 'quality', 'l4-reviewer-checklist.md');

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
type HarmClass = 'S0' | 'S1' | 'S2' | 'S3';

interface ManifestEntry {
  id: string;
  owner: string;
  harmClass: HarmClass;
  method: HttpMethod;
  route: string;
  safetySurfacePath: string;
  sourceRefs: string[];
  expectedIntegrationTests: string[];
}

interface ManifestFile {
  version: number;
  generatedAt: string;
  purpose: string;
  entries: ManifestEntry[];
}

interface IntegrationCall {
  method: HttpMethod;
  route: string;
  line: number;
}

export interface Violation {
  reason: string;
}

export interface RunGuardOpts {
  manifestPath?: string;
  safetySurfacesPath?: string;
  l4ChecklistPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1;
  violations: Violation[];
}

const VALID_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const VALID_HARM_CLASSES = new Set<HarmClass>(['S0', 'S1', 'S2', 'S3']);
const REQUIRED_SOURCE_REFS = [
  '.github/safety-surfaces.txt',
  'docs/quality/l4-reviewer-checklist.md#f',
];

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, prefix) => prefix);
}

function lineNoOfIndex(source: string, idx: number): number {
  return source.slice(0, idx).split('\n').length;
}

function canonicaliseRoute(route: string): string {
  let v = route.trim();
  if (!v) return '';
  const queryIdx = v.indexOf('?');
  if (queryIdx !== -1) v = v.slice(0, queryIdx);
  v = v.replace(/\$\{[^}]+\}/g, ':id');
  v = v.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    ':id',
  );
  v = v.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':id');
  v = v.replace(/\/+/g, '/');
  if (v.length > 1) v = v.replace(/\/+$/, '');
  return v;
}

function resolveRepoPath(inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(ROOT, inputPath);
}

function parseSafetySurfaces(source: string): Set<string> {
  const set = new Set<string>();
  for (const line of source.split('\n')) {
    const v = line.trim();
    if (!v || v.startsWith('#')) continue;
    set.add(v);
  }
  return set;
}

function isPathMirroredInL4Checklist(safetySurfacePath: string, l4Source: string): boolean {
  if (l4Source.includes(safetySurfacePath)) return true;
  const featureMatch = /^apps\/api\/src\/features\/([^/]+)\/$/.exec(safetySurfacePath);
  if (!featureMatch) return false;
  const featureSlug = featureMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const compactListPattern = new RegExp(`apps/api/src/features/\\{[^}]*\\b${featureSlug}\\b[^}]*\\}/`);
  return compactListPattern.test(l4Source);
}

function extractCalls(source: string): IntegrationCall[] {
  const stripped = stripComments(source);
  const out: IntegrationCall[] = [];
  const re = /\.([A-Za-z]+)\(\s*([`'"])([\s\S]*?)\2\s*[),]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const method = m[1].toUpperCase() as HttpMethod;
    if (!VALID_METHODS.has(method)) continue;
    const rawRoute = m[3];
    if (!rawRoute.includes('/api/v1/')) continue;
    out.push({
      method,
      route: canonicaliseRoute(rawRoute),
      line: lineNoOfIndex(stripped, m.index),
    });
  }
  return out;
}

function hasExpectAssertion(source: string): boolean {
  const stripped = stripComments(source);
  return /\bexpect\s*\(/.test(stripped);
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const manifestPath = opts.manifestPath ?? DEFAULT_MANIFEST;
  const safetySurfacesPath = opts.safetySurfacesPath ?? DEFAULT_SAFETY_SURFACES;
  const l4ChecklistPath = opts.l4ChecklistPath ?? DEFAULT_L4_CHECKLIST;
  const manifestRel = relative(ROOT, manifestPath);
  const safetySurfacesRel = relative(ROOT, safetySurfacesPath);
  const l4ChecklistRel = relative(ROOT, l4ChecklistPath);
  const violations: Violation[] = [];

  let manifest: ManifestFile | null = null;
  let safetySurfaces = new Set<string>();
  let l4ChecklistSource = '';

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestFile;
  } catch (error) {
    violations.push({
      reason: `${manifestRel}: invalid/missing JSON (${error instanceof Error ? error.message : String(error)})`,
    });
    return { exitCode: 1, violations };
  }

  try {
    safetySurfaces = parseSafetySurfaces(readFileSync(safetySurfacesPath, 'utf8'));
  } catch (error) {
    violations.push({
      reason: `${safetySurfacesRel}: could not read file (${error instanceof Error ? error.message : String(error)})`,
    });
    return { exitCode: 1, violations };
  }

  try {
    l4ChecklistSource = readFileSync(l4ChecklistPath, 'utf8');
  } catch (error) {
    violations.push({
      reason: `${l4ChecklistRel}: could not read file (${error instanceof Error ? error.message : String(error)})`,
    });
    return { exitCode: 1, violations };
  }

  if (manifest.version !== 1) {
    violations.push({ reason: `${manifestRel}: version must be 1` });
  }
  if (!isValidIsoDate(manifest.generatedAt ?? '')) {
    violations.push({ reason: `${manifestRel}: generatedAt must be YYYY-MM-DD` });
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    violations.push({ reason: `${manifestRel}: entries must contain at least one route mapping` });
    return { exitCode: 1, violations };
  }

  const seenIds = new Set<string>();
  const seenRouteKeys = new Set<string>();
  const callCache = new Map<string, IntegrationCall[]>();
  const sourceCache = new Map<string, string>();

  for (let i = 0; i < manifest.entries.length; i++) {
    const entry = manifest.entries[i];
    const prefix = `${manifestRel}:entries[${i}]`;

    if (!entry.id || typeof entry.id !== 'string') {
      violations.push({ reason: `${prefix}: id is required` });
    } else if (seenIds.has(entry.id)) {
      violations.push({ reason: `${prefix}: duplicate id '${entry.id}'` });
    } else {
      seenIds.add(entry.id);
    }

    if (!entry.owner || typeof entry.owner !== 'string') {
      violations.push({ reason: `${prefix}: owner is required` });
    }
    if (!VALID_HARM_CLASSES.has(entry.harmClass)) {
      violations.push({ reason: `${prefix}: harmClass must be one of S0/S1/S2/S3` });
    }
    if (!VALID_METHODS.has(entry.method)) {
      violations.push({ reason: `${prefix}: method must be one of GET/POST/PUT/PATCH/DELETE/HEAD` });
    }
    if (!entry.route || typeof entry.route !== 'string') {
      violations.push({ reason: `${prefix}: route is required` });
    }

    const canonicalRoute = canonicaliseRoute(entry.route ?? '');
    const routeKey = `${entry.method}|${canonicalRoute}`;
    if (seenRouteKeys.has(routeKey)) {
      violations.push({ reason: `${prefix}: duplicate method+route '${routeKey}'` });
    } else {
      seenRouteKeys.add(routeKey);
    }

    if (!entry.safetySurfacePath || typeof entry.safetySurfacePath !== 'string') {
      violations.push({ reason: `${prefix}: safetySurfacePath is required` });
    } else {
      if (!safetySurfaces.has(entry.safetySurfacePath)) {
        violations.push({
          reason: `${prefix}: safetySurfacePath '${entry.safetySurfacePath}' not found in ${safetySurfacesRel}`,
        });
      }
      if (!isPathMirroredInL4Checklist(entry.safetySurfacePath, l4ChecklistSource)) {
        violations.push({
          reason: `${prefix}: safetySurfacePath '${entry.safetySurfacePath}' not mirrored in ${l4ChecklistRel}`,
        });
      }
    }

    if (!Array.isArray(entry.sourceRefs) || entry.sourceRefs.length === 0) {
      violations.push({ reason: `${prefix}: sourceRefs must list checklist + safety-surfaces sources` });
    } else {
      for (const req of REQUIRED_SOURCE_REFS) {
        if (!entry.sourceRefs.includes(req)) {
          violations.push({ reason: `${prefix}: missing required sourceRef '${req}'` });
        }
      }
    }

    if (!Array.isArray(entry.expectedIntegrationTests) || entry.expectedIntegrationTests.length === 0) {
      violations.push({ reason: `${prefix}: expectedIntegrationTests must include at least one test file` });
      continue;
    }

    let covered = false;
    for (const testPath of entry.expectedIntegrationTests) {
      const repoRelativeDeclared = !isAbsolute(testPath);
      const abs = resolveRepoPath(testPath);
      const testRel = relative(ROOT, abs);
      if (!existsSync(abs)) {
        violations.push({ reason: `${prefix}: expected test file missing: ${testRel}` });
        continue;
      }
      if (repoRelativeDeclared && !testRel.startsWith('apps/api/tests/integration/')) {
        violations.push({
          reason: `${prefix}: expected test must live under apps/api/tests/integration/: ${testRel}`,
        });
        continue;
      }

      let source = sourceCache.get(abs);
      if (!source) {
        source = readFileSync(abs, 'utf8');
        sourceCache.set(abs, source);
      }
      if (!hasExpectAssertion(source)) {
        violations.push({ reason: `${prefix}: ${testRel} has no expect(...) assertion` });
      }

      let calls = callCache.get(abs);
      if (!calls) {
        calls = extractCalls(source);
        callCache.set(abs, calls);
      }
      if (calls.some((c) => c.method === entry.method && c.route === canonicalRoute)) {
        covered = true;
      }
    }

    if (!covered) {
      violations.push({
        reason: `${prefix}: no mapped integration assertion found for ${entry.method} ${canonicalRoute}`,
      });
    }
  }

  return { exitCode: violations.length > 0 ? 1 : 0, violations };
}

function main(): number {
  console.log('-> check-safety-route-integration-coverage (C3-2 / BUG-451)');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ safety route->integration coverage manifest is valid and fully covered.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
