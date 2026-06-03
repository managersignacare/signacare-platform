# Rewrite vs Remediation Decision Matrix

**Effective date:** 2026-05-07  
**Decision owner:** architecture + clinical safety governance  
**Scope:** Signacare production codebase strategy (continue remediation vs full rewrite)

## 1) Non-Negotiable Hard Gates

If any gate below is `NO`, full rewrite is **not allowed** as the primary strategy.

| Gate | Required evidence | Rewrite allowed? |
|---|---|---|
| Clinical safety parity proof | Persona-based L4/L5 parity for critical workflows (reception, nurse, GP, psych, prescribing, alerts, break-glass) | only if PASS |
| Compliance parity proof | APP/HIPAA/AHPRA/FHIR control mapping with test evidence, not policy claims | only if PASS |
| Data migration reversibility | Dry-run + rollback + checksum parity + replay plan on production-clone | only if PASS |
| Audit immutability continuity | Append-only audit invariants preserved across old/new runtime during transition | only if PASS |
| Access-control parity | Role matrix parity with CAN/CANNOT proof and break-glass auditability | only if PASS |
| Operational rollback | One-click rollback path proven in staging with zero data-loss class | only if PASS |
| Dual-run observability | Old/new path comparison telemetry and alerting deployed before cutover | only if PASS |

## 2) Weighted Strategy Score

Score each option from `1` (worst) to `5` (best), then multiply by weight.

| Criterion | Weight | Remediation score | Rewrite score |
|---|---:|---:|---:|
| Time-to-safe-delivery | 0.20 | 4 | 1 |
| Regression risk during rollout | 0.20 | 4 | 1 |
| Clinical/compliance revalidation burden | 0.20 | 4 | 1 |
| Cost and team load | 0.15 | 4 | 1 |
| Incremental value delivery | 0.10 | 5 | 1 |
| End-state architectural cleanliness | 0.15 | 3 | 5 |
| **Total weighted score** | **1.00** | **4.0** | **1.6** |

## 3) Current Decision (as of 2026-05-07)

**Primary strategy:** Continue structured remediation.  
**Reason:** rewrite fails hard-gate readiness and scores materially lower on risk-adjusted delivery.

## 4) Explicit Rewrite Trigger (Switch Criteria)

Switch from remediation to rewrite only if **all** conditions are true:

1. Hard gates in section 1 are all PASS-ready with evidence.
2. Two consecutive quarterly reviews show remediation failing to reduce S0/S1 defect inflow.
3. Weighted score gap narrows to `<= 0.5` points **in favor of rewrite**.
4. Operator-approved cutover and rollback runbook exists and is tested.
5. Clinical governance signs off the transition risk register.

## 5) Execution Rule

Until switch criteria are met, use remediation with strangler-style boundaries:

- encode safety in schema/tests/guards/CI/deploy gates
- no big-bang cutover
- no temporary bypasses without BUG-ID + expiry or permanent rationale
- every slice must be independently verifiable (L1-L5 as applicable)
