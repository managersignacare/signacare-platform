# Bug To Class Map

This file is the compact takeover view of the remediation program.
It is not a replacement for the full bug catalogues. It is the transfer map that tells a new owner which class owns which recurrence family.

## Canonical Detailed Sources

- [bugs-remaining.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/bugs-remaining.md)
- `~/.claude/plans/streamed-dazzling-shell.md` Part 3 Phase 0c and Part 4
- `~/.claude/plans/phase-1-bug-sweep-ledger.md`
- `~/.claude/plans/full-audit-report.md`
- `~/.claude/plans/executable-test-results.md`
- `~/.claude/plans/round-2-test-results.md`

## Buckets

- `P`: platform / identity / security / access
- `S`: schema / migration / immutability / database contract
- `W`: workflow / domain transition / UI truthfulness / schedulers
- `H`: harness / verification substrate / test honesty

## Execution Classes

| Class | Bucket | Owns | Primary findings absorbed |
|---|---|---|---|
| `G1` | `P` | secret exposure response | `BUG-SECRETS-LEAKED` |
| `A1` | `P` | auth-path diagnosis and timing truth | `BUG-LOGIN-HANG`, `BUG-AUTH-CHAIN-HANGS-BROADLY` |
| `A2` | `P` | auth-path audit/outbox stabilization | `BUG-LOGIN-HANG`, `BUG-AUTH-CHAIN-HANGS-BROADLY` |
| `B1` | `S` | schema authority and generated row contract | `BUG-288`, row-shape / migration-drift family |
| `V1` | `H` | runtime honesty in probes and smoke setup | `BUG-PLAYWRIGHT-GLOBALSETUP-CATCHES`, `BUG-K6-NO-THRESHOLDS`, `BUG-DR-DRILL-EXIT-CODE-LIE` |
| `V2` | `H` | canonical persona seed and test substrate | `BUG-CANONICAL-PERSONA-SEED-MISSING`, `BUG-CONTRACT-DRIFT-400-VS-422`, `BUG-INTEGRATION-30-OF-114-FAIL` |
| `B2` | `S` | restore/bootstrap parity | `BUG-DR-RESTORE-CRITICAL-FAIL` |
| `D` | `P` | unified identity and authorization platform | `BUG-P4`, `BUG-EP-7`, `BUG-RF-2`, `BUG-RF-3`, `BUG-LG-2`, `BUG-AD-2`, `BUG-CLINICAL-ROLES-DUPLICATE-AUTOCREATE`, `BUG-RECEPTIONIST-CLINICAL-NOTES-NO-ROLE-GUARD`, `BUG-STAFF-CROSS-SITE-READ-LEAK`, `BUG-MENTAL-HEALTH-SENSITIVE-FLAG-MISSING`, `BUG-BREAK-GLASS-NO-JUSTIFICATION`, `BUG-IS-ACTIVE-BREAK-GLASS-HOLE`, `BUG-DOCTOR-ROLE-DRIFT`, `BUG-SUPERADMIN-CONTRADICTION`, `BUG-FE-RBAC-SPLIT`, `BUG-RECEPTIONIST-SEES-CLINICAL-MGMT` |
| `C1` | `W` | backend truthful failure semantics | `BUG-REFERRAL-INTAKE-CLOSE-LIE-ABOUT-SUCCESS` |
| `C2` | `W` | frontend truthful state semantics | `BUG-FE-EMPTY-STATE-LIES`, `BUG-PATIENT-LIST-ZERO-RENDER`, `BUG-PATIENT-DETAIL-SHELLS` |
| `E1` | `W` | episodes and referrals command consolidation | `BUG-EP-1..6`, `BUG-EP-8`, `BUG-EPISODE-WORKFLOW-EVENT-SILENT-CATCH`, `BUG-RF-1`, `BUG-RF-4`, `BUG-RF-5` |
| `E2` | `W` | prescribing and clozapine command consolidation | `BUG-MED-1`, `BUG-MED-2`, `BUG-CL-1`, `BUG-CL-2` |
| `E3` | `W` | ECT, TMS, oncology command consolidation | `BUG-ONC-1`, `BUG-ONC-2`, `BUG-ECT-1..3`, `BUG-TMS-1..3` |
| `E4` | `W` | legal / advance directive / MHA transitions | `BUG-LG-1`, `BUG-LG-3`, `BUG-AD-1`, `BUG-AD-3`, `BUG-AD-4` |
| `E5` | `W` | allocation / intake / staff-settings transitions | `BUG-STAFF-SETTINGS-CLINIC-ID-FILTER`, intake-close family |
| `S` | `W` | scheduler and alert reliability | `BUG-PATHOLOGY-ALERTS-NO-EMISSION`, `BUG-MHA-ALERTS-SILENT`, `BUG-WORKFLOW-ENGINE-DEGRADE-LIE`, `BUG-NOTIFICATION-FANOUT-FRAGILE` |
| `F` | `S` | immutability and monotonic DB guarantees | `BUG-AUDIT-MUTABILITY`, `BUG-PURGED-AT-MONOTONIC`, `BUG-LOCK-VERSION-MONOTONIC` |
| `P` | `P/S/W/H` | production invariants and observability | no net-new bug rows; consumes invariants from other classes |
| `G2` | `P/S` | hygiene hardening after platform rehab | `BUG-DEPS-OUTDATED`, `BUG-LICENSE-DRIFT`, `BUG-CONSOLE-LOG-PROD`, `BUG-PROD-SOURCEMAPS` |

## Transfer Rules

1. Do not close a BUG row from this program without naming its owning class.
2. If a finding spans multiple classes, split the finding instead of letting one class bleed into another.
3. If the class assignment changes, record the reason in [decision-log.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/decision-log.md).
4. If a new BUG looks like an existing class, prefer absorption over creating a brand-new class.

## Known Cross-Cutting Constraints

- `D` must stay ahead of sensitive-route FE work in `C2`.
- `E*` must land before `F` can safely harden write-time immutability.
- `S` must reconcile with `A2` where shared delivery semantics are involved.
- `V1` and `V2` are not product-fix classes; they are proof and substrate classes.
