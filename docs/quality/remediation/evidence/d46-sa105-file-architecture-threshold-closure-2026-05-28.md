# D46 — SA-105 File-Architecture Threshold Closure (2026-05-28)

## Scope
- Bug: `BUG-SA-105`
- Objective: remove active file-size threshold pressure from hotspot files.

## Evidence
- `npm run guard:file-size` result:
  - `check-file-size: OK — 49 ceiling-listed files within +50 grace, 0 eligible for ceiling drop.`
- `lifeChartSchemaDomain.ts` decomposition completed under `BUG-SA-115`:
  - `1001 LOC -> 26 LOC` façade + bounded modules.

## Decision
- `BUG-SA-105` is closed as an active threshold-risk bug.
- Remaining large-file refactors are tracked explicitly by dedicated rows:
  - `BUG-SA-112` (`patientRoutes.ts`)
  - `BUG-SA-113` (`CorrespondenceTab.tsx`)
  - `BUG-SA-114` (`EpisodesTab.tsx`)

## Guard posture
- File-size guard remains enforced in CI as the regression backstop.
