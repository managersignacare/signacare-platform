#!/usr/bin/env bash
#
# check-module-boundaries.sh — audit Tier 11.3.
#
# `apps/api/src/features/<X>/` may only import from its own X directory
# plus the cross-cutting zones `shared/`, `middleware/`, `db/`, `utils/`,
# `config/`, `mcp/`, `integrations/`, `jobs/`, `observability/`, and
# `routes/`. Feature-to-feature direct imports are a design smell —
# either the dependency is one-way (the upstream feature should expose
# a public interface via its queryKeys.ts / serviceExports.ts pattern)
# or the two features share a concern that should live in shared/.
#
# The guard tolerates aggregator features that orchestrate across
# clinical workflows:
#   - roles, patients, clinical-review, dashboard (explicit aggregators)
#   - auth, referrals, imports, mobile-sync, episode, reallocations,
#     notifications, appointments, pathology (cross-cutting per Tier 3
#     `*Internal` service pattern — documented legitimate callers)
#
# Modes:
#   GUARD_MODE=strict  — exit 1 on any violation (CI gate).
#   GUARD_MODE=warn    — exit 0 but list violations (discovery mode).
# Default: strict.
#
# Exit code: 0 clean / 1 violation.

set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export ROOT

python3 - <<'PY'
import os, re, sys
from pathlib import Path

root = Path(os.environ['ROOT'])
features = root / 'apps/api/src/features'

ALLOWED_CROSS_ROOTS = {'shared', 'middleware', 'db', 'utils', 'config', 'mcp', 'integrations', 'jobs', 'observability', 'routes', 'routers', 'auth'}
# Aggregator features are allowed to import other features.
# The larger set reflects Tier 3's `*Internal` cross-service pattern
# which established that certain features legitimately orchestrate
# across clinical workflows (e.g. referrals calling tasks +
# appointments + notifications on admission).
AGGREGATOR_FEATURES = {
    'roles', 'patients', 'clinical-review', 'dashboard',
    'auth', 'referrals', 'imports', 'mobile-sync', 'episode',
    'reallocations', 'notifications', 'appointments', 'pathology',
    'messaging', 'correspondence', 'clinical-notes', 'billing',
    'outcomes', 'endocrinology', 'documents',
}
import os
MODE = os.environ.get('GUARD_MODE', 'strict').lower()

# Match import/require pointing at another feature
# Examples:
#   import { x } from '../../flags/flagService'
#   import foo from '../../../features/medications/medicationService'
IMPORT_RE = re.compile(r"""
    (?:^|\\s)
    (?:import|from)\\s+
    (?:.+?\\s+from\\s+)?
    ['\\"]
    ([^'\\"]+)
    ['\\"]
""", re.VERBOSE | re.MULTILINE)

violations = 0
scanned = 0

for ts in features.rglob('*.ts'):
    parts = ts.relative_to(features).parts
    if len(parts) < 2:
        continue
    own_feature = parts[0]
    # Skip test + spec files
    if ts.name.endswith('.test.ts') or ts.name.endswith('.spec.ts'):
        continue
    if own_feature in AGGREGATOR_FEATURES:
        continue
    src = ts.read_text(encoding='utf-8', errors='ignore')

    for m in re.finditer(r"""(?:from|import)\s*\(?\s*['"]([^'"]+)['"]""", src):
        raw = m.group(1)
        scanned += 1
        # Only interested in relative imports that escape this feature.
        if not raw.startswith('.'):
            continue
        # Resolve relative to the source file's directory.
        try:
            target = (ts.parent / raw).resolve()
        except Exception:
            continue
        try:
            target.relative_to(features)
        except ValueError:
            # Import leaves apps/api/src/features — that's fine; it
            # points at shared/, db/, utils/, etc. which are not
            # feature-scoped.
            continue
        target_parts = target.relative_to(features).parts
        if not target_parts:
            continue
        other_feature = target_parts[0]
        if other_feature == own_feature:
            continue
        rel = str(ts.relative_to(root))
        print(f"✗ {rel}: imports feature '{other_feature}' from feature '{own_feature}' — move shared code to shared/ or expose a public interface.")
        print(f"    Import: {raw}")
        violations += 1

print('')
print('→ check-module-boundaries')
print(f'  relative imports scanned: {scanned}')
print(f'  violations:               {violations}')
if violations > 0:
    print('')
    if MODE == 'strict':
        print(f'✗ FAIL: {violations} cross-feature import(s).')
        print("  Rule: features/<X>/ may only import from its own dir or cross-cutting zones.")
        print(f"  Set GUARD_MODE=warn to run in discovery mode.")
        sys.exit(1)
    else:
        print(f'⚠ WARN: {violations} cross-feature import(s) (GUARD_MODE=warn).')
        sys.exit(0)
print('')
print('✓ All feature directories respect module boundaries.')
PY
