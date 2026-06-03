# BUG-039 — audit_log REVOKE UPDATE/DELETE + immutability trigger

**Severity:** S0 | **Track:** A | **Wave:** A-2 | **Date:** 2026-04-21

---

## 1. Metadata

| Field | Value |
|---|---|
| Bug ID | BUG-039 |
| Plan source | EXECUTION-PLAN-v3-FULL §2.1 Wave A-2 |
| Related | BUG-037 (llm_interactions audit — writeAuditLog reuse), BUG-153 closed (monthly-partitioning — legacy schema only), CLAUDE.md §7.4 (migration naming discipline), CLAUDE.md §3.1/§3.2 (audit never throws; §9.6 no silent audit failure) |
| Owner | Security Approver |
| Change-class | risky (migration + DB grant surface + trigger + RLS-adjacent) |

---

## 2. Diagnosis

**Root cause (one sentence):** `audit_log` in the v2 baseline grants UPDATE / DELETE / TRUNCATE to `app_user` by default (Postgres inherits owner privileges on CREATE TABLE), so a compromised runtime role — or any future code path with UPDATE/DELETE — can silently rewrite or delete audit history, violating HIPAA 164.312(b) audit controls and APP 11.1 security.

**Why this is patient-safety critical:**
- HIPAA 164.312(b) requires audit trails be tamper-evident.
- APP 11.1 security mandates integrity controls on PHI-adjacent records.
- Australian Privacy Act breach reporting relies on an unalterable audit trail; a mutable audit table means a compromised account can delete evidence of its own misuse.
- Signacare's clinician actions (READ, CREATE, UPDATE, DELETE of clinical data) write to audit_log. If rows can be modified post-hoc, the entire forensic surface is undermined.

**Current state (per Explore investigation):**
- v2 baseline creates audit_log with RLS policies (tenant + preauth) but NO `REVOKE UPDATE, DELETE FROM app_user`.
- Legacy pre-partition migrations (`20260331_audit_log_tamper_protection.sql` + `20260412000004_audit_log_partitioning.ts`) had the REVOKE + triggers, but the v2 baseline squash dropped them.
- Integration test `apps/api/tests/integration/auditLogImmutability.test.ts` Layer 2 asserts `has_table_privilege(app_user, 'audit_log', 'UPDATE')` is `false` — currently FAILING because the grant was never revoked.

**Classification:** structural — single class (audit-table mutability). No other tables need the same treatment in this bug (clinical tables are legitimately mutable; only audit_log + `llm_interactions` + `break_glass_sessions`? — checking: `llm_interactions` IS audit-class but BUG-037 plan doesn't extend tamper-evidence to it; scoping BUG-039 strictly to `audit_log` and filing BUG-286 for llm_interactions parity).

---

## 3. Approach

Two-layer defence (canonical pattern from legacy migration 20260412000004 + 20260331):

### Layer A — DB grant revocation
```sql
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user;
-- INSERT remains (runtime paths via rlsMiddleware still need to insert).
-- SELECT remains (audit retrieval UI reads audit_log).
```

### Layer B — BEFORE UPDATE/DELETE triggers
```sql
CREATE OR REPLACE FUNCTION audit_log_prevent_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (BUG-039 tamper-evident)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();
```

**Why BOTH layers:**
- REVOKE alone: relies on Postgres grant enforcement. A future DBA who runs `GRANT ALL ON audit_log TO app_user` to fix a different issue would silently re-open the hole.
- Trigger alone: fires for ALL roles including `dbAdmin` (owner). A compromised owner role (e.g. migration runner exploited via SQL injection in a future DDL tool) would still be blocked.
- Together: grant layer is the first-line rejection (fast-fail at Postgres planner); trigger is the defence-in-depth enforcement that cannot be bypassed by regrant.

**Trigger applies to dbAdmin too** — by design. writeAuditLog uses dbAdmin but only INSERTs. The Explore research confirms ZERO legitimate UPDATE or DELETE paths exist on audit_log anywhere in apps/api/src. 7-year retention is achieved via `DROP PARTITION` (DDL, not DML — triggers don't fire on DDL), so triggers don't block retention workflows.

### Migration file
`apps/api/migrations/20260421000002_audit_log_immutability.ts`

- Idempotent: uses `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION` so a partial prior run doesn't wedge.
- down() drops both triggers + function + re-grants UPDATE/DELETE/TRUNCATE. Honest reversal.
- `@migration-raw-exempt` annotations per CLAUDE.md §12.4 taxonomy: `revoke`, `function_create`, `trigger_create`, `drop_trigger_if_exists`, `grant`.

---

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| REVOKE only, no trigger | Defence-in-depth: a future `GRANT ALL` regression re-opens the hole silently. Trigger is the cryptographic-fact-level guarantee. |
| Trigger only, no REVOKE | Grant layer is the first-line rejection; without it, every attempted UPDATE walks through planner + BEFORE trigger (wasted work). Both layers together match the canonical pattern from legacy migrations and are idiomatic. |
| Use a BEFORE INSERT trigger to hash-chain rows (SHA-256 prev_hash/row_hash) | Scope creep — hash chain is a separate feature tracked in legacy partitioning migration (BUG-153 closed) and the v2 baseline dropped it. Re-adding hash chain is a different bug (not filed here; noted as residual). |
| Apply same fix to `llm_interactions` in this commit | Scope creep — BUG-037 already makes llm_interactions append-only at the app layer (helper never UPDATEs/DELETEs); extending tamper-evidence to the DB level there is filed as BUG-286 (S1 A-3). |
| Partition audit_log in this commit | BUG-153 was closed as "already partitioned" per legacy migration — but the v2 baseline is flat. Re-applying partitioning is a bigger change (cross-cutting retention policy + per-partition REVOKE+trigger). Separate ticket. |
| Replace trigger with `CREATE RULE ... DO INSTEAD NOTHING` | RULE on partitioned table is unsupported. Trigger approach is forward-compatible with partitioning. |
| Use PostgreSQL row-level security with policies that have `USING (false)` for UPDATE/DELETE | More complex than trigger; RLS policies interact oddly with `dbAdmin` (owner bypasses RLS), so a malicious/buggy owner-role SQL would bypass RLS. Trigger fires for all roles. |

---

## 5. Reviewer refinement trail

_To be populated after L3 + L4 + L5 subagent reviews._

---

## 6. Implementation outline

**Files touched:**
- `apps/api/migrations/20260421000002_audit_log_immutability.ts` (new — REVOKE + trigger function + 2 triggers + down())
- `apps/api/src/db/schema-snapshot.json` (regenerated; no column changes — trigger + grant changes don't affect column list but the snapshot tool may capture trigger info TBD)
- `apps/api/tests/integration/auditLogImmutability.test.ts` (EXISTING — currently failing Layer 2 asserts UPDATE+DELETE revoked; add new assertions for trigger behavior — attempt dbAdmin UPDATE → expect exception)
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` (BUG-039 entry + BUG-286 follow-up entry)
- `docs/audit-2026-04-19/bug-plans/BUG-039-audit-log-immutability.md` (this doc)
- `docs/fix-registry.md` (R-FIX-AUDIT-LOG-IMMUTABILITY anchor)

**Not touched:**
- `apps/api/src/utils/audit.ts` — writeAuditLog only INSERTs; already compatible.
- `apps/api/src/shared/recordLlmInteraction.ts` — uses writeAuditLog for secondary audit; unaffected.
- Any service/route code — zero mutation paths found in the Explore investigation.

---

## 7. Tests

Pre-existing file `apps/api/tests/integration/auditLogImmutability.test.ts` — the 2 failing tests (lines 116, 131) become passing post-fix. Adding 2 new trigger-behavior tests:

- **T.trigger-update** — `dbAdmin('audit_log').where({id: <existing}).update({action: 'TAMPERED'})` must reject with exception text containing `'audit_log is append-only'`.
- **T.trigger-delete** — `dbAdmin('audit_log').where({id: <existing}).del()` must reject with the same exception.

These assert the trigger fires even for the owner role (defence-in-depth test), complementing the REVOKE tests that target `app_user`.

**Red-first trace:** pre-migration, Layer 2 (lines 116, 131) + both new trigger tests FAIL. Post-migration, 4/4 PASS.

---

## 8. Verification trace

- **Original failing scenario:** an auditor queries `has_table_privilege('app_user', 'audit_log', 'UPDATE')` — returns `true` pre-fix (grant not revoked). Post-fix: `false`.
- **Null / empty input:** N/A — no user input surface introduced.
- **Concurrent / race:** triggers are per-row synchronous; no race window. Concurrent INSERT still works (triggers don't fire on INSERT).
- **Max payload:** N/A — no data path changes.
- **Missing env var:** N/A — migration is deterministic.
- **Expired token / auth failure:** audit INSERT still works (writeAuditLog's catch swallows). Any hypothetical UPDATE attempt would now hit trigger and raise — caller's `.catch()` already suppresses (per §9.6 audit must not block), but the exception would be logged at error level, making tamper attempts observable.
- **Concurrent UPDATE from dbAdmin (owner, which bypasses REVOKE):** trigger fires → RAISE EXCEPTION → transaction rolls back. Verified by new T.trigger-* tests.

---

## 9. Residual risk

| Risk | Mitigation | Owner |
|---|---|---|
| `llm_interactions` table is audit-class but has no equivalent REVOKE+trigger | BUG-286 (S1 A-3) files parity fix — dated SLA Wave A-3 exit | Security Approver |
| SHA-256 hash chain was dropped in v2 baseline squash — no cryptographic tamper-evidence | Out of scope for BUG-039. Filed as BUG-287 (S2 B-9) — re-implement hash chain | Security Approver |
| Partitioning was dropped in v2 baseline — no O(1) retention | BUG-153 was closed in error (partitioning is legacy-only). Filing BUG-288 (S2 B-9) to re-apply partitioning to v2 | Reviewer |
| Migration rollback re-grants UPDATE/DELETE — intentional for honest reversibility, but a down() in prod would silently re-open the hole | down() should never run in prod; CAB approval required for any irreversible migration reversal; runbook documents that down() is dev-only | Reviewer |
| Trigger RAISE EXCEPTION bubbles up to app layer | writeAuditLog's catch already swallows (per §9.6). Any code that catches this specific exception and masks it would be a bug — flagged as residual risk that operational monitoring catches. | Security Approver |

---

## 10. CAB / change-control notes

- Migration 20260421000002_audit_log_immutability.ts — risky (DDL + grant change + trigger).
- No PHI touched; no data migration.
- down() is reversible but CAB must approve; production rollback is forward-fix preferred.
- Snapshot freshness: regenerate after migration (though grant changes may not affect columns, keep the guard happy).

---

## 11. QA agent verdicts

- **L1 static:** PASS (tsc clean × 3 workspaces; migration-convention green; snapshot-freshness green; fix-registry green).
- **L2 narrative:** PASS (plan doc + catalogue + fix-registry row; pre/post-fix trace explicit).
- **L3 code judgement:** PASS — APPROVED. Key points:
  - Real structural fix (not band-aid); CHECK / app-layer alternatives correctly rejected.
  - 16/16 integration tests PASS post-fix (2 grant assertions + 2 new trigger defence-in-depth assertions for dbAdmin).
  - Pattern matches canonical archived migrations (20260331 + 20260412).
  - Observations noted non-blocking:
    - `reset-patient-data.ts:52` TRUNCATE will now fail-safe (caught + logged) — more correct for append-only audit; acceptable dev-ergonomics trade-off.
    - BEFORE triggers do NOT fire on TRUNCATE — owner-role TRUNCATE unblocked by design (retention via DROP PARTITION is DDL). Flagged to BUG-288 scope.
    - Partition propagation reminder for BUG-288 (per-partition REVOKE required).
- **L4 clinical safety:** PASS — APPROVED. Verdict: "materially MORE trustworthy under forensic review."
  - **Break-glass integrity** is the single most important clinical-safety win — break-glass audit rows (4 INSERTs at breakGlassRoutes.ts:197,300,370,421) are now cryptographically immutable at the DB engine. Defensible under Mental Health Tribunal / Coroner's court subpoena.
  - All 8 clinical-safety rules verified. No clinical guardrail weakened; every INSERT path preserved (READ audits, AI audits via LLM_AUDIT_WRITE_FAILED, break-glass).
  - Residual gaps all correctly catalogued as follow-ups (BUG-286 llm_interactions, BUG-287 hash chain, BUG-288 partitioning).
- **L5 architecture:** PASS — APPROVED. All 5 standards verified:
  - Defence in depth: 2 layers (REVOKE + trigger) with no inter-layer trust.
  - Fail fast, fail loud: exception message names BUG-039; role-existence guard is strictly-stronger than fail-loud (Layer B always installs).
  - SSoT: one canonical function per table (not a factory) — matches the forensic-traceability requirement.
  - Explicit over implicit: header comment documents every design decision; §12.4 taxonomy compliant.
  - Reversibility: honest down() with forward-fix + CAB-gate at process layer — correct separation of concerns.
  - 3 non-blocking recommendations absorbed:
    1. BUG-288 scope updated to note per-partition REVOKE requirement (triggers auto-inherit; grants do not).
    2. BUG-286 structural consistency to be enforced when it lands.
    3. Future: CLAUDE.md "tamper-evident tables require two-layer defence" policy entry (optional; current fix-registry row + catalogue cross-refs are sufficient for single-table case).
