# Engineering Execution Standard (Gold-Standard / No-Deviation)

_Authoritative execution policy for all delivery in Signacare EMR._
_Applies to **all contributors**: human developers, AI developers, and reviewers._

**Version:** 2026-05-24  
**Owner:** Architecture + Quality  
**Scope:** Repo-wide (API, web, mobile, shared packages, scripts, migrations, docs)

---

## 1) Non-Negotiable Principles

1. **Patient safety and tenant isolation first.**
2. **No shortcuts, no silent deferrals, no deceptive green.**
3. **Root-cause fixes only.** Band-aids are prohibited.
4. **Evidence before claims.** Every closure must be proved by artifacts.
5. **One source of truth per concern.** No parallel truth documents.

---

## 2) Mandatory Work Protocol (Every Change)

1. Validate scope against active freeze policy in `docs/quality/governance-control-plane.md`.
2. Define scope in writing before edits (bug/feature id + boundaries).
3. Verify existing behavior in code/tests before changing anything.
4. Implement in **small atomic slices** (single risk class per slice).
5. Run required gates (L1-L5) for that slice.
6. Record evidence and only then mark state transitions.

If any gate fails, the slice is not complete.

---

## 3) L1–L5 Gold-Standard Gate (Layer 0a gates run before L1; see CLAUDE.md §11)

### L1 — Build integrity
- Typecheck passes for all touched workspaces.
- Lint passes for touched surfaces.
- No new unsafe patterns (`any`, silent catch, fire-and-forget, drift literals).

### L2 — Functional regression
- Targeted unit/integration tests for the changed behavior.
- Adjacent critical suites remain green.
- New tests prove the fix and fail pre-fix where applicable.

### L3 — Code-quality review
- Structural correctness, maintainability, and policy adherence.
- No hidden coupling, no speculative abstraction, no unresolved TODO debt.

### L4 — Clinical safety review (when applicable)
- Required for clinical workflows, PHI paths, auth/RBAC, prescribing, legal/safety rails.
- Must pass patient-safety and compliance checks.

### L5 — Architecture review
- Tenant boundaries, transaction integrity, consistency, reversibility, drift prevention.
- Confirms no policy regressions and no new split-SSoT surfaces.

---

## 4) No-Deviation Rules

1. **No commit on red gates.**
2. **No gate bypass without explicit bug row + expiry + owner.**
3. **No open REJECT/BLOCK reviewer findings in a landed slice.**
4. **No merging mixed unrelated workstreams in one commit.**
5. **No stale artifacts left in touched surfaces** (dead code, stale docs, stale allowlist entries, stale guards).

---

## 5) Source of Truth Policy

The following are authoritative:

- Governance freeze + authority map: `docs/quality/governance-control-plane.md`
- Backlog state: `docs/quality/bugs-remaining.md`
- Fix evidence anchors: `docs/quality/fix-registry.md`
- Test and audit evidence: `docs/quality/remediation/evidence/`
- Workflow and feature SSoT: `docs/product/workflows-and-features-ssot.md`
- Product roadmap + intake SSoT: `docs/product/product-roadmap-ssot.md`
- Gate **principles** (policy): this document
- Gate **mechanics** (L1–L5 operational checks, 10-check matrix, commit-msg shape): `docs/quality/fix-build-rules.md` (single SSoT)

If any document conflicts, reconcile immediately before continuing. Conflict resolution follows the hierarchy declared in `docs/quality/governance-control-plane.md` §2.

---

## 6) Commit Discipline

1. One bug/risk family per commit (unless explicitly planned multi-bug convergence).
2. Commit message includes: scope, risk class, gates run, evidence pointers.
3. No destructive git operations without explicit approval.
4. No push until requested/authorized by project owner.

---

## 7) Guard and Drift Requirements

1. `guard:all` is the baseline quality contract.
2. `guard:hook-enforcement` must remain green to guarantee pre-commit and commit-msg attestation wiring has not drifted.
3. Any new drift class must get:
- a bug row,
- an explicit guard or test strategy,
- a closure plan with expiry discipline.
4. Guard suppressions/allowlists must be justified, time-bounded, and traceable.

---

## 8) Pre-Deployment Readiness Standard

Minimum required before deployment:

1. All S0 are closed with Layer 0a + L1-L5 evidence (per CLAUDE.md §11).
2. S1 blockers are closed or formally risk-accepted with owner/date.
3. Tenant isolation, auth, and clinical safety rails are runtime-verified.
4. No stale conflicting “source of truth” documents remain active.
5. Operational runbooks and environment contracts are complete and tested.

---

## 9) Accountability Model

- **Implementer (human/AI):** correctness + tests + evidence.
- **Reviewer:** reject incomplete or unsafe slices.
- **Architecture owner:** enforces policy coherence and drift prevention.
- **Product owner:** approves risk acceptance decisions (if any).

No role can bypass patient safety, tenant isolation, or evidence requirements.

---

## 10) Practical Enforcement

Use this document together with:
- `docs/quality/fix-build-rules.md` (detailed gate mechanics)
- `CLAUDE.md` (coding and guard conventions)
- CI guard suite (`npm run guard:all`)

When in doubt: stop, verify, and escalate with evidence.
