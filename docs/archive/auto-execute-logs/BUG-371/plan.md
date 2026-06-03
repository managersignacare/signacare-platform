# Plan — BUG-371: Optimistic Locking on prescriptions / patient_medications / episodes

[Plan agent invocation 2026-04-26 per PART 2 §B; first-principles per PART 6.1 #3. Phase B Class B3 item 1 of 2.]

**Severity:** S1 deploy-blocker. **Sibling:** BUG-402 (same fix shape on `treatment_pathways.milestones`). **L4 fires** (clinical mutations on prescribing + medication + episode lifecycle). **L5 fires** (NEW shared helper + DB migration + CLAUDE.md §1.6 update + safety-surface).

## §0 Drift summary

Three high-mutation clinical tables (`prescriptions`, `patient_medications`, `episodes`) accept concurrent UPDATEs without optimistic locking. Last-write-wins silently overwrites peer edits — a fresh dose change can be reverted by a stale-tab save with zero audit trail.

Canonical precedent: `clinical_notes` (HAZARD-006) already implements column-based opt-locking with inline conflict detection at `clinicalNote.repository.ts:129-197`. This BUG generalises that pattern into a shared helper + applies to 3 new tables. Column name re-uses `lock_version` for codebase consistency.

## §1 Verification (read-confirmed)

- No `lock_version` on the 3 tables (schema-snapshot.json verified).
- 4 UPDATE call sites on prescriptions; 4 on patient_medications; 11 on episodes (8 single-row, 3 bulk-mutate cross-feature).
- Bulk-mutate sites (insulin bulk-cease, staff-settings bulk-roster-reassign) → out of scope; file followup BUGs.
- AppError 409 shape exists (`apps/api/src/shared/errors.ts:49-53`); ErrorCode is string-widened so `OPTIMISTIC_LOCK_CONFLICT` adds without type edit.
- `apps/api/src/middleware/optimisticLockMiddleware.ts` exists (header-based ETag) but does NOT replace column-based — they're complementary; this BUG adds column-based.
- EpisodeRow `partial-shape` annotation (BUG-538) stays; partial-shape skips reverse direction only, not forward.

## §2 Fix shape

### §2.1 Schema migration
NEW `apps/api/migrations/20260701000037_bug_371_opt_locking_columns.ts` — builder-first per CLAUDE.md §12.1. Three `t.integer('lock_version').notNullable().defaultTo(1)` calls, idempotency-guarded with `hasColumn`. Down() = no-op (append-only data invariant).

### §2.2 Schema-snapshot regen
Run `npm run db:snapshot --workspace=apps/api`; commit in same commit per CLAUDE.md §12.3.

### §2.3 Row-interface widening
Add `lock_version: number` to `PrescriptionRow`, `MedicationRow`, `EpisodeRow`. Add `'lock_version'` to each `*_COLUMNS` const for `.returning(...)` per §1.7.

### §2.4 Shared helper
NEW `apps/api/src/shared/db/optimisticLock.ts` (NEW directory). Single `updateWithOptimisticLock<T>()` function. Behaviour: validate → patch.lock_version=raw('lock_version+1') → andWhere(lock_version=expected) → returning(...) → 0-row throws `AppError(409, 'OPTIMISTIC_LOCK_CONFLICT')`. Honours `trx`. Defence-in-depth: rejects misuse (caller-supplied lock_version, missing id/clinic_id, invalid expectedVersion).

### §2.5 Service-layer wiring
- `prescriptionService.cancel`/`submitErx` accept REQUIRED `expectedLockVersion`.
- `medicationService.update`/`cease` accept REQUIRED `expectedLockVersion`.
- `episodeService.update`/`close` accept OPTIONAL `expectedLockVersion`; warn-log on missing.
- 6 episodeRoutes inline UPDATEs refactored to fetch+helper.
- 2 cross-feature single-row sites (escalation:97, referral:261-265) refactored.
- NPDS callback path uses `forUpdate()` SELECT in trx + helper (no UI version handle).

### §2.6 Zod DTOs / response shapes
- `lockVersion: z.number().int().positive()` on responses (3 SSoT files).
- `expectedLockVersion` REQUIRED on prescription + medication mutate DTOs; OPTIONAL on episode.
- Response mappers add `lockVersion: r.lock_version`.

### §2.7 Frontend
- prescriptions / medications: REQUIRED + frontend hooks updated (medicationApi, prescriptionApi, useMedications, usePrescriptions).
- episodes: OPTIONAL with warn-log; FOLLOWUP-3 to flip REQUIRED + wire UI.

## §3 UNION-up-front
- Episodes: OPTIONAL `expectedLockVersion` + warn-log = the shim.
- Prescriptions / medications: REQUIRED at Zod (no shim — silent fallback would defeat the purpose).

## §4 CLAUDE.md
Extend §1.6 with optimistic-locking sub-bullet citing BUG-371. NOT a new §1.X — co-locates with race-condition family.

## §5 Test plan
- Unit: 9 cases on the helper (OL-1..OL-9) at `apps/api/tests/unit/optimisticLock.test.ts`.
- Integration: 3 files (PRX/MED/EP × 3-4 cases each) with two-trx concurrent-write race scenarios.
- All RED before fix per TDD.

## §6 Fix-registry rows (11)
MIGRATION-EXISTS, HELPER-EXISTS, CONFLICT-CODE, PRESCRIPTIONS-USES-HELPER, MEDICATIONS-USES-HELPER, EPISODES-USES-HELPER, EPISODE-ROUTES-USES-HELPER, CLAUDE-MD-CITE, ROW-IFACE-LOCK-VERSION (×3 — one per row interface), FRONTEND-PRESCRIPTIONS-WIRED, FRONTEND-MEDICATIONS-WIRED.

## §7 Files to modify
27 files: 4 schema, 1 helper + 1 dir, 3 repos, 3 services, 3 routes, 2 cross-feature routes, 3 shared schemas, 4 frontend, 4 tests, CLAUDE.md, fix-registry, bugs-remaining, safety-surfaces.

## §8 Trigger assessment
- L3: FIRES.
- L4: FIRES (3 clinical-safety surfaces).
- L5: FIRES (NEW shared helper + migration + CLAUDE.md + safety-surface count change).

## §9 Risks
- §9.1 Schema-snapshot regen drift — mitigated by atomic-commit guard.
- §9.2 Row-interface widen for EpisodeRow — partial-shape annotation stays correct.
- §9.3 Backwards-compat — REQUIRED on prescribing surfaces forces frontend correctness; OPTIONAL on episodes provides shim.
- §9.4 Cascade-discovery — file 6 follow-up BUGs (FOLLOWUP-3, 4, 5, 6, 7, 8, 9) atomically.
- §9.5 Helper fail-loud — reject misuse with distinct error codes.

## §10 Acceptance
- Migration + snapshot regen committed atomically.
- Helper + 9 unit tests + 3 integration suites GREEN ×3.
- 11 fix-registry rows pass.
- L1 + L3 + L4 + L5 all PASS.
- CLAUDE.md §1.6 extended.
- BUG-371 strikethrough'd; 6 cascade follow-ups filed atomically.
- Safety-surfaces.txt extended with `apps/api/src/shared/db/optimisticLock.ts`.
- Explicit user push authorization.
