# Parked work — awaiting user input

Items from Wave A-5-USER that I could not progress without a real-world repro or environment detail. Each must have a ticket/bug_id before it can enter a future sub-cluster.

Last updated: 2026-04-22.

## 1. USER-A.1 — Pathology document upload returns 500 "Internal server error"

**Status:** parked pending server-log output from a repro.

**Evidence:** UI shows `localhost:5173 says — Upload failed: Internal server error` on the "Upload Pathology Report" dialog. File: PNG screenshot, Investigation Type: Full Blood Count, Date: 22/04/2026, MDT resolved on the frontend to Keira Singh (Primary Clinician) / Mireille Costa (Psychiatry Registrar) / Tomas Clarke (Consultant Psychiatrist).

**What was verified statically:**
- Real upload route is `apps/api/src/features/patients/patientRoutes.ts:466` (POST `/patients/:id/pathology`), not `pathologyRoutes.ts` (Explore agent's earlier premise was wrong).
- Multer IS wired via the file-local `upload` multer instance at `patientRoutes.ts:162-174` with 20 MB limit + MIME/extension allowlist.
- Schema cross-check via `psql \d patient_attachments` and `\d tasks` — every column referenced in the handler's `.insert({...})` exists with matching type; NOT NULL columns are all written; no FK violations visible from static analysis.
- RLS middleware sets `app.clinic_id` before the handler runs; policies are in place.
- PATIENT_ATTACHMENT_COLUMNS + TASK_COLUMNS in `.returning(...)` both match snapshot.
- No recent commits to this path that would have regressed it.

**What I could not determine:** the specific stage that throws. The global error handler returns a generic "Internal server error" body; the real `err.message` is only in the API dev server stdout, which I can't tail.

**What I need from the user (pick any one):**
1. **Dev-server stdout line for the failed request.** Look for `[ERROR] Unhandled error ... err=...` in the terminal running `apps/api`. Share that line.
2. OR the raw **response body** from browser DevTools → Network → the failed POST to `patients/:id/pathology`. Sometimes it carries a detail the modal doesn't show.
3. OR approval to temporarily add per-stage logging to the endpoint so the next failure reveals `stage=attachment-db` / `stage=mdt-task-insert` etc., then revert once the root cause is known.

**Next step once diagnostic is in:** one-commit fix targeted to the failing stage (likely a silent column-shape or FK issue that static checks don't see).

---

## 2. USER-A.4 — Referral cannot be saved (note: previously numbered 1)

**Status:** parked pending repro.

**What was verified:** The create endpoint at `apps/api/src/features/referrals/referralRoutes.ts:204` uses `idempotencyMiddleware()` + controller. `referralService.ts` has FK constraints on `clinic_id` and `episode_id`. No clear static bug.

**What I need from the user:**
- Exact form state (all fields filled / missing fields)
- Which button clicked
- Error shown in UI
- Error in browser DevTools Network tab (request body + response body)
- Dev-server stdout at the moment of the failure

**Next step once repro is in:** add to a new sub-cluster USER-A' (Sub-cluster A absorb) and ship with L3 + L4 reviews.

---

## 3. USER-B.2 — MHA + LAI lists not visible in sidebar

**Status:** parked — NOT a code bug.

**What was verified:** `apps/web/src/shared/components/ui/Sidebar.tsx:89-90` already declares both "LAI" and "MH Act" nav entries under the "Clinical Lists" group. This is unchanged in the repo's current state. The user's reported invisibility is therefore caused by one of:

1. Role-based filtering — the logged-in role doesn't include `list:read` or similar permission for these surfaces
2. Feature flag — a clinic-level or global flag hides the "Clinical Lists" group entirely
3. Browser bundle staleness — old service-worker / cached JS still showing a prior sidebar layout
4. Multi-sidebar variant — a role-specific sidebar is rendering instead of the default

**What I need from the user:**
- Current role (superadmin / clinic-admin / clinician / nurse / …)
- Screenshot of the complete sidebar as the user sees it
- Browser hard-refresh result (`Cmd+Shift+R` on Mac) — does MHA/LAI appear after?
- Feature-flag state: `SELECT key, value FROM feature_flags WHERE clinic_id = '<clinic>'`

**Next step once diagnostics are in:** decide whether this is an RBAC bug, a feature-flag bug, or a cache issue. No code change goes in until we know which.

---

---

## 4. Technical-debt backlog (surfaced during post-A-4 gate runs)

These are pre-existing issues discovered while running L1 on the post-A-4 commits. None are in files I authored; none block Phase 0.5 or Phase 1. Listed here so they don't silently drift.

### BUG-347 — 10 pre-existing `any`s in list components (typing refactor)

**Files:**
- `apps/web/src/features/lists/pages/ClinicalListPage.tsx` lines 26, 30, 68, 78, 80, 84, 108, 254 (8 errors)
- `apps/web/src/features/patients/components/PatientList.tsx` lines 267 (`onError: (err: any)`), 381 (`(u as any).level`) (2 errors)

**Scope:** introduce proper interfaces for `ListRow`, OrgUnit-with-level, error-response shapes. Replace `any[]` in row-building useMemo with a typed `ClinicalListRow` interface.

**Estimate:** 1 commit, ~100 LOC across 2 files. Risk: low (typing-only).

**Unblock criterion:** none — ready to ship in its own sub-cluster.

### L1.fail.1 — 8 `parseInt()` without radix (naming-convention guard FAIL)

**Files:**
- `apps/web/src/features/nursing/pages/NursingPage.tsx` lines 333, 335, 338, 340, 393, 454, 455 (7 errors)
- `apps/web/src/features/reports/pages/ReportsPage.tsx` line 1197 (1 error)

**Fix:** add explicit `10` radix to each `parseInt(x)` call → `parseInt(x, 10)`.

**Estimate:** 1 small commit, ~8 lines changed. No test needed (the guard is the test).

**Unblock criterion:** none — ready to ship.

### L1.fail.2 — 3 silent catches in llmRoutes.ts (silent-catches guard FAIL)

**Files:**
- `apps/api/src/features/llm/llmRoutes.ts` lines 381, 454, 513 — three `.catch(() => {})` patterns.

**Fix:** per CLAUDE.md §3.1 / §9.6, every `.catch()` in production code must have an observable side effect. Add `logger.warn({ err }, '…')` OR annotate with `// intentional silent — <reason>`.

**Estimate:** 1 small commit, ~6 lines changed.

**Unblock criterion:** need to inspect each of the 3 sites to decide if they're legitimate cleanup paths (→ annotate) or bugs (→ add logger).

### BUG-352 — clinic_id drift on staff transfer (nominated-admin path)

**Severity:** S2 (PHI-isolation class, narrower scope than BUG-351).

**Scope:** if a superadmin transfers a staff member's `clinic_id` (moves them from Clinic A to Clinic B), and they were `nominated_admin_staff_id` on Clinic A's `clinics` row, the nomination slot still points to them. Check 0 matches `s.id = auth.staffId` but doesn't enforce `s.clinic_id = c.id`. The transferred staff could keep clinic-wide PHI bypass on Clinic A until superadmin clears the nomination.

**Fix:** (a) add `AND s.clinic_id = c.id` to Check 0 JOIN condition. (b) DB trigger on `staff.clinic_id` UPDATE that NULLs any `clinics.{nominated,delegated}_admin_staff_id` pointing to the transferred staff.

**Estimate:** 1 commit, ~20 LOC + 1 test.

**Unblock criterion:** none — ready to ship.

### BUG-353 — force-logout on role demotion / deactivation (defence in depth)

**Severity:** S3 (low likelihood — requires both a role demotion mid-session AND an in-flight request timed before the next guard call).

**Scope:** when an admin demotes a nominated staff, their existing JWT + Redis idle session stays live until either expires. The next guard call correctly denies bypass (BUG-351 close), but a single in-flight request using the pre-demotion state may complete. L4-reviewer-flagged; low risk but should be belt-and-braces.

**Fix:** staff-role-update service should invalidate the affected staff's Redis idle key + blacklist the JWT jti, forcing an immediate logout. UX: push via WebSocket would be nicer but a poll-driven 401 on next request is acceptable.

**Estimate:** 1 commit, ~40 LOC + 1 test.

**Unblock criterion:** BUG-351 shipped (done).

### BUG-354 — DB-layer cascade trigger for access-admin slot integrity

**Severity:** S2 (defence-in-depth, complements BUG-351 + BUG-352).

**Scope:** L5 review on BUG-351 recommended a DB trigger that NULLs `clinics.{nominated,delegated}_admin_staff_id` automatically when the referenced staff is deactivated / demoted to operational / soft-deleted. Layer B to BUG-351's Layer A. Protects direct SQL writes, worker jobs, and future services that forget the app-layer guard.

**Fix:** migration — `BEFORE UPDATE OF role, is_active, deleted_at ON staff` function that queries `clinics` WHERE `nominated_admin_staff_id = NEW.id OR delegated_admin_staff_id = NEW.id`; if the new state would make the staff ineligible, NULL the slot and write an `ACCESS_ADMIN_SLOT_CLEARED` audit row.

**Estimate:** 1 commit, ~60 LOC migration + 3 tests (one per vector).

**Unblock criterion:** BUG-351 + BUG-352 shipped.

### BUG-351 — post-facto role-demotion gap in requirePatientRelationship

**Severity:** S1 (PHI-isolation class — same rail as PART 12 three-layer model).

**Scope:** `apps/api/src/shared/authGuards.ts` — the nominated/delegated admin bypass at Check 0 matches by `staff_id` only. If an admin demotes an already-nominated staff to `receptionist` / `readonly` via the staff-role surface (or sets `is_active=false`), `clinics.{nominated,delegated}_admin_staff_id` still points to them. Until a superadmin re-nominates, the demoted staff retains clinic-wide PHI-bypass.

**Discovered by:** L4 clinical-safety review on 0.5.C (2026-04-23).

**Fix (two layers):**
1. **App layer (Check 0 rewrite):** the nominated/delegated query JOINs `staff` and enforces `s.is_active=true AND s.role NOT IN OPERATIONAL_ONLY`. No bypass for demoted / deactivated staff.
2. **DB layer (optional cascade trigger):** `BEFORE UPDATE OF role, is_active ON staff` — if demoted/deactivated staff appears in any `clinics.{nominated,delegated}_admin_staff_id`, either NULL the slot or RAISE. Mirrors the 0.5.A cross-clinic containment pattern.

**Estimate:** 1 commit, ~30 LOC + 2 integration tests (demote-then-access + deactivate-then-access).

**Unblock criterion:** none — ready to ship in its own sub-cluster after 0.5.D.

### Dep — 5 npm audit vulnerabilities introduced by eslint@8 transitive deps

**Severities:** 1 critical, 1 high, 2 moderate, 1 low (reported on 2026-04-22 by `npm install --save-dev eslint@8.57.0`).

**Options:**
1. Accept and document — eslint's transitive deps are build-time only; none ship to production bundles.
2. Upgrade to eslint@9 + flat config (rewrites `.eslintrc.cjs` → `eslint.config.js`).
3. Swap to a different linter (biome?).

**Estimate:** option 1 = 0 commits; option 2 = 1 commit (~30 LOC); option 3 = larger migration.

**Unblock criterion:** product / security-team decision. Default to option 1 unless flagged.

### USER-C.2 — Consultant-on-leave reassignment workflow (PAUSED mid-build)

**Status:** paused — needs redesign against existing `staff_leave` schema.

**What happened:** commit `a4b03d5` shipped migration `20260423000003_staff_leave_periods.ts` which created two new tables (`staff_leave_periods` + `reassignment_proposals`). Integration-test triage revealed the response body from the new POST /api/v1/staff-leave was a completely different schema than my service returned — debug log showed a response with `requestedBy`, `coverStaffId`, `approvedByStaffId`, `status='requested'`, which pointed at an EXISTING `/staff-leave` handler in [managerFeatureRoutes.ts:298-395](../../apps/api/src/features/roles/managerFeatureRoutes.ts#L298). An existing `staff_leave` table + full CRUD already exist.

**Correction shipped (2026-04-23):** migration `20260423000004_drop_duplicate_staff_leave_periods.ts` drops both my new tables. No code changes needed (service + routes never landed — uncommitted work was reverted in the same session).

**Unblock criterion:** product/design decision on whether the reassignment-proposals concept should:
1. Reuse `staff_leave` table (attach proposals FK to `staff_leave(id)`) — favoured, lowest disruption
2. Extend `staff_leave` with a new `reassignment_proposal` sidecar table only — smaller scope
3. Replace `staff_leave` with a richer schema — biggest refactor, not recommended

Recommended path: Option 1. Next session should (a) add `reassignment_proposals` with FK to `staff_leave(id)`, (b) add proposal endpoints to `managerFeatureRoutes.ts` (same file as existing leave CRUD), (c) FE admin vetting queue page, (d) FE on-leave badge on patient list.

**Lesson captured:** verify-before-you-build — always `grep -rn` the feature keyword across `apps/api/src` BEFORE writing a new migration. The absence of an exact match on the new filename doesn't mean the FEATURE is absent.

**Estimate once unblocked:** 4-6 commits (migration + routes + tests + FE admin panel + FE badge + fix-registry).

### BUG-353 — Force-revoke sessions on staff role demotion / deactivation (PAUSED — L4 BLOCK + L5 REJECT)

**Status:** paused. The implemented DB trigger is a **functional NO-OP** on the access-token path. Shipping it would give on-call operators a false sense that "demotion logs them out" when in fact it does nothing for up to 60 minutes.

**What was attempted (2026-04-23, reverted):**
- Migration `20260423000006_force_revoke_sessions_on_staff_state_change.ts` — AFTER UPDATE OF (role, is_active, deleted_at) ON staff. Set `staff_sessions.revoked_at = NOW()` on every active session for the staff.
- Test suite `apps/api/tests/integration/forceRevokeSessionsOnStaffStateChange.int.test.ts` — 6 scenarios, 6/6 PASS on DB-level assertions.
- Both files DELETED post-L4/L5 review. The trigger + function were applied to local DB then dropped via direct psql + `DELETE FROM knex_migrations WHERE name LIKE '20260423000006%'`.

**Why reverted (retroactive L4/L5 findings — reproduced verbatim):**

**L4 clinical-safety BLOCK — Rule 2 (Critical class detection) + Rule 8 (Graceful degradation):**
> BUG-353 — the force-revoke trigger does not actually force anyone out. The migration sets `staff_sessions.revoked_at = NOW()`. But the request-time authentication stack (`apps/api/src/middleware/authMiddleware.ts:17-98`) is: (1) JWT signature + exp check (zero DB lookup), (2) `sessionIdleMiddleware` — Redis `idle:${staffId}` GET (per-staff, NOT per-session; fail-open on Redis error), (3) `rlsMiddleware`. `staff_sessions.revoked_at` is NEVER read on the authenticated request path. It is read only inside `authService.refresh()` (when a refresh token is presented) and `authService.logout()`. Access-token TTL is **60 minutes** (`config.ts:21`). So a demoted / deactivated / soft-deleted staff member with a freshly-issued access token continues to operate — with OLD role and OLD permissions baked into the JWT claims — for up to 60 more minutes after the trigger fires. The trigger is "force-revoke" in name only. A malicious insider who is being offboarded has a 60-minute window to exfiltrate PHI, write medications, sign notes, etc. with their old permissions. **This is exactly the attack the bug was filed to prevent.**

**L5 architecture REJECT — Standard 1 (Defence in Depth):**
> `apps/api/src/middleware/jwtBlacklist.ts` exports `blacklistToken`, `isTokenBlacklisted`, `blacklistAllUserTokens`, `isUserRevokedAfter`. Production-ready signatures, Redis-backed, TTL-aware. **Grep shows zero consumers across `apps/api/src/`.** Only doc-file references and the module's own definition. No call to `isTokenBlacklisted` / `isUserRevokedAfter` in `authMiddleware.ts:1-101`. The blacklist is not wired in at all. The revocation is invisible to the access layer. **Layer C (access-token revocation) must be implemented before BUG-353 can be a real fix**, not deferred.

**L5 architecture REJECT — Standard 1 (scope gap):**
> 353 fires on `(role, is_active, deleted_at)` — missing `clinic_id`. A staff transferred from Clinic A to Clinic B **keeps a valid access token pointing at Clinic A** (the JWT's `clinicId` claim) for up to 60 minutes. That's a cross-tenant data leak window.

**L5 architecture REJECT — Standard 4 (explicit over implicit):**
> Both triggers (BUG-353 + BUG-354) silently mutate security-critical state with zero audit trail. No `INSERT INTO audit_log` inside either trigger function. HIPAA §164.312(b) + OWASP ASVS v4 §7.1.3 require automatic security controls to be recorded.

**L4 clinical-safety medium — `updated_at` conflict:**
> `updated_at = NOW()` on `staff_sessions` conflicts with `trg_staff_sessions_updated_at` (`baseline.ts:886-888`) which is a BEFORE UPDATE trigger calling `set_updated_at()`. The trigger already sets `updated_at`; explicit setting is redundant and produces inconsistent results if the BEFORE trigger runs. Drop the explicit `updated_at = NOW()` write.

**L4 clinical-safety medium — active_sessions:**
> The trigger does not handle `active_sessions` (the JTI-tracking table at `baseline.ts:920-941`). Either extend the trigger to UPDATE `active_sessions` too, or document explicitly in the migration header that `active_sessions` is dead code pending removal.

**Unblock criterion — ALL of these must be in place BEFORE re-attempting BUG-353:**
1. **BUG-356 lands first** (S1 security — catalogued separately): wire `jwtBlacklist.blacklistAllUserTokens(staffId)` into the staff-state-change service path, AND add `isUserRevokedAfter(req.user.id, payload.iat)` into `authMiddleware` between `jwt.verify` (line 26) and user hydration (line 31). Either (a) access-token blacklist check on every request, OR (b) add `jti` claim to access tokens + per-request `staff_sessions.revoked_at` lookup keyed by jti, OR (c) reduce `JWT_ACCESS_TTL_MINUTES` from 60 to ≤5 with aggressive refresh. Pick one. Document the trade-off in the migration header.
2. **BUG-357 lands concurrently** (S2 — catalogued separately): both the BUG-354 trigger AND the new BUG-353 trigger must emit `audit_log` rows for `ADMIN_SLOT_CLEARED_BY_TRIGGER` and `SESSION_REVOKED_BY_TRIGGER`. Extend the `AuditAction` union in `apps/api/src/utils/audit.ts`. The trigger-body INSERT must run with `SECURITY DEFINER` + EXCEPTION-swallow (mirror `audit_trigger_fn` at `baseline.ts:95-120`).
3. **Widen BUG-353's column list to include `clinic_id`** so transfer-without-role-change revokes sessions. Add T7 integration test covering clinic-transfer-with-no-role-change.
4. **Drop `updated_at = NOW()` from the trigger body** (conflicts with existing BEFORE trigger).
5. **Document `active_sessions` status** in the migration header — either extend the trigger to cover it, OR explicitly note it as dead code.
6. **Add 401 SESSION_REVOKED trap in the web SPA** (BUG-353b follow-up): modal surfaces "Your session was revoked — please re-login. Unsaved drafts will be lost." before the clinician loses an in-progress note.

**Estimate once unblocked:** 3-4 commits (BUG-356 wiring + BUG-357 audit + BUG-353 migration with widened scope + BUG-353b frontend 401 trap).

### BUG-354 audit-log emission gap (L4 BLOCK + L5 REJECT — forward-fix scheduled)

**Status:** follow-up migration scheduled for this session (PART 13 Action 2). The BUG-354 trigger at commit `72ab65f` shipped WITHOUT audit-log emission. Both L4 and L5 flagged this as a blocking omission on the shipped commit.

**What must land:** new migration `20260423000007_access_admin_trigger_audit_log.ts` that `CREATE OR REPLACE FUNCTION clinics_access_admin_slot_integrity()` with a body that INSERTs into `audit_log` BEFORE the slot UPDATE. Extend `AuditAction` union with `ADMIN_SLOT_CLEARED_BY_TRIGGER`. Add 2 new integration tests (T7 demote-fires-audit row, T8 benign-no-audit). FULL 10-check gate including L3/L4/L5.

---

## Conventions

- Every parked item must have an "unblock criterion" — the specific artefact or decision that moves it from parked to actionable.
- When a parked item is unblocked, delete its entry from this file AND add a row to `docs/fix-registry.md` when the fix lands (per CLAUDE.md §9.5).
- Parked items are NOT counted toward Wave A-5-USER exit criteria — they're excluded with rationale in §10.12.
- Technical-debt items (section 4) are NOT counted toward Phase 0.5 exit criteria either; they're follow-up commits that can ship in any future wave.
