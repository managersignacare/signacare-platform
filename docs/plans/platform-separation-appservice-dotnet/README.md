# Platform Separation + Azure App Service + .NET Transition Plan

Date: 2026-06-08

This plan pack defines the enterprise-grade path to:

1. preserve the current original Signacare repo as the authoritative source until cutover,
2. continue the repo/platform split safely,
3. move to a clearly separated Azure platform model,
4. transition the API from Node.js to Microsoft .NET on Azure App Service,
5. keep the current Linux lane as a controlled fallback option rather than the primary runtime.

## File Index

- [01-target-state-and-principles.md](./01-target-state-and-principles.md)
  Target operating model, hosting topology, separation boundaries, and non-negotiable engineering rules.

- [02-repo-topology-and-ownership.md](./02-repo-topology-and-ownership.md)
  Repo split structure, ownership boundaries, artifact publication model, and preservation rules for the original repo.

- [03-dotnet-api-transition-roadmap.md](./03-dotnet-api-transition-roadmap.md)
  Detailed Node.js-to-.NET API migration strategy, parity phases, strangler rollout, contract discipline, and cutover gates.

- [04-azure-app-service-platform-plan.md](./04-azure-app-service-platform-plan.md)
  Azure landing-zone plan with clear separation of Web, API, PostgreSQL, Key Vault, and Application Insights.

- [05-execution-workstreams-and-gates.md](./05-execution-workstreams-and-gates.md)
  Mechanical execution plan, parallel workstreams, merge/deploy gates, and validation requirements.

- [06-cutover-runbook-staging-to-prod-readiness.md](./06-cutover-runbook-staging-to-prod-readiness.md)
  Staging-first cutover path, rollback model, fallback Linux lane, and production-readiness criteria.

## Executive Summary

The recommended primary target is:

- Azure App Service as the production hosting model
- separate App Services for Web and API
- Azure Database for PostgreSQL Flexible Server as the managed relational tier
- dedicated Azure Key Vault instances for platform secrets
- separate Application Insights resources per major surface
- .NET as the strategic API runtime
- Linux retained as a fallback lane, not the main release lane

Because the requested direction includes ".NET Framework", this plan distinguishes two possibilities:

1. **Preferred enterprise path:** ASP.NET Core on .NET 10 running on Azure App Service
2. **Legacy-constrained path:** .NET Framework on Windows App Service

Gold-standard recommendation:

- Choose **ASP.NET Core on .NET 10** unless there is a hard dependency on Windows-only .NET Framework libraries.
- If a true .NET Framework dependency exists, isolate it explicitly and document the exit path to .NET 10.

The remainder of this pack assumes:

- Azure App Service is the primary hosting control plane
- the original repo is preserved until parity is proven
- split repos are allowed to be overwritten/recomposed during the transition until ownership stabilizes
- no production cutover occurs until staging parity, CI provenance, and rollback controls are all proven
