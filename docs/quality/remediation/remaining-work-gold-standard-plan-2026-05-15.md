# Remaining Work Gold-Standard Plan (Execution-Controlled Refresh)

**Date:** 2026-05-15  
**Mode:** Planning + execution-control (no shortcuts, no quick fixes)  
**Primary sources:**  
`docs/quality/remediation/active-slice.md` (lane truth),  
`docs/quality/bugs-remaining.md` (canonical ledger),  
`docs/quality/remediation/three-bucket-authoritative-plan.md` (dependency/governance),  
`docs/quality/remediation/decision-log.md` (operator decisions).

## 0) Two-Phase Execution Model (Mandatory)

To avoid pre-deployment evidence fiction, this plan is split:

1. **Phase A — Pre-deployment readiness (synthetic/mechanical):**
   local implementation, guards, schema/contract checks, deterministic replay, seeded persona matrix.
2. **Phase B — Post-deployment closure (operational):**
   canary, burn-in, post-burn-in rerun, operational signoff, catalogue closure flips.

No bug may claim Phase B closure evidence during Phase A.
Current state (2026-05-15): deployment/canary has not started, so Phase B is not open yet.

## 1) Status Taxonomy (R0/R1/R2/R3)

1. **R0 — Pre-deployment ready:** local implementation + synthetic validation complete.
2. **R1 — Post-deployment closure pending:** waiting on canary/burn-in/post-burn-in evidence.
3. **R2 — Local engineering still required:** design/implementation not complete locally.
4. **R3 — Deferred/blocked:** blocked external or explicitly deferred by decision gate.

## 2) Evidence Baseline And C2 Provenance

`BUG-717..BUG-724` are retained in-scope with explicit provenance in `docs/quality/bugs-remaining.md` plus linked evidence files:

1. `BUG-717`: `docs/quality/remediation/evidence/c2-bug-717-audit-route-double-send-hardening-2026-05-12.md`
2. `BUG-718/719/723/724`: `docs/quality/remediation/evidence/c2-bug-718-719-723-724-route-crawler-signal-hardening-2026-05-12.md`
3. `BUG-720/721/722`: `docs/quality/remediation/evidence/c2-bug-720-721-722-runtime-warning-hardening-2026-05-12.md`

Confidence posture for these C2 entries is **HIGH** (deterministic replay evidence already captured; still R1 for rollout closure).

## 3) Feature/Module-Wise Remaining Work

| Module / Lane | Bug IDs | Expected feature/workflow | Current state | Remaining fix method | Regression-proof method |
|---|---|---|---|---|---|
| **C3 Global Gates** | `BUG-450`, `BUG-429`, `BUG-451`, `BUG-453` | CI/release gates fail-closed, reproducible | R0/R1 split | Phase A: static gate truthfulness complete; Phase B: protected-branch canary evidence packet | `guard:a11y-ci-no-dryrun`, `guard:a11y-baseline-allowlist`, `guard:safety-route-integration-coverage`, `guard:c3-noncritical-backfill-batches`, weekly cold-start |
| **C2 Runtime Honesty / Probe Fidelity** | `BUG-717`..`BUG-724` | Runtime/probe signal-clean and fail-closed | R0/R1 split | Phase A complete; Phase B host/canary replay and closure evidence | Route-crawler/runtime warning guards and signature checks |
| **A2 DB Contract / Immutability** | `BUG-287`, `BUG-315`, `BUG-334`, `BUG-706` | Hash-chain integrity + non-null invariants + migration governance | R0/R1 split | Phase A locked; Phase B staged rollout packet | NOT NULL/FK/snapshot/migration-rehearsal/chain-verifier guards |
| **A2 Deferred** | `BUG-288` | Audit-log partitioning | R3 | Stay deferred until explicit operator decision | Decision gate + explicit defer tracking |
| **A1b + A1d RBAC Convergence** | `BUG-FE-RBAC-SPLIT`, `BUG-RECEPTIONIST-CLINICAL-NOTES-NO-ROLE-GUARD`, `BUG-RECEPTIONIST-SEES-CLINICAL-MGMT` | Backend authority and FE policy convergence | R0/R1 split | Phase A synthetic persona matrix; Phase B canary persona proofs | No-direct-role-compare + persona matrix tests + route/tab policy checks |
| **A1c Break-Glass Governance** | `BUG-BREAK-GLASS-NO-JUSTIFICATION`, `BUG-IS-ACTIVE-BREAK-GLASS-HOLE`, `BUG-MENTAL-HEALTH-SENSITIVE-FLAG-MISSING` | Justification-bound and active-account-bound sensitive access | R0/R1 split | Phase A governance proof; Phase B auth burn-in and audit checks | Break-glass schema/lifecycle/sensitive-audit assertions |
| **A4a-R1 External Interop (implemented)** | `BUG-263`, `BUG-300`, `BUG-333`, `BUG-335`, `BUG-337`, `BUG-340`, `BUG-341` | Deterministic transport/interoperability | R0/R1 split | Phase B canary and partner-sim evidence for these only | Transport/retry contracts, mTLS drain, NPDS dynamic-import guard |
| **A4a-R3 External Interop (blocked/deferred)** | `BUG-260`, `BUG-261`, `BUG-301` | External dependency/backlog | R3 | Maintain blocked/deferred posture with explicit stub contracts | Stub drift checks + dependency tracker |
| **B4 Scheduler Reliability** | `BUG-570`, `BUG-572`, `BUG-573`, `BUG-574`, `BUG-575`, `BUG-576`, `BUG-581`, `BUG-582`, `BUG-586`, `BUG-587`, `BUG-588`, followups | No silent drop; tiered escalation | R0/R1 split | Phase A complete; Phase B scheduler canary + 7-day burn-in | Emission/retry/dlq/audit invariants and integration tests |
| **B4 Decision-Gated** | `BUG-593` | High-risk drug-class dynamic threshold expansion | R3 (decision-gated) | Named owner + deadline + default-if-missed before Phase B gate | Decision gate enforcement in active-slice/decision-log |
| **B1/B2/B3 Command Consolidation Families** | `BUG-567`, `BUG-563`, `BUG-561`, `BUG-289`, `BUG-322`, `BUG-323`, `BUG-324`, `BUG-404`, `BUG-461`, `BUG-415`, `BUG-EP-*`, `BUG-RF-*`, `BUG-ECT-*`, `BUG-TMS-*`, `BUG-ONC-*`, `BUG-LG-*`, `BUG-AD-*` | Command-owned workflows with scoped writes and truthful failures | R0/R1 split | Phase A family matrix complete; Phase B family rollout evidence | Controller-write/service-auth/response-shape/soft-delete/RBAC matrix guards |
| **A3 Regulatory Conformance (ADHA/eRx/IHI)** | `BUG-344`, `BUG-P1`, `BUG-N1`, `BUG-N2`, `BUG-N4`, `BUG-A5.3`, `BUG-A5.4`, `BUG-A5.7`, `BUG-N5`, `BUG-P5`, `BUG-P6`, `BUG-P7`, `BUG-303`, `BUG-304`, `BUG-305` | Regulated workflow correctness/audit completeness | R0/R1 split (local implementation complete; rollout closure pending) | Phase A local engineering complete (including prior R2 set `N1/N5/303/304/305/344`); execute Phase B operational conformance closure pack for all A3 rows | Conformance vectors, required-field checks, regulated audit-field assertions |
| **A3 Deferred** | `BUG-N3` | Non-HPD HPI-I endpoints | R3 | Keep deferred with explicit rationale | Deferred gate + explicit review checkpoint |
| **A4b Security/Privacy/Observability** | `BUG-278`, `BUG-306`, `BUG-310`, `BUG-312`, `BUG-313`, `BUG-326`, `BUG-328`, `BUG-338` | Privacy-safe logs and governance observability | R0/R1 split | Phase B host/canary operational proofs and signoff | Non-pino + third-party audit + governance/signal guards |
| **A4c Platform Hygiene / LLM Runtime** | `BUG-270`, `BUG-285`, `BUG-308`, `BUG-311`, `BUG-314`, `BUG-325`, `BUG-329`, `BUG-330`, `BUG-331` | Runtime reliability and safe LLM contracts | R0/R1 split | Phase B multi-instance canary and burn-in | Disclaimer-envelope, heartbeat, shutdown, invalidation, contract guards |

## 4) Controlled Demo-Data Reset Plan (After Phase-A CSR)

## Objectives

1. Remove stale/inconsistent demo records that hide regressions.
2. Re-seed deterministic personas and workflows for UAT.
3. Preserve schema/RBAC/audit invariants with zero bypass.

## Timing Rule

Reset runs only after **Core System Readiness (CSR)** gates are green:
C3 static gates, A3 discovery outputs, A2 schema readiness, UI fragility guards, A1 synthetic matrix, B4/B-family synthetic matrix.

## Execution Steps

1. Pre-reset checkpoint: DB snapshot + schema fingerprint + current evidence export.
2. Idempotent reset scripts only; no manual SQL edits in production-like environment.
3. Seed personas from canonical role enum only:
   `superadmin`, `admin`, `manager`, `clinician`, `receptionist`, `referral_coordinator`, `readonly`.
4. Run L0a/L1/L2 plus workflow smoke (onboarding, staff, patient, episode/referral, prescribing, scheduling, correspondence, notes).
5. Publish reset evidence artifact with snapshot hash, seed version, gate outputs, residuals.

## Guardrails

1. HPI/HPII/IHI validation is non-bypassable in reset/seed environments.
2. No RBAC middleware bypass for seed convenience.
3. No mutation of historical audit rows.

## 5) UI Fragility Hardening (Sequencing-Locked)

These guards are **preconditions** before A1/B-family Phase-B closure starts:

1. `guard:frontend-route-contract` — active (`PASS`, 2026-05-15)
2. `guard:policy-matrix-surface` — active (`PASS`, 2026-05-15)
3. `guard:response-adapter-required` — active (`PASS`, 2026-05-15)
4. `guard:e2e-selector-stability` — active (`PASS`, 2026-05-15; critical-spec scope)

## 6) Serial And Parallel Execution Map

## 6a) Serial — Phase A (Pre-deploy CSR)

1. **CSR-1:** Governance lock (`R0/R1/R2/R3`, rollback triggers, closure schema, decision gates).
   Execution control artifacts are mandatory:
   `docs/quality/remediation/phase-0-execution-control-pack.md`,
   `docs/quality/remediation/templates/module-charter-template.md`,
   `docs/quality/remediation/templates/l3-persona-matrix-template.md`,
   `docs/quality/remediation/new-bug-routing-protocol.md`.
2. **CSR-2:** C3 static fail-closed readiness.
3. **CSR-3:** A3 discovery gate output (schema/contract requirements) before A2 closure claims.
4. **CSR-4:** A2 schema readiness replay against A3 outputs. *(complete, 2026-05-15)*
5. **CSR-5:** UI fragility guards active and blocking. *(complete, 2026-05-15)*
6. **CSR-6:** A1 synthetic readiness (RBAC + break-glass). *(complete, 2026-05-15)*
7. **CSR-7:** B4 + B1/B2/B3 + A4b/A4c synthetic readiness replay. *(complete, 2026-05-15; includes deterministic drain of AD-family relationship-fixture flake)*
8. **CSR-8:** Controlled demo-data reset and smoke replay.

## 6b) Serial — Phase B (Post-deploy Closure)

1. **PD-1:** C3 operational closure evidence.
2. **PD-2:** A2 rollout closure evidence.
3. **PD-3:** A1b/A1d/A1c rollout closure evidence.
4. **PD-4:** B4 rollout closure evidence (with BUG-593 decision gate respected).
5. **PD-5:** B1/B2/B3 family rollout closure evidence.
6. **PD-6:** A4b/A4c rollout closure evidence.
7. **PD-7:** A3 operational conformance closure evidence.

## 6c) Safe Parallel Tracks (With Enforced File Boundaries)

| Track | Parallel-safe scope | Allowed write paths | Forbidden paths |
|---|---|---|---|
| **P1 Ops evidence pack prep** | A4a/A4b/A4c evidence tooling | `docs/quality/remediation/evidence/**`, `docs/operations/runbooks/**`, `scripts/**` (non-domain) | `apps/api/src/features/**`, `apps/web/src/features/**` |
| **P2 Persona walkthrough pack prep** | A1/B4/B-family test harness packs | `e2e/**`, `apps/api/tests/**`, `docs/quality/remediation/**` | Domain runtime code |
| **P3 Reset prep** | Snapshot/fingerprint/reset tooling | `apps/api/scripts/**`, `docs/quality/remediation/**` | Domain runtime code |
| **P4 A3 discovery prep** | Vector harness and contract docs | `docs/quality/**`, `apps/api/tests/**`, `packages/shared/src/**` (contract-only) | Unscoped domain behavior changes |

CODEOWNERS + guard checks must block out-of-scope edits for each parallel track.

## 7) Rollback Trigger Set (Explicit, Mandatory)

Rollback trigger set for Phase B burn-in is fail-closed and objective:

1. Authentication failure spike: **>2x baseline for 10 minutes**.
2. Critical save workflow failure: reproduced twice in canary.
3. Scheduler reliability breach: dead-letter growth anomaly or silent-emission event.
4. Cross-tenant or over-permission confirmed event: immediate rollback.
5. DR/schema-fingerprint mismatch: promotion blocked.
6. Any `5xx` surge above approved canary threshold on patient-facing critical surfaces.
7. Any audit write-failure on immutable audit surfaces.
8. Any break-glass access event without justification/audit row.

## 8) Closure Evidence Schema And Mechanical Validation

Closure records are machine-validated using:

1. Schema: `docs/quality/remediation/schemas/bug-closure-record.schema.json`
2. Registry: `.github/bug-closure-records.json`
3. Guard: `guard:bug-closure-record-schema`

Evidence packets must conform to:

4. Schema: `docs/quality/remediation/schemas/evidence-packet.schema.json`

No bug/family status flip is valid unless schema validation passes.

## 9) BUG-593 Decision Gate (Named Owner + Deadline)

1. Owner roles: **Platform lead + Operations lead** (B4 signoff authority).
2. Deadline: **2026-05-22**.
3. Default-if-missed: remains **R3 deferred** with explicit ledger note; B4 can close non-`BUG-593` scope only.
4. Trigger to activate: high-risk drug-class inventory growth above deferred threshold or CAB explicit pull-in.

## 10) Definition Of Done

A bug/family can be marked closed only when:

1. Phase A readiness (`R0`) is green with required local guards/tests.
2. Phase B rollout evidence (`R1`) is complete (canary + burn-in + post-burn-in).
3. Rollback-trigger audit is clean for the burn-in window.
4. Closure record passes schema validation.
5. `bugs-remaining.md` and `active-slice.md` are updated in the same change set.

## 11) Pre-Deployment Local Completion Snapshot (2026-05-15)

1. For `R0/R1 split` lanes already implemented locally (C3, C2, A2, A1b/A1d/A1c, A4a-R1, B4 non-decision-gated scope, B1/B2/B3 families, A4b, A4c), local engineering scope is complete.
2. These lanes now wait only on Phase-B operational evidence (`PD-1..PD-7`).
3. Pre-deployment local engineering backlog (`R2`) in active scope is currently drained; remaining work is rollout evidence (`R1`) or explicit deferred/blocked (`R3`) governance.
