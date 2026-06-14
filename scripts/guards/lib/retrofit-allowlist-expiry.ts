#!/usr/bin/env tsx
/**
 * Phase 0a.7 — retrofit allowlist entries with per-entry expiry annotations.
 *
 * Per `feedback_no_unsanctioned_deferral.md` + user direction (2026-05-03)
 * "Strict per-entry expiry on ALL existing entries", this script appends
 * an `expires: <date> (cascade: <bug>)` annotation to every data line
 * across all 24 `.allowlist` files in scripts/guards/.
 *
 * Strategy:
 * 1. Detect umbrella BUG-XXX citation in each line's existing comment.
 * 2. Look up target close-by date from UMBRELLA_EXPIRY map.
 * 3. Append `| expires: <date> (cascade: <bug>)` to comment.
 * 4. If line has no umbrella citation, mark as `permanent: <reason>`
 *    or `expires: needs-review` (sentinel for ambiguous cases).
 * 5. Add expiry-policy header to each file (idempotent).
 *
 * Usage:
 *   tsx scripts/guards/lib/retrofit-allowlist-expiry.ts            # apply
 *   tsx scripts/guards/lib/retrofit-allowlist-expiry.ts --dry-run  # preview
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_DIR = resolve(SCRIPT_DIR, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// Umbrella BUG → target close-by date (or 'permanent' for preventive guards)
const UMBRELLA_EXPIRY: Record<string, string> = {
  // Pre-staging (S1 priority — must close before staging cutover)
  'BUG-PR-R1-12-CASCADE-DRAIN-OPT-LOCKING': '2026-09-30',
  'BUG-PR-R1-19-CASCADE-DRAIN-CONTROLLER-WRITE-BYPASS': '2026-09-30',
  'BUG-PR-R1-18-CASCADE-DRAIN-AUDIT-LOG': '2026-09-30',
  'BUG-NEW-S1-CASCADE-DRAIN-KNEX-COLUMN-REFS': '2026-09-30',

  // Post-staging (S2 — should-ship-before-GA but not staging-blocker)
  'BUG-638-CASCADE-MIGRATE-MAPPER-CONSUMERS': '2026-12-31',
  'BUG-AUTHCONTEXT-MIGRATE-SERVICE-CONSUMERS': '2026-12-31',
  'BUG-PR-R1-14-CASCADE-DRAIN-SOFT-DELETE': '2026-12-31',
  'BUG-JSONB-EXTRACTION-MIGRATE-CONSUMERS': '2026-12-31',
  'BUG-PR-R1-11-CASCADE-DRAIN-CONVENTION': '2026-12-31',
  'BUG-PR-R1-16-CASCADE-DRAIN-MIGRATION-INDEXES': '2026-12-31',
  'BUG-PR-R1-22-CASCADE-DRAIN-MUTATION-INVALIDATION': '2026-12-31',
  'BUG-PR-R1-21-CASCADE-DRAIN-ERROR-ENVELOPE': '2026-12-31',
  'BUG-PR-R1-6-CASCADE-CATALOGUE-CLEANUP': '2026-12-31',
  'BUG-PR-R1-14-CASCADE-DRAIN-SOFT-DELETE-FILTER': '2026-12-31',

  // Permanent (preventive guards with 0 baseline violations; placeholder umbrella)
  'BUG-PR-R1-23-CASCADE-DRAIN-STREAM-ERROR-HANDLER': 'permanent',
  'BUG-PR-R1-24-CASCADE-DRAIN-TIMER-TRY-CATCH': 'permanent',

  // Cycle-2 / cycle-3 absorb baselines (per-allowlist, fingerprint-resilient)
  'PR-R1-1.5': '2026-12-31', // PR-R1-1.5 baseline format
  'PR-R1-2': '2026-12-31',   // existing service-auth-context baseline
  'PR-R1-6': '2026-12-31',   // bugs-remaining-uniqueness
};

const HEADER_TEMPLATE = `# Expiry-policy: per-entry (added 2026-05-03 cycle Phase 0a.7)
# Each non-comment line carries an \`| expires: <YYYY-MM-DD> (cascade: <BUG>)\`
# OR \`| permanent: <reason>\` annotation. Entries past their expiry date
# fail the merge gate via \`scripts/guards/check-allowlist-expiry.ts\`.
# Renewal: when a target close-by date passes, EITHER drain the entry
# (preferred) OR explicitly extend the date with operator authorization.
`;

interface RetrofitResult {
  file: string;
  totalLines: number;
  dataLines: number;
  alreadyAnnotated: number;
  annotated: number;
  ambiguousNeedsReview: number;
}

function detectUmbrella(line: string): { bug: string; expiry: string } | null {
  // Match BUG-XXX patterns in the comment portion
  const commentIdx = line.indexOf('#');
  if (commentIdx === -1) return null;
  const comment = line.slice(commentIdx);

  // Try to find any registered umbrella
  for (const [bug, expiry] of Object.entries(UMBRELLA_EXPIRY)) {
    if (comment.includes(bug)) {
      return { bug, expiry };
    }
  }

  // Fallback: detect generic BUG-XXX citation that's not in the explicit
  // umbrella map. Default to post-staging (2026-12-31) — operator can
  // refine per-entry if a tighter date applies (e.g., S0/S1 BUGs that
  // should be pre-staging).
  const match = /BUG-[A-Z0-9.-]+/.exec(comment);
  if (match) {
    return { bug: match[0], expiry: '2026-12-31' };
  }
  return null;
}

// Per-file permanent-defaults — allowlists where every entry is a legitimate
// permanent exemption (no cascade-drain umbrella applies).
const PERMANENT_DEFAULTS: Record<string, string> = {
  'check-fix-registry-decisiveness.allowlist': 'fix-registry anchor pin (allowlist-size / file-content / many-sites defence pattern; consolidation-or-pattern-loosening drift detection only)',
  'log-phi.allowlist': 'BUG-269 baseline — workflow metadata keys matching PHI regex but legitimate in logging context (not patient data)',
};

function annotateLine(line: string, fileName: string): { annotated: string; status: 'already-annotated' | 'annotated' | 'ambiguous' | 'skip' } {
  // Skip empty / comment-only lines
  if (line.trim().length === 0) return { annotated: line, status: 'skip' };
  if (line.trimStart().startsWith('#')) return { annotated: line, status: 'skip' };

  // If already has needs-review annotation, attempt to upgrade to a
  // proper expiry (re-detect umbrella; replace the needs-review portion).
  if (/\|\s*expires:\s*needs-review/i.test(line)) {
    const detected = detectUmbrella(line);
    if (detected && detected.expiry !== 'needs-review') {
      const upgraded = line.replace(
        /\s*\|\s*expires:\s*needs-review[^|]*$/i,
        ` | expires: ${detected.expiry} (cascade: ${detected.bug})`,
      );
      return { annotated: upgraded, status: 'annotated' };
    }
    // No upgrade possible — keep needs-review (still ambiguous)
    return { annotated: line, status: 'ambiguous' };
  }

  // If already has proper expiry / permanent annotation, leave alone
  if (/\|\s*(expires|permanent):/i.test(line)) {
    return { annotated: line, status: 'already-annotated' };
  }

  // Per-file permanent default takes precedence over umbrella detection
  const permanentDefault = PERMANENT_DEFAULTS[fileName];
  if (permanentDefault) {
    return {
      annotated: line + ` | permanent: ${permanentDefault}`,
      status: 'annotated',
    };
  }

  const detected = detectUmbrella(line);
  if (!detected) {
    // No BUG citation at all — mark for manual review
    const status = 'ambiguous' as const;
    return {
      annotated: line + ' | expires: needs-review (no-umbrella-citation)',
      status,
    };
  }

  const annotation = detected.expiry === 'permanent'
    ? `permanent: ${detected.bug} preventive guard, baseline 0 violations`
    : `expires: ${detected.expiry} (cascade: ${detected.bug})`;
  return {
    annotated: line + ` | ${annotation}`,
    status: 'annotated',
  };
}

function retrofit(filePath: string): RetrofitResult {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const out: string[] = [];
  let dataLines = 0;
  let alreadyAnnotated = 0;
  let annotated = 0;
  let ambiguous = 0;

  // Inject header policy block AFTER the existing header comment block
  let headerInjected = false;
  let inHeaderBlock = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inHeaderBlock && (line.trim() === '' || !line.trimStart().startsWith('#'))) {
      // End of header block
      if (!headerInjected) {
        // Check if header policy already present
        const headerSoFar = out.join('\n');
        if (!/Expiry-policy: per-entry/.test(headerSoFar)) {
          out.push(HEADER_TEMPLATE.trimEnd());
        }
        headerInjected = true;
      }
      inHeaderBlock = false;
    }
    if (line.trim() && !line.trimStart().startsWith('#')) {
      dataLines++;
      const fname = filePath.split('/').pop() ?? '';
      const result = annotateLine(line, fname);
      if (result.status === 'already-annotated') alreadyAnnotated++;
      else if (result.status === 'annotated') annotated++;
      else if (result.status === 'ambiguous') ambiguous++;
      out.push(result.annotated);
    } else {
      out.push(line);
    }
  }

  // If file was all-header (no data lines hit), still inject policy
  if (!headerInjected) {
    if (!/Expiry-policy: per-entry/.test(content)) {
      out.push(HEADER_TEMPLATE.trimEnd());
    }
  }

  const newContent = out.join('\n');
  if (!DRY_RUN && newContent !== content) {
    writeFileSync(filePath, newContent);
  }

  return {
    file: filePath,
    totalLines: lines.length,
    dataLines,
    alreadyAnnotated,
    annotated,
    ambiguousNeedsReview: ambiguous,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const allowlistFiles = readdirSync(ALLOWLIST_DIR)
  .filter((f) => f.endsWith('.allowlist'))
  .map((f) => join(ALLOWLIST_DIR, f));

console.log(`\n=== Allowlist Expiry Retrofit ${DRY_RUN ? '(DRY RUN)' : '(APPLYING)'} ===\n`);
console.log(`Found ${allowlistFiles.length} allowlist files\n`);

const results: RetrofitResult[] = [];
for (const f of allowlistFiles) {
  results.push(retrofit(f));
}

// Summary
let totalDataLines = 0;
let totalAlreadyAnnotated = 0;
let totalAnnotated = 0;
let totalAmbiguous = 0;
console.log('Per-file results:');
console.log('');
for (const r of results) {
  totalDataLines += r.dataLines;
  totalAlreadyAnnotated += r.alreadyAnnotated;
  totalAnnotated += r.annotated;
  totalAmbiguous += r.ambiguousNeedsReview;
  const fname = r.file.split('/').pop();
  console.log(
    `  ${fname?.padEnd(56)} data: ${String(r.dataLines).padStart(4)} | already: ${String(r.alreadyAnnotated).padStart(3)} | newly: ${String(r.annotated).padStart(4)} | ambiguous: ${r.ambiguousNeedsReview}`,
  );
}
console.log('');
console.log(`TOTALS:`);
console.log(`  data lines:        ${totalDataLines}`);
console.log(`  already annotated: ${totalAlreadyAnnotated}`);
console.log(`  newly annotated:   ${totalAnnotated}`);
console.log(`  ambiguous:         ${totalAmbiguous}`);
console.log('');

if (totalAmbiguous > 0) {
  console.log(`WARNING: ${totalAmbiguous} entries have no umbrella BUG citation and were marked 'expires: needs-review'.`);
  console.log(`These need manual review to either (a) trace to an umbrella BUG, OR (b) mark as permanent.`);
  console.log(`Run \`grep -n 'expires: needs-review' scripts/guards/*.allowlist\` to find them.`);
}

if (DRY_RUN) {
  console.log('DRY RUN — no files were modified. Re-run without --dry-run to apply.');
} else {
  console.log('APPLIED — files modified in-place. Run pre-existing guards to verify allowlist parsing still works.');
}
