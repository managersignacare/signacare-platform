# Plan — Silent-Catch Category E Re-classification

## Plan-Mode Note
Plan mode is active, so I cannot write the final findings file yet. The user's task
mandates `Write` to `docs/audit-2026-04-19/findings/silent-catch-unknowns-classified.md`.
This plan captures the complete research + the exact markdown the findings file will
contain, so the user can approve in one step.

## Discrepancy Note
The inventory summary declares **23** Category E sites, but only **20** rows in the
table carry `| E |`. Working set is therefore the 20 rows confirmed by grep
(lines 15, 27, 36, 37, 45, 51, 52, 61, 62, 63, 66, 69, 71, 75, 77, 80, 103, 104,
108, 109 of the inventory file). I will flag this discrepancy in the output as
a footnote.

## Research — source context read for each of the 20 sites

All 20 sites read via `Read` tool (30-line windows). Summaries below feed directly
into the final table.

### 1. `apps/api/src/mcp/server/mcpServer.ts:240`
Loop over user-supplied drug names calling RxNav API. `catch {}` swallows a per-drug
lookup failure; loop continues and a separate "need 2 valid drugs" guard fires
after the loop. This IS a graceful-degradation pattern — one failed lookup must
not abort the MCP tool call. **Category: A (intentional — per-item external-API
degradation; loop has an explicit post-loop length guard).**

### 2. `apps/api/src/seed-history-data.ts:271`
Seed script loop inserting historical medications; `try / catch {}` around a single
`db.insert` so one row's failure doesn't abort the seed. Script explicitly
counts `medInserted++` and logs the total. **Category: A (seed-script best-effort;
already has `// @code-columns-exempt` drift annotation above).**

### 3. `apps/web/src/features/settings/pages/SettingsPage.tsx:450`
`handleRemoveLocation` — `apiClient.delete('backup/locations/${id}')` then
`fetchConfig()`. Sibling handlers (add @ :442, run @ :430) surface errors via
`alert()`. This delete silently drops failures; the UI re-reads config and the
row will either still be there (fail) or be gone (success), so the user finds
out only implicitly. **Category: B (Bug 6 — destructive op, silent failure).**

### 4. `apps/web/src/features/settings/pages/SettingsPage.tsx:457`
`handleUpdateSchedule` — `apiClient.put('backup/config', { schedule: {...} })`. Same
shape as #3 — sibling handlers use `alert()`, this one eats errors. **Category: B
(Bug 6 — settings write silently dropped).**

### 5. `apps/web/src/features/patients/pages/PatientsPage.tsx:510`
`handleDelete(planId)` for planned transition plan — destructive `apiClient.delete`,
then flip view to list. Sibling `handleExecute` (same file @ :490) sets
`setResult('Error: ...')` on error. This one doesn't. **Category: B (Bug 6 —
destructive delete silently dropped).**

### 6. `apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:463`
`handleAddTeam` — `createTeam(...)` mutation fails silently; `setSaving(false)`
continues; dialog does not close on error but nothing tells the user WHY. A
critical HR/org-assignment write. **Category: B (Bug 6 — create mutation silently
dropped; user doesn't know team assignment failed).**

### 7. `apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:474`
`handleAddRole` — mirror of #6 for role assignments. **Category: B (Bug 6).**

### 8. `apps/web/src/features/subscription/pages/SubscriptionPage.tsx:27`
`loadSubscriptions()` — `JSON.parse(localStorage.getItem(...))` with migration
fallback to older key. Catches parse error to return `[]`. This is a textbook
`JSON.parse` of stored-but-untrusted data. **Category: D.**

### 9. `apps/web/src/shared/components/ui/AiQuickTasks.tsx:186`
`handleSaveAsNote` — `apiClient.post('patients/${id}/notes', {...})` then navigate.
If save fails, user is navigated to the notes tab AND sees no note AND no error
toast. Classic Bug-6 save-fail. **Category: B (Bug 6 — save-fail hides note-creation
failure AND misleads user with navigation).**

### 10. `apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:935`
`saveAssessment` — ECT nursing/medical assessment POST, `catch { /* */ }` empty
comment. This is a clinical assessment save. **Category: B (Bug 6 — clinical-safety
save silently dropped; empty `/* */` comment is the telltale).**

### 11. `apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:337`
`sendFeedback(rating, accepted)` — POSTs to `llm/feedback`. Telemetry write;
failure is irrelevant to clinician workflow and is explicitly commented `/* silent */`.
**Category: A (intentional — telemetry best-effort; clinician flow must not block
on analytics POST).**

### 12. `apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:632`
Outer catch of the "Create Appointment" button handler. Comment claims "error
handled by global handler" — verified by grep: no `window.addEventListener('error')`
or unhandledrejection handler exists anywhere in `apps/web/src` (only match is
this file itself). Button closes dialog, clinician sees empty success, appointment
never created. **Category: B (Bug 6 — misleading comment; no global handler exists;
clinical appointment create silently dropped).**

### 13. `apps/web/src/features/nursing/pages/NursingPage.tsx:550`
`handleAutoSummary` — `apiClient.get('shift-handovers/auto-summary')` populates a
textarea for the clinician to edit/save. Failure leaves the textarea empty; the
user can retry or write manually. Not a save-fail — it's a suggest-fail.
**Category: A (intentional — AI-assist suggestion, fallback is manual entry).**

### 14. `apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:175`
`handleAiAssist` — `apiClient.post('llm/generate', {...})` to auto-fill 5P form.
Same shape as #13 — AI suggestion, user can type manually. **Category: A.**

### 15. `apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:421`
Outer catch of safety/management/recovery/crisis plan save. Catch comment reads
`/* handle error */` but there is no handler — no toast, no setError, no logging.
`setSaving(false)` runs in finally regardless. **Category: B (Bug 6 — clinical safety
plan save silently dropped; misleading comment).**

### 16. `apps/web/src/features/beds/pages/BedBoardPage.tsx:257`
Search-as-you-type `onChange` firing patient-search GET. Each keystroke triggers
another GET; silent failure = search returns nothing = user types another
character. No user-visible state to correct. **Category: A (intentional —
typeahead GET, fallback is next keystroke).**

### 17. `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:184`
RxNav API per-medication lookup in the drug-interaction checker. Same shape as #1
— one external API failure per med, loop continues, post-loop guard checks
`rxcuis.length < 2`. **Category: A (intentional — external-API per-item degradation).**

### 18. `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2408`
`handleAdd` (allergy) — `apiClient.post('allergies', {...})` followed by dialog
close + field reset in finally (no finally, runs after catch). Comment
`/* show error */` is aspirational — nothing is shown. Clinical safety: allergies
with silently-failed writes. **Category: B (Bug 6 — clinical-safety save silently
dropped; misleading comment).**

### 19. `apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:899`
`handleSave` for inpatient notes — POST to `patients/${id}/notes`. Clinical note
save. `setContent('')` clears the textarea, so on failure the clinician ALSO
loses their draft. **Category: B (Bug 6 — critical: clinical note save silent AND
destroys draft).**

### 20. `apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:1023`
`handleSave` for outcome measure (MADRS/PHQ-9 etc). Both `apiClient.post` calls
inside already have per-call `.catch(err => console.warn(...))` — the outer
`catch { /* */ }` only catches code ABOVE or unexpected sync throws. Given both
async posts are already pre-caught, the outer catch is redundant but still
swallows the `setScore('')` and score-reset logic errors silently. **Category: C
(caller/inner handles via per-call .catch — outer is redundant but not
directly Bug-6).**

## Final tally

| Category | Count |
|---|---|
| A — intentional silence (cleanup, feature-detect, AI-suggest, per-item external-API) | 8 |
| B — save-fail-hidden (Bug 6 class) | 11 |
| C — caller/inner handles (redundant outer catch) | 1 |
| D — JSON.parse of untrusted/stored data | 1 |
| **Total reclassified** | **20** |

**11 of the 20 are Bug-6 class.** These are the ones that must be fixed before release.

## Exact markdown to write to the findings file

The section below is the literal content I will write via `Write` once the user
exits plan mode.

---

```markdown
# Silent-Catch Unknowns — Re-classified

**Date:** 2026-04-19
**Source inventory:** `docs/audit-2026-04-19/inventory/every-silent-catch.md`
**Re-classifier:** ruthless depth pass, 30-line source-context read per site

> **Note on count:** The inventory summary declares 23 Category E sites, but the
> table itself marks only 20 rows as `| E |`. This pass covers those 20 confirmed
> rows. The missing 3 are a summary-body drift that should be reconciled in the
> inventory file.

Total re-classified: **20**
Final breakdown: **A=8, B=11, C=1, D=1**

| # | File:Line | Surrounding Context (summary) | Classification | Proposed Fix |
|---|---|---|---|---|
| 1 | apps/api/src/mcp/server/mcpServer.ts:240 | Per-drug RxNav lookup in MCP `search_drug_interactions` tool; post-loop guard checks `rxcuis.length < 2`. | A (intentional — per-item external-API degradation) | Annotate: `// intentional silent — per-item external-API lookup; post-loop length guard` |
| 2 | apps/api/src/seed-history-data.ts:271 | Seed-script loop INSERT; already carries `@code-columns-exempt` drift annotation. | A (seed-script best-effort) | Annotate: `// intentional silent — seed-script per-row best-effort` |
| 3 | apps/web/src/features/settings/pages/SettingsPage.tsx:450 | `handleRemoveLocation` — `apiClient.delete('backup/locations/${id}')`; sibling handlers use `alert()`. | B (Bug 6 — destructive delete silently dropped) | `catch (err: any) { alert(\`Failed: ${err?.message ?? 'Remove failed'}\`); }` |
| 4 | apps/web/src/features/settings/pages/SettingsPage.tsx:457 | `handleUpdateSchedule` — `apiClient.put('backup/config', {...})`; sibling handlers use `alert()`. | B (Bug 6 — config save silently dropped) | `catch (err: any) { alert(\`Failed: ${err?.message ?? 'Update failed'}\`); }` |
| 5 | apps/web/src/features/patients/pages/PatientsPage.tsx:510 | `handleDelete(planId)` for transition plan; sibling `handleExecute` sets `setResult('Error: ...')`. | B (Bug 6 — destructive delete silently dropped) | `catch (err: any) { setResult(\`Error: ${err?.message}\`); }` |
| 6 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:463 | `handleAddTeam` — `createTeam(...)` mutation fails silently. | B (Bug 6 — team assignment save silent) | `catch (err) { logger.error({err}, 'team assignment failed'); showErrorToast(err); }` or wire to the mutation's `onError`. |
| 7 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:474 | `handleAddRole` — mirror of #6 for role assignments. | B (Bug 6 — role assignment save silent) | Same as #6 for the role mutation. |
| 8 | apps/web/src/features/subscription/pages/SubscriptionPage.tsx:27 | `loadSubscriptions()` — `JSON.parse(localStorage.getItem(...))` with migration fallback. | D (JSON.parse untrusted) | Keep; annotate: `// intentional silent — JSON.parse of stored data, fallback to []` |
| 9 | apps/web/src/shared/components/ui/AiQuickTasks.tsx:186 | `handleSaveAsNote` — POST then `navigate(...)`; failure navigates to empty notes tab. | B (Bug 6 — note save silent + misleading navigation) | `catch (err: any) { showErrorToast(\`Failed to save note: ${err?.message}\`); return; }` (no navigate on error) |
| 10 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:935 | `saveAssessment` — ECT nursing/medical assessment POST; empty `/* */` comment. | B (Bug 6 — clinical assessment save silent) | `catch (err: any) { logger.error({err, type, patientId}, 'ECT assessment save failed'); showErrorToast(err?.message); }` |
| 11 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:337 | `sendFeedback(rating, accepted)` — telemetry POST to `llm/feedback`. | A (telemetry best-effort) | Annotate: `// intentional silent — telemetry POST, must not block clinician flow` |
| 12 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:632 | Outer `catch { /* error handled by global handler */ }` — verified: NO global handler exists. | B (Bug 6 — appointment create silent; misleading comment) | `catch (err: any) { logger.error({err, pid}, 'appointment create failed'); showErrorToast(err?.message); }` (do NOT close dialog on error) |
| 13 | apps/web/src/features/nursing/pages/NursingPage.tsx:550 | `handleAutoSummary` — AI suggestion GET; failure leaves textarea empty for manual entry. | A (AI-suggest, manual fallback) | Annotate: `// intentional silent — AI suggestion, fallback is manual entry` |
| 14 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:175 | `handleAiAssist` — AI 5P form auto-fill; manual entry is the fallback. | A (AI-suggest, manual fallback) | Annotate: `// intentional silent — AI suggestion, fallback is manual entry` |
| 15 | apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:421 | Outer catch of safety/management/recovery/crisis plan save; comment `/* handle error */` but no handler exists. | B (Bug 6 — clinical safety plan save silent) | `catch (err: any) { logger.error({err, planType, patientId}, 'plan save failed'); showErrorToast(err?.message); }` |
| 16 | apps/web/src/features/beds/pages/BedBoardPage.tsx:257 | Typeahead per-keystroke patient search GET. | A (typeahead per-keystroke) | Annotate: `// intentional silent — typeahead GET, fallback is next keystroke` |
| 17 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:184 | Per-med RxNav API lookup for interaction checker; post-loop guard checks `rxcuis.length < 2`. | A (per-item external-API degradation) | Annotate: `// intentional silent — per-med external-API lookup; post-loop length guard` |
| 18 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2408 | `handleAdd` (allergy) — `apiClient.post('allergies', {...})`; comment `/* show error */` is aspirational. | B (Bug 6 — clinical-safety allergy save silent) | `catch (err: any) { logger.error({err, patientId, allergen: title}, 'allergy save failed'); showErrorToast(err?.message); return; }` (do NOT close dialog on error) |
| 19 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:899 | `handleSave` for inpatient clinical note; `setContent('')` in finally destroys draft on failure. | B (Bug 6 — note save silent + draft loss) | `catch (err: any) { logger.error({err, patientId, noteType}, 'inpatient note save failed'); showErrorToast(err?.message); return; /* do not clear draft */ }` |
| 20 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:1023 | Outer catch of outcome-measure save; both inner `apiClient.post` calls already have per-call `.catch(err => console.warn(...))`. | C (inner per-call .catch handles; outer redundant) | Remove the outer `try/catch` (it only covers sync reducer code post-.catch) OR replace with `catch (err: any) { logger.error({err, patientId, scale}, 'outcome measure save failed'); }` |

---

## Summary

Of the 20 Category E sites, **11 turned out to be Bug-6 class** (save-fail-hidden —
rows 3, 4, 5, 6, 7, 9, 10, 12, 15, 18, 19), **8 are intentional silence** (rows
1, 2, 11, 13, 14, 16, 17, plus row 2 as seed best-effort), **1 is Category C**
(row 20 — inner per-call `.catch` handles; outer catch is redundant and should be
removed or replaced with a logger call), and **1 is Category D** (row 8 —
`JSON.parse` of stored localStorage data with fallback).

The Bug-6 class concentrates in three surfaces — **staff-settings org assignments**
(rows 6, 7), **appointment/plan creation** (rows 12, 15), and **clinical-safety
data entry** (rows 10, 18, 19 — ECT assessments, allergy writes, inpatient notes).
These should be fixed first: each represents a clinician-visible "Save succeeded"
illusion on clinical-safety data. Row 19 is the worst: save failure AND
unconditional draft clear.

A companion finding surfaced during this pass: **the "error handled by global handler"
comment at AppointmentsTab.tsx:632 is false** — grep for `unhandledrejection` or
`window.addEventListener('error')` across `apps/web/src` returns only that file
itself. No global handler exists. The comment actively misled the audit and the
inventory. Flag this as a distinct bug: the pattern of "rely on global handler"
without one existing is itself a systemic risk.
```

## Plan completion condition

When the user exits plan mode I will:
1. `Write` the markdown block above (between the ```markdown fences) to
   `docs/audit-2026-04-19/findings/silent-catch-unknowns-classified.md`
2. Return the 1-paragraph summary requested by the user.

No other edits. No commits. No other files touched.
