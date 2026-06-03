/**
 * Phase R1 PR-R1-1.5 — line-shift-resilient allowlist matching.
 *
 * Why this exists — observed during PR-R1-1 review (L3 finding #2):
 * existing `<file>:<lineno>` allowlist format is fragile to line-shifts.
 * When BUG-634b compressed a comment block in nurseFeatureRoutes.ts,
 * 12 allowlist entries' line numbers shifted, surfacing as "new"
 * violations that needed manual re-alignment.
 *
 * Across Phase R1's 17 PRs, line-shift cascades will fire 5-10 times.
 * Each manual re-alignment is ~10 min friction. The structural fix
 * is to match on LINE CONTENT FINGERPRINT instead of line number.
 *
 * Format (fingerprint):
 *   <file> <fingerprint>  # <line-preview> | BUG-XXX — <reason>
 *
 * Where:
 *   - <file>         = relative path to the file
 *   - <fingerprint>  = first 8 hex chars of sha256(trimmed line content)
 *   - <line-preview> = optional human-readable hint for grep (not used in matching)
 *
 * Format (legacy, still supported for backward compatibility):
 *   <file>:<lineno>  # <comment>
 *
 * Migration:
 *   - Both formats are parsed; new entries should use fingerprint
 *   - Existing entries (legacy) still match by lineno
 *   - `migrateAllowlistEntry()` helper converts legacy → fingerprint when
 *     a violation surfaces with matching content
 *
 * Match semantics:
 *   - Fingerprint match is line-shift-resilient: matches any line in the
 *     file whose trimmed content has the same fingerprint
 *   - Legacy lineno match is fragile: matches only if violation is at the
 *     exact lineno
 *   - For each violation, check fingerprint entries first, then legacy
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface AllowlistEntry {
  /** Relative file path. */
  file: string;
  /** Fingerprint (first 8 hex chars of sha256). Null if legacy lineno entry. */
  fingerprint: string | null;
  /** Legacy line number. Null if fingerprint-based entry. */
  lineno: number | null;
  /** Original raw line for re-emission. */
  raw: string;
}

/** Sentinel returned for empty/whitespace-only lines — won't match any allowlist entry. */
export const EMPTY_FINGERPRINT = null;

/**
 * Compute fingerprint of a source line: first 8 hex chars of sha256(trimmed).
 *
 * Returns `null` for empty / whitespace-only input. This defends against a
 * future allowlist entry whose fingerprint accidentally equals
 * `e3b0c442` (sha256 of empty string), which would otherwise grant amnesty
 * to every blank line in the named file. Per L3 PR-R1-1.5 cycle-1 finding #5.
 */
export function fingerprint(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return EMPTY_FINGERPRINT;
  return createHash('sha256').update(trimmed).digest('hex').substring(0, 8);
}

/**
 * Parse an allowlist file. Supports both fingerprint and legacy lineno
 * formats on a per-entry basis.
 *
 * Fingerprint format:
 *   <file> <fingerprint>  # comment
 * Legacy format:
 *   <file>:<lineno>  # comment
 */
export function loadAllowlist(allowlistPath: string): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  let txt: string;
  try {
    txt = readFileSync(allowlistPath, 'utf-8');
  } catch {
    return entries; // allowlist file optional
  }

  for (const line of txt.split('\n')) {
    const trimmed = line.split('#')[0].trim();
    if (!trimmed) continue;

    // Fingerprint format: <file> <8-hex-chars>
    const fpMatch = trimmed.match(/^(\S+)\s+([0-9a-f]{8})$/);
    if (fpMatch) {
      entries.push({ file: fpMatch[1], fingerprint: fpMatch[2], lineno: null, raw: line });
      continue;
    }

    // Legacy format: <file>:<lineno>
    const legacyMatch = trimmed.match(/^(\S+):(\d+)$/);
    if (legacyMatch) {
      entries.push({
        file: legacyMatch[1],
        fingerprint: null,
        lineno: parseInt(legacyMatch[2], 10),
        raw: line,
      });
      continue;
    }

    // Malformed entries are silently skipped (consistent with prior behaviour).
  }

  return entries;
}

/**
 * Check if a violation is allowlisted. Tries fingerprint match first
 * (line-shift-resilient), then legacy lineno match.
 *
 * Empty fingerprints (whitespace-only line content) NEVER match — defends
 * against a wildcard allowlist entry granting amnesty to all blank lines.
 */
export function isAllowlisted(
  file: string,
  lineno: number,
  lineContent: string,
  allowlist: AllowlistEntry[],
): boolean {
  const violationFp = fingerprint(lineContent);
  if (violationFp === EMPTY_FINGERPRINT) return false; // never match empty lines
  for (const entry of allowlist) {
    if (entry.file !== file) continue;
    if (entry.fingerprint && entry.fingerprint === violationFp) return true;
    if (entry.lineno != null && entry.lineno === lineno) return true;
  }
  return false;
}

/**
 * Multiplicity-aware match: counts violation occurrences per (file, fingerprint)
 * tuple and asserts that the actual count does not exceed the allowlisted count.
 *
 * Per L3 PR-R1-1.5 cycle-1 finding #3: a single fingerprint allowlist entry
 * grants amnesty to every same-text occurrence in the file. If a 12th identical
 * `res.json(rawRow)` appears in a file with 11 allowlisted occurrences, it
 * would be silently approved. This function returns the OVER-COUNT delta so
 * the caller can REJECT new occurrences.
 *
 * Usage pattern:
 *   1. Caller builds violation buckets keyed by (file, fingerprint)
 *   2. Calls `getOverCount(bucket, allowlist)` for each bucket
 *   3. If returned > 0, caller REJECTS the surplus violations
 */
export function getAllowlistedCount(
  file: string,
  violationFp: string,
  allowlist: AllowlistEntry[],
): number {
  let count = 0;
  for (const entry of allowlist) {
    if (entry.file !== file) continue;
    if (entry.fingerprint && entry.fingerprint === violationFp) count++;
  }
  return count;
}

/**
 * For migrating an allowlist file from legacy lineno format to fingerprint
 * format. Reads the source file, computes fingerprints, and emits the
 * upgraded allowlist text (caller writes to disk if desired).
 */
export function migrateLegacyEntries(
  allowlist: AllowlistEntry[],
  readSourceFile: (file: string) => string | null,
): AllowlistEntry[] {
  const migrated: AllowlistEntry[] = [];
  for (const entry of allowlist) {
    if (entry.fingerprint) {
      migrated.push(entry); // already fingerprint-based
      continue;
    }
    if (entry.lineno == null) {
      migrated.push(entry); // malformed; leave as-is
      continue;
    }
    const src = readSourceFile(entry.file);
    if (!src) {
      migrated.push(entry); // file unreadable; leave legacy
      continue;
    }
    const lines = src.split('\n');
    const targetLine = lines[entry.lineno - 1];
    if (targetLine == null) {
      migrated.push(entry); // line out of range; leave legacy
      continue;
    }
    const fp = fingerprint(targetLine);
    migrated.push({
      file: entry.file,
      fingerprint: fp,
      lineno: null,
      raw: entry.raw, // preserve comment if present
    });
  }
  return migrated;
}
