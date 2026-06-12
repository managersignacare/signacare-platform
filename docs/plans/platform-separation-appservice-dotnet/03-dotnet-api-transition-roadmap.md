# 03. .NET API Transition Roadmap

## 1. Strategic Recommendation

If the requirement truly is “change the APIs from Node.js to .NET framework”, the architecture decision must be made explicitly.

### Option A: Preferred

- ASP.NET Core on .NET 10
- deployable on Azure App Service
- cross-platform
- modern LTS support model
- compatible with current enterprise DevSecOps expectations

### Option B: Allowed only if forced

- legacy .NET Framework
- Windows App Service only
- higher future migration cost
- weaker long-term portability

Gold-standard recommendation:

- choose **ASP.NET Core on .NET 10**
- use “.NET Framework” only where a hard dependency proves it unavoidable

## 2. Migration Strategy

Do not rewrite the whole API at once.

Use a strangler migration with parallel parity validation.

### Stage 1: Contract stabilization

- freeze and version the external API surface
- generate OpenAPI from the current Node surface
- classify endpoints:
  - public/stable
  - mobile-critical
  - web-critical
  - internal/admin
  - legacy/deprecated

### Stage 2: Domain decomposition

Define explicit domain slices:

- auth
- staff
- patients
- episodes
- appointments
- medications
- notes
- tasks
- assessments
- patient-app
- scribe/AI
- reporting

Each slice gets:

- endpoint list
- schema contract
- auth rules
- DB tables touched
- background job dependencies
- mobile/web consumers

### Stage 3: .NET platform foundation

Build the new .NET API shell with:

- ASP.NET Core Web API
- structured logging
- OpenTelemetry
- App Insights integration
- health/ready/version endpoints
- Key Vault secret loading
- managed identity
- PostgreSQL access layer
- authentication middleware
- authorization policy framework
- migration runner strategy

### Stage 4: Side-by-side implementation

For each domain slice:

1. implement .NET controllers/services/repositories
2. bind to the same PostgreSQL schema
3. run schema-contract tests
4. run response parity tests against Node
5. run authorization parity tests
6. mark slice as candidate for shadow traffic

### Stage 5: Shadow validation

Before traffic cutover:

- replay representative requests to both APIs
- diff:
  - status codes
  - response schema
  - nullability
  - auth outcomes
  - side effects
  - latency

No cutover until the diff is explained and approved.

### Stage 6: Incremental routing cutover

Traffic shifts should happen by slice, not by total system swap.

Preferred routing model:

- edge gateway or front-door routing
- route selected endpoint groups to .NET
- keep unmatched routes on Node

### Stage 7: Retirement

A Node slice is retired only when:

- .NET parity is proven,
- staging soak is complete,
- observability is clean,
- rollback path is documented,
- no active consumers depend on the old behavior.

## 3. Data-Layer Rules

The PostgreSQL schema remains authoritative during the transition.

No dual-write redesign unless absolutely necessary.

Rules:

- one DB schema
- shared migration discipline
- expand/contract database changes only
- no forked schema per runtime

## 4. Testing Requirements

### 4.1 Required test classes

- contract tests
- authorization parity tests
- DB side-effect tests
- integration tests
- migration tests
- performance baselines
- error-shape consistency tests

### 4.2 Required evidence

For each migrated slice:

- endpoint inventory
- parity report
- unresolved delta list
- benchmark comparison
- rollback note

## 5. AI And Background Jobs

AI and job-processing paths are higher risk and should migrate late.

Recommended order:

1. auth
2. staff
3. patient list/read surfaces
4. appointments
5. tasks
6. notes
7. medications
8. assessments
9. patient-app
10. AI/scribe/background workers

## 6. Cutover Gates

No slice can cut over unless:

- contract parity passes
- auth parity passes
- staging smoke passes
- App Insights telemetry is visible
- rollback target is defined

## 7. Anti-Patterns To Avoid

- big-bang rewrite
- schema fork
- hidden breaking contract drift
- manual DTO copying
- migrating AI first
- unversioned endpoint behavior changes
