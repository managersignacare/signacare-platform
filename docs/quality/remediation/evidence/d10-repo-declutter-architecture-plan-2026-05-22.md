# D10 Repo Declutter + Architecture Partition Plan

**Date:** 2026-05-22  
**Mode:** Full-repo architecture review and executable declutter strategy  
**Goal:** Keep Signacare codebase clean, enterprise-governed, and split-ready without destabilizing clinical delivery.

## 1) Executive Verdict

The repository is functionally rich but structurally overloaded.  
Current shape mixes:

1. Core EMR platform (`apps/api`, `apps/web`, `packages/shared`, `packages/ui-components`)
2. Two Flutter clients (`apps/mobile` Sara, `apps/patient-app` Viva)
3. Separate gateway stack (`apps/emr-gateway`, Mongo/Mongoose)
4. Heavy remediation/archive documentation and guard assets

This is workable, but creates governance drift risk and operational noise.  
Recommended target: **federated project boundary with strict contracts**.

## 2) Evidence Snapshot (Current State)

1. Top-level footprint shows high mixed-stack density:
   - `apps` ~1.9G local footprint
   - Flutter build caches present under both mobile apps (`build/`, `.dart_tool/`)
2. Tracked files currently include ignored/generated artifacts:
   - `apps/mobile/android/.gradle/**`
   - `apps/mobile/android/local.properties`
   - `apps/mobile/android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java`
   - `apps/api/test-results/.last-run.json`
   - `test-results/.last-run.json`
3. Tracked zero-byte/stale files exist:
   - `.env.example` (0B)
   - `apps/api/db.sqlite` (0B)
   - `apps/web/vim/nano` (0B)
   - `apps/web/src/features/flags/hooks/usePatientFlags.ts` (0B)
   - `apps/web/src/features/lai/components/AimsAssessmentPanel.tsx` (0B)
4. Config posture is inconsistent:
   - `.env.production` is tracked while root `.env.example` is empty.
5. CI coverage is not symmetric across stacks:
   - GitHub Actions heavily validate TypeScript platform paths.
   - No equivalent build/test/release gates for Flutter app-store artifacts inside the same CI lane.
6. Boundary ambiguity exists:
   - `apps/emr-gateway` is a separate runtime stack and deployment lifecycle but co-located with core.

## 3) Architecture Recommendation (Target Shape)

### Recommended boundary model

1. **Project A — `signacare-core` (keep monorepo):**
   - `apps/api`
   - `apps/web`
   - `packages/shared`
   - `packages/ui-components`
   - `e2e`, core `scripts`, core `deploy`, compliance docs required for core release
2. **Project B — `signacare-mobile` (separate repo):**
   - `apps/mobile` (Sara)
   - `apps/patient-app` (Viva)
   - mobile release docs/checklists
3. **Project C — `signacare-gateway` (separate repo):**
   - `apps/emr-gateway`
   - independent env/runbook, deployment, security ownership

### Why this is best

1. Clean ownership boundaries and release cadences
2. Smaller PR blast radius per product line
3. Independent CI gates per stack (Node vs Flutter vs Gateway)
4. Easier security and secrets posture by product surface
5. Lower regression risk from cross-stack incidental changes

## 4) Declutter Program (No-Shortcut Execution)

### Phase 0 — Safety Freeze and Classification (mandatory first)

1. Freeze destructive cleanup until file ownership map is signed.
2. Tag every top-level path as one of:
   - `core-runtime`
   - `mobile-runtime`
   - `gateway-runtime`
   - `deployment`
   - `evidence/audit`
   - `scratch/generated`
3. Enforce no blind deletes: every removal must have path-level rationale.

### Phase 1 — Immediate Low-Risk Cleanup (same repo, no behavior changes)

1. Remove tracked ignored/generated artifacts from git index:
   - `apps/mobile/android/.gradle/**`
   - `apps/mobile/android/local.properties`
   - `apps/mobile/android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java`
   - `apps/api/test-results/.last-run.json`
   - `test-results/.last-run.json`
2. Remove tracked empty/stale files after ownership confirm:
   - `.env.example` (replace with real template contract)
   - `apps/api/db.sqlite`
   - `apps/web/vim/nano`
   - empty TS/TSX placeholders unless actively planned
3. Normalize env contract:
   - Promote a complete non-secret template (`.env.example` + per-app examples)
   - Stop tracking env files that carry real values.
4. Add/verify guard for tracked-ignored files regression:
   - fail CI if `git ls-files -ci --exclude-standard` returns non-empty.

### Phase 2 — Structural Repo Re-basing (still in current repo)

1. Create explicit top-level grouping:
   - `core/` (api/web/packages)
   - `mobile/` (sara/viva)
   - `gateway/`
   - `ops/` (deploy/infra/runbooks)
   - `quality/` (active evidence; archive moved/compressed)
2. Keep path aliases and scripts backward-compatible during transition.
3. Run full guard/test matrix after each move slice.

### Phase 3 — Federated Split (optional but recommended)

1. Extract `mobile` and `gateway` into dedicated repos with preserved history.
2. Version shared contracts:
   - publish `@signacare/shared` artifacts from core pipeline
   - consume semver releases in mobile/gateway repos
3. Replace implicit intra-repo dependencies with explicit package/version boundaries.

### Phase 4 — Ongoing Repo Hygiene

1. Add quarterly “stale debt” sweep:
   - tracked ignored files
   - zero-byte tracked files
   - orphaned scripts
   - archived evidence bloat
2. Enforce CODEOWNERS by boundary:
   - core team, mobile team, gateway team, compliance/docs owner
3. Add policy: no runtime scratch artifacts under tracked paths.

## 5) Guard Upgrades Required

1. `guard:tracked-ignored-files` — fail if tracked files match ignore rules.
2. `guard:zero-byte-tracked` — fail on unexpected 0-byte tracked files (allowlist only for intentional placeholders).
3. `guard:env-template-contract` — ensure non-empty canonical env templates exist and include required keys.
4. `guard:cross-project-boundary` — block imports between future split domains except through published contracts.

## 6) Pre-Deployment vs Post-Deployment Scope

### Do now (pre-deployment)

1. Phase 1 cleanup
2. Env contract normalization
3. Guard additions for regression-proof hygiene
4. Boundary ownership tagging

### Defer (post-deployment window)

1. Full physical split into multiple repos
2. Archive compression/migration of historical audit evidence
3. Non-critical directory topology polish

## 7) L1–L5 Gate Discipline for This Program

1. **L1:** build/type/lint (core must remain green per slice)
2. **L2:** integration packs for touched runtime paths
3. **L3:** UI logic tests for moved web modules
4. **L4:** full guard suite + new declutter guards
5. **L5:** runtime smoke (api/web boot + critical route checks)

## 8) Acceptance Criteria

1. No tracked ignored files.
2. No unexplained zero-byte tracked files.
3. Complete env template contract with no secret values committed.
4. Clear boundary ownership for core/mobile/gateway/docs.
5. Guarded prevention against stale artifact reintroduction.

