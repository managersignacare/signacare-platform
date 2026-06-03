# BUG-187 — Postgres pool exhaustion + missing statement_timeout

> **Post-hoc backfill.** Plan doc created after commit. Extracted from commit body, catalogue entry, follow-up-on-cloud-deploy.md, and diagnostic memory.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-0 (pre-flight) |
| Change-class | risky (DB pool layer; all queries affected) |
| Commit SHA | `9c91048` (fix) + `d8df9c4` (docs) |
| Fix-registry anchor | R-FIX-POOL-STATEMENT-TIMEOUT |
| Discovered | pre-plan |
| Closed | 2026-04-20 (as mitigation-regression; original leak mechanism NOT reproduced) |

## 2. Diagnosis

**Catalogued root cause (as filed):** pool exhaustion under concurrent load due to missing `statement_timeout` and `idle_in_transaction_session_timeout` — long-running or orphaned transactions pin connections until Knex pool max is hit, after which every new request 500s.

**Diagnostic finding (2026-04-20):** the catalogued mechanism could NOT be reproduced in the local audit window. Pool saturation did not surface under synthetic load (50 concurrent queries). No orphaned transactions observed in `pg_stat_activity`. The 21-hour dev-API uptime that the user had flagged as "login timeout" cleared on a restart and did not recur under similar conditions.

**Classification chosen:** mitigation-regression — ship the guardrails because they are cheap, standards-compliant, and catch the catalogued mechanism IF it ever reproduces; keep the catalogue entry OPEN (state = `fixed-but-monitor`) rather than declaring the catalogue wrong.

## 3. Approach

**Gold-standard fix:** connection-level guardrails applied uniformly to every pool via a shared Knex `afterCreate` callback. Two timeouts:
- `statement_timeout = '30s'` — bounds any single query to 30 seconds; beyond that PostgreSQL cancels the statement. 30s is the plan's canonical value across follow-up docs.
- `idle_in_transaction_session_timeout = '60s'` — reaps BEGIN-without-COMMIT zombies at 60 seconds.

**Downstream impact:** every query in `apps/api/src/db/db.ts`'s `appPool` AND `rawDbRead` (with-replica branch + no-replica fallback) inherits these settings at connection creation. LLM/scribe paths that exceed 30s need to either chunk or run outside the request cycle (already pattern: BullMQ workers).

**Pattern cited:** Knex `pool.afterCreate` hook — used elsewhere for `SET search_path` initialisation.

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Only apply to `appPool` (not `rawDbRead`) | rawDbRead services admin reads; leaving it unguarded means admin paths can pin a replica connection indefinitely |
| Higher timeouts (60s/120s) | 30s statement_timeout matches the HTTP request-timeout middleware's 30s ceiling (BUG-205 scope) — consistency |
| Declare the catalogue wrong and close BUG-187 as not-reproducible | Reviewer pushed back on overreach; preserving uncertainty is safer — catalogue stays open for monitoring |

## 5. Reviewer refinement trail

**Initial proposal — REJECTED.** Reviewer comments:
1. "Catalogue was wrong" framing is overreach — should be mitigation-regression, not declaration.
2. `rawDbRead` not fixed — only `appPool` was in original proposal.
3. Test was tautological — set the timeout, then checked it's set.

**Revised proposal — accepted:**
1. Preserve catalogue uncertainty; state becomes `fixed-mitigation` with "original mechanism not reproduced" noted in fix-registry row.
2. Shared `appUserAfterCreate` helper applied to **both** `appPool` and both branches of `rawDbRead`.
3. Discriminating test: `SELECT pg_sleep(35)` → asserts query cancels at ~30s (proves the timeout is active, not just set).

## 6. Implementation outline

**Files touched:**
- `apps/api/src/db/db.ts` — extracted `appUserAfterCreate`; wired into `appPool.pool.afterCreate` + `rawDbRead` with-replica branch + fallback branch.

**Key shape:**
```typescript
const appUserAfterCreate = (conn, done) => {
  conn.query(
    "SET statement_timeout = '30s'; SET idle_in_transaction_session_timeout = '60s'; SELECT 1",
    (err) => {
      if (err) logger.error({ err }, "DB app_user connection init failed");
      done(err, conn);
    },
  );
};
```

## 7. Tests

`apps/api/tests/integration/dbPoolPressure.int.test.ts` — 4 tests:
1. `SHOW statement_timeout` returns `'30s'` post-connect.
2. `SHOW idle_in_transaction_session_timeout` returns `'60s'`.
3. `SELECT pg_sleep(35)` is cancelled at ~30s with the right SQLSTATE (57014).
4. 20 scheduler iterations drive concurrent queries; pool returns to idle baseline after each iteration (no leak under the tested load).

**Red-first trace:** not captured as strict FAIL→PASS (the timeout's absence wasn't the sole cause — see §2).

## 8. Verification trace

- `SHOW statement_timeout` → `30s`.
- `SHOW idle_in_transaction_session_timeout` → `60s`.
- `pg_sleep(35)` → cancelled at ~30s, SQLSTATE 57014.
- Concurrent 20-iteration stress → pool returns to idle baseline.
- Long-running LLM call >30s → **will now fail with query cancelled** (by design — LLM paths must be moved to BullMQ per plan).

## 9. Residual risk

- Original pool-exhaustion mechanism NOT reproduced; guardrails are defensive but the root cause remains unverified. Catalogue entry stays `fixed-mitigation` pending production canary observability.
- LLM/scribe paths that exceed 30s will now be cancelled. Workers already move heavy LLM to BullMQ; a few remaining synchronous LLM calls in request handlers will need BullMQ migration (BUG-145 ρ1 follow-on).
- Statement timeout is server-side; application-side awareness (gracefully logging "query cancelled — timeout" vs generic 500) is a BUG-205 follow-up.
- See `docs/audit-2026-04-19/follow-up-on-cloud-deploy.md` for cloud-specific items (pool pressure, observability).

## 10. CAB / change-control notes

- Catalogue entry BUG-187 state = `fixed-mitigation` (not `fixed`). Distinct status to flag that root cause remains unverified.
- No new dependencies, no licence acceptance.

## 11. QA agent verdicts

Fix pre-dates L1-L5 QA agent framework going live for this BUG. Manual review by reviewer only.
