# BUG-355 A2 SSoT Guard Closure Evidence (2026-05-12)

## Scope

Lane: `A2`  
Bug: `BUG-355`  
Purpose: close ledger-corrected guard gap by landing a fail-closed TS/SQL parity guard and wiring it into discipline gates.

## Structural Deliverables

1. Manifest: `.github/operational-role-ssot.json`
2. Guard: `scripts/guards/check-operational-role-ssot.ts`
3. Guard tests: `scripts/guards/__tests__/check-operational-role-ssot.test.ts`
4. CI discipline wiring: `package.json` (`guard:operational-role-ssot` + inclusion in `guard:claude-discipline`)

## Guard Contract

1. TS source-of-truth is `packages/shared/src/permissions.ts` export `OPERATIONAL_ONLY`.
2. Every tracked SQL file containing operational-role literals must match that set exactly.
3. Any untracked migration introducing an operational-role literal fails closed.

## Verification

Command:

```bash
npm run guard:operational-role-ssot
```

Output:

```text
✓ check-operational-role-ssot
  manifest: /Users/drprakashkamath/Projects/Signacare/.github/operational-role-ssot.json
  tsSource: /Users/drprakashkamath/Projects/Signacare/packages/shared/src/permissions.ts
  operationalRoles: readonly, receptionist
  trackedSqlFiles: 3
  checkedOperationalLiterals: 8
```

Command:

```bash
npx vitest run scripts/guards/__tests__/check-operational-role-ssot.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

## Closure Statement

`BUG-355` guard-absence state is removed. SQL operational-role literals now have an explicit, tested, fail-closed parity contract tied to TS `OPERATIONAL_ONLY` and CI discipline execution.
