#!/usr/bin/env bash
# BUG-032 L3 review — CI guard that rejects the exact anti-pattern this
# fix ships against. Any probe spec re-introducing `beforeEach(...loginAs...)`
# would recreate the ~50-logins-per-suite session-cap + rate-limiter thrash.
#
# Allowed only in:
#   e2e/01-auth.spec.ts — literally tests the login UI flow
#   e2e/probes/storage-state-smoke.spec.ts — doesn't actually call loginAs
#
# Why not an L1 AST check: Playwright test-infra files aren't inside the
# scripts/qa-agent/level-1-static.ts file discovery (which targets
# apps/{api,web}/src). A grep guard here at the merge gate is the lightest
# correct enforcement.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Scan probe specs for `beforeEach(...) => { ... loginAs(...) ... }`.
# Match `loginAs(` (the function call) within the 3 lines following a
# `beforeEach` keyword that is NOT inside a comment. Comments mentioning
# loginAs or beforeEach are intentional doc strings and must not trip
# the guard. Scope is e2e/probes/ only — e2e/accessibility/ and other
# suites are out of BUG-032's remediation scope and are tracked
# separately.
violations=$(git grep -l -E 'test\.beforeEach' -- 'e2e/probes/' 2>/dev/null | while read -r f; do
  # Strip single-line // comments so beforeEach-in-comment never matches.
  # Extract 3 lines after each real `test.beforeEach(` call; look for a
  # real `loginAs(` call in that window.
  awk '
    /\/\/.*beforeEach|\/\*.*beforeEach|\*.*beforeEach/ { next }
    /test\.beforeEach\(/ { capture = 3; print; next }
    capture > 0 { print; capture-- }
  ' "$f" | grep -qE '\bloginAs\(' && echo "$f"
done || true)

if [ -n "$violations" ]; then
  printf '::error::check-no-probe-beforeeach-loginas found violations:\n%s\n\n' "$violations"
  printf 'BUG-032 closed the ~50-logins-per-suite pattern that saturated\n'
  printf 'MAX_SESSIONS + the auth rate-limiter. Probe specs MUST use\n'
  printf 'e2e/fixtures/auth.ts#useAs(persona) + test.use(...) for\n'
  printf 'authenticated state, not per-test UI login.\n\n'
  printf 'If a probe genuinely needs to exercise real login flows,\n'
  printf 'put it in e2e/01-auth.spec.ts alongside the other login-UI tests.\n\n'
  printf 'See docs/audit-2026-04-19/bug-plans/BUG-032-login-redirect-storage-state.md.\n'
  exit 1
fi

echo "✓ No probe spec re-introduces beforeEach(loginAs)."
