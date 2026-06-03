# Bug Catalogue — 2026-04-19 Ruthless Discovery Pass

**Scope:** discovery-only. No fixes applied in this pass. Every finding below is evidence for a subsequent fix pass.

**Severity rubric:**
- **S0** — Safety-critical (wrong clinical data, PHI leak, RLS bypass, audit trail broken, wrong patient actioned).
- **S1** — Workflow-blocking (save fails silently, core flow broken).
- **S2** — Feature-broken (feature doesn't work, workaround exists).
- **S3** — Cosmetic (wrong label, stale data needing refresh, slow load).
- **S4** — Trivial (typo, log noise, minor warning).

---

## Count summary (Phase I baseline + Phase II re-run)

| Severity | Count | Confirmed? |
|---|---|---|
| S0 | 0 confirmed, 5 candidates pending verification (BUG-020-024) | candidates |
| S1 | 8 + 28 (Phase II E2E failures) = 36 | yes |
| S2 | 5 + 10 (a11y axe violations) = 15 | yes |
| S3 | 7 | yes |
| S4 | 4 | yes |
| **Total** | **62+** | — |

**Phase II rerun after seed fix (2026-04-19 14:50):**
- E2E: 39 passed / 38 failed / 17 skipped / 4 workflow-skipped (out of 94) — **up from 4 passing at Phase I**
- Remaining 38 failures break into ~3 clusters:
  - Patient-detail tab specs cascade (~20 failures) — suggests a patient is not seeded, so `navigateToPatient()` helper in `fixtures/auth.ts` fails to find one.
  - Accessibility axe violations (~10) — real a11y bugs catalogued as BUG-028+.
  - Clinical-lists failures (~3) — handover/nursing/case-management pages.
  - Workflow + new-patient-journey cascade (~5).

**High-impact classes:**
- **Test infrastructure broken (S1):** BUG-025 missing seed users cascades 94 E2E test failures.
- **Scribe context renders "Unknown" (S1):** BUG-001, 002 — 4 Vitest failures — medications + problem list + observations in buildPatientContext.
- **~65 Tier 12-19 endpoints with ZERO frontend callers (S2):** BUG-026 — shipped backend, unused.
- **40+ silent catches in apps/web (S1):** BUG-005 — Bug 6 class multiplied; every save-silent-fail candidate.
- **Empty seed tables (S2):** BUG-013 (templates = 0 rows, rating scales missing), BUG-014 (clinical_templates = 0).
- **Defense-in-depth clinic_id gaps (S1 candidates):** BUG-020, 021, 022, 023 — tenant isolation defense missing in correspondence, reports, billing.

---

## §1 — Existing test-suite failures (T1.*)

### BUG-001 — buildPatientContext: medications section renders "Unknown" instead of drug label
- Severity: **S1**
- Area: scribe / patient-context builder
- Discovery method: `npm run test --workspace=apps/api` → `tests/buildPatientContext.test.ts:142`
- Evidence: test expects `Sertraline` in rendered context; gets `Unknown 50mg daily`. Same failure in 4 tests (medications, problem list expecting "Major depressive disorder", observations expecting "72bpm", and the error-resilience test).
- Reproduction: `npm run test --workspace=apps/api -- tests/buildPatientContext.test.ts`
- Expected vs actual: drug label / diagnosis name / observation value rendered. Instead: generic placeholder strings.
- Impact: Every scribe session that uses pre-consult patient context will show clinicians generic placeholders instead of the real medications, diagnoses, and observations — clinical decisions made against that context will be uninformed.
- Proposed fix shape: inspect `buildPatientContext.ts` medication/problem/observation reads; likely reading a ghost column (`medication_name` vs `drug_label`, etc.). Match Phase R R-FU `drug_label` pattern.
- Prior fix-registry row: none specific; adjacent to `R-FU-MEDS-DRUG-LABEL` (correspondence pathway was fixed; scribe context was missed).
- Related: BUG-002 (same file, same class of failure).

### BUG-002 — buildPatientContext: problem list filters wrong episode state
- Severity: **S1**
- Area: scribe / patient-context builder
- Discovery method: Vitest `tests/buildPatientContext.test.ts`
- Evidence: 4 related test failures per BUG-001. `expected "...(pre-consult snapshot...)" to contain 'Major depressive disorder'`. The snippet returned shows only `- Allergy [LOW]` — problem list entirely empty.
- Impact: Clinician loses visibility of active diagnoses during scribe session.
- Proposed fix shape: review `buildPatientContext.ts` problem-list join — likely filters by episode `status='closed'` instead of `'open'` OR reads wrong diagnosis column.
- Related: BUG-001.

### BUG-003 — Architecture violation: roleFeatureRoutes imports psychologistFeatureRoutes (forbidden cross-feature import)
- Severity: **S3**
- Area: code architecture
- Discovery method: `npm run test --workspace=apps/api` → `tests/unit/architectureSmoke.test.ts` → dependency-cruiser
- Evidence: `error no-route-to-route: apps/api/src/features/roles/roleFeatureRoutes.ts → apps/api/src/features/roles/psychologistFeatureRoutes.ts`
- Impact: Cross-route coupling makes refactor and test isolation harder. Not a runtime bug but a design debt that will cause maintenance pain.
- Proposed fix shape: move shared logic into a helper, OR add `psychologistFeatureRoutes` to the pathNot allowlist in `.dependency-cruiser.cjs` with a rationale if the import is legitimate.
- Related: none.

---

## §2 — Discovery-probe findings (T2.*)

### BUG-004 — E2E baseline: login with valid credentials redirects to dashboard FAILS
- Severity: **S1** (will re-confirm after E2E completes; baseline impact unclear)
- Area: authentication
- Discovery method: `npm run test:e2e` → `e2e/01-auth.spec.ts:4` + `:29`
- Evidence: 17.1s timeout; `login with invalid password shows error message` passes so the login form loads, but the success path breaks. The dashboard-user-name spec also 17.0s timeouts.
- Reproduction: `npm run test:e2e -- 01-auth`
- Impact: If the E2E seed user's login doesn't work, every downstream spec that depends on it cascades to failure.
- Proposed fix shape: investigate whether the seed user exists in the E2E DB; whether MFA is forced; whether tour-popup-dismiss is stuck.
- Related: all downstream E2E failures cascade from this.

(More BUG-00N entries appended once E2E run completes.)

---

## §3 — Backend-without-frontend audit (T3.1 + T11.1)

_Pending T11.1 enumeration. Preliminary list:_
- Tier 12: scribe vocabulary (6 endpoints), scribe sessions pause/resume, admin impersonation (3 endpoints).
- Tier 13: sensitive flags review queue, action items bulk + review + link, talk-time, semantic search, note templates.
- Tier 15-17: letter composer, review queue, delivery, export, translations, revisions, state MHA forms, capacity assessments, forensic risk, citations, tone presets.
- Tier 19: PHI scrubber admin, training corpus review, model registry, red-team gate, canary deploy, surveillance.

To be enumerated precisely in T11.1.

---

## §4 — Static anti-pattern audit (T4.*)

### BUG-005 — 40+ silent catches in apps/web/src (CLAUDE.md §9.6 scope gap)
- Severity: **S1** (Bug 6 class multiplied)
- Area: frontend error handling
- Discovery method: T4.1 grep `apps/web/src` for `catch\s*\(\s*\)?\s*\{(/\*.*?\*/)?\}`
- Evidence: `/tmp/bughunt-grep-anti-patterns.log` lists 40+ silent catches, notably:
  - `apps/web/src/features/patients/components/detail/tabs/PhysicalHealthTab.tsx:94 — catch { /* */ }` (previously flagged in Bug 6)
  - `apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:935 — catch { /* */ }`
  - `apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:899, 1023 — catch { /* */ }`
  - `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:184, 2408, 2436, 2443, 2509 — catch { /* skip */ } / catch {}` including allergy archive/restore on lines 2436+2443
  - `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:643, 652, 1019, 1400, 1410, 1503 — catch {}` + 3 JSON.parse try/catch silencers
  - `apps/web/src/features/patients/pages/PatientsPage.tsx:510 — catch {}`
  - `apps/web/src/features/beds/pages/BedBoardPage.tsx:257 — catch {}`
  - `apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:421 — catch { /* handle error */ }`
- Impact: Every one of these is a potential "save failed silently" bug. User will see success UI even though the mutation failed.
- Proposed fix shape:
  1. Extend `check-no-silent-catches.sh` to scan `apps/web/src` (Tier B.6 work).
  2. Review each site — replace `catch {}` with `catch (err) { logger.error({err}); toast.error(...) }` OR annotate `// intentional silent — <reason>`.
- Prior fix-registry row: none (Bug 6 class is the only adjacent).
- Related: Bug 6 (physical-health), and suggests many more save-fails-silently bugs lurking.

### BUG-006 — 3 silent catches in backend `apps/api/src/features/llm/llmRoutes.ts` (guard violation)
- Severity: **S2**
- Area: backend error handling / LLM routes
- Discovery method: `check-no-silent-catches.sh` FAILED
- Evidence:
  - `apps/api/src/features/llm/llmRoutes.ts:290 — }).catch(() => {});`
  - `apps/api/src/features/llm/llmRoutes.ts:363 — }).catch(() => {});`
  - `apps/api/src/features/llm/llmRoutes.ts:422 — }).catch(() => {});`
- Impact: LLM errors swallowed silently; no observability for why an LLM call failed. Violates CLAUDE.md §3.1 + §9.6. Merge gate is currently green ONLY because the guard is non-blocking — running the bash script directly fails.
- Proposed fix shape: chain `.catch(err => logger.warn({err, ...}, 'llm op failed'))` OR await + try/catch.
- Related: BUG-005.

### BUG-007 — `guard:query-key-factories` npm script does not exist (plan referenced non-existent script)
- Severity: **S4**
- Area: CI tooling
- Discovery method: `npm run guard:query-key-factories` → `npm error Missing script`.
- Evidence: plan referenced this script; it's not in root `package.json`. The bash equivalent `bash .github/scripts/check-query-key-factories.sh` may exist (separate from npm).
- Impact: Minor — any CI config that calls `npm run guard:query-key-factories` will error out.
- Proposed fix shape: add the npm script OR remove references. Also wire up the bash variant if it exists.

### BUG-008 — 3 void-requireEnv in Tier 8 skeleton integration clients (fire-and-forget)
- Severity: **S4**
- Area: Tier 8 integrations / fire-and-forget rule
- Discovery method: `npm run guard:no-fire-and-forget` + T4.4
- Evidence:
  - `apps/api/src/integrations/mhr/mhrDocumentClient.ts:56, 57, 58 — void requireEnv(...)`
  - `apps/api/src/integrations/radiology/radiologyClient.ts:69, 70 — void requireEnv(...)`
  - `apps/api/src/integrations/medicare/eclipseClient.ts:64, 65, 66 — void requireEnv(...)`
  - `apps/api/src/integrations/healthlink/healthLinkClient.ts:58, 59 — void requireEnv(...)`
- Impact: Guard violation; these void-calls execute `requireEnv` purely for its side effect of throwing. Since the function is called from an already-guarded throw path (only after `isConfigured()` returns true), the practical risk is low. But it trips the guard and CLAUDE.md §9.6.
- Proposed fix shape: `await requireEnv(...)` or restructure the skeleton clients.

### BUG-009 — parseInt without radix (8 sites) — guard violation
- Severity: **S3** (potential silent wrong-base parsing)
- Area: frontend numeric parsing
- Discovery method: `check-naming-conventions.sh` FAILED
- Evidence:
  - `apps/web/src/features/nursing/pages/NursingPage.tsx:333, 335, 338, 340, 393, 454, 455 — parseInt(x)` (7 sites)
  - `apps/web/src/features/reports/pages/ReportsPage.tsx:1197 — parseInt(sampleSize)` (1 site)
- Impact: `parseInt('08')` returns 8 in modern JS BUT legacy edge cases + leading-zero inputs interpret as base 8. Violates CLAUDE.md rule. For vital signs and sample-size fields this could produce wrong numbers.
- Proposed fix shape: add explicit `10` second arg: `parseInt(x, 10)`.

### BUG-010 — SQL injection candidate: materialised-view refresh + reset-patient-data
- Severity: **S2** (internal/dev scripts) — would be S0 if ${view} came from user input
- Area: database / scripts
- Discovery method: T4.5 grep
- Evidence:
  - `apps/api/src/jobs/schedulers/matviewRefreshScheduler.ts:49, 59 — db.raw(\`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}\`)` + fallback — `${view}` originates from a config / registry list, so low risk.
  - `apps/api/src/reset-patient-data.ts:29, 52 — DROP RULE / TRUNCATE via ${table}` — dev-only script; `${table}` from config; low risk but pattern is dangerous.
- Impact: if the source of `view` or `table` ever becomes request input, SQL injection immediate. Currently constrained to known tables.
- Proposed fix shape: whitelist-validate `view` / `table` against a static list OR use `pg.identifier` escaping.

### BUG-011 — `whereRaw('... ILIKE ?', [\`%${term}%\`])` in patientRepository without escapeLike
- Severity: **S3**
- Area: search SQL injection surface (LIKE-pattern injection)
- Discovery method: T4.5 grep
- Evidence: `apps/api/src/features/patients/patientRepository.ts:195 — whereRaw("patients.given_name ILIKE ?", [\`%${term}%\`])` — `term` is user input and LIKE wildcards `%` and `_` are NOT escaped. User-supplied `%` makes search match everything; `_` matches any single char. Low-harm but violates CLAUDE.md §1.8.
- Impact: Search returns wrong results if user enters `%` or `_` in the search box. Not an exfiltration risk with parameterized queries.
- Proposed fix shape: wrap `term` in `escapeLike(term)` helper (already exists per CLAUDE.md).

### BUG-012 — `whereRaw("test_name ILIKE ?", [\`%${rule.check.replace(/_/g, ' ')}%\`])` LIKE-wildcard leak
- Severity: **S3**
- Area: clinical-decision routes
- Discovery method: T4.5 grep
- Evidence: `apps/api/src/features/clinical-decision/clinicalDecisionRoutes.ts:80` — `rule.check` replaced underscores but `%` still pass through.
- Impact: Clinical decision rule pattern matching returns unexpected results if rule check string contains wildcards.
- Proposed fix shape: use `escapeLike`.

### BUG-013 — `templates` table EMPTY (Bug 7 confirmed — no rating scales seeded)
- Severity: **S2** (feature broken: rating-scale dropdown returns zero options)
- Area: assessments / rating scales
- Discovery method: T5.1 seed completeness `SELECT COUNT(*) FROM templates` returns 0.
- Evidence: psql shows `templates | 0`. TWO seed scripts exist but neither has been run against this DB:
  - `apps/api/src/seed-reference-data-backfill.ts` — 7 rating scales (PHQ-9, GAD-7, K10, HoNOS, LSP-16, BPRS, AIMS) + management/safety plan templates.
  - `apps/api/src/seed-rating-scales.ts` — 20+ dedicated rating scales (BPRS, HAM-A, HAM-D, MADRS, PANSS, Y-BOCS, YMRS, HoNOS, K10, PHQ-9, GAD-7, AIMS, EPDS, CGI, etc.).
- Impact: Assessments tab dropdown empty. Clinicians cannot apply standard rating scales. User explicitly said "previously we had built at least 15 rating scales" — this confirms a LOST-SEED regression.
- Proposed fix shape: (a) run the seed script(s) against this DB once, OR (b) promote to a migration (CLAUDE.md §12.4 says seed data belongs in migrations for reproducibility). Option (b) is gold-standard — will guarantee every fresh DB has all rating-scale templates forever.
- Prior fix-registry row: none.
- Related: Bug 7 (user-reported), BUG-014 (clinical_templates also empty).

### BUG-014 — `clinical_templates` table EMPTY
- Severity: **S2**
- Area: clinical-note templates
- Discovery method: T5.1 — `clinical_templates | 0`.
- Evidence: none seeded.
- Impact: Clinical-note template dropdown likely empty too. Note authoring without templates.
- Proposed fix shape: same as BUG-013 — promote seeds to migration.

### BUG-015 — `apps/web` has `vitest.config.ts` but NO `test` npm script
- Severity: **S4**
- Area: test tooling
- Discovery method: T1.2 `npm run test --workspace=apps/web` → `Missing script: "test"`.
- Evidence: `apps/web/package.json` has no `test` script; `apps/web/vitest.config.ts` exists.
- Impact: Orphan config — unit tests in `apps/web/src/**/*.test.{ts,tsx}` cannot run via the standard command. The 2 existing `.test.{ts,tsx}` files in apps/web are effectively uncovered by CI.
- Proposed fix shape: add `"test": "vitest run"` to `apps/web/package.json`.

### BUG-016 — `docs/archive/phase-0.5-rename-runbook.md:124` contains `nousdev` (stray DB name guard warning)
- Severity: **S4**
- Area: docs
- Discovery method: `check-no-stray-db-names.sh` (warn mode)
- Evidence: single line in archived runbook references `nousdev`. Guard in warn mode.
- Impact: Low — it's archived doc. Will fail CI when guard flips to strict mode per Phase 0.5 PR 2 plan.
- Proposed fix shape: escape the reference in the archived doc (e.g. code-fence with placeholder) OR add to guard allowlist.

---

## §5 — DB state audit (T5.*)

### BUG-017 — `patient_active_specialties` view has no RLS (FALSE POSITIVE — it's a VIEW)
- Severity: N/A (dismissed)
- Verification: `SELECT table_type FROM information_schema.tables` returns `VIEW`. Views inherit from their underlying tables.
- **Not a bug.** Retained here so future audits don't re-flag.

### BUG-018 — 7 columns missing indexes
- Severity: **S3** (perf, not correctness)
- Area: database schema
- Discovery method: T5.4 index audit
- Evidence:
  - `oauth_access_tokens.patient_id`
  - `oauth_authorization_codes.patient_id`
  - `oauth_refresh_tokens.patient_id`
  - `phi_scrubber_rules.clinic_id` (Tier 19 migration)
  - `smart_launch_contexts.patient_id`
  - (plus 2 view columns on `patient_active_specialties` — dismissed)
- Impact: Slow lookups if these tables grow. OAuth token lookups by `patient_id` are on the hot path for SMART/OAuth flows.
- Proposed fix shape: add 4 indexes via migration.

### BUG-019 — Migration ledger in sync (NO BUG)
- Verification: 27 files in `apps/api/migrations/`, 27 rows in `knex_migrations`. Latest: `20260701000027_tier19_training_platform.ts`. ✓

---

## §6 — Manual persona walkthroughs (T6.*)

_Pending manual smoke. Framework ready; persona-list defined. T6.1-T6.11 actions queued._

---

## §7 — Accessibility violations (T7.*)

_Pending axe runs. 4 existing a11y specs (login, patientDetail, patientList, topLevelRoutes) in `e2e/accessibility/` — their output is part of the T1.1 E2E baseline still running._

---

## §8 — Network + console leaks (T8.*)

_Pending instrumentation run (T2.1 + rerun). Will capture console.error + pageerror + 4xx/5xx + duplicate requests once the fixture is added to `e2e/fixtures/auth.ts` and the suite re-runs._

---

## §9 — RBAC + RLS + dual-actor audit (T9.*)

### BUG-020 — Potential cross-tenant reads in correspondenceRoutes.ts (patient + staff lookup without clinic_id filter)
- Severity: **S0 candidate** (needs verification)
- Area: correspondence / tenant isolation
- Discovery method: T4.8 grep
- Evidence:
  - `apps/api/src/features/correspondence/correspondenceRoutes.ts:54 — db('patients').where({ id: letter.patient_id }).whereNull('patients.deleted_at').first()` — no `clinic_id` filter.
  - `apps/api/src/features/correspondence/correspondenceRoutes.ts:55 — db('staff').where({ id: letter.generated_by_id }).whereNull('staff.deleted_at').first()` — no `clinic_id` filter.
- Impact: If `letter.patient_id` or `letter.generated_by_id` refers to another tenant's record (e.g. via a poisoned `letter_id`), the handler leaks cross-tenant data. Depends on whether RLS at the DB level catches this (should) but CLAUDE.md §1.3 mandates application-level defense-in-depth.
- Proposed fix shape: add `.where({ clinic_id: req.clinicId })` to both queries.
- Needs verification: check if `letter` is already verified as belonging to `req.clinicId` upstream (lines 49-52 do this — the letter itself IS clinic-filtered). If yes, then these follow-up queries are constrained by the letter's clinic implicitly. Still violates §1.3 defense-in-depth letter.

### BUG-021 — `audit_runs.where({ id: run.id }).update(...)` without clinic_id in reports routes
- Severity: **S1** candidate
- Area: reports / audit runs
- Discovery method: T4.8 grep
- Evidence: `apps/api/src/features/reports/reportsRoutes.ts:564, 568 — .where({ id: run.id }).update(...)` with no clinic_id scope.
- Impact: If a caller with access to a `run.id` from another clinic updates it, cross-tenant write possible. CLAUDE.md §1.3 violated.
- Needs verification: check if upstream (line 501 fetches template with `clinic_id`, line 584 fetches run with `clinic_id`) constrains run.id implicitly.

### BUG-022 — `audit_templates.where({ id: run.template_id })` without clinic_id
- Severity: **S1** candidate
- Area: reports
- Evidence: `apps/api/src/features/reports/reportsRoutes.ts:586`
- Similar to BUG-021.

### BUG-023 — `billingRepository.ts:148 — .where({ id: existing.id })` update without clinic_id
- Severity: **S1** candidate
- Area: billing
- Evidence: `apps/api/src/features/billing/billingRepository.ts:148`
- Impact: Update propagation without tenant defense-in-depth.
- Needs verification: review whether `existing` is loaded with clinic_id filter.

### BUG-024 — `backupRoutes.ts:91, 201, 274` — `.where({ id: historyRow.id })` without clinic_id
- Severity: **S3** (backup records may be vendor-level)
- Area: backup
- Evidence: three update sites in `apps/api/src/features/backup/backupRoutes.ts`.
- Needs verification: are `backup_history` rows vendor-global (no clinic_id) or tenant-scoped?

---

## §10 — Spike-register drift (T10.*)

### Tier 14 + 18 spike flags DB state — ALL CORRECTLY DISABLED

```sql
SELECT name, enabled FROM feature_flags WHERE name LIKE 'scribe-%' OR name LIKE 'letters-%' ORDER BY name;
```
Result: 8 rows, all `enabled=f`:
- `letters-concurrent-collaboration` (f)
- `letters-multi-signature` (f)
- `scribe-agentic-sequencing` (f)
- `scribe-agentic-workflows` (f)
- `scribe-audio-fingerprint-consent` (f)
- `scribe-multimodal-vision` (f)
- `scribe-patient-attended-redaction` (f)
- `scribe-patient-redaction` (f)

✓ No drift. Registers at `docs/audit-2026-04-19/tier-14-spikes.md` + `tier-18-spikes.md` are consistent with DB state. T13.0.b + T13.0.c register refresh deferred (no content change needed).

---

## §11 — Backend/frontend/mobile coverage gaps (T11.*)

### BUG-025 — E2E test seed users DO NOT EXIST in DB (cascades 94 E2E test failures)
- Severity: **S1** (test-infra, not prod, but blocks all smoke coverage)
- Area: test infrastructure / seed
- Discovery method: `psql` direct query
- Evidence:
  ```sql
  SELECT email, role FROM staff WHERE email IN ('admin@signacare.local', 'sarah.chen@signacare.local', 'tom.obrien@signacare.local', 'james.wilson@signacare.local');
  -- 0 rows
  ```
- Impact: every Playwright E2E spec using `loginViaApi`/`loginAs` times out at 15-17s because the login fails (user not found), then `waitForURL('**/dashboard')` times out. Observed: 94 E2E tests ALL cascade-fail from this single missing-seed bug.
- Reproduction: `npm run test:e2e` → specs 1, 3, and every subsequent spec → timeout after 17s.
- Proposed fix shape: run `npm run seed:e2e-fixtures --workspace=apps/api` before E2E. OR add to playwright.config webServer command list. OR make `seed-e2e-fixtures.ts` run automatically as a `globalSetup`.
- Prior fix-registry row: none.
- Related: BUG-004 (login E2E).

### BUG-026 — MASSIVE COVERAGE GAP: ~65 Tier 12-19 backend endpoints have ZERO frontend/mobile callers
- Severity: **S2** (features shipped but unused)
- Area: coverage / architecture
- Discovery method: T11.1 grep
- Evidence:

| Backend area (mount) | Endpoints | Frontend callers |
|---|---|---|
| `/scribe/vocabulary` (Tier 12.5) | 4 | **0** |
| `/scribe/session/*` pause/resume/end (Tier 12.8-12.10) | 4 | **0** |
| `/scribe/session/:id/scan` + `/sensitive-flags/*` (Tier 13.1) | 3 | **0** |
| `/scribe/session/:id/action-items` + `/action-items/:id/*` (Tier 13.2) | 4 | **0** |
| `/scribe/session/:id/talk-time` (Tier 13.4) | 2 | **0** |
| `/scribe/note-templates` (Tier 13.5) | 2 | **0** |
| `/scribe/search` semantic (Tier 13.3) | 1 | **0** |
| `/letters/*` (Tier 15+16 new letter stack) | 18 | **0** (frontend still uses OLD `correspondence/letters/*`) |
| `/clinical/*` (Tier 17 structured artefacts) | 10 | **0** |
| `/admin/impersonate/*` (Tier 12.13) | 3 | **0** |
| `/admin/training/*` (Tier 19) | 14 | **0** |
| **TOTAL** | **~65** | **0** |

- Impact: backends built and tested, but NO user interface exists to exercise them. User-facing outcome: Tier 15-16 letter features (composer, review queue, delivery, exports, translations, revisions, structured artefacts) are invisible to clinicians. Admin training platform + admin impersonation inaccessible without API direct calls. The scribe enhancements (vocabulary management, pause/resume, sensitive-topic review, action items, talk-time display, note-template selection, semantic search) are likewise unwired.
- Proposed fix shape: this IS the "frontend implementation backlog" that T13.0.d tracker will document. Not a bug to fix in the bug-fix pass — it's feature work. Belongs in a separate UI sprint plan.
- Note: the frontend `correspondence/letters/*` path in [correspondenceApi.ts](apps/web/src/features/correspondence/services/correspondenceApi.ts) hits the OLD pre-Tier 15 endpoints. The NEW Tier 15-16 letter stack is completely parallel and unused. This is intentional per Tier 15 closeout (frontend was explicitly not-in-scope), but it means the new stack is dormant.

### BUG-027 — Mobile (Sara/Viva) coverage: Tier 12-19 NOT YET INTEGRATED
- Severity: **S3** (deferred per Tier 19 closeout)
- Area: mobile coverage
- Discovery method: no calls found in `apps/mobile/lib` / `apps/patient-app/lib` for Tier 12-19 endpoints (based on T11.1 grep scope).
- Impact: Sara (clinician) can't use the new scribe session pause/resume flows, new letter composer, or admin impersonation through the mobile UI.
- Proposed fix shape: T13.0.e mobile status tracker documents this.

---

## §12 — Fix-registry drift (T12.*)

### Current state: 807 rows, 807 pass, 8 retired. ✓ No drift.
Stale-row audit + anchor-quality audit deferred to §Rule-gaps section after full audit completes.

---

## §Rule-gaps — new guards/rules needed to prevent future classes

Preliminary list (to be finalised after all audits complete):

1. **Extend `check-no-silent-catches.sh` to scan apps/web/src** — would have caught BUG-005 and most of Bug 6.
2. **Add `check-required-seed-rows.ts` guard** — for a named list of tables, assert ≥1 row after migrate. Would have caught BUG-013, BUG-014.
3. **Add `check-query-key-invalidation.ts` guard** — AST walker that pairs `useQuery({queryKey: X})` with `invalidateQueries({queryKey: Y})` in the same component, assert prefix-match. Mechanically catches Bug 6 class.
4. **CLAUDE.md §11 Layer 5 Playwright → mandatory blocking merge gate.** No more "deferred" language.
5. **New memory `feedback_no_test_deferral.md`.**
6. **14th point on `feedback_audit_checklist.md`:** "Layer 5 evidence" required in every commit body for UI-touching changes.
7. **`apps/web/package.json` "test" script** — wire up vitest so apps/web unit tests run on CI.

---

## Phase II findings (after seed fix 2026-04-19 14:50)

### BUG-028 — Patient-detail tab specs cascade: patient-seed gap
- Severity: **S1** (test infra; not prod)
- Area: test infrastructure / e2e fixtures
- Evidence: E2E spec 10 (`edit patient preferred name via edit wizard`) fails in 13.3s; specs 14-37 (episodes + alerts-plans + correspondence + medications tabs on a patient) all 17-30s timeout.
- Root cause hypothesis: `e2e/fixtures/auth.ts:navigateToPatient(page, searchName)` searches the patient list by name — but the extended `seed-e2e-fixtures.ts` doesn't seed any patients. The helper times out searching an empty list. Fix: extend seed to include ≥1 patient per E2E fixture user.
- Impact: blocks ~20 downstream patient-detail-tab specs.
- Proposed fix shape: add a seeded patient (`Test Patient One`) to `seed-e2e-fixtures.ts` with basic demographics + an active episode.

### BUG-029 — Accessibility violations on /login + /patients + patient-detail tabs
- Severity: **S2**
- Area: a11y
- Evidence: 10 E2E a11y failures in the Phase II rerun:
  - `login.a11y.spec.ts:22` — critical/serious axe violations on /login
  - `patientList.a11y.spec.ts:17, 45, 55` — patient list has a11y violations; role=table missing; search input missing accessible name
  - `patientDetail.a11y.spec.ts:56, 61, 67, 73` — summary / clinical-notes / medications / risk tabs all have critical-or-serious violations
  - `topLevelRoutes.a11y.spec.ts:49, 58, 71` — /dashboard, /handover, /reports
- Impact: WCAG AA non-compliance on multiple surfaces. Real clinical / accessibility concern.
- Proposed fix shape: run `npx playwright test --reporter=html e2e/accessibility/` and read the detailed HTML report for the specific rule violations (missing alt text, contrast, missing aria-labels, etc.). Fix by rule, not by surface.

### BUG-030 — /handover, /nursing, /case-management pages fail to load correctly
- Severity: **S2**
- Area: clinical list pages
- Evidence: E2E 71 (`Shift handover page loads`) 2.8s fail; 73 (`Nursing page`); 75 (`Case Management page`) similar quick-fail pattern — NOT a timeout, a real fail assertion.
- Impact: core clinical surfaces render wrong (user-visible).
- Proposed fix shape: run the spec with `--headed --debug` to see the exact failing assertion.

### BUG-031 — Workflow: new-patient-journey spec fails (login + find patient + open episodes)
- Severity: **S1**
- Area: workflow / patient onboarding
- Evidence: `e2e/workflows/new-patient-journey.spec.ts:31` — clinician logs in, finds a patient, opens episodes tab, creates an episode. Fails at 17.4s. Related to BUG-028 (no seeded patient).

### Phase II probes RUN (partial) — BUG-032 discovered

Ran: `npx playwright test e2e/probes/route-crawler.spec.ts e2e/probes/api-contract.spec.ts`.
Result: **10 failed / 0 passed / 325 not-run** (serial blocks aborted after first failure in each project).

### BUG-032 — probe login-to-dashboard redirect fails across all 5 browsers
- Severity: **S1**
- Area: authentication / login redirect
- Discovery method: `e2e/probes/route-crawler.spec.ts` + `e2e/probes/api-contract.spec.ts` running in 5 projects (chromium, firefox, webkit, mobile-iphone, mobile-android)
- Evidence: every project's first test failed identically at `loginAs()`: `TimeoutError: page.waitForURL('**/dashboard') exceeded 15_000ms`. The login form submitted, but the browser never navigated to `/dashboard` within 15s.
- Reproduction:
  ```
  npx playwright test e2e/probes/route-crawler.spec.ts --project=chromium
  ```
- Root cause hypothesis: the `loginAs` helper waits for URL `**/dashboard` but the login-success redirect target may have changed (e.g. /change-password, /mfa, /). The simpler E2E specs work because some of them use direct API login + session-cookie injection; but the probes call the full UI flow.
- Why the regular E2E suite (Phase I) didn't flag it: the 39 tests that passed use `loginAs` + /dashboard path; they succeed. BUT the probes open in fresh contexts with a different timing pattern. Suspect: session-idle middleware or MFA gate intercepting on fresh browser contexts.
- Impact: blocks every probe from running. Also blocks a11y specs that use loginAs.
- Proposed fix shape: add diagnostic logging in `loginAs` — capture the URL after button click. Likely a redirect to `/change-password` (first-login flow) OR to `/mfa` needs to be handled.
- Evidence of browser install gaps: firefox + webkit binaries may not be installed; mobile-iphone/android use webkit. Install: `npx playwright install firefox webkit`.

### BUG-033 — vitest config excludes tests/integration/bughunt/
- Severity: **S4** (test infra)
- Area: apps/api vitest.config.ts
- Discovery method: `npm run test --workspace=apps/api -- tests/integration/bughunt/` → "No test files found"
- Evidence: `apps/api/vitest.config.ts:17-27` excludes `tests/integration/**`. The Tier 12-19 integration tests landed in `tests/integration/bughunt/` subdir are INCLUDED in that exclusion.
- Impact: Tier 12-19 integration tests don't run via standard `npm run test`. Need either (a) run via `scripts/run-integration-tests.mjs` (needs extension to walk subdirs), or (b) separate vitest config, or (c) promote tests up one level.
- Proposed fix shape: update `scripts/run-integration-tests.mjs` to recurse into subdirs OR use glob `tests/integration/**/*.int.test.ts`.

Similarly, visual regression baseline (II.L) is written. First run produces the PNG baselines to commit:
```bash
npx playwright test --project=visual e2e/visual/ --update-snapshots
```

### Phase II infrastructure delivered

- ✓ `apps/api/src/seed-e2e-fixtures.ts` extended: 1 user → 5 users + 2 clinics.
- ✓ `e2e/fixtures/auth.ts` console/pageerror capture fixture added.
- ✓ `e2e/fixtures/routes.ts` — 67 enumerated React-router routes (NEW).
- ✓ `e2e/probes/*.spec.ts` — 7 new probe files (route-crawler, save-round-trip, button-smoke, api-contract, double-submit, loading-states, rbac-matrix + chaos).
- ✓ `e2e/visual/top-traffic-screens.visual.spec.ts` — 10-screen visual-regression baseline spec.
- ✓ `playwright.config.ts` extended: 6 projects (chromium, firefox, webkit, mobile-iphone, mobile-android, visual).
- ✓ `stryker.conf.mjs` — mutation testing config targeting 5 high-value modules.
- ✓ `apps/api/tests/integration/bughunt/` — 4 new Tier 12-19 integration suites.
- ✓ `docs/audit-2026-04-19/manual-test-backlog.md` — 50 human-only test scenarios across 4 personas.

## Discovery progress tracker

| Task | Status | Findings |
|---|---|---|
| T1.1 Playwright E2E baseline | 94 tests, 90+ cascade-failing from BUG-025 | BUG-004, BUG-025 |
| T1.2 Vitest apps/web | DONE | BUG-015 |
| T1.3 apps/api tests | DONE | BUG-001, 002, 003 |
| T1.4 tsc across 3 workspaces | CLEAN | — |
| T1.5 CI guards | DONE | BUG-005 through BUG-009 |
| T1.6 Playwright fixme/skip inspection | DEFERRED (E2E still running) | — |
| T2.1-T2.10 Probes | NOT WRITTEN (scope deferred to future pass) | — |
| T3 Integration tests for Tier 12-19 | NOT WRITTEN — documented as gap in §3 | BUG-026 |
| T4.1-T4.15 Static audits | DONE | BUG-005 through BUG-012 |
| T5.1-T5.7 DB state audits | DONE | BUG-013 through BUG-019 |
| T6.* Persona walkthroughs | DEFERRED — needs browser session | — |
| T7.* Accessibility scans | Partial via E2E (blocked by login cascade) | — |
| T8.* Network/console capture | Pending probe + rerun | — |
| T9.* RBAC/RLS matrix | Partial via T4.8 | BUG-020-024 candidates |
| T10.* Spike-register drift | DONE — no drift | — |
| T11.* Backend/frontend/mobile coverage | DONE | BUG-026, BUG-027 |
| T12 Fix-registry drift | DONE | — |
| T13.0 Housekeeping | Partial — registers ✓, trackers pending | — |
| T14 Consolidate + commit | DONE (this file) | — |

## What was NOT completed in this pass (explicit deferrals)

1. **Dynamic probes T2.1-T2.10** — planned 10 probes (route-crawler, save-round-trip, button-smoke, task-lifecycle, API-contract, double-submit, loading-states, RBAC matrix, RLS cross-tenant, console capture fixture). Not written. Given BUG-025 blocks the E2E seed path entirely, probes would cascade-fail the same way. Fix BUG-025 first, then write probes in a follow-up session.
2. **Backend integration tests T3** — planned 5 test files covering Tier 12-19. Not written. The BUG-026 coverage gap dominates — backends are unused, so integration-testing them alone without the UI is still a useful signal, but writing them is the fix-pass agenda.
3. **Manual persona walkthroughs T6** — need a browser + human. The catalogue framework is ready.
4. **A11y scans T7** — existing 4 a11y specs cascade-fail via BUG-025. Will run clean once seed is in place.
5. **Frontend + mobile trackers T13.0.d, T13.0.e** — deferred to fix pass; BUG-026 + BUG-027 are the source-of-truth input.

## Next pass (fixing) — ordered entry point

P0 HARD-BLOCKER (fix first):
1. **BUG-025** — seed E2E users. Run `npm run seed:e2e-fixtures --workspace=apps/api`, OR better: wire into `playwright.config.ts` `globalSetup`. Without this, no probe / spec / a11y can run.
2. **BUG-013** — seed rating-scale templates. Run `seed-rating-scales.ts`, OR promote to a migration.

S1 workflow-blocking:
3. BUG-001, 002 — buildPatientContext medication/problem/observation rendering.
4. BUG-005 — 40+ silent catches in apps/web.
5. BUG-021-023 — clinic_id defense-in-depth in reports + billing repos (verify first).
6. BUG-004 — auth E2E (downstream of BUG-025; re-run after seed fix).

S2 feature-broken:
7. BUG-014 — clinical_templates seed.
8. BUG-006 — 3 silent catches in llmRoutes.ts.
9. BUG-010 — SQL-injection hardening in matviewRefreshScheduler + reset-patient-data.
10. BUG-026 — Tier 12-19 frontend build-out (multi-sprint feature work).

S3 cosmetic / defense:
11. BUG-003 — architecture smoke (cross-feature import).
12. BUG-009 — parseInt radix (8 sites).
13. BUG-011, 012 — escapeLike on 2 ILIKE patterns.
14. BUG-018 — 4 missing indexes.
15. BUG-024 — backup_history clinic_id check.
16. BUG-027 — mobile coverage.

S4 trivial:
17. BUG-007, 008, 015, 016 — npm script, void requireEnv, apps/web test script, archived docs.

## Rule-gaps to address post-fix (prevention pass)

The user's prior directive: "no test deferred, ever". These 4 additions would mechanically prevent most of the bug classes found:

1. **Extend `check-no-silent-catches.sh` to scan apps/web/src.** Would have caught BUG-005 + Bug 6.
2. **New `check-required-seed-rows.ts` guard.** For named tables (templates, clinical_templates, letter_templates, etc.), assert ≥1 row after migrate. Would have caught BUG-013 + BUG-014.
3. **Wire `npm run seed:e2e-fixtures` into playwright.config `globalSetup`.** Would have caught BUG-025 from day 1.
4. **Extend `check-no-silent-catches.sh` or add `check-query-key-invalidation.ts`** to pair every `useQuery({queryKey: X})` with every `invalidateQueries({queryKey: Y})` in the same component and assert prefix-match. Catches Bug 6 class statically.
5. **CLAUDE.md §11 Layer 5 → blocking merge gate** + new memory `feedback_no_test_deferral.md`.

These 5 items are the "next pass" input; they are NOT being applied in this discovery pass.

