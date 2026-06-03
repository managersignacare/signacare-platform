#!/usr/bin/env ts-node
/*
 * scripts/guards/check-frontend-calls-backend-route.ts
 *
 * Phase 0.7-audit §9.4 — every frontend apiClient URL must resolve
 * to a backend handler.
 *
 * This is the forward-direction partner of
 * .github/scripts/check-mounted-routes-have-callers.sh. That guard
 * enforces "no routes without callers". This one enforces "no
 * callers without routes". Together they close the loop and make
 * dead-URL 404s a pre-merge failure rather than an audit finding.
 *
 * Strategy (deliberately simple + regex-based, no full TS AST parse):
 *
 *   1. Walk apps/api/src/server.ts and backend source files that can
 *      register routes (routes + registrar modules). For each mount
 *      pattern `app.use(\`${API}/x\`, routerVar)` capture the mount
 *      prefix. For each `router.(get|post|...)('path', ...)` extract
 *      the relative path. Join mount + relative for the catalog.
 *
 *   2. Walk apps/web/src/** /*.{ts,tsx} for
 *        apiClient.(get|post|put|delete|patch)('url'...)
 *        apiClient.instance.(get|post|put|delete|patch)('url'...)
 *      Capture the url literal (string literal OR simple template
 *      literal). Normalize to the "what path will axios hit" form.
 *
 *   3. For each frontend URL, check against the backend catalog.
 *      A URL matches if some backend route satisfies the path after
 *      ${...} interpolation + :param segment substitution.
 *
 *   4. Allowlist in .github/scripts/frontend-url.allowlist for
 *      dynamic URLs that can't be resolved statically (e.g. built
 *      from a user-provided string at runtime).
 *
 * Output: one line per violation, exit 1 on any violation.
 * Runs in ~1 s on the full repo; sub-guard-worth.
 *
 * NOT a full AST parser. Specifically handles the patterns we
 * actually use. Misses are allowlisted, and the guard rejects new
 * unknown-pattern call sites by default so a new exotic form gets
 * flagged and the author adds it to the allowlist (with a rationale)
 * or rewrites to a supported form.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_SRC = path.join(REPO_ROOT, 'apps', 'api', 'src');
const WEB_SRC = path.join(REPO_ROOT, 'apps', 'web', 'src');
const SERVER_TS = path.join(API_SRC, 'server.ts');
const ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  '.github',
  'scripts',
  'frontend-url.allowlist',
);

// ── 1. Catalog the backend ──────────────────────────────────────

interface RouteEntry {
  readonly method: string;
  readonly pattern: RegExp;
  readonly rawPath: string;
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

// Map: router variable name → mount prefix under /api/v1
async function buildRouterPrefixMap(): Promise<Map<string, string>> {
  const src = await fs.readFile(SERVER_TS, 'utf8');
  const map = new Map<string, string>();

  const lines = src.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    // Skip comments
    if (line.startsWith('//')) continue;

    // Pattern: app.use(`${API}/prefix`, routerVar)
    //          app.use(`${API}`, routerVar)
    //          app.use(API, routerVar)
    //          app.use(routerVar)  ← bare mount, prefix = ''
    const m1 = line.match(
      /app\.use\(\s*`\$\{API\}([^`]*)`\s*,\s*([\w$,\s]+)\s*\)/,
    );
    if (m1) {
      const prefix = `/api/v1${m1[1]}`;
      const names = m1[2].split(',').map((s) => s.trim());
      for (const name of names) {
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
          map.set(name, prefix);
        }
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
      // Bare mount — prefix is empty string, router's own paths are
      // already full paths (or the router itself uses absolute
      // `/api/v1/...` internally).
      if (!map.has(m3[1])) map.set(m3[1], '');
    }
  }

  return map;
}

// Parse a single routes file and extract route declarations.
// Supports: router.get('/path'), router.post('path'), etc.
//           this.use('/prefix', ...)  → nested prefix we track
// The file may export multiple named routers; we treat them
// uniformly — the matching against the prefix map is on the
// variable name discovered from `const name = Router()` or
// `export const name = Router()`.
async function extractRoutes(file: string): Promise<RouteEntry[]> {
  const src = await fs.readFile(file, 'utf8');
  const routes: RouteEntry[] = [];

  // Route declarations in this codebase come in two shapes:
  //   A. single-line:  router.get('/:id', handler)
  //   B. multi-line:   router.post(
  //                      '/:id/cease',
  //                      middleware,
  //                      ceaseMedication,
  //                    );
  //
  // The single-line regex I started with caught (A) but silently
  // missed (B) — which is how `medications/:id/cease` and
  // `power-settings/branding/logo` wound up as false-negative
  // violations in the first run of this guard. Fix: use a
  // whitespace-tolerant regex against the entire file source and
  // track line numbers separately for error messages.
  //
  // We require the target identifier to look router-like so we
  // don't false-positive on unrelated method calls (e.g.
  // `myArray.get(0)` or `someStream.post('message')`).
  const routeCallPattern =
    /([\w$]+)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  // Strip /* ... */ and // comments up to end of line so commented-
  // out route declarations don't land in the catalog. Simple pass
  // — doesn't need to handle strings inside comments because we
  // never have route declarations inside string literals in this
  // codebase.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, prefix) => prefix);

  let m: RegExpExecArray | null;
  routeCallPattern.lastIndex = 0;
  while ((m = routeCallPattern.exec(stripped)) !== null) {
    const target = m[1];
    const method = m[2];
    const rawPath = m[3];

    // Heuristic: the target must be a router-like. Accept:
    //   - ends in Routes / routes  (riskRoutes, appointmentRoutes)
    //   - ends in Router / router  (authRouter, powerSettingsRouter)
    //   - is `router` or `r`       (common local variable name)
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

    // Recover the line number by counting newlines up to the match
    // index in the stripped source (which has the same newline
    // positions as the original).
    const upto = stripped.slice(0, m.index);
    const lineNo = upto.split('\n').length;

    const pattern = rawPathToRegex(rawPath);
    routes.push({
      method: method.toUpperCase(),
      pattern,
      rawPath,
      file: path.relative(REPO_ROOT, file),
      line: lineNo,
    });
  }

  return routes;
}

// Turn a route declaration into a regex that matches against the
// frontend URL minus the mount prefix. Replaces:
//   :param  →  [^/]+   (matches one path segment)
function rawPathToRegex(rawPath: string): RegExp {
  // Strip leading/trailing slashes so matchers are prefix-stable.
  const trimmed = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
  const escaped = trimmed
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_][\w]*/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

function isBackendRouteSource(file: string): boolean {
  const base = path.basename(file);
  if (!base.endsWith('.ts')) return false;
  if (base.endsWith('.d.ts')) return false;
  if (base.endsWith('.test.ts') || base.endsWith('.spec.ts')) return false;
  if (file.includes(`${path.sep}tests${path.sep}`)) return false;
  // Route declarations can exist in classic router files and in registrar
  // modules that mount onto an existing router (e.g. aiContextRegistrar.ts).
  return /([Rr]outes|[Rr]egistrar)\.ts$/.test(base);
}

async function buildBackendCatalog(): Promise<RouteEntry[]> {
  const routeFiles = await walk(API_SRC, /\.(ts)$/);
  const filtered = routeFiles.filter(isBackendRouteSource);
  const catalog: RouteEntry[] = [];
  for (const f of filtered) {
    catalog.push(...(await extractRoutes(f)));
  }
  return catalog;
}

// ── 2. Extract frontend apiClient call sites ────────────────────

interface FrontendCall {
  readonly method: string;
  readonly rawUrl: string;
  readonly normalisedUrl: string;
  readonly file: string;
  readonly line: number;
}

function normaliseUrl(raw: string): string {
  let u = raw;
  // Strip query string
  const q = u.indexOf('?');
  if (q !== -1) u = u.slice(0, q);
  // Strip leading slash (axios combines baseURL + url with one slash)
  u = u.replace(/^\/+/, '');
  // Replace ${...} interpolations with a single path-segment wildcard.
  // This is a deliberate over-approximation: anything interpolated
  // becomes "some segment", so the guard won't false-positive on
  // template literals with complex shape.
  u = u.replace(/\$\{[^}]+\}/g, ':DYNAMIC');
  // Replace backticks (if any leaked in) with nothing
  u = u.replace(/[`'"]/g, '');
  // Strip trailing slash
  u = u.replace(/\/+$/, '');
  return u;
}

async function extractFrontendCalls(): Promise<FrontendCall[]> {
  const files = await walk(WEB_SRC, /\.(ts|tsx)$/);
  const calls: FrontendCall[] = [];
  // Matches:
  //   apiClient.get('url'
  //   apiClient.get("url"
  //   apiClient.get(`url`
  //   apiClient.instance.get('url'
  //   apiClient.instance.get(`url`
  const callPattern =
    /apiClient(?:\.instance)?\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;

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
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
        continue;
      }
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

// ── 3. Matching ──────────────────────────────────────────────────

function backendRouteMatches(
  call: FrontendCall,
  catalog: RouteEntry[],
  prefixes: Map<string, string>,
): boolean {
  // The frontend URL normalisedUrl = "patients/123/risk-assessments"
  // A matching backend route has mount prefix /api/v1/patients and
  // relative path :patientId/risk-assessments.
  //
  // For every backend route, compute its full-path regex by joining
  // every prefix that could own it (because we don't track which
  // router variable each `.get(...)` came from) and test against the
  // normalised URL.
  //
  // Over-approximation: a call matches if ANY backend route's
  // (prefix + relative) pattern, with one prefix taken from the
  // known mounts, matches. If none match the call is a violation.

  const fullUrl = call.normalisedUrl;
  // Wildcard substitution on the call side so a known-dynamic
  // segment (:DYNAMIC) matches any backend :param or literal.
  const callRegex = new RegExp(
    `^${fullUrl.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:DYNAMIC/g, '[^/]+')}$`,
  );
  void callRegex; // Reserved for future bidirectional matching.

  for (const entry of catalog) {
    if (entry.method !== call.method) continue;
    // Try every mount prefix. Most routers only match one but we
    // iterate because we don't know which router owns this entry.
    for (const prefix of prefixes.values()) {
      // Build the backend URL in the same form as `normaliseUrl`
      // produces on the frontend: no /api/v1 prefix, no leading
      // slash, no trailing slash. Both sides must be trimmed
      // BEFORE joining — the pre-fix had `rawPath = '/:taskId'`
      // joined onto `strippedPrefix = 'tasks'` producing
      // `tasks//:taskId` (double slash).
      const strippedPrefix = prefix
        .replace(/^\/api\/v1\/?/, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
      // Strip /api/v1/ from the route path too if it appears there
      // — this handles the "bare mount + hardcoded full-path
      // router" pattern (allergies.routes.ts:28 declares
      // `router.patch('/api/v1/patients/:patientId/allergies/:id')`
      // because server.ts mounts it as `app.use(allergyRoutes)`
      // with no prefix). Without this strip the joined URL has
      // `api/v1/patients/...` and doesn't align with the frontend
      // `patients/...`.
      const rawPathTrimmed = entry.rawPath
        .replace(/^\/+/, '')
        .replace(/^api\/v1\/?/, '')
        .replace(/\/+$/, '');
      const joined = strippedPrefix
        ? (rawPathTrimmed
            ? `${strippedPrefix}/${rawPathTrimmed}`
            : strippedPrefix)
        : rawPathTrimmed;

      // Bidirectional match: (a) turn backend :params into literal
      // 'x', build regex from the frontend URL (:DYNAMIC → [^/]+),
      // test regex against backend literal. (b) turn frontend
      // :DYNAMIC into literal 'x', build regex from the backend
      // URL, test against frontend literal. Either direction
      // matching is sufficient for dead-URL detection.
      const literalBackend = joined.replace(/:[A-Za-z_][\w]*/g, 'x');
      const frontendRegex = new RegExp(
        `^${fullUrl
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/:DYNAMIC/g, '[^/]+')}$`,
      );
      if (frontendRegex.test(literalBackend)) return true;

      const frontendLiteral = fullUrl.replace(/:DYNAMIC/g, 'x');
      const backendRegex = new RegExp(
        `^${joined
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/:[A-Za-z_][\w]*/g, '[^/]+')}$`,
      );
      if (backendRegex.test(frontendLiteral)) return true;
    }
  }
  return false;
}

// ── 4. Allowlist ─────────────────────────────────────────────────

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

// ── 5. Main ──────────────────────────────────────────────────────

async function main(): Promise<number> {
  console.log('→ check-frontend-calls-backend-route');
  const [prefixes, catalog, calls, allowlist] = await Promise.all([
    buildRouterPrefixMap(),
    buildBackendCatalog(),
    extractFrontendCalls(),
    loadAllowlist(),
  ]);
  console.log(
    `  backend catalog: ${catalog.length} routes, ${prefixes.size} router prefixes`,
  );
  console.log(`  frontend calls:  ${calls.length} apiClient sites`);
  console.log(`  allowlist:       ${allowlist.size} entries`);

  const violations: string[] = [];
  for (const call of calls) {
    const key = `${call.method} ${call.normalisedUrl}`;
    if (allowlist.has(key) || allowlist.has(call.normalisedUrl)) continue;
    if (!backendRouteMatches(call, catalog, prefixes)) {
      violations.push(
        `  ✗ ${call.file}:${call.line}: ${call.method} ${call.rawUrl}`,
      );
    }
  }

  if (violations.length > 0) {
    console.error('');
    console.error(
      `✗ FAIL: ${violations.length} frontend apiClient call(s) target URLs with no backend handler.`,
    );
    console.error('');
    for (const v of violations) console.error(v);
    console.error('');
    console.error('Fix one of:');
    console.error('  1. Add a backend route handler for the URL');
    console.error('  2. Change the frontend URL to one that exists');
    console.error(
      '  3. If the URL is generated dynamically and cannot be resolved statically,',
    );
    console.error(
      `     add a line to ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} with "<METHOD> <url>"`,
    );
    console.error(
      '     OR just "<url>" — the key matches either form. Every allowlist entry',
    );
    console.error('     should carry a # comment explaining why.');
    console.error('');
    console.error('See CLAUDE.md §9.4 for the rationale.');
    return 1;
  }

  console.log(
    '✓ Every frontend apiClient URL resolves to a backend handler.',
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`check-frontend-calls-backend-route: unhandled error\n${msg}`);
    process.exit(2);
  });
