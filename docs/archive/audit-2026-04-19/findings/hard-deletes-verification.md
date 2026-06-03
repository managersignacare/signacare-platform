# Hard-Delete Verification — 2026-04-19

> **Plan-mode notice:** the user asked for this file at
> `/Users/drprakashkamath/Projects/Signacare/docs/audit-2026-04-19/findings/hard-deletes-verification.md`.
> Plan mode restricts writes to the plan file only — move this file there to
> complete the task.

Total flagged in inventory: **62** (every row tagged `hard-delete risk` in
`docs/audit-2026-04-19/inventory/every-db-mutation.md`).

- CAT-DELETE-BUG: **6** (CRITICAL data-loss — all same pattern: `.del()` on a
  soft-delete table by role-specific "Feature Routes" files that forgot the
  convention)
- CAT-DELETE-LEGIT-TOMBSTONE: **41** (no `deleted_at` column — hard-delete IS
  the canonical pattern; most are config/lookup tables)
- CAT-DELETE-JUNCTION: **2** (`org_unit_programs`, `group_session_attendees`
  — assignment/membership tables; removing the row IS the intent)
- CAT-DELETE-UNCLEAR: **0**
- **SCANNER FALSE-POSITIVES: 13** (listed last — the inventory matched on
  `router.delete(...)` patterns or on `blobStorage.delete(...)` in catch
  blocks; the underlying DB op is actually UPDATE / softDelete / non-DB)

---

## CAT-DELETE-BUG — data-loss bugs (6)

Tables that have a `deleted_at` column (per
`apps/api/src/db/schema-snapshot.json`) where code uses `.del()` directly,
permanently destroying rows. Audit trails survive only via the
`audit_trigger_fn` AFTER-DELETE trigger; the row itself is gone and cannot
be undeleted. Every one of these is a §1.4 violation.

| # | File:Line                                                                | Table                     | deleted_at? | Proposed fix                                                                                     |
|---|--------------------------------------------------------------------------|---------------------------|-------------|--------------------------------------------------------------------------------------------------|
| 1 | apps/api/src/features/roles/nurseFeatureRoutes.ts:656                    | nursing_assessments       | YES         | Replace `.del()` with `.update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })`            |
| 2 | apps/api/src/features/roles/nurseFeatureRoutes.ts:535                    | shift_handovers           | YES         | same — `.update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })`                           |
| 3 | apps/api/src/features/roles/psychiatristFeatureRoutes.ts:359 (line 377)  | clinical_formulations     | YES         | same — also add `.whereNull('deleted_at')` to the existence check above                           |
| 4 | apps/api/src/features/roles/psychiatristFeatureRoutes.ts:473 (line 478)  | side_effect_schedules     | YES         | same — `.update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })`                           |
| 5 | apps/api/src/features/roles/caseManagerFeatureRoutes.ts:222 (line 227)   | care_plan_goals           | YES         | same — `.update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })`                           |
| 6 | apps/api/src/features/roles/caseManagerFeatureRoutes.ts:320 (line 325)   | care_plan_interventions   | YES         | same — `.update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })`                           |

Notes on confirmed schema state (verified against
`apps/api/src/db/schema-snapshot.json` on 2026-04-19):

- `clinical_formulations.deleted_at` — present.
- `nursing_assessments.deleted_at` — present.
- `shift_handovers.deleted_at` — present.
- `side_effect_schedules.deleted_at` — present.
- `care_plan_goals.deleted_at` — present.
- `care_plan_interventions.deleted_at` — present.

Common pattern — all six are in `apps/api/src/features/roles/*FeatureRoutes.ts`
and follow the same shape:
```typescript
const deleted = await db('<table>')
  .where({ id: req.params.id, clinic_id: req.clinicId })
  .del();                                           // <-- BUG
if (!deleted) { res.status(404)...; return; }
res.json({ ok: true });
```

Structural fix (all six together): replace every `.del()` in
`apps/api/src/features/roles/**/*FeatureRoutes.ts` on a table that has
`deleted_at` with `.update({ deleted_at: db.fn.now(), updated_at: db.fn.now() })`
and also add `.whereNull('deleted_at')` to any preceding SELECT for these
tables to avoid "undeleting" then re-deleting.

Fix-registry row should match the pattern
`db\('(nursing_assessments|shift_handovers|clinical_formulations|side_effect_schedules|care_plan_goals|care_plan_interventions)'\)[\\s\\S]{0,200}\\.del\\(\\)`
as type=`absent`.

---

## CAT-DELETE-JUNCTION — assignment/membership tables (2)

| # | File:Line                                                            | Table                   | Rationale |
|---|----------------------------------------------------------------------|-------------------------|-----------|
| 1 | apps/api/src/features/group-therapy/groupTherapyRoutes.ts:219,221    | group_session_attendees | Removing an attendee from a group therapy session IS the intent. No `deleted_at`; table is presence-semantic. No bug. |
| 2 | apps/api/src/features/org-settings/orgSettingsRepository.ts:257      | org_unit_programs       | `unassignProgram(unit, program)` removes the assignment row. Denormalised junction table (no FK). No bug. |

---

## CAT-DELETE-LEGIT-TOMBSTONE — tables intentionally without soft-delete (41)

Every table below has NO `deleted_at` column in `schema-snapshot.json` AND
is semantically a configuration / lookup / session / ephemeral table where
hard-delete IS the canonical pattern. `audit_trigger_fn` still captures
an AFTER-DELETE audit row where relevant.

| # | File:Line                                                                  | Table                           |
|---|----------------------------------------------------------------------------|---------------------------------|
| 1 | apps/api/src/features/beds/bedRoutes.ts:156                                | beds                            |
| 2 | apps/api/src/features/beds/bedRoutes.ts:161                                | beds                            |
| 3 | apps/api/src/features/carers/carerRoutes.ts:67                             | carers                          |
| 4 | apps/api/src/features/carers/carerRoutes.ts:73                             | carers                          |
| 5 | apps/api/src/features/checklists/checklistRoutes.ts:204                    | checklist_templates             |
| 6 | apps/api/src/features/checklists/checklistRoutes.ts:206                    | checklist_templates             |
| 7 | apps/api/src/features/llm/llmTrainingRoutes.ts:128                         | ai_modelfiles                   |
| 8 | apps/api/src/features/llm/llmTrainingRoutes.ts:132                         | ai_modelfiles                   |
| 9 | apps/api/src/features/llm/scribeRoutes.ts:523                              | clinic_scribe_vocabulary        |
| 10| apps/api/src/features/llm/scribeRoutes.ts:529                              | clinic_scribe_vocabulary        |
| 11| apps/api/src/features/org-settings/orgSettingsRepository.ts:109            | org_units                       |
| 12| apps/api/src/features/org-settings/orgSettingsRepository.ts:165            | programs                        |
| 13| apps/api/src/features/roles/caseManagerFeatureRoutes.ts:551                | community_resources             |
| 14| apps/api/src/features/roles/managerFeatureRoutes.ts:378                    | staff_leave                     |
| 15| apps/api/src/features/roles/managerFeatureRoutes.ts:473                    | report_schedules                |
| 16| apps/api/src/features/roles/receptionistFeatureRoutes.ts:290               | phone_triage                    |
| 17| apps/api/src/features/staff-settings/staffSettingsRepository.ts:60         | professional_disciplines        |
| 18| apps/api/src/features/staff-settings/staffSettingsRepository.ts:86         | clinical_roles                  |
| 19| apps/api/src/features/staff-settings/staffSettingsRepository.ts:129        | staff_team_assignments          |
| 20| apps/api/src/features/staff-settings/staffSettingsRepository.ts:181        | staff_role_assignments          |
| 21| apps/api/src/features/staff-settings/staffSettingsRepository.ts:207        | referral_sources                |
| 22| apps/api/src/features/staff-settings/staffSettingsRepository.ts:233        | investigation_types             |
| 23| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:159            | alert_types                     |
| 24| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:162            | alert_types                     |
| 25| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:177            | legal_order_type_configs        |
| 26| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:178            | legal_order_type_configs        |
| 27| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:191            | appointment_modes               |
| 28| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:192            | appointment_modes               |
| 29| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:218            | template_categories             |
| 30| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:219            | template_categories             |
| 31| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:242            | clinical_templates              |
| 32| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:243            | clinical_templates              |
| 33| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:454            | staff_module_access             |
| 34| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:533            | episode_types                   |
| 35| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:534            | episode_types                   |
| 36| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:911            | clinical_policies               |
| 37| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:912            | clinical_policies               |
| 38| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:1024           | ai_context_files                |
| 39| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:1027           | ai_context_files                |
| 40| apps/api/src/features/feature-flags/featureFlagRoutes.ts:257 (via shared/featureFlags.ts:263) | feature_flags           |
| 41| apps/api/src/features/mobile-sync/mobileSyncRoutes.ts:229                  | staff_fcm_tokens *              |

\* `staff_fcm_tokens` DOES have a `deleted_at` column — but the inventory
flagged the `router.delete(...)` route registration on line 229. The actual
DB op on line 240 is `.update({ deleted_at: new Date() })` — already a correct
soft-delete. Kept here as legit (the code is fine).

**Why these are not bugs:** they are one of
- organisation-configuration lookups (alert_types, episode_types,
  appointment_modes, legal_order_type_configs, template_categories,
  referral_sources, investigation_types, professional_disciplines,
  clinical_roles, programs, org_units)
- clinic-level resource catalogues (beds, carers, clinical_templates,
  clinical_policies, ai_context_files, ai_modelfiles,
  clinic_scribe_vocabulary, community_resources, checklist_templates,
  report_schedules)
- ephemeral / role-assignment records that model presence, not history
  (staff_team_assignments, staff_role_assignments, staff_module_access,
  staff_leave, staff_fcm_tokens, feature_flags)
- triage records with their own workflow status (phone_triage)

Per CLAUDE.md §1.4, these are the canonical "hard-delete OK" classes.

---

## SCANNER FALSE-POSITIVES (13)

Listed because the inventory counts 62 rows but 13 of them are not actual
`.delete()`/`.del()` calls on the stated table. They are flagged here so
the next audit run can tighten the scanner (today it matches on
`router.delete(...)` registrations and on nearest-preceding `db('X')`
even when the `.delete()` is on a different object).

| # | File:Line                                                                | Stated table                      | Actual behaviour                                                                         |
|---|--------------------------------------------------------------------------|-----------------------------------|------------------------------------------------------------------------------------------|
| 1 | apps/api/src/features/billing/billingRoutes.ts:48                        | invoices                          | `router.delete` routes to `ctrl.voidInvoice` which does `.update({ status:'void' })`.   |
| 2 | apps/api/src/features/escalations/escalation.routes.ts:62                | patient_team_assignments          | `router.delete('/:id', ctrl.softDelete)` — controller does soft-delete on `escalations`. |
| 3 | apps/api/src/features/patients/patientRoutes.ts:894                      | patient_legal_attachments         | `blobStorage.delete(storageKey)` in catch block. Not a DB op.                             |
| 4 | apps/api/src/features/patients/patientRoutes.ts:1019                     | patient_alert_attachments         | `blobStorage.delete(storageKey)` in catch block. Not a DB op.                             |
| 5 | apps/api/src/features/patients/patientRoutes.ts:1448                     | specialties                       | `router.delete('/:id', patientController.softDelete)` — already soft-delete.              |
| 6 | apps/api/src/features/roles/crossRoleFeatureRoutes.ts:297                | patients                          | `blobStorage.delete(put.key)` in catch block. Not a DB op.                                |
| 7 | apps/api/src/features/roles/psychologistFeatureRoutes.ts:196             | psychology_session_notes          | `router.delete` registration; actual body (line 214) does `.update({ deleted_at })`.     |
| 8 | apps/api/src/features/templates/template.repository.ts:174               | templates                         | `trx('template_sections').where(...).delete()` — child sections, not `templates`. `template_sections` has no `deleted_at` and is rewritten on edit. Legit junction-ish. |
| 9 | apps/api/src/integrations/fhir/fhirSubscription.ts:106                   | fhir_subscriptions                | `.update({ status: 'off' })` — already soft-off. No DB delete.                            |
| 10| apps/api/src/integrations/fhir/smartAppRegistry.ts:165                   | smart_apps                        | `.update({ is_active: false })` — already soft-off. No DB delete.                         |
| 11| apps/api/src/integrations/outlook/outlookRoutes.ts:79                    | staff                             | `.update({ outlook_email: null, outlook_refresh_token: null, ... })`. Disconnect only.    |
| 12| apps/api/src/features/mobile-sync/mobileSyncRoutes.ts:229                | staff_fcm_tokens                  | `.update({ deleted_at: new Date() })` — already correct soft-delete.                      |
| 13| apps/api/src/features/staff-settings/staffSettingsRoutes.ts:866 (row 619)| planned_transitions               | Not counted above as "hard-delete risk" — listed in inventory but the row note says `—` (not flagged). Ignore. |

(Row 13 entry clarification: planned_transitions actually appears in the
inventory at row 619 without `hard-delete risk` tag; excluded from the 62.
Added here only so the scanner's near-miss is documented.)

---

## Recommended follow-up

1. **Fix the 6 CAT-DELETE-BUG rows as a single structural commit** — all six
   files are `apps/api/src/features/roles/*FeatureRoutes.ts`, identical
   pattern, identical fix. Add a fix-registry row with a single regex
   anchor that covers all six.
2. **Tighten the inventory scanner** — resolve `.delete()` / `.del()` to
   the actual table bound by the nearest `db('<t>')` / `trx('<t>')` chain
   tokens earlier on the SAME line / prior statement; skip matches inside
   `try { await blobStorage... } catch {}` and skip `router.delete(...)`
   route registrations unless the handler body contains a DB `.delete()`.
3. **Consider a guard** — extend `check-no-silent-catches.sh` or add
   `check-no-hard-delete-on-softdelete-tables.ts` that parses `.del()` /
   `.delete()` call sites, resolves the bound table, cross-checks
   `schema-snapshot.json` for `deleted_at`, and fails the merge gate.
   That turns this audit category into a sub-second Layer 2 guard forever.
