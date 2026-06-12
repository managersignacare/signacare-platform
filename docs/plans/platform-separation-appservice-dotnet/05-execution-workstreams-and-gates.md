# 05. Execution Workstreams And Gates

## 1. Program Structure

This must run as a controlled multi-workstream program.

Recommended workstreams:

- W1: architecture and contracts
- W2: repo split and artifact publication
- W3: .NET API foundation
- W4: Azure App Service platform separation
- W5: CI/CD and release provenance
- W6: parity testing and cutover controls
- W7: staging validation and fallback readiness

## 2. Workstream Detail

### W1: Architecture and contracts

Deliverables:

- API surface inventory
- domain ownership map
- contract publication model
- ADR on .NET 10 vs .NET Framework

Gates:

- reviewed by platform owner
- signed-off by deployment owner

### W2: Repo split and artifact publication

Deliverables:

- original repo preservation plan
- split repo extraction runbook
- generated client publication pipeline
- app repo dependency pinning model

Gates:

- extraction repeatable
- no copied DTO drift

### W3: .NET API foundation

Deliverables:

- .NET service bootstrap
- auth foundation
- observability foundation
- DB access foundation
- release metadata endpoints

Gates:

- builds in CI
- health/ready/version endpoints live

### W4: Azure platform separation

Deliverables:

- separate Web/API App Services
- separate Insights resources
- Key Vault wiring
- PostgreSQL separation validation
- slot topology

Gates:

- all resources declared in IaC
- no portal-only required settings

### W5: CI/CD and release provenance

Deliverables:

- build-once pipeline
- manifest generation
- staging deploy path
- provenance proof in `/version`
- rollback metadata

Gates:

- immutable artifact proof
- no target rebuilds

### W6: Parity testing and cutover controls

Deliverables:

- Node vs .NET parity harness
- endpoint diff reports
- auth parity suite
- side-effect parity suite

Gates:

- no unexplained material drift

### W7: Staging validation and fallback readiness

Deliverables:

- staging smoke pack
- slot-swap runbook
- Linux fallback runbook
- production cutover checklist

Gates:

- staging soak passes
- fallback validated

## 3. Sequencing

Execution order:

1. W1 architecture/contracts
2. W4 platform separation skeleton
3. W5 CI/CD hardening
4. W2 repo split publication model
5. W3 .NET API foundation
6. W6 parity and slice migration
7. W7 staging and fallback validation

## 4. Merge Gates

No merge without:

- tests for the touched slice
- deployment impact note
- contract impact note
- rollback note

## 5. Environment Gates

### To staging

- CI green
- artifact manifest produced
- contract checks green
- IaC drift check green

### To prod

- staging provenance proven
- staging soak complete
- fallback lane healthy
- promotion artifact identical to staging-approved release

## 6. Program-Level Risks

Top risks:

- underestimating contract drift
- using true .NET Framework unnecessarily
- split repo ownership confusion
- portal drift in Azure
- hidden mobile dependency on old API quirks
- fallback lane bit-rot

Each risk needs an owner and review cadence.
