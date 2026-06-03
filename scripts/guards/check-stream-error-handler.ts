/**
 * PR-R1-23 — CI guard: every `fs.createReadStream(...)` /
 * `fs.createWriteStream(...)` call MUST attach an `.on('error', ...)`
 * handler within a small forward-looking window (CLAUDE.md §3.3).
 *
 * Why this exists — Node.js readable/writable streams emit errors as
 * EVENTS, not throws. Without an `.on('error', handler)`, a stream
 * read/write failure (file missing, FS permission, ENOSPC during a
 * backup write, etc.) propagates as an UNHANDLED 'error' event which
 * crashes the entire process via Node's default unhandled-event policy.
 *
 * The 6 known stream call sites in apps/api/src/ all already attach
 * `.on('error', ...)` immediately after the create call (verified by
 * baseline scan). This guard is preventive: it locks in the discipline
 * so a future contributor can't add a stream without an error handler.
 *
 * Detection (per stream call):
 *   1. Walk apps/api/src/**\/*.ts files (skip tests, seed scripts,
 *      type-only declaration files).
 *   2. Find every `\bcreate(Read|Write)Stream\s*\(` opener (matches
 *      `fs.createReadStream(...)`, bare `createReadStream(...)` after
 *      named import, and aliased `r.createReadStream(...)`).
 *   3. Capture the variable the stream is assigned to: `const X = ...`,
 *      `let X = ...`, or assignment without `const/let` (rare).
 *      If no assignment, we still need an `.on('error')` on the
 *      expression directly — match `.on('error')` within the window.
 *   4. Walk forward up to STREAM_WINDOW chars looking for either:
 *      - `<varName>.on\s*\(\s*['"\`]error['"\`]` (typical)
 *      - inline `.on('error', ...)` chained on the create-call return
 *   5. If no handler found AND no `// @stream-error-exempt: <reason>`
 *      annotation immediately above the create call → REJECT.
 *
 * Exemption:
 *   - `// @stream-error-exempt: <reason>` directly above the create
 *     call (REQUIRES non-empty reason). Use sparingly; legitimate cases
 *     are rare (e.g., short-lived stream piped immediately to a stream
 *     that owns error handling — but even then attach for defense in
 *     depth).
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every stream has an error handler attached
 *   1 — one or more streams missing handler
 *   2 — schema-snapshot.json malformed or missing (defensive — keeps
 *       guard family consistent even though this guard doesn't read schema)
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
  stripCommentsPreservingLayout,
  walkTsFiles,
} from './lib/guardRuntime';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src');
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-stream-error-handler.allowlist');

/**
 * Forward-look window for variable-bound `.on('error', ...)` detection.
 *
 * Sized at 2500 chars based on the worst-case real-world separation in
 * apps/api/src/ at guard-landing time:
 *   - apps/api/src/features/backup/backupRoutes.ts:254-282 — `fileStream`
 *     created at line 254, error handler attached at line 282 (28 lines,
 *     ~1500 chars including stderr capture + spawn-event wiring + the
 *     fail() helper definition). 2500 leaves comfortable margin for
 *     similarly-shaped patterns.
 *   - All 5 other stream sites attach handlers within 200 chars.
 *
 * Risk: a same-block handler attached >2500 chars after the create-call
 * (e.g., a fat function body with the handler at the bottom) would be
 * a FALSE-POSITIVE. Mitigation:
 *   (a) the variable-rebinding truncation (rebindRe, hasVariableErrorHandler)
 *       caps the effective window naturally;
 *   (b) inline `@stream-error-exempt: <reason>` opt-out with a documented
 *       reason for any genuine far-attachment case;
 *   (c) factory functions / closure-captured streams should chain the
 *       handler at the create-call (the canonical pattern is `fs.createReadStream(p).on('error', ...)`).
 *
 * If a future contributor hits a legitimate >2500-char gap, prefer the
 * chained-handler refactor over bumping this constant — looser windows
 * increase scope-bleed false-negatives.
 */
const STREAM_WINDOW = 2500;

export interface Violation {
  file: string;
  lineNo: number;
  preview: string;
  reason: 'no-error-handler';
}

interface ScanCounts {
  validatedStreams: number;
  skippedExempt: number;
  filesScanned: number;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@stream-error-exempt:\s*\S/);
}

const STREAM_OPEN_RE = /\bcreate(?:Read|Write)Stream\s*\(/g;

/**
 * Extract the variable name the stream is assigned to (LHS of the create
 * call). Walks backward from the opener to find the nearest assignment
 * `=` token (excluding `==`, `===`, `>=`, `<=`, `!=`, `=>`), then captures
 * the identifier directly before it. If a `:` precedes the `=` (type
 * annotation form `const s: fs.ReadStream = ...`), keeps walking back
 * past the type-annotation tokens to find the actual variable identifier.
 * Returns null if no assignment is found within the lookback window
 * (typical case: stream returned from a function or used as a function arg).
 */
function findAssignedVariable(source: string, openerIdx: number): string | null {
  const lookback = Math.min(300, openerIdx);
  let i = openerIdx - 1;
  // Skip whitespace immediately before the opener.
  while (i >= openerIdx - lookback && /\s/.test(source[i])) i--;
  while (i >= openerIdx - lookback) {
    const c = source[i];
    if (c === '=') {
      // Reject `==`, `===`, `>=`, `<=`, `!=` — the char BEFORE this `=`.
      const prev = i > 0 ? source[i - 1] : '';
      // Reject `=>` — the char AFTER this `=`.
      const next = i + 1 < source.length ? source[i + 1] : '';
      if (prev === '=' || prev === '<' || prev === '>' || prev === '!' || next === '=' || next === '>') {
        i--;
        continue;
      }
      // Found a true assignment `=`. Capture the identifier just before it.
      let j = i - 1;
      while (j >= 0 && /\s/.test(source[j])) j--;
      // Type-annotation form: `const s: fs.ReadStream = ...`. The token
      // immediately before `=` is the LAST token of the type, NOT the
      // variable. Walk back past the type tokens until we hit a `:` —
      // then walk further back past whitespace, then capture the identifier.
      // The boundary that ends the type-annotation walk-back: `:` (start
      // of annotation), `,` / `(` / `{` / `[` (param/destructure), or
      // a const/let/var keyword. Type tokens contain identifiers, dots,
      // generic angle brackets, pipes (`A | B`), spaces.
      let idEnd = j + 1;
      let idStart: number;
      // Walk back through type-annotation chars first. Newlines included
      // so multi-line type annotations (`const s:\n  fs.ReadStream\n  =`)
      // walk back to the `:` correctly. The `:` itself is the boundary.
      while (j >= 0 && /[[A-Za-z0-9_$.<>|& \t\r\n,\]]/.test(source[j])) j--;
      if (j >= 0 && source[j] === ':') {
        // Type-annotation present; walk past ':' and any whitespace to
        // capture the variable identifier.
        j--;
        while (j >= 0 && /\s/.test(source[j])) j--;
        idEnd = j + 1;
        while (j >= 0 && /[A-Za-z0-9_$]/.test(source[j])) j--;
        idStart = j + 1;
      } else {
        // No type annotation. The identifier is whatever non-id chars we
        // skipped past. Reset to find it directly.
        j = i - 1;
        while (j >= 0 && /\s/.test(source[j])) j--;
        idEnd = j + 1;
        while (j >= 0 && /[A-Za-z0-9_$]/.test(source[j])) j--;
        idStart = j + 1;
      }
      if (idEnd > idStart) {
        const id = source.slice(idStart, idEnd);
        // Reject keywords that look like identifiers.
        if (id !== 'return' && id !== 'yield' && id !== 'await' && id !== 'throw') return id;
      }
      return null;
    }
    // Stop at statement boundaries — semicolons or newline-after-non-continuation.
    if (c === ';') return null;
    i--;
  }
  return null;
}

/**
 * Check if the variable has an `.on('error', ...)` attached within the
 * forward window starting at startIdx. The window is truncated at the
 * point where the SAME variable is rebound to another stream — without
 * truncation, two streams sharing a name within 2500 chars (e.g.
 * `let s = ...; ... s = fs.createReadStream(p2); s.on('error', ...);`)
 * would silently validate the FIRST stream against the SECOND's handler.
 */
function hasVariableErrorHandler(source: string, startIdx: number, varName: string): boolean {
  let windowEnd = Math.min(source.length, startIdx + STREAM_WINDOW);
  // Truncate window at next `<varName> = ...` rebinding before reaching
  // the search limit. Step past the create-call's own assignment-`=`.
  const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rebindRe = new RegExp(`\\b${escapedVar}\\s*=\\s*(?!=)`, 'g');
  // Move past the first match (the original assignment that created this
  // stream) — the backward-walk found us this varName, so `<varName> =`
  // appears just before startIdx, but the regex starts from startIdx so
  // it would match the NEXT rebinding, which is what we want.
  rebindRe.lastIndex = startIdx;
  const m = rebindRe.exec(source);
  if (m && m.index < windowEnd) {
    windowEnd = m.index;
  }
  const window = source.slice(startIdx, windowEnd);
  const re = new RegExp(`\\b${escapedVar}\\.on\\s*\\(\\s*['"\`]error['"\`]`);
  return re.test(window);
}

function stripComments(source: string): string {
  return stripCommentsPreservingLayout(source);
}

/**
 * Check if the create-call return is chained directly with `.on('error', ...)`
 * (e.g., `fs.createReadStream(p).on('error', handler)`). Looks within a small
 * forward window from the closing paren of the create call.
 */
function hasChainedErrorHandler(source: string, openerIdx: number): boolean {
  // Find the matching close paren of the create-call.
  let i = openerIdx;
  // Advance to the opening paren.
  while (i < source.length && source[i] !== '(') i++;
  if (i >= source.length) return false;
  let depth = 1;
  i++;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  if (depth !== 0) return false;
  // i points just past the closing paren. Look for `.on('error'` within the
  // next 200 chars (chained handler).
  const window = source.slice(i, i + 200);
  return /^\s*\.on\s*\(\s*['"`]error['"`]/.test(window);
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
  // Strip comments BEFORE the opener scan so commented-out
  // `// fs.createReadStream(p)` examples don't surface as violations.
  // Position-preserving — line numbers stay accurate.
  const source = stripComments(rawSource);
  const lineOffsets = buildLineOffsets(source);
  const lines = rawSource.split('\n');

  const re = new RegExp(STREAM_OPEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  let foundAny = false;
  while ((m = re.exec(source)) !== null) {
    foundAny = true;
    const lineNo = lineNoOfIndex(lineOffsets, m.index);
    // hasInlineExemption reads the ORIGINAL source — exemption comments
    // are on a `//` line which stripComments turned into whitespace.
    if (hasInlineExemption(rawSource, lineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    // Detection: chained-handler OR variable-handler. Both run against
    // the comment-stripped source so commented-out handler calls don't
    // false-pass.
    if (hasChainedErrorHandler(source, m.index)) {
      counts.validatedStreams++;
      continue;
    }
    const varName = findAssignedVariable(source, m.index);
    if (varName && hasVariableErrorHandler(source, m.index, varName)) {
      counts.validatedStreams++;
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
          violations.push({ file: relFile, lineNo, preview, reason: 'no-error-handler' });
        }
      }
      continue;
    }

    violations.push({ file: relFile, lineNo, preview, reason: 'no-error-handler' });
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
      exitCode: 2,
      violations: [],
      counts: { validatedStreams: 0, skippedExempt: 0, filesScanned: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = walkTsFiles(scanRoot, [], {
    excludeDirs: ['node_modules', 'dist', '__tests__', 'tests', 'build', 'migrations'],
  });
  const counts: ScanCounts = {
    validatedStreams: 0,
    skippedExempt: 0,
    filesScanned: 0,
  };
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
  console.log('→ check-stream-error-handler (PR-R1-23; CLAUDE.md §3.3)');
  // eslint-disable-next-line no-console
  console.log(`  scan root:           ${relative(ROOT, DEFAULT_SCAN_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:           ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  files with streams:  ${result.counts.filesScanned}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated streams:   ${result.counts.validatedStreams}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:      ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every stream has an error handler attached.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} stream(s) missing error handler:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: attach `.on(\'error\', (err) => logger.error({ err, ... }, \'stream failed\'))` immediately after the create call. For chained: `fs.createReadStream(path).on(\'error\', handler)`. For assigned: `const s = fs.createReadStream(path); s.on(\'error\', handler);`. Exemption: `// @stream-error-exempt: <reason>` directly above the create call (REQUIRES non-empty reason).',
  );
  process.exit(1);
}

if (require.main === module) main();
