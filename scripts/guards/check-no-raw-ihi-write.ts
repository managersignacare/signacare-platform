/**
 * BUG-A5.0 — CI guard: refuse non-canonical writes to `patients.ihi_number`.
 *
 * Why: AHPRA ADHA-A5.0 requires Luhn validation at every write boundary
 * for IHI. Pre-fix the Zod schema in `packages/shared/src/patient.schemas.ts`
 * had no `.refine()` so any 16-char string could be written via
 * patientService.create / update. The schema is now gated. This guard
 * locks the discipline at the structural level: any NEW raw write to
 * `ihi_number` outside the canonical write path is REJECTed at CI.
 *
 * Detection:
 *   1. Walk apps/api/src/**\/*.ts (skip migrations, dist, tests)
 *   2. Find every `\.(insert|update)\s*\(\s*\{[^}]*ihi_number:` opener
 *   3. Allow `ihi_number: null` (legitimate anonymisation /
 *      clearing — anonymisePatientService writes null on retention purge)
 *   4. Allow the canonical patientService.ts + patientRepository.ts files
 *      (these are the gated path)
 *   5. REJECT all other non-null writes
 *
 * Inline `// @ihi-write-exempt: <reason>` opt-out for legitimate
 * unforeseen cases (REQUIRES non-empty reason).
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every ihi_number write is canonical or null
 *   1 — one or more non-canonical raw writes detected
 *   2 — schema-snapshot.json malformed (defensive — keeps guard family consistent)
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
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-no-raw-ihi-write.allowlist');

// Canonical write path — patient service + repository own the
// Zod-validated write. anonymisePatientService writes `ihi_number: null`
// only (legitimate clear) which is also allowed.
const CANONICAL_WRITE_PATHS = [
  'features/patients/patientService.ts',
  'features/patients/patientRepository.ts',
] as const;

export interface Violation {
  file: string;
  lineNo: number;
  preview: string;
}

interface ScanCounts {
  validatedSites: number;
  skippedExempt: number;
  skippedCanonical: number;
  skippedNullClear: number;
  filesScanned: number;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@ihi-write-exempt:\s*\S/);
}

const IHI_WRITE_RE = /\.(?:insert|update)\s*\(\s*\{/g;

/**
 * Walk balanced braces from openerIdx (pointing at `{`) to find the
 * matching close. Returns the body content as a string.
 */
function extractObjectBody(source: string, bodyStart: number): { body: string; bodyEnd: number } | null {
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
  return { body: source.slice(bodyStart + 1, i - 1), bodyEnd: i - 1 };
}

function checkFile(
  file: string,
  rawSource: string,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const isCanonical = CANONICAL_WRITE_PATHS.some((p) => relFile.endsWith(p));
  const source = stripCommentsAndStringsPreservingLayout(rawSource);
  const lineOffsets = buildLineOffsets(source);
  const lines = rawSource.split('\n');

  const re = new RegExp(IHI_WRITE_RE.source, 'g');
  let m: RegExpExecArray | null;
  let foundAny = false;
  while ((m = re.exec(source)) !== null) {
    // Find the `{` (which is the last char of the opener match).
    const bodyStart = m.index + m[0].length - 1;
    const block = extractObjectBody(source, bodyStart);
    if (!block) continue;
    if (!/\bihi_number\s*:/.test(block.body)) continue;

    foundAny = true;
    const lineNo = lineNoOfIndex(lineOffsets, m.index);
    if (hasInlineExemption(rawSource, lineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    if (isCanonical) {
      counts.skippedCanonical++;
      counts.validatedSites++;
      continue;
    }

    // Allow `ihi_number: null` (legitimate anonymisation / clearing).
    // Match `ihi_number:` followed by optional whitespace then `null` —
    // word-boundary handles trailing comma / closing brace / EOL / EOF.
    if (/\bihi_number\s*:\s*null\b/.test(block.body)) {
      counts.skippedNullClear++;
      counts.validatedSites++;
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
      counts: { validatedSites: 0, skippedExempt: 0, skippedCanonical: 0, skippedNullClear: 0, filesScanned: 0 },
      filesScanned: 0, allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = walkTsFiles(scanRoot, [], {
    excludeDirs: ['node_modules', 'dist', '__tests__', 'tests', 'build', 'migrations'],
  });
  const counts: ScanCounts = {
    validatedSites: 0, skippedExempt: 0, skippedCanonical: 0, skippedNullClear: 0, filesScanned: 0,
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
  console.log('→ check-no-raw-ihi-write (BUG-A5.0; AHPRA ADHA-A5.0)');
  // eslint-disable-next-line no-console
  console.log(`  scan root:           ${relative(ROOT, DEFAULT_SCAN_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:           ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  files with writes:   ${result.counts.filesScanned}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated sites:     ${result.counts.validatedSites}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:      ${result.counts.skippedExempt}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped canonical:   ${result.counts.skippedCanonical}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped null-clear:  ${result.counts.skippedNullClear}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every ihi_number write is canonical (gated by Luhn-refined Zod) or a legitimate null clear.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} non-canonical ihi_number write(s):\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: route the IHI write through `patientService.create` / `update` (which Zod-validate via `CreatePatientSchema.ihi.refine(isValidIhi)` per BUG-A5.0). For legitimate null-clear flows (anonymisation), the write must be `ihi_number: null` literally. Exemption: `// @ihi-write-exempt: <reason>` directly above the write call (REQUIRES non-empty reason).',
  );
  process.exit(1);
}

if (require.main === module) main();
