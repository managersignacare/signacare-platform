#!/usr/bin/env bash
#
# Verifies the release-control evidence that must exist before a Signacare
# deployment can promote to production. This script does not mutate any Azure
# resource and deliberately does not print proof values because some ticket URLs
# can contain private workspace identifiers.

set -euo pipefail

ENV_NAME="${ENV:-${1:-}}"
if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: ENV=staging|prod $0" >&2
  exit 2
fi

release_controls_required() {
  case "${DB_RELEASE_CONTROLS_REQUIRED:-}" in
    true|TRUE|1|yes|YES) return 0 ;;
    false|FALSE|0|no|NO) return 1 ;;
  esac

  [[ "$ENV_NAME" == "prod" ]]
}

is_placeholder() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [[ -z "$value" || "$value" == "todo" || "$value" == "tbd" || "$value" == "none" || "$value" == "n/a" || "$value" == "na" ]]
}

require_proof() {
  local label="$1"
  local var_name="$2"
  local value="${!var_name:-}"

  if is_placeholder "$value"; then
    echo "  ✗ $label proof missing ($var_name)" >&2
    return 1
  fi

  echo "  ✓ $label proof present ($var_name)"
}

echo "▶ Signacare database release-control proof ($ENV_NAME)"

if ! release_controls_required; then
  echo "  ○ skipped (DB_RELEASE_CONTROLS_REQUIRED != true and ENV != prod)"
  exit 0
fi

fail=0

require_proof "Staging clone migration test" "DB_STAGING_CLONE_MIGRATION_PROOF" || fail=1
require_proof "Expand/contract migration review" "DB_EXPAND_CONTRACT_PROOF" || fail=1
require_proof "Backup restore drill" "DB_RESTORE_DRILL_PROOF" || fail=1
require_proof "Rollback rehearsal" "DB_ROLLBACK_REHEARSAL_PROOF" || fail=1

if [[ $fail -ne 0 ]]; then
  cat >&2 <<'EOF'

Database release controls are required for production promotion:
  - DB_STAGING_CLONE_MIGRATION_PROOF: staging-clone migration run artifact or ticket
  - DB_EXPAND_CONTRACT_PROOF: reviewed expand/contract compatibility evidence
  - DB_RESTORE_DRILL_PROOF: restore-drill run artifact proving backup recoverability
  - DB_ROLLBACK_REHEARSAL_PROOF: migrate:rehearsal run artifact or approved forward-fix-only proof

EOF
  exit 1
fi

echo "✓ Database release-control proof passed."
