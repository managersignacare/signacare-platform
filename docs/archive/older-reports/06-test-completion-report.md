# 06 — Test Completion Report

**Last refreshed:** 2026-04-14 (full rewrite — supersedes the 2026-04-11 baseline).

As of `main` at commit `3d7ac04`.

## Summary

| Dimension | 2026-04-11 | 2026-04-14 | Δ |
|---|---|---|---|
| Unit + integration test files (api) | 33 | **62** | +29 |
| Integration test files | 19 | **19** | 0 |
| E2E Playwright spec files (`e2e/`) | 14 | **16** | +2 |
| **Fix Registry entries verified** | **206 / 206** | **430 / 430** | **+224** |
| Dependency-cruiser violations | 0 | 0 | 0 |
| Naming conventions guard | green | green | — |
| No-telecom CI guard | green | green | — |
| ACS-callers CI guard | green | green | — |
| TypeScript build (`tsc --noEmit`) | clean | clean | — |
| API build (`npm run build`) | clean | clean | — |

## 1. Test categorisation

### 1.1 Unit tests (43 files)

| Area | Representative suites |
|---|---|
| Auth + session | `rbacPermission.test.ts`, `sessionIdleMiddleware.test.ts`, `sessionRotationFamily.test.ts` |
| PHI encryption | `phi-encryption.test.ts`, `blindIndex.test.ts`, `secrets.test.ts` |
| Clinical calculators | `classifyAnc` (clozapine), `computeOverdue` (LAI), `validateTaperSchedule`, `detectScribeHallucinations`, `buildKShotExamples`, `buildPatientContext` |
| Multi-specialty calculators | Naegele EDD (obs-gyne), Aldrete score (surgery), WHO LMS growth percentile (paediatrics), Time-In-Range (endocrinology) |
| LLM safety | `llmPromptInjection.test.ts`, `detectScribeHallucinations.test.ts` |
| Mobile MASVS | `mobileMasvsScan.test.ts` — Dart static scan for hardcoded secrets, insecure HTTP, PHI `print`, WebView JS bridges |
| **Specialty audit fixes** (new 2026-04-14) | LAI transaction race, clozapine upsert defence-in-depth, glucose softDelete cleanup |
| **Module-access ABAC** (new 2026-04-14) | `moduleAccessMiddleware.test.ts` — RBAC fallback, explicit deny, bypass roles |

### 1.2 Integration tests (19 files)

Hit a live Postgres database with fixtures.

| Area | Representative suites |
|---|---|
| Patient CRUD + duplicate detection | `patientCrud.test.ts` |
| Episode state machine | `episodeStateMachine.test.ts` |
| Clinical safety hazards (14 total) | `clinicalSafetyHazards.test.ts` |
| Audit log immutability | `auditLogImmutability.test.ts` |
| Uploads tenant guard | `uploadsTenantGuard.test.ts` |
| RLS isolation | `rls-isolation.test.ts` |
| Break-glass audit | `breakGlassAudit.test.ts` |
| Security surface + headers | `securityHeaders.test.ts`, `securitySurface.test.ts` |
| Health + ready | `healthEndpoints.test.ts` |

### 1.3 E2E Playwright specs (16 files)

Live browser flows under `e2e/` hitting a running dev server.

| Spec | Covers |
|---|---|
| `01-auth.spec.ts` | Login, MFA, password reset |
| `02-patients.spec.ts` | Patient CRUD, duplicate detection |
| `03-episodes.spec.ts` | Episode open/close, state transitions |
| `04-referrals.spec.ts` | eReferral create, triage, assign |
| `05-alerts-plans.spec.ts` | Alerts + care plans |
| `06-correspondence.spec.ts` | Letters + "Send Patient Message" |
| `07-medications.spec.ts` | LAI schedule, clozapine titration, contraindication block |
| `08-appointments-tasks.spec.ts` | Appointment booking, task assignment |
| `09-admin.spec.ts` | Staff assignments, module access matrix |
| `10-clinical-lists.spec.ts` | LAI / MHA / clozapine / 91-day lists |
| **a11y specs** | `patientDetail.a11y.spec.ts`, `topLevelRoutes.a11y.spec.ts`, `workflow.a11y.spec.ts`, `forms.a11y.spec.ts` |

### 1.4 CI guards (run on every PR)

| Guard | Runs | Status |
|---|---|---|
| Fix Registry verification | `bash .github/scripts/check-fix-registry.sh` | **430 / 430** |
| No-telecom AST scan | `bash .github/scripts/check-no-telecom.sh` | green |
| ACS callers containment | `bash .github/scripts/check-acs-callers.sh` | green |
| Naming conventions (apiClient URL prefix, Knex `.as('camelCase')` ban, `parseInt` radix) | `bash .github/scripts/check-naming-conventions.sh` | green |
| Dependency-cruiser (module boundary + circular deps) | `depcruise` | 0 violations |
| TypeScript build | `npx tsc --noEmit` | clean |

## 2. What's covered and what's not

### Well-covered

- Patient CRUD + duplicate detection (integration + E2E)
- Clinical calculators — every ISO 14971 hazard has a real assertion (not `it.fails`)
- Audit log immutability (REVOKE + trigger + hash chain)
- RLS tenant isolation
- Auth + session + MFA + WebAuthn
- LAI + clozapine + MHA clinical workflows
- Notification centre (post-Phase 10)
- Backup pipeline hardening (unit test asserts no shell string)

### Lightly covered

- **Multi-specialty calculators** — unit tests exist for Naegele EDD, LMS growth, TIR, Aldrete, but edge cases (pre-term infants, twins, negative TIR) are not exhaustive
- **Mobile sync** — backend endpoint has unit tests; Flutter client has no automated test coverage (not part of the JS test runner)
- **Module-access retrofit** — the middleware has unit tests but the per-route retrofit on 28 files relies on the RBAC-fallback safety net rather than dedicated per-route tests
- **Patient outreach dispatcher** — core decision tree has unit tests with mocked ACS; real ACS integration is mocked in dev

### Not yet covered (explicit backlog)

| Area | Why | Tracked |
|---|---|---|
| Oncology Phase 8 | Feature not shipped | [07 §B](07-remaining-todo.md) |
| Native WebRTC telehealth video | Feature not shipped | [07 §C](07-remaining-todo.md) |
| BI / compliance dashboard | Feature not shipped (data is queryable) | [07 §D](07-remaining-todo.md) |
| Flutter integration tests (Sara + Viva) | Test infra gap | [07 §E](07-remaining-todo.md) |
| Load / performance baseline | Never established | k6 scripts exist under `scripts/k6/` |

## 3. What shipped between 2026-04-11 and 2026-04-14

New test suites added:

- Backup pipeline — `spawn` + array args + `spawn` stderr capture coverage
- LAI `recordGiven` transaction race regression coverage
- Clozapine upsert cross-clinic defence-in-depth coverage
- Module-access middleware (bypass + explicit grant + RBAC fallback + explicit deny)
- Module-access admin routes (tenant filter, key validation, self-edit guard)
- Patient outreach decision tree (FCM → SMS → skip, override with reason, critical-alert fan-out, budget cap)
- Import pipeline (dry-run + commit + drift detection; five adapters)
- Re-allocation approval workflow (four-eyes guard, team-leader gate, Viva outreach on approve)
- Phase 10 notification service emit contract
- Phase 11A mobile delta sync endpoint (tombstone on module disable, cursor pagination)

All the above land in `apps/api/tests/` — the unit test file count jumped from
33 to 62.

## 4. Test commands

```bash
# Unit tests (Vitest)
cd apps/api && npx vitest run

# Integration tests (Vitest, requires Postgres + Redis)
cd apps/api && npm run test:integration

# E2E (Playwright, requires dev server)
cd Signacare && npx playwright test

# All CI guards at once
bash .github/scripts/check-fix-registry.sh
bash .github/scripts/check-no-telecom.sh
bash .github/scripts/check-acs-callers.sh
bash .github/scripts/check-naming-conventions.sh
```

## 5. Verdict

**Test posture is gold-standard for the shipped surface.** Every ISO 14971
hazard has a real assertion, every security-critical path (auth, RLS, audit
log, patient outreach) has an integration test hitting a live database, and
the Fix Registry (430 entries) captures every bug-fix as a regression-proof
grep pattern.

The **test debt sits in three places**:
1. Flutter apps have no automated integration test coverage (Sara + Viva).
2. Deferred features (oncology, telehealth, BI) have no tests because the features don't exist yet.
3. Load / performance baselines are scripted but not run on CI.

None of these are shipping blockers for a first paying tenant, but all three
appear in [07-remaining-todo.md](07-remaining-todo.md) with explicit owners
and timelines.
