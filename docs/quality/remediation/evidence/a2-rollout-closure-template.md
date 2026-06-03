# A2 Rollout Closure Template

Use this template to close A2 rollout-contract bugs after external execution.

## Scope

- Lane: `A2`
- Bugs: `BUG-287`, `BUG-315`, `BUG-334`, `BUG-706`
- Deferred (not in this closure): `BUG-288`
- Commit set under validation:
  - `f7b03e86` (A2-2 Phase C)
  - `137f8bf2` (A2-3 hash-chain)
  - `e257033b` (A2-4 DR fingerprint)
  - `6aead0bd` (A2 local closeout docs)

## Pre-Canary Checks (must be PASS in same execution window)

- [ ] `npm run guard:claude-discipline:ci` PASS
- [ ] `npm run typecheck` PASS
- [ ] `npm run migrate:rehearsal` PASS (`BUG-706` approved-forward-fix-only policy active)
- [ ] `npm run test:integration -w apps/api -- clinicalNotesConsentFK.int.test.ts limitCeilings.int.test.ts reportsRoutesHealth.int.test.ts auditLogHashChain.int.test.ts` PASS
- [ ] `DR_DB_USER=postgres DR_DB_PASSWORD='' npm run dr:restore-drill` PASS

Evidence links:

- Local run log:
- CI run URL:

## Canary Stage (Azure Internal Ring)

- Canary start datetime (UTC):
- Canary end datetime (UTC):
- Tenant/ring:
- Promotion owner:

Required canary proofs:

- [ ] Critical smoke workflows PASS (auth, patient read/write, clinical notes, reports health, audit paths)
- [ ] No Sev0/Sev1 incidents
- [ ] Rollback trigger matrix stayed green
- [ ] SLO checks attached (auth latency/failure, save success, DR/readiness)

Evidence links:

- Dashboard snapshot links:
- Incident tracker links:
- Deployment run ID:

## Burn-In Window

- Minimum required window for these A2 code-path changes: `24 hours`
- Burn-in start datetime (UTC):
- Burn-in end datetime (UTC):

Monitoring cadence record:

- [ ] first 4 hours: every 30 minutes
- [ ] remainder: hourly
- [ ] no rollback trigger fired

Evidence links:

- Monitoring log:
- Alert history:

## Post-Burn-In Verification

- Re-run datetime (UTC):
- Operator:

Required reruns:

- [ ] local/CI gate pack rerun PASS
- [ ] DR drill PASS
- [ ] route/integration sanity rerun PASS

Evidence links:

- Rerun logs:
- CI run URL:

## Closure Decision

- [ ] Close `BUG-287`
- [ ] Close `BUG-315`
- [ ] Close `BUG-334`
- [ ] Close `BUG-706`

Closure approvers (required by plan):

- DB lead:
- Security lead:
- Operations lead:

If any item above is not satisfied, keep bug state `open` or `paused` with explicit reason.
