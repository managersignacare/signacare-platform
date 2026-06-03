# Governance Control Plane (Freeze + Authority + Declutter)

_Effective date: 2026-05-24_
_Owner: Product, Architecture, QA_

## 1) Immediate Program Directive

### 1.1 Feature freeze (non-critical)

Effective immediately, **all non-critical net-new feature work is frozen** until current S0/S1 pre-deployment work is closed with evidence.

Allowed during freeze:

1. S0/S1 defect remediation.
2. Regression guards and drift-prevention controls.
3. Security, tenancy, auditability, and concurrency hardening.
4. Repo declutter tasks that reduce risk without behavior changes.
5. Required deployment-readiness fixes.

Not allowed during freeze:

1. New UX features unrelated to S0/S1 closure.
2. New domain modules without roadmap approval.
3. Scope-expanding refactors that are not tied to active blocker closure.

Exception rule:

1. Any exception must be recorded in `docs/quality/bugs-remaining.md` with explicit risk-owner and expiry.
2. Exception must reference the roadmap item in `docs/product/product-roadmap-ssot.md`.

## 2) Authoritative Documents Matrix (Single Source By Concern)

| Concern | Authoritative Document | Purpose |
|---|---|---|
| Open defects / risk backlog | [`bugs-remaining.md`](bugs-remaining.md) | Canonical bug/risk state and pre/post deployment disposition |
| Fix-presence anti-regression anchors | [`fix-registry.md`](fix-registry.md) | Machine-checked proof that verified fixes remain present |
| Build and coding gate mechanics | [`fix-build-rules.md`](fix-build-rules.md) | Detailed L1-L5 and guard execution rules |
| Repo-wide no-deviation execution policy | [`engineering-execution-standard.md`](engineering-execution-standard.md) | Gold-standard policy all contributors must follow |
| Remediation test/audit evidence | [`remediation/evidence/`](remediation/evidence/) | Run artifacts and closure proof |
| Workflow + feature source-of-truth | [`../product/workflows-and-features-ssot.md`](../product/workflows-and-features-ssot.md) | Canonical active workflow and feature inventory |
| Product roadmap + new feature intake | [`../product/product-roadmap-ssot.md`](../product/product-roadmap-ssot.md) | Canonical roadmap and planned feature state machine |
| Repo declutter + separation strategy | [`remediation/evidence/d10-repo-declutter-architecture-plan-2026-05-22.md`](remediation/evidence/d10-repo-declutter-architecture-plan-2026-05-22.md) | Approved architecture declutter and split-ready plan |

Conflict resolution order:

1. `CLAUDE.md`
2. `docs/quality/engineering-execution-standard.md`
3. This control-plane document
4. Concern-specific authoritative document above

## 3) Declutter and Project Separation Inclusion (Mandatory Workstream)

Declutter is now an active governed stream, not optional cleanup.

### 3.1 Pre-deployment required subset

1. Remove tracked generated/stale artifacts in safe slices.
2. Restore complete non-secret env template contracts.
3. Add/keep guards for stale-item reintroduction prevention.
4. Maintain clean ownership boundaries between core/mobile/gateway.

### 3.2 Post-deployment planned subset

1. Federated repo split (`core`, `mobile`, `gateway`) with history preservation.
2. Cross-repo contract versioning via published shared packages.
3. Archive compaction and historical evidence consolidation.

Roadmap binding:

1. Every declutter/separation slice must be represented in `docs/product/product-roadmap-ssot.md`.
2. Any deferred declutter risk must be captured in `docs/quality/bugs-remaining.md`.

## 4) Execution Sequence From This Point

1. Enforce freeze boundaries on all active slices.
2. Close S0 items first, then S1, with Layer 0a + L1-L5 evidence (per CLAUDE.md §11).
3. Run declutter pre-deployment subset in small reversible slices.
4. Keep the authoritative docs synchronized in each PR.

No slice is complete unless:

1. code/tests/guards are green for scope,
2. authoritative docs are updated,
3. stale items discovered in touched surfaces are removed or explicitly logged.
