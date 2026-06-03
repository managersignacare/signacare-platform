# BUG-402 — Plan (locked)

**Goal.** Apply column-based optimistic locking to `treatment_pathways` so concurrent PATCH `/pathways/:id` and POST `/pathways/:id/session` calls cannot silently overwrite each other's `milestones` JSONB. Reuses the BUG-371a helper unchanged.

## Why this differs from BUG-371

BUG-371 covered scalar-column tables (prescriptions, patient_medications, episodes). BUG-402's hot data lives **inside** a single JSONB column (`milestones`) — both racy mutations are read-modify-write JSONB merges. The opt-lock invariant is the same; the patch construction is a server-side shallow merge.

## Asymmetric Zod posture

REQUIRED at the Zod boundary. Only 2 web mutators (PathwaysTab, PathwaysPage); zero mobile/external clients. Atomic flip is safe — no transition shim, no warn-log path.

## Implementation steps (locked order)

1. **Migration** — `apps/api/migrations/20260701000038_bug_402_treatment_pathways_lock_version.ts` — append `lock_version int NOT NULL DEFAULT 1`. Builder-first with `hasColumn` idempotency. No-op `down()`.
2. **Snapshot regen** — update `apps/api/src/db/schema-snapshot.json` to include `lock_version` on `treatment_pathways`.
3. **Repository extract** — NEW `apps/api/src/features/treatment-pathways/pathwayRepository.ts`. Holds `TREATMENT_PATHWAY_COLUMNS` (incl. `lock_version`), `TreatmentPathwayRow` interface, `findById`, `listForPatient`, `create`, `update` (server-side shallow JSONB merge → calls `updateWithOptimisticLock`).
4. **Zod schemas** — `packages/shared/src/treatmentPathway.Schemas.ts`:
   - Add `UpdateTreatmentPathwaySchema` with REQUIRED `expectedLockVersion`.
   - Add `RecordSessionSchema` with REQUIRED `expectedLockVersion`.
   - Add `TreatmentPathwayResponseSchema` (camelCase incl. `lockVersion`).
5. **Routes** — `apps/api/src/features/treatment-pathways/pathwayRoutes.ts`:
   - PATCH `/:id` consumes repository (helper rejects on 409 → bubbles via `next(err)`).
   - POST `/:id/session` consumes repository (server computes `completedSessions+1` AFTER fetch; helper enforces `lock_version` predicate).
   - GET `/patient/:patientId` returns mapped response incl. `lockVersion`.
6. **Frontend** — readback `lockVersion` from GET responses, echo as `expectedLockVersion` on mutations:
   - `apps/web/src/features/patients/components/detail/tabs/PathwaysTab.tsx` (`handleComplete`, `handleDiscontinue`, post-session-note `updateMut.mutate`).
   - `apps/web/src/features/treatment-pathways/pages/PathwaysPage.tsx` (`recordSession.mutationFn`).
7. **CLAUDE.md** — extend §1.6 sub-bullet to include `treatment_pathways`.

## Tests (RED first)

**Unit** — `apps/api/tests/unit/treatmentPathwaySchemas.test.ts`:
- TP-ZOD-1: UpdateTreatmentPathwaySchema rejects when `expectedLockVersion` missing
- TP-ZOD-2: UpdateTreatmentPathwaySchema accepts positive int
- TP-ZOD-3: RecordSessionSchema rejects when `expectedLockVersion` missing
- TP-ZOD-4: TreatmentPathwayResponseSchema requires `lockVersion`

**Integration** — `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts`:
- TP-OL-1: canonical concurrent PATCH on same pathway → first wins, second gets 409
- TP-OL-2: PATCH with stale `expectedLockVersion` → 409 OPTIMISTIC_LOCK_CONFLICT
- TP-OL-3: PATCH with current `expectedLockVersion` → 200, `lockVersion` bumped
- TP-OL-4: POST `/:id/session` race — two concurrent sessions on same pathway → first wins, second 409 (NOT silent +1 +1 = +1)
- TP-OL-5: PATCH from clinic A with id from clinic B → 409 (cross-clinic isolation; helper enforces clinic_id in WHERE)
- TP-OL-6: PATCH on same id but different keys (e.g. status vs notes) → still serial (same row, opt-lock predicate enforces)
- TP-OL-7: lock_version persists across reads

## Cascade-discovery follow-ups (file atomically per `feedback_no_silent_out_of_scope.md`)

- **BUG-402-FOLLOWUP-1** — extend opt-locking to `treatment_plans` (related table, similar JSONB shape).
- **BUG-402-FOLLOWUP-2** — extend opt-locking to `safety_plans`.
- **BUG-402-FOLLOWUP-3** — extend opt-locking to `pregnancies` if multi-writer.
- **BUG-402-FOLLOWUP-4** — fix camelCase/snake_case response-shape mismatch in `pathwayRoutes` GET vs `PathwaysTab` reader.

## Fix-registry anchors (≥5)

1. `R-FIX-BUG-402-MIGRATION-LOCK-VERSION` — present in migration file
2. `R-FIX-BUG-402-REPO-USES-HELPER` — present in repository
3. `R-FIX-BUG-402-ZOD-REQUIRED` — present in schemas
4. `R-FIX-BUG-402-ROUTE-PATCH-OPTLOCK` — present in routes
5. `R-FIX-BUG-402-ROUTE-SESSION-OPTLOCK` — present in routes
6. `R-FIX-BUG-402-FRONTEND-PATHWAYSTAB` — present in PathwaysTab.tsx
7. `R-FIX-BUG-402-FRONTEND-PATHWAYSPAGE` — present in PathwaysPage.tsx
8. `R-FIX-BUG-402-CLAUDEMD` — present in CLAUDE.md

## Acceptance gates

- Per-cycle PART 2 §A–§O. No deviation. No skipping reviewers. Per `feedback_wave_gate_discipline.md`.
- L1: tsc × 3 + 15 guards + fix-registry verifier all pass.
- L2: 3× flake on integration test suite.
- L3: code-reviewer-general PASS.
- L4: clinical-safety-reviewer PASS (treatment-pathway is clinical-safety surface).
- L5: architecture-reviewer PASS (touches `shared/`, `db/`).
- 2-REJECT absorb cap per `feedback_explicit_override_for_2reject_cap.md`.
- Atomic catalogue flip in same commit per `feedback_atomic_catalogue_flip.md`.
- Explicit per-cycle user push authorization per `feedback_explicit_push_authorization.md`.
