/**
 * PR-R1-24 — CI guard: every async `setInterval(...)` / `setTimeout(...)`
 * callback body MUST be wrapped in a try/catch (CLAUDE.md §3.2).
 *
 * Why this exists — timer callbacks run OUTSIDE Express error handling
 * and outside any caller's try/catch. An unhandled throw or rejected
 * promise inside an async timer callback becomes an unhandled rejection
 * which Node's default policy turns into a process crash. The fix is
 * to wrap the entire body in try/catch and log inside catch.
 *
 * Scope: ASYNC callbacks ONLY. Synchronous timer callbacks like
 * `setTimeout(r => r, 100)` (Promise wrappers), `setInterval(() => count++, 1000)`
 * (counter ticks), or `setTimeout(() => process.exit(1), 3000)` (graceful
 * shutdown) don't need try/catch — there's no rejected-promise path.
 * The harm class is async-work-in-a-timer.
 *
 * Detection (per timer call):
 *   1. Walk apps/api/src/**\/*.ts (skip migrations, dist, tests)
 *   2. Strip comments + strings to suppress false-positives in commented
 *      examples and string literals.
 *   3. Find every `\b(?:setInterval|setTimeout)\s*\(\s*async\b` opener.
 *      Forms recognised:
 *        - `setInterval(async () => { ... })`
 *        - `setInterval(async function() { ... })`
 *        - `setInterval(async function name() { ... })`
 *        - same for setTimeout
 *   4. Walk to the callback body opening `{`, then balanced-brace match
 *      to find body close.
 *   5. Body MUST contain at least one `try\s*{` token.
 *   6. If absent → REJECT.
 *
 * Exemption: `// @timer-try-catch-exempt: <reason>` directly above the
 * timer call (REQUIRES non-empty reason). Empty reasons rejected.
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every async timer callback has try/catch
 *   1 — one or more async timer callbacks missing try/catch
 *   2 — schema-snapshot.json malformed or missing (defensive)
 */

import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import {
  loadAllowlist as loadFingerprintAllowlist,
  isAllowlisted as isAllowlistedFingerprint,
  fingerprint as fingerprintLine,
  getAllowlistedCount,
  type AllowlistEntry,
} from './lib/allowlist-fingerprint';
import {
  buildLineOffsets,
  lineNoOfIndex,
  hasInlineExemptionOnPreviousLine,
  hasUsableSchemaSnapshot,
  stripCommentsAndStringsPreservingLayout,
  walkTsFiles,
} from './lib/guardRuntime';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src');
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-timer-try-catch.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  preview: string;
}

interface ScanCounts {
  validatedTimers: number;
  skippedExempt: number;
  filesScanned: number;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@timer-try-catch-exempt:\s*\S/);
}

const TIMER_OPEN_RE = /\b(?:setInterval|setTimeout)\s*\(\s*async\b/g;
const TRY_BLOCK_RE = /\btry\s*\{/;

function stripCommentsAndStrings(source: string): string {
  return stripCommentsAndStringsPreservingLayout(source);
}

/**
 * Walk forward from openerIdx to find the callback body's opening `{`.
 * Returns the index of `{` or -1 if not found within reasonable scan.
 *
 * State-machine walker (PR-R1-24 cycle-2 fix per L3 finding 2026-05-01):
 * the cycle-1 heuristic missed `setInterval(async function name(): Promise<void> {})`
 * because the body `{` is preceded by a TS return-type annotation
 * (`: Promise<void>`), not directly by `)` of the param list. The new
 * walker structurally parses:
 *   1. `async` keyword
 *   2. Optional `function` keyword + optional name (function-form)
 *   3. Param list: `(...)` balanced OR single-name (arrow sugar)
 *   4. Optional `: ReturnType` annotation (skipped via depth-tracked walk
 *      through `()`, `[]`, `<>`, `{}` so `Promise<{r:number}>` doesn't
 *      false-match its inner `{` as the body)
 *   5. `=>` (arrow form) then `{`
 *      OR direct `{` (function form)
 *
 * Comments and strings already stripped by stripCommentsAndStrings()
 * before this is called.
 */
function findCallbackBodyStart(source: string, openerIdx: number): number {
  const limit = Math.min(source.length, openerIdx + 800);
  // Find the `async` keyword start (after `setInterval(\s*` or `setTimeout(\s*`).
  // The opener regex already required `\basync\b` follows; we just need the
  // index past `async`.
  const asyncIdx = source.indexOf('async', openerIdx);
  if (asyncIdx < 0 || asyncIdx >= limit) return -1;
  let i = asyncIdx + 5;

  // Skip whitespace then detect form.
  while (i < limit && /\s/.test(source[i])) i++;

  // Optional `function` keyword + optional name (function-form).
  let isArrowForm = true;
  if (source.substring(i, i + 8) === 'function' && /\W/.test(source[i + 8] || ' ')) {
    isArrowForm = false;
    i += 8;
    while (i < limit && /\s/.test(source[i])) i++;
    // Optional function name.
    while (i < limit && /[A-Za-z0-9_$]/.test(source[i])) i++;
    while (i < limit && /\s/.test(source[i])) i++;
  }

  // Param list. Function form is always `(...)`. Arrow form is `(...)` OR
  // single-identifier sugar (`async x => ...`).
  if (source[i] === '(') {
    let depth = 1;
    i++;
    while (i < limit && depth > 0) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    if (depth !== 0) return -1;
  } else if (isArrowForm && /[A-Za-z_$]/.test(source[i])) {
    // single-param arrow: `async x => ...`
    while (i < limit && /[A-Za-z0-9_$]/.test(source[i])) i++;
  } else {
    return -1;
  }

  while (i < limit && /\s/.test(source[i])) i++;

  // Optional `: ReturnType` annotation. Walk past it tracking ALL depth
  // counters so `Promise<{r:number}>` doesn't false-match its internal `{`.
  if (source[i] === ':') {
    i++;
    let parenDepth = 0, braceDepth = 0, bracketDepth = 0, angleDepth = 0;
    while (i < limit) {
      const c = source[i];
      const c2 = source[i + 1];
      // Body-marker exit conditions: top-level `=>` (arrow) or top-level `{` (function).
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && angleDepth === 0) {
        if (c === '=' && c2 === '>') { i += 2; break; }
        if (c === '{') break;
      }
      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      else if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth--;
      else if (c === '<') angleDepth++;
      else if (c === '>') angleDepth--;
      else if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      i++;
    }
    while (i < limit && /\s/.test(source[i])) i++;
  } else if (isArrowForm) {
    // Arrow without return type — must have `=>`.
    if (source[i] === '=' && source[i + 1] === '>') {
      i += 2;
      while (i < limit && /\s/.test(source[i])) i++;
    } else {
      return -1;
    }
  }

  // Body opener.
  if (i < limit && source[i] === '{') return i;
  return -1;
}

/**
 * Walk balanced braces from bodyStart (pointing at `{`) to find the
 * matching close. Returns the body content as a string.
 */
function extractBalancedBody(source: string, bodyStart: number): string | null {
  if (source[bodyStart] !== '{') return null;
  let depth = 1;
  let i = bodyStart + 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return source.slice(bodyStart + 1, i - 1);
}

// ── file scanner ───────────────────────────────────────────────────────

function checkFile(
  file: string,
  rawSource: string,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const source = stripCommentsAndStrings(rawSource);
  const lineOffsets = buildLineOffsets(source);
  const lines = rawSource.split('\n');

  const re = new RegExp(TIMER_OPEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  let foundAny = false;
  while ((m = re.exec(source)) !== null) {
    foundAny = true;
    const lineNo = lineNoOfIndex(lineOffsets, m.index);
    if (hasInlineExemption(rawSource, lineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    const bodyStart = findCallbackBodyStart(source, m.index);
    if (bodyStart < 0) continue; // single-expression body — out of scope
    const body = extractBalancedBody(source, bodyStart);
    if (body === null) continue; // malformed source

    if (TRY_BLOCK_RE.test(body)) {
      counts.validatedTimers++;
      continue;
    }

    const fullLine = lines[lineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);

    if (isAllowlistedFingerprint(relFile, lineNo, fullLine, allow)) {
      const fp = fingerprintLine(fullLine);
      if (fp) {
        const key = `${relFile}|${fp}`;
        violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
        const allowed = getAllowlistedCount(relFile, fp, allow);
        if ((violationBuckets.get(key) || 0) > allowed) {
          violations.push({ file: relFile, lineNo, preview });
        }
      }
      continue;
    }

    violations.push({ file: relFile, lineNo, preview });
  }
  if (foundAny) counts.filesScanned++;
  return violations;
}

// ── runner (exported for tests) ────────────────────────────────────────

export interface RunGuardOpts {
  snapshotPath?: string;
  scanRoot?: string;
  allowlistPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1 | 2;
  violations: Violation[];
  counts: ScanCounts;
  filesScanned: number;
  allowlistEntries: number;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const scanRoot = opts.scanRoot ?? DEFAULT_SCAN_ROOT;
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  if (!hasUsableSchemaSnapshot(snapshotPath)) {
    return {
      exitCode: 2, violations: [],
      counts: { validatedTimers: 0, skippedExempt: 0, filesScanned: 0 },
      filesScanned: 0, allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = walkTsFiles(scanRoot, [], {
    excludeDirs: ['node_modules', 'dist', '__tests__', 'tests', 'build', 'migrations'],
  });
  const counts: ScanCounts = { validatedTimers: 0, skippedExempt: 0, filesScanned: 0 };
  const violationBuckets = new Map<string, number>();
  const allViolations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const v = checkFile(file, source, allow, counts, violationBuckets);
    allViolations.push(...v);
  }

  return {
    exitCode: allViolations.length > 0 ? 1 : 0,
    violations: allViolations,
    counts,
    filesScanned: counts.filesScanned,
    allowlistEntries: allow.length,
  };
}

// ── CLI entry ──────────────────────────────────────────────────────────

function main(): void {
  const result = runGuard();
  // eslint-disable-next-line no-console
  console.log('→ check-timer-try-catch (PR-R1-24; CLAUDE.md §3.2)');
  // eslint-disable-next-line no-console
  console.log(`  scan root:           ${relative(ROOT, DEFAULT_SCAN_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:           ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  files with timers:   ${result.counts.filesScanned}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated timers:    ${result.counts.validatedTimers}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:      ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every async timer callback wraps its body in try/catch.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} async timer callback(s) missing try/catch:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: wrap the entire callback body in try/catch — `setInterval(async () => { try { /* work */ } catch (err) { logger.error({ err }, \'timer failed\'); } }, ms)`. Without it, an unhandled rejection inside an async timer crashes the process. Exemption: `// @timer-try-catch-exempt: <reason>` directly above the timer call (REQUIRES non-empty reason).',
  );
  process.exit(1);
}

if (require.main === module) main();
