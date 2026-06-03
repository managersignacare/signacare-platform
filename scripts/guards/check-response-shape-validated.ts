/**
 * BUG-638 — CI guard: every `res.json(<expr>)` call MUST either pass through
 * a Zod-validated mapper (`mapXxxRowToResponse(...)` / `XxxSchema.parse(...)`)
 * or be a status/literal response (object literal with only primitive fields).
 *
 * Cycle-2 absorb-1 corrections (per L3 cycle-1 REJECT findings):
 *   - FN-nested-parens (HIGH): cycle-1 outer regex `[^()]*` silently skipped
 *     192 res.json() calls including the canonical pattern itself
 *     (`res.json(mapXxxRowToResponse(row))` has nested parens). Cycle-2
 *     uses a bracket-balanced scanner to extract the full call argument.
 *   - FN-kv-identifier (HIGH): cycle-1 approved `res.json({ data: rows })`
 *     because the kv-form's `\w+` permissive branch accepted any identifier.
 *     This was the EXACT BUG-623 leak class. Cycle-2 tightens: `data:` and
 *     `items:` keys MUST receive a canonical mapper / Zod-parse value;
 *     a bare identifier is REJECTED.
 *   - DOC-DRIFT-1: cycle-1 JSDoc claimed a `next(err)` skip feature that
 *     didn't exist in implementation. Removed.
 *   - DOC-DRIFT-2: cycle-1 inline comment "tracked separately" contradicted
 *     the JSDoc disclosure of multi-line skip. Aligned.
 *
 * Why this exists — CLAUDE.md §5.2 mandates canonical snake→camel mapper at
 * every response boundary. ~129 sites use the canonical pattern; ~600+ do
 * not. Without this guard, future `res.json(rawRow)` patterns silently leak
 * snake_case DB rows — same architectural class as BUG-613 / BUG-618 /
 * BUG-622 / BUG-623 / BUG-632.
 *
 * Pattern detection:
 *   APPROVED if `res.json(<expr>)` where <expr>:
 *     1. Contains a `*ToResponse(` mapper call (BUG-613/618/622 canonical)
 *     2. Contains a `<Schema>.parse(` Zod parse (explicit validation)
 *     3. Is a literal object with only primitive fields and known safe keys
 *        (ok, active, count, id, status, message, error, success, etc.) —
 *        with `data:` and `items:` REQUIRED to receive a mapper call value
 *     4. Is an empty array `[]` or empty object `{}`
 *     5. Is a string/number/boolean/null literal
 *     6. Has inline `// @response-shape-exempt: <reason>` comment
 *
 *   REJECTED otherwise — particularly:
 *     - `res.json(row)` / `res.json(rows)` / `res.json(result)` — likely
 *       raw DB rows leaking
 *     - `res.json({ data: rows })` / `res.json({ items: medications })` —
 *       BUG-623 wrapper-shape leak class (cycle-2 explicitly catches)
 *
 * Allowlist mechanism: `<file>:<line>` entries in
 * `check-response-shape-validated.allowlist`, paired with cascade BUG ID.
 *
 * Coverage gaps (filed as follow-up BUGs):
 *   - Multi-line `res.json({\n   ...\n})` blocks — heuristic skip; the
 *     bracket-balanced scanner extracts arg even if multi-line, BUT the
 *     `isLiteralObjectWithSafeKeys` parser is single-line. Tracked as
 *     BUG-638-FOLLOWUP-MULTI-LINE.
 *   - `res.send()` — not covered (different method).
 *   - `*ToResponse` naming canonicalisation gap — codebase has both
 *     `*ToResponse` and `map*Response` shapes. Tracked as
 *     BUG-638-FOLLOWUP-MAPPER-NAMING-SSOT.
 *
 * Exit codes:
 *   0 — every res.json() call validated or allowlisted
 *   1 — one or more raw-row leak suspects detected
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { loadAllowlist as loadFingerprintAllowlist, isAllowlisted as isAllowlistedFingerprint, fingerprint as fingerprintLine, getAllowlistedCount, type AllowlistEntry } from './lib/allowlist-fingerprint';

const ROOT = resolve(__dirname, '..', '..');
const SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src');
const ALLOWLIST_PATH = resolve(__dirname, 'check-response-shape-validated.allowlist');

const SAFE_LITERAL_KEYS = new Set([
  'ok', 'active', 'count', 'id', 'status', 'message', 'error', 'success',
  'received', 'queued', 'cleared', 'archived', 'restored', 'cancelled',
  'data', 'items', // value MUST be canonical mapper / Zod parse — enforced below
  'total', 'page', 'limit', 'offset',
  'createdAt', 'updatedAt', 'deletedAt',
  'token', 'redirectUrl', 'url', 'href',
  'note', 'reason', 'detail', 'code',
]);

// Keys whose value MUST be a canonical mapper / Zod parse — bare identifiers
// REJECTED. These are the wrapper-shape leak class (BUG-623 root pattern).
const VALUE_MUST_BE_CANONICAL = new Set(['data', 'items']);

interface Violation {
  file: string;
  lineNo: number;
  preview: string;
  reason: string;
}

function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      walkTs(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Phase R1 PR-R1-1.5 — line-shift-resilient allowlist via fingerprint helper.
function loadAllowlist(): AllowlistEntry[] {
  return loadFingerprintAllowlist(ALLOWLIST_PATH);
}

function isCanonicalCall(call: string): boolean {
  // Mapper convention: `*ToResponse(` (BUG-613/618/622 canonical) or
  // `map*Response(` (alternate naming used in clinical-notes feature).
  if (/\b\w+ToResponse\s*\(/.test(call)) return true;
  if (/\bmap\w+Response\s*\(/.test(call)) return true;
  // Zod parse: `*Schema.parse(`
  if (/\b\w+Schema\s*\.\s*parse\s*\(/.test(call)) return true;
  // Inline `.map(mapXxxToResponse)` (without parens — passing a function)
  if (/\.map\s*\(\s*\w+ToResponse\s*\)/.test(call)) return true;
  if (/\.map\s*\(\s*map\w+Response\s*\)/.test(call)) return true;
  return false;
}

// Cycle-2 FN-nested-parens absorb: bracket-balanced scanner. Walks the
// source from the `(` after `.json` and tracks paren depth (also escapes
// inside string / template literals). Returns the full argument substring.
function extractJsonArg(source: string, openParenIdx: number): { arg: string; endIdx: number } | null {
  let depth = 1;
  let i = openParenIdx + 1;
  let inString: '"' | "'" | '`' | null = null;
  let escape = false;
  while (i < source.length) {
    const c = source[i];
    if (escape) { escape = false; i++; continue; }
    if (c === '\\') { escape = true; i++; continue; }
    if (inString) {
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; i++; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      if (c === ')' && depth === 1) {
        return { arg: source.slice(openParenIdx + 1, i), endIdx: i };
      }
      depth--;
    }
    i++;
  }
  return null; // unterminated — bail
}

function isLiteralObjectWithSafeKeys(arg: string): boolean {
  arg = arg.trim();
  // Empty array / object — safe.
  if (arg === '[]' || arg === '{}') return true;
  // String literal — safe.
  if (/^['"`][^'"`]*['"`]$/.test(arg)) return true;
  // Number / boolean / null — safe.
  if (/^(\d+(\.\d+)?|true|false|null|undefined)$/.test(arg)) return true;
  // Object literal — must START with `{` and END with `}`. Multi-line OK
  // because the bracket-balanced scanner gave us the full arg.
  if (!arg.startsWith('{') || !arg.endsWith('}')) return false;
  const inner = arg.slice(1, -1).trim();
  if (inner === '') return true;

  // Split fields by comma at brace/bracket/paren depth 0.
  const fields: string[] = [];
  let depth = 0, start = 0;
  let inString: '"' | "'" | '`' | null = null;
  let escape = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      fields.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (start < inner.length) fields.push(inner.slice(start).trim());

  for (const field of fields) {
    if (!field) continue;
    // Shorthand: `key`. Equivalent to `key: key`. Only safe for known
    // status keys; `data` / `items` shorthand is REJECTED.
    const shorthandMatch = field.match(/^(\w+)$/);
    if (shorthandMatch) {
      const key = shorthandMatch[1];
      if (VALUE_MUST_BE_CANONICAL.has(key)) return false;
      if (!SAFE_LITERAL_KEYS.has(key)) return false;
      continue;
    }
    // `key: value`.
    const kvMatch = field.match(/^(\w+)\s*:\s*([\s\S]+)$/);
    if (!kvMatch) return false;
    const key = kvMatch[1];
    const value = kvMatch[2].trim();
    if (!SAFE_LITERAL_KEYS.has(key)) return false;
    // Cycle-2 FN-kv-identifier absorb: `data:` and `items:` MUST receive
    // a canonical mapper / Zod parse value. Bare identifier or any other
    // non-canonical expression is REJECTED.
    if (VALUE_MUST_BE_CANONICAL.has(key)) {
      if (isCanonicalCall(value)) continue;
      return false;
    }
    // Other safe keys: accept primitive literals only.
    if (
      /^(['"`].*['"`]|\d+(\.\d+)?|true|false|null|undefined)$/.test(value)
    ) continue;
    // Reject bare identifiers / function calls for non-canonical-required
    // keys too — they're often raw row references.
    return false;
  }
  return true;
}

function findResJsonCalls(source: string): Array<{ openIdx: number; endIdx: number; arg: string }> {
  const out: Array<{ openIdx: number; endIdx: number; arg: string }> = [];
  // Match the `.json(` opener (with optional `.status(N)` prefix).
  const openerRe = /\bres(?:\s*\.\s*status\s*\(\s*\d+\s*\))?\s*\.\s*json\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(source)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const extracted = extractJsonArg(source, openIdx);
    if (extracted) {
      out.push({ openIdx: m.index, endIdx: extracted.endIdx, arg: extracted.arg });
    }
  }
  return out;
}

function checkFile(file: string, allow: AllowlistEntry[], violationBuckets: Map<string, number>): Violation[] {
  const source = readFileSync(file, 'utf-8');
  const relFile = file.replace(ROOT + '/', '');
  const violations: Violation[] = [];

  const lines = source.split('\n');
  const lineOffsets: number[] = [0];
  for (const ln of lines) lineOffsets.push(lineOffsets[lineOffsets.length - 1] + ln.length + 1);

  const calls = findResJsonCalls(source);

  for (const call of calls) {
    let lineNo = 1;
    for (let i = 0; i < lineOffsets.length - 1; i++) {
      if (call.openIdx >= lineOffsets[i] && call.openIdx < lineOffsets[i + 1]) {
        lineNo = i + 1;
        break;
      }
    }
    if (lineNo > 1 && (lines[lineNo - 2] || '').includes('@response-shape-exempt')) continue;

    const fullLine = lines[lineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);
    // Match on FULL line content (not truncated preview) for stable fingerprint.
    if (isAllowlistedFingerprint(relFile, lineNo, fullLine, allow)) {
      // Multiplicity check (PR-R1-1.5 cycle-2 finding #3).
      const fp = fingerprintLine(fullLine);
      if (fp) {
        const key = `${relFile}|${fp}`;
        violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
        const allowed = getAllowlistedCount(relFile, fp, allow);
        if ((violationBuckets.get(key) || 0) > allowed) {
          violations.push({
            file: relFile, lineNo, preview,
            reason: `over-count: ${violationBuckets.get(key)} occurrences vs ${allowed} allowlisted (fingerprint ${fp})`,
          });
        }
      }
      continue;
    }
    const arg = call.arg.trim();

    // (1) Canonical mapper / Zod parse anywhere in the arg.
    if (isCanonicalCall(arg)) continue;

    // (2) Literal object / primitive with safe keys.
    if (isLiteralObjectWithSafeKeys(arg)) continue;

    // (3) Empty call `res.json()` — uncommon but harmless.
    if (arg === '') continue;

    // Otherwise REJECT.
    let reason: string;
    if (/^\w+$/.test(arg)) {
      reason = `res.json(${arg}) — likely raw DB row/result; route through a Zod-validated mapper (mapXxxRowToResponse) per CLAUDE.md §5.2`;
    } else if (arg.startsWith('{') && /\bdata\s*:\s*\w+\s*[,}]/.test(arg)) {
      reason = 'res.json({ data: <bareIdent> }) — BUG-623 wrapper-shape leak class. Route data through a canonical mapper (data: rows.map(mapXxxToResponse))';
    } else if (arg.startsWith('{') && /\bitems\s*:\s*\w+\s*[,}]/.test(arg)) {
      reason = 'res.json({ items: <bareIdent> }) — wrapper-shape leak class. Route items through a canonical mapper';
    } else {
      reason = 'res.json(<expr>) — expression does not match canonical mapper / Zod parse / safe-literal pattern';
    }

    violations.push({ file: relFile, lineNo, preview, reason });
  }

  return violations;
}

function main(): void {
  const allow = loadAllowlist();
  const files = walkTs(SCAN_ROOT);
  const allViolations: Violation[] = [];

  // eslint-disable-next-line no-console
  console.log('→ check-response-shape-validated (BUG-638 cycle-2)');
  // eslint-disable-next-line no-console
  console.log(`  scanned:     ${files.length} ts file(s)`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:   ${ALLOWLIST_PATH.replace(ROOT + '/', '')} (${allow.length} entries)`);

  // Per-file fingerprint multiplicity tracking (cycle-2 finding #3).
  const violationBuckets = new Map<string, number>();

  for (const file of files) {
    const v = checkFile(file, allow, violationBuckets);
    allViolations.push(...v);
  }

  if (allViolations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every res.json() call passes through a canonical mapper / Zod parse / safe literal.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${allViolations.length} non-canonical res.json() call(s) detected:\n`);
  const HEAD_LIMIT = process.env.CHECK_RESPONSE_SHAPE_PRINT_ALL ? allViolations.length : 30;
  for (const v of allViolations.slice(0, HEAD_LIMIT)) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}`);
    // eslint-disable-next-line no-console
    console.error(`    reason: ${v.reason}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  if (allViolations.length > HEAD_LIMIT) {
    // eslint-disable-next-line no-console
    console.error(`\n  ... and ${allViolations.length - HEAD_LIMIT} more.`);
  }
  // eslint-disable-next-line no-console
  console.error('\nFix shape: route the response through a canonical Zod-validated mapper per CLAUDE.md §5.2 (sibling of BUG-613/618/622 mappers). If the response is genuinely a status/ack literal, add `// @response-shape-exempt: <reason>` on the line above OR add `<file>:<line>` to scripts/guards/check-response-shape-validated.allowlist with a cascade BUG citation.');
  process.exit(1);
}

main();
