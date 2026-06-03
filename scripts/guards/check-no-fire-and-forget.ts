#!/usr/bin/env tsx
/*
 * scripts/guards/check-no-fire-and-forget.ts
 *
 * CLAUDE.md §9.6 — fire-and-forget async calls must carry a
 * `.catch` and `setInterval` callbacks must wrap their body in
 * try/catch.
 *
 * The audit on 2026-04-16 found four real bugs in this class:
 *
 *   M1  fhirRoutes.ts:500 — `setImmediate(() => void
 *       processBulkExportJob(job.id))` silently swallowed
 *       synchronous-setup throws.
 *   M2  scribeStreaming.ts:63 — `setInterval(async () => { ... })`
 *       outer body was not in a try/catch, so any iteration throw
 *       killed the interval silently.
 *   L2  authController.ts:78/142/155 + patientAppRoutes.ts:263 —
 *       three `void primeIdleWindow(...)` / `void clearIdleWindow`
 *       swallowed Redis failures.
 *
 * All four would have been caught at commit time by
 * `@typescript-eslint/no-floating-promises`, which is not wired
 * into this repo because ESLint isn't installed. Rather than do a
 * full ESLint install as part of this guard (substantial
 * infrastructure change), this script is a focused regex guard
 * that catches the exact two shapes the audit found.
 *
 * Rule 1: No `void asyncCall(...)` in production code outside
 *         the allowlist. Whatever exception pattern a specific
 *         call site needs must chain `.catch(...)` to log the
 *         failure; test fixtures and deliberate fire-and-forgets
 *         (logout idle window updates etc.) go in the allowlist.
 *
 * Rule 2: Every `setInterval(async () => { ... })` callback body
 *         must start with `try` or contain the word `try` before
 *         the first awaited call. An interval body that throws
 *         and isn't caught silently dies and cleanup stops.
 *
 * Deliberately simpler than ESLint — matches the existing guard
 * style (bash/regex-based like check-no-telecom, etc). The
 * trade-off: ESLint catches more exotic patterns (async arrow
 * passed as a callback where a sync function was expected, etc.)
 * but those are the ~5% edge cases. The two shapes the audit
 * actually found cover the ~95% common cases.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_SRC = path.join(REPO_ROOT, 'apps', 'api', 'src');
const ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  '.github',
  'scripts',
  'fire-and-forget.allowlist',
);

interface Violation {
  readonly rule: 'void-async' | 'setInterval-no-try';
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
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
        if (
          e.name === 'node_modules' ||
          e.name === 'dist' ||
          e.name === 'migrations' ||
          e.name === 'seed-good-health' // deterministic seed, no prod async
        )
          continue;
        await rec(full);
      } else if (e.isFile() && ext.test(e.name)) {
        out.push(full);
      }
    }
  }
  await rec(dir);
  return out;
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

// ── Rule 1: no bare `void asyncCall(...)` ───────────────────────
//
// Match any `void <identifier>(...)` where the void is acting as a
// discard operator, i.e. it's a statement (preceded by nothing on
// the line, or by whitespace and a statement separator like `;`/`{`).
//
// Exclude:
//   - `void 0` (idiomatic undefined literal)
//   - `void abc` on its own with no paren (type-level, not a call)
//   - `void q.andWhere(...)` where the target has a dot chain — this
//     is the Knex builder idiom used to silence return-value lint
//     (see clinicalReviewRepository.ts:363)
//   - Inside .test.ts files
//   - Inside comment lines
function findVoidAsyncCalls(
  file: string,
  src: string,
  allowlist: Set<string>,
): Violation[] {
  const out: Violation[] = [];
  if (file.endsWith('.test.ts') || file.includes('/__tests__/')) return out;

  // Match `void <identifier>(` where there's no `.` between void
  // and the identifier — the Knex `void q.andWhere(...)` idiom has
  // a dot chain which we intentionally allow.
  const pattern =
    /(?:^|[^.\w])void\s+([A-Za-z_$][\w$]*)\s*\(/g;

  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    // Skip type annotations: `void x(`: if this is inside a type
    // position (`: void` ...) skip.
    if (trimmed.includes(': void')) {
      // still scan — a type annotation doesn't preclude a later
      // void-call on the same line, so only skip the substring
    }

    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) {
      const callee = m[1];
      // Allow trivial literals that parse as void-of-literal (not
      // a function call): void 0, void undefined, etc.
      if (callee === '0' || callee === 'undefined') continue;

      const relPath = path.relative(REPO_ROOT, file);
      const allowKey = `${relPath}:${i + 1}:${callee}`;
      const allowKeyAnyLine = `${relPath}:${callee}`;
      if (allowlist.has(allowKey) || allowlist.has(allowKeyAnyLine)) continue;

      out.push({
        rule: 'void-async',
        file: relPath,
        line: i + 1,
        snippet: line.trim(),
      });
    }
  }
  return out;
}

// ── Rule 2: setInterval(async () => { ... }) must contain `try` ──
//
// Parse each setInterval call and confirm the callback body has a
// `try` keyword somewhere before the first awaited call. This is
// a structural check, not a full AST analysis — false positives
// go in the allowlist, false negatives are rare because the
// pattern is narrow.
function findUncaughtIntervals(
  file: string,
  src: string,
  allowlist: Set<string>,
): Violation[] {
  const out: Violation[] = [];
  if (file.endsWith('.test.ts') || file.includes('/__tests__/')) return out;

  // Match `setInterval(async` or `setInterval(async (` and then
  // capture until the matching closing brace. Simple but
  // whitespace-tolerant.
  const re = /setInterval\s*\(\s*async\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Find the opening brace of the arrow function body after the
    // match. We scan forward for `{` that isn't inside parens.
    let idx = m.index + m[0].length;
    let depth = 0;
    let bodyStart = -1;
    while (idx < src.length) {
      const ch = src[idx];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === '{' && depth <= 0) {
        bodyStart = idx + 1;
        break;
      }
      idx++;
    }
    if (bodyStart === -1) continue;

    // Find the matching close brace.
    let braceDepth = 1;
    let j = bodyStart;
    while (j < src.length && braceDepth > 0) {
      const ch = src[j];
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      j++;
    }
    const body = src.slice(bodyStart, Math.max(bodyStart, j - 1));
    // Does the body contain `try` BEFORE any awaited call? If the
    // first await is inside a try block, good. If the body starts
    // with statements outside a try, not good.
    //
    // Cheap proxy: if the body contains the word `try` at all, it
    // passes. This is loose — a dev could put the try in the wrong
    // place — but it catches the audit M2 case (no try at all)
    // which is the common mistake.
    if (!/\btry\s*\{/.test(body)) {
      const line = src.slice(0, m.index).split('\n').length;
      const relPath = path.relative(REPO_ROOT, file);
      const allowKey = `${relPath}:${line}:setInterval`;
      if (allowlist.has(allowKey)) continue;
      out.push({
        rule: 'setInterval-no-try',
        file: relPath,
        line,
        snippet: src.slice(m.index, Math.min(m.index + 80, src.length)).split('\n')[0],
      });
    }
  }
  return out;
}

async function main(): Promise<number> {
  console.log('→ check-no-fire-and-forget');
  const files = await walk(API_SRC, /\.(ts)$/);
  const allowlist = await loadAllowlist();

  const violations: Violation[] = [];
  for (const file of files) {
    let src: string;
    try {
      src = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    violations.push(...findVoidAsyncCalls(file, src, allowlist));
    violations.push(...findUncaughtIntervals(file, src, allowlist));
  }

  console.log(
    `  files scanned:   ${files.length}`,
  );
  console.log(`  allowlist:       ${allowlist.size} entries`);

  if (violations.length > 0) {
    console.error('');
    console.error(
      `✗ FAIL: ${violations.length} fire-and-forget violation(s) in apps/api/src.`,
    );
    console.error('');
    for (const v of violations) {
      console.error(`  ✗ [${v.rule}] ${v.file}:${v.line}: ${v.snippet}`);
    }
    console.error('');
    console.error('Fix one of:');
    console.error(
      '  1. Chain `.catch(err => logger.warn({ err, ... }, "op failed"))`',
    );
    console.error('     so failures log at WARN without blocking the caller.');
    console.error('  2. Use `await` so the error flows through the handler.');
    console.error(
      '  3. For a `setInterval(async () => {...})`, wrap the whole body',
    );
    console.error('     in a try/catch that logs at ERROR and keeps the interval alive.');
    console.error(
      `  4. If the call is deliberately fire-and-forget AND cannot reasonably`,
    );
    console.error(
      `     chain .catch, allowlist it in ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`,
    );
    console.error(
      '     with a rationale comment. Form is "path/to/file.ts:LINE:calleeName".',
    );
    console.error('');
    console.error('See CLAUDE.md §9.6 for the rationale.');
    return 1;
  }

  console.log('✓ No fire-and-forget async calls or uncaught setInterval bodies.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`check-no-fire-and-forget: unhandled error\n${msg}`);
    process.exit(2);
  });
