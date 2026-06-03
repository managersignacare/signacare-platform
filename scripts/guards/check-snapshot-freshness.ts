/**
 * CI guard: apps/api/src/db/schema-snapshot.json must be regenerated after
 * every migration. The guard fails if the snapshot is stale.
 *
 * Why this exists — Phase R (2026-04-18). The snapshot is consumed by two
 * other guards (guard:row-iface-drift and guard:code-columns). If a PR lands
 * a migration but forgets to regenerate the snapshot, those guards run
 * against the PREVIOUS schema — new columns look like drift, new tables look
 * missing. This guard catches the "forgot to regenerate" scenario at CI time.
 *
 * Checks:
 *   1. Snapshot file exists and parses as JSON
 *   2. Required keys are present: generatedAt, database, tables
 *   3. `tables` contains at least 100 entries (sanity)
 *   4. `generatedAt` parses as an ISO date
 *   5. Via git: the most recent commit to apps/api/migrations/ is NOT newer
 *      than the most recent commit to apps/api/src/db/schema-snapshot.json.
 *      If a migration was committed after the snapshot, the snapshot is
 *      presumed stale.
 *
 * Exit code:
 *   0 — snapshot is fresh
 *   1 — snapshot is missing, malformed, or outdated
 *
 * To regenerate: `npm run db:snapshot --workspace=apps/api`
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(__dirname, '..', '..');
const SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const MIGRATIONS_DIR = resolve(ROOT, 'apps', 'api', 'migrations');
const SNAPSHOT_REL = 'apps/api/src/db/schema-snapshot.json';
const MIGRATIONS_REL = 'apps/api/migrations';

interface SchemaSnapshot {
  generatedAt: string;
  /** Optional: full ISO-8601 timestamp of the most recent regen. Added
   *  so every `npm run db:snapshot` produces a git-visible diff even when
   *  table content is otherwise unchanged — required to distinguish
   *  "re-ran the generator" from "skipped the generator". */
  generatedAtIso?: string;
  database: string;
  tables: Record<string, string[]>;
}

/**
 * Returns the UNIX timestamp (seconds) of the most recent git commit
 * that touched the given path, or null if git is unavailable / path has
 * no history.
 */
function gitLatestCommitTime(path: string): number | null {
  try {
    const out = execSync(`git log -1 --format=%ct -- "${path}"`, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function gitPathDirty(path: string): boolean {
  try {
    const out = execSync(`git status --porcelain -- "${path}"`, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Filesystem-mtime fallback — used when git isn't available (e.g. shallow
 * clone with no history for the path). Returns the max mtime across the
 * path's descendants.
 */
function fsLatestMtime(path: string): number | null {
  try {
    const s = statSync(path);
    if (s.isFile()) return Math.floor(s.mtimeMs / 1000);
    if (s.isDirectory()) {
      let max = Math.floor(s.mtimeMs / 1000);
      const entries = readdirSync(path);
      for (const e of entries) {
        const full = resolve(path, e);
        try {
          const es = statSync(full);
          const t = es.isDirectory()
            ? (fsLatestMtime(full) ?? Math.floor(es.mtimeMs / 1000))
            : Math.floor(es.mtimeMs / 1000);
          if (t > max) max = t;
        } catch {
          // skip
        }
      }
      return max;
    }
    return null;
  } catch {
    return null;
  }
}

function effectivePathTime(pathRel: string, pathAbs: string): { timestamp: number | null; source: string } {
  // If the path has local edits, prefer filesystem mtime. This lets local
  // developers rerun the snapshot generator and validate freshness before
  // committing. CI remains strict because worktrees are clean there.
  if (gitPathDirty(pathRel)) {
    const fsTime = fsLatestMtime(pathAbs);
    if (fsTime !== null) return { timestamp: fsTime, source: 'fs mtime (dirty path)' };
  }

  const gitTime = gitLatestCommitTime(pathRel);
  if (gitTime !== null) return { timestamp: gitTime, source: 'git commit' };

  const fsTime = fsLatestMtime(pathAbs);
  return {
    timestamp: fsTime,
    source: fsTime === null ? 'unavailable' : 'fs mtime',
  };
}

function main(): void {
  let failed = false;
  console.error(`\n→ check-snapshot-freshness`);

  // 1. Snapshot file exists
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`\n✗ FAIL: snapshot file is missing at ${SNAPSHOT_REL}`);
    console.error(`  Fix: npm run db:snapshot --workspace=apps/api`);
    process.exit(1);
  }

  // 2. Snapshot parses as JSON + has required keys
  let snap: SchemaSnapshot;
  try {
    snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SchemaSnapshot;
  } catch (err) {
    console.error(`\n✗ FAIL: ${SNAPSHOT_REL} does not parse as JSON.`);
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`  Fix: npm run db:snapshot --workspace=apps/api`);
    process.exit(1);
  }

  if (!snap.generatedAt || !snap.database || !snap.tables) {
    console.error(`\n✗ FAIL: ${SNAPSHOT_REL} is missing required keys (generatedAt, database, tables).`);
    console.error(`  Fix: npm run db:snapshot --workspace=apps/api`);
    process.exit(1);
  }

  // 3. generatedAt parses as date
  const genDate = new Date(snap.generatedAt);
  if (Number.isNaN(genDate.getTime())) {
    console.error(`\n✗ FAIL: generatedAt="${snap.generatedAt}" is not a parseable ISO date.`);
    console.error(`  Fix: npm run db:snapshot --workspace=apps/api`);
    process.exit(1);
  }

  // 4. Tables map has a sane number of entries
  const tableCount = Object.keys(snap.tables).length;
  console.error(`  snapshot path:   ${SNAPSHOT_REL}`);
  console.error(`  generatedAt:     ${snap.generatedAt}`);
  console.error(`  database:        ${snap.database}`);
  console.error(`  tables tracked:  ${tableCount}`);

  if (tableCount < 100) {
    console.error(`\n✗ FAIL: snapshot only lists ${tableCount} tables — expected ≥100.`);
    console.error(`  Fix: npm run db:snapshot --workspace=apps/api`);
    process.exit(1);
  }

  // 5. Git-based freshness check: if migrations were committed more
  //    recently than the snapshot, the snapshot is presumed stale.
  //    Fall back to mtime if git isn't available.
  const mig = effectivePathTime(MIGRATIONS_REL, MIGRATIONS_DIR);
  const snapMeta = effectivePathTime(SNAPSHOT_REL, SNAPSHOT_PATH);
  const migTime = mig.timestamp;
  const snapTime = snapMeta.timestamp;

  if (migTime !== null && snapTime !== null) {
    const fmt = (ts: number) => new Date(ts * 1000).toISOString();
    console.error(`  migrations last: ${fmt(migTime)}  (${mig.source})`);
    console.error(`  snapshot last:   ${fmt(snapTime)}  (${snapMeta.source})`);

    // Allow a 60-second fudge to avoid race conditions in a single commit
    // where git records the snapshot and the migration in the same commit
    // but with micro-different timestamps.
    if (migTime > snapTime + 60) {
      const gap = Math.round((migTime - snapTime) / 3600);
      console.error(`\n✗ FAIL: migrations have been committed more recently than the snapshot (gap ≈ ${gap}h).`);
      console.error(`  This means a migration landed without regenerating the snapshot. Downstream`);
      console.error(`  guards (guard:row-iface-drift, guard:code-columns) will see stale schema data.`);
      console.error(`  Fix: npm run db:snapshot --workspace=apps/api`);
      console.error(`       then commit apps/api/src/db/schema-snapshot.json`);
      failed = true;
    }
  } else {
    console.error(`  (git history unavailable — skipping freshness comparison)`);
  }

  if (failed) process.exit(1);
  console.error(`\n✓ Snapshot is well-formed and fresh.\n`);
}

main();
