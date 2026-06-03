# Findings 6b — Route × integration-test coverage matrix

**Agent:** F-routes-tests

## Summary

- **Total routes:** 725 across 86 route files
- **Covered by integration tests:** ~71
- **Uncovered:** **~654 (≈ 90 %)**
- **Unit-only covered:** 0
- **Distinct tested URLs:** 95 across 39 test files

The first-audit "19 uncovered" figure was a sampling estimate; full enumeration raises the real number to **~654**. The gap is STRUCTURAL, not a sampling error.

## Methodology

- Mount prefixes resolved from `apps/api/src/server.ts`
- Fuzzy match: `${id}` / `${uuid}` / `${randomUUID()}` → `:param`
- Query strings stripped; verb-sensitive
- Counted integration tests in `apps/api/tests/integration/**`

## Features at 0 % coverage (43 of 86 route files)

`appointments, audit, backup, beds, billing (26 routes), calendar, carers, checklists, clinical-review, contacts, correspondence, dashboard, documents, ect, endocrinology, ereferral, escalations (12), events, feature-flags, flags, group-therapy, imports, internal-medicine, lai (12), messaging, mobile-sync, notifications, obs-gyne, oncology (12), org-settings (17), outcomes, paediatrics, patient-outreach, pathology (7), prescriptions (16), provisioning, reallocations, referrals (25), reports, risk (3), roleFeatureRoutes (all 7 sub-routers, 85 routes), safety-plan, settings, staff-settings (13), surgery, telehealth, templates, tms, pathways, voice, webhooks, workflows; integrations/{cmi, nhsd, outlook}`

## Highest-risk uncovered (patient-safety-critical)

| # | Route | File:line |
|---|---|---|
| 1 | `POST /prescriptions/` — eScript creation | `prescriptionRoutes.ts:43` |
| 2 | `POST /prescriptions/:id/submit-erx`, `/safescript-check`, `/cancel`, `/hi/verify-ihi` | `:64, :63, :65, :57` |
| 3 | `POST /patients/:id/legal-orders` — MHA order creation | `patientRoutes.ts:834` |
| 4 | `PATCH /legal-orders/:orderId` | `patientRoutes.ts:855` |
| 5 | `POST /patients/:id/alerts` — clinical alerts | `patientRoutes.ts:962` |
| 6 | `POST /risk-assessments/` — suicide/violence risk | `risk.routes.ts:39` |
| 7 | `POST /pathology/orders`, `/results`, `/results/:id/acknowledge` | `pathologyRoutes.ts:24, :29, :33` |
| 8 | `POST /clinical-notes/:id/sign`, `/amend` | `clinicalNote.routes.ts:103, :104` |
| 9 | `POST /ect/courses`, `/tms/courses`, `/lai/given`, `/lai/` | various |
| 10 | `POST /clozapine/titration-days`, `/administrations`, `/monitoring-checks` | — |

## Feature coverage ratios

| Feature | Coverage ratio |
|---|---|
| `features/hi-service` | 2/2 = **100 %** |
| `features/patients` | 5/55 = 9 % |
| `features/patient-app` | 3/36 = 8 % |
| `integrations/fhir` | 3/35 = 9 % |
| 43 other features | 0/N = 0 % |

## Zombie test anomalies — tests hitting non-existent paths (silent 404s)

1. `breakGlassAudit.test.ts` hits `/auth/break-glass` but declared path is `/auth/break-glass/request`
2. `medicationConstraints.test.ts:101` hits `POST /patients/:id/medications` — no such route
3. `medicationConstraints.test.ts:138` hits `POST /lai/schedules` — declared is `POST /lai/`
4. `medicationConstraints.test.ts:191` hits `/clozapine/registrations` — declared is `/clozapine/`
5. `noteSnippetsEpisodeScoping.int.test.ts:61` hits `/clinical-notes/patient/:id/snippets` — route doesn't exist

These tests "pass" because 404 isn't asserting on status code, so they've been green while testing nothing. Separate finding.

## Related BUGs

- **BUG-429** (first audit — this wave) — roll-up: integration test gap is ~654 routes uncovered, not 19. Coverage goal must be clinical-safety-critical paths FIRST (BUG-451 below covers this).
- **BUG-451 (S1)** (new) — close integration-test gap on the ~50 clinical-safety-critical paths listed in "highest-risk uncovered" table before Azure staging
- **BUG-452 (S2)** (new) — fix 5 zombie tests hitting non-existent routes; add CI guard asserting every supertest URL matches a declared route (reverse of existing `check-mounted-routes-have-callers.sh`)
- **BUG-453 (S3)** (new) — systematic backfill to raise coverage beyond 20 % across remaining 43 at-0% features (post-staging)
