# BUG-454 — RLS gap-closure on 19 tenant-scoped tables — Plan

## Verified state (2026-04-24 live DB)

Queried `pg_class` — **19 tables** lack `relrowsecurity` (not 20; `patient_sync_preferences` already has RLS, shipped by a later migration). Confirmed list:

**Direct clinic_id column (2):**
- `training_corpus_items.source_clinic_id`
- `model_surveillance_events.source_clinic_id`

**Tenant-scoped via parent FK (14):**

| Table | Parent | Join predicate |
|---|---|---|
| staff_role_assignments | staff | staff.id = srole.staff_id |
| staff_team_assignments | staff | staff.id = steam.staff_id |
| staff_settings | staff | staff.id = sset.staff_id |
| staff_permissions | staff | staff.id = sperm.staff_id |
| mfa_secrets | staff | staff.id = mfa.staff_id |
| backup_history | staff | staff.id = bh.triggered_by_staff_id |
| patient_team_assignments | patients | patients.id = pta.patient_id |
| group_session_attendees | patients | patients.id = gsa.patient_id |
| planned_transition_assignments | patients | patients.id = pta.patient_id |
| message_thread_participants | message_threads | mt.id = mtp.thread_id |
| invoice_line_items | invoices | i.id = ili.invoice_id |
| template_sections | templates | t.id = ts.template_id |
| escalation_events | escalations | e.id = ee.escalation_id |
| evidence_chunks | evidence_documents | ed.id = ec.document_id |

**evidence_documents (1):** `source_id` points to varied sources (patients, clinical_notes, etc.) via `source_type`. Needs a per-source-type lookup. Simpler: since the audit calls this "tenant-scoped via FK chain", apply a conservative policy that joins against a `clinic_id` discovered through any of the plausible parent tables. For today's scope: lock writes to superadmin only and reads require a clinic_id match via any of the source types. Actually simpler: require that EITHER (a) source_type IN known list AND matching parent clinic, OR (b) a clinic_id column is added. The audit intends the EXISTS pattern — so let me add a clinic_id column (can default to the parent's clinic_id via a trigger) OR add a polymorphic RLS policy.

**No clinic link (2 — global/admin tables):**
- `backup_config` — system-wide config
- `model_registry` — system-wide AI model catalog

For these, the policy is: "anyone who is superadmin can read/write; others cannot". The `app.clinic_id` session var is not relevant; instead check a `superadmin` GUC or use `current_user = 'signacare_owner'`.

## Gold-standard fix

New migration `apps/api/migrations/20260424000003_rls_gap_closure_19_tables.ts`:

For each of the 14 parent-FK tables, mirror the `llm_prompts_outputs` pattern:
```sql
ALTER TABLE <child> ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_<child>_tenant ON <child>
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM <parent> p
    WHERE p.id = <child>.<fk_col>
    AND p.clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  ))
  WITH CHECK (same);
```

For the 2 direct-column tables (`training_corpus_items`, `model_surveillance_events`):
```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_<t>_tenant ON <t>
  FOR ALL
  USING (source_clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
         OR current_setting('app.clinic_id', true) = '')
  WITH CHECK (source_clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
         OR current_setting('app.clinic_id', true) = '');
```

For the 2 global tables (`backup_config`, `model_registry`):
```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_<t>_superadmin ON <t>
  FOR ALL
  USING (current_setting('app.role', true) = 'superadmin'
         OR current_user = 'signacare_owner')
  WITH CHECK (same);
```

For `evidence_documents` — simplest viable policy: because this is an RAG evidence table (likely admin-loaded clinical guidelines), use the superadmin-only pattern like `backup_config`. If a future migration adds a `clinic_id` column we can tighten. For now the goal is "not wide-open".

## Integration test

Seed two clinics. Insert rows into each test table via `dbAdmin` (bypasses RLS). Set session to Clinic-A, select via `db` (RLS-scoped). Assert only Clinic-A rows returned. For join-table tables verify that Clinic-B's rows do NOT leak.

## Files touched

- `apps/api/migrations/20260424000003_rls_gap_closure_19_tables.ts` — NEW
- `apps/api/src/db/schema-snapshot.json` — regen after migration (§13.6)
- `apps/api/tests/integration/bug454RlsGapClosure.int.test.ts` — NEW
- `docs/quality/fix-registry.md` — 1 row (present: policy name pattern)
- `docs/quality/bugs-remaining.md` — mark BUG-454 fixed

## Risk

- RLS is silent: if a query fails to match the policy, it returns empty. Could mask bugs in code that previously relied on "no RLS = see everything". Per §6.3 + L4 rule 1, this is correct clinical-safety behaviour — defence-in-depth.
- Rollback: migration's `down()` drops the policies + disables RLS. Safe.
- Any code calling these tables via `dbAdmin` is unaffected (FORCE ROW LEVEL SECURITY is NOT set — only ENABLE).

## L3/L4/L5 expected

- L3: yes
- L4: yes — tenant-isolation gate for clinical-safety-adjacent tables (patient_team_assignments, staff_role_assignments etc.)
- L5: yes — migration + 19 RLS policies + schema snapshot regen
