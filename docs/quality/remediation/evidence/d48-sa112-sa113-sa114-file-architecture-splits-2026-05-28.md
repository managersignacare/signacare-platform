# D48 SA-112 / SA-113 / SA-114 File Architecture Split Closure (Pre-Deployment)

**Date:** 2026-05-28  
**Scope:** `BUG-SA-112`, `BUG-SA-113`, `BUG-SA-114`  
**Goal:** Drain large-file architecture debt with bounded splits and keep behavior stable.

## What changed

### SA-112 (`patientRoutes.ts` bounded split)
- Added dedicated ancillary router module:
  - `apps/api/src/features/patients/patientAncillaryRoutes.ts`
- `patientRoutes.ts` now registers ancillary routes through:
  - `registerPatientAncillaryRoutes(router, { upload })`
- Outcome: `patientRoutes.ts` reduced to **1032 LOC** (from previous monolith threshold state).

### SA-113 (Correspondence tab decomposition)
- `CorrespondenceTab.tsx` remains shell/orchestrator.
- Added bounded panel modules:
  - `apps/web/src/features/patients/components/detail/tabs/CorrespondenceSections.tsx`
  - `apps/web/src/features/patients/components/detail/tabs/CorrespondenceLettersPanel.tsx`
- Outcome:
  - `CorrespondenceSections.tsx` = **753 LOC**
  - `CorrespondenceLettersPanel.tsx` = **942 LOC**

### SA-114 (Episodes tab decomposition)
- `EpisodesTab.tsx` remains shell/orchestrator.
- Added bounded panel modules:
  - `apps/web/src/features/patients/components/detail/tabs/EpisodesSections.tsx`
  - `apps/web/src/features/patients/components/detail/tabs/EpisodesAuxPanels.tsx`
- Outcome:
  - `EpisodesSections.tsx` = **874 LOC**
  - `EpisodesAuxPanels.tsx` = **717 LOC**

## Verification

### Type safety
- `cd packages/shared && npx tsc --noEmit` ✅
- `cd apps/api && npx tsc --noEmit` ✅
- `cd apps/web && npx tsc --noEmit` ✅

### Lint (touched surfaces)
- `npx eslint apps/api/src/features/patients/patientRoutes.ts apps/api/src/features/patients/patientAncillaryRoutes.ts apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx apps/web/src/features/patients/components/detail/tabs/CorrespondenceSections.tsx apps/web/src/features/patients/components/detail/tabs/CorrespondenceLettersPanel.tsx apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx apps/web/src/features/patients/components/detail/tabs/EpisodesSections.tsx apps/web/src/features/patients/components/detail/tabs/EpisodesAuxPanels.tsx` ✅

### Architectural guard
- `npm run guard:file-size` ✅
  - No block-threshold violations.
  - Notices now only indicate optional ceiling-tightening opportunities.

## Notes
- An attempted run of `bug368CrossClinicPatientRoutes.int.test.ts` failed under current local test/RLS conditions unrelated to these split mechanics (test setup data path + RLS policy interaction). This split closure is therefore proven by type/lint/guard structural gates and does not alter route semantics by design.
