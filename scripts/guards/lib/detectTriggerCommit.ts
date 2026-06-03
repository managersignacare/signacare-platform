/**
 * scripts/guards/lib/detectTriggerCommit.ts
 *
 * BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 (S2) — D1 trigger detection module.
 *
 * Shared logic consumed by the pre-commit hook (mechanical escalation)
 * AND the commit-msg hook (review-attestation enforcement). A commit is
 * a TRIGGER COMMIT if ANY of the three criteria fire:
 *
 *   1. migrations: staged diff contains ≥1 file matching
 *      `apps/api/migrations/*.ts`. Any migration touch should run the
 *      migration-quality 4-guard set (rls-policy + index-discipline +
 *      rollback-discipline + convention) AND require a review-attestation
 *      artifact at commit-msg time.
 *
 *   2. features-3plus: staged diff contains ≥3 files matching
 *      `apps/api/src/features/**\/*.{ts,tsx}`. The cf3f567 failure mode
 *      had 4 features files modified; ≥3 captures multi-feature scope
 *      where mechanical gates are most likely to miss cross-feature
 *      regressions.
 *
 *   3. bug-closure-s012: commit message claims closure of a BUG-XXX
 *      with severity S0, S1, or S2. Closure language matches:
 *        - inline severity tag: `BUG-X (S0|S1|S2)`
 *        - imperative closure verbs: `(fix|fixes|fixing|close|closes|
 *          closing|closed) BUG-X`
 *      Narrative references that DON'T claim closure (e.g. "see BUG-X
 *      for context") are NOT triggers.
 *
 * Phase 1 trigger set is intentionally narrow. Phase 2 expansion to
 * auth-sensitive paths / tenant-boundary tables is deferred to
 * BUG-PRECOMMIT-REVIEW-CHAIN-PHASE-2-AUTH-PATHS (S3) per operator's Q4
 * authorization 2026-05-06.
 *
 * The module is pure (no I/O); the caller passes in stagedFiles +
 * commitMessage. This makes the module trivially testable AND keeps the
 * git-shell-out concerns at the hook-script layer (one well-defined
 * boundary).
 */

export type TriggerKind = 'migrations' | 'features-3plus' | 'bug-closure-s012';

export interface TriggerInputs {
  /**
   * Output of `git diff --cached --name-only` (or equivalent) — the list
   * of files whose state in the index differs from HEAD. Each entry is
   * a repo-relative path (forward slashes).
   */
  stagedFiles: string[];
  /**
   * Full commit message text, exactly as it would land in the commit.
   * Includes subject + body. Empty string is allowed (e.g. for hooks
   * that read the message before the editor has written it).
   */
  commitMessage: string;
}

export interface TriggerResult {
  /** True iff at least one trigger kind fired. */
  triggered: boolean;
  /**
   * The set of trigger kinds that fired, in detection order
   * (migrations → features-3plus → bug-closure-s012). Empty array
   * iff `triggered === false`.
   */
  kinds: TriggerKind[];
}

/**
 * Path matcher for the `migrations` trigger.
 * Any file whose path is exactly `apps/api/migrations/<name>.ts` (no
 * subdirectories — Knex migrations live flat in this directory).
 */
function isMigrationFile(path: string): boolean {
  return /^apps\/api\/migrations\/[^/]+\.ts$/.test(path);
}

/**
 * Path matcher for the `features-3plus` trigger.
 * Any file under `apps/api/src/features/` (any depth) with `.ts` or
 * `.tsx` extension.
 */
function isFeaturesFile(path: string): boolean {
  return /^apps\/api\/src\/features\/.+\.(?:ts|tsx)$/.test(path);
}

/**
 * Threshold for `features-3plus` trigger. ≥3 files is the criterion
 * captured in the BUG row + plan; the constant is exported for tests
 * + future tunability.
 */
export const FEATURES_THRESHOLD = 3;

/**
 * Match for the `bug-closure-s012` trigger.
 *
 * Two distinct shapes count as closure (either is sufficient):
 *
 *   - Severity-tagged: `BUG-XXX (S0)` / `BUG-XXX (S1)` / `BUG-XXX (S2)`
 *     anywhere in the message. Severity tag in parentheses is the
 *     canonical commit-message convention for closure commits per the
 *     last 50+ closure commits in repo history.
 *
 *   - Imperative closure verb followed by BUG-ID: `(fix|fixes|fixing|
 *     close|closes|closing|closed) BUG-XXX`. Captures the conventional-
 *     commits style (`fix(bug-XXX): ...`) and natural-language
 *     ("closes BUG-XXX").
 *
 * Narrative non-closure references like "see BUG-X for context" or
 * "per BUG-X" do NOT match either pattern → NOT a trigger.
 *
 * Word boundary at the BUG- prefix end is enforced via `[A-Z0-9-]+` —
 * the BUG-ID continues until the first non-[A-Z0-9-] character. This
 * correctly tokenises `BUG-EPISODE-MDT-SAVE-RACE` as one ID (not three).
 */
const BUG_ID_PATTERN = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*';
const SEVERITY_TAG_RE = new RegExp(
  `\\bBUG-${BUG_ID_PATTERN}\\s+\\(S[012]\\)`,
);
const CLOSURE_VERB_RE = new RegExp(
  `\\b(?:fix|fixes|fixing|close|closes|closing|closed)\\b[^\\n]*?\\bBUG-${BUG_ID_PATTERN}\\b`,
  'i',
);
const CONV_COMMIT_FIX_RE = new RegExp(
  `^(?:fix|feat)\\(bug-${BUG_ID_PATTERN}\\):`,
  'im',
);

function hasBugClosureLanguage(commitMessage: string): boolean {
  if (commitMessage.length === 0) return false;
  if (SEVERITY_TAG_RE.test(commitMessage)) return true;
  if (CLOSURE_VERB_RE.test(commitMessage)) return true;
  if (CONV_COMMIT_FIX_RE.test(commitMessage)) return true;
  return false;
}

export function detectTriggerCommit(inputs: TriggerInputs): TriggerResult {
  const kinds: TriggerKind[] = [];

  if (inputs.stagedFiles.some(isMigrationFile)) {
    kinds.push('migrations');
  }

  const featuresCount = inputs.stagedFiles.filter(isFeaturesFile).length;
  if (featuresCount >= FEATURES_THRESHOLD) {
    kinds.push('features-3plus');
  }

  if (hasBugClosureLanguage(inputs.commitMessage)) {
    kinds.push('bug-closure-s012');
  }

  return { triggered: kinds.length > 0, kinds };
}

/**
 * Convenience export for hook scripts that want to invoke
 * `git diff --cached --name-only` themselves and just need to wrap.
 * Kept here to centralize the file-list invariant (forward slashes,
 * trim, drop empty lines) so hook callers don't reinvent it.
 */
export function parseStagedFilesOutput(rawGitOutput: string): string[] {
  return rawGitOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
