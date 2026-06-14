#!/usr/bin/env bash
#
# check-fix-registry.sh — verify every entry in docs/fix-registry.md still
# matches (or doesn't match, depending on type) the file it claims to protect.
#
# Run by the `fix-registry-guard` CI job (see .github/workflows/ci.yml).
# Also runnable locally:
#
#   ./.github/scripts/check-fix-registry.sh
#
# Exit codes:
#   0  every entry verified
#   1  one or more entries failed
#   2  registry file missing or unreadable
#
# Format expected in docs/fix-registry.md (the script ignores everything
# outside the first markdown table whose header row contains "Pattern"):
#
#   | ID | File | Type | Pattern | Description |
#   |----|------|------|---------|-------------|
#   | B3a | path/to/file.ts | present | `task_type.*discharge_review` | ... |
#   | SD-FIX1 | other.ts | absent | `m\.deleted_at` | ... |
#   | OLD1 | gone.ts | retired | `whatever` | no longer needed |
#
# Type semantics:
#   present  — pattern must match the file contents
#   absent   — pattern must NOT match the file contents
#   retired  — skipped entirely (kept for historical context)

set -euo pipefail

REGISTRY_FILE="${REGISTRY_FILE:-docs/quality/fix-registry.md}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
OWNED_FILES_FILE="${OWNED_FILES_FILE:-owned-files.txt}"

if [ ! -f "$REGISTRY_FILE" ]; then
  echo "::error::Fix registry file not found at $REGISTRY_FILE"
  exit 2
fi

REGISTRY_FILE="$REGISTRY_FILE" OWNED_FILES_FILE="$OWNED_FILES_FILE" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const registryFile = process.env.REGISTRY_FILE;
const ownedFilesFile = process.env.OWNED_FILES_FILE;

const trim = (value) => value.trim();
const stripBackticks = (value) => value.replace(/^`/, '').replace(/`$/, '');

const registry = fs.readFileSync(registryFile, 'utf8').split(/\r?\n/);
const ownedFiles = fs.existsSync(ownedFilesFile)
  ? new Set(
      fs
        .readFileSync(ownedFilesFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
  : null;

let checked = 0;
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const fileCache = new Map();

let inTable = false;
let headerSeen = false;

function repoOwnsFile(file) {
  if (!ownedFiles) {
    return true;
  }

  return ownedFiles.has(file);
}

function getFileContents(file) {
  if (!fileCache.has(file)) {
    fileCache.set(file, fs.readFileSync(file, 'utf8'));
  }

  return fileCache.get(file);
}

function normalizePattern(pattern) {
  return pattern
    .replace(/\[\[:space:\]\]/g, '\\s')
    .replace(/\[\[:digit:\]\]/g, '\\d')
    .replace(/\[\[:alpha:\]\]/g, '[A-Za-z]')
    .replace(/\[\[:alnum:\]\]/g, '[A-Za-z0-9]');
}

function matchesPattern(pattern, contents) {
  try {
    return new RegExp(normalizePattern(pattern), 'm').test(contents);
  } catch {
    // Preserve the historical guard behavior: invalid legacy patterns are
    // treated as non-matches rather than crashing the verification run.
    return false;
  }
}

for (const line of registry) {
  if (line.includes('| ID ') && line.includes('| Pattern ')) {
    inTable = true;
    headerSeen = true;
    continue;
  }

  if (inTable && /^\|[ ]*-+/.test(line)) {
    continue;
  }

  if (inTable && !line.startsWith('|')) {
    inTable = false;
    continue;
  }

  if (!inTable || !line.startsWith('|')) {
    continue;
  }

  const fields = line.split('|');
  if (fields.length < 5) {
    continue;
  }

  const id = trim(fields[1] ?? '');
  const file = trim(fields[2] ?? '');
  const type = trim(fields[3] ?? '');
  const pattern = stripBackticks(trim(fields[4] ?? ''));

  if (type === 'retired') {
    skipped += 1;
    continue;
  }

  if (!id || !file || !pattern) {
    continue;
  }

  if (type !== 'present' && type !== 'absent') {
    failures.push(`INVALID TYPE [${id}]: type=${type} (expected present|absent|retired)`);
    failed += 1;
    checked += 1;
    continue;
  }

  if (!repoOwnsFile(file)) {
    skipped += 1;
    continue;
  }

  if (!fs.existsSync(file)) {
    failures.push(`MISSING FILE [${id}]: ${file} does not exist (pattern: ${pattern})`);
    failed += 1;
    checked += 1;
    continue;
  }

  checked += 1;
  const contents = getFileContents(file);
  const matched = matchesPattern(pattern, contents);

  if (type === 'present') {
    if (matched) {
      passed += 1;
    } else {
      failures.push(`MISSING [${id}]: ${file} no longer matches /${pattern}/`);
      failed += 1;
    }
    continue;
  }

  if (!matched) {
    passed += 1;
  } else {
    failures.push(`FORBIDDEN [${id}]: ${file} unexpectedly matches /${pattern}/`);
    failed += 1;
  }
}

if (!headerSeen) {
  console.error(`::error::No registry table found in ${registryFile} (expected a markdown table with an 'ID' and 'Pattern' header)`);
  process.exit(2);
}

console.log('');
console.log('Fix Registry Guard');
console.log(`  registry: ${registryFile}`);
console.log(`  checked:  ${checked}`);
console.log(`  passed:   ${passed}`);
console.log(`  failed:   ${failed}`);
console.log(`  skipped:  ${skipped} (retired)`);
console.log('');

if (failed > 0) {
  console.error(`::error::${failed} fix-registry entries failed verification:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error('');
  console.error('These failures mean a previously-verified fix has been silently undone.');
  console.error(`Read the row in ${registryFile} for context, then either:`);
  console.error('  1. Re-apply the fix in your branch, OR');
  console.error("  2. If the fix is genuinely no longer needed, change its 'type' to 'retired' in the registry.");
  process.exit(1);
}

console.log('All fix-registry entries verified.');
NODE
