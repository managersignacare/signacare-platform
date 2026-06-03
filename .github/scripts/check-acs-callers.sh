#!/usr/bin/env bash
#
# check-acs-callers.sh — enforce the Phase 12D caller-containment rule.
#
# Phase 10F's no-telecom guard allows `@azure/communication-*`
# imports inside `apps/api/src/integrations/acs/**` as a scoped
# exemption. This secondary guard narrows that exemption further:
# inside the whole codebase, the ONLY file allowed to import from
# `apps/api/src/integrations/acs/**` is
# `apps/api/src/features/patient-outreach/patientOutreachService.ts`.
#
# Why the second guard: the first guard stops new telecom libraries
# sneaking in. The second guard stops existing ACS code sneaking
# out of its scoped lane. Together they guarantee that every ACS
# SMS call in the codebase flows through the dispatcher's override
# + consent + budget + audit trail — a random feature file can't
# bypass any of them.
#
# Runs in CI after no-telecom-guard. Exit 0 clean, 1 on violation.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

declare -i total_violations=0

ALLOWED_CALLER_REGEX="apps/api/src/features/patient-outreach/patientOutreachService\\.ts"

echo "→ Rule: imports from apps/api/src/integrations/acs/** allowed only from patientOutreachService.ts"

# Match every import path that targets integrations/acs, then reject
# any match whose file isn't the allowlisted caller.
violations=$(
  git grep -nE "from ['\"].*integrations/acs/" -- 'apps/api/src/**/*.ts' 2>/dev/null \
    | grep -vE "^apps/api/src/integrations/acs/" \
    | grep -vE "^${ALLOWED_CALLER_REGEX}:" \
    || true
)

if [ -n "$violations" ]; then
  echo "::error::Unauthorized import from apps/api/src/integrations/acs/** — only patientOutreachService.ts may call into the ACS lane:"
  echo "$violations" | sed 's/^/    /'
  total_violations+=1
fi

echo
if [ "$total_violations" -gt 0 ]; then
  echo "::error::acs-callers guard failed."
  echo
  echo "Background: Phase 12D caller-containment. ACS lives in one directory"
  echo "(apps/api/src/integrations/acs/**) and is called from exactly one"
  echo "service (apps/api/src/features/patient-outreach/patientOutreachService.ts)."
  echo "A random feature file cannot bypass the dispatcher's override +"
  echo "consent + budget + audit trail. See docs/fix-registry.md §NO-SMS."
  exit 1
fi

echo "acs-callers guard passed."
