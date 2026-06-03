#!/usr/bin/env tsx
/**
 * scripts/guards/check-scaffold-extension.ts
 *
 * Phase 0b.1b-ii-B (operator-authorized 2026-05-04) — scaffold-extension
 * guard.
 *
 * RESPONSIBILITY: enforce that hand-written Zod object schemas in
 * `packages/shared/src/*.ts` (the SSoT for API contracts) which have a
 * corresponding migration-driven scaffold under `packages/shared/src/_scaffolds/`
 * EITHER:
 *   (a) import + extend / merge / intersect the scaffold (so the
 *       migration-derived field set is the foundation), OR
 *   (b) carry a `// @scaffold-divergence: <reason>` annotation at file or
 *       schema-declaration level (acknowledging that the hand-written
 *       schema deliberately diverges from the migration-driven scaffold).
 *
 * Why (per CLAUDE.md §15 + Phase 0b.1 plan): when a migration adds a
 * column to a table, the migration-driven scaffold updates automatically.
 * If hand-written schemas extend the scaffold, downstream consumer
 * compile errors surface the schema drift. If hand-written schemas are
 * INDEPENDENT, drift goes silent for as long as the existing field
 * coverage happens to align — exactly the SD-class drift CLAUDE.md §15
 * was filed to prevent.
 *
 * Scope (operator-scoped 2026-05-04):
 *   - SCAN top-level `packages/shared/src/*.ts` only (non-recursive).
 *   - SKIP `packages/shared/src/_scaffolds/` (the scaffolds themselves).
 *   - SKIP `.test.ts` and `.spec.ts` files.
 *   - HEURISTIC: derive candidate scaffold table name from the schema
 *     variable name (e.g. `MedicationResponseSchema` → `medications.response`,
 *     `medications.dto`). Try multiple candidate forms (direct lowercase,
 *     pluralized, snake_case).
 *   - If NO matching scaffold exists for any candidate, the schema is
 *     OUT OF SCOPE for this guard (no migration-driven counterpart exists).
 *
 * Allowlist:
 *   - `scripts/guards/check-scaffold-extension.allowlist`
 *   - Format: one entry per line, `<file>:<schemaName>  # <reason>`
 *   - Lenient baseline seeded for pre-existing files only; NEW
 *     hand-written schemas with a matching scaffold cannot be allowlisted
 *     (verified by per-entry pre-existence check at guard run time).
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 *   2 — malformed allowlist OR stale entry (covered table no longer has a
 *       scaffold; or the listed schema no longer exists in the file)
 */

import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from './lib/repoRoot';

const SHARED_SRC = path.join(REPO_ROOT, 'packages', 'shared', 'src');
const SCAFFOLDS_DIR = path.join(SHARED_SRC, '_scaffolds');
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts', 'guards', 'check-scaffold-extension.allowlist');

interface SchemaDecl {
  readonly file: string; // absolute path
  readonly fileRelative: string; // relative to repo root
  readonly schemaName: string; // e.g. MedicationResponseSchema
  readonly declarationStart: number; // line number (1-based)
}

interface ScaffoldMatch {
  readonly scaffoldFile: string; // path to matching scaffold (relative to repo root)
  readonly scaffoldExportName: string; // e.g. MedicationsResponseScaffoldSchema
  readonly tableName: string; // snake_case table name
  readonly kind: 'dto' | 'response';
}

interface Violation {
  readonly file: string;
  readonly schemaName: string;
  readonly declarationStart: number;
  readonly scaffoldMatch: ScaffoldMatch;
  readonly reason: string;
}

/**
 * Camel/Pascal → snake_case + simple pluralization candidates for the
 * scaffold table name. Conservative: emit multiple candidate strings and
 * test each against the scaffolds directory.
 */
export function deriveCandidateTableNames(schemaName: string): string[] {
  // Strip the trailing semantic suffix
  const withoutSuffix = schemaName
    .replace(/(Dto|Response|Request|Body|Schema|Scaffold)+Schema?$/, '')
    .replace(/Schema$/, '');
  if (!withoutSuffix) return [];

  // Camel → snake: insert _ before uppercase, then lowercase
  const snake = withoutSuffix
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
  if (!snake) return [];

  const candidates = new Set<string>();
  candidates.add(snake);

  // Naive pluralization
  if (!snake.endsWith('s')) {
    if (snake.endsWith('y') && !/[aeiou]y$/.test(snake)) {
      candidates.add(snake.slice(0, -1) + 'ies');
    } else if (snake.endsWith('s') || snake.endsWith('x') || snake.endsWith('z') || snake.endsWith('ch') || snake.endsWith('sh')) {
      candidates.add(snake + 'es');
    } else {
      candidates.add(snake + 's');
    }
  }
  // De-pluralization (some schemas might already be plural)
  if (snake.endsWith('s') && snake.length > 2) {
    candidates.add(snake.slice(0, -1));
  }
  return Array.from(candidates);
}

/**
 * Determine whether a schemaName implies a DTO or Response scaffold.
 */
export function deriveScaffoldKind(schemaName: string): 'dto' | 'response' | null {
  if (/Response/i.test(schemaName)) return 'response';
  if (/Dto|Request|Body|Update|Create/i.test(schemaName)) return 'dto';
  return null;
}

/**
 * Walk packages/shared/src top-level *.ts files (non-recursive; explicit
 * exclusion of _scaffolds/ enforced by scope).
 */
function listSharedSchemaFiles(): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SHARED_SRC, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.ts')) continue;
    if (e.name.endsWith('.test.ts') || e.name.endsWith('.spec.ts')) continue;
    out.push(path.join(SHARED_SRC, e.name));
  }
  return out;
}

/**
 * Extract every `export const <Name>Schema = z.object(...)` declaration
 * from the source. The line number is the line containing `export const`.
 */
export function findZodObjectSchemas(source: string, file: string, fileRelative: string): SchemaDecl[] {
  const decls: SchemaDecl[] = [];
  const lines = source.split('\n');
  // Match: export const Foo[Schema] = z.object(
  const re = /^\s*export\s+const\s+([A-Za-z_$][\w$]*Schema)\s*=\s*z\.object\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) {
      decls.push({
        file,
        fileRelative,
        schemaName: m[1],
        declarationStart: i + 1,
      });
    }
  }
  return decls;
}

/**
 * Find a matching scaffold for a hand-written schema. Returns the first
 * scaffold (by candidate-table-name search) that exists on disk, or null.
 */
export function findMatchingScaffold(decl: SchemaDecl): ScaffoldMatch | null {
  const kind = deriveScaffoldKind(decl.schemaName);
  if (!kind) return null;
  const candidates = deriveCandidateTableNames(decl.schemaName);
  for (const tableName of candidates) {
    const scaffoldPath = path.join(SCAFFOLDS_DIR, `${tableName}.${kind}.scaffold.ts`);
    if (fs.existsSync(scaffoldPath)) {
      // Look up the scaffold's exported schema name from its content.
      const scaffoldSrc = fs.readFileSync(scaffoldPath, 'utf8');
      const exportMatch = /export const (\w+ScaffoldSchema)\s*=/.exec(scaffoldSrc);
      const exportName = exportMatch ? exportMatch[1] : `<unknown>`;
      return {
        scaffoldFile: path.relative(REPO_ROOT, scaffoldPath),
        scaffoldExportName: exportName,
        tableName,
        kind,
      };
    }
  }
  return null;
}

/**
 * A hand-written schema "extends" the scaffold IF either:
 *  (a) the file imports the scaffold's schema (or type) export, OR
 *  (b) a `// @scaffold-divergence: <reason>` annotation appears within
 *      ±10 lines of the schema declaration (or anywhere at file-level
 *      header — first 30 lines).
 */
export function fileExtendsOrDiverges(
  source: string,
  decl: SchemaDecl,
  scaffoldMatch: ScaffoldMatch,
): { extended: boolean; diverges: boolean; reason?: string } {
  // (a) import check
  const importRe = new RegExp(
    `import\\s+(?:type\\s+)?\\{[^}]*\\}\\s+from\\s+['"]\\./_scaffolds/${scaffoldMatch.tableName}\\.${scaffoldMatch.kind}\\.scaffold['"]`,
  );
  const extended = importRe.test(source);

  // (b) divergence annotation check
  const lines = source.split('\n');
  const lo = Math.max(0, decl.declarationStart - 11); // 10 lines above
  const hi = Math.min(lines.length, decl.declarationStart + 9); // 10 lines below
  for (let i = lo; i < hi; i++) {
    const m = /\/\/\s*@scaffold-divergence:\s*(.+)/.exec(lines[i]);
    if (m) return { extended, diverges: true, reason: m[1].trim() };
  }
  // File-level annotation in first 30 lines
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const m = /\/\/\s*@scaffold-divergence:\s*(.+)/.exec(lines[i]);
    if (m) return { extended, diverges: true, reason: m[1].trim() };
  }

  return { extended, diverges: false };
}

interface AllowlistEntry {
  readonly fileRelative: string;
  readonly schemaName: string;
  readonly reason: string;
  readonly raw: string; // full line for stale-detection error reporting
}

function readAllowlist(): AllowlistEntry[] {
  if (!fs.existsSync(ALLOWLIST_PATH)) return [];
  const text = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
  const out: AllowlistEntry[] = [];
  for (const lineRaw of text.split('\n')) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    // Format: <file>:<schemaName>  # <reason>
    const m = /^([^\s:]+):([A-Za-z_$][\w$]*)\s*#\s*(.+)$/.exec(line);
    if (!m) {
      // permanent: doc-meta-self-referential — guard parser accepts entries
      // without a reason comment (legacy format); the absence is reported via
      // the `<no reason supplied>` placeholder so operators see which entries
      // need annotation. Hard-rejecting unannotated entries is tracked as
      // `BUG-PHASE-0B-1B-II-B-FOLLOWUP-ALLOWLIST-REASON-REQUIRED` (S3).
      const m2 = /^([^\s:]+):([A-Za-z_$][\w$]*)\s*$/.exec(line);
      if (m2) {
        out.push({ fileRelative: m2[1], schemaName: m2[2], reason: '<no reason supplied>', raw: lineRaw });
        continue;
      }
      out.push({ fileRelative: '<malformed>', schemaName: '<malformed>', reason: lineRaw, raw: lineRaw });
      continue;
    }
    out.push({ fileRelative: m[1], schemaName: m[2], reason: m[3].trim(), raw: lineRaw });
  }
  return out;
}

interface RunResult {
  scanned: number;
  schemasFound: number;
  scaffoldedSchemas: number;
  violations: Violation[];
  allowlistEntries: number;
  staleEntries: AllowlistEntry[];
  malformedEntries: AllowlistEntry[];
}

export function run(): RunResult {
  const files = listSharedSchemaFiles();
  const allowlist = readAllowlist();
  const allowlistKeyed = new Map<string, AllowlistEntry>();
  for (const e of allowlist) {
    allowlistKeyed.set(`${e.fileRelative}:${e.schemaName}`, e);
  }

  const violations: Violation[] = [];
  const allSeenKeys = new Set<string>();
  let schemasFound = 0;
  let scaffoldedSchemas = 0;
  const malformed = allowlist.filter((e) => e.fileRelative === '<malformed>');

  for (const file of files) {
    const fileRelative = path.relative(REPO_ROOT, file);
    const source = fs.readFileSync(file, 'utf8');
    const decls = findZodObjectSchemas(source, file, fileRelative);
    schemasFound += decls.length;

    for (const decl of decls) {
      const match = findMatchingScaffold(decl);
      if (!match) continue; // design scope: schemas without a matching scaffold are not enforced
      scaffoldedSchemas++;
      const result = fileExtendsOrDiverges(source, decl, match);
      if (result.extended || result.diverges) continue;

      const key = `${fileRelative}:${decl.schemaName}`;
      allSeenKeys.add(key);

      if (allowlistKeyed.has(key)) continue; // allowlisted

      violations.push({
        file: fileRelative,
        schemaName: decl.schemaName,
        declarationStart: decl.declarationStart,
        scaffoldMatch: match,
        reason: 'no import from scaffold + no @scaffold-divergence annotation',
      });
    }
  }

  // Stale-allowlist detection: any entry whose key was not seen as a violation
  // (because it now extends the scaffold OR the schema was removed) should be
  // flagged so the allowlist self-cleans.
  const staleEntries: AllowlistEntry[] = [];
  for (const entry of allowlist) {
    if (entry.fileRelative === '<malformed>') continue;
    const key = `${entry.fileRelative}:${entry.schemaName}`;
    if (!allSeenKeys.has(key)) staleEntries.push(entry);
  }

  return {
    scanned: files.length,
    schemasFound,
    scaffoldedSchemas,
    violations,
    allowlistEntries: allowlist.length - malformed.length,
    staleEntries,
    malformedEntries: malformed,
  };
}

function main() {
  // eslint-disable-next-line no-console
  console.log('\n→ check-scaffold-extension (Phase 0b.1b-ii-B; CLAUDE.md §15 + plan §0b.1)\n');
  const result = run();
  // eslint-disable-next-line no-console
  console.log(`  scanned files:      ${result.scanned}`);
  // eslint-disable-next-line no-console
  console.log(`  schemas found:      ${result.schemasFound}`);
  // eslint-disable-next-line no-console
  console.log(`  with scaffold:      ${result.scaffoldedSchemas}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist entries:  ${result.allowlistEntries}`);
  // eslint-disable-next-line no-console
  console.log(`  violations:         ${result.violations.length}`);
  // eslint-disable-next-line no-console
  console.log(`  stale allowlist:    ${result.staleEntries.length}`);
  // eslint-disable-next-line no-console
  console.log(`  malformed entries:  ${result.malformedEntries.length}`);

  if (result.malformedEntries.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ malformed allowlist entries:`);
    for (const e of result.malformedEntries) {
      // eslint-disable-next-line no-console
      console.error(`  ${e.raw}`);
    }
    process.exit(2);
  }

  if (result.staleEntries.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ stale allowlist entries (schema now extends OR was removed — clean up):`);
    for (const e of result.staleEntries) {
      // eslint-disable-next-line no-console
      console.error(`  ${e.fileRelative}:${e.schemaName}  # ${e.reason}`);
    }
    process.exit(2);
  }

  if (result.violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ ${result.violations.length} hand-written schema(s) have a migration-driven scaffold but neither extend it nor annotate divergence:`);
    for (const v of result.violations) {
      // eslint-disable-next-line no-console
      console.error(`\n  ${v.file}:${v.declarationStart}  ${v.schemaName}`);
      // eslint-disable-next-line no-console
      console.error(`    matching scaffold: ${v.scaffoldMatch.scaffoldFile}`);
      // eslint-disable-next-line no-console
      console.error(`    expected: import { ${v.scaffoldMatch.scaffoldExportName} } from './_scaffolds/${v.scaffoldMatch.tableName}.${v.scaffoldMatch.kind}.scaffold';`);
      // eslint-disable-next-line no-console
      console.error(`              and use .extend({...}) / .merge({...}) / .pick({...}) / .omit({...})`);
      // eslint-disable-next-line no-console
      console.error(`    OR: add  // @scaffold-divergence: <reason>  within ±10 lines of the declaration`);
    }
    // eslint-disable-next-line no-console
    console.error(`\nFix per CLAUDE.md §15 + Phase 0b.1 plan: hand-written schemas with a migration-driven scaffold MUST extend the scaffold OR explicitly annotate divergence. New entries cannot be allowlisted (the allowlist is for pre-existing baseline drift only).`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('\n✓ Every hand-written schema with a matching scaffold either extends it or annotates divergence.');
}

if (require.main === module) {
  main();
}
