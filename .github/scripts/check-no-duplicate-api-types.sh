#!/bin/bash
#
# check-no-duplicate-api-types.sh — enforce the single-source-of-truth
# rule for API types (Phase 0.7 PR2 Class D / TYPEDUP).
#
# Rule: frontend `apps/web/src/features/*/types/*.ts` files may only
# declare types that are strictly frontend-only (UI state, form field
# types, component prop types). Any type that represents an API request
# or response shape must live in `@signacare/shared` and be imported by
# the frontend.
#
# Why this rule exists: the frontend TaskResponse schema used to declare
# fields `createdByName` / `assignedToName`, but the backend service
# (taskService.mapTask) emitted `createdByStaffName` / `assignedToStaffName`.
# Every task card in the app silently rendered `undefined` for the
# "created by" and "assigned to" columns for months because the two
# sides disagreed on the shape. Phase 0.7 PR2 Class D turned this into
# a CI-enforced rule so the 46 other known drifted types get fixed
# one by one, and no new drift can slip in.
#
# How the guard works:
#
#   1. Build a set of type/interface NAMES exported from
#      packages/shared/src/**/*.ts.
#
#   2. Build a set of type/interface NAMES exported from
#      apps/web/src/features/*/types/*.ts.
#
#   3. Intersect them. Any collision is a potential violation.
#
#   4. A collision is EXEMPT if its name appears in
#      .github/scripts/duplicate-api-types.allowlist — that file is
#      the Phase 0.7 PR2 grandfather list of 46 pre-existing duplicates
#      that will be fixed one by one under TYPEDUP:<TypeName> follow-up PRs.
#
#   5. Any collision NOT in the allowlist fails CI with a clear error.
#
# Adding NEW entries to the allowlist is forbidden by policy — the only
# direction is shrinkage. When you fix a duplicate (delete the frontend
# declaration and import from shared), remove its name from the
# allowlist and add a TYPEDUP:<TypeName> fix-registry row.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

SHARED_DIR="packages/shared/src"
FRONTEND_TYPES_GLOB="apps/web/src/features/*/types/*.ts"
ALLOWLIST=".github/scripts/duplicate-api-types.allowlist"

if [ ! -d "$SHARED_DIR" ]; then
  echo "✓ $SHARED_DIR not found (guard is a no-op)."
  exit 0
fi

# ─── Extract type names from shared ──────────────────────────────────────────
shared_types=$(
  grep -rhE "^export (type|interface) [A-Za-z_][A-Za-z0-9_]*" "$SHARED_DIR" 2>/dev/null \
    | sed -E 's/^export (type|interface) ([A-Za-z_][A-Za-z0-9_]*).*/\2/' \
    | sort -u
)

# ─── Extract type names from frontend features/*/types/ ────────────────────
frontend_types=$(
  for f in $FRONTEND_TYPES_GLOB; do
    [ -f "$f" ] || continue
    grep -hE "^export (type|interface) [A-Za-z_][A-Za-z0-9_]*" "$f" 2>/dev/null \
      | sed -E 's/^export (type|interface) ([A-Za-z_][A-Za-z0-9_]*).*/\2/'
  done | sort -u
)

# ─── Intersect ─────────────────────────────────────────────────────────────
collisions=$(comm -12 <(echo "$shared_types") <(echo "$frontend_types"))

if [ -z "$collisions" ]; then
  echo "✓ No duplicate API types between @signacare/shared and frontend types/*.ts."
  exit 0
fi

# ─── Load allowlist into a file-based lookup (bash 3.2 compatible) ──────────
# macOS ships bash 3.2 which has no associative arrays. Use a sorted file
# and `grep -Fx` per lookup instead.
ALLOWED_NAMES=$(mktemp)
trap 'rm -f "$ALLOWED_NAMES"' EXIT

if [ -f "$ALLOWLIST" ]; then
  grep -Ev '^#|^$' "$ALLOWLIST" | sort -u > "$ALLOWED_NAMES"
fi

echo "→ Checking for duplicate API types between @signacare/shared and frontend types/*.ts"
echo

total_violations=0
allowlisted=0

while IFS= read -r type_name; do
  [ -z "$type_name" ] && continue
  if grep -Fxq "$type_name" "$ALLOWED_NAMES" 2>/dev/null; then
    allowlisted=$((allowlisted + 1))
  else
    # Find where the collision lives for a clear error message
    fe_file=$(grep -rlE "^export (type|interface) ${type_name}( |=|$|<)" $FRONTEND_TYPES_GLOB 2>/dev/null | head -1)
    printf "  ✗ %s — declared in %s but already exported from @signacare/shared\n" "$type_name" "${fe_file:-<unknown>}"
    total_violations=$((total_violations + 1))
  fi
done <<< "$collisions"

echo
if [ "$allowlisted" -gt 0 ]; then
  echo "  (grandfather list: $allowlisted pre-existing duplicates tracked in $ALLOWLIST)"
fi

if [ "$total_violations" -gt 0 ]; then
  echo
  echo "✗ FAIL: $total_violations duplicate API type(s) not on the grandfather list."
  echo
  echo "Fix one of:"
  echo "  1. Delete the frontend declaration and import from @signacare/shared:"
  echo "       import type { X } from '@signacare/shared';"
  echo
  echo "  2. If the type is genuinely frontend-only (UI state / form field /"
  echo "     component prop), rename it to avoid the collision with the shared"
  echo "     API type."
  echo
  echo "Do NOT add the new type to $ALLOWLIST — that grandfather list only"
  echo "accepts removals, not additions."
  echo
  echo "See Phase 0.7 PR2 → Class D in the plan, CLAUDE.md, and"
  echo "docs/fix-registry.md → TYPEDUP for the rationale."
  exit 1
fi

echo "✓ All non-allowlisted API types are owned by @signacare/shared."
exit 0
