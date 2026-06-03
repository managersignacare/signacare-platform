#!/usr/bin/env bash
#
# check-naming-conventions.sh — enforce Signacare naming-convention rules.
#
# Run by the `naming-conventions-guard` CI job (see .github/workflows/ci.yml).
# Also runnable locally:
#
#   ./.github/scripts/check-naming-conventions.sh
#
# Each rule below corresponds to a documented Fix Registry pattern that
# caused multiple bugs in earlier sessions. The CLAUDE.md naming contract
# is the source of truth; this script is its enforcement layer.
#
# Rules enforced:
#
#   1. apiClient.instance.{get,post,put,patch,delete} URLs MUST NOT start
#      with `/api/v1/` — apiClient.instance.baseURL is already `/api/v1`.
#      Catches the URL1-URL15 regression class (~30 bugs across sessions).
#
#   2. apiClient.instance.{get,post,put,patch,delete} URLs MUST NOT start
#      with a leading `/`. Same root cause as rule 1.
#
#   3. Knex `.as('camelCase')` aliases are forbidden. The
#      camelCaseResponse middleware only converts snake_case → camelCase,
#      so a camelCase alias slips through unchanged and breaks the
#      contract. Catches the ALIAS1-ALIAS4 regression class.
#
#   4. parseInt() must be called with an explicit radix (parseInt(x, 10)).
#      Catches the RADIX1 regression class.
#
# Each rule prints its own violations. Exit code 0 if all clean, 1 if any
# violations.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

ALLOWLIST=".github/scripts/naming-conventions.allowlist"
declare -i total_violations=0

# ─── Rule 1 + 2: apiClient URL prefix and leading slash ──────────────────────
#
# Two call patterns exist (both share the same axios instance whose
# baseURL is already `/api/v1`):
#
#   apiClient.post('foo')              — typed helper wrapper
#   apiClient.instance.post('foo')     — raw axios for multipart/streaming
#
# Both must use relative paths. The pattern matches either form.
echo "→ Rule 1+2: apiClient URL prefix / leading slash"

# Note: TS calls often have a generic type parameter between the method and
# the open paren, e.g. apiClient.post<void>('foo'). The regex must allow
# an optional <…> segment.
violations_url=$(
  git grep -nE "apiClient(\.instance)?\.(get|post|put|patch|delete)(<[^>]*>)?\(['\"\`]\/api\/v1" -- 'apps/web/src/' 2>/dev/null || true
)
if [ -n "$violations_url" ]; then
  echo "::error::apiClient calls with /api/v1/ prefix found (baseURL is already /api/v1):"
  echo "$violations_url" | sed 's/^/    /'
  total_violations+=1
fi

violations_slash=$(
  git grep -nE "apiClient(\.instance)?\.(get|post|put|patch|delete)(<[^>]*>)?\(['\"\`]\/[a-z]" -- 'apps/web/src/' 2>/dev/null || true
)
if [ -n "$violations_slash" ]; then
  echo "::error::apiClient calls with leading / found (URLs must be relative):"
  echo "$violations_slash" | sed 's/^/    /'
  total_violations+=1
fi

if [ -z "$violations_url" ] && [ -z "$violations_slash" ]; then
  echo "  ok"
fi

# ─── Rule 3: Knex .as('camelCase') aliases ───────────────────────────────────
#
# A camelCase alias matches /[a-z][a-zA-Z]*[A-Z]/ which means: starts with a
# lowercase letter, then has at least one uppercase later. snake_case names
# never have an uppercase letter, so this is decisive.
#
# False-positive guard: we exclude legitimate camelCase JSON keys in test
# fixtures and types directories.
echo "→ Rule 3: Knex .as('camelCase') aliases forbidden"
violations_alias=$(
  git grep -nE "\.as\(['\"][a-z][a-zA-Z]*[A-Z][a-zA-Z]*['\"]" -- 'apps/api/src/**/*.ts' 2>/dev/null \
    | grep -v "/tests/" \
    | grep -v ".test.ts" \
    || true
)
if [ -n "$violations_alias" ]; then
  echo "::error::camelCase Knex aliases found (use snake_case so camelCaseResponse middleware can convert them):"
  echo "$violations_alias" | sed 's/^/    /'
  total_violations+=1
else
  echo "  ok"
fi

# Note: we deliberately do NOT flag the SQL string form
# (e.g. .select('p.given_name as givenName')) because the camelCaseResponse
# middleware leaves already-camelCase keys unchanged (it only transforms
# snake → camel). Such aliases are stylistically inconsistent but
# runtime-safe.
#
# The actual bug class fixed by ALIAS1-4 in the Fix Registry was
# concatenated all-lowercase aliases like `orgunitname`, `clinicianname`,
# `displayname` — neither snake_case nor camelCase, which the middleware
# cannot transform. Those known sites are protected by their explicit
# Fix Registry entries; we don't try to detect them generically here.

# ─── Rule 4: parseInt() without explicit radix ────────────────────────────────
#
# parseInt(x) is buggy when x has a leading 0 (legacy octal) or non-numeric
# prefix. The fix is parseInt(x, 10).
#
# This is implemented in awk because shell regex cannot handle the
# "extract individual parseInt() calls from a line that may have several"
# requirement. The awk script walks each parseInt( occurrence, finds the
# matching closing paren (handling one level of nested parens like
# `parseInt((row as any).cnt, 10)`) and tests whether the call as a whole
# ends in a valid radix.
#
# Allowlist: lines listed in .github/scripts/naming-conventions.allowlist
# with rule "parseint" are pre-existing violations and are skipped.
echo "→ Rule 4: parseInt() must use explicit radix"
violations_parseint=$(
  git grep -nE "parseInt\(" -- 'apps/api/src/**/*.ts' 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 2>/dev/null \
    | awk -F: '
      {
        file=$1; lineno=$2;
        # Reconstruct the rest of the line (in case it contains colons)
        rest=""; for (i=3;i<=NF;i++) { rest=rest (i>3?":":"") $i }
        # Walk every "parseInt(" in this line
        s=rest; offset=0;
        while ((p=index(s,"parseInt(")) > 0) {
          start=p+length("parseInt(")-1;  # position of the opening (
          depth=0; end=-1;
          for (i=start;i<=length(s);i++) {
            c=substr(s,i,1);
            if (c=="(") depth++;
            else if (c==")") { depth--; if (depth==0) { end=i; break } }
          }
          if (end<0) { s=substr(s,p+9); continue }
          call=substr(s,p,end-p+1);
          # call is now like "parseInt(...)". Test for trailing radix.
          if (call !~ /, *(2|8|10|16)\)$/) {
            print file ":" lineno ":" call;
          }
          s=substr(s,end+1);
        }
      }
    ' \
    | grep -v "// eslint-disable" \
    || true
)

# Filter out allowlisted lines
if [ -n "$violations_parseint" ] && [ -f "$ALLOWLIST" ]; then
  filtered=""
  while IFS= read -r v; do
    [ -z "$v" ] && continue
    file_line=$(echo "$v" | awk -F: '{print $1":"$2}')
    if grep -qF "${file_line}:parseint" "$ALLOWLIST"; then
      continue
    fi
    filtered="${filtered}${v}"$'\n'
  done <<<"$violations_parseint"
  violations_parseint="${filtered%$'\n'}"
fi

if [ -n "$violations_parseint" ]; then
  echo "::error::parseInt() without radix found (use parseInt(x, 10)):"
  echo "$violations_parseint" | sed 's/^/    /'
  total_violations+=1
else
  echo "  ok (allowlist active for pre-existing violations)"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo
if [ "$total_violations" -gt 0 ]; then
  echo "::error::Naming-convention guard failed with $total_violations rule(s) violated."
  echo "See CLAUDE.md and the system-design plan for the rationale behind each rule."
  exit 1
fi

echo "All naming-convention rules passed."
exit 0
