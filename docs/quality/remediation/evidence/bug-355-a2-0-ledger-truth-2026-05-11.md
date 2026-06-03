# BUG-355 A2-0 Ledger-Truth Evidence (2026-05-11)

## Scope

Lane: `A2`  
Step: `A2-0` (mandatory pre-implementation checkpoint from v4.4 plan)  
Purpose: prove the previously claimed operational-role SSoT guard is absent and capture a failing drift-proof artifact before any BUG-355 implementation work proceeds.

## Claim Under Audit

Historical claim (now corrected): a guard named `check-operational-role-ssot` existed and protected parity between:

- TS SSoT: `packages/shared/src/permissions.ts` (`OPERATIONAL_ONLY`)
- SQL literal: `apps/api/migrations/20260423000005_access_admin_slot_integrity_trigger.ts` (`NEW.role IN (...)`)

## Evidence A — Guard Presence Check (Failing)

Command:

```bash
if rg --files | rg -q "check-operational-role-ssot"; then echo "FOUND"; else echo "MISSING: check-operational-role-ssot guard file"; exit 1; fi
```

Output:

```text
MISSING: check-operational-role-ssot guard file
```

Exit code: `1` (expected for missing guard)

## Evidence B — Drift-Proof Failing Fixture Artifact

Command:

```bash
node - <<'NODE'
const ts = new Set(['receptionist','readonly']);
const simulatedSql = new Set(['receptionist']);
const missingInSql = [...ts].filter((role) => !simulatedSql.has(role));
if (missingInSql.length > 0) {
  console.error('FAIL drift fixture: SQL literal missing role(s): ' + missingInSql.join(', '));
  process.exit(1);
}
console.log('PASS drift fixture: role sets match');
NODE
```

Output:

```text
FAIL drift fixture: SQL literal missing role(s): readonly
```

Exit code: `1` (expected failing artifact demonstrating mismatch detection)

## Evidence C — Current Runtime Snapshot (Informational)

Command:

```bash
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const permPath = path.join(process.cwd(), 'packages/shared/src/permissions.ts');
const migPath = path.join(process.cwd(), 'apps/api/migrations/20260423000005_access_admin_slot_integrity_trigger.ts');
const permSrc = fs.readFileSync(permPath, 'utf8');
const migSrc = fs.readFileSync(migPath, 'utf8');
const permMatch = permSrc.match(/OPERATIONAL_ONLY[^\n]*new Set\(\[([^\]]+)\]\)/);
const migMatch = migSrc.match(/NEW\.role IN \(([^\)]+)\)/);
function parseList(raw) {
  return raw.split(',').map((s) => s.replace(/[\s'"`]/g, '')).filter(Boolean).sort();
}
const tsRoles = parseList(permMatch[1]);
const sqlRoles = parseList(migMatch[1]);
const missingInSql = tsRoles.filter((r) => !sqlRoles.includes(r));
const extraInSql = sqlRoles.filter((r) => !tsRoles.includes(r));
console.log('TS roles:', tsRoles.join(','));
console.log('SQL roles:', sqlRoles.join(','));
if (missingInSql.length || extraInSql.length) {
  console.error('MISMATCH', { missingInSql, extraInSql });
  process.exit(1);
}
console.log('MATCH');
NODE
```

Output:

```text
TS roles: readonly,receptionist
SQL roles: readonly,receptionist
MATCH
```

Exit code: `0`

Interpretation: current literals happen to match, but no fail-closed guard exists to prevent future silent drift.
