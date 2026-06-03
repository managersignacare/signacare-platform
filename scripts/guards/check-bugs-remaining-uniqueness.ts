#!/usr/bin/env tsx
/*
 * scripts/guards/check-bugs-remaining-uniqueness.ts
 *
 * Phase R1 PR-R1-6 — CLAUDE.md §9.5 enforcement (catalogue uniqueness).
 *
 * ── Why this exists ──────────────────────────────────────────────
 * BUG-633 / BUG-634b history:
 *   The same BUG-ID appeared as MULTIPLE rows in `docs/quality/
 *   bugs-remaining.md` (e.g., one "open" row + one "fixed" row for
 *   the same numeric ID), creating a split-state catalogue. Reviewers
 *   reading the catalogue couldn't tell which state was authoritative;
 *   the cascade BUG-634b had to specifically absorb the L3 cycle-1
 *   REJECT for catalogue split-state.
 *
 * The structural answer: walk every markdown table in
 * `bugs-remaining.md`, extract every BUG-ID that appears in the
 * "BUG" / "Bug" column (column 1 or 2 depending on table shape),
 * and assert each ID appears in EXACTLY ONE row. Duplicates fail
 * the merge-gate.
 *
 * ── Scope ────────────────────────────────────────────────────────
 * File: docs/quality/bugs-remaining.md
 *
 * Detection (cycle-2 absorb of L3 PR-R1-6 advisories):
 *   1. Walk lines tracking fenced code-block state — pipe-tables
 *      inside ` ``` ` fences are NOT parsed as catalogue tables (A1).
 *   2. Find every markdown table (header row containing "Bug" / "BUG"
 *      cell + separator row). Tables WITHOUT a separator emit an
 *      explicit warning so a future maintainer doesn't silently bypass
 *      the guard (A2).
 *   3. `parseRow` keeps the LAST cell on lines without a trailing `|`
 *      (cycle-1 dropped it), so a `| open | BUG-X` row is still
 *      detected (A3).
 *   4. For each data row, extract the BUG-ID after stripping markdown
 *      formatting (`**`, `~~`, surrounding spaces, layered `~~**...**~~`).
 *      Character class `[A-Za-z0-9._-]+` preserves dot-suffix IDs
 *      (BUG-A5.0 vs BUG-A5.3 are distinct).
 *   5. Build a Map<id, occurrences[]>; REJECT any id with > 1
 *      unless its row count matches the allowlisted EXPECTED count.
 *
 * ── Allowlist (cycle-2 EXPECTED-COUNT format, A4 + A5) ────────────
 * Cycle-1 used `<BUG-ID>  # comment` and accepted ANY count >= 2 for
 * an allowlisted ID, masking state-flips and unbounded growth on
 * pre-existing split-states. Cycle-2 mandates an explicit expected
 * count:
 *
 *   <BUG-ID> expected=<N>  # comment
 *
 * The guard asserts that the actual occurrence count for each
 * allowlisted ID EXACTLY matches `<N>`. Drift in either direction
 * (e.g., BUG-547 drops to 1 row OR climbs to 3 rows) fails the
 * merge-gate so a state-flip on the allowlisted entry can't sneak
 * through. Plus a hard-coded MAX_ALLOWLIST_SIZE constant prevents
 * silent allowlist growth.
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:bugs-remaining-uniqueness`
 *
 * Exit codes:
 *   0  every BUG-ID appears in exactly one row
 *   1  one or more BUG-IDs appear in multiple rows (split-state)
 *      OR an allowlisted ID's count drifted from its expected value
 *      OR allowlist exceeds MAX_ALLOWLIST_SIZE
 *      OR a table-shaped block was found without a separator row
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOGUE_PATH = path.join(REPO_ROOT, 'docs', 'quality', 'bugs-remaining.md');
const ALLOWLIST_PATH = path.join(__dirname, 'check-bugs-remaining-uniqueness.allowlist');

/**
 * Cap on allowlist size (PR-R1-6 cycle-2 absorb of L3 finding A4).
 * Pre-existing split-states tracked under BUG-PR-R1-6-CASCADE-CATALOGUE-CLEANUP
 * are 5 entries today. Growth beyond this requires deliberate code
 * change to the constant + cascade-BUG documentation (no silent expand).
 */
const MAX_ALLOWLIST_SIZE = 5;

interface AllowlistEntry {
  bugId: string;
  expectedCount: number;
  raw: string;
}

/**
 * Load the allowlist of BUG-IDs that are KNOWN to have multiple rows
 * in the catalogue (pre-existing split-state, deferred to a dedicated
 * cleanup BUG). Format (cycle-2): `<BUG-ID> expected=<N>  # comment`.
 *
 * The allowlist is a TRANSIENT shim — entries should drain as the
 * dedicated catalogue-cleanup BUG resolves them. New split-states
 * cannot be allowlisted to bypass the rule (cascade BUG required).
 */
function loadAllowlist(): { entries: AllowlistEntry[]; parseErrors: string[] } {
  const entries: AllowlistEntry[] = [];
  const parseErrors: string[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  } catch {
    return { entries, parseErrors };
  }
  for (let i = 0; i < raw.split('\n').length; i++) {
    const line = raw.split('\n')[i]!;
    const trimmed = line.split('#')[0]!.trim();
    if (!trimmed) continue;
    // Required shape: `<BUG-ID> expected=<N>`
    const m = /^(BUG-[A-Za-z0-9._-]+)\s+expected=(\d+)$/.exec(trimmed);
    if (!m) {
      parseErrors.push(
        `line ${i + 1}: malformed entry "${trimmed}". Expected format: \`<BUG-ID> expected=<N>  # comment\``,
      );
      continue;
    }
    entries.push({
      bugId: m[1]!,
      expectedCount: parseInt(m[2]!, 10),
      raw: line,
    });
  }
  return { entries, parseErrors };
}

interface Occurrence {
  line: number;
  context: string; // line content (truncated for display)
}

/**
 * Strip markdown formatting from a cell value to extract the BUG-ID.
 *   `**BUG-XXX**` → `BUG-XXX`
 *   `~~**BUG-XXX**~~` → `BUG-XXX`
 *   `~~BUG-XXX~~` → `BUG-XXX`
 *   `BUG-XXX` → `BUG-XXX`
 */
function extractBugId(cell: string): string | null {
  // Strip ALL markdown formatting layers: tildes (strikethrough), bold,
  // backticks. Some cells layer them: `~~**BUG-XXX**~~`.
  let stripped = cell.trim();
  for (let i = 0; i < 4; i++) {
    stripped = stripped
      .replace(/^~~/, '')
      .replace(/~~$/, '')
      .replace(/^\*\*/, '')
      .replace(/\*\*$/, '')
      .replace(/^`/, '')
      .replace(/`$/, '')
      .trim();
  }
  // Match the BUG-ID at the start. Include `.` (BUG-A5.0, BUG-A5.3) and
  // `_` (BUG-foo_bar) in the character class. Without `.` the regex
  // would silently collapse BUG-A5.0 / BUG-A5.3 to the same ID.
  const m = /^(BUG-[A-Za-z0-9._-]+)/.exec(stripped);
  return m ? m[1]! : null;
}

/**
 * Parse a markdown line into cells.
 *
 * Cycle-2 absorb (L3 PR-R1-6 advisory A3): cycle-1 used
 * `.split('|').slice(1, -1)` which dropped the LAST cell on lines
 * without a trailing `|`. Cycle-2: split on `|`, strip the leading
 * empty (from the leading `|`), and keep ALL trailing non-empty
 * cells. A line `| open | BUG-X` (no trailing pipe) now correctly
 * yields `['open', 'BUG-X']` instead of `['open']`.
 */
export function parseRow(line: string): string[] {
  if (!line.trimStart().startsWith('|')) return [];
  const parts = line.split('|');
  // Drop the leading empty part (from the leading pipe).
  parts.shift();
  // If the line ends with `|`, the final part is empty too — drop it.
  if (parts.length > 0 && parts[parts.length - 1]!.trim() === '') {
    parts.pop();
  }
  return parts.map((c) => c.trim());
}

interface ScanResult {
  occurrences: Map<string, Occurrence[]>;
  /** Tables that look like catalogue tables but lack a separator row.
   *  Cycle-2 emits these explicitly so a future maintainer can't
   *  silently skip the guard by deleting the `|---|---|` row.
   */
  tablesWithoutSeparator: Array<{ line: number; preview: string }>;
}

/**
 * Walk the markdown file, identify tables, and for each data row in
 * a "BUG" / "Bug" -indexed table, extract the ID. Returns
 * Map<bugId, Occurrence[]> + a list of malformed-table warnings.
 *
 * Cycle-2 (L3 PR-R1-6 advisories absorbed):
 *   - A1 fenced code-block tracking
 *   - A2 missing-separator emits explicit warning
 *   - A3 robust parseRow (defined above)
 */
export function scanCatalogue(source: string): ScanResult {
  const map = new Map<string, Occurrence[]>();
  const tablesWithoutSeparator: Array<{ line: number; preview: string }> = [];
  const lines = source.split('\n');
  let inTable = false;
  let bugColumnIndex = -1;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // A1: track fenced code-block state. Toggle on lines that start
    // with ``` (optionally indented). We don't need to match the
    // closing-language tag — any leading-``` line toggles.
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      // End any in-flight table
      inTable = false;
      bugColumnIndex = -1;
      continue;
    }
    if (inCodeFence) continue;

    const cells = parseRow(line);

    if (cells.length === 0) {
      // End of any in-flight table
      inTable = false;
      bugColumnIndex = -1;
      continue;
    }

    // Header detection: row whose cells include 'Bug' or 'BUG' (case-insensitive)
    if (!inTable) {
      const idx = cells.findIndex((c) => /^(Bug|BUG)$/i.test(c));
      if (idx !== -1) {
        // Check next line is the separator `|---|---|...`
        const next = lines[i + 1] ?? '';
        if (/^\s*\|\s*-/.test(next)) {
          inTable = true;
          bugColumnIndex = idx;
          i++; // skip separator
          continue;
        }
        // A2: header looks like a Bug-table but separator is missing.
        // Emit a structured warning rather than silently skipping the
        // entire table.
        tablesWithoutSeparator.push({
          line: i + 1,
          preview: line.length > 120 ? line.substring(0, 120) + '…' : line,
        });
      }
      continue;
    }

    // In-table data row
    if (cells.length <= bugColumnIndex) {
      // Shape mismatch — likely table continued differently. Treat as end.
      inTable = false;
      bugColumnIndex = -1;
      continue;
    }
    const idCell = cells[bugColumnIndex]!;
    const bugId = extractBugId(idCell);
    if (!bugId) continue;
    const occList = map.get(bugId) ?? [];
    occList.push({
      line: i + 1,
      context: line.length > 120 ? line.substring(0, 120) + '…' : line,
    });
    map.set(bugId, occList);
  }

  return { occurrences: map, tablesWithoutSeparator };
}

/**
 * Backward-compatible export retained for the vitest spec — returns
 * just the occurrences map. New callers should use `scanCatalogue`
 * for the full result (with separator warnings).
 */
export function findBugIdOccurrences(source: string): Map<string, Occurrence[]> {
  return scanCatalogue(source).occurrences;
}

function main(): number {
  let source: string;
  try {
    source = fs.readFileSync(CATALOGUE_PATH, 'utf-8');
  } catch (err) {
    console.error(`✗ could not read ${CATALOGUE_PATH}: ${(err as Error).message}`);
    return 1;
  }

  const { occurrences, tablesWithoutSeparator } = scanCatalogue(source);
  const { entries: allowlistEntries, parseErrors } = loadAllowlist();
  const allowlistMap = new Map<string, number>();
  for (const e of allowlistEntries) allowlistMap.set(e.bugId, e.expectedCount);

  // A4: hard cap on allowlist size — silent growth is the failure mode
  const allowlistSizeOverflow = allowlistEntries.length > MAX_ALLOWLIST_SIZE;

  // A5: per-ID expected-count assertion
  const duplicates: Array<{ id: string; rows: Occurrence[] }> = [];
  const countMismatches: Array<{ id: string; expected: number; actual: number; rows: Occurrence[] }> = [];
  let allowlisted = 0;
  for (const [id, occs] of occurrences) {
    if (occs.length > 1) {
      if (allowlistMap.has(id)) {
        const expected = allowlistMap.get(id)!;
        if (occs.length !== expected) {
          countMismatches.push({ id, expected, actual: occs.length, rows: occs });
        } else {
          allowlisted++;
        }
        continue;
      }
      duplicates.push({ id, rows: occs });
    } else if (allowlistMap.has(id)) {
      // The allowlisted ID is now SINGLE-row (the cleanup happened) —
      // mismatch in the LOW direction. Surface so the allowlist entry
      // can be removed.
      countMismatches.push({ id, expected: allowlistMap.get(id)!, actual: 1, rows: occs });
    }
  }

  const totalIds = occurrences.size;
  console.error('→ check-bugs-remaining-uniqueness (PR-R1-6 cycle-2; CLAUDE.md §9.5)');
  console.error(`  catalogue:    ${path.relative(REPO_ROOT, CATALOGUE_PATH)}`);
  console.error(`  unique IDs:   ${totalIds}`);
  console.error(`  allowlist:    ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} (${allowlistEntries.length} / ${MAX_ALLOWLIST_SIZE} entries)`);
  console.error(`  allowlisted:  ${allowlisted}`);
  console.error(`  count drift:  ${countMismatches.length}`);
  console.error(`  new dups:     ${duplicates.length}`);
  console.error(`  no-separator: ${tablesWithoutSeparator.length}`);
  console.error('');

  let exitCode = 0;

  if (parseErrors.length > 0) {
    console.error(`✗ ${parseErrors.length} allowlist parse error(s):`);
    for (const e of parseErrors) console.error(`  ${e}`);
    console.error('');
    console.error(
      'Fix: each allowlist line MUST be `<BUG-ID> expected=<N>  # comment` per the cycle-2 format.',
    );
    console.error('');
    exitCode = 1;
  }

  if (allowlistSizeOverflow) {
    console.error(`✗ allowlist has ${allowlistEntries.length} entries; MAX_ALLOWLIST_SIZE = ${MAX_ALLOWLIST_SIZE}.`);
    console.error('  Growth beyond the cap requires deliberate code change to the constant + cascade-BUG.');
    console.error('  NEW split-states cannot be allowlisted as a workaround.');
    console.error('');
    exitCode = 1;
  }

  if (tablesWithoutSeparator.length > 0) {
    console.error(`✗ ${tablesWithoutSeparator.length} Bug-header table(s) without separator row:`);
    for (const t of tablesWithoutSeparator) {
      console.error(`  line ${t.line}: ${t.preview}`);
    }
    console.error('  Add the |---|---|... separator immediately under the header row.');
    console.error('');
    exitCode = 1;
  }

  if (countMismatches.length > 0) {
    console.error(`✗ ${countMismatches.length} allowlisted BUG-ID(s) have drifted row counts:\n`);
    countMismatches.sort((a, b) => a.id.localeCompare(b.id));
    for (const { id, expected, actual, rows } of countMismatches) {
      console.error(`  ${id} (expected=${expected}, actual=${actual}):`);
      for (const r of rows) console.error(`    line ${r.line}: ${r.context}`);
      console.error('');
    }
    console.error(
      'Allowlist entries are PINNED to an expected occurrence count. Drift in either direction ' +
        '(consolidation OR regression) requires updating the allowlist line so silent state-flips ' +
        "can't sneak through.",
    );
    console.error('');
    exitCode = 1;
  }

  if (duplicates.length > 0) {
    console.error(`✗ ${duplicates.length} BUG-ID(s) appear in multiple rows (split-state — BUG-633/634b class):\n`);
    duplicates.sort((a, b) => a.id.localeCompare(b.id));
    for (const { id, rows } of duplicates) {
      console.error(`  ${id} (${rows.length} occurrences):`);
      for (const r of rows) {
        console.error(`    line ${r.line}: ${r.context}`);
      }
      console.error('');
    }
    console.error(
      'Fix per CLAUDE.md §9.5: each BUG-ID must appear in EXACTLY ONE row of the catalogue. ' +
        'Split-state (open + fixed for same ID) is the bug class this guard prevents. ' +
        'Resolve by deleting the stale row OR renaming one of them to a cascade sibling (BUG-XXX-CASCADE-N).',
    );
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.error('✓ Every BUG-ID in the catalogue appears in exactly one row (no split-state). Allowlist + tables clean.');
  }
  return exitCode;
}

if (require.main === module) {
  process.exit(main());
}
