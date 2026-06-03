#!/usr/bin/env tsx
/**
 * Phase 0a.7 — allowlist expiry guard.
 *
 * Validates per-entry expiry annotations across all 24 `.allowlist` files
 * in scripts/guards/. Per `feedback_per_deliverable_dod.md` + user direction
 * (2026-05-03 Phase 0a.7) "Strict per-entry expiry on ALL existing entries".
 *
 * Rules:
 *   1. EVERY data line (non-comment, non-empty) MUST carry one of:
 *      - `| expires: YYYY-MM-DD (cascade: BUG-XXX)` — drain-cascade entry
 *      - `| permanent: <reason>` — permanent exemption
 *   2. Entries past their expiry date FAIL the guard (block CI until renewed
 *      or drained).
 *   3. NEW data lines added without an expiry annotation FAIL the guard.
 *   4. Allowlist files MUST carry an `# Expiry-policy: per-entry` header
 *      block (added by retrofit-allowlist-expiry.ts).
 *
 * Renewal: when target close-by passes:
 *   - Preferred: drain the entry (close the cascade BUG → remove the line)
 *   - Alternative: extend the expiry date with operator authorization
 *
 * Usage: tsx scripts/guards/check-allowlist-expiry.ts
 *   exit 0 = all entries within expiry; PASS
 *   exit 1 = expired entries OR missing annotations; BLOCK
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ALLOWLIST_DIR = '/Users/drprakashkamath/Projects/Signacare/scripts/guards';
const TODAY = new Date();

interface ExpiryViolation {
  file: string;
  lineNumber: number;
  line: string;
  reason: string;
}

const violations: ExpiryViolation[] = [];
let totalEntries = 0;
let totalExpiringEntries = 0;
let totalPermanentEntries = 0;

const allowlistFiles = readdirSync(ALLOWLIST_DIR)
  .filter((f) => f.endsWith('.allowlist'))
  .map((f) => join(ALLOWLIST_DIR, f));

console.log(`\n=== check-allowlist-expiry (Phase 0a.7) ===\n`);

for (const filePath of allowlistFiles) {
  const fname = filePath.split('/').pop()!;
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let fileHasPolicy = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('Expiry-policy: per-entry')) {
      fileHasPolicy = true;
    }
    // Skip blank / comment lines
    if (line.trim().length === 0) continue;
    if (line.trimStart().startsWith('#')) continue;

    totalEntries++;
    // Check for expires: or permanent: annotation
    const expiresMatch = /\|\s*expires:\s*(\d{4}-\d{2}-\d{2})/i.exec(line);
    const permanentMatch = /\|\s*permanent:/i.test(line);
    const needsReviewMatch = /\|\s*expires:\s*needs-review/i.test(line);

    if (needsReviewMatch) {
      violations.push({
        file: fname,
        lineNumber: i + 1,
        line: line.slice(0, 120) + (line.length > 120 ? '...' : ''),
        reason: 'expires: needs-review — entry needs operator review',
      });
      continue;
    }

    if (!expiresMatch && !permanentMatch) {
      violations.push({
        file: fname,
        lineNumber: i + 1,
        line: line.slice(0, 120) + (line.length > 120 ? '...' : ''),
        reason: 'missing expiry annotation (expected `| expires: YYYY-MM-DD (cascade: BUG-XXX)` OR `| permanent: <reason>`)',
      });
      continue;
    }

    if (permanentMatch) {
      totalPermanentEntries++;
      continue;
    }

    if (expiresMatch) {
      totalExpiringEntries++;
      const expiryDate = new Date(expiresMatch[1]);
      if (Number.isNaN(expiryDate.getTime())) {
        violations.push({
          file: fname,
          lineNumber: i + 1,
          line: line.slice(0, 120) + (line.length > 120 ? '...' : ''),
          reason: `expiry date '${expiresMatch[1]}' not a valid YYYY-MM-DD`,
        });
        continue;
      }
      if (expiryDate < TODAY) {
        violations.push({
          file: fname,
          lineNumber: i + 1,
          line: line.slice(0, 120) + (line.length > 120 ? '...' : ''),
          reason: `expired ${expiresMatch[1]} (today is ${TODAY.toISOString().slice(0, 10)})`,
        });
      }
    }
  }

  if (totalEntries > 0 && !fileHasPolicy) {
    violations.push({
      file: fname,
      lineNumber: 1,
      line: '<file header>',
      reason: 'missing `# Expiry-policy: per-entry` header (run `tsx scripts/guards/lib/retrofit-allowlist-expiry.ts` to add)',
    });
  }
}

console.log(`Allowlist files scanned: ${allowlistFiles.length}`);
console.log(`Total data entries:      ${totalEntries}`);
console.log(`  with expires: date:    ${totalExpiringEntries}`);
console.log(`  with permanent:        ${totalPermanentEntries}`);
console.log(`Violations:              ${violations.length}`);
console.log('');

if (violations.length === 0) {
  console.log('✓ All allowlist entries have valid per-entry expiry annotations.');
  console.log('');
  process.exit(0);
}

console.log(`✗ ${violations.length} violation(s):`);
console.log('');
for (const v of violations.slice(0, 50)) {
  console.log(`  ${v.file}:${v.lineNumber}`);
  console.log(`    Line: ${v.line}`);
  console.log(`    Reason: ${v.reason}`);
  console.log('');
}
if (violations.length > 50) {
  console.log(`  ... and ${violations.length - 50} more violations not shown.`);
}

console.log('');
console.log('Resolution paths:');
console.log('  1. For "expired" entries: drain the cascade BUG (close the entry) OR extend the date with operator authorization.');
console.log('  2. For "missing annotation" entries: run `tsx scripts/guards/lib/retrofit-allowlist-expiry.ts` to retrofit.');
console.log('  3. For "needs-review" entries: examine each + replace with concrete `expires:` or `permanent:` annotation.');
process.exit(1);
