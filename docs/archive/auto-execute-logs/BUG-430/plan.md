# BUG-430 — clinic_id expansion to 36 sites — Plan

## Pre-classification (per §13.2)

All 36 allowlist entries are under `apps/api/src/features/*` — ZERO in `mcp/`, `jobs/`, `integrations/`. No background-path split needed. Single mechanical fix.

Breakdown:
- `patient-app` 24 (largest — patient-app routes use dbAdmin for admin-scope queries which bypass RLS)
- `patients` 4
- `episode` 3
- `clinical-decision` 2
- `reallocations` 1
- `correspondence` 1
- `contacts` 1

## Fix shape

For each site, determine the right clinic_id source:
- HTTP request handler → `clinic_id: req.clinicId`
- Service function → thread clinicId from caller signature
- Admin/patient-app routes → use `req.user?.clinicId` or `auth.clinicId`

Every migration carries a `// BUG-430` comment so a future grep lands on the whole family.

## Files

- 7 feature files modified
- `scripts/guards/check-query-has-clinic-id.allowlist.txt` — emptied at end
- `docs/quality/fix-registry.md` — 1 row asserting allowlist is empty / near-empty
- `docs/quality/bugs-remaining.md` — mark BUG-430 fixed

## Strategy for context efficiency

Given 36 sites, fixing all in one commit risks a huge diff. Strategy: ONE commit that fixes every site + drains the allowlist. The guard itself is the structural enforcement — any remaining violation post-commit either has real justification (keep in allowlist with a new BUG-ID reference) or is a bug (fix in this commit).

## Approach per file

1. `patient-app/patientAppRoutes.ts` 24 sites (largest — batch-edit)
2. `patients/patientRepository.ts`, `patientRoutes.ts:{674,809,821}` (4)
3. `episode/episodeRoutes.ts:{345,346,347}` (3 — lines adjacent, likely one block)
4. `clinical-decision/clinicalDecisionRoutes.ts:{57,78}` (2)
5. One-liners: `reallocations`, `correspondence`, `contacts`

After all sites: regenerate allowlist fresh; should be empty if all migrations correct.

## L3/L4/L5

- L3: yes
- L4: yes (tenant-isolation gate family)
- L5: yes (touches 7 features + drains allowlist file)
