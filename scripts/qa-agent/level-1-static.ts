#!/usr/bin/env tsx
// scripts/qa-agent/level-1-static.ts
//
// Signacare EMR QA Agent — Level 1 (deterministic static checks)
//
// Runs 20 mechanical checks per PR. Exits non-zero on any violation.
// Emits JSON report to stdout for CI parsing.
//
// Usage:
//   tsx scripts/qa-agent/level-1-static.ts --base main --head HEAD
//   tsx scripts/qa-agent/level-1-static.ts --files apps/api/src/foo.ts,apps/api/src/bar.ts
//   tsx scripts/qa-agent/level-1-static.ts --staged         # check staged files (pre-commit)
//
// Invoked by: .husky/pre-commit, CI workflow, manual executor verification.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { extname, dirname, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Violation {
  check: string;
  severity: 'error' | 'warn';
  file: string;
  line: number;
  message: string;
}

interface Report {
  passed: boolean;
  files_checked: number;
  violations: Violation[];
  commit_class_verdict: 'trivial' | 'standard' | 'risky' | 'unknown';
  duration_ms: number;
}

// ─────────────────────────────────────────────────────────────
// File-discovery helpers
// ─────────────────────────────────────────────────────────────

const CHECKABLE_EXT = new Set(['.ts', '.tsx']);
const IGNORED_DIRS = /(^|\/)(node_modules|dist|build|\.git|coverage|test-results|playwright-report)(\/|$)/;

function parseArgs(): { files: string[]; mode: 'staged' | 'diff' | 'explicit' } {
  const argv = process.argv.slice(2);
  let base = 'main';
  let head = 'HEAD';
  let explicit: string[] = [];
  let mode: 'staged' | 'diff' | 'explicit' = 'diff';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--staged') mode = 'staged';
    else if (argv[i] === '--base') base = argv[++i];
    else if (argv[i] === '--head') head = argv[++i];
    else if (argv[i] === '--files') { explicit = argv[++i].split(','); mode = 'explicit'; }
  }

  if (mode === 'explicit') return { files: explicit.filter(Boolean), mode };

  try {
    const cmd = mode === 'staged'
      ? 'git diff --cached --name-only --diff-filter=ACMR'
      : `git diff --name-only --diff-filter=ACMR ${base}...${head}`;
    const files = execSync(cmd, { encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f && CHECKABLE_EXT.has(extname(f)) && !IGNORED_DIRS.test(f) && existsSync(f));
    return { files, mode };
  } catch {
    return { files: [], mode };
  }
}

function readLines(file: string): string[] {
  return readFileSync(file, 'utf8').split('\n');
}

function isTestFile(file: string): boolean {
  return /\.(test|spec|int\.test)\.tsx?$/.test(file) || /\/tests?\//.test(file);
}

function isProductionPath(file: string): boolean {
  return /^apps\/(api|web)\/src\//.test(file) && !isTestFile(file);
}

function isApiFile(file: string): boolean {
  return /^apps\/api\/src\//.test(file);
}

function isRouteFile(file: string): boolean {
  return /Routes?\.ts$/.test(file) || /\.routes\.ts$/.test(file);
}

function isServiceFile(file: string): boolean {
  return /Service\.ts$/.test(file) || /\.service\.ts$/.test(file);
}

function isMigrationFile(file: string): boolean {
  return /^apps\/api\/migrations\//.test(file);
}

function resolveImportTarget(file: string, source: string): string | null {
  if (!source.startsWith('.')) return null;
  const resolved = normalize(resolve(dirname(file), source));
  if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) return resolved;
  return `${resolved}.ts`;
}

const CANONICAL_API_LOGGER_SUFFIX = normalize('apps/api/src/utils/logger.ts');

function isCanonicalApiLoggerImport(file: string, source: string): boolean {
  const importTarget = resolveImportTarget(file, source);
  if (importTarget && importTarget.endsWith(CANONICAL_API_LOGGER_SUFFIX)) return true;
  return /(^|\/)utils\/logger(?:\.ts)?$/.test(source);
}

// ─────────────────────────────────────────────────────────────
// CHECKS L1.1–L1.20
// ─────────────────────────────────────────────────────────────

// L1.1 — typescript-strict (runs tsc once for all workspaces)
function checkTypescriptStrict(): Violation[] {
  const workspaces = ['packages/shared', 'apps/api', 'apps/web'];
  const violations: Violation[] = [];
  for (const ws of workspaces) {
    try {
      execSync(`npx tsc --noEmit --project ${ws}/tsconfig.json`, { stdio: 'pipe' });
    } catch (err) {
      const output = (err as { stdout?: Buffer; stderr?: Buffer }).stdout?.toString() ?? '';
      const firstErr = output.split('\n').find((l) => /error TS\d+/.test(l)) ?? 'tsc failed';
      violations.push({
        check: 'L1.1 typescript-strict',
        severity: 'error',
        file: ws,
        line: 0,
        message: `tsc error: ${firstErr}`,
      });
    }
  }
  return violations;
}

// L1.2 — no-any
function checkNoAny(file: string, lines: string[]): Violation[] {
  if (!isProductionPath(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    // Strip string literals and comments to reduce false positives
    const stripped = line.replace(/\/\/.*$/, '').replace(/['"`][^'"`]*['"`]/g, '""');
    // Match ': any' or ': any[]' or ': any ' (not inside identifier)
    if (/:\s*any\b(?!\s*\/\/\s*@intentional)/.test(stripped) && !/@intentional/.test(line)) {
      violations.push({
        check: 'L1.2 no-any',
        severity: 'error',
        file,
        line: idx + 1,
        message: `Explicit ': any' type annotation without // @intentional justification`,
      });
    }
    // Match 'as any' or 'as unknown as <X>' without @intentional
    if (/\bas\s+any\b/.test(stripped) || /\bas\s+unknown\s+as\s+\w/.test(stripped)) {
      if (!/@intentional/.test(line) && idx > 0 && !/@intentional/.test(lines[idx - 1])) {
        violations.push({
          check: 'L1.2 no-any',
          severity: 'error',
          file,
          line: idx + 1,
          message: `'as any' / 'as unknown as X' cast without // @intentional annotation`,
        });
      }
    }
  });
  return violations;
}

// L1.3 — no-non-null-bang (without guard above)
function checkNoNonNullBang(file: string, lines: string[]): Violation[] {
  if (!isProductionPath(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    const stripped = line.replace(/\/\/.*$/, '').replace(/['"`][^'"`]*['"`]/g, '""');
    // Match identifier followed by ! — crude but useful
    const match = stripped.match(/(\w+)!\.(\w)/);
    if (match) {
      // Check for guard in prior 5 lines (instanceof, typeof, null check)
      const varName = match[1];
      const prior = lines.slice(Math.max(0, idx - 5), idx).join('\n');
      const hasGuard =
        new RegExp(`${varName}\\s*!==?\\s*(null|undefined)`).test(prior) ||
        new RegExp(`typeof\\s+${varName}`).test(prior) ||
        new RegExp(`${varName}\\s+instanceof\\s+`).test(prior) ||
        new RegExp(`if\\s*\\(\\s*${varName}\\s*\\)`).test(prior);
      if (!hasGuard) {
        violations.push({
          check: 'L1.3 no-non-null-bang',
          severity: 'error',
          file,
          line: idx + 1,
          message: `Non-null assertion '${varName}!' without a guard (instanceof/typeof/null-check) in preceding 5 lines`,
        });
      }
    }
  });
  return violations;
}

// L1.4 — no-ts-ignore (without justification)
function checkNoTsIgnore(file: string, lines: string[]): Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    if (/@ts-(ignore|expect-error|nocheck)/.test(line)) {
      const next = lines[idx + 1] ?? '';
      if (!/@intentional:/.test(line) && !/@intentional:/.test(next)) {
        violations.push({
          check: 'L1.4 no-ts-ignore',
          severity: 'error',
          file,
          line: idx + 1,
          message: `@ts-ignore / @ts-expect-error without '// @intentional: <reason>' comment`,
        });
      }
    }
  });
  return violations;
}

// L1.5 — no-eslint-disable-blanket
function checkNoEslintDisableBlanket(file: string, lines: string[]): Violation[] {
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    const isDirective = /^\s*\/(?:\/|\*)\s*eslint-disable(?:-next-line|-line)?\b/.test(line);
    if (!isDirective) return;
    // Must name specific rule AND have justification
    const hasRule = /eslint-disable(?:-next-line|-line)?\s+[@\w-/]+/.test(line);
    const hasJustification = /@intentional:/.test(line) || /@intentional:/.test(lines[idx + 1] ?? '') || /\*/.test(line);
    if (!hasRule || !hasJustification) {
      violations.push({
        check: 'L1.5 no-eslint-disable-blanket',
        severity: 'error',
        file,
        line: idx + 1,
        message: `eslint-disable without specific rule name or without // @intentional: <reason>`,
      });
    }
  });
  return violations;
}

// L1.6 — no-empty-catch
function checkNoEmptyCatch(file: string, lines: string[]): Violation[] {
  if (!isProductionPath(file)) return [];
  const violations: Violation[] = [];
  const source = lines.join('\n');
  // Regex: catch (arg) { <whitespace or nothing> } OR catch { }
  const emptyCatchRegex = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[^*]*\*\/\s*|\/\/[^\n]*\n\s*)*\}/g;
  let match;
  while ((match = emptyCatchRegex.exec(source)) !== null) {
    const upTo = source.slice(0, match.index);
    const line = upTo.split('\n').length;
    // Allow if preceded by @intentional: silent
    const priorLine = lines[line - 2] ?? '';
    if (/@intentional:\s*silent/.test(priorLine)) continue;
    violations.push({
      check: 'L1.6 no-empty-catch',
      severity: 'error',
      file,
      line,
      message: `Empty catch block. Route error to logger + AppError, or annotate '@intentional: silent — <reason>'`,
    });
  }
  return violations;
}

// L1.7 — no-production-todo
//
// Allowlist (BUG-180 narrow exception, 2026-04-20): Australian phone-number
// mask literals where `XXX` is a UX-convention digit placeholder, not a code
// marker. Each entry requires BOTH an exact file path AND an exact string
// literal pattern — a single wildcarded pattern across arbitrary string
// literals would weaken the guard. See docs/audit-2026-04-19/bug-catalogue-v2.yaml
// BUG-180 for the rationale.
const L1_7_ALLOWLIST: ReadonlyArray<{ file: string; pattern: RegExp }> = [
  // Australian phone-number masks (user-facing UX placeholders). Pattern is
  // the exact literal mask; narrow enough that an unrelated XXX anywhere
  // else in the file still trips the guard.
  { file: 'apps/web/src/features/patients/components/registration/Step1Demographics.tsx', pattern: /04XX XXX XXX/ },
  { file: 'apps/web/src/features/patients/components/registration/EditPatientWizard.tsx', pattern: /04XX XXX XXX/ },
  // Seeded demo PHI (fictitious phone numbers in test data + alert notes)
  { file: 'apps/api/src/seed-all-verticals.ts', pattern: /Ph 0412 XXX XXX/ },
  { file: 'apps/api/src/seed-test-data.ts', pattern: /0412 XXX XXX|0413 XXX XXX/ },
];

function isAllowlistedXxxLine(file: string, line: string): boolean {
  for (const entry of L1_7_ALLOWLIST) {
    if (file.endsWith(entry.file) && entry.pattern.test(line)) return true;
  }
  return false;
}

function checkNoProductionTodo(file: string, lines: string[]): Violation[] {
  if (!isProductionPath(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line) && !/@note:/.test(line) && !/@catalogued:/.test(line) && !/@migration-raw-exempt:/.test(line)) {
      // BUG-180: allow AU phone-number masks at catalogued exact-paths only
      if (isAllowlistedXxxLine(file, line)) return;
      violations.push({
        check: 'L1.7 no-production-todo',
        severity: 'error',
        file,
        line: idx + 1,
        message: `TODO/FIXME/HACK/XXX in production path. Promote to BUG row, convert to // @note: or // @catalogued: BUG-NNN, or delete.`,
      });
    }
  });
  return violations;
}

// L1.8 — no-console (in apps/api/src only)
function checkNoConsole(file: string, lines: string[]): Violation[] {
  if (!isApiFile(file) || isTestFile(file)) return [];
  // Bootstrap-only: allow in server.ts + config.ts + otel.ts before logger is available
  const isBootstrap = /\/(server|index|config|otel)\.ts$/.test(file);
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    if (/\bconsole\.(log|warn|error|info|debug)\b/.test(line)) {
      if (isBootstrap && /\/\/\s*bootstrap-only-console/.test(line)) return;
      violations.push({
        check: 'L1.8 no-console',
        severity: 'error',
        file,
        line: idx + 1,
        message: `console.* in apps/api/src. Use the Pino logger from apps/api/src/utils/logger.ts.`,
      });
    }
  });
  return violations;
}

// L1.9 — return-type-on-exports (basic heuristic)
function checkReturnTypeOnExports(file: string, lines: string[]): Violation[] {
  if (!isProductionPath(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    // Match: export function foo(args)  { or export const foo = (args) =>
    const fnMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*\S)?/);
    const arrowMatch = line.match(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (fnMatch && !/\)\s*:\s*\S/.test(line) && !/\)\s*:[\s\S]*?\{/.test(lines.slice(idx, idx + 3).join('\n'))) {
      violations.push({
        check: 'L1.9 return-type-on-exports',
        severity: 'warn',
        file,
        line: idx + 1,
        message: `Exported function '${fnMatch[1]}' without explicit return type annotation`,
      });
    }
    // Arrow form: manual inspection harder; warn only
    if (arrowMatch && !line.includes(':') && !lines[idx + 1]?.includes(':')) {
      // Skip — too noisy without full AST. Mark for future.
    }
  });
  return violations;
}

// L1.10 — explicit-typed-params (heuristic: no implicit any)
function checkExplicitTypedParams(file: string, lines: string[]): Violation[] {
  if (!isProductionPath(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    // function foo(bar, baz) — params without : types
    const fnDecl = line.match(/function\s+\w+\s*\(([^)]+)\)/);
    if (fnDecl) {
      const params = fnDecl[1].split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of params) {
        if (!p.includes(':') && !p.includes('=') && p !== '' && !/^\.\.\./.test(p)) {
          violations.push({
            check: 'L1.10 explicit-typed-params',
            severity: 'warn',
            file,
            line: idx + 1,
            message: `Parameter '${p}' without explicit type`,
          });
        }
      }
    }
  });
  return violations;
}

// L1.11 — pattern-error-AppError
function checkPatternErrorAppError(file: string, lines: string[]): Violation[] {
  if (!isApiFile(file) || isTestFile(file)) return [];
  // Allow: logger.ts itself, AppError definition, shared/errors.ts
  if (/shared\/errors\.ts$/.test(file) || /shared\/logger\.ts$/.test(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    if (/\bthrow\s+new\s+Error\s*\(/.test(line) && !/@intentional:/.test(line) && !/@intentional:/.test(lines[idx - 1] ?? '')) {
      violations.push({
        check: 'L1.11 pattern-error-AppError',
        severity: 'error',
        file,
        line: idx + 1,
        message: `Native 'new Error(' in apps/api/src. Use 'new AppError(...)' from packages/shared/src/errors.ts`,
      });
    }
  });
  return violations;
}

// L1.12 — pattern-validation-Zod
function checkPatternValidationZod(file: string, lines: string[]): Violation[] {
  if (!isRouteFile(file) || isTestFile(file)) return [];
  const source = lines.join('\n');
  const violations: Violation[] = [];
  // Heuristic: if req.body is accessed, a Zod .parse or .safeParse must appear on req.body above
  const bodyAccess = /req\.body/g;
  let match;
  while ((match = bodyAccess.exec(source)) !== null) {
    const upTo = source.slice(0, match.index);
    const line = upTo.split('\n').length;
    // Scan backwards: within 20 lines, a .parse/.safeParse on req.body should exist, or a Zod schema var used
    const windowStart = Math.max(0, line - 20);
    const window = lines.slice(windowStart, line).join('\n');
    const hasZod = /\.(safe)?[Pp]arse\s*\(\s*req\.body/.test(window) || /[Ss]chema\s*\.(safe)?[Pp]arse/.test(window);
    if (!hasZod) {
      violations.push({
        check: 'L1.12 pattern-validation-Zod',
        severity: 'error',
        file,
        line,
        message: `req.body accessed without Zod .parse/.safeParse above. Every route validates via co-located *.schema.ts`,
      });
    }
  }
  // De-dup line numbers
  return violations.filter((v, i, arr) => arr.findIndex((x) => x.line === v.line) === i);
}

// L1.13 — pattern-auth-AuthContext
function checkPatternAuthContext(file: string, lines: string[]): Violation[] {
  if (!isServiceFile(file) || isTestFile(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    const fnMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (!fnMatch) return;
    const [, fnName, paramList] = fnMatch;
    const firstParam = paramList.split(',')[0]?.trim() ?? '';
    // Exempt: functions that don't touch data (pure helpers) — heuristic: name starts with format/parse/build
    if (/^(format|parse|build|map|compute|is|has)/i.test(fnName)) return;
    if (!/AuthContext/.test(firstParam) && !/auth:\s*AuthContext/.test(firstParam)) {
      violations.push({
        check: 'L1.13 pattern-auth-AuthContext',
        severity: 'error',
        file,
        line: idx + 1,
        message: `Exported service function '${fnName}' — first parameter must be 'auth: AuthContext'`,
      });
    }
  });
  return violations;
}

// L1.14 — pattern-logger
export function checkPatternLogger(file: string, lines: string[]): Violation[] {
  if (!isApiFile(file) || isTestFile(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    // Forbid: import logger from non-canonical locations
    const match = line.match(/import\s+.*logger.*from\s+['"]([^'"]+)['"]/);
    if (match) {
      const source = match[1];
      const isCanonical = isCanonicalApiLoggerImport(file, source);
      if (!isCanonical) {
        violations.push({
          check: 'L1.14 pattern-logger',
          severity: 'error',
          file,
          line: idx + 1,
          message: `Logger imported from '${source}'. Must import from apps/api/src/utils/logger.ts`,
        });
      }
    }
  });
  return violations;
}

// L1.15 — db-query-hygiene
function checkDbQueryHygiene(file: string, lines: string[]): Violation[] {
  if (!isApiFile(file) || isTestFile(file)) return [];
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    // .select('*') — always bad
    if (/\.select\(\s*['"]\*['"]\s*\)/.test(line)) {
      violations.push({
        check: 'L1.15 db-query-hygiene',
        severity: 'error',
        file,
        line: idx + 1,
        message: `.select('*') prohibited. Use explicit column list.`,
      });
    }
    // .returning('*')
    if (/\.returning\(\s*['"]\*['"]\s*\)/.test(line)) {
      violations.push({
        check: 'L1.15 db-query-hygiene',
        severity: 'error',
        file,
        line: idx + 1,
        message: `.returning('*') prohibited. Use explicit returning column list.`,
      });
    }
    // Raw template literals with user input
    if (/\.raw\(\s*`[^`]*\$\{/.test(line) && !/@intentional/.test(line)) {
      violations.push({
        check: 'L1.15 db-query-hygiene',
        severity: 'error',
        file,
        line: idx + 1,
        message: `Template literal inside .raw(). Use '?' parameterisation to prevent SQL injection.`,
      });
    }
  });
  return violations;
}

// L1.16 — new-table-requirements (migrations only)
function checkNewTableRequirements(file: string, lines: string[]): Violation[] {
  if (!isMigrationFile(file)) return [];
  const source = lines.join('\n');
  const violations: Violation[] = [];
  // Match: knex.schema.createTable('name', (t) => { ... })
  const createRegex = /knex\.schema\.createTable\(\s*['"](\w+)['"]\s*,\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)/g;
  let match;
  while ((match = createRegex.exec(source)) !== null) {
    const [, tableName, body] = match;
    const upTo = source.slice(0, match.index);
    const line = upTo.split('\n').length;
    const requirements = [
      { col: 'clinic_id', regex: /\.uuid\(['"]clinic_id['"]\)/ },
      { col: 'created_at', regex: /\.timestamp\(['"]created_at['"]/ },
      { col: 'updated_at', regex: /\.timestamp\(['"]updated_at['"]/ },
      { col: 'deleted_at', regex: /\.timestamp\(['"]deleted_at['"]/ },
    ];
    for (const req of requirements) {
      if (!req.regex.test(body)) {
        violations.push({
          check: 'L1.16 new-table-requirements',
          severity: 'error',
          file,
          line,
          message: `Table '${tableName}' missing required column '${req.col}'`,
        });
      }
    }
    // RLS check: file must contain CREATE POLICY for this table OR ENABLE ROW LEVEL SECURITY
    if (!new RegExp(`ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(source) ||
        !new RegExp(`CREATE\\s+POLICY[\\s\\S]*${tableName}`, 'i').test(source)) {
      violations.push({
        check: 'L1.16 new-table-requirements',
        severity: 'error',
        file,
        line,
        message: `Table '${tableName}' missing RLS ENABLE + CREATE POLICY`,
      });
    }
  }
  return violations;
}

// L1.17 — commit-class-matches-diff
function checkCommitClassMatchesDiff(totalLinesChanged: number, touchesRisky: boolean, commitBody: string): Violation[] {
  const declaredMatch = commitBody.match(/Change-Class:\s*(trivial|standard|risky)/);
  if (!declaredMatch) {
    return [{
      check: 'L1.17 commit-class-matches-diff',
      severity: 'error',
      file: 'commit-body',
      line: 0,
      message: `Missing 'Change-Class: <trivial|standard|risky>' trailer in commit body`,
    }];
  }
  const declared = declaredMatch[1] as 'trivial' | 'standard' | 'risky';
  let verdict: 'trivial' | 'standard' | 'risky';
  if (touchesRisky || totalLinesChanged > 100) verdict = 'risky';
  else if (totalLinesChanged > 5) verdict = 'standard';
  else verdict = 'trivial';
  if (declared !== verdict) {
    return [{
      check: 'L1.17 commit-class-matches-diff',
      severity: 'error',
      file: 'commit-body',
      line: 0,
      message: `Declared Change-Class='${declared}' but diff calls for '${verdict}' (${totalLinesChanged} lines, risky-trigger=${touchesRisky})`,
    }];
  }
  return [];
}

// L1.18 — fix-registry-delta
function checkFixRegistryDelta(prBugId: string | null): Violation[] {
  if (!prBugId) return [];
  const registryCandidates = ['docs/quality/fix-registry.md', 'docs/fix-registry.md'];
  try {
    const registryPath = registryCandidates.find((candidate) => existsSync(candidate));
    if (!registryPath) {
      return [{
        check: 'L1.18 fix-registry-delta',
        severity: 'error',
        file: registryCandidates[0],
        line: 0,
        message: `Fix registry not found at ${registryCandidates.join(' or ')}`,
      }];
    }
    const registry = readFileSync(registryPath, 'utf8');
    if (!registry.includes(prBugId)) {
      return [{
        check: 'L1.18 fix-registry-delta',
        severity: 'error',
        file: registryPath,
        line: 0,
        message: `No row for ${prBugId} in ${registryPath}. Every bug fix must add an anchor.`,
      }];
    }
  } catch {
    return [{
      check: 'L1.18 fix-registry-delta',
      severity: 'error',
      file: registryCandidates[0],
      line: 0,
      message: `Unable to read fix registry from ${registryCandidates.join(' or ')}`,
    }];
  }
  return [];
}

// L1.19 — down-migration-present
function checkDownMigrationPresent(file: string, source: string): Violation[] {
  if (!isMigrationFile(file)) return [];
  const violations: Violation[] = [];
  const downMatch = source.match(/export\s+async\s+function\s+down\s*\([^)]*\)\s*:\s*Promise<void>\s*\{([\s\S]*?)\n\}/);
  const hasIrreversibleTag = /@irreversible:/.test(source);
  if (!downMatch && !hasIrreversibleTag) {
    violations.push({
      check: 'L1.19 down-migration-present',
      severity: 'error',
      file,
      line: 1,
      message: `Migration must have non-empty down() OR '# @irreversible: <reason>' comment + runbook path`,
    });
  }
  if (downMatch && !downMatch[1].trim()) {
    violations.push({
      check: 'L1.19 down-migration-present',
      severity: 'error',
      file,
      line: 1,
      message: `down() is empty. Implement reversal OR mark '# @irreversible: <reason>' + runbook path`,
    });
  }
  return violations;
}

// L1.20 — scope-diff-limited (requires PR body listing touched files)
function checkScopeDiffLimited(prBody: string, actualFiles: string[]): Violation[] {
  // Look for "Files touched:" block in PR body
  const filesMatch = prBody.match(/Files touched:\s*([\s\S]*?)(\n\n|## |$)/);
  if (!filesMatch) return [{
    check: 'L1.20 scope-diff-limited',
    severity: 'warn',
    file: 'pr-body',
    line: 0,
    message: `No 'Files touched:' block in PR body. Scope creep cannot be verified.`,
  }];
  const enumerated = filesMatch[1].split('\n').map((l) => l.trim().replace(/^[-*]\s*/, '').split(' ')[0]).filter(Boolean);
  const violations: Violation[] = [];
  for (const actual of actualFiles) {
    if (!enumerated.some((e) => actual.endsWith(e) || e.endsWith(actual))) {
      violations.push({
        check: 'L1.20 scope-diff-limited',
        severity: 'error',
        file: actual,
        line: 0,
        message: `File '${actual}' not listed in PR 'Files touched:'. Scope creep.`,
      });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────

function main(): void {
  const start = Date.now();
  const { files } = parseArgs();

  if (files.length === 0) {
    console.error(JSON.stringify({ passed: true, files_checked: 0, violations: [], commit_class_verdict: 'unknown', duration_ms: 0, note: 'No checkable files in diff' }, null, 2));
    process.exit(0);
  }

  const allViolations: Violation[] = [];

  // File-level checks
  for (const file of files) {
    let lines: string[];
    try {
      lines = readLines(file);
    } catch {
      continue;
    }
    allViolations.push(...checkNoAny(file, lines));
    allViolations.push(...checkNoNonNullBang(file, lines));
    allViolations.push(...checkNoTsIgnore(file, lines));
    allViolations.push(...checkNoEslintDisableBlanket(file, lines));
    allViolations.push(...checkNoEmptyCatch(file, lines));
    allViolations.push(...checkNoProductionTodo(file, lines));
    allViolations.push(...checkNoConsole(file, lines));
    allViolations.push(...checkReturnTypeOnExports(file, lines));
    allViolations.push(...checkExplicitTypedParams(file, lines));
    allViolations.push(...checkPatternErrorAppError(file, lines));
    allViolations.push(...checkPatternValidationZod(file, lines));
    allViolations.push(...checkPatternAuthContext(file, lines));
    allViolations.push(...checkPatternLogger(file, lines));
    allViolations.push(...checkDbQueryHygiene(file, lines));
    allViolations.push(...checkNewTableRequirements(file, lines));
    allViolations.push(...checkDownMigrationPresent(file, lines.join('\n')));
  }

  // Global checks (tsc + registry + commit-class + scope)
  allViolations.push(...checkTypescriptStrict());

  // Compute commit-class verdict heuristically
  const touchesRisky = files.some((f) =>
    /migrations\//.test(f) ||
    /features\/auth\//.test(f) ||
    /features\/llm\//.test(f) ||
    /features\/(medications|clinical-notes|scribe)\//.test(f) ||
    isServiceFile(f) ||
    isRouteFile(f)
  );
  let totalLines = 0;
  try {
    const stat = execSync('git diff --shortstat HEAD', { encoding: 'utf8' });
    const m = stat.match(/(\d+)\s+insertion/);
    totalLines = m ? parseInt(m[1], 10) : 0;
  } catch { /* ignore */ }

  // Read commit body from env (CI) or last commit (local)
  let commitBody = '';
  try {
    commitBody = process.env.COMMIT_BODY ?? execSync('git log -1 --pretty=%B', { encoding: 'utf8' });
  } catch { /* ignore */ }

  allViolations.push(...checkCommitClassMatchesDiff(totalLines, touchesRisky, commitBody));

  const bugIdMatch = commitBody.match(/BUG:\s*(BUG-[\w-]+)/);
  allViolations.push(...checkFixRegistryDelta(bugIdMatch?.[1] ?? null));

  // PR body: if available (e.g. passed via env PR_BODY), run scope-diff-limited
  if (process.env.PR_BODY) {
    allViolations.push(...checkScopeDiffLimited(process.env.PR_BODY, files));
  }

  let declaredClass: 'trivial' | 'standard' | 'risky' | 'unknown' = 'unknown';
  const clsMatch = commitBody.match(/Change-Class:\s*(trivial|standard|risky)/);
  if (clsMatch) declaredClass = clsMatch[1] as typeof declaredClass;

  const report: Report = {
    passed: allViolations.filter((v) => v.severity === 'error').length === 0,
    files_checked: files.length,
    violations: allViolations,
    commit_class_verdict: declaredClass,
    duration_ms: Date.now() - start,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
