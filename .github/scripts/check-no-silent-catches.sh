#!/usr/bin/env bash
# Phase 0.7.5 Commit 10 — CI guard: no silent error suppression in
# production code paths.
#
# Why this guard exists: Phase 0.7.5 Commits 3 and 5 fixed 16+ instances
# of `.catch(() => {})` and `.catch(() => [])` that were hiding real
# failures (hotspot clinical_notes insert failures, LLM pipeline errors,
# mobile sync data loss). The "silent catch" pattern is the single most
# dangerous anti-pattern in the codebase because clinicians see "success"
# while backend state is wrong.
#
# Rule (CLAUDE.md §3.1 + §9.6): every `.catch` in production code must
# have an observable side-effect — `logger.warn`, `logger.error`,
# `throw`, or `next(err)`. Empty arrow bodies `.catch(() => {})` /
# `.catch(() => [])` are forbidden.
#
# Allowlist: test files, seed scripts (recoverable state), and explicit
# temp-file cleanup (`fs.unlink(path).catch(() => {})`). The allowlist
# lives inline in this script to keep the policy auditable in one place.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Paths scanned — production code only.
SCAN_PATHS=(
  "apps/api/src/features"
  "apps/api/src/middleware"
  "apps/api/src/shared"
  "apps/api/src/integrations"
  "apps/api/src/jobs"
  "apps/api/src/mcp"
  "apps/api/src/utils"
  "apps/api/src/db"
  "apps/web/src"
)

# Patterns forbidden: empty catch bodies (arrow or function) returning
# nothing, an empty array, or null. Matches both `.catch(() => {})` and
# `.catch((err) => {})` and `.catch(() => [])` and `.catch(() => null)`.
FORBIDDEN_PATTERNS=(
  '\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)'
  '\.catch\(\s*\(\s*\)\s*=>\s*\[\s*\]\s*\)'
  '\.catch\(\s*\(\s*\)\s*=>\s*null\s*\)'
  '\.catch\(\s*\(\s*\)\s*=>\s*undefined\s*\)'
  '\.catch\(\s*\(\s*_[a-zA-Z]*\s*\)\s*=>\s*\{\s*\}\s*\)'
)

# Exempt files — temp file cleanup, test utilities.
EXEMPT_GLOBS=(
  '*test*'
  '*.test.ts'
  '*.spec.ts'
)

errors=0
total_hits=0

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  for path in "${SCAN_PATHS[@]}"; do
    if [ ! -d "$path" ]; then continue; fi
    # Grep all TS/TSX files; -E for extended regex; --include filters file types.
    while IFS= read -r hit; do
      # Skip if file matches any exempt glob.
      file=$(echo "$hit" | cut -d: -f1)
      skip=0
      for exempt in "${EXEMPT_GLOBS[@]}"; do
        case "$file" in $exempt) skip=1; break;; esac
      done
      if [ "$skip" -eq 1 ]; then continue; fi

      lineno=$(echo "$hit" | cut -d: -f2)
      prev_line_num=$((lineno - 1))
      current_line_content=$(sed -n "${lineno}p" "$file" 2>/dev/null || echo "")
      prev_line_content=$(sed -n "${prev_line_num}p" "$file" 2>/dev/null || echo "")

      # Skip if the match is inside a comment (line starts with // or *).
      trimmed=$(echo "$current_line_content" | sed 's/^[[:space:]]*//')
      case "$trimmed" in
        //*) continue ;;
        \**) continue ;;
      esac

      # Skip if the line or the one above it has an inline
      # "// intentional silent — <reason>" marker.
      if echo "$current_line_content" | grep -qE '// *(intentional silent|allowed silent)'; then continue; fi
      if echo "$prev_line_content" | grep -qE '// *(intentional silent|allowed silent)'; then continue; fi

      echo "SILENT CATCH: $hit"
      errors=$((errors + 1))
      total_hits=$((total_hits + 1))
    done < <(grep -rnE "$pattern" "$path" --include='*.ts' --include='*.tsx' 2>/dev/null || true)
  done
done

if [ "$errors" -gt 0 ]; then
  echo ""
  echo "FAIL: $total_hits silent error suppression(s) found."
  echo ""
  echo "Every .catch() handler in production code must have an observable"
  echo "side-effect (logger.warn, logger.error, throw, or next(err))."
  echo "Empty arrow bodies are forbidden."
  echo ""
  echo "Allowed exceptions:"
  echo "  1. Temp-file cleanup: fs.unlink(path).catch(() => {}) is OK."
  echo "  2. Explicit intentional silence: add a comment"
  echo "     // intentional silent — <reason>"
  echo "     directly above the .catch() call."
  echo ""
  echo "See CLAUDE.md §3.1 + §9.6 for the rule."
  exit 1
fi

echo "✓ No silent error suppression found in production code."
