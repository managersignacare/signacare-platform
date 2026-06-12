# 01. Target State And Principles

## 1. Target State

The future Signacare platform should operate with explicit separation between:

- Web application runtime
- API runtime
- PostgreSQL data platform
- Key Vault secret management
- Application Insights observability
- CI/CD release provenance

Per environment, the minimum enterprise topology is:

- `signacare-web-<env>` App Service
- `signacare-api-<env>` App Service
- `signacare-pg-<env>` PostgreSQL Flexible Server
- `signacare-kv-platform-<env>` Key Vault
- `signacare-ai-web-<env>` Application Insights
- `signacare-ai-api-<env>` Application Insights
- optional `signacare-linux-fallback-<env>` lane for controlled fallback

This separation is not cosmetic. It exists to ensure:

- independent scaling
- independent deployment
- isolated secrets and identities
- traceable failures
- lower blast radius
- cleaner ownership
- auditable release control

## 2. Primary Runtime Direction

Primary hosting direction:

- Azure App Service is the main runtime model
- Windows App Service is permitted if true .NET Framework is required
- Linux remains a fallback or continuity lane, not the release-default lane

Primary API direction:

- strategic target: ASP.NET Core on .NET 10
- tolerated exception: .NET Framework only where a specific dependency makes it unavoidable

## 3. Non-Negotiable Principles

### 3.1 Preserve the original repo until parity is proven

The current original repo remains the authoritative implementation source until:

- split repo ownership is defined,
- contract publication works,
- staging parity is proven,
- CI/CD provenance is clean,
- rollback is rehearsed.

No early archival of the original repo.

### 3.2 Build once, promote many

Staging and production must deploy the exact same immutable artifacts.

No:

- rebuilds in staging
- rebuilds in production
- mutable `latest` promotion
- environment-specific code compilation during deploy

### 3.3 Contract-first integration

Web, Sara, and Viva must not hand-copy DTOs or business logic from the API.

They consume:

- generated API clients
- versioned schemas
- published contract artifacts

### 3.4 Strangler migration, not big-bang rewrite

The Node API is not replaced in one cut.

The migration must proceed by:

- contract definition
- endpoint slice migration
- parity verification
- traffic cutover
- retirement of old slices

### 3.5 App Service as the primary control plane

Primary release model:

- Azure App Service
- slot-based warmup
- manifest-verified release proof
- platform identity via managed identity
- no manual portal-only drift

Linux fallback:

- maintained
- documented
- regularly smoke-tested
- not the default release lane

### 3.6 Separation of concerns in Azure

Web, API, PostgreSQL, Key Vault, and Insights must each be separately defined and governed.

No bundled “single box” mentality in the target architecture.

## 4. What “Gold Standard” Means Here

Gold standard for this transition means:

- every change is reversible,
- every environment is reproducible,
- every deployed artifact is traceable,
- every contract change is versioned,
- every cutover is gated by parity evidence,
- every fallback path is rehearsed,
- every split boundary has an owner.

## 5. Success Criteria

This plan is complete only when:

- Web and API are independently deployable App Services
- Node API is no longer the primary production runtime
- .NET API has validated contract parity
- PostgreSQL is managed separately and cleanly
- secrets live in Key Vault with managed identity access
- observability is separated by surface
- staging is proven as the valid promotion source
- Linux fallback is available but not primary
