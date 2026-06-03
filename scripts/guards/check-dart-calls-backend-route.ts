#!/usr/bin/env ts-node
/*
 * scripts/guards/check-dart-calls-backend-route.ts
 *
 * Ensures every Dart API call in clinician mobile (Sara) and patient app (Viva)
 * resolves to a mounted backend handler.
 *
 * Why:
 * - Prevents "no data" UX caused by dead endpoints drifting from API contracts.
 * - Complements check-dart-api-calls.sh (path hygiene) with route existence.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_SRC = path.join(REPO_ROOT, 'apps', 'api', 'src');
const SERVER_TS = path.join(API_SRC, 'server.ts');
const MOBILE_SRC = path.join(REPO_ROOT, 'apps', 'mobile', 'lib');
const PATIENT_APP_SRC = path.join(REPO_ROOT, 'apps', 'patient-app', 'lib');
const ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  '.github',
  'scripts',
  'dart-url.allowlist',
);

interface RouteEntry {
  readonly method: string;
  readonly rawPath: string;
}

interface DartCall {
  readonly method: string;
  readonly rawUrl: string;
  readonly normalisedUrl: string;
  readonly file: string;
  readonly line: number;
}

async function walk(dir: string, ext: RegExp): Promise<string[]> {
  const out: string[] = [];
  async function rec(p: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        await rec(full);
      } else if (e.isFile() && ext.test(e.name)) {
        out.push(full);
      }
    }
  }
  await rec(dir);
  return out;
}

function isBackendRouteSource(file: string): boolean {
  const base = path.basename(file);
  if (!base.endsWith('.ts')) return false;
  if (base.endsWith('.d.ts')) return false;
  if (base.endsWith('.test.ts') || base.endsWith('.spec.ts')) return false;
  if (file.includes(`${path.sep}tests${path.sep}`)) return false;
  return /([Rr]outes|[Rr]egistrar)\.ts$/.test(base);
}

function normaliseUrl(raw: string): string {
  let u = raw;
  const q = u.indexOf('?');
  if (q !== -1) u = u.slice(0, q);
  u = u.replace(/^\/+/, '');
  u = u.replace(/\$\{[^}]+\}/g, ':DYNAMIC');
  u = u.replace(/[`'"]/g, '');
  u = u.replace(/\/+$/, '');
  return u;
}

function rawPathToRegex(rawPath: string): RegExp {
  const trimmed = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  const escaped = trimmed
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_][\w]*/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

async function buildRouterPrefixMap(): Promise<Map<string, string>> {
  const src = await fs.readFile(SERVER_TS, 'utf8');
  const map = new Map<string, string>();
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('//')) continue;
    const m1 = line.match(
      /app\.use\(\s*`\$\{API\}([^`]*)`\s*,\s*([\w$,\s]+)\s*\)/,
    );
    if (m1) {
      const prefix = `/api/v1${m1[1]}`;
      const names = m1[2].split(',').map((s) => s.trim());
      for (const name of names) {
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) map.set(name, prefix);
      }
      continue;
    }
    const m2 = line.match(/app\.use\(\s*API\s*,\s*([\w$]+)\s*\)/);
    if (m2) {
      map.set(m2[1], '/api/v1');
      continue;
    }
    const m3 = line.match(/app\.use\(\s*([\w$]+)\s*\)/);
    if (m3 && !m3[1].startsWith('/') && m3[1] !== 'API') {
      if (!map.has(m3[1])) map.set(m3[1], '');
    }
  }
  return map;
}

async function extractRoutes(file: string): Promise<RouteEntry[]> {
  const src = await fs.readFile(file, 'utf8');
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, prefix) => prefix);

  const routeCallPattern =
    /([\w$]+)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  const routes: RouteEntry[] = [];
  let m: RegExpExecArray | null;
  routeCallPattern.lastIndex = 0;
  while ((m = routeCallPattern.exec(stripped)) !== null) {
    const target = m[1];
    if (
      !(
        /[Rr]outes?$/.test(target) ||
        /[Rr]outer$/.test(target) ||
        target === 'router' ||
        target === 'r'
      )
    ) {
      continue;
    }
    routes.push({
      method: m[2].toUpperCase(),
      rawPath: m[3],
    });
  }
  return routes;
}

async function buildBackendCatalog(): Promise<RouteEntry[]> {
  const files = await walk(API_SRC, /\.(ts)$/);
  const filtered = files.filter(isBackendRouteSource);
  const catalog: RouteEntry[] = [];
  for (const f of filtered) catalog.push(...(await extractRoutes(f)));
  return catalog;
}

async function extractDartCalls(): Promise<DartCall[]> {
  const files = [
    ...(await walk(MOBILE_SRC, /\.dart$/)),
    ...(await walk(PATIENT_APP_SRC, /\.dart$/)),
  ];
  const calls: DartCall[] = [];
  const callPattern =
    /(?:ApiClient\.instance|pApi|\bapi)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;

  for (const f of files) {
    let src: string;
    try {
      src = await fs.readFile(f, 'utf8');
    } catch {
      continue;
    }
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      callPattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = callPattern.exec(line)) !== null) {
        const method = m[1].toUpperCase();
        const rawUrl = m[2];
        calls.push({
          method,
          rawUrl,
          normalisedUrl: normaliseUrl(rawUrl),
          file: path.relative(REPO_ROOT, f),
          line: i + 1,
        });
      }
    }
  }
  return calls;
}

function backendRouteMatches(
  call: DartCall,
  catalog: RouteEntry[],
  prefixes: Map<string, string>,
): boolean {
  const fullUrl = call.normalisedUrl;
  for (const entry of catalog) {
    if (entry.method !== call.method) continue;
    for (const prefix of prefixes.values()) {
      const strippedPrefix = prefix
        .replace(/^\/api\/v1\/?/, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
      const rawPathTrimmed = entry.rawPath
        .replace(/^\/+/, '')
        .replace(/^api\/v1\/?/, '')
        .replace(/\/+$/, '');
      const joined = strippedPrefix
        ? (rawPathTrimmed ? `${strippedPrefix}/${rawPathTrimmed}` : strippedPrefix)
        : rawPathTrimmed;

      const literalBackend = joined.replace(/:[A-Za-z_][\w]*/g, 'x');
      const dartRegex = new RegExp(
        `^${fullUrl.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:DYNAMIC/g, '[^/]+')}$`,
      );
      if (dartRegex.test(literalBackend)) return true;

      const dartLiteral = fullUrl.replace(/:DYNAMIC/g, 'x');
      const backendRegex = rawPathToRegex(joined);
      if (backendRegex.test(dartLiteral)) return true;
    }
  }
  return false;
}

async function loadAllowlist(): Promise<Set<string>> {
  try {
    const src = await fs.readFile(ALLOWLIST_PATH, 'utf8');
    const out = new Set<string>();
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      out.add(line);
    }
    return out;
  } catch {
    return new Set();
  }
}

async function main(): Promise<number> {
  console.log('→ check-dart-calls-backend-route');
  const [prefixes, catalog, calls, allowlist] = await Promise.all([
    buildRouterPrefixMap(),
    buildBackendCatalog(),
    extractDartCalls(),
    loadAllowlist(),
  ]);
  console.log(`  backend catalog: ${catalog.length} routes, ${prefixes.size} router prefixes`);
  console.log(`  dart calls:      ${calls.length} api call sites`);
  console.log(`  allowlist:       ${allowlist.size} entries`);

  const violations: string[] = [];
  for (const call of calls) {
    const key = `${call.method} ${call.normalisedUrl}`;
    if (allowlist.has(key) || allowlist.has(call.normalisedUrl)) continue;
    if (!backendRouteMatches(call, catalog, prefixes)) {
      violations.push(`  ✗ ${call.file}:${call.line}: ${call.method} ${call.rawUrl}`);
    }
  }

  if (violations.length > 0) {
    console.error('');
    console.error(`✗ FAIL: ${violations.length} Dart API call(s) target URLs with no backend handler.`);
    console.error('');
    for (const v of violations) console.error(v);
    console.error('');
    console.error('Fix one of:');
    console.error('  1. Add a backend route handler for the URL');
    console.error('  2. Change the Dart URL to one that exists');
    console.error(`  3. If this is intentionally dynamic, add an entry to ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
    return 1;
  }

  console.log('✓ Every Dart API URL resolves to a backend handler.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`check-dart-calls-backend-route: unhandled error\n${msg}`);
    process.exit(2);
  });
