# Signacare EMR — Multi-Specialty Expansion Plan

## Context

Signacare today is a mental-health EMR. The clinical modules (LAI, clozapine, MHA, risk, clinical review, treatment pathways) are hardcoded into the sidebar and the 20+ tabs in [PatientDetailLayout.tsx](apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx). The underlying primitives (`patients`, `episodes`, `referrals`, `patient_medications`, `staff`, `orgunits`) are mostly specialty-agnostic but have no typing or scoping for specialty, so every new feature has to fork a code path.

The goal is to add six clinical specialties — **Internal Medicine, Endocrinology, Paediatrics, Obstetrics & Gynaecology, Surgery, Oncology** — that:

1. Share one `patients` row per human (no duplicate registration).
2. Each have their own episodes, referral workflows, templates, and clinical data.
3. Render only the modules a clinician actually needs (visibility scoped to **clinic enabled_specialties ∩ staff_specialties ∩ patient's open episodes**) so a solo psychiatrist doesn't see oncology chrome and an oncologist doesn't see LAI charts on every patient.
4. Always surface safety-critical cross-specialty information — **allergies, active problems from every specialty, and the full medication list with prescriber specialty tagged** — on the patient banner, summary, and medications pages. Specialty filters on those pages are additive chips, never default-on.
5. Support a flexible **referral_coordinator** role: in a small clinic the same person triages and treats (auto-degrade); in a large public hospital a dedicated coordinator runs the triage queue. One code path, behaviour driven by who exists in `staff_specialties`.
6. Align with FHIR where it's cheap — `EpisodeOfCare` semantics for episodes, `ServiceRequest + Task` split for referrals, **mCODE profile names** (PrimaryCancerCondition, TNMStageGroup, ECOGPerformanceStatus) for oncology tables from day one.

User confirmed all four architectural choices: Internal Medicine ships first; visibility = clinic ∩ staff ∩ patient episodes; new `referral_coordinator` role with auto-degrade; mCODE-named tables from day one.

---

## Architecture at a glance

```
         ┌─────────────┐
         │  patients   │  (shared, specialty-agnostic)
         └──────┬──────┘
                │ 1:N
         ┌──────▼──────────────────────┐
         │  episodes  (specialty enum) │  ← one EpisodeOfCare per specialty thread
         └──────┬──────────────────────┘
                │ 1:N                          ┌───────────────────────┐
    ┌───────────┼────────────┬──────────────►  │ patient_medications   │
    │           │            │                 │ + prescribed_by_      │
    ▼           ▼            ▼                 │   specialty, category │
clinical     pathology    specialty-private    └───────────────────────┘
  notes                   tables (problem_list,    (always visible in banner,
                          growth_measurements,      additive specialty filter)
                          pregnancies,
                          surgical_cases,
                          primary_cancer_conditions…)

staff ──► staff_specialties ──► (gates visibility + referral queues)
clinics.enabled_specialties ──► (gates modules at tenant level)
```

**Module visibility** is computed once per page load in a `ModuleContext` provider and read by the Sidebar and PatientDetailLayout from a shared `MODULE_REGISTRY` in `packages/shared/src/moduleRegistry.ts`. No hardcoded tabs, no hardcoded nav.

**Referrals** use a `ServiceRequest`-like intent (the `referrals` row) plus a `Task`-like lifecycle (`task_status` column). If a clinic has zero `referral_coordinator` staff for the target specialty, creation auto-advances the task past triage and assigns it to the referring clinician.

---

## Phase 0 — Foundations (shared types + schema)   *Complexity: L*

Nothing downstream ships without this. Must pass existing MH e2e specs before any UI changes.

**Shared package** — `packages/shared/src/`
- New `specialty.schemas.ts`:
  ```ts
  export const SpecialtyTypeEnum = z.enum([
    'general_medicine','endocrinology','paediatrics',
    'obstetrics_gynaecology','surgery','oncology','mental_health'
  ]);
  export const SPECIALTY_DISPLAY: Record<SpecialtyType, string> = {…};
  export const SPECIALTY_ICON: Record<SpecialtyType, string> = {…};
  ```
- Extend [rbac.schemas.ts](packages/shared/src/rbac.schemas.ts): add role `referral_coordinator`; add permissions `specialty:enroll`, `referral:triage`, `referral:assign`. **Do not** add per-specialty permission strings — specialty gating is ABAC via `staff_specialties`, not RBAC.
- Extend [provisioning.schemas.ts](packages/shared/src/provisioning.schemas.ts): add `enabled_specialties: SpecialtyTypeEnum.array()` on clinic.

**Migrations** (follow CLAUDE.md §7 + §9.3 checklist — RLS, NOT NULL, `patient_id`/`clinic_id` indexes, unique constraints)
1. `20260420_specialty_typing.ts`
   - Create Postgres enum `specialty_type`.
   - `ALTER TABLE episodes` ADD `specialty specialty_type NOT NULL DEFAULT 'mental_health'`; backfill from `episode_type` heuristics; add `INDEX (patient_id, specialty, status)`.
   - `ALTER TABLE clinics` ADD `enabled_specialties specialty_type[] NOT NULL DEFAULT '{mental_health}'`.
2. `20260421_staff_specialties.ts`
   - New `staff_specialties` junction: `(id, staff_id FK, specialty, is_primary, credential_ref, clinic_id, created_at, created_by)`. Unique `(staff_id, specialty)`. Indexes on `staff_id`, `clinic_id`. RLS policy per CLAUDE.md §6.3.
3. `20260422_medications_generalize.ts`
   - `ALTER TABLE patient_medications` ADD `prescribed_by_specialty specialty_type NULL`, `prescribed_in_episode_id uuid NULL REFERENCES episodes`, `category text NULL`. Keep `is_lai`, `is_clozapine`, `is_s8` as legacy convenience flags but new code reads `category`. Backfill: `is_lai OR is_clozapine → prescribed_by_specialty = 'mental_health'`.
4. `20260423_patient_active_specialties_view.ts`
   - Create view `patient_active_specialties AS SELECT patient_id, clinic_id, array_agg(DISTINCT specialty) AS specialties FROM episodes WHERE status IN ('active','admitted') AND deleted_at IS NULL GROUP BY patient_id, clinic_id`. Derived, not stored — no sync drift.
5. `20260424_rls_specialty_scope.ts`
   - Postgres function `staff_can_see_specialty(staff_uuid, specialty_type) RETURNS bool`: true if `clinic.enabled_specialties @> ARRAY[specialty]` AND (`EXISTS staff_specialties` OR staff role has cross-specialty flag). Apply to `episodes` SELECT policy as defence-in-depth.

**Backfill tooling.** One-off script `scripts/backfill-episode-specialty.ts` (dry-run by default) tags existing episodes. Ship a tiny admin "Re-tag episodes" screen for clinics whose `episode_type` is messy.

**Reuses:** existing migration pattern from [20260316000000_create_base_schema.ts:110-141](apps/api/migrations/20260316000000_create_base_schema.ts#L110-L141); [episodeRepository.ts](apps/api/src/features/episode/episodeRepository.ts) unchanged structurally.

**Verification.** Migration up/down round-trip; MH smoke suite passes unchanged; `SELECT` on `episodes` with a test clinic returns only enabled specialties for a non-cross-specialty staff; backfill dry-run diff reviewed.

---

## Phase 1 — Referral flexibility (ServiceRequest + Task split)   *Complexity: M*

**Schema** — `20260425_referrals_servicerequest_task.ts`
- `ALTER TABLE referrals`:
  - ADD `target_specialty specialty_type NOT NULL` (replaces untyped `distribution_speciality`; keep old column for one release).
  - ADD `service_request_status enum('draft','active','revoked','completed') NOT NULL DEFAULT 'active'`.
  - ADD `task_status enum('requested','received','accepted','rejected','in_progress','completed') NOT NULL DEFAULT 'requested'`.
  - ADD `coordinator_id uuid NULL REFERENCES staff`, `triaged_at timestamptz NULL`, `triaged_by uuid NULL`.
- New `referral_state_transitions` audit table `(referral_id, from_status, to_status, actor_id, reason, created_at)`.

**Backend** — [apps/api/src/features/referrals/](apps/api/src/features/referrals/)
- Extend [referralRepository.ts](apps/api/src/features/referrals/referralRepository.ts): `listCoordinatorQueue(clinicId, specialty, coordinatorId?)`, `claim()`, `assignTo()`, `transition(referralId, nextTaskStatus, actorId)`. Always include `clinic_id` in WHERE per CLAUDE.md §1.3; always `.whereNull('deleted_at')` on tables that have it; use atomic transitions per §1.6.
- New routes `POST /referrals/:id/triage` (`referral:triage`), `POST /referrals/:id/assign` (`referral:assign`), `GET /referrals/queue?specialty=…` (coordinator queue).
- **Auto-degrade rule** in `createReferral`: if `COUNT(staff_specialties WHERE specialty = target_specialty AND role = 'referral_coordinator') = 0`, set `task_status = 'accepted'` and `assigned_to_id = target_clinician_id OR NULL` (self-claim flow). One code path; behaviour emergent from seed data.

**RBAC.** [rbac.schemas.ts](packages/shared/src/rbac.schemas.ts): `referral_coordinator` gets `referral:read`, `referral:triage`, `referral:assign`, `patient:read`, `task:*`. `clinician` also gets `referral:triage` so solo workflows keep working.

**Frontend** — [apps/web/src/features/referrals/](apps/web/src/features/referrals/) and [ereferral/](apps/web/src/features/ereferral/)
- New `ReferralCoordinatorQueue.tsx`: tabs per `target_specialty`, filters by `task_status`. Route `/referrals/queue`. Rendered only if user has `referral:triage`. Uses a query key factory `referralKeys.queue(specialty)` so mutations invalidate cleanly (CLAUDE.md §4.1–4.3).
- Existing referral create form: `target_specialty` dropdown sourced from `clinic.enabled_specialties`.

**Verification.** Two-clinic e2e. Clinic A (solo): create referral → lands on clinician, no triage UI. Clinic B (hospital with a seeded coordinator): same payload → lands on coordinator queue, requires triage to surface. Unit test the auto-degrade rule with fixture clinics.

**Risks.** Existing in-flight referrals need a `target_specialty = 'mental_health'` backfill in the same migration.

---

## Phase 2 — Module visibility framework   *Complexity: L*

**Shared package** — new `packages/shared/src/moduleRegistry.ts`
```ts
export type ModuleDescriptor = {
  id: string;                          // e.g. 'oncology.tumour-board'
  specialty: SpecialtyType | 'core';   // 'core' = always-on
  displayName: string;
  icon: string;
  requiredRoles: Role[];               // any-of
  requiredPermissions: Permission[];   // all-of
  navItems: { path: string; label: string; order: number }[];
  patientTabs: {
    id: PatientTabId;
    label: string;
    order: number;
    componentKey: string;              // resolved to React.lazy on frontend
  }[];
  alwaysOn?: boolean;                  // banner, meds, allergies, problems, documents
};
export const MODULE_REGISTRY: ModuleDescriptor[] = [ … ];
```
Phase 2 ships entries for `core` (always-on: summary, allergies, medications, problems, documents) plus the existing MH modules. Phases 3–8 each add their own entries.

**Frontend** — [apps/web/src/shared/](apps/web/src/shared/)
- New `contexts/ModuleContext.tsx`. Visible modules =
  - For non-patient pages: `alwaysOn ∪ (clinic.enabled_specialties ∩ staff.specialties)`
  - For patient pages: additionally `∩ patient.active_specialties` (from the view in Phase 0) — but `alwaysOn` is always included.
- Refactor [Sidebar.tsx](apps/web/src/shared/components/ui/Sidebar.tsx): replace the hardcoded nav array (around lines 72–120) with `useModules().navItems` sorted by `order`, grouped by specialty header. Role filtering stays.
- Refactor [PatientDetailLayout.tsx](apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx): replace the static `PATIENT_TABS` import (~line 43) and the switch rendering tab components with a registry-driven render using `React.lazy(() => import(...))` resolved from `componentKey`. Keep existing tab-id strings stable so deeplinks `?tab=lai` continue to work.
- New `<SpecialtyFilterChips />` component above patient summary and medications: additive only, never default-on.

**Backend.**
- Extend `GET /staff/me` to return `specialties` (from `staff_specialties`) and `clinic.enabled_specialties`.
- New `GET /patients/:id/active-specialties` reads the view from Phase 0.

**Verification.** Snapshot Sidebar for three personas (solo psychiatrist → MH only; endocrinologist → endo only; admin → all enabled). Deeplink regression suite. Verify no regression in existing MH tab flow.

**Risks.** Any other place that imports `PATIENT_TABS` — grep and migrate. Lazy-load failures must fall back with an error boundary.

---

## Phase 3 — Internal Medicine (ships first)   *Complexity: M*

**Why first.** Gives us the shared chassis every other specialty reuses: problem list, vitals flowsheet, med rec. Lowest risk, highest leverage.

**Reuses.** `episodes` (specialty=`general_medicine`), `patient_medications`, `pathology`, `clinical-notes`, existing vitals in [`physical-health`](apps/web/src/features/physical-health/) (extend, don't duplicate).

**New tables** — `20260426_internal_medicine.ts`
- `problem_list` — `(id, patient_id, clinic_id, code_system, code, display, status enum('active','resolved','inactive'), onset_date, recorded_by, episode_id NULL, created_at, deleted_at)`. **Patient-level, episode_id nullable** so it cross-pollinates between specialties. Full CLAUDE.md §7 checklist: RLS, NOT NULL, indexes, soft-delete.
- `medication_reconciliations` — `(id, patient_id, episode_id, performed_by, performed_at, snapshot jsonb, context enum('admission','discharge','transfer','outpatient'))`.

**Backend** — new `apps/api/src/features/internal-medicine/`
- `problemListRepository.ts`, `problemListRoutes.ts`, `medRecRepository.ts`, `medRecRoutes.ts`. Every query includes `clinic_id`, filters `deleted_at IS NULL` on tables that have it. Async handlers wrap in try/catch + `next(err)` per §3.1.

**Frontend** — new `apps/web/src/features/internal-medicine/`
- `ProblemListPage.tsx`, `ChronicDiseaseRegister.tsx`, `MedRecWorkflow.tsx`. Registered in `MODULE_REGISTRY` as patient tabs `problems` and `med-rec`. Query key factory `internalMedicineKeys.problems(patientId)`.

**MVP data elements.** Active problem list (ICD-10/SNOMED code capture), vitals flowsheet re-surface, med rec on admission/discharge.

---

## Phase 4 — Endocrinology   *Complexity: M*

**Reuses.** `pathology` (HbA1c, TSH, lipids), `patient_medications` (insulin via `category='insulin'`), `episodes`.

**New tables** — `20260427_endocrinology.ts`
- `glucose_readings` — `(id, patient_id, clinic_id, value_mmol, measured_at, source enum('cgm','fingerstick','lab'), meal_context enum('fasting','pre_meal','post_meal','bedtime','random'), episode_id NULL)`.
- `insulin_regimens` — `(id, patient_id, clinic_id, basal_drug, basal_dose, bolus_drug, correction_factor, carb_ratio, target_low, target_high, valid_from, valid_to, created_by)`.
- `cgm_imports` — `(id, patient_id, clinic_id, blob_ref, processed_at, raw_format)`.

**Backend** — `apps/api/src/features/endocrinology/`. CGM ingest can be a stub worker — just store blob, process later.

**Frontend** — `apps/web/src/features/endocrinology/`: `HbA1cTrendPanel` (reads pathology), `InsulinRegimenEditor`, `GlucoseFlowsheet` with Time-In-Range calc. Registered as patient tabs `glucose`, `insulin`.

**MVP.** HbA1c trend, insulin regimen, glucose flowsheet + TIR.

---

## Phase 5 — Paediatrics   *Complexity: L*

**Reuses.** `episodes`, `patient_medications` (weight-based dosing), allergies.

**New tables** — `20260428_paediatrics.ts`
- `growth_measurements` — `(id, patient_id, clinic_id, age_days, weight_kg, height_cm, head_circ_cm, bmi, percentile_who, percentile_cdc, measured_at, measured_by, episode_id NULL)`.
- `immunizations` — `(id, patient_id, clinic_id, cvx_code, dose_number, administered_date, lot_number, site, route, administered_by)`. CVX-coded per CDC standard.
- `developmental_milestones` — `(id, patient_id, clinic_id, domain enum('gross_motor','fine_motor','language','cognitive','social'), milestone_code, achieved_at_months, status enum('achieved','delayed','not_assessed'))`.

**Reference data.** Ship WHO 0–2y and CDC 2–20y LMS tables as static JSON in `packages/shared/src/refdata/growth/` (single source of truth).

**Backend** — `apps/api/src/features/paediatrics/`. Growth percentile calc service uses the LMS method from the ref data.

**Frontend** — `apps/web/src/features/paediatrics/`: `GrowthChartPage` (SVG percentile plot), `ImmunizationSchedule` (shows CDC catch-up), `MilestoneTracker`, reusable `useWeightBasedDose()` hook consumed by prescriptions form.

**MVP.** Growth charts, CVX immunizations, milestones, weight-based dosing.

---

## Phase 6 — Obstetrics & Gynaecology   *Complexity: L*

**Reuses.** `episodes` (specialty=`obstetrics_gynaecology`, sub-type `antenatal`/`gynae` via existing `episode_type`), `appointments` (antenatal visit schedule), `pathology`.

**New tables** — `20260429_obs_gyne.ts`
- `pregnancies` — `(id, patient_id, clinic_id, episode_id, lmp_date, edd_date, gtpal jsonb, status enum('ongoing','delivered','miscarried','terminated'))`.
- `antenatal_visits` — `(id, pregnancy_id, clinic_id, visit_number, ga_weeks, fundal_height_cm, fetal_hr, bp_systolic, bp_diastolic, urine_protein, urine_glucose, oedema, seen_by, visit_date)`.
- `partograms` — `(id, pregnancy_id, clinic_id, time_series jsonb)`.
- `ctg_traces` — `(id, pregnancy_id, clinic_id, blob_ref, interpretation, classified_by)`.

**Backend** — `apps/api/src/features/obs-gyne/`. EDD calculator (Naegele), antenatal visit auto-generator (creates appointments per RCOG schedule).

**Frontend** — `PregnancyDashboard`, `AntenatalVisitForm`, `PartogramView`, `GTPALEditor`.

**MVP.** LMP/EDD, GTPAL, antenatal visits, fundal height + CTG capture.

---

## Phase 7 — Surgery   *Complexity: L*

**Reuses.** `episodes`, `appointments` (theatre slot), Phase 1 referrals, `clinical-notes`.

**New tables** — `20260430_surgery.ts`
- `surgical_cases` — `(id, patient_id, clinic_id, episode_id, procedure_code, procedure_display, primary_surgeon_id, planned_date, urgency enum('elective','urgent','emergency'), asa_class smallint, consent_status enum('pending','signed','withdrawn'))`.
- `safety_checklists` — `(id, case_id, clinic_id, phase enum('sign_in','time_out','sign_out'), items jsonb, completed_by, completed_at)`. WHO 3-phase checklist is mandatory; checklist completion required before status transition.
- `op_notes` — `(id, case_id, clinic_id, indication, findings, procedure_text, complications, estimated_blood_loss_ml, specimens jsonb, closed_at)`.
- `pacu_records` — `(id, case_id, clinic_id, vitals jsonb, aldrete_score, discharge_criteria_met, recovery_end_at)`.

**Backend** — `apps/api/src/features/surgery/`. Enforce "checklist complete before sign-off" in the repository, not just the UI.

**Frontend** — `SurgicalCaseList`, `WHOChecklistWizard` (3 modal screens), `OpNoteEditor`, `PACUFlowsheet`.

**MVP.** WHO Surgical Safety Checklist, ASA class, op note, PACU recovery.

---

## Phase 8 — Oncology (mCODE-aligned)   *Complexity: XL*

**Reuses.** `episodes`, `patient_medications` (chemo via `category='cancer_related'`), `pathology` (tumour markers), Phase 1 referrals (MDT referral flow).

**New tables (mCODE profile names — user confirmed)** — `20260501_oncology_mcode.ts`
- `primary_cancer_conditions` — `(id, patient_id, clinic_id, episode_id, icd10, snomed, histology, laterality, diagnosis_date, stage_system enum('ajcc8','uicc8'))`.
- `tnm_stage_groups` — `(id, condition_id, clinic_id, t, n, m, stage_group, staged_at, staged_by)`.
- `ecog_performance_status` — `(id, patient_id, clinic_id, score smallint CHECK (score BETWEEN 0 AND 5), assessed_at, assessed_by)`.
- `cancer_treatment_plans` — `(id, condition_id, clinic_id, regimen_name, intent enum('curative','palliative','adjuvant','neoadjuvant'), protocol_ref, start_date, end_date)`.
- `chemo_cycles` — `(id, plan_id, clinic_id, cycle_number, planned_date, actual_date, dose_modifications jsonb, toxicity_ctcae jsonb)`.
- `tumour_board_decisions` — `(id, condition_id, clinic_id, meeting_date, attendees uuid[], recommendation, rationale)`.

**Backend** — `apps/api/src/features/oncology/`. BSA calculator service (Mosteller), CTCAE grading helpers, pre-chemo lab safety-hold rules.

**Frontend** — `CancerJourneyTimeline`, `StagingForm` (TNM picker), `TreatmentPlanBuilder`, `ChemoCycleTracker`, `TumourBoardPage`.

**MVP.** PrimaryCancerCondition, TNM staging, ECOG, treatment plan, chemo cycle tracking. FHIR mCODE interop is free when exports are needed.

---

## Phase 9 — Cross-module summary & medications surfacing   *Complexity: M*

**Backend.**
- New `GET /patients/:id/cross-specialty-summary`: aggregates allergies, full `problem_list` (regardless of episode), open `episodes` grouped by specialty, active flags, recent vitals. Single call to avoid N specialty round-trips.
- Extend `GET /patients/:id/medications`: join `prescribed_by_specialty`, prescriber name, episode tag. Accept `?specialty=` filter (additive — empty = all).
- New `medicationInteractionService.ts`: runs drug-interaction check across the **entire** med list ignoring specialty. Ships with a static high-risk-pair JSON (warfarin+NSAID, MAOI+SSRI, tamoxifen+SSRI, methotrexate+trimethoprim, etc.); pluggable for a real drug DB later.

**Frontend.**
- Refactor `SummaryTab.tsx`: render aggregated problems and active episodes with a `<SpecialtyChip />` per entry. `<SpecialtyFilterChips />` at top — additive, never default-on.
- Refactor `MedicationsTab.tsx`: add `Prescriber Specialty` column, specialty filter chips, persistent interaction banner that always evaluates every med. The legacy LAI/clozapine chips become decorative — driven by `category`, not the source of truth.
- Patient banner: allergies + active flags always visible regardless of which module the clinician entered the chart from.

**Verification.** Mixed-specialty fixture (psych + diabetes + breast cancer). Clinician with only MH specialty still sees:
  (a) cancer meds in the list, tagged with "Oncology prescriber",
  (b) tamoxifen+SSRI interaction banner on the medications page,
  (c) active oncology problems on the summary (with a "non-MH" specialty chip).

---

## Cross-cutting concerns

**Dependency chain.** Phase 0 blocks everything. Phase 2 blocks Phases 3–8. Phase 1 is independent of Phase 2 but ships before the specialty modules so each new module's referral form uses the new flow. Phase 9 ships last — it needs real data from at least one non-MH specialty to be meaningful.

**Migration safety.** `episodes.specialty` enum addition is the most fragile step. Gate behind the existing feature-flag system; back up before migrating; provide dry-run backfill.

**RBAC discipline.** No per-specialty permission strings. Specialty gating is ABAC via `staff_specialties`. [rbacMiddleware.ts](apps/api/src/middleware/rbacMiddleware.ts) already separates role and permission checks cleanly — extend, don't rewrite.

**MH regression risk.** All existing MH features must keep working with `specialty='mental_health'` as default. Phase 0 adds a smoke-test suite that runs existing MH e2e specs against the new schema before any UI refactor.

**Deeplink stability.** `/patients/:id?tab=lai` and similar must continue resolving after the registry refactor — keep `PatientTabId` strings stable.

**Coordinator rollout.** `referral_coordinator` role needs seeding into existing clinics. Ship an admin migration script — not automatic role-creation.

**Every new table.** RLS policy, `clinic_id` + `patient_id` indexes, NOT NULL on required columns, unique constraints for business rules, soft-delete column only if the pattern fits, JSONB extraction in GET responses per CLAUDE.md §1.7.

---

## Critical files

**Migrations & schema**
- [apps/api/migrations/20260316000000_create_base_schema.ts:64-141](apps/api/migrations/20260316000000_create_base_schema.ts#L64-L141) — reference for patients/episodes base schema that Phase 0 alters.
- [apps/api/migrations/20260317000001_patient_medications.ts:38-85](apps/api/migrations/20260317000001_patient_medications.ts#L38-L85) — medications schema generalized in Phase 0.

**Shared package**
- [packages/shared/src/rbac.schemas.ts](packages/shared/src/rbac.schemas.ts) — add `referral_coordinator` role, new permissions.
- [packages/shared/src/referralSchemas.ts](packages/shared/src/referralSchemas.ts) — add `target_specialty`, `service_request_status`, `task_status`.
- [packages/shared/src/provisioning.schemas.ts](packages/shared/src/provisioning.schemas.ts) — add `enabled_specialties`.
- **New** `packages/shared/src/specialty.schemas.ts` — `SpecialtyTypeEnum` single source of truth.
- **New** `packages/shared/src/moduleRegistry.ts` — `ModuleDescriptor` + `MODULE_REGISTRY`.

**Backend**
- [apps/api/src/features/referrals/referralRepository.ts](apps/api/src/features/referrals/referralRepository.ts) — triage/assign/claim/transition methods (Phase 1).
- [apps/api/src/features/episode/episodeRepository.ts](apps/api/src/features/episode/episodeRepository.ts) — specialty-typed episode queries (Phase 0).
- [apps/api/src/middleware/rbacMiddleware.ts](apps/api/src/middleware/rbacMiddleware.ts) — extend for ABAC specialty checks; do not rewrite.

**Frontend**
- [apps/web/src/shared/components/ui/Sidebar.tsx](apps/web/src/shared/components/ui/Sidebar.tsx) — registry-driven nav (Phase 2).
- [apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx](apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx) — registry-driven tabs (Phase 2).
- **New** `apps/web/src/shared/contexts/ModuleContext.tsx`.
- Existing patient summary + medications tabs — refactor in Phase 9.

---

## Verification plan

**Per-phase gates** (before merging a phase)
1. `npx tsc --noEmit` — zero errors in changed files.
2. Migration up + down round-trip on a seeded clinic.
3. `npm run dev` — API + web boot without errors. `curl localhost:4000/health` → `{"status":"ok"}`.
4. MH smoke suite still green (LAI dashboard, clozapine titration, MHA orders, risk assessment, clinical review).
5. Two-clinic e2e for the phase's feature: (a) solo clinic, (b) hospital clinic with coordinator.
6. Multi-tenant isolation test per CLAUDE.md §8.7 — two clinics, each sees only its own specialties and data.
7. Query-key invalidation verified — save, no manual refresh needed (CLAUDE.md §4).

**End-to-end mixed-specialty acceptance test** (after Phase 9)
Fixture patient with three concurrent episodes: mental health (clozapine), endocrinology (T2DM on insulin), oncology (stage II breast cancer on tamoxifen).
- Log in as psychiatrist (MH specialty only): sees clozapine tabs, does NOT see oncology tabs, DOES see all three meds on medications page with prescriber-specialty chips, SEES tamoxifen+SSRI interaction banner, sees active oncology problem on summary with an "Oncology" chip.
- Log in as oncologist (oncology specialty only): sees tumour board + chemo tabs, does NOT see clozapine tabs, DOES see clozapine on medications, DOES see the MH problem list entry.
- Log in as admin: sees everything the clinic has enabled.
- Log in as referral coordinator: sees only the queue for their specialty; can triage → assign; assignment creates a task for the clinician; clinician receives it via `/my-offers`.

**Automated regression.** Growth-chart percentile calc unit tests (known WHO/CDC data points). TNM staging validator. WHO checklist state machine. Interaction service high-risk-pair catalogue.
