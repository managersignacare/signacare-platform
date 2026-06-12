# 04. Azure App Service Platform Plan

## 1. Primary Hosting Model

Primary target platform:

- Azure App Service

Primary hosting separation per environment:

- Web App Service
- API App Service
- PostgreSQL Flexible Server
- Key Vault
- Application Insights for Web
- Application Insights for API

Linux remains:

- a backup lane
- a tested fallback lane
- not the primary release-default lane

## 2. Environment Topology

For each environment:

- `dev`
- `staging`
- `prod`

Provision separately:

- Web App Service plan or isolated dedicated plan
- API App Service plan
- PostgreSQL Flexible Server
- Key Vault
- Insights resources
- VNet integration and private access where required

## 3. Required Separation

### 3.1 Web

Owns:

- browser runtime
- static assets
- web-specific app settings
- web telemetry

Does not own:

- DB credentials
- API secrets
- backend worker concerns

### 3.2 API

Owns:

- server runtime
- backend settings
- DB connectivity
- auth
- job orchestration
- backend telemetry

Does not share App Service identity or secret scope with Web unless explicitly justified.

### 3.3 PostgreSQL

Must be managed separately from app runtimes.

Requirements:

- Azure Database for PostgreSQL Flexible Server
- private networking where possible
- automated backups
- PITR enabled
- migration head validation
- performance and connection-budget monitoring

### 3.4 Key Vault

Requirements:

- separate Key Vault per environment
- managed identity access
- no secret values committed into repo
- no app setting duplication outside Key Vault without reason
- secret rotation runbook

### 3.5 Application Insights

Separate resources for:

- web
- API

At minimum.

Optional:

- dedicated worker/AI telemetry resource if the signal volume or retention profile requires it

## 4. Deployment Model

### 4.1 Primary path

- CI builds artifacts once
- release manifest generated once
- deploy by immutable digest or artifact identity
- slot-based warmup
- `/ready` verification
- `/version` verification
- swap only after proof

### 4.2 Fallback path

Linux App Service fallback lane remains:

- deployable
- smoke-tested
- documented
- out of the main release path

The fallback lane must not silently diverge from the primary platform contract.

## 5. Networking And Security

Minimum requirements:

- managed identities for App Services
- Key Vault references or managed-identity secret retrieval
- private endpoint strategy for PostgreSQL where feasible
- CORS discipline by environment
- WAF/front-door strategy defined
- TLS everywhere
- audit of secrets and config ownership

## 6. Observability

### 6.1 API Insights

Must capture:

- request telemetry
- dependency telemetry
- failed requests
- release markers
- DB latency
- downstream integration failures

### 6.2 Web Insights

Must capture:

- SPA route errors
- failed API calls
- release markers
- user-session diagnostics

## 7. IaC Standard

All primary platform resources must be provisioned and updated by IaC.

No portal-only authoritative configuration.

Required IaC ownership:

- App Services
- slots
- PostgreSQL
- Key Vault
- Insights
- identities
- access policies / RBAC
- app settings contract

## 8. Production Readiness Gates

- staging proven from CI
- release manifest proven
- slot warmup proven
- rollback path proven
- fallback Linux lane validated
- DR and restore runbooks reviewed
