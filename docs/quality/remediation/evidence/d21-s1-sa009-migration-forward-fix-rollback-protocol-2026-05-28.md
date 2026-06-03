# D21 — BUG-SA-009 Migration Safety Protocol Closure

**Date:** 2026-05-28  
**Bug:** `BUG-SA-009` (S1, pre-deployment)  
**Scope:** Codify and enforce forward-fix/rollback posture for irreversible migrations.

## What changed

1. Added `BUG-362` irreversible migration approval to the forward-fix register:
   - File: `apps/api/scripts/migration-forward-fix-only-register.json`
   - Entry:
     - `migrationFile`: `20260423000008_reconcile_stale_admin_slots.ts`
     - `status`: `approved`
     - `ticket`: `BUG-362-FWD-FIX-APPROVAL-2026-05-28`

2. Kept existing structural controls in force:
   - `guard:migration-rollback-discipline` (non-empty `down()` discipline).
   - `migrate:rehearsal` fail-closed behavior for irreversible migrations unless approved in register.

## Verification evidence

### A) Rehearsal gate (pass with approved-forward-fix-only)

Command:

```bash
npm run -w apps/api migrate:rehearsal
```

Observed key output:

- `step=up-1 batch=96 files=none`
- `migration file "20260423000008_reconcile_stale_admin_slots.ts" failed`
- `step=down-all status=approved-forward-fix-only migration=20260423000008_reconcile_stale_admin_slots.ts bug=BUG-362 ticket=BUG-362-FWD-FIX-APPROVAL-2026-05-28`
- `rehearsal_status=PASS`

Interpretation:

- Rehearsal remains **fail-closed** on irreversible rollback attempts.
- The rollback exception is only accepted through explicit, ticketed approval in the register.

### B) Rollback-discipline guard

Command:

```bash
npm run -s guard:migration-rollback-discipline
```

Observed output:

- `✓ Every migration has a non-empty down() with IF EXISTS on DROPs.`

## Closure decision

`BUG-SA-009` is now **fixed** at local/pre-deployment engineering level:

- protocol is codified,
- approval path is explicit and auditable,
- rehearsal enforces the policy fail-closed.

Remaining operational rollout work is covered under broader pre-deployment canary governance, not this bug.
