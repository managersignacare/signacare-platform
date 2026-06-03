#!/usr/bin/env bash
#
# check-atomic-flip.sh — BUG-527
#
# Mechanises the atomic-flip discipline from feedback_atomic_catalogue_flip.md:
# every safety-surface fix MUST land with a delta to
# docs/quality/fix-registry.md OR docs/quality/bugs-remaining.md in the
# SAME commit. This guard fails CI (or pre-commit) when the rule is
# violated.
#
# Modes:
#   ci           Compare HEAD~1..HEAD (the latest commit on the PR head).
#                Default when no arg given. Wired into .github/workflows/ci.yml.
#   pre-commit   Compare the staged index (--cached). Opt-in for local dev.
#
# Usage:
#   bash .github/scripts/check-atomic-flip.sh                # ci mode
#   bash .github/scripts/check-atomic-flip.sh ci
#   bash .github/scripts/check-atomic-flip.sh pre-commit
#
# Safety-surface allowlist:
#   .github/safety-surfaces.txt  (one bash-prefix per line; SSoT mirrored
#                                 by docs/quality/l4-reviewer-checklist.md §F)
#
# Exemption directive:
#   Add `[skip-atomic-flip: <reason>]` to the commit message body. The
#   <reason> must be auditable; reviewer culture (L3) enforces quality.
#
# Exit codes:
#   0  no violation (no safety-surface touched, OR catalogue delta present,
#      OR exemption directive in commit message)
#   1  violation (safety-surface touched without catalogue delta)
#   2  pre-condition failure (allowlist missing, unknown mode, not a git repo)

set -uo pipefail

ALLOWLIST="${ALLOWLIST:-.github/safety-surfaces.txt}"
EXEMPTION_REGEX='\[skip-atomic-flip:'

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "::error::check-atomic-flip: not inside a git repository"
  exit 2
fi
cd "$REPO_ROOT"

MODE="${1:-ci}"

# ── 1. Compute changed file list + commit message per mode ───────────
case "$MODE" in
  ci)
    CHANGED="$(git diff --name-only HEAD~1 HEAD 2>/dev/null)"
    if [ -z "$CHANGED" ] && ! git rev-parse HEAD~1 >/dev/null 2>&1; then
      echo "::error::check-atomic-flip: cannot resolve HEAD~1; ensure CI uses fetch-depth: 2"
      exit 2
    fi
    COMMIT_MSG="$(git log -1 --format=%B HEAD 2>/dev/null || echo '')"
    ;;
  pre-commit)
    CHANGED="$(git diff --cached --name-only 2>/dev/null || echo '')"
    if [ -f "$REPO_ROOT/.git/COMMIT_EDITMSG" ]; then
      COMMIT_MSG="$(cat "$REPO_ROOT/.git/COMMIT_EDITMSG")"
    else
      COMMIT_MSG=""
    fi
    ;;
  *)
    echo "::error::check-atomic-flip: unknown mode '$MODE' (expected: ci | pre-commit)"
    exit 2
    ;;
esac

# ── 2. Exemption escape hatch ─────────────────────────────────────────
if printf '%s\n' "$COMMIT_MSG" | grep -Eq "$EXEMPTION_REGEX"; then
  EXEMPTION_LINE="$(printf '%s\n' "$COMMIT_MSG" | grep -Eo '\[skip-atomic-flip:[^]]*\]' | head -1)"
  echo "check-atomic-flip: exemption directive found — skipping"
  echo "  $EXEMPTION_LINE"
  exit 0
fi

# ── 3. Load safety-surface allowlist ──────────────────────────────────
if [ ! -f "$ALLOWLIST" ]; then
  echo "::error::check-atomic-flip: allowlist not found at $ALLOWLIST"
  exit 2
fi

# Read patterns into an array (skip blanks + comments).
PATTERNS=()
while IFS= read -r line; do
  case "$line" in
    ''|\#*) continue ;;
    *) PATTERNS+=("$line") ;;
  esac
done <"$ALLOWLIST"

if [ "${#PATTERNS[@]}" -eq 0 ]; then
  echo "::error::check-atomic-flip: allowlist is empty"
  exit 2
fi

# ── 4. Classify changed files ─────────────────────────────────────────
SAFETY_HITS=()
TEST_HITS=()
while IFS= read -r changed; do
  [ -z "$changed" ] && continue
  for pattern in "${PATTERNS[@]}"; do
    case "$changed" in
      "$pattern"*)
        # Test-file exemption (AF-7): tests under safety surfaces don't
        # require catalogue delta. The L1 test-file guards handle test
        # quality independently.
        case "$changed" in
          *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*/tests/*|*/__tests__/*)
            TEST_HITS+=("$changed")
            ;;
          *)
            SAFETY_HITS+=("$changed")
            ;;
        esac
        break
        ;;
    esac
  done
done <<<"$CHANGED"

# ── 5. No safety-surface non-test files → pass ────────────────────────
if [ "${#SAFETY_HITS[@]}" -eq 0 ]; then
  echo "check-atomic-flip: no safety-surface files in this diff"
  if [ "${#TEST_HITS[@]}" -gt 0 ]; then
    echo "  (${#TEST_HITS[@]} test file(s) on safety surface — exempt per AF-7)"
  fi
  exit 0
fi

# ── 6. Catalogue delta check ──────────────────────────────────────────
HAS_REGISTRY_DELTA=0
HAS_BUGS_DELTA=0
while IFS= read -r changed; do
  case "$changed" in
    docs/quality/fix-registry.md) HAS_REGISTRY_DELTA=1 ;;
    docs/quality/bugs-remaining.md) HAS_BUGS_DELTA=1 ;;
  esac
done <<<"$CHANGED"

if [ "$HAS_REGISTRY_DELTA" -eq 1 ] || [ "$HAS_BUGS_DELTA" -eq 1 ]; then
  echo "check-atomic-flip: safety-surface touched AND catalogue delta present — OK"
  echo "  safety-surface files: ${#SAFETY_HITS[@]}"
  [ "$HAS_REGISTRY_DELTA" -eq 1 ] && echo "  + docs/quality/fix-registry.md"
  [ "$HAS_BUGS_DELTA" -eq 1 ] && echo "  + docs/quality/bugs-remaining.md"
  exit 0
fi

# ── 7. Violation ──────────────────────────────────────────────────────
echo "::error::check-atomic-flip: safety-surface files touched without atomic catalogue flip"
echo
echo "Safety-surface files in this diff:"
for f in "${SAFETY_HITS[@]}"; do
  echo "  - $f"
done
echo
echo "Required: this commit MUST also modify ONE of:"
echo "  - docs/quality/fix-registry.md  (add a fix-registry anchor row)"
echo "  - docs/quality/bugs-remaining.md  (atomic flip BUG row to **fixed**)"
echo
echo "Atomic-flip rule per feedback_atomic_catalogue_flip.md:"
echo "  Every safety-surface fix lands with the bugs-remaining row flip"
echo "  and the fix-registry anchor in the SAME commit (BUG-527 enforces)."
echo
echo "Escape hatch (auditable, reviewer-judgement):"
echo "  Add '[skip-atomic-flip: <reason>]' to the commit message body."
echo "  <reason> must explain why the catalogue delta is genuinely not"
echo "  required (e.g. pure rename, comment-only change, dependency bump"
echo "  test). L3 reviewer audits the reason."
exit 1
