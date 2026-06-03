# Findings 6b — Per-migration correctness matrix

**Agent:** F-migrations
**Scope:** 47 files in `apps/api/migrations/` (1 consolidated baseline + 46 forward).

## Per-criterion fail count

| # | Criterion | Fail count |
|---|---|---:|
| 1 | RLS applied to new tenant-scoped tables | **20 (17 in baseline via FK chain + 3 in Tier 19)** |
| 2 | CHECK constraints on enum columns | 2 |
| 3 | Indexes on clinic_id / patient_id / FK | 0 |
| 4 | NOT NULL on clinic_id / created_at / required cols | 0 |
| 5 | Down-path re-runnable (`IF EXISTS`) | 0 |
| 6 | §12.4 taxonomy annotations correct | 1 (soft) |
| 7 | Builder-first (not `raw()` for simple DDL) | 2 (soft, exempt-justified) |
| 8 | JSDoc describes WHY + BUG/audit ref | 0 |
| 9 | No hardcoded DB / role names (§7.4) | **0** |

**Headline:** RLS is the worst criterion — **20 tables** lack `ENABLE ROW LEVEL SECURITY` despite carrying `clinic_id` directly or via FK chain.

## Top-3 worst migrations

### 1. `20260701000000_baseline.ts` — 17 tables without RLS ENABLE

Legitimately tenant-scoped via FK chain but missing policy:
`staff_role_assignments`, `staff_team_assignments`, `staff_settings`, `staff_permissions`, `patient_team_assignments`, `message_thread_participants`, `group_session_attendees`, `planned_transition_assignments`, `invoice_line_items`, `template_sections`, `evidence_documents`, `evidence_chunks`, `mfa_secrets`, `backup_config`, `backup_history`, `escalation_events`, `patient_sync_preferences`

**Fix:** follow-up migration adding `EXISTS`-based policies matching the pattern used in migration 47 (`llm_prompts_outputs` policy that joins through parent).

### 2. `20260701000027_tier19_training_platform.ts` — 3 tables without RLS

`training_corpus_items` (L99-114), `model_registry` (L124-139), `model_surveillance_events` (L199-211) despite having `source_clinic_id` FK. Comment at L50-53 justifies as "admin-curated via application-level guards" — this is exactly the anti-pattern §6.3 warns against.

**Fix:** add per-table policies permitting superadmin bypass + tenant match.

### 3. `20260701000004_patient_team_assignments_referral.ts` + `20260701000005_episode_discharge_closure_vetting.ts`

Both add enum-shaped status columns (`referral_status`, `discharge_vetting_status`, `closure_vetting_status`) without CHECK constraints. Free-text values can slip in.

**Fix:** `ALTER TABLE ... ADD CONSTRAINT ... CHECK (status IN (...))` matching documented enums (`new|pending|accepted|rejected|cancelled` and `draft|pending_review|signed`).

## §7.4 — hardcoded DB / role names

**Zero violations in executed DDL.** The literals `signacare_owner` / `signacaredb` appear ONLY in:
- JSDoc rebuild-instruction comments (baseline L19-21, L8281-8282, L7952, L7968)
- A contextual comment in `20260701000021_tier13_scribe_safety_and_search.ts:12`

None are in GRANT/REVOKE/ALTER DEFAULT PRIVILEGES bodies. `app_user` references are all guarded by `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')` — canonical pattern. Baseline Section O (L7976-7991) uses `format('… %I …', db_name)` dynamic templating. **CLEAN.**

## Strengths

- 100 % index coverage on clinic_id/patient_id/FK columns across 46 non-baseline migrations
- 100 % §12.4 taxonomy annotation compliance on the 46 non-baseline migrations
- Every migration carries substantive JSDoc with audit reference / BUG-nnn
- Baseline `down() { throw }` is acceptable (one-way documented with git-tag rollback path per §12.4 squashed-baseline directive)

## Priority recommendation

Pre-Azure-staging: dedicated **"phase-rls-gap-closure"** wave attaching RLS policies using the `EXISTS`-over-parent pattern from migration 47 to the 17 baseline tables + 3 Tier 19 tables. The two missing CHECK constraints fold into the same wave as low-risk additions.

## Related BUGs

- **BUG-454 (S0)** (new) — RLS gap-closure: 20 tenant-scoped tables missing `ENABLE ROW LEVEL SECURITY` + policy. **Pre-Azure-staging BLOCKER** (Layer-2 defence, per §6.3 + CLAUDE.md compliance)
- **BUG-455 (S2)** (new) — CHECK constraints on `referral_status`, `discharge_vetting_status`, `closure_vetting_status` enum columns
