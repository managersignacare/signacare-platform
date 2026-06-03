# D9 Scribe 25 — Ruthless Triage + Executable Remediation (Adopt/Reframe/Defer)

**Date:** 2026-05-22  
**Scope:** Incorporate the external PART 10 critique into a disciplined, shippable execution plan without derailing active delivery.

## 1) Executive Decision

We will **not** take the critique as-is.  
We will execute a strict triage:

1. **Adopt now (pre-deploy blockers):** risks that can cause clinical-safety, legal, tenancy, or irreversible data-integrity failure.
2. **Reframe now (same risk, corrected implementation posture):** valid concern, but with corrected thresholds/ownership or adjusted architecture.
3. **Defer with trigger (post-deploy hardening):** valuable, but not required for safe controlled release.
4. **Reject as stale/overstated:** contradicts current code or existing controls.

## 2) Adopt/Reframe/Defer Matrix

| Item | Decision | Why | Execution Lane |
|---|---|---|---|
| Risk surfacing can drift into implicit diagnosis | **Adopt** | Regulatory/compliance risk if wording and inference boundary blur | Pre-deploy |
| Safety-plan auto-draft activation without explicit patient-collaboration attestation | **Adopt** | NMHS/AHPRA governance risk | Pre-deploy |
| In-visit vs post-sign duplicate proposal materialization | **Adopt** | High workflow-noise + trust erosion | Pre-deploy |
| `mse_structured` ambiguity (flat vs JSONB, citation cardinality) | **Adopt** | Schema drift risk if unresolved before build | Pre-deploy |
| 291/court report authorisation and chain-of-custody controls | **Adopt** | Medico-legal high risk | Pre-deploy |
| AVS readability target not measured | **Reframe** | Keep feature, add measurable threshold gates | Pre-deploy baseline + post-deploy calibration |
| Model provenance logging not explicit for multi-host router | **Reframe** | Provenance exists in `llm_interactions`, but host-route traceability must be extended | Pre-deploy |
| VAD/stream bandwidth strategy unspecified | **Reframe** | Base substrate exists; require explicit SLO spec and runtime checks | Pre-deploy |
| “Thresholds are too low” critique (85/80) | **Reject (stale)** | Current PART 10 target already sets stricter precision in risk surfacing | No action |
| Multilingual readability science for all locales | **Defer** | Useful but not release-blocking once English baseline is enforceable | Post-deploy |
| k-anonymity for edit-diff analytics | **Defer** | Valuable privacy hardening once edit-tracking is enabled in production | Post-deploy |
| Group-session diarisation roadmap | **Defer with trigger** | Required before MDT/family multi-speaker mode GA | Post-deploy gate |

## 3) Architecture Decisions Locked (No More Ambiguity)

1. `mse_structured` will be **JSONB** with strict schema validation at the service boundary.
2. Every structured field that is evidence-backed will carry **`citations: Citation[]`** (not a single citation object).
3. Risk surfacing is strictly **non-diagnostic content detection** and must be labeled as clinician-review prompts.
4. Safety-plan draft rows can be auto-created, but transition to active requires explicit **patient-collaboration attestation**.
5. In-visit and post-sign drafting must share a dedup key strategy that includes semantic lineage, not just text hash.

## 4) Pre-Deployment Work Packages (P0/P1)

### WP-1 — Regulatory Boundary + Governance Hardening
- Add policy constraints and guard rails for non-diagnostic risk surfacing labels.
- Add legal review checkpoint for SaMD boundary classification (TGA intent-use posture).
- Add mandatory patient-collaboration attestation gate for safety-plan activation.

### WP-2 — Data Contract + Dedup Integrity
- Finalize and enforce `mse_structured` JSON schema.
- Enforce citation array contract (`citations[]`) for synthesised fields.
- Add cross-path dedup guard for in-visit and post-sign draft pipelines.

### WP-3 — Medico-Legal Report Controls
- Restrict 291/report generation + sign-off to authorised roles.
- Add immutable audit chain requirements for report finalisation and export events.

### WP-4 — Runtime Resilience Floor
- Define degraded mode for model-host downtime.
- Add session-recovery requirement for zero-screen interruptions.
- Pin minimum observability events for scribe pipeline failures/retries.

## 5) Post-Deployment Hardening Packages (P2)

1. Multilingual readability scoring expansion beyond English baseline.
2. Edit-diff privacy hardening (k-anonymity and retention-by-consent policies).
3. Group-session diarisation and speaker-bound extraction controls.
4. Additional human-factors calibration for risk flag fatigue metrics.

## 6) Regression-Proof Guard Program

1. Guard: no risk-flag UI wording that implies diagnosis/severity assignment.
2. Guard: `mse_structured` payload must include schema version and citation cardinality rules.
3. Guard: safety-plan activation requires collaboration attestation fields.
4. Guard: in-visit/post-sign proposal dedup key must include shared lineage token.

## 7) L1–L5 Discipline for Each Slice

1. **L1:** build/type/lint.
2. **L2:** integration tests on consent, risk-surfacing, and draft materialization paths.
3. **L3:** frontend logic tests on label semantics, visibility gating, and recovery state.
4. **L4:** guard suite plus drift/contract checks.
5. **L5:** runtime probes (disconnect/reconnect, model-host failure, cross-clinic scope checks).

## 8) This D9 Slice Delivered

1. Adopt/Reframe/Defer triage codified.
2. Architecture choices locked for `mse_structured` and citation cardinality.
3. Pre-deploy vs post-deploy execution lanes formalized.
4. Bug-ledger sync required and executed in the same change set (see `bugs-remaining.md` updates).

