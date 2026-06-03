#!/usr/bin/env bash
# check-atomic-flip.test.sh — BUG-527
#
# Self-contained integration tests for .github/scripts/check-atomic-flip.sh.
# Each case spawns an ephemeral `git init` repo via mktemp, stages the
# scenario, runs the hook, asserts the exit code.
#
# Cases (per BUG-527 plan §5):
#   AF-1: safety-surface only            → exit 1 (RED pre-fix)
#   AF-2: safety-surface + fix-registry  → exit 0
#   AF-3: safety-surface + bugs-remaining → exit 0
#   AF-4: non-safety surface only        → exit 0
#   AF-5: web safety-surface only        → exit 1 (RED pre-fix)
#   AF-6: safety-surface + exemption msg → exit 0
#   AF-7: safety-surface test file only  → exit 0 (test exempt)
#   AF-S1: missing allowlist              → exit 2
#   AF-S2: bogus mode                     → exit 2
#   AF-S3: ci-mode HEAD~1..HEAD violation → exit 1 (RED pre-fix)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOK="$REPO_ROOT/.github/scripts/check-atomic-flip.sh"
ALLOWLIST_SRC="$REPO_ROOT/.github/safety-surfaces.txt"

PASS=0
FAIL=0

# ── helpers ────────────────────────────────────────────────────────────

# setup_repo <dir> [--with-allowlist | --no-allowlist]
# Initialises a git repo in <dir>, copies the hook + allowlist (unless
# --no-allowlist), creates a baseline commit on main.
setup_repo() {
  local dir="$1"
  local with_allowlist="${2:---with-allowlist}"
  (
    cd "$dir"
    git init -q -b main
    git config user.email test@signacare.test
    git config user.name "BUG-527 Test"
    mkdir -p .github/scripts docs/quality
    cp "$HOOK" .github/scripts/check-atomic-flip.sh
    chmod +x .github/scripts/check-atomic-flip.sh
    if [ "$with_allowlist" = "--with-allowlist" ]; then
      cp "$ALLOWLIST_SRC" .github/safety-surfaces.txt
    fi
    # Baseline commit so HEAD~1 exists for ci-mode tests.
    echo "baseline" >.gitignore
    git add -A
    git commit -q -m "baseline"
  ) || return $?
}

# stage_file <repo> <relative-path> <content>
stage_file() {
  local dir="$1" path="$2" content="$3"
  mkdir -p "$dir/$(dirname "$path")"
  printf '%s\n' "$content" >"$dir/$path"
  ( cd "$dir" && git add -A )
}

# run_case <name> <expected-exit> -- <command> [args...]
# Captures stdout+stderr, asserts exit code.
run_case() {
  local name="$1" expected="$2"
  shift 2
  if [ "${1:-}" = "--" ]; then shift; fi
  local out
  out=$("$@" 2>&1); local ec=$?
  if [ "$ec" = "$expected" ]; then
    PASS=$((PASS + 1))
    echo "OK   $name (exit=$ec)"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL $name (exit=$ec, expected=$expected)"
    printf '%s\n' "$out" | sed 's/^/     /'
  fi
}

# Helper: run the hook from inside repo dir.
run_hook() {
  local dir="$1"
  shift
  ( cd "$dir" && bash .github/scripts/check-atomic-flip.sh "$@" )
}

# ── pre-flight ─────────────────────────────────────────────────────────

if [ ! -x "$HOOK" ] && [ ! -f "$HOOK" ]; then
  # F1 fix per BUG-527 L3 review — exit 2 (pre-condition failure) NOT 0.
  # This test suite IS the L4-checklist anti-silent-catch class; it must
  # not silently pass when its system-under-test is missing. If a future
  # PR deletes the hook, this exit 2 fails CI loudly. The CI workflow
  # also runs the live hook in a second step, but the test layer must
  # not be the silent one.
  echo "::error::check-atomic-flip.test: hook does not exist at $HOOK"
  echo "  Pre-condition for the test suite is broken. If you are bootstrapping"
  echo "  Phase A item 2 (BUG-527), implement the hook + allowlist FIRST,"
  echo "  then run this test suite to verify GREEN."
  exit 2
fi

if [ ! -f "$ALLOWLIST_SRC" ]; then
  echo "::error::check-atomic-flip.test: allowlist does not exist at $ALLOWLIST_SRC"
  echo "  Same fail-loud rule as the missing-hook check above (F1)."
  exit 2
fi

# ── AF-1: safety-surface only → exit 1 ────────────────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
stage_file "$TMP" "apps/api/src/features/auth/authController.ts" "// edit"
run_case "AF-1 safety-surface only" 1 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-2: safety-surface + fix-registry → exit 0 ──────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
stage_file "$TMP" "apps/api/src/features/auth/authController.ts" "// edit"
stage_file "$TMP" "docs/quality/fix-registry.md" "| ROW | ... |"
run_case "AF-2 safety-surface + fix-registry" 0 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-3: safety-surface + bugs-remaining → exit 0 ────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
stage_file "$TMP" "apps/api/src/features/auth/authController.ts" "// edit"
stage_file "$TMP" "docs/quality/bugs-remaining.md" "| BUG-XXX | fixed |"
run_case "AF-3 safety-surface + bugs-remaining" 0 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-4: non-safety surface only → exit 0 ───────────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
stage_file "$TMP" "apps/api/src/db/migrations/20260101_foo.ts" "// edit"
run_case "AF-4 non-safety surface only" 0 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-5: web safety-surface only → exit 1 ───────────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
stage_file "$TMP" "apps/web/src/features/medications/Foo.tsx" "// edit"
run_case "AF-5 web safety-surface only" 1 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-6: safety-surface + exemption directive → exit 0 ───────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
stage_file "$TMP" "apps/api/src/features/auth/authController.ts" "// edit"
# Pre-commit mode reads .git/COMMIT_EDITMSG.
mkdir -p "$TMP/.git"
echo "fix(auth): backport hotfix from prod [skip-atomic-flip: production hotfix backport — full review on next sprint]" >"$TMP/.git/COMMIT_EDITMSG"
run_case "AF-6 safety-surface + exemption directive" 0 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-7: safety-surface test file only → exit 0 ──────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
stage_file "$TMP" "apps/api/src/features/auth/authController.test.ts" "// test edit"
run_case "AF-7 safety-surface test file only" 0 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-S1: missing allowlist → exit 2 ─────────────────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP" --no-allowlist
stage_file "$TMP" "apps/api/src/features/auth/authController.ts" "// edit"
run_case "AF-S1 missing allowlist" 2 -- run_hook "$TMP" pre-commit
rm -rf "$TMP"

# ── AF-S2: bogus mode → exit 2 ────────────────────────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
run_case "AF-S2 bogus mode" 2 -- run_hook "$TMP" nonsense
rm -rf "$TMP"

# ── AF-S3: ci-mode HEAD~1..HEAD violation → exit 1 ────────────────────
TMP=$(mktemp -d)
setup_repo "$TMP"
# Add a commit that touches a safety surface without the catalogue.
(
  cd "$TMP"
  mkdir -p apps/api/src/features/auth
  echo "// edit" >apps/api/src/features/auth/authController.ts
  git add -A
  git commit -q -m "violation: edit safety-surface without atomic flip"
)
run_case "AF-S3 ci-mode safety-surface only" 1 -- run_hook "$TMP" ci
rm -rf "$TMP"

# ── summary ────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────"
echo "check-atomic-flip tests: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
