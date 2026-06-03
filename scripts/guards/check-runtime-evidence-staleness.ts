#!/usr/bin/env tsx
/**
 * scripts/guards/check-runtime-evidence-staleness.ts
 *
 * Phase 0a.10 — staleness guard for the runtime-verification evidence file.
 *
 * Operator's second-monitor concern #1 (2026-05-03): file-correctness for the
 * 4 Layer 0a discipline agents + 5 memory entries is HIGH (mechanical via
 * `check-discipline-files-structural`), but RUNTIME registration + cross-
 * session memory recall are LOW until next session. The repo-tracked
 * evidence file `docs/quality/runtime-verification-evidence.md` captures
 * actual probe verdicts so operator can verify "agents really invoke" + "memory
 * really recalls" — but the evidence rots silently if the underlying agent
 * prompt or memory file changes WITHOUT re-running the probe.
 *
 * This guard recomputes the SHA-256 content hash of every agent/memory file
 * referenced in the evidence file's `content_hash:` rows and FAILS CI if any
 * recorded hash differs from the current file hash. Forcing re-verification
 * when prompts change closes the silent-rot failure mode.
 *
 * The guard is INTENTIONALLY tolerant of `STATUS: PENDING_FRESH_SESSION`
 * rows: those rows still record a content_hash (for staleness detection) but
 * are not expected to have a `last_verified_at` for the current session.
 * Their `runtime_confidence` is recorded as LOW. Stale-on-prompt-change still
 * applies — if the agent prompt changes, even a PENDING row needs its hash
 * field updated when the next operator restart re-runs the probe.
 *
 * Output:
 *   exit 0 — every recorded hash matches current file hash
 *   exit 1 — one or more hashes are stale (re-run probe + update evidence file)
 *   exit 2 — evidence file is malformed or missing
 *
 * Run: tsx scripts/guards/check-runtime-evidence-staleness.ts
 *      OR npm run guard:runtime-evidence-staleness
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { REPO_ROOT } from './lib/repoRoot';

// Phase 0a.11 absorb of L5 0a.10 advisory #1: REPO_ROOT now imported from
// `./lib/repoRoot` (single source of truth across discipline guards).
const EVIDENCE_FILE = join(REPO_ROOT, 'docs/quality/runtime-verification-evidence.md');

interface ProbeRow {
  probe_id: string; // e.g. "A.1 — shortcut-detector"
  source_file: string; // expanded absolute path
  recorded_hash: string;
  status: 'VERIFIED_THIS_SESSION' | 'PENDING_FRESH_SESSION' | 'UNKNOWN';
  line_number: number;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p.startsWith('/')) return p;
  return join(REPO_ROOT, p);
}

function parseEvidenceFile(content: string): ProbeRow[] {
  const lines = content.split('\n');
  const rows: ProbeRow[] = [];

  // YAML probe blocks live inside ```yaml ... ``` fences. We track the
  // current ### heading as the probe_id and the per-block `agent_file:` /
  // `memory_file:` / `content_hash:` / `status:` keys.
  let currentProbeId = '';
  let inYaml = false;
  let blockStartLine = 0;
  let blockSourceFile = '';
  let blockHash = '';
  let blockStatus: ProbeRow['status'] = 'UNKNOWN';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current probe heading (### A.1 — shortcut-detector etc.)
    const headingMatch = /^###\s+([A-Z]\.\d+\s*—.+)$/.exec(line);
    if (headingMatch) {
      currentProbeId = headingMatch[1].trim();
      continue;
    }

    if (line.trim() === '```yaml') {
      inYaml = true;
      blockStartLine = i + 1;
      blockSourceFile = '';
      blockHash = '';
      blockStatus = 'UNKNOWN';
      continue;
    }
    if (line.trim() === '```' && inYaml) {
      inYaml = false;
      // Push accumulated row if we have all fields
      if (currentProbeId && blockSourceFile && blockHash) {
        rows.push({
          probe_id: currentProbeId,
          source_file: blockSourceFile,
          recorded_hash: blockHash,
          status: blockStatus,
          line_number: blockStartLine,
        });
      }
      currentProbeId = '';
      continue;
    }
    if (!inYaml) continue;

    const fileMatch = /^\s*(?:agent_file|memory_file):\s*(.+?)\s*$/.exec(line);
    if (fileMatch) {
      blockSourceFile = expandHome(fileMatch[1].trim());
      continue;
    }
    const hashMatch = /^\s*content_hash:\s*([0-9a-f]+)\s*$/.exec(line);
    if (hashMatch) {
      blockHash = hashMatch[1];
      continue;
    }
    const statusMatch = /^\s*status:\s*(VERIFIED_THIS_SESSION|PENDING_FRESH_SESSION)\s*$/.exec(line);
    if (statusMatch) {
      blockStatus = statusMatch[1] as ProbeRow['status'];
      continue;
    }
  }

  return rows;
}

function main(): void {
  console.log('\n→ check-runtime-evidence-staleness (Phase 0a.10)\n');

  if (!existsSync(EVIDENCE_FILE)) {
    console.error(`✗ Evidence file not found: ${EVIDENCE_FILE}`);
    process.exit(2);
  }

  const evidenceContent = readFileSync(EVIDENCE_FILE, 'utf8');
  const rows = parseEvidenceFile(evidenceContent);

  if (rows.length === 0) {
    console.error('✗ No probe rows parsed. Evidence file may be malformed.');
    process.exit(2);
  }

  console.log(`  Evidence file:   ${EVIDENCE_FILE.replace(REPO_ROOT, '<repo>')}`);
  console.log(`  Probes recorded: ${rows.length}`);
  const verified = rows.filter((r) => r.status === 'VERIFIED_THIS_SESSION').length;
  const pending = rows.filter((r) => r.status === 'PENDING_FRESH_SESSION').length;
  console.log(`    VERIFIED_THIS_SESSION: ${verified}`);
  console.log(`    PENDING_FRESH_SESSION: ${pending}`);

  let staleCount = 0;
  let missingCount = 0;
  for (const row of rows) {
    if (!existsSync(row.source_file)) {
      // Memory files at ~/.claude/... may not exist in CI environments.
      // That's not a staleness violation — it's a CI-skip case. Just note it.
      console.log(`  ? probe ${row.probe_id}: source file unreachable in this env (${row.source_file.replace(homedir(), '~')})`);
      missingCount++;
      continue;
    }
    const fileContent = readFileSync(row.source_file, 'utf8');
    const currentHash = sha256(fileContent);
    if (currentHash !== row.recorded_hash) {
      console.error(`  ✗ STALE  ${row.probe_id}`);
      console.error(`           file: ${row.source_file.replace(REPO_ROOT, '<repo>').replace(homedir(), '~')}`);
      console.error(`           recorded: ${row.recorded_hash}`);
      console.error(`           current:  ${currentHash}`);
      console.error(`           (probe needs re-run + evidence update)`);
      staleCount++;
    }
  }

  console.log('');
  if (staleCount === 0 && missingCount === 0) {
    console.log('✓ All evidence file content_hash entries match current file hashes.');
    process.exit(0);
  }
  if (staleCount === 0 && missingCount > 0) {
    console.log(`✓ All reachable evidence file content_hash entries match current file hashes.`);
    console.log(`  (${missingCount} probe source files unreachable in this env — likely ~/.claude memory files in CI).`);
    process.exit(0);
  }
  console.error(`✗ ${staleCount} stale probe(s) found. Re-run probes + update evidence file.`);
  console.error('  Each stale probe means the underlying agent prompt or memory file');
  console.error('  changed but the captured probe verdict has not been re-verified.');
  process.exit(1);
}

// Phase 0a.12 absorb of L5 0a.11 advisory #2: sibling-pattern parity with
// check-discipline-files-structural.ts + check-no-hardcoded-plan-path.ts —
// only run main() when invoked directly, not when imported (e.g., by a
// future test that wants to exercise the parser helpers).
if (require.main === module) {
  main();
}
