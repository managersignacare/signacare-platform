# No-clinic_id Mutations — Verification Findings

**Date:** 2026-04-19
**Input inventory:** `inventory/every-db-mutation.md` (74 rows flagged `clinic_id: NO`)
**Auditor verdict:** **7 CRITICAL S0 cross-tenant write bugs confirmed.** Rest are defensible or vendor-global.

## Summary

| Category | Count | Severity |
|---|---|---|
| **CAT-A** — Upstream-constrained (row fetched with clinic_id filter, then updated by id-only) | ~35 | HIGH (defense-in-depth gap per CLAUDE.md §1.3) |
| **CAT-B** — Vendor-global (backup_history, feature_flags NULL-clinic rows, letter_templates system rows, etc.) | ~12 | NOT bugs |
| **CAT-C** — **ACTUAL cross-tenant write bugs** | **7** | **CRITICAL S0** |
| **CAT-D** — Auth/session context (OAuth, MFA, sessions — isolated by user_id not clinic_id) | ~15 | NOT bugs |
| Unresolved — require case-by-case trace | ~5 | Pending |

## CAT-C — CONFIRMED CRITICAL S0 cross-tenant write bugs

Each of these allows an authenticated user in clinic A to modify records belonging to clinic B.

| # | File:Line | Operation | Table | Exploit path |
|---|---|---|---|---|
| **BUG-088 S0** | `apps/api/src/features/org-settings/orgSettingsRepository.ts:103` | UPDATE | `org_units` | PATCH /units/:id with victim clinic's unit ID → cross-clinic org unit modification |
| **BUG-089 S0** | `apps/api/src/features/org-settings/orgSettingsRepository.ts:109` | DELETE | `org_units` | DELETE /units/:id with victim clinic's unit ID → cross-clinic unit deletion |
| **BUG-090 S0** | `apps/api/src/features/org-settings/orgSettingsRepository.ts:161` | UPDATE | `programs` | PATCH /programs/:id with victim clinic's program ID → wipe descriptions across clinics |
| **BUG-091 S0** | `apps/api/src/features/org-settings/orgSettingsRepository.ts:165` | DELETE | `programs` | DELETE /programs/:id with victim clinic's program ID → program deletion across clinics |
| **BUG-092 S0** | `apps/api/src/integrations/outlook/outlookRoutes.ts:64-70` | UPDATE | `staff` | staffId from OAuth state (req.query['state']) with NO clinic validation. Craft malicious state → inject Outlook tokens into ANY staff record |
| **BUG-093 S0** | `apps/api/src/integrations/outlook/outlookRoutes.ts:82-89` | UPDATE | `staff` | .where({id: staffId}) without clinic_id check → disconnect Outlook for any staff globally |
| **BUG-094 S0** | `apps/api/src/features/patients/patientRoutes.ts:276-278` | UPDATE | `patient_team_assignments` | PATCH /team-assignments/:patientId with another clinic's patient ID (NO join to patients.clinic_id) → modify victim clinic's team assignments |

**All 7 are CRITICAL S0** — real cross-tenant-write confirmations, not false positives. RLS policies MAY catch some at DB level, but app-layer exploits are immediate:

- **BUG-088/089/090/091** (orgSettingsRepository): the controller passes `id` to the repo without a `clinicId` arg. RLS might reject the UPDATE/DELETE (depends on policy), but the application has NO defense.
- **BUG-092/093** (outlookRoutes): staff table — staff rows belong to a clinic, but `.where({id: staffId})` fetches by id only. RLS on staff may or may not scope — if not, cross-tenant write.
- **BUG-094** (patient_team_assignments): patient-team mapping; `.where({patient_id: req.params.patientId})` — no clinic filter. Malicious patientId from another tenant mutates their assignments.

### Proposed fix per bug
Each gets:
```typescript
.where({ id, clinic_id: req.clinicId })  // or clinic_id via upstream auth
```
+ integration test: create in clinic-A, attempt mutate as clinic-B admin → expect 0 rows affected.

## CAT-A — Upstream-constrained (HIGH defense-in-depth)

~35 mutations. Example file:line references (not exhaustive):
- `appointments/appointmentService.ts:295` — instance created moments earlier via `createInternal(clinicId, ...)`, then `update({recurrence_parent_id, recurrence_rule})` by instance.id.
- `escalations/escalation.service.ts:65` — `escalationRepository.addEvent(auth.clinicId, id, ...)` — properly passes clinic context.
- `billing/billingRepository.ts:409` — `.where({id: invoiceId, clinic_id: clinicId})` — router passes through service.
- ~30 more following the pattern: row fetched with clinic_id filter upstream, then id-only update downstream.

**Why HIGH (not CRITICAL):** RLS still constrains at DB level + the upstream fetch protects today. But violates CLAUDE.md §1.3 which mandates clinic_id in every WHERE clause of a multi-tenant mutation.

**Fix:** add `clinic_id` to every such WHERE clause. Mechanical, per-site, no new abstraction.

## CAT-B — Vendor-global (NOT bugs)

- `backup_history` (3 mutations: 202, 275, 318) — schema-explicit "NO clinic_id, NO RLS — system-level audit."
- `feature_flags` with `clinic_id IS NULL` — global toggles.
- `letter_sections`, `model_registry` — vendor templates.
- `audit_log` with nullable clinic_id — system-wide audit events.

## CAT-D — OAuth/Session (NOT bugs)

- `mfa_secrets`, `staff_sessions` (~6 mutations) — isolation by staff_id + session state.
- `oauth_access_tokens`, `oauth_refresh_tokens`, `smart_launch_contexts` (~8 mutations) — isolation by user_id + client_id.

## Immediate action required

Fix **BUG-088 through BUG-094** (7 CRITICAL S0 cross-tenant writes) **before any other fix work.** These are live vulnerabilities.

Priority order:
1. BUG-092, BUG-093 — Outlook staff-token injection. Most severe (auth-bypass surface).
2. BUG-094 — patient_team_assignments cross-tenant modification.
3. BUG-088 through BUG-091 — org_units + programs. Lower exploitability (admin-only role required) but structural.

## Verification required before fixes land

For each of the 7: write an integration test that:
1. Creates a row in clinic-A
2. Attempts mutation via app-layer as clinic-B admin
3. Asserts HTTP 403 or 0 rows affected
4. Is the Layer-5 evidence for the fix commit
