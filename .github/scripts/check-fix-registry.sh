#!/usr/bin/env bash
#
# check-fix-registry.sh — verify every entry in docs/fix-registry.md still
# matches (or doesn't match, depending on type) the file it claims to protect.
#
# Run by the `fix-registry-guard` CI job (see .github/workflows/ci.yml).
# Also runnable locally:
#
#   ./.github/scripts/check-fix-registry.sh
#
# Exit codes:
#   0  every entry verified
#   1  one or more entries failed
#   2  registry file missing or unreadable
#
# Format expected in docs/fix-registry.md (the script ignores everything
# outside the first markdown table whose header row contains "Pattern"):
#
#   | ID | File | Type | Pattern | Description |
#   |----|------|------|---------|-------------|
#   | B3a | path/to/file.ts | present | `task_type.*discharge_review` | ... |
#   | SD-FIX1 | other.ts | absent | `m\.deleted_at` | ... |
#   | OLD1 | gone.ts | retired | `whatever` | no longer needed |
#
# Type semantics:
#   present  — `git grep -E -q "<pattern>" -- "<file>"` must succeed
#   absent   — must fail
#   retired  — skipped entirely (kept for historical context)

set -uo pipefail

REGISTRY_FILE="${REGISTRY_FILE:-docs/quality/fix-registry.md}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if [ ! -f "$REGISTRY_FILE" ]; then
  echo "::error::Fix registry file not found at $REGISTRY_FILE"
  exit 2
fi

# Strip surrounding whitespace
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Strip a single layer of leading/trailing backticks
strip_backticks() {
  local s="$1"
  s="${s#\`}"
  s="${s%\`}"
  printf '%s' "$s"
}

declare -i checked=0
declare -i passed=0
declare -i failed=0
declare -i skipped=0
declare -a failures=()

in_table=0
header_seen=0

# Read the registry line by line. We are looking for the first markdown table
# whose header contains "Pattern", then process its data rows until the table
# ends (a non-pipe line).
while IFS= read -r line; do
  # Detect table header row
  if [[ "$line" == *"| ID "* && "$line" == *"| Pattern "* ]]; then
    in_table=1
    header_seen=1
    continue
  fi

  # Skip the separator line that follows the header (|----|----|...)
  if [[ "$in_table" -eq 1 && "$line" =~ ^\|[\ ]*-+ ]]; then
    continue
  fi

  # End of table = first non-pipe line after we've started
  if [[ "$in_table" -eq 1 && ! "$line" =~ ^\| ]]; then
    in_table=0
    continue
  fi

  # Process a data row
  if [[ "$in_table" -eq 1 && "$line" =~ ^\| ]]; then
    # Split on "|", drop the first empty field (before the leading |)
    IFS='|' read -ra fields <<<"$line"
    # fields[0] = "" (before leading |)
    # fields[1] = ID
    # fields[2] = File
    # fields[3] = Type
    # fields[4] = Pattern (in backticks)
    # fields[5] = Description
    if [ "${#fields[@]}" -lt 5 ]; then
      continue
    fi

    id="$(trim "${fields[1]}")"
    file="$(trim "${fields[2]}")"
    type="$(trim "${fields[3]}")"
    pattern="$(strip_backticks "$(trim "${fields[4]}")")"

    # Skip retired entries
    if [ "$type" = "retired" ]; then
      skipped+=1
      continue
    fi

    # Validate
    if [ -z "$id" ] || [ -z "$file" ] || [ -z "$pattern" ]; then
      continue
    fi
    if [ "$type" != "present" ] && [ "$type" != "absent" ]; then
      failures+=("INVALID TYPE [$id]: type=$type (expected present|absent|retired)")
      failed+=1
      checked+=1
      continue
    fi

    # File must exist
    if [ ! -f "$file" ]; then
      failures+=("MISSING FILE [$id]: $file does not exist (pattern: $pattern)")
      failed+=1
      checked+=1
      continue
    fi

    checked+=1

    # Run the grep. Use -E for ERE, -q for quiet.
    if git grep -E -q -- "$pattern" -- "$file" 2>/dev/null; then
      grep_match=1
    else
      grep_match=0
    fi

    case "$type" in
      present)
        if [ "$grep_match" -eq 1 ]; then
          passed+=1
        else
          failures+=("MISSING [$id]: $file no longer matches /$pattern/")
          failed+=1
        fi
        ;;
      absent)
        if [ "$grep_match" -eq 0 ]; then
          passed+=1
        else
          failures+=("FORBIDDEN [$id]: $file unexpectedly matches /$pattern/")
          failed+=1
        fi
        ;;
    esac
  fi
done <"$REGISTRY_FILE"

if [ "$header_seen" -eq 0 ]; then
  echo "::error::No registry table found in $REGISTRY_FILE (expected a markdown table with an 'ID' and 'Pattern' header)"
  exit 2
fi

echo
echo "Fix Registry Guard"
echo "  registry: $REGISTRY_FILE"
echo "  checked:  $checked"
echo "  passed:   $passed"
echo "  failed:   $failed"
echo "  skipped:  $skipped (retired)"
echo

if [ "$failed" -gt 0 ]; then
  echo "::error::$failed fix-registry entries failed verification:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  echo
  echo "These failures mean a previously-verified fix has been silently undone."
  echo "Read the row in $REGISTRY_FILE for context, then either:"
  echo "  1. Re-apply the fix in your branch, OR"
  echo "  2. If the fix is genuinely no longer needed, change its 'type' to 'retired' in the registry."
  exit 1
fi

echo "All fix-registry entries verified."
exit 0
