#!/usr/bin/env ts-node
/*
 * scripts/guards/check-integration-calls-backend-route.ts
 *
 * BUG-452 (C3 lane): reject integration tests that hit URLs with no
 * mounted backend handler ("zombie tests" that pass while only asserting
 * against fallback 404 behavior).
 *
 * Guard contract:
 * - Scan apps/api/tests/integration/** for supertest-style HTTP calls.
 * - Build a backend catalog from mounted routers in server.ts + direct
 *   app.<method>() routes in server.ts.
 * - Fail when a test URL has no backend match, unless allowlisted with
 *   explicit rationale in scripts/guards/integration-route.allowlist.
 */

import { existsSync, promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_SRC = path.join(REPO_ROOT, 'apps', 'api', 'src');
const SERVER_TS = path.join(API_SRC, 'server.ts');
const INTEGRATION_TESTS = path.join(
  REPO_ROOT,
  'apps',
  'api',
  'tests',
  'integration',
);
const ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'guards',
  'integration-route.allowlist',
);

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

interface RouteCallEntry {
  readonly target: string;
  readonly method: HttpMethod;
  readonly rawPath: string;
  readonly file: string;
  readonly line: number;
}

interface UseCallEntry {
  readonly target: string;
  readonly rawPath: string | null;
  readonly childIdentifier: string;
  readonly file: string;
  readonly line: number;
}

interface RegistrarCallEntry {
  readonly callee: string;
  readonly routerArg: string;
  readonly file: string;
  readonly line: number;
}

interface BackendRoute {
  readonly method: HttpMethod;
  readonly fullPath: string;
  readonly pattern: RegExp;
  readonly source: string;
}

interface IntegrationCall {
  readonly method: HttpMethod;
  readonly rawUrl: string;
  readonly normalisedUrl: string;
  readonly file: string;
  readonly line: number;
}

interface ImportBinding {
  readonly moduleRel: string;
  readonly importedName: string;
}

interface MountEntry {
  readonly prefix: string;
  readonly identifiers: string[];
  readonly line: number;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, prefix) => prefix);
}

function normaliseUrl(raw: string): string {
  let u = raw;
  const q = u.indexOf('?');
  if (q !== -1) u = u.slice(0, q);
  u = u.replace(/\$\{[^}]+\}/g, ':DYNAMIC');
  u = u.replace(/^\/+/, '');
  u = u.replace(/\/+$/, '');
  return u;
}

function pathToRegex(pathLike: string): RegExp {
  const norm = normaliseUrl(pathLike);
  if (!norm) return /^$/;
  const segments = norm.split('/').map((seg) => {
    if (seg === '*' || seg === '**') return '.*';
    if (seg === ':DYNAMIC') return '[^/]+';
    if (seg.startsWith(':')) return '[^/]+';
    return escapeRegExp(seg);
  });
  return new RegExp(`^${segments.join('/')}$`);
}

function isRouterLikeTarget(target: string): boolean {
  return (
    /[Rr]outes?$/.test(target)
    || /[Rr]outer$/.test(target)
    || target === 'router'
    || target === 'r'
  );
}

function joinPrefixAndRoute(prefix: string, routePath: string): string {
  const p = normaliseUrl(prefix);
  const r = normaliseUrl(routePath);
  if (!r) return p;
  if (r.startsWith('api/')) return r;
  if (!p) return r;
  return `${p}/${r}`;
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

function resolveModuleFile(moduleRel: string, baseDir = API_SRC): string | null {
  const absBase = path.resolve(baseDir, moduleRel);
  const candidates = [
    `${absBase}.ts`,
    `${absBase}.tsx`,
    path.join(absBase, 'index.ts'),
    path.join(absBase, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function extractImportBindings(serverSrc: string): Map<string, ImportBinding> {
  const stripped = stripComments(serverSrc);
  const bindings = new Map<string, ImportBinding>();

  for (const rawLine of stripped.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('import ')) continue;
    if (/^import\s+['"]/.test(line)) continue; // side-effect import

    const match = line.match(
      /^import\s+(.+)\s+from\s+['"](\.\/[^'"]+)['"]\s*;?\s*$/,
    );
    if (!match) continue;

    const clause = match[1].replace(/\s+/g, ' ').trim();
    const moduleRel = match[2];

    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (namedMatch) {
      const namedItems = namedMatch[1].split(',');
      for (const raw of namedItems) {
        const token = raw.trim().replace(/^type\s+/, '');
        if (!token) continue;
        const asMatch = token.match(
          /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/,
        );
        if (asMatch) {
          bindings.set(asMatch[2], {
            moduleRel,
            importedName: asMatch[1],
          });
          continue;
        }
        if (/^[A-Za-z_$][\w$]*$/.test(token)) {
          bindings.set(token, { moduleRel, importedName: token });
        }
      }
    }

    const defaultClause = clause.replace(/\{[^}]*\}/g, '').replace(/,/g, ' ').trim();
    if (defaultClause) {
      const nsMatch = defaultClause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (nsMatch) {
        bindings.set(nsMatch[1], { moduleRel, importedName: '*' });
      } else {
        const id = defaultClause.split(/\s+/)[0];
        if (/^[A-Za-z_$][\w$]*$/.test(id)) {
          bindings.set(id, { moduleRel, importedName: 'default' });
        }
      }
    }
  }

  return bindings;
}

function extractMounts(serverSrc: string): MountEntry[] {
  const stripped = stripComments(serverSrc);
  const lines = stripped.split('\n');
  const mounts: MountEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.includes('app.use(')) continue;

    let prefix: string | null = null;
    let argsTail: string | null = null;

    const template = line.match(
      /app\.use\(\s*`\$\{API\}([^`]*)`\s*,\s*(.+)\)\s*;?$/,
    );
    if (template) {
      prefix = `/api/v1${template[1]}`;
      argsTail = template[2];
    }

    const apiBare = line.match(/app\.use\(\s*API\s*,\s*(.+)\)\s*;?$/);
    if (!prefix && apiBare) {
      prefix = '/api/v1';
      argsTail = apiBare[1];
    }

    const literalApi = line.match(
      /app\.use\(\s*['"]((?:\/api\/v1|\/api)\/[^'"]*)['"]\s*,\s*(.+)\)\s*;?$/,
    );
    if (!prefix && literalApi) {
      prefix = literalApi[1];
      argsTail = literalApi[2];
    }

    const bare = line.match(/app\.use\(\s*([A-Za-z_$][\w$]*)\s*\)\s*;?$/);
    if (!prefix && bare) {
      prefix = '';
      argsTail = bare[1];
    }

    if (prefix == null || !argsTail) continue;

    const ids = [...argsTail.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map(
      (x) => x[0],
    );
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) continue;

    mounts.push({
      prefix,
      identifiers: uniq,
      line: i + 1,
    });
  }

  return mounts;
}

async function extractRouteCalls(file: string): Promise<RouteCallEntry[]> {
  const src = await fs.readFile(file, 'utf8');
  const stripped = stripComments(src);
  const entries: RouteCallEntry[] = [];

  const routeCallPattern =
    /([\w$]+)\s*\.\s*(get|post|put|delete|patch|head)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  let m: RegExpExecArray | null;
  routeCallPattern.lastIndex = 0;
  while ((m = routeCallPattern.exec(stripped)) !== null) {
    const target = m[1];
    const method = m[2].toUpperCase() as HttpMethod;
    const rawPath = m[3];

    if (!isRouterLikeTarget(target)) continue;

    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;

    entries.push({
      target,
      method,
      rawPath,
      file: path.relative(REPO_ROOT, file),
      line,
    });
  }

  return entries;
}

async function extractUseCalls(file: string): Promise<UseCallEntry[]> {
  const src = await fs.readFile(file, 'utf8');
  const stripped = stripComments(src);
  const entries: UseCallEntry[] = [];

  const withPath =
    /([\w$]+)\s*\.\s*use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)/g;
  const bare =
    /([\w$]+)\s*\.\s*use\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

  let m: RegExpExecArray | null;
  withPath.lastIndex = 0;
  while ((m = withPath.exec(stripped)) !== null) {
    const target = m[1];
    const rawPath = m[2];
    const childIdentifier = m[3];
    if (!isRouterLikeTarget(target)) continue;

    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;
    entries.push({
      target,
      rawPath,
      childIdentifier,
      file: path.relative(REPO_ROOT, file),
      line,
    });
  }

  bare.lastIndex = 0;
  while ((m = bare.exec(stripped)) !== null) {
    const target = m[1];
    const childIdentifier = m[2];
    if (!isRouterLikeTarget(target)) continue;

    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;
    entries.push({
      target,
      rawPath: null,
      childIdentifier,
      file: path.relative(REPO_ROOT, file),
      line,
    });
  }

  return entries;
}

async function extractRegistrarCalls(file: string): Promise<RegistrarCallEntry[]> {
  const src = await fs.readFile(file, 'utf8');
  const stripped = stripComments(src);
  const entries: RegistrarCallEntry[] = [];

  const registrarPattern =
    /([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:,|\))/g;

  let m: RegExpExecArray | null;
  registrarPattern.lastIndex = 0;
  while ((m = registrarPattern.exec(stripped)) !== null) {
    const callee = m[1];
    const routerArg = m[2];
    if (!isRouterLikeTarget(routerArg)) continue;
    if (callee === 'Router' || callee === 'Date' || callee === 'Promise') continue;

    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;
    entries.push({
      callee,
      routerArg,
      file: path.relative(REPO_ROOT, file),
      line,
    });
  }

  return entries;
}

async function extractDirectServerRoutes(): Promise<BackendRoute[]> {
  const src = await fs.readFile(SERVER_TS, 'utf8');
  const stripped = stripComments(src);
  const out: BackendRoute[] = [];

  const directPattern =
    /app\.\s*(get|post|put|delete|patch|head)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  directPattern.lastIndex = 0;

  while ((m = directPattern.exec(stripped)) !== null) {
    const method = m[1].toUpperCase() as HttpMethod;
    const raw = m[2].replace(/\$\{API\}/g, '/api/v1');
    const fullPath = normaliseUrl(raw);
    if (!fullPath) continue;

    const upto = stripped.slice(0, m.index);
    const line = upto.split('\n').length;

    out.push({
      method,
      fullPath,
      pattern: pathToRegex(fullPath),
      source: `${path.relative(REPO_ROOT, SERVER_TS)}:${line}`,
    });
  }

  return out;
}

function selectByBinding<T extends { target: string }>(
  entries: T[],
  identifier: string,
  binding: ImportBinding,
): { selected: T[]; ambiguous: boolean } {
  if (entries.length === 0) return { selected: [], ambiguous: false };

  const byLocal = entries.filter((e) => e.target === identifier);
  if (byLocal.length > 0) return { selected: byLocal, ambiguous: false };

  if (binding.importedName !== 'default' && binding.importedName !== '*') {
    const byImported = entries.filter((e) => e.target === binding.importedName);
    if (byImported.length > 0) return { selected: byImported, ambiguous: false };
  }

  const uniqueTargets = [...new Set(entries.map((e) => e.target))];
  if (uniqueTargets.length === 1) return { selected: entries, ambiguous: false };

  const generic = entries.filter((e) => e.target === 'router' || e.target === 'r');
  if (generic.length > 0) return { selected: generic, ambiguous: false };

  return { selected: [], ambiguous: true };
}

async function buildMountedRoutes(): Promise<{
  routes: BackendRoute[];
  ambiguousMounts: string[];
}> {
  const serverSrc = await fs.readFile(SERVER_TS, 'utf8');
  const importBindings = extractImportBindings(serverSrc);
  const mounts = extractMounts(serverSrc);
  const routeCallCache = new Map<string, RouteCallEntry[]>();
  const useCallCache = new Map<string, UseCallEntry[]>();
  const registrarCallCache = new Map<string, RegistrarCallEntry[]>();
  const moduleImportCache = new Map<string, Map<string, ImportBinding>>();

  const routes: BackendRoute[] = [];
  const dedupe = new Set<string>();
  const ambiguousMounts: string[] = [];

  const addRoute = (fullPath: string, method: HttpMethod, source: string): void => {
    if (!fullPath) return;
    const key = `${method} ${fullPath} ${source}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    routes.push({
      method,
      fullPath,
      pattern: pathToRegex(fullPath),
      source,
    });
  };

  for (const mount of mounts) {
    for (const identifier of mount.identifiers) {
      const binding = importBindings.get(identifier);
      if (!binding) continue;

      const file = resolveModuleFile(binding.moduleRel, API_SRC);
      if (!file) continue;

      let calls = routeCallCache.get(file);
      if (!calls) {
        calls = await extractRouteCalls(file);
        routeCallCache.set(file, calls);
      }

      let uses = useCallCache.get(file);
      if (!uses) {
        uses = await extractUseCalls(file);
        useCallCache.set(file, uses);
      }

      const selectedCalls = selectByBinding(calls, identifier, binding);
      if (selectedCalls.ambiguous) {
        ambiguousMounts.push(
          `${path.relative(REPO_ROOT, file)} via ${identifier} (server.ts:${mount.line})`,
        );
        continue;
      }

      for (const call of selectedCalls.selected) {
        const fullPath = joinPrefixAndRoute(mount.prefix, call.rawPath);
        const source = `${call.file}:${call.line}`;
        addRoute(fullPath, call.method, source);
      }

      const selectedUses = selectByBinding(uses, identifier, binding);
      if (selectedUses.ambiguous) {
        ambiguousMounts.push(
          `${path.relative(REPO_ROOT, file)} nested via ${identifier} (server.ts:${mount.line})`,
        );
        continue;
      }

      let childBindings = moduleImportCache.get(file);
      if (!childBindings) {
        const src = await fs.readFile(file, 'utf8');
        childBindings = extractImportBindings(src);
        moduleImportCache.set(file, childBindings);
      }

      const moduleDir = path.dirname(file);

      let registrarCalls = registrarCallCache.get(file);
      if (!registrarCalls) {
        registrarCalls = await extractRegistrarCalls(file);
        registrarCallCache.set(file, registrarCalls);
      }

      for (const registrarCall of registrarCalls) {
        const registrarBinding = childBindings.get(registrarCall.callee);
        if (!registrarBinding) continue;

        const registrarFile = resolveModuleFile(registrarBinding.moduleRel, moduleDir);
        if (!registrarFile) continue;

        let registrarRouteCalls = routeCallCache.get(registrarFile);
        if (!registrarRouteCalls) {
          registrarRouteCalls = await extractRouteCalls(registrarFile);
          routeCallCache.set(registrarFile, registrarRouteCalls);
        }

        for (const registrarRouteCall of registrarRouteCalls) {
          const fullPath = joinPrefixAndRoute(mount.prefix, registrarRouteCall.rawPath);
          const source = `${registrarRouteCall.file}:${registrarRouteCall.line}`;
          addRoute(fullPath, registrarRouteCall.method, source);
        }
      }

      for (const useCall of selectedUses.selected) {
        const childBinding = childBindings.get(useCall.childIdentifier);
        if (!childBinding) continue;
        const childFile = resolveModuleFile(childBinding.moduleRel, moduleDir);
        if (!childFile) continue;

        let childCalls = routeCallCache.get(childFile);
        if (!childCalls) {
          childCalls = await extractRouteCalls(childFile);
          routeCallCache.set(childFile, childCalls);
        }

        const selectedChildCalls = selectByBinding(
          childCalls,
          useCall.childIdentifier,
          childBinding,
        );
        if (selectedChildCalls.ambiguous) {
          ambiguousMounts.push(
            `${path.relative(REPO_ROOT, childFile)} via nested ${useCall.childIdentifier} (${useCall.file}:${useCall.line})`,
          );
          continue;
        }

        const childPrefix = useCall.rawPath
          ? joinPrefixAndRoute(mount.prefix, useCall.rawPath)
          : mount.prefix;
        for (const childCall of selectedChildCalls.selected) {
          const fullPath = joinPrefixAndRoute(childPrefix, childCall.rawPath);
          const source = `${childCall.file}:${childCall.line}`;
          addRoute(fullPath, childCall.method, source);
        }
      }
    }
  }

  return { routes, ambiguousMounts };
}

async function extractIntegrationCalls(): Promise<IntegrationCall[]> {
  const files = await walk(INTEGRATION_TESTS, /\.(ts|tsx)$/);
  const calls: IntegrationCall[] = [];

  const callPattern =
    /\.\s*(get|post|put|delete|patch|head)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const file of files) {
    let src: string;
    try {
      src = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const stripped = stripComments(src);

    let m: RegExpExecArray | null;
    callPattern.lastIndex = 0;
    while ((m = callPattern.exec(stripped)) !== null) {
      const method = m[1].toUpperCase() as HttpMethod;
      const rawUrl = m[2];
      if (!rawUrl.startsWith('/')) continue;

      const upto = stripped.slice(0, m.index);
      const line = upto.split('\n').length;

      calls.push({
        method,
        rawUrl,
        normalisedUrl: normaliseUrl(rawUrl),
        file: path.relative(REPO_ROOT, file),
        line,
      });
    }
  }

  return calls;
}

function matchesBackend(call: IntegrationCall, routes: BackendRoute[]): boolean {
  return routes.some((route) => {
    if (route.method !== call.method) return false;
    return route.pattern.test(call.normalisedUrl);
  });
}

async function loadAllowlist(): Promise<Set<string>> {
  try {
    const src = await fs.readFile(ALLOWLIST_PATH, 'utf8');
    const out = new Set<string>();
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      // Accept allowlist metadata tails (e.g. `| expires: ...`) while
      // matching only the route key segment (`METHOD path` or `path`).
      const beforeHash = line.split('#', 1)[0].trim();
      const keyOnly = beforeHash.split('|', 1)[0].trim();
      if (!keyOnly) continue;
      out.add(keyOnly);
    }
    return out;
  } catch {
    return new Set();
  }
}

async function main(): Promise<number> {
  console.log('→ check-integration-calls-backend-route');

  const [mounted, direct, calls, allowlist] = await Promise.all([
    buildMountedRoutes(),
    extractDirectServerRoutes(),
    extractIntegrationCalls(),
    loadAllowlist(),
  ]);
  const routes = [...mounted.routes, ...direct];

  console.log(
    `  backend catalog: ${mounted.routes.length} mounted-route(s), ${direct.length} direct app-route(s)`,
  );
  console.log(
    `  integration calls: ${calls.length} supertest-style URL call(s)`,
  );
  console.log(`  allowlist: ${allowlist.size} entries`);
  if (mounted.ambiguousMounts.length > 0) {
    console.log(
      `  note: skipped ${mounted.ambiguousMounts.length} ambiguous mount binding(s)`,
    );
  }

  const violations: string[] = [];
  for (const call of calls) {
    const key = `${call.method} ${call.normalisedUrl}`;
    if (allowlist.has(key) || allowlist.has(call.normalisedUrl)) continue;
    if (!matchesBackend(call, routes)) {
      violations.push(
        `  ✗ ${call.file}:${call.line}: ${call.method} ${call.rawUrl}`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('');
    console.error(
      `✗ FAIL: ${violations.length} integration call(s) target URLs with no backend handler.`,
    );
    console.error('');
    for (const v of violations) console.error(v);
    if (mounted.ambiguousMounts.length > 0) {
      console.error('');
      console.error('Ambiguous mount bindings (skipped to avoid false-positives):');
      for (const x of mounted.ambiguousMounts) {
        console.error(`  - ${x}`);
      }
    }
    console.error('');
    console.error('Fix one of:');
    console.error('  1. Change the integration test URL to a mounted backend route');
    console.error('  2. Add the missing backend route if the test is correct');
    console.error('  3. Allowlist only intentional non-existent-route tests:');
    console.error(`     ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
    console.error('');
    console.error('BUG-452 rationale: zombie tests (silent 404s) must fail closed.');
    return 1;
  }

  console.log('✓ Every integration-test URL resolves to a mounted backend route.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(
      `check-integration-calls-backend-route: unhandled error\n${msg}`,
    );
    process.exit(2);
  });
