# Three-Bucket Authoritative Remediation Plan (V4.3 Execution-Controlled)

**Date:** 2026-05-11  
**Mode:** Planning-only (no product fixes in this document)  
**Revision:** v4.7 (A1b updates: BUG-710 authority decision resolved; BUG-P4 backend breach-password control landed with feature-flagged rollout posture)  
**Goal:** Consolidate all known issues from audits, v4 class mapping, and walkthrough evidence into three execution buckets with strict independent lanes, architectural-first remediation, and explicit human decision gates.

## 1) Source Evidence and Confidence

| Source | Coverage | Confidence |
|---|---|---|
| `docs/quality/bugs-remaining.md` | Canonical open/deferred/blocked bug ledger (56 open-like rows) | HIGH |
| `~/.claude/plans/streamed-dazzling-shell.md` (v4) | Recurrence-class ownership and unresolved families (P/S/W/H class map) | HIGH |
| `docs/quality/remediation/state-of-world.md` | Current gate status and hard blockers | HIGH |
| `docs/quality/remediation/bug-class-map.md` | Existing class-to-bug mapping | HIGH |
| `docs/quality/remediation/verification-matrix.md` | L0a/L1-L5 verification contract | HIGH |
| `/tmp/pwfull/{summary.txt,classified.txt,status.txt}` | Full walkthrough/e2e discovery including functional vs harness failures | HIGH |

## 2) Non-Negotiable Execution Contract

1. One lane at a time per worktree.  
2. One atomic bug-closure commit family per root-cause cluster (co-located root causes in the same lane may be closed together only when all linked BUG IDs are listed and verified in the same evidence packet).  
3. No patching symptoms; every closure must eliminate the recurrence mechanism.  
4. Every lane ships guards/tests with the fix, not afterward.  
5. No deployment-ready claim unless global gates are green in the same session.  
6. Any discovered sibling issue is either fixed in-lane or catalogued with a new BUG row in the same PR.

## 3) Three Buckets and Strict Independent Lanes

## Bucket A — Foundation, Security, and Data Contracts

### Lane A1a — Auth Chain and Lifecycle Unification
**Owns:** `BUG-LOGIN-HANG`, `BUG-AUTH-CHAIN-HANGS-BROADLY`, `BUG-CLINICAL-ROLES-DUPLICATE-AUTOCREATE`.

**Allowed write scope:** `apps/api/src/shared/auth*`, auth middleware, policy engine, role registry, `apps/web` permission gate surfaces.  
**Forbidden in this lane:** workflow command refactors (`E1-E5`) and scheduler framework (`S`).  
**Structural output required:** single auth chain for login/session lifecycle with measured stage timing and bounded-failure semantics.

**Required gates:** L0a, L1, auth-path guards, integration login/session tests, L5 auth workflow proof.

### Lane A1a — Critique Reconciliation Gate (Pre-Closure Mandatory)

1. Canonical bug-ledger reconciliation is required before closure claims:
   - `BUG-CLINICAL-ROLES-DUPLICATE-AUTOCREATE` is already fixed.
   - Any remaining A1a-owned bug IDs not present as active canonical rows in Section 8 must be explicitly reconciled (mint/update row or mark historical) in the same execution wave.
2. Bounded-failure proof must include middleware stages (`auth.middleware.revocation_check`, `auth.session_idle.get`) rather than login-controller timing only.
3. Best-effort login lifecycle stages must be bounded and observable (no silent indefinite await on session-cap checks).

### Lane A1b — Backend RBAC Policy Engine
**Owns:** `BUG-P4`, `BUG-EP-7`, `BUG-RF-2`, `BUG-RF-3`, `BUG-LG-2`, `BUG-AD-2`, `BUG-STAFF-CROSS-SITE-READ-LEAK`, `BUG-DOCTOR-ROLE-DRIFT`, `BUG-SUPERADMIN-CONTRADICTION`, `BUG-710`.

**Allowed write scope:** backend policy modules, authorization middleware, relationship checks, role-permission mapping.  
**Forbidden in this lane:** FE page-level rendering logic (except API contract fields consumed by FE).  
**Structural output required:** authoritative backend policy engine with no route-level bypass path.

**Required gates:** L0a, L1, policy guards, RBAC integration matrix, L5 protected-route workflow proof.

### Lane A1b — Verification-First Note (From Deep Critique Review)

1. `BUG-LG-2` and `BUG-AD-2` must run surface-verification first to avoid false-positive bug-fix claims.
2. `BUG-710` policy gate is now resolved (`superadmin-only` authority signed 2026-05-12); future changes to `/power-settings` must preserve this governance record or reopen with new signoff.

### Lane A1c — Break-Glass and Sensitive Access Governance
**Owns:** `BUG-BREAK-GLASS-NO-JUSTIFICATION`, `BUG-IS-ACTIVE-BREAK-GLASS-HOLE`, `BUG-MENTAL-HEALTH-SENSITIVE-FLAG-MISSING`.

**Allowed write scope:** break-glass services/routes, audit persistence paths, sensitive-record access controls.  
**Forbidden in this lane:** non-sensitive generic RBAC role mapping changes (A1b scope).  
**Structural output required:** justification-bound break-glass flow with immutable audit evidence and active-account enforcement.

**Required gates:** L0a, L1, break-glass guards, audit integrity integration tests, L5 sensitive-record workflow proof.

### Lane A1d — Frontend Permission Gate Convergence
**Owns:** `BUG-FE-RBAC-SPLIT`, `BUG-RECEPTIONIST-CLINICAL-NOTES-NO-ROLE-GUARD`, `BUG-RECEPTIONIST-SEES-CLINICAL-MGMT`.

**Allowed write scope:** FE permission hooks/components, tab/route visibility logic, unauthorized state rendering.  
**Forbidden in this lane:** backend role-policy mutation logic (A1b scope).  
**Structural output required:** FE permission surfaces consume one backend policy contract with explicit `unauthorized` UX.

**Required gates:** L0a, L1, FE permission guards, persona UI tests, L5 role-based UI flow.

### Lane A2 — Database Contract and Immutability Hardening
**Owns:** `BUG-AUDIT-MUTABILITY`, `BUG-PURGED-AT-MONOTONIC`, `BUG-LOCK-VERSION-MONOTONIC`, `BUG-287`, `BUG-288`, `BUG-315`, `BUG-334`, `BUG-355`, `BUG-706`.

**Allowed write scope:** migrations, DB triggers, schema-generation pipeline, audit/query views, integration DB bootstrap.  
**Forbidden in this lane:** FE state semantics and domain workflow logic.  
**Structural output required:** immutable/monotonic DB guarantees at schema level, canonical audited read surfaces present in all environments, generated types as sole schema contract.

**Required gates:** L0a, L1, migration guards, schema diff proof, integration suites including `limitCeilings` and `reportsRoutesHealth`, DR smoke impact check.

### Lane A2 — Mandatory Internal Sequencing (No Exceptions)

1. **A2-0 (`BUG-355`) ledger-truth correction first:** before implementation, record that the previously claimed guard is absent/ineffective and capture a failing drift-proof test artifact.
2. **A2-1 (`BUG-706`) governance lock:** keep forward-fix-only register enforcement active; no migration PR can bypass rehearsal policy checks.
3. **A2-2 (`BUG-315`/`BUG-334`) phase-separated NOT-NULL path:**
   - Phase A: schema/readiness guards + data backfill only (no `NOT NULL` lock yet),
   - Phase B: application/API contract proof shows new writes populate fields,
   - Phase C: enforce `NOT NULL` and validate constraints.
4. **A2-3 (`BUG-287`) hash-chain ordering rule:** hash-chain restoration lands **after** A2 backfills complete and uses a signed baseline marker (`system_reconciliation_baseline`) to define chain genesis. Backfills MUST NOT run against a live chain unless they emit chain-valid signed events.
5. **A2-4 (`BUG-288`) deferred posture:** remains deferred-post-staging unless DB+Security signoff explicitly changes state; no silent scope pull-in.

### A2 Cross-Lane Safety Gates (Prevents Insert Outages)

1. `BUG-315` (`clinical_notes.consent_id`) and `BUG-334` (`clinics.hpio`) cannot move to `NOT NULL` until API contract checks prove non-null writes for new records.
2. If app contract readiness is missing, A2 may land only preparatory phases (guarding/backfill) and must leave enforcement disabled.
3. Any attempt to enforce `NOT NULL` without app readiness evidence is merge-blocking.

### Lane A3 — Regulatory Conformance (ADHA/eRx/IHI)
**Owns:** `BUG-344`, `BUG-P1`, `BUG-N1`, `BUG-N2`, `BUG-N4`, `BUG-P5`, `BUG-P6`, `BUG-P7`, `BUG-A5.3`, `BUG-A5.4`, `BUG-A5.7`, `BUG-N5`, `BUG-N3`.

**Allowed write scope:** IHI/eRx/NPDS/ADHA adapters, payload builders, conformance tests, regulated audit schema.  
**Forbidden in this lane:** general workflow UI refactors unrelated to regulated flows.  
**Structural output required:** end-to-end standards conformance with authoritative contract tests and explicit fail-safe behavior.

**Required gates:** L0a, L1, regulated integration tests, conformance vector suites, audit-field completeness tests.

### Lane A4a — External Integration Transport and Interop
**Owns:** `BUG-260`, `BUG-261`, `BUG-263`, `BUG-300`, `BUG-301`, `BUG-340`, `BUG-333`, `BUG-337`, `BUG-341`, `BUG-335`.

**Allowed write scope:** integration dispatchers, transport adapters, retry/error policy modules, integration connectivity contracts.  
**Forbidden in this lane:** security/privacy log policy, dependency/license debt work, and clinical state-machine logic.  
**Structural output required:** deterministic outbound integration behavior with explicit retry/error contracts and environment-safe transport configuration.

**Required gates:** L0a, L1, integration guards, transport integration tests, L5 workflow proof where user path is affected.

### Lane A4b — Security, Privacy, and Observability Hardening
**Owns:** `BUG-278`, `BUG-306`, `BUG-310`, `BUG-312`, `BUG-313`, `BUG-326`, `BUG-328`, `BUG-338`, `BUG-SECRETS-LEAKED`.

**Allowed write scope:** security/privacy logging controls, observability pipelines, secret hygiene controls, config drift detection.  
**Forbidden in this lane:** domain workflow state-machine logic.  
**Structural output required:** privacy-safe logging posture, incident-ready auditability, and enforced observability contracts.

**Required gates:** L0a, L1, security/privacy guards, observability tests, incident containment proof where applicable.

### Lane A4c — Platform Hygiene and LLM Runtime Governance
**Owns:** `BUG-270`, `BUG-285`, `BUG-308`, `BUG-311`, `BUG-314`, `BUG-325`, `BUG-329`, `BUG-330`, `BUG-331`, `BUG-DEPS-OUTDATED`, `BUG-LICENSE-DRIFT`, `BUG-CONSOLE-LOG-PROD`, `BUG-PROD-SOURCEMAPS`, `BUG-466`, `BUG-420`.

**Allowed write scope:** dependency/license hygiene, LLM runtime guards, platform-level reliability and maintainability work.  
**Forbidden in this lane:** regulated clinical policy decisions (A3 scope).  
**Structural output required:** sustainable platform hygiene with measurable debt burn-down and LLM runtime guardrails.

**Required gates:** L0a, L1 (including global lint), hygiene guards, targeted runtime tests, build artifact checks.

### Lane Acceptance Contract (Applies To Every Lane)

| Lane | Concrete artifact(s) required | Reviewer check (non-negotiable) | Gate mapping |
|---|---|---|---|
| A1a | auth chain map doc + timing evidence + bounded-await guard proof | no duplicate auth path; timeout/fallback behavior explicit | L2/L4/L5 |
| A1b | backend policy module + route integration matrix | no direct route bypass; role/resource enforcement consistent | L2/L4/L5 |
| A1c | break-glass justification flow + immutable audit assertions | access outside care requires justification and audit row | L2/L4/L5 |
| A1d | FE permission adapter + unauthorized UI state tests | FE route/tab behavior matches backend policy matrix | L2/L5 |
| A2 | migrations + generated schema artifacts + drift guards | up/down migration rehearsal passes; no schema drift | L2/L4 |
| A3 | conformance vectors + regulated audit-field proofs | all required vectors and audit fields pass | L3/L4/L5 |
| A4a | integration transport contracts + retry/error proofs | no silent transport failure or endpoint drift | L1/L2/L4 |
| A4b | privacy-safe logging controls + incident/observability artifacts | no PHI leak path in logs; containment path proven | L1/L2/L4 |
| A4c | hygiene debt reports + runtime governance controls | debt trends monotonic; runtime rules enforced | L1/L2/L4 |
| B1 | domain command modules + transition race tests | no raw route orchestration; truthful failure contracts | L2/L4/L5 |
| B2 | prescribing command pipeline + denied-attempt audit tests | policy denials never leak as 500 | L2/L4/L5 |
| B3 | procedure/legal/AD command modules + invariant tests | no hidden side effects in read paths | L2/L4/L5 |
| B4 | scheduler framework + retry/dlq/emission tests | no silent drop path; retries/dlq observable | L2/L4/L5 |
| B5 | 6-state UI model + save/a11y workflow proofs | fetch failure never renders as empty-success | L2/L5 |
| C1 | canonical fixtures/bootstrap + contract parity tests | integration substrate deterministic across reruns | L2/L4 |
| C2 | probe hardening scripts + env fidelity checks | no fail-open probes or missing-engine false greens | L2/L4 |
| C3 | CI gate wiring + release evidence pack | full go/no-go criteria reproducible from artifacts | L1-L5 |

## Bucket B — Clinical Workflow and User-Facing Correctness

### Lane B1 — Episode/Referral Transition Engine
**Owns:** `BUG-EP-1..6`, `BUG-EP-8`, `BUG-EPISODE-WORKFLOW-EVENT-SILENT-CATCH`, `BUG-RF-1`, `BUG-RF-4`, `BUG-RF-5`, `BUG-REFERRAL-INTAKE-CLOSE-LIE-ABOUT-SUCCESS`, `BUG-EPISODE-MDT-LOOKUP-CLINIC-ID`.

**Allowed write scope:** episode/referral services/routes/commands, transition orchestration, idempotency/concurrency surfaces.  
**Forbidden in this lane:** medication/procedure/legal command families.  
**Structural output required:** canonical domain commands with transactional boundaries, no route-level raw mutation orchestration, truthful failure contracts.

**Required gates:** L0a, L1, raw-db-in-route guard set, domain integration race tests, L5 episode/referral end-to-end flows.

### Lane B2 — Medication and Prescribing Workflow Engine
**Owns:** `BUG-MED-1`, `BUG-MED-2`, `BUG-CL-1`, `BUG-CL-2`, `BUG-289`, `BUG-291`, `BUG-322`, `BUG-323`, `BUG-324`.

**Allowed write scope:** medication/prescription/clozapine services, prescribing FE flows, discipline enforcement path.  
**Forbidden in this lane:** episode/referral/legal transitions.  
**Structural output required:** single prescribing command surface with discipline checks, structured denied-attempt audit, no 500-path fallthrough for policy failures.

**Required gates:** L0a, L1, prescribing guards, medication integration suites, L5 prescribe/cancel/cease clinical flows.

### Lane B3 — Procedures/Legal/AD/Allocation Command Consolidation
**Owns:** `BUG-ECT-1..3`, `BUG-TMS-1..3`, `BUG-ONC-1..2`, `BUG-LG-1`, `BUG-LG-3`, `BUG-AD-1`, `BUG-AD-3`, `BUG-AD-4`, plus allocation/intake/staff transition residuals tied to class `E5`.

**Allowed write scope:** procedure, legal, AD, allocation/intake command modules and related repositories.  
**Forbidden in this lane:** identity platform and scheduler framework internals.  
**Structural output required:** command-layer ownership of transitions, explicit invariants, no hidden side effects in read endpoints.

**Required gates:** L0a, L1, transition command tests, legal/AD integration tests, L5 critical clinician workflows.

### Lane B4 — Scheduler and Alert Reliability Framework
**Owns:** `BUG-PATHOLOGY-ALERTS-NO-EMISSION`, `BUG-MHA-ALERTS-SILENT`, `BUG-WORKFLOW-ENGINE-DEGRADE-LIE`, `BUG-NOTIFICATION-FANOUT-FRAGILE`.

**Allowed write scope:** scheduler framework, queue/emit/retry/dlq/audit paths, notification fanout primitives.  
**Forbidden in this lane:** unrelated FE/UI surfaces.  
**Structural output required:** shared scheduler runtime with idempotency, retry policy, dead-lettering, emission audit invariants.

**Required gates:** L0a, L1, scheduler guards, unit and integration tests for emission/retry/degrade paths, invariant probes.

### Lane B5 — Frontend Truthfulness, Save-Roundtrip, and Accessibility
**Owns:** `BUG-FE-EMPTY-STATE-LIES`, `BUG-PATIENT-LIST-ZERO-RENDER`, `BUG-PATIENT-DETAIL-SHELLS`, `BUG-417`, `BUG-418`, `BUG-419`, `BUG-425`, `BUG-426`, `BUG-427`, `BUG-428`, `BUG-709`, `BUG-711`.

**Walkthrough-derived failures now catalogued as canonical BUG rows:** `BUG-709`, `BUG-711`, and `BUG-712` (all fixed by 2026-05-10; split-outs to `B1/B2/B3` where endpoint ownership required backend command-lane fixes).

**Allowed write scope:** FE route/view models, query/mutation contract adapters, UI status models, accessibility fixes, save workflows.  
**Forbidden in this lane:** backend schema/trigger changes except strict API contract alignment in paired PRs.  
**Structural output required:** 6-state truthful UI model (`unauthorized` first-class), fail-visible error semantics, end-to-end save persistence guarantees.

**Required gates:** L0a, L1, FE guards, workflow Playwright suite, accessibility suite, save-roundtrip/double-submit probes.

## Bucket C — Verification Substrate, Gates, and Release Integrity

### Lane C1 — Canonical Integration Substrate
**Owns:** `BUG-CANONICAL-PERSONA-SEED-MISSING`, `BUG-CONTRACT-DRIFT-400-VS-422`, `BUG-INTEGRATION-30-OF-114-FAIL`.

**Allowed write scope:** integration fixtures, seeders, test bootstrap/migration parity, contract assertion standardization.  
**Forbidden in this lane:** feature behavior changes unless required to restore contract truth.  
**Structural output required:** deterministic test substrate, schema-complete integration DB, consistent validation/status semantics.

**Required gates:** L0a, L1, full API integration suite, deterministic reruns for prior flake surfaces.

### Lane C2 — Runtime Honesty Probes and Environment Fidelity
**Owns:** `BUG-PLAYWRIGHT-GLOBALSETUP-CATCHES`, `BUG-K6-NO-THRESHOLDS`, `BUG-DR-DRILL-EXIT-CODE-LIE`.

**Allowed write scope:** probe scripts, DR drill scripts, perf thresholds, test runtime config, Redis/test env docs.  
**Forbidden in this lane:** product behavior logic.  
**Structural output required:** fail-closed probe behavior, environment parity, no false green from skipped/missing engines.

**Required gates:** L0a, L1, probe guard suites, k6 baseline with live target, DR drill pass with schema fingerprint artifact.

### Lane C3 — Global Gate and Coverage Closure
**Owns:** `BUG-429`, unresolved L1/L2 debt preventing global green, and authoritative release-evidence assembly for local -> GitHub -> Azure path.

**Allowed write scope:** CI workflows, coverage instrumentation, guard wiring, pre-deployment checklist evidence links.  
**Forbidden in this lane:** domain logic refactors.  
**Structural output required:** repo-wide gate truthfulness and complete go/no-go evidence model.

**Required gates:** L0a, full L1-L5 gate pass, coverage thresholds, release checklist pass.

### Lane C3 — Mandatory Sub-Lane Decomposition (Execution Order Locked)

#### C3-1 — `BUG-450` A11y Gate Truthfulness + Baseline Allowlist

**Done when:**
1. A CI guard exists that fails if protected-branch runs use `CI_A11Y_DRYRUN=true`.
2. A baseline allowlist exists for known current violations, and every suppressed item is mapped to a canonical `BUG-*` ID and expiry.
3. Guard proof is two-sided: failing fixture (known-bad dry-run/unsanctioned suppression) and passing fixture (live run + sanctioned baseline).
4. Required accessibility specs execute in CI with non-zero test count; skip/empty-run false greens are blocked.
5. New critical/serious violations outside the baseline fail CI immediately.

**Merge-blocking harness rule:** harness-only changes that reduce reported violations are forbidden unless the same PR contains an intentional product fix in the owning lane and updates the mapped `BUG-*` evidence.

**Reviewer check:** gate now fails closed for new violations while preserving visibility of existing mapped backlog.
**Gate mapping:** L1/L2/L3/L5.

#### C3-2 — `BUG-451` Clinical-Safety Integration Coverage Contract

**Done when:**
1. Safety-critical route classification is explicit and sourced from `docs/quality/l4-reviewer-checklist.md` + `.github/safety-surfaces.txt`.
2. A machine-readable route→test manifest exists with owner and harm class.
3. Required safety routes have at least one deterministic integration assertion; CI fails on unmapped/uncovered required entries.
4. CI-required safety suites cannot silently skip on environment readiness in CI mode (fail closed).

**Reviewer check:** no safety-critical route can be merged without explicit integration evidence.
**Gate mapping:** L1/L2/L4/L5.

#### C3-3 — `BUG-429` Coverage Artifact + Evidence Governance

**Done when:**
1. Coverage artifact schema is defined (`json schema + validator guard`) and generated in CI.
2. Artifact includes commit SHA, timestamp, suite list, route coverage summary, allowlist debt, and gate verdicts.
3. A consumer guard validates artifact freshness and schema before release readiness can pass.
4. `state-of-world.md` governance is bound to this artifact with named owner and refresh SLA (no stale evidence source may remain marked HIGH confidence).

**Reviewer check:** release evidence is reproducible and machine-validated, not narrative-only.
**Gate mapping:** L1/L2/L5.

#### C3-4 — `BUG-453` Backfill Batches (Explicit Boundaries)

**Batch contract:**
1. Maximum **5 routes per PR**.
2. Minimum delta per batch: either `+3` previously-uncovered routes or `+2%` route-coverage gain on non-critical inventory.
3. Hard stop after **4 batches** before mandatory re-triage and plan refresh.
4. No safety-critical route can be relegated to this backlog; those stay in C3-2.

**Done when:**
1. Remaining non-critical uncovered inventory is below agreed threshold and each residual item has owner+deadline.
2. Coverage deltas and residual list are published in the C3 evidence artifact.

**Reviewer check:** bounded backlog burn-down is measurable and cannot run indefinitely.
**Gate mapping:** L1/L2/L4/L5.

## 4) Strict Lane Independence Rules

1. Every lane runs in its own branch and worktree.  
2. A lane may only touch files in its declared scope plus shared contract files explicitly listed before implementation.  
3. Shared contract file updates must be in dedicated sync commits with both lane owners approving.  
4. A lane cannot start if its dependency lane has unresolved red gates.  
5. No mixed-bucket commit is allowed.

## 5) Lane Dependencies and Safe Parallelism

| Lane | Depends on | Parallel-safe with |
|---|---|---|
| A1a | none | A3, C2 |
| A1b | A1a | A3, C2 |
| A1c | A1a | A3, C2 |
| A1d | A1b | C2, B5 (read-only prep) |
| A2 | none | A3, C2 |
| A3 | none | A1a, A2, C2 |
| A4a | none | C2, C3 |
| A4b | none | C2, C3 |
| A4c | none | C2, C3 |
| B1 | A1b, A2, C1 | B2 (separate worktree only) |
| B2 | A1b, C1 | B1 (separate worktree only) |
| B3 | A1b, A2 | B4 |
| B4 | A2 | B3 |
| B5 | A1d, C1 | C2 |
| C1 | A2 | C2 |
| C2 | none | A1a, A1b, A1c, A1d, A2, A3, A4a, A4b, A4c, B5 |
| C3 | C1 + C2 for execution start; B5 required only for final C3 lane closure | A4a, A4b, A4c |

### Critical Path Risk Mitigation (A1 Bottleneck Contingency)

1. If A1a slips >5 working days, freeze new A1 scope and escalate to incident-style daily review.
2. B1/B2/B3 may proceed only against completed A1b acceptance artifacts; never against partial assumptions.
3. B5 may prepare non-policy UI refactors in parallel, but policy-sensitive merges are blocked until A1d passes L5.
4. Any A1 sub-lane blocked >10 working days triggers explicit re-plan signoff in `decision-log.md`.

### Execution Effort Sizing (T-Shirt)

| Lane | Estimated Size | Notes |
|---|---|---|
| A1a | M | auth chain + timing + bounded failure |
| A1b | L | backend policy engine + route matrix |
| A1c | M | break-glass + sensitive audit controls |
| A1d | M | FE policy convergence + unauthorized UX |
| A2 | L | migrations, immutability, bootstrap parity |
| A3 | XL | regulated conformance program |
| A4a | M | integration transport and interop closure |
| A4b | M | security/privacy/observability hardening |
| A4c | M | platform hygiene + LLM runtime governance |
| B1 | L | episode/referral command consolidation |
| B2 | M | medication/prescribing consolidation |
| B3 | L | procedures/legal/AD command consolidation |
| B4 | M | scheduler framework |
| B5 | L | FE truthfulness + save/a11y workflows |
| C1 | M | canonical substrate |
| C2 | M | probe/runtime fidelity |
| C3 | M | global gate/release evidence |

## 6) Mandatory Build/Test/Guard Pack Per Lane

**Determinism rule (applies to all lanes):** evidence must be reproducible from cold start (`git clone -> install -> run gates`). Local shell/session state is never accepted as a closure dependency.

1. **L0a discipline:** `npm run guard:claude-discipline:ci`.  
2. **L1 compile/lint:** `npm run typecheck` and targeted lint, with global lint required for C3 closure.  
3. **L2 structural guards:** all lane-specific guards plus any newly introduced guard for the root-cause class.  
4. **L3 unit tests:** changed helpers/policies/commands must have mutation-resistant tests.  
5. **L4 integration tests:** mandatory for any runtime/data-contract behavior change.  
6. **L5 workflow proof:** mandatory for user-facing flow changes and release claims.

### L5 Workflow Proof Definition (Unambiguous)

L5 is satisfied only when all three are present:

1. **Automated workflow evidence:** named Playwright spec files with PASS logs attached to the lane evidence packet.
2. **Clinical-safety reviewer signoff:** documented signoff in lane evidence (role + date + risk statement).
3. **Negative-path proof:** at least one unauthorized/failure-path workflow assertion for the changed surface.

### A2 Migration Rollback Gate (Mandatory)

A2 cannot close unless each migration-changing PR includes:

1. Up/down rehearsal for reversible migrations.
2. Forward path rehearsal plus compensating forward-fix rehearsal for irreversible migrations.
3. Data safety note for irreversible operations (NOT NULL/backfills/trigger behavior).

## 7) Human Decision Gates (Required Before Execution)

1. **BUG-288 timing:** keep deferred-post-staging or pull into pre-Azure execution while there is no live data yet.  
2. **RBAC policy authority:** confirm whether Clinic Manager should access `/power-settings` (probe currently expects allow, runtime denied).  
3. **ADHA scope timing:** keep as post-program or move into pre-deployment scope for enterprise-go-live.  
4. **Blocked external bugs policy:** `BUG-260/261/301` remain blocked or require stubs/contract tests now.  
5. **Playwright gate policy:** local mandatory 3-browser vs CI-only full matrix with local Chromium smoke.  
6. **Flake reopening policy:** keep `BUG-EPISODE-MDT-SAVE-RACE` closed unless rerun fail-rate breaches C1 budget (<=1% over 10 runs) or a new deterministic failure is captured.  
7. **No-explicit-any release bar:** decide whether zero explicit-any is mandatory before main push or staged ratchet accepted.  
8. **Migration standardization:** enforce one canonical migration format policy (`.ts` vs mixed `.js/.ts`) and cutover point.  
9. **New walkthrough findings triage:** any newly discovered walkthrough failure must be minted to a formal BUG ID in the same PR/session before remediation continues.  
10. **Promotion policy:** confirm that main-branch push is allowed only after C3 global gates are green in the same session.
11. **BUG-278 severity decision:** verify whether PHI is currently entering Ollama logs and classify as `S0 containment` or `S1 remediation`.
12. **BUG-706 rollback posture decision:** approve forward-fix-only declaration (with named ticket/signoff) or require fully reversible down strategy before A2 closure.
13. **C3 a11y baseline policy:** approve baseline-allowlist semantics (`BUG-*` mapping + expiry + no-silent-growth rule) for C3-1.
14. **BUG-355 ledger-truth correction:** approve immediate catalogue correction to reflect missing/ineffective guard claim before A2-2 implementation begins.
15. **Evidence freshness governance:** assign owner + SLA for `state-of-world.md` updates tied to C3 artifact publication.

## 8) Full Open Bug Inventory (From `bugs-remaining.md`)

| Severity | Bug | State | Category | Title |
|---|---|---|---|---|
| S0 | BUG-344 | open | ADHA / eRx | Full ADHA CTS v3.0.1 conformance test coverage (extends BUG-299 MVP 5-vector to full ~55-vector suite) |
| S0 | BUG-P1 | open | ADHA / eRx | Electronic EoP content redaction (DH-3945 §5) — 7 forbidden fields present in every electronic EoP today |
| S1 | BUG-260 | blocked_external | HL7 integration | HL7 SFTP outbound dispatcher |
| S1 | BUG-261 | blocked_external | HL7 integration | HL7 REST (FHIR R4 / vendor REST) outbound dispatcher |
| S1 | BUG-301 | deferred | Drug DB | NCTS / PBS / MIMS drug database ingestion pipeline |
| S1 | BUG-N1 | open | ADHA / IHI | UC.016 — Patient-details write-back to HI Service via TECH.SIS.HI.05 |
| S1 | BUG-N2 | open | ADHA / IHI | Medicare IRN mandatory (ADHA req 24065) |
| S1 | BUG-N4 | open | ADHA / IHI | 10-field HI Service disclosure audit trail (req 8028) + hi_error_log (req 5873) |
| S1 | ~~BUG-P4~~ | **fixed** | Security / auth | Password breach checking (HaveIBeenPwned k-anonymity) |
| S1 | ~~BUG-709~~ | **fixed** | Workflow / e2e | Functional failure cluster drained via child split (`BUG-714`/`BUG-715`/`BUG-716`) and same-session full workflow rerun proof |
| S1 | ~~BUG-710~~ | **fixed** | Auth / RBAC | `/power-settings` authority resolved to `superadmin` only with named signoff; runtime/probe deny-by-default convergence re-verified |
| S1 | ~~BUG-711~~ | **fixed** | Accessibility | Deterministic no-skip accessibility proof completed on required route set including patient detail |
| S1 | ~~BUG-712~~ | **fixed** | Workflow integrity | Save-roundtrip and double-submit probe + workflow persistence verification (task save, task double-submit, patient edit, subscription create) |
| S2 | BUG-263 | open | HL7 integration | HL7 outbound STAT-urgency retry profile same as routine orders |
| S2 | BUG-278 | open | LLM / residual | Verify Ollama prompt-logging config at deploy time (pre-fix PHI residual) |
| S2 | BUG-287 | open | Clinical / DB | audit_log SHA-256 hash chain re-implementation (dropped in v2 baseline squash) |
| S2 | BUG-288 | deferred-post-staging | Clinical / DB | audit_log monthly partitioning re-applied to v2 baseline (dropped in squash) |
| S2 | BUG-289 | open | Prescribing | Extend prescriber discipline allow-list for non-mental-health prescribers |
| S2 | BUG-291 | open | Prescribing | Pre-fix data-quality survey — patient_medications rows with non-prescribing prescribers |
| S2 | BUG-300 | open | HL7 integration | HL7 v2 ORM^O01 outbound pharmacy prescription order builder |
| S2 | BUG-303 | open | eRx | PBS authority-approval workflow (online API + phone-approval audit trail) |
| S2 | BUG-304 | open | eRx | Private (non-PBS) script workflow — separate numbering + pricing + non-PBS authority |
| S2 | BUG-305 | open | eRx | Script repeats + deferred dispensing workflow (3-month psychotropic repeats) |
| S2 | BUG-306 | open | Observability | Pino logger synchronous flush at shutdown priority 5 |
| S2 | BUG-310 | open | Infra / DB | Per-clinic integration-config drift detection (follow-up to BUG-043) |
| S2 | BUG-315 | open | Infra / DB | clinical_notes.consent_id NOT NULL enforcement after BUG-273 backfill |
| S2 | BUG-326 | open | Security / governance | Governance dashboard surface for LLM_ACCESS_BYPASS_ROLE audit rows |
| S2 | BUG-330 | open | LLM / scribe | Split scribeRoutes.ts god-file (follow-up to BUG-274) |
| S2 | BUG-331 | open | LLM / scribe | Ambient processor worker must re-check patient-relationship at job pickup |
| S2 | BUG-334 | open | Infra / DB | clinics.hpio NOT NULL enforcement after ops backfill (follow-up to BUG-295) |
| S2 | BUG-706 | open | Infra / DB | Rollback rehearsal failure on `20260701000056_bug_706_patient_identifier_ciphertext_width` down-migration (`VARCHAR(30)` shrink blocked by existing ciphertext width) |
| S2 | BUG-340 | open | NPDS / cancel-query | Cancel/query NPDS after clinic rename/merge resolves correct conformance ID |
| S2 | BUG-355 | open | Infra / SSoT | Operational-role SSoT between SQL literal and TS OPERATIONAL_ONLY set |
| S2 | BUG-A5.3 | open | ADHA / IHI | `patient_ihis` history table + record/number-status columns |
| S2 | BUG-A5.4 | open | ADHA / IHI | Search priority §2.5 + conflict handling (Medicare+IRN → DVA → mobile/email) |
| S2 | BUG-A5.7 | open | ADHA / IHI | Name truncation 40-char + no-overwrite on HI Service reply |
| S2 | BUG-N5 | open | ADHA / IHI | UC.011 Create Verified IHI for Newborns |
| S2 | BUG-P5 | open | eRx / ADHA | IHI record/number-status block at prescribe time (DH-3945 §3) |
| S2 | BUG-P6 | open | eRx / ADHA | Prescription audit 10-field extension (DH-3945 §2B + DH-4155 §4) |
| S2 | BUG-P7 | open | eRx / ADHA | Prescription-cancel dispense-state guard (DH-3945 §6) |
| S3 | BUG-270 | open | LLM / scribe | redactPhi recursive traversal overhead on bulk log payloads |
| S3 | BUG-285 | open | LLM / scribe | CI guard asserting every LLM response handler includes disclaimer envelope |
| S3 | BUG-308 | open | Infra / observability | Shutdown observability dashboard (per-hook duration + timeout metrics) |
| S3 | BUG-311 | open | Infra / observability | SafeScript .checked field type-level contract |
| S3 | BUG-312 | open | Infra / observability | Non-pino log paths bypass BUG-267 err serializer (seeds + observability residuals) |
| S3 | BUG-313 | open | Infra / observability | Third-party logger PHI audit (knex debug, pg driver, BullMQ) |
| S3 | BUG-314 | open | LLM / scribe | WebSocket scribe Ping/Pong heartbeats for dead-client detection |
| S3 | BUG-322 | open | Clozapine | Prescribing-denied audit row (forensic trail for blocked attempts) |
| S3 | BUG-323 | open | Clozapine | clozapineService §13 migration — remaining non-prescribing handlers |
| S3 | BUG-324 | open | Clozapine | UI defence — hide clozapine prescribing fields from non-prescriber disciplines |
| S3 | BUG-325 | open | Infra / observability | Drop dead `trg_llm_interactions_updated_at` trigger |
| S3 | BUG-328 | open | Infra / observability | Log-based alert on writeLlmAccessBypassAudit write-failure Pino error |
| S3 | BUG-329 | open | Infra / observability | Redis pub/sub for scribe revokeCache cross-process invalidation |
| S3 | BUG-333 | open | Infra / integration | keepAlive mTLS agent shutdown drain hook |
| S3 | BUG-335 | open | Infra / integration | Frontend error-code branching on ERX_NOT_CONFIGURED |
| S3 | BUG-337 | open | Infra / integration | Consolidate HPIO_FORMAT regex into `shared/hiNumbers.ts` |
| S3 | BUG-338 | open | Infra / integration | Sentry alert on BUG-296 WARN log (ops-forced STRICT_PRESCRIBER_HPII flip) |
| S3 | BUG-341 | open | Infra / integration | Static import of db/db in npdsClient.resolveNpdsConformanceId |
| S3 | BUG-N3 | deferred | ADHA / IHI | TECH.SIS.HI.31/33 non-HPD HPI-I endpoints (ADHA v5.0 req 17571/17573) |

**Temporary severity governance note:** `BUG-278` remains ledgered as S2 pending 2026-05-11 containment verification. If active PHI logging is confirmed, it is immediately reclassified to S0 under Section 13a incident track.

## 8a) Full Open-Bug Ownership Map (100% Coverage)

Every open/deferred/blocked bug from Section 8 has one primary lane home.

| BUG ID(s) | Primary lane | Closure gate minimum |
|---|---|---|
| `BUG-344`, `BUG-P1`, `BUG-N1`, `BUG-N2`, `BUG-N4`, `BUG-A5.3`, `BUG-A5.4`, `BUG-A5.7`, `BUG-N5`, `BUG-P5`, `BUG-P6`, `BUG-P7`, `BUG-N3`, `BUG-303`, `BUG-304`, `BUG-305` | A3 | L4 + L5 |
| `BUG-260`, `BUG-261`, `BUG-263`, `BUG-300`, `BUG-301`, `BUG-333`, `BUG-335`, `BUG-337`, `BUG-340`, `BUG-341` | A4a | L4 |
| `BUG-278`, `BUG-306`, `BUG-310`, `BUG-312`, `BUG-313`, `BUG-326`, `BUG-328`, `BUG-338` | A4b | L2 + L4 |
| `BUG-270`, `BUG-285`, `BUG-308`, `BUG-311`, `BUG-314`, `BUG-325`, `BUG-329`, `BUG-330`, `BUG-331` | A4c | L2 + L4 |
| `BUG-287`, `BUG-288`, `BUG-315`, `BUG-334`, `BUG-355`, `BUG-706` | A2 | L2 + L4 |
| `BUG-289`, `BUG-291`, `BUG-322`, `BUG-323`, `BUG-324` | B2 | L4 + L5 |

Mapping completeness rule: no bug may remain in Section 8 without appearing in this table.

## 9) Walkthrough Findings Catalogue Status (Catalogued Before Fixing)

All walkthrough findings are now formal BUG rows in `docs/quality/bugs-remaining.md`.

| Original walkthrough finding | Canonical BUG | Primary lane | Severity | Status |
|---|---|---|---|---|
| `audit_events_canonical` missing in integration DB | `BUG-707` | C1 | S1 | fixed |
| Redis eviction mismatch (`allkeys-lru` vs `noeviction`) | `BUG-708` | C2 | S2 | fixed |
| E2E functional failure cluster (referrals/alerts/plans/correspondence/meds/appointments/clinical lists/MAR/new-patient) | `BUG-709` | B5 (split-outs to B1/B2/B3) | S1 | fixed |
| `manager -> /power-settings` denied mismatch | `BUG-710` | A1b (paired A1d FE convergence) | S1 | fixed |
| Accessibility critical/serious failures on required routes | `BUG-711` | B5 | S1 | fixed |
| Save-roundtrip + double-submit failures | `BUG-712` | B5 (split-outs to B1/B2/B3) | S1 | fixed |
| `BUG-EPISODE-MDT-SAVE-RACE` flake rerun signal | `BUG-713` | C1 (paired B1 when command-path root cause is confirmed) | S2 | fixed |

## 10) Execution Start Recommendation

1. Run human decision gates first (Section 7).  
2. Freeze lane order for next wave as `C3 -> A2 -> C1 -> A1a -> A1b -> A1c -> A1d -> B5 -> C2`.  
3. Before any fixes in a new cycle, confirm Section 9 catalogue rows remain synced to Section 8 + Section 8a ownership.  
4. Enforce lane-level branch/worktree isolation from day one.

## 10a) Dated Execution Baseline (Initial Program Calendar)

This is the minimum control calendar required before first code merge.

| Lane | Start target | First gate target | Owner (named individual required) | Reviewer (named individual required) |
|---|---|---|---|---|
| C3 | 2026-05-12 | L2 by 2026-05-14; L5 by 2026-05-16 | `TBD-NAMED` | `TBD-NAMED` |
| A2 | 2026-05-14 | L2 by 2026-05-16; L4 by 2026-05-20 | `TBD-NAMED` | `TBD-NAMED` |
| C1 | 2026-05-16 | L2 by 2026-05-18; L4 by 2026-05-21 | `TBD-NAMED` | `TBD-NAMED` |
| A1a | 2026-05-18 | L2 by 2026-05-20; L5 by 2026-05-23 | `TBD-NAMED` | `TBD-NAMED` |
| A1b | 2026-05-23 | L2 by 2026-05-25; L5 by 2026-05-28 | `TBD-NAMED` | `TBD-NAMED` |
| A1c | 2026-05-24 | L2 by 2026-05-26; L5 by 2026-05-29 | `TBD-NAMED` | `TBD-NAMED` |
| A1d | 2026-05-28 | L2 by 2026-05-30; L5 by 2026-06-02 | `TBD-NAMED` | `TBD-NAMED` |
| B5 | 2026-05-30 | L2 by 2026-06-01; L5 by 2026-06-04 | `TBD-NAMED` | `TBD-NAMED` |
| C2 | 2026-06-03 | L2 by 2026-06-04; L4 by 2026-06-06 | `TBD-NAMED` | `TBD-NAMED` |

Execution block rule: lanes with `TBD-NAMED` owner/reviewer cannot start.

## 10b) Lane Status Snapshot (2026-05-12)

| Lane | Status | Rationale |
|---|---|---|
| C1 | closed-for-current-scope | Section 9 C1 walkthrough rows are fixed (`BUG-707`, `BUG-713`), and no open C1 rows remain in Section 8a. |
| C2 | closed-for-current-scope | Section 9 C2 walkthrough row is fixed (`BUG-708`), and no open C2 rows remain in Section 8a. |
| A1a | implementation-complete-rollout-pending | Auth-chain bounded-stage hardening + map/timing artifacts + L5 auth workflow proof are complete in-repo; rollout closure evidence remains external. |
| A1b | implementation-complete-rollout-pending | `BUG-710` authority decision and `BUG-P4` backend breach-password controls are complete in-repo with evidence; canary/burn-in closure evidence remains external. |
| A1c | not-closable-yet | No active Section 8a row currently maps here, but no staffed owner/reviewer cycle evidence exists for a formal green declaration. |
| A1d | not-closable-yet | No active Section 8a row currently maps here, but lane artifacts and staffing evidence are not declared for formal closeout. |
| B1 | not-closable-yet | No active Section 8a row currently maps here, but lane artifacts and staffing evidence are not declared for formal closeout. |
| B3 | not-closable-yet | No active Section 8a row currently maps here, but lane artifacts and staffing evidence are not declared for formal closeout. |
| B4 | not-closable-yet | No active Section 8a row currently maps here, but lane artifacts and staffing evidence are not declared for formal closeout. |
| B5 | open | Walkthrough pair fixed, but lane-level frontend truthfulness backlog remains active beyond Section 9 walkthrough rows. |
| C3 | open | Program-exit/global-gate lane; cannot close before Section 17a conditions are satisfied. |

## 11) Release Safety Contract (Mandatory For Every Lane)

1. **Feature-flag first deployment:** every behavior change in A1a/A1b/A1c/A1d/A2/B1/B2/B3/B4/B5 must ship behind a named flag with owner, default, and expiry.
2. **Canary progression:** `local -> GitHub CI -> Azure canary ring (internal users only) -> full rollout`.
3. **Rollback readiness:** no rollout starts without documented rollback command sequence and data rollback posture (forward-fix or reverse migration).
4. **No irreversible cutover without checkpoint:** pre-cutover backup snapshot + schema fingerprint artifact required.
5. **Kill switch required for high-risk surfaces:** auth, policy enforcement, schedulers, and AI-assisted clinical paths must each have an explicit disable path.

### Feature Flag Registry and Lifecycle Governance

1. Every flag must be registered in a single manifest (`docs/quality/remediation/feature-flag-registry.md`) with: key, owner, lane, default, rollout %, expiry date, cleanup BUG.
2. Flags without expiry are merge-blocking.
3. Expired flags are release-blocking until removed or re-approved.
4. C3 closure requires flag-debt report showing zero expired flags.

### Deployment Classification Model (Replaces Blanket Flag Assumption)

Every change must be classified before implementation:

1. **Class F (Flaggable app behavior):** API/FE behavior changes; must use feature flags.
2. **Class M (Migration/Schema/Trigger change):** generally not safely toggled by app flag; requires migration safety gates and rollback posture.
3. **Class I (Infrastructure/runtime config):** canary + rollback controls mandatory; feature flag optional based on runtime topology.

Classification rules:

1. A2 defaults to **Class M** unless explicitly justified otherwise.
2. A1/B*/A4c defaults to **Class F** unless change is schema-affecting.
3. A4a/A4b/C2 may include **Class I** changes and must include explicit runtime rollback instructions.

## 12) Rollout Stages and Hard Gates

| Stage | Required PASS | Auto-BLOCK Condition |
|---|---|---|
| Local readiness | L0a/L1/L2/L3 + lane L4/L5 scope | any red gate or uncatalogued new failure |
| GitHub PR | full required matrix for touched lane + no new guard allowlist debt | guard drift, flaky rerun mismatch, missing evidence links |
| Azure canary | smoke workflows + critical-path SLOs + no Sev0/Sev1 regression | rollback trigger fired once |
| Full rollout | 24h burn-in PASS | any rollback trigger or unresolved Sev1 |

### Canary Ring Operational Model (Azure)

1. **Ring definition:** internal staff-only tenant segment, no public patient traffic.
2. **Promotion control:** manual promotion by Operations lead after SLO dashboard review.
3. **Monitoring cadence:** 30-minute checks for first 4 hours, then hourly through burn-in.
4. **Observability source:** dashboards linked in `verification-matrix.md`; no ad-hoc screenshots as sole evidence.
5. **Skip prohibition:** canary stage cannot be skipped except Sev0 emergency rollback path.

## 13) Rollback Trigger Matrix

| Trigger | Threshold | Action |
|---|---|---|
| Authentication failure spike | >2x baseline for 10 minutes | immediate rollback of active auth/policy rollout |
| Save workflow failure | any critical workflow save failure reproduced twice in canary | halt rollout, open BUG, revert lane release |
| Scheduler emission failure | dead-letter growth or zero-emission anomaly for active jobs | disable job via kill switch + rollback scheduler slice |
| Cross-tenant or over-permission event | any confirmed event | immediate rollback + incident review |
| DR/readiness regression | DR drill failure or schema-fingerprint mismatch | promotion blocked until fixed and reverified |

## 13a) Security Incident Containment Track (Parallel To Lane Work)

For `BUG-SECRETS-LEAKED`, `BUG-STAFF-CROSS-SITE-READ-LEAK`, and any confirmed `BUG-278` PHI logging:

1. Immediate containment starts outside normal lane cadence.
2. Containment owner opens incident record and documents timeline.
3. Remediation lane work continues, but containment SLA is measured in hours, not sprint windows.
4. Incident remains open until containment evidence and regression guards are merged.

## 14) Stability SLO / Error Budget Pack

| Domain | SLO Target | Error Budget Policy |
|---|---|---|
| Login/auth | p95 login latency <= agreed baseline + 20% and failure rate < 1% | budget breach blocks further feature rollout in A1* / A2 |
| Critical save workflows | >=99.5% successful save/commit in canary | two consecutive breaches require rollback |
| Scheduler reliability | >=99.9% emission success, no silent drops | any silent-drop event is zero-budget Sev1 |
| Integration substrate | deterministic integration reruns; flaky-fail rate <=1% over 10 reruns | breach blocks merge for C1/C2 lanes |
| Accessibility | zero critical/serious violations on required routes | any violation blocks B5 promotion |
| DR readiness | RTO <= 60 min, RPO <= 15 min target | DR breach blocks C3 closure and Azure promotion |

**SLO telemetry rule:** each SLO must map to a concrete query/dashboard; missing telemetry mapping is a release-blocking defect.

## 15) Regression Ratchet Policy

1. No new `@typescript-eslint/no-explicit-any` violations allowed; count must be monotonic non-increasing.
2. No new guard allowlist entries without BUG ID + expiry date.
3. Mutation-resistance expectation for high-risk logic: changed predicate/state logic must include inversion-catching tests.
4. Flake containment: newly introduced flaky tests are merge-blocking.
5. Coverage floors:
   - policy/auth/security modules: non-decreasing line and branch coverage
   - transition command modules: non-decreasing branch coverage
   - scheduler framework: non-decreasing branch coverage
6. Any rollback-trigger incident automatically creates a regression test requirement before re-release.

## 16) Operational Governance and Human Signoff

| Decision Area | Required Signoff |
|---|---|
| Access policy changes (A1) | Security lead + Clinical lead |
| DB immutability/trigger changes (A2) | DB lead + Security lead |
| Regulated ADHA/eRx changes (A3) | Compliance lead + Clinical governance |
| Integration transport and interop changes (A4a) | Platform lead + Operations lead |
| Security/privacy/observability changes (A4b) | Security lead + Operations lead |
| Platform hygiene + LLM runtime changes (A4c) | Engineering lead + Platform lead |
| Scheduler reliability framework (B4) | Platform lead + Operations lead |
| UI truthfulness/RBAC UX (B5) | Product owner + Clinical safety reviewer |
| Global release readiness (C3) | Engineering lead + Operations lead |

**Change freeze rule:** no multi-lane merges within 24 hours of planned Azure promotion unless incident-driven and approved by Engineering lead.

### Execution Cadence (Required)

1. **Daily lane standup note:** completed, blocked, next gate target, risk.
2. **Weekly gate review:** lane status `green/yellow/red` with blocker owner and ETA.
3. **Single source-of-truth board:** `docs/quality/remediation/active-slice.md` + linked lane evidence files; no hidden state in chat-only updates.

### Capacity and Allocation Assumptions

1. Minimum staffing assumption for parallel lane model: 4 engineering lanes active at once (`A*`, `B*`, `C*` mixed), plus 1 QA owner for catalogue/gate integrity.
2. If active staffing falls below this threshold, parallelism must be reduced and dependencies re-baselined in `active-slice.md`.
3. No lane may declare green if its assigned reviewer/signoff roles are unstaffed for that cycle.

## 17) Closure and Burn-In Definition

A BUG is not closed at code-merge time. Closure requires:

1. Fix merged with required tests/guards.
2. Canary evidence attached and green.
3. Burn-in window complete (minimum 24 hours for code-path changes; 7 days for scheduler/authorization changes).
4. No rollback triggers during burn-in.
5. Post-burn-in verification rerun linked in evidence artifact.

If any condition fails, state returns to `open` or `paused` with explicit reason.

## 17a) Plan-Level Definition of Done (Program Exit)

The remediation program is complete only when all conditions hold:

1. All S0/S1 bugs in active scope are closed or explicitly waived by signed operator decision.
2. C3 global gates are green in the same session with linked evidence.
3. Section 9 walkthrough findings remain catalogued and are resolved or explicitly deferred with approved rationale.
4. No open Sev0/Sev1 security incidents remain.
5. ADHA/regulatory scope disposition is explicitly signed off (in-scope complete or approved post-program boundary).

## 18) Decision Deadlines (Execution Gate)

All Section 7 decisions must be resolved before lane execution starts.

| Decision (from Section 7) | Owner | Due Date | Default If Missed |
|---|---|---|---|
| BUG-288 timing | DB lead | 2026-05-12 | remains deferred; cannot be silently pulled in |
| `/power-settings` RBAC authority | Security lead + Product owner | 2026-05-12 | deny by default; BUG row created for policy mismatch |
| ADHA scope timing | Compliance lead | 2026-05-13 | remains post-program; no implied closure |
| blocked external policy (`260/261/301`) | Platform lead | 2026-05-13 | keep blocked, add contract-test stubs |
| Playwright gate policy | QA lead | 2026-05-12 | CI 3-browser mandatory, local Chromium minimum |
| flake reopening policy (`BUG-EPISODE-MDT-SAVE-RACE`) | QA lead + Domain lead | 2026-05-12 | if fail-rate budget is breached, reopen immediately with fresh evidence packet |
| explicit-any release bar | Engineering lead | 2026-05-13 | ratchet mode; zero required only at C3 closure |
| migration format standard | DB lead | 2026-05-12 | `.ts` canonical for new migrations |
| Section 9 walkthrough-catalogue sync enforcement | QA lead | 2026-05-11 | execution blocked if any walkthrough finding lacks a canonical BUG row |
| promotion policy to main/Azure | Engineering lead + Operations lead | 2026-05-13 | no promotion without C3 green same session |
| BUG-278 severity + containment decision | Security lead + Compliance lead | 2026-05-11 | treated as S1 and blocked from release until verified |
| BUG-706 rollback posture decision | DB lead + Security lead | 2026-05-10 | remains release-blocking; rehearsal must fail closed until approved |
| C3 a11y baseline policy (`BUG-450`) | QA lead + Product owner | 2026-05-12 | C3-1 cannot start without approved baseline semantics |
| BUG-355 ledger-truth correction | Security lead + DB lead | 2026-05-12 | A2-2 blocked until catalogue reflects true guard state |
| Evidence freshness governance owner + SLA | QA lead | 2026-05-12 | `state-of-world.md` downgraded from HIGH-confidence input until owner/SLA is recorded |

## 18a) Decision Status Snapshot (As Of 2026-05-12)

| Decision | Status | Source of Truth |
|---|---|---|
| BUG-706 rollback posture | **Resolved** (`approved-forward-fix-only`) | `decision-log.md` entry 2026-05-09 + forward-fix register |
| BUG-288 timing | **Pending** (deadline 2026-05-12 not yet elapsed) | this plan Section 18 |
| `/power-settings` RBAC authority | **Resolved** (`superadmin-only`) | named Security+Product signoff recorded 2026-05-12 + `BUG-710` fixed row |
| C3 a11y baseline policy | **Pending** | this plan Section 18 |
| BUG-355 ledger-truth correction | **Resolved** (`A2-0 evidence captured`) | `decision-log.md` entry 2026-05-11 + `docs/quality/remediation/evidence/bug-355-a2-0-ledger-truth-2026-05-11.md` |

## 19) Plan Quality Checklist (Self-Enforcement)

Before execution begins, verify:

1. All Section 18 decisions have owner confirmation.
2. Every active lane has explicit rollback and canary evidence templates.
3. Global gate dashboard links are attached in `verification-matrix.md`.
4. Section 9 walkthrough findings are mapped to canonical BUG rows and remain synced with Section 8/8a.
5. `active-slice.md` points to the first selected lane with DoD and file scope.
6. Feature-flag registry has no missing owner/expiry fields.
7. A2 migrations include rollback posture proof.
8. L5 evidence includes automation + clinical signoff + negative-path assertions.
9. Section 8 and Section 8a remain one-to-one complete (no unmapped open bug).
10. No lane in Section 10a has `TBD-NAMED` owner/reviewer at start.
11. C3/A2 evidence pack includes at least one cold-start replay log (no dependency on reused shell/session state).
