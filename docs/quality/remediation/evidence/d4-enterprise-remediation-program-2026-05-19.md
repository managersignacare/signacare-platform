# D4 Enterprise Remediation Program (Safety-Complete, No-Shortcut)

**Date:** 2026-05-19  
**Audience:** Principal Architecture + QA governance  
**Context:** Local, non-hosted environment with demo data; enterprise-grade EMR target state.

## 1) Decision: Commit Strategy (Locked)

1. **Commit now (documentation only):** D3/D4 and backlog synchronization in `bugs-remaining.md`.
2. **Do not commit mixed code debt as one batch.**
3. **Fixes ship as thin, risk-bounded slices** with explicit evidence packs and L1-L5 gates.

Rationale: clinical-safety changes require precise rollback/forward-fix options and unambiguous root-cause attribution.

## 2) Non-Negotiable Architecture Decisions (Freeze Before Coding)

### A) Assignment truth model (frozen)
- **Canonical clinical accountability set:** open `episodes` (`status='open'`) with `primary_clinician_id` + `clinic_id`.
- `patient_team_assignments` remains a **derived/projection layer** for team views and historical assignment context.
- Dashboard, reallocation, reports, and AI caseload tools must read from a shared canonical query contract (single service/query shape), not independent local logic.

### B) Mutation contract (frozen)
- Any operation touching episodes + assignments + transition/reallocation rows must execute in **one transaction envelope**.
- All retryable mutation APIs require **idempotency keys** and deterministic duplicate handling.

### C) Tenancy contract (frozen)
- Every write path must hard-validate actor clinic scope against target staff/team/patient entities before mutation.
- Fail closed on scope mismatch.

### D) Truthful rendering contract (frozen)
- Clinical UI cards/lists must never convert API failures into empty/zero success states.
- `failed` and `empty` are distinct states and must render distinctly.

## 3) Severity Model (Explicit Criteria)

- **S0:** patient-safety, cross-tenant exposure, regulatory or forensic-integrity failure, or silent suppression of critical alerts.
- **S1:** deploy blocker that can produce data corruption, non-atomic state, incorrect clinical workload visibility, or unbounded operational failure.
- **S2:** high-value architecture hardening that does not block safe go-live once S0/S1 controls are proven.
- **S3:** maintainability/documentation/ergonomics debt with no immediate safety or integrity impact.

Severity is assigned by **impact + exploitability + detectability**, not file size or effort.

## 4) Safety Case Layer (Mandatory)

Before closing any S0/S1 bug bundle, map it to hazard invariants:

| Hazard | Never-Event Invariant | Verification |
|---|---|---|
| HZ-01 False-zero clinical view | UI must not show zero when upstream query failed | forced 403/500 UI tests + runtime probe |
| HZ-02 Partial reassignment commit | multi-table transfer is all-or-none | fault-injection transaction tests |
| HZ-03 Cross-clinic mutation | cross-clinic target IDs never mutate | adversarial integration tests |
| HZ-04 Assignment truth drift | canonical set and projection stay consistent | drift scanner + reconciliation report |
| HZ-05 Lost/duplicate critical notification | delivery path is observable, retry-safe, deduped | queue/DLQ tests + dedupe assertions |
| HZ-06 Missed self-harm escalation | qualifying assessment signals always raise alert | threshold tests + runtime audit checks |

## 5) Re-Sequenced Execution Program (Risk-First)

### Stage 0 — Control-plane baseline (precondition; starts now)
- Evidence docs + backlog sync.
- Observability-first controls required before S0 closure:
  - correlation IDs across API + workers,
  - queue failure visibility (DLQ + alerting),
  - invariant-breach logs and dashboards.
- CI gate contract finalized (Section 8).

### Stage 1 — Data truth convergence (S0/S1)
- Implement canonical assignment query contract.
- Remove assignment-semantic divergence across dashboard/report/reallocation/AI.
- Add reconciliation scanner + repair script + validation report for existing data drift.

### Stage 2 — Transaction + idempotency hardening (S0/S1)
- Wrap reallocation/transition multi-write flows in single transaction envelopes.
- Add idempotency-key enforcement for retryable mutation surfaces.
- Add rollback/forward-fix safety tests under injected failures.

### Stage 3 — Clinical visibility correctness (S0/S1)
- Fix dashboard RBAC/data-contract mismatch and invalidation behavior.
- Enforce truthful error rendering (no `catch(()=>[])` on critical clinical cards).
- Resolve route-contract phantoms and verify frontend/backend contract parity.

### Stage 4 — Platform unblockers (S0/S1)
- Email worker production path (retry + dedupe + DLQ visibility).
- Password reset completeness.
- Env contract closure for deploy-critical integrations.

### Stage 5 — Post-deployment hardening (S2/S3 only)
- Broader envelope unification.
- Non-critical allowlist reduction.
- scale-tuning and extended chaos/load burn-in.

## 6) Data Migration + Reconciliation Protocol (Mandatory for Stage 1)

1. Snapshot baseline counts and mismatch metrics by clinic.
2. Run drift scanner:
   - open-episode accountability without matching derived assignment,
   - stale derived assignment with no matching active episode,
   - cross-clinic or dead-staff assignment anomalies.
3. Execute dry-run repair script with row-level preview.
4. Execute repair under transaction windows with audit evidence.
5. Re-run scanner and produce post-repair signed report.
6. Block rollout until mismatch residual is zero or explicitly risk-accepted in writing.

## 7) Rollback and Deployment Safety Model

- Use backward-compatible expand/contract migrations for schema changes.
- For non-reversible data migrations: use **forward-fix only** playbook with checkpoint snapshots.
- Each slice must define:
  - rollback path (code/config),
  - forward-fix path (data/schema),
  - compatibility window between API/web versions.

## 8) L1-L5 Enforcement (Deterministic)

### L1 (must pass each slice)
- `npm run -w apps/api build`
- `npm run -w apps/web build`
- `npm run typecheck`
- `npm run lint`

### L2 (integration/regression for touched hazards)
- targeted integration packs plus adversarial tests for tenancy, transaction rollback, and idempotency.

### L3 (frontend logic correctness)
- role-view and error-state rendering tests for touched surfaces.

### L4 (guard enforcement)
- no targeted-only closure for S0/S1 bundles: run relevant guard set **and** `guard:all` at slice closure.

### L5 (runtime probes)
- scripted probes for behavior claims (dashboard truthfulness, mutation atomicity, queue delivery signals, clinic isolation).

## 9) Pre-Deployment vs Post-Deployment Scope

### Pre-deployment mandatory
- all S0/S1 bugs,
- `guard:all` blocking failures,
- known critical N+1 on reassignment/transition/dashboard paths,
- assignment truth convergence + data reconciliation completion.

### Post-deployment allowed (with explicit trigger)
- S2/S3 refactors with no direct safety/integrity effect,
- broader envelope convergence outside critical paths,
- extended performance tuning requiring production-scale telemetry.

## 10) First Execution Slices (Updated)

### Slice 1 — Truth and safety foundation
- BUG-SA-001/002/004 + hazard HZ-01/HZ-04 alignment.
- Output: canonical assignment contract + false-zero protections.

### Slice 2 — Mutation integrity
- BUG-SA-003 + tenancy validation hardening (C4/H2 class) + HZ-02/HZ-03.
- Output: all-or-none reallocation/transitions with adversarial tests.

### Slice 3 — Platform delivery reliability
- BUG-WF42-EMAIL-WORKER-STUB + BUG-INFRA-ENV-CONTRACT-GAP + password-reset closure.
- Output: observable, retry-safe async delivery path and complete reset flow.

## 11) Governance

- **Single source of truth backlog:** `docs/quality/bugs-remaining.md`
- **Evidence artifacts:** `docs/quality/remediation/evidence/`
- **No closure without evidence:** code + tests + guard results + runtime verification.

## 12) D9 Integration (2026-05-22)

This program now formally includes the D9 Scribe 25 triage decisions in
`d9-scribe25-ruthless-triage-and-execution-2026-05-22.md`.

### Pre-deploy additions (must close before Azure staging cut)
- BUG-SCRIBE25-001: non-diagnostic risk-surfacing boundary (prompt + UI + schema + guard).
- BUG-SCRIBE25-002: patient-collaboration attestation gate before safety-plan activation.
- BUG-SCRIBE25-003: dedup lineage across in-visit and post-sign proposal paths.
- BUG-SCRIBE25-004: `mse_structured` contract lock (JSONB + schema version + citation cardinality).
- BUG-SCRIBE25-005: 291/court report authorization + immutable chain-of-custody.
- BUG-SCRIBE25-006: degraded/recovery behavior for scribe interruption/model-host outage.

### Post-deploy additions (explicitly deferred)
- BUG-SCRIBE25-101..104 stay deferred until telemetry-triggered windows.
- These are not release blockers once the pre-deploy six-item floor is proven.

### Execution order for D9 inside D4 stages
1. Stage 3: risk-surfacing label semantics + truthful rendering safety controls.
2. Stage 4: scribe/report governance controls + degraded-mode runtime contracts.
3. Stage 5: multilingual/privacy/diarization/fatigue calibration hardening.
