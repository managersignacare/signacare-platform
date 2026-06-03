#!/usr/bin/env bash
#
# check-dart-api-calls.sh — audit Tier 11.2 (Phase R D.2 delivered).
#
# Every Dart call of the form
#   ApiClient.instance.<method>('<path>' ...)
#   pApi.<method>('<path>' ...)
#   api.<method>('<path>' ...)
# must satisfy:
#   (a) path starts with a leading slash
#   (b) path does NOT start with /api/v1/ (the base URL already has it)
#   (c) path does NOT contain http(s):// (never hard-code absolute URLs)
#
# Why: in Phase R a Dart-side bug shipped Medicare token requests to
# `/api/v1/api/v1/medicare/token` because the caller prepended the
# prefix the client was already configured with. A guard is the only
# thing that prevents the class of bug from recurring.
#
# Exit code: 0 clean / 1 violation.

set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SARA_DIR="$ROOT/apps/mobile/lib"
VIVA_DIR="$ROOT/apps/patient-app/lib"

python3 - <<PY
import re, sys
from pathlib import Path

root = Path('$ROOT')
targets = [root / 'apps/mobile/lib', root / 'apps/patient-app/lib']

# Match:   api.get('/path…', …)   or   pApi.post("/path…", …)   or
#          ApiClient.instance.patch(\`/path…\`, …)
# Captures the path literal.
pattern = re.compile(r"""
    (?:ApiClient\.instance|pApi|\bapi)
    \s*\.\s*
    (?:get|post|put|patch|delete)
    \s*\(
    \s*(['"\`])([^'"\`]+)\1
""", re.VERBOSE)

violations = 0
scanned = 0
for base in targets:
    if not base.exists():
        continue
    for path in base.rglob('*.dart'):
        try:
            src = path.read_text(encoding='utf-8')
        except Exception:
            continue
        for lineno, line in enumerate(src.splitlines(), start=1):
            for m in pattern.finditer(line):
                url = m.group(2)
                scanned += 1
                if url.startswith(r'\$'):
                    # Pure template interpolation — not a literal path.
                    continue
                rel = str(path.relative_to(root))
                if not url.startswith('/'):
                    print(f"✗ {rel}:{lineno} — API path must start with a leading slash: '{url}'")
                    violations += 1
                if url.startswith('/api/v1/'):
                    print(f"✗ {rel}:{lineno} — API path must NOT start with /api/v1/ (baseURL already has it): '{url}'")
                    violations += 1
                if url.startswith('http://') or url.startswith('https://'):
                    print(f"✗ {rel}:{lineno} — API path must NOT be an absolute URL: '{url}'")
                    violations += 1

print('')
print('→ check-dart-api-calls')
print(f'  paths scanned: {scanned}')
print(f'  violations:    {violations}')

if violations > 0:
    print('')
    print(f'✗ FAIL: {violations} Dart API-call violation(s).')
    print("  Rule: ApiClient base URL is '/api/v1' — relative paths only, leading slash required.")
    sys.exit(1)
print('')
print('✓ All Dart API calls use a relative path starting with / and no /api/v1 prefix.')
PY
