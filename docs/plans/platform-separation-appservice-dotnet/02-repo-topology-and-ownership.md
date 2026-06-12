# 02. Repo Topology And Ownership

## 1. Recommended Repo Topology

Recommended long-term split:

- `signacare-platform`
  - web
  - API
  - DB migrations
  - IaC
  - deployment workflows
  - contracts
  - shared design tokens
  - runbooks

- `signacare-viva`
  - patient Flutter app
  - generated API client
  - app-specific UI and release assets

- `signacare-sara`
  - clinician Flutter app
  - generated API client
  - app-specific UI and release assets

## 2. Preservation Rule

The original repo remains intact until all of the following are true:

- split repos build cleanly,
- CI passes independently,
- contracts publish successfully,
- staging deploys from the new topology,
- rollback is rehearsed,
- operators no longer require the original repo for deploy continuity.

## 3. Overwriting The Existing Split Repo

If an earlier split repo already exists and is incomplete or architecturally wrong, it may be overwritten.

Overwrite is allowed only if:

- the original repo remains preserved,
- the new split state is generated from a documented extraction script or runbook,
- there is a clear manifest of what moved,
- the replacement does not become authoritative until validated.

## 4. Ownership Boundaries

### 4.1 Platform repo owns

- API business logic
- auth
- patient and clinician domain models
- DB migrations
- background jobs
- HL7 and external integrations
- deployment manifests
- Azure IaC
- OpenAPI and generated contract source
- release provenance logic

### 4.2 Viva repo owns

- patient app presentation
- patient app offline behavior
- patient app notification UX
- patient app release pipeline
- patient app store packaging

### 4.3 Sara repo owns

- clinician mobile presentation
- mobile workflow UX
- mobile-only caching and sync presentation
- Sara release pipeline
- store packaging

### 4.4 Shared package policy

Do not copy large shared business-logic packages into mobile repos.

Shared across repos should be limited to:

- generated client SDKs
- typed contracts
- enums
- design tokens
- UI theme artifacts where appropriate

## 5. Contract Publication Model

The platform repo must publish:

- versioned OpenAPI spec
- generated TypeScript client
- generated Dart client
- schema checksum
- release notes describing breaking/non-breaking changes

Consumption model:

- Viva and Sara pin a platform contract version
- upgrades are explicit
- breaking changes require coordinated rollout

## 6. Repo Migration Phases

### Phase A

- preserve original repo
- freeze topology assumptions
- identify canonical ownership boundaries

### Phase B

- extract Viva and Sara cleanly
- establish generated client flow
- establish independent CI

### Phase C

- reconstitute or overwrite platform split repo if needed
- move deployment/IaC ownership there
- prove staging deployment from the new platform repo

### Phase D

- demote the original repo from active deployment authority
- keep it read-only until retirement criteria are met

## 7. Definition Of Done For Repo Split

- no manual copying of API contracts into app repos
- no ambiguous ownership of deployment files
- no duplicate migrations or auth logic across repos
- all repos independently build and test
- original repo preserved until sign-off
