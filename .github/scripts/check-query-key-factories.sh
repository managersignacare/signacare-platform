#!/usr/bin/env bash
#
# check-query-key-factories.sh — enforce the React Query factory-key rule.
#
# Phase 0.7 PR2 Class F of the multi-specialty plan established a
# gold-standard rule: every feature directory under apps/web/src/features/*
# with mutations/queries must have a queryKeys.ts factory file; every
# `queryKey: [...]` call must use a factory function — no literal string
# arrays.
#
# Why this rule exists: the fix-registry already had MEDS1-10 tracking 10
# individual query-key / invalidation mismatch bugs that shipped to prod.
# Each one was a clinician saying "I saved this, it didn't appear until I
# refreshed." Literal arrays made it trivial to have a mutation invalidate
# a subtly different prefix than the query that displayed the data.
# Phase 0.7 PR2 migrated 670+ literal arrays across 41 features to
# factory functions. This guard ensures no new literals slip in.
#
# Two rules:
#
#   1. Every feature directory containing a `useMutation(` or `useQuery(`
#      call MUST have a `queryKeys.ts` file at the top of the feature dir.
#
#   2. No file under apps/web/src/features/** may contain a literal
#      `queryKey: [` followed by a string literal. The factory file
#      itself is exempt because it declares the tuples, but it is
#      the ONLY exempt location.
#
# This guard runs in CI alongside the other guards. Exit 0 on clean,
# exit 1 on any violation.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

FEATURES_DIR="apps/web/src/features"

if [ ! -d "$FEATURES_DIR" ]; then
  echo "✓ $FEATURES_DIR not found (guard is a no-op)."
  exit 0
fi

declare -i total_violations=0

# ─── Rule 1: every feature with mutations/queries has a queryKeys.ts ─────────
echo "→ Rule 1: every feature with mutations/queries has a queryKeys.ts factory"

# Find every feature dir that has a useMutation or useQuery call anywhere.
# Use a null-delimited feature set so dir names with spaces (unlikely)
# don't blow up.
features_with_queries=$(
  grep -rlE "(useMutation|useQuery)\(" "$FEATURES_DIR" 2>/dev/null \
    | sed -E "s|^${FEATURES_DIR}/([^/]+)/.*|\1|" \
    | sort -u
)

while IFS= read -r feat; do
  [ -z "$feat" ] && continue
  factory="${FEATURES_DIR}/${feat}/queryKeys.ts"
  if [ ! -f "$factory" ]; then
    printf "  ✗ %s — has mutations/queries but no queryKeys.ts factory file\n" "$feat"
    total_violations+=1
  fi
done <<< "$features_with_queries"

# ─── Rule 2: no literal queryKey arrays outside queryKeys.ts files ───────────
echo
echo "→ Rule 2: no literal queryKey arrays in feature or shared source files"

# Literal-array pattern: `queryKey: [` followed by either a single-quoted
# or double-quoted string (i.e. a literal tuple). Spread-based factory calls
# like `queryKey: [...featureKeys.all, ...]` are safe because they start
# with a spread, not a quote.
#
# We match across the features tree AND the shared/ tree (audit M3 —
# the shared widgets under apps/web/src/shared/components/** were
# previously out of scope and accumulated 10 literal arrays; they
# now live in apps/web/src/shared/queryKeys.ts and this scan
# enforces no new ones slip in).
#
# Excludes every queryKeys.ts file (those declare the base tuples)
# and every *.test.ts file (test doubles can use literals).
SHARED_DIR="apps/web/src/shared"
violations=$(
  { grep -rnE "queryKey: \[['\"]" "$FEATURES_DIR" 2>/dev/null; \
    [ -d "$SHARED_DIR" ] && grep -rnE "queryKey: \[['\"]" "$SHARED_DIR" 2>/dev/null; } \
    | grep -v '/queryKeys\.ts:' \
    | grep -vE '\.test\.(ts|tsx):' \
    || true
)

if [ -n "$violations" ]; then
  echo "$violations" | while IFS= read -r line; do
    printf "  ✗ %s\n" "$line"
  done
  violation_count=$(echo "$violations" | wc -l | tr -d ' ')
  total_violations+=$violation_count
fi

echo
if [ "$total_violations" -gt 0 ]; then
  echo "✗ FAIL: $total_violations query-key factory violation(s)."
  echo
  echo "Fix one of:"
  echo "  1. Move the literal key into the feature's queryKeys.ts factory:"
  echo "       export const <feature>Keys = {"
  echo "         all: ['<feature>'] as const,"
  echo "         list: (filters) => [...<feature>Keys.all, 'list', filters] as const,"
  echo "       } as const;"
  echo "     and replace the call site with <feature>Keys.list(filters)."
  echo
  echo "  2. If the feature has no queryKeys.ts yet, create one following"
  echo "     the shape in apps/web/src/features/notifications/queryKeys.ts"
  echo "     (the canonical reference)."
  echo
  echo "See Phase 0.7 PR2 → Class F in the plan, CLAUDE.md §4.1, and"
  echo "docs/fix-registry.md → QKEY for the rationale."
  exit 1
fi

echo "✓ All feature directories have queryKeys.ts factories and use factory keys."
exit 0
