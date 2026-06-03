#!/usr/bin/env tsx
/**
 * scripts/guards/check-review-attestation.ts
 *
 * BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 (S2) — D4 commit-msg attestation guard.
 *
 * Reads the staged-snapshot + commit message about to land. If the commit
 * is a TRIGGER COMMIT (per scripts/guards/lib/detectTriggerCommit.ts),
 * verifies that `.git/signacare-review-attestation.json` exists, has the
 * correct schema, binds to the current `git write-tree`, and contains
 * required reviewer verdicts. If the commit is NOT a trigger commit, the
 * guard PASSes immediately (artifact not required).
 *
 * The full schema + production workflow are documented at
 * `docs/quality/review-attestation-format.md`.
 *
 * Exit codes:
 *   0 — clean (artifact valid, OR commit is not a trigger commit)
 *   1 — violations found (missing artifact, stale tree-hash, missing
 *       reviewer, etc.)
 *   2 — usage error (cannot run `git write-tree`, malformed input)
 *
 * Usage:
 *   tsx scripts/guards/check-review-attestation.ts                  # local commit-msg hook
 *   tsx scripts/guards/check-review-attestation.ts --commit-msg <path>  # explicit path
 *
 * Programmatic API (re-exported for unit tests):
 *   verifyAttestation(input: VerifyInputs): VerifyResult
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { REPO_ROOT } from './lib/repoRoot';
import { detectTriggerCommit, parseStagedFilesOutput, type TriggerKind } from './lib/detectTriggerCommit';
import { L4_HEURISTIC_FEATURE_RE } from './lib/l4ClinicalFeatures';

const ARTIFACT_PATH = path.join(REPO_ROOT, '.git', 'signacare-review-attestation.json');
const SUPPORTED_SCHEMA_VERSION = 1;

const REQUIRED_REVIEWERS_ALWAYS = [
  'confidence-label-enforcer',
  'shortcut-detector',
  'gold-standard-enforcer',
  'dod-completion-checker',
  'L3',
  'L5',
] as const;

// Conservative L4-required heuristic for commit-msg verification (the
// AGENT's rubric in `feedback_l4_subject_matter_test.md` is the canonical
// authority — this hook heuristic is a safety net). If staged diff
// touches any clinical-data feature directory, L4 is required.
//
// L5 cycle-1 absorb Drift A (2026-05-06): the regex + feature list are
// now imported from `./lib/l4ClinicalFeatures.ts` — the single source of
// truth. The previous inline list had drifted from the spec doc (23 vs
// 20 entries); the SSoT module + format-doc parity test prevents recurrence.

export interface VerifyInputs {
  /** Staged-files list, output of `git diff --cached --name-only`. */
  stagedFiles: string[];
  /** Full commit message text. */
  commitMessage: string;
  /** Current `git write-tree` output (40-char hex). */
  currentTreeHash: string;
  /** Raw artifact JSON contents (or null if absent). */
  artifactRaw: string | null;
}

export interface VerifyResult {
  pass: boolean;
  /** Human-readable reason if pass=false; empty string if pass=true. */
  reason: string;
  /** Trigger kinds detected on the about-to-be-committed state. */
  triggerKinds: TriggerKind[];
}

interface ReviewerEntry {
  verdict: 'PASS' | 'PARTIAL' | 'BLOCK' | 'N/A';
  cycle?: number;
  absorbedFrom?: 'PARTIAL' | 'BLOCK';
  rationale?: string;
}

interface ArtifactV1 {
  version: number;
  treeHash: string;
  createdAt: string;
  triggerKind: string[];
  reviewers: Record<string, ReviewerEntry>;
}

export function verifyAttestation(input: VerifyInputs): VerifyResult {
  // Step 1: Trigger detection on the about-to-be-committed state.
  const triggerResult = detectTriggerCommit({
    stagedFiles: input.stagedFiles,
    commitMessage: input.commitMessage,
  });

  if (!triggerResult.triggered) {
    return { pass: true, reason: '', triggerKinds: [] };
  }

  // Step 2: Artifact must be present.
  if (input.artifactRaw === null) {
    return {
      pass: false,
      reason:
        `Trigger commit detected (kinds: ${triggerResult.kinds.join(', ')}) ` +
        `but no review-attestation artifact present at ` +
        `.git/signacare-review-attestation.json. Run the reviewer chain ` +
        `first; see docs/quality/review-attestation-format.md for workflow.`,
      triggerKinds: triggerResult.kinds,
    };
  }

  // Step 3: Schema valid + parseable.
  let artifact: ArtifactV1;
  try {
    artifact = JSON.parse(input.artifactRaw) as ArtifactV1;
  } catch (err) {
    return {
      pass: false,
      reason: `review-attestation artifact JSON is malformed: ${(err as Error).message}`,
      triggerKinds: triggerResult.kinds,
    };
  }

  // Step 4: Schema version supported.
  if (typeof artifact.version !== 'number' || artifact.version !== SUPPORTED_SCHEMA_VERSION) {
    return {
      pass: false,
      reason:
        `review-attestation artifact version=${artifact.version} not supported ` +
        `(expected v${SUPPORTED_SCHEMA_VERSION}). See ` +
        `docs/quality/review-attestation-format.md schema-migration policy.`,
      triggerKinds: triggerResult.kinds,
    };
  }

  // Required top-level fields.
  for (const field of ['treeHash', 'createdAt', 'triggerKind', 'reviewers'] as const) {
    if (!(field in artifact)) {
      return {
        pass: false,
        reason: `review-attestation artifact missing required field: ${field}`,
        triggerKinds: triggerResult.kinds,
      };
    }
  }

  // Step 5: Tree-hash matches.
  if (artifact.treeHash !== input.currentTreeHash) {
    const arPrefix = artifact.treeHash.slice(0, 12);
    const curPrefix = input.currentTreeHash.slice(0, 12);
    return {
      pass: false,
      reason:
        `review-attestation artifact is for a different staged snapshot ` +
        `(artifact: ${arPrefix}…; current: ${curPrefix}…). Re-run reviewer ` +
        `chain on the current diff and rewrite the artifact.`,
      triggerKinds: triggerResult.kinds,
    };
  }

  // Step 6: Required-always reviewers all present + verdict enum-valid.
  // L3 cycle-1 absorb #1 (2026-05-06): the spec at
  // docs/quality/review-attestation-format.md (verdict semantics section)
  // defines verdict as a closed enum. Without enum validation an arbitrary
  // string ("WHATEVER", "OK", a typo "PASs") would silently pass — breaking
  // the spec's structural guarantee on this load-bearing guard.
  if (artifact.reviewers === null || typeof artifact.reviewers !== 'object' || Array.isArray(artifact.reviewers)) {
    return {
      pass: false,
      reason: `review-attestation artifact 'reviewers' field is null/missing/non-object`,
      triggerKinds: triggerResult.kinds,
    };
  }
  const reviewers = artifact.reviewers;
  const VALID_VERDICTS = new Set(['PASS', 'PARTIAL', 'BLOCK', 'N/A']);
  for (const r of REQUIRED_REVIEWERS_ALWAYS) {
    const entry = reviewers[r];
    if (!entry) {
      return {
        pass: false,
        reason: `review-attestation artifact missing required reviewer: ${r}`,
        triggerKinds: triggerResult.kinds,
      };
    }
    if (!entry.verdict) {
      return {
        pass: false,
        reason: `review-attestation reviewer ${r} entry missing required field: verdict`,
        triggerKinds: triggerResult.kinds,
      };
    }
    if (!VALID_VERDICTS.has(entry.verdict)) {
      return {
        pass: false,
        reason:
          `review-attestation reviewer ${r} verdict='${entry.verdict}' is not in ` +
          `the valid enum {PASS, PARTIAL, BLOCK, N/A} per ` +
          `docs/quality/review-attestation-format.md verdict semantics.`,
        triggerKinds: triggerResult.kinds,
      };
    }
  }

  // Step 7: L4 conditional (heuristic).
  const l4HeuristicFires = input.stagedFiles.some((f) => L4_HEURISTIC_FEATURE_RE.test(f));
  if (l4HeuristicFires) {
    const l4 = reviewers['L4'];
    if (!l4) {
      return {
        pass: false,
        reason:
          `Staged diff touches clinical-data feature path; L4 verdict required ` +
          `but missing from review-attestation artifact. If L4 N/A is correct, ` +
          `add reviewers.L4 = { verdict: 'N/A', rationale: '...' } per ` +
          `docs/quality/review-attestation-format.md.`,
        triggerKinds: triggerResult.kinds,
      };
    }
  }

  // L4 N/A requires non-empty rationale (whether heuristic fires or not —
  // any L4 entry with verdict=N/A must carry rationale per Q5).
  const l4Entry = reviewers['L4'];
  if (l4Entry && l4Entry.verdict === 'N/A') {
    if (!l4Entry.rationale || l4Entry.rationale.trim().length === 0) {
      return {
        pass: false,
        reason:
          `review-attestation L4 verdict='N/A' requires non-empty rationale ` +
          `field per Q5 operator decision 2026-05-06. Free-text rationale ` +
          `describing WHY no clinical-safety subject-matter trigger applies.`,
        triggerKinds: triggerResult.kinds,
      };
    }
  }

  // Step 8: No final BLOCK or PARTIAL verdicts.
  // L3 cycle-1 absorb #2 (2026-05-06): the spec at
  // docs/quality/review-attestation-format.md (verdict semantics section)
  // is explicit — PARTIAL must be absorbed-then-recorded-as-PASS-with-
  // absorbedFrom='PARTIAL'; final PARTIAL violates the spec the same way
  // final BLOCK does. Pre-fix only BLOCK was rejected; cycle-1 caught a
  // mutation gap where verdict='PARTIAL' silently passed as final.
  for (const [reviewer, entry] of Object.entries(reviewers)) {
    if (entry.verdict === 'BLOCK' || entry.verdict === 'PARTIAL') {
      return {
        pass: false,
        reason:
          `review-attestation reviewer ${reviewer} verdict='${entry.verdict}' is ` +
          `not a permitted FINAL verdict. ${entry.verdict} must be absorbed ` +
          `(becomes 'PASS' with absorbedFrom='${entry.verdict}') or scope must ` +
          `change (new artifact for new diff). See ` +
          `docs/quality/review-attestation-format.md verdict semantics.`,
        triggerKinds: triggerResult.kinds,
      };
    }
  }

  return { pass: true, reason: '', triggerKinds: triggerResult.kinds };
}

// CLI entry: parse args, gather inputs, invoke verifyAttestation, exit.
function main(): void {
  // Parse --commit-msg <path> if present (commit-msg hook contract).
  // The hook script invokes us with `--commit-msg "$1"` where $1 is
  // .git/COMMIT_EDITMSG. If absent, default to .git/COMMIT_EDITMSG.
  const args = process.argv.slice(2);
  let commitMsgPath = path.join(REPO_ROOT, '.git', 'COMMIT_EDITMSG');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--commit-msg' && i + 1 < args.length) {
      commitMsgPath = path.resolve(args[i + 1]);
    }
  }

  // Read commit message.
  let commitMessage = '';
  if (existsSync(commitMsgPath)) {
    commitMessage = readFileSync(commitMsgPath, 'utf-8');
  }

  // Read staged-files list via git.
  let stagedFilesRaw = '';
  try {
    stagedFilesRaw = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
  } catch (err) {
    console.error(`check-review-attestation: failed to read staged files: ${(err as Error).message}`);
    process.exit(2);
  }
  const stagedFiles = parseStagedFilesOutput(stagedFilesRaw);

  // Compute current tree-hash.
  let currentTreeHash = '';
  try {
    currentTreeHash = execSync('git write-tree', { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
  } catch (err) {
    console.error(`check-review-attestation: failed to compute git write-tree: ${(err as Error).message}`);
    process.exit(2);
  }

  // Read artifact (or null if absent).
  let artifactRaw: string | null = null;
  if (existsSync(ARTIFACT_PATH)) {
    artifactRaw = readFileSync(ARTIFACT_PATH, 'utf-8');
  }

  // Verify.
  const result = verifyAttestation({
    stagedFiles,
    commitMessage,
    currentTreeHash,
    artifactRaw,
  });

  // Header for log readability (matches existing guard convention).
  console.log('→ check-review-attestation (BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 D4)');
  console.log(`  staged files:     ${stagedFiles.length}`);
  console.log(`  trigger detected: ${result.triggerKinds.length > 0 ? result.triggerKinds.join(', ') : 'no'}`);
  console.log(`  artifact:         ${artifactRaw === null ? 'absent' : 'present'}`);

  if (result.pass) {
    if (result.triggerKinds.length === 0) {
      console.log(`✓ Not a trigger commit; review-attestation artifact not required.`);
    } else {
      console.log(`✓ Review-attestation artifact valid for trigger commit (kinds: ${result.triggerKinds.join(', ')}).`);
    }
    process.exit(0);
  }

  console.error(`✗ ${result.reason}`);
  process.exit(1);
}

// Only run main() if invoked directly (not when imported by tests).
const isDirectInvocation =
  typeof require !== 'undefined' && require.main === module;
if (isDirectInvocation) {
  main();
}

// Re-export ARTIFACT_PATH + SUPPORTED_SCHEMA_VERSION for tests.
export { ARTIFACT_PATH, SUPPORTED_SCHEMA_VERSION };
