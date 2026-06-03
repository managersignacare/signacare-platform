#!/usr/bin/env tsx
/*
 * scripts/guards/lib/seed-fix-registry-decisiveness-allowlist.ts
 *
 * Phase R1 PR-R1-7 cycle-2 — one-shot seed for the decisiveness
 * allowlist. Re-uses the runtime guard's `parseRegistry` +
 * `countMatches` so seed and runtime are mechanically consistent
 * (no regex drift).
 *
 * Each entry is emitted in the cycle-2 format:
 *   <ANCHOR-ID> expected=<N>  # cycle-1 hits=<N> in <file>
 *
 * The `expected=<N>` value is parsed by the guard and ASSERTED — drift
 * in either direction surfaces in the guard report.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseRegistry,
  countMatches,
  MAX_DECISIVE_HITS,
} from './fix-registry-decisiveness-core';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'docs', 'quality', 'fix-registry.md');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-fix-registry-decisiveness.allowlist');

function main(): void {
  const registrySource = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  const rows = parseRegistry(registrySource);
  const seedEntries: Array<{ id: string; hits: number; file: string }> = [];
  for (const row of rows) {
    if (row.type !== 'present') continue;
    const hits = countMatches(row.pattern, row.file, REPO_ROOT);
    if (hits > MAX_DECISIVE_HITS) {
      seedEntries.push({ id: row.id, hits, file: row.file });
    }
  }
  seedEntries.sort((a, b) => b.hits - a.hits);

  const header = `# scripts/guards/check-fix-registry-decisiveness.allowlist
#
# Phase R1 PR-R1-7 cycle-2 — fix-registry anchor IDs that legitimately
# match more than MAX_DECISIVE_HITS (= 5) lines. Each entry pins the
# EXPECTED hit count via \`expected=<N>\`. Drift in either direction
# (consolidation OR pattern-loosening) fails the guard so silent
# pattern-creep can't sneak through.
#
# Format (cycle-2 absorb of L3 finding #3): \`<ANCHOR-ID> expected=<N>  # reason\`
#
# Categories of legitimate >5-hit anchors:
#
#   - allowlist-size pin: anchor counts entries in a generated
#     allowlist (BUG-638-CASCADE-MIGRATE-MAPPER-CONSUMERS,
#     original-lineno: across migrated entries, etc.)
#   - file-content pin: migration adds N tables / N rows; anchor
#     pins the bulk content (R-FIX-LETTER-TEMPLATES, ONCO1, etc.)
#   - many-sites defence: a defensive pattern (clinic_id filter,
#     requirePatientOwnership) is intentionally applied to N routes
#     and the anchor counts them (RLS1, AUTO-EP1, etc.)
#   - vitest-spec self-reference: a spec file references the symbol
#     under test in N test cases (R-FIX-PHASE-R1-PR6-VITEST-SPEC etc.)
#
# IMPORTANT: NEW anchors with > 5 hits should NOT be allowlisted as
# a workaround. Tighten the pattern to pin the unique fix-shape
# (typically 1-3 lines) instead. This allowlist is for the
# pre-existing baseline + structurally-justified multi-hit anchors only.
`;

  const lines = seedEntries.map(
    (e) => `${e.id} expected=${e.hits}  # cycle-1 hits=${e.hits} in ${e.file}`,
  );

  const content = header + '\n' + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, content, 'utf-8');
  console.log(`Seeded ${seedEntries.length} entries into ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
}

main();
