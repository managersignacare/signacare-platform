# 06. Cutover Runbook: Staging To Prod Readiness

## 1. Cutover Philosophy

Cutover must be:

- incremental
- reversible
- evidenced
- slot-based
- provenance-backed

No direct live overwrite cutovers.

## 2. Staging First

Before any production consideration:

- staging must run from the new primary Azure App Service model
- staging must prove `/version` provenance
- staging must pass smoke and parity tests
- staging must prove slot warmup and swap

## 3. Required Staging Evidence

- release manifest id
- commit SHA
- artifact identity
- DB migration head
- web and API Insights traces
- fallback lane smoke proof

## 4. Linux Fallback Role

Linux remains a backup option only.

That means:

- it must be deployable
- it must be documented
- it must be smoke-tested
- it must not be the main release lane

Fallback should be invoked only under:

- failed primary platform cutover
- critical runtime incompatibility
- emergency continuity event

## 5. Rollback Model

Rollback must include:

- prior App Service slot or artifact
- prior manifest reference
- DB compatibility statement
- operator steps
- smoke after rollback

## 6. Production-Readiness Criteria

Production is not started until:

- .NET API slices required for first prod scope are proven
- Azure App Service topology is separated cleanly
- staging provenance is GitHub Actions-driven and promotable
- fallback Linux lane is healthy
- observability is complete
- operator runbooks are signed off

## 7. Final Readiness Checklist

- original repo preserved
- split repo topology approved
- App Service primary lane proven
- Linux fallback proven
- contracts versioned
- mobile repos consuming generated clients
- Node/.NET parity evidence approved
- release manifest promotion path approved

## 8. Go/No-Go Rule

No production cutover if any of these remain unresolved:

- unexplained contract drift
- unresolved auth parity gap
- DB migration ambiguity
- broken rollback
- unproven staging provenance
- stale or untested fallback lane
