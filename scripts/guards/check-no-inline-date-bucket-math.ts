/**
 * check-no-inline-date-bucket-math
 *
 * Plan PART 6, DoD#5. Regression-proof guard for the dynamic due-date
 * count header + list date-range filter on the clinical list surfaces.
 *
 * WHY THIS EXISTS
 * ---------------
 * `apps/web/src/shared/utils/dueDateBuckets.ts` is the single source of
 * truth for due-date bucketing (overdue / this-week / next-week / this-
 * month / this-quarter) AND the list date-range filter — they must never
 * drift apart. `apps/web/src/shared/utils/reviewCycle.ts` is the SSoT for
 * the 91-day clinical-review cadence. Both replaced ad-hoc inline date
 * math that previously lived in ClinicalListPage.tsx
 * (`* 86400000`, `getTime() +/- N * dayMs`, `1000*60*60*24` …). If any
 * inline day-ms date math is re-introduced into the lists feature, the
 * cards and the filter can silently disagree again — a clinical-safety
 * regression (a patient appears "due this week" on the filter but not in
 * the count, or vice-versa). This guard makes that regression impossible.
 *
 * SCOPE (explicit, deliberate)
 * ----------------------------
 * Only `apps/web/src/features/lists/**` is scanned. That is the exact
 * surface the dueDateBuckets / reviewCycle SSoT governs. The SSoT utils
 * themselves live under `apps/web/src/shared/utils/` — OUTSIDE this
 * scope — so they are allowed by construction and the allowlist stays
 * EMPTY (DoD#5). Other features (PatientDetailLayout, NinetyOneDayReview
 * Tab, …) have their own unrelated day-ms math and are intentionally not
 * in scope; widening the scope would force a non-empty allowlist, which
 * is precisely the band-aid this deliverable forbids. A future SSoT
 * consolidation of those surfaces would extend this guard's scope, not
 * its allowlist.
 *
 * WHAT IS BANNED (after stripping comments + string/template literals so
 * doc references and the "see check-no-inline-date-bucket-math" comment
 * never false-positive):
 *   1. The literal day-in-ms magic number: 86400000 / 86_400_000.
 *   2. Canonical day-ms compositions: `1000*60*60*24`, `24*60*60*1000`,
 *      `60*60*24*1000`, `1000*86400`, `86400*1000` (whitespace-tolerant).
 *
 * Either shape means someone is doing bucket/cadence date math inline
 * instead of importing the SSoT util — REJECT.
 *
 * House-style: focused regex guard like check-no-fire-and-forget /
 * check-no-telecom (no ESLint dependency). Real non-zero exit so the
 * merge gate blocks. Allowlist file exists for the mechanism but is
 * empty by mandate; an entry would need a # rationale and operator sign-
 * off (and is itself a smell — prefer extending the SSoT util).
 *
 * Regression-pinned by fix-registry anchor
 * R-FIX-PART6-NO-INLINE-DATE-BUCKET-MATH-GUARD.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'web', 'src', 'features', 'lists');
const ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'guards',
  'check-no-inline-date-bucket-math.allowlist',
);

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
  readonly kind: 'literal-day-ms' | 'day-ms-composition';
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

/**
 * Strip line comments, block comments, and string/template literals so
 * that documentation, the guard-reference comment, and any string that
 * happens to mention a number can never false-positive. Replaces removed
 * spans with same-length blanks to preserve line/column for reporting.
 */
function stripCommentsAndStrings(src: string): string {
  const chars = src.split('');
  const n = chars.length;
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  while (i < n) {
    const c = chars[i];
    const c2 = i + 1 < n ? chars[i + 1] : '';
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; }
      else if (c === '/' && c2 === '*') { mode = 'block'; }
      else if (c === "'") { mode = 'sq'; }
      else if (c === '"') { mode = 'dq'; }
      else if (c === '`') { mode = 'tpl'; }
      i++;
      continue;
    }
    // inside a non-code span — blank it (keep newlines)
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; i++; continue; }
      chars[i] = ' '; i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { chars[i] = ' '; chars[i + 1] = ' '; i += 2; mode = 'code'; continue; }
      if (c !== '\n') chars[i] = ' ';
      i++; continue;
    }
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
      const quote = mode === 'sq' ? "'" : mode === 'dq' ? '"' : '`';
      if (c === '\\') { chars[i] = ' '; if (i + 1 < n && chars[i + 1] !== '\n') chars[i + 1] = ' '; i += 2; continue; }
      if (c === quote) { mode = 'code'; i++; continue; }
      if (c !== '\n') chars[i] = ' ';
      i++; continue;
    }
  }
  return chars.join('');
}

// 86400000 or 86_400_000 as a standalone numeric literal.
const LITERAL_DAY_MS = /\b86_?400_?000\b/;

// Canonical day-ms compositions, whitespace-tolerant. Each captures the
// well-known factorisations of 86,400,000 ms / 1 day.
const DAY_MS_COMPOSITIONS: RegExp[] = [
  /\b1000\s*\*\s*60\s*\*\s*60\s*\*\s*24\b/,
  /\b24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b/,
  /\b60\s*\*\s*60\s*\*\s*24\s*\*\s*1000\b/,
  /\b1000\s*\*\s*86400\b/,
  /\b86400\s*\*\s*1000\b/,
];

function scanFile(relPath: string, src: string, allowlist: Set<string>): Violation[] {
  const out: Violation[] = [];
  const stripped = stripCommentsAndStrings(src);
  const lines = stripped.split('\n');
  const rawLines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i];
    let kind: Violation['kind'] | null = null;
    if (LITERAL_DAY_MS.test(code)) kind = 'literal-day-ms';
    else if (DAY_MS_COMPOSITIONS.some((re) => re.test(code))) kind = 'day-ms-composition';
    if (!kind) continue;

    const allowKey = `${relPath}:${i + 1}`;
    const allowKeyAnyLine = relPath;
    if (allowlist.has(allowKey) || allowlist.has(allowKeyAnyLine)) continue;

    out.push({ file: relPath, line: i + 1, snippet: rawLines[i].trim(), kind });
  }
  return out;
}

async function main(): Promise<void> {
  console.log('→ check-no-inline-date-bucket-math');
  const allowlist = await loadAllowlist();
  const files = (await walk(SCAN_ROOT, /\.(ts|tsx)$/)).filter(
    (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx') && !f.includes('/__tests__/'),
  );
  const violations: Violation[] = [];
  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    violations.push(...scanFile(path.relative(REPO_ROOT, file), src, allowlist));
  }

  console.log(`  scanned:    ${files.length} file(s) under apps/web/src/features/lists`);
  console.log(`  allowlist:  ${allowlist.size} entries`);

  if (violations.length === 0) {
    console.log('✓ No inline day-ms date-bucket math in the lists feature.');
    console.log('  (dueDateBuckets.ts / reviewCycle.ts are the SSoT — keep it that way.)');
    process.exit(0);
  }

  console.error('');
  console.error(
    `✗ FAIL: ${violations.length} inline day-ms date-math site(s) in the lists feature.`,
  );
  console.error(
    '  The due-date buckets + 91-day cadence are SSoT in apps/web/src/shared/utils.',
  );
  console.error('  Import computeDueDateBuckets / isInDueBucket / compute91DayReviewCycle');
  console.error('  instead of re-implementing date math inline. See plan PART 6.');
  console.error('');
  for (const v of violations) {
    console.error(`  ✗ [${v.kind}] ${v.file}:${v.line}: ${v.snippet}`);
  }
  console.error('');
  process.exit(1);
}

void main().catch((err) => {
  console.error('check-no-inline-date-bucket-math crashed:', err);
  process.exit(1);
});
