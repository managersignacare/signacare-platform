#!/usr/bin/env bash
#
# check-mounted-routes-have-callers.sh — enforce the dead-mount rule.
#
# Phase 0.7 PR2 of the multi-specialty plan (see
# /Users/.../plans/sleepy-roaming-meteor.md Phase 0.7 PR2 → Class B)
# established a gold-standard rule: every router mounted in
# apps/api/src/server.ts must satisfy ONE of the following:
#
#   (a) Have at least one caller in a tracked client — verified by a
#       grep of the route prefix against apps/web/src, apps/mobile/lib,
#       apps/patient-app/lib, apps/api/src/jobs, .../middleware,
#       .../integrations, apps/api/tests; OR
#
#   (b) Have an explicit `@admin-only` JSDoc sentinel at the top of the
#       routes file PLUS a corresponding entry in docs/admin-routes.md
#       documenting the operator workflow with curl examples.
#
# This guard parses every `app.use(\`${API}/<path>\`, <router>)` line in
# server.ts and verifies the rule. It runs in CI alongside the other
# four guards. Exit code 0 on clean, 1 on any violation.
#
# Why this rule exists: a previous audit (2026-04-15) flagged 13+ routers
# as "dead mounts" and the user pushed back saying the codebase needs a
# durable rule, not a one-shot cleanup. Phase 0.7 PR2 verified two real
# dead mounts (reallocations, webhooks-admin), marked them @admin-only
# with rationale, and added this guard so a future contributor cannot
# silently mount an unexercised route again.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

SERVER_TS="apps/api/src/server.ts"
ADMIN_DOCS="docs/archive/older-reports/admin-routes.md"

if [ ! -f "$SERVER_TS" ]; then
  echo "✗ FAIL: $SERVER_TS not found"
  exit 1
fi

declare -i total_violations=0

# ─── Extract every mounted prefix + router name ───────────────────────────────
#
# Matches lines like:
#   app.use(`${API}/calendar`, calendarRoutes);
#   app.use(`${API}/webhooks-admin`, webhookAdminRouter);
#
# Captures: route prefix (e.g. "calendar") and router identifier.

TAB=$'\t'
mounts=$(
  grep -E 'app\.use\(`\$\{API\}/[a-zA-Z0-9_-]+`' "$SERVER_TS" \
    | sed -E "s|.*\\\$\\{API\\}/([a-zA-Z0-9_-]+)\`,[[:space:]]*([a-zA-Z0-9_]+).*|\\1${TAB}\\2|" \
    | sort -u
)

if [ -z "$mounts" ]; then
  echo "✓ No mounted routes found (or pattern did not match) — guard is a no-op."
  exit 0
fi

echo "→ Verifying mounted routes have a caller OR an @admin-only sentinel"
echo

# Tracked-client search paths (callers must come from one of these).
declare -a CLIENT_PATHS=(
  "apps/web/src"
  "apps/mobile/lib"
  "apps/patient-app/lib"
  "apps/api/src/jobs"
  "apps/api/src/middleware"
  "apps/api/src/integrations"
  "apps/api/tests"
)

while IFS=$'\t' read -r prefix router_name; do
  [ -z "$prefix" ] && continue

  # Resolve the routes file via the router import statement in server.ts.
  # Lines look like: `import foo from './features/bar/barRoutes';` so we
  # find the import line whose binding matches the router_name and extract
  # the relative path. This avoids fragile `git ls-files **` globs.
  # Match either default-import `import foo from`, named-import
  # `import { foo }`, or mixed `import bar, { foo }`.
  routes_rel=$(
    grep -E "^import[[:space:]].*(\\{[^}]*[[:space:],]?${router_name}[[:space:],}]|^import[[:space:]]+${router_name}[[:space:],])" "$SERVER_TS" \
      | sed -E "s|.*from[[:space:]]+['\"]\\./([^'\"]+)['\"].*|\\1|" \
      | head -1
  )
  # Fallback: simple substring match on the router_name.
  if [ -z "$routes_rel" ]; then
    routes_rel=$(
      grep -E "^import[[:space:]].*${router_name}" "$SERVER_TS" \
        | sed -E "s|.*from[[:space:]]+['\"]\\./([^'\"]+)['\"].*|\\1|" \
        | head -1
    )
  fi
  if [ -n "$routes_rel" ]; then
    routes_file="apps/api/src/${routes_rel}.ts"
    [ ! -f "$routes_file" ] && routes_file=""
  else
    routes_file=""
  fi

  # ── Caller check ────────────────────────────────────────────────────────────
  # Search every client path for the route prefix as part of an apiClient
  # or fetch call. The pattern matches:
  #   apiClient.instance.<verb>('<prefix>/...
  #   .post(`<prefix>/...
  #   "/${prefix}/..."  (rare)
  caller_hits=0
  for cp in "${CLIENT_PATHS[@]}"; do
    [ ! -d "$cp" ] && continue
    if grep -rqE "(['\"\`])(/?api/v[0-9]+/)?${prefix}([/\"\`'?])" "$cp" 2>/dev/null; then
      caller_hits=1
      break
    fi
  done

  if [ "$caller_hits" -eq 1 ]; then
    printf "  ✓ %-32s caller found\n" "$prefix"
    continue
  fi

  # ── @admin-only sentinel check ──────────────────────────────────────────────
  if [ -n "$routes_file" ] && grep -q '@admin-only' "$routes_file"; then
    # Sentinel present; also require a docs/admin-routes.md entry that
    # mentions the prefix.
    if [ -f "$ADMIN_DOCS" ] && grep -q "/${prefix}" "$ADMIN_DOCS"; then
      printf "  ✓ %-32s @admin-only + docs entry\n" "$prefix"
      continue
    else
      printf "  ✗ %-32s @admin-only sentinel present but no docs/admin-routes.md entry\n" "$prefix"
      total_violations+=1
      continue
    fi
  fi

  printf "  ✗ %-32s NO caller and NO @admin-only sentinel\n" "$prefix"
  total_violations+=1
done <<< "$mounts"

echo
if [ "$total_violations" -gt 0 ]; then
  echo "✗ FAIL: $total_violations mounted route(s) without a caller or sentinel."
  echo
  echo "Fix one of:"
  echo "  1. Wire the route to a frontend/worker caller, OR"
  echo "  2. Add an /** @admin-only — rationale */ JSDoc block at the top of"
  echo "     the routes file AND add a corresponding section to docs/admin-routes.md"
  echo "     with curl examples, OR"
  echo "  3. Delete the route mount + the routes file if it is genuinely dead."
  echo
  echo "See Phase 0.7 PR2 → Class B in the plan, and docs/fix-registry.md →"
  echo "DEAD-MOUNT for the rationale."
  exit 1
fi

echo "✓ All mounted routes have a caller or a documented @admin-only sentinel."
exit 0
