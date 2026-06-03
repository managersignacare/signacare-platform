#!/usr/bin/env tsx
/*
 * scripts/guards/check-no-vulnerable-uuid.ts
 *
 * BUG-474 — CI guard pinning the `uuid` chain to `>= 9.0.1` to keep
 * GHSA-w5hq-g745-h8pq closed.
 *
 * The advisory describes a bounds-check vulnerability in `uuid.v3()`,
 * `uuid.v5()`, and `uuid.v6()` when called with a caller-supplied
 * `buf` argument. It is patched in `9.0.1`. Two transitive paths in
 * this repo bundled `uuid@8.3.2` until BUG-474:
 *
 *   - node_modules/@azure/msal-node/node_modules/uuid
 *   - node_modules/node-cron/node_modules/uuid
 *
 * BUG-474's root `package.json` `overrides` block forces every
 * resolution to `^9.0.1`. This guard checks that the override is
 * effective at the lockfile level — every `uuid` install in
 * `package-lock.json` must satisfy `>= 9.0.1`.
 *
 * Why parse the lockfile rather than walk `node_modules`:
 *   - `npm ci` (used by CI) installs strictly from the lockfile;
 *     anything not in the lockfile won't ship to production.
 *   - Lockfile parse is deterministic and ~100ms; node_modules walk
 *     is slow and depends on a fresh install.
 *
 * Sibling guards: BUG-373 (R-FIX-BUG-373-PROTOBUFJS-CRITICAL) uses
 * the same lockfile-anchor pattern.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface LockfilePackage {
  version?: string;
  resolved?: string;
}

interface Lockfile {
  packages?: Record<string, LockfilePackage>;
}

const repoRoot = resolve(__dirname, '..', '..');
const lockfilePath = resolve(repoRoot, 'package-lock.json');

const raw = readFileSync(lockfilePath, 'utf-8');
const lockfile = JSON.parse(raw) as Lockfile;

if (!lockfile.packages) {
  console.error(
    `check-no-vulnerable-uuid: ${lockfilePath} has no \`packages\` block.`,
  );
  process.exit(1);
}

const failures: string[] = [];

// Compare two semver strings (no pre-release) and return -1 / 0 / 1.
function cmpSemver(a: string, b: string): number {
  const av = a.split('.').map((s) => parseInt(s, 10));
  const bv = b.split('.').map((s) => parseInt(s, 10));
  for (let i = 0; i < 3; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

const MIN_SAFE = '9.0.1';

for (const [pkgPath, pkg] of Object.entries(lockfile.packages)) {
  // The lockfile keys are workspace-relative paths into `node_modules`.
  // We only care about `uuid` resolutions, NOT `@smithy/uuid`,
  // `uuid-random`, etc. (different packages that happen to share the
  // substring).
  const segments = pkgPath.split('/');
  const last = segments[segments.length - 1];
  const secondLast = segments[segments.length - 2];
  const isUuidPackage =
    last === 'uuid' &&
    // Reject `@smithy/uuid` and any other scoped uuid by checking the
    // segment immediately preceding `uuid` is `node_modules` — i.e.
    // the package WAS resolved as `uuid`, not as `@scope/uuid`.
    secondLast === 'node_modules';
  if (!isUuidPackage) continue;
  if (!pkg.version) continue;

  if (cmpSemver(pkg.version, MIN_SAFE) < 0) {
    failures.push(
      `  ${pkgPath}@${pkg.version} < ${MIN_SAFE} (vulnerable to GHSA-w5hq-g745-h8pq)`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `check-no-vulnerable-uuid: ${failures.length} vulnerable uuid resolution(s) in package-lock.json:`,
  );
  for (const f of failures) console.error(f);
  console.error(
    `\nFix: ensure root package.json \`overrides\` block has \`"uuid": "^${MIN_SAFE}"\`,`,
  );
  console.error(
    `then run \`npm install\` to regenerate the lockfile.`,
  );
  process.exit(1);
}

console.log(
  `check-no-vulnerable-uuid: OK — every uuid resolution in package-lock.json is >= ${MIN_SAFE}.`,
);
