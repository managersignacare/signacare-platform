# SPIKE — USER-D outcome measures + rating scales per-item + graphs

**Status:** design complete; implementation deferred to dedicated sub-cluster (est. 6-8 commits across schema + backend + frontend).
**Owner:** Wave A-5-USER Sub-cluster D.
**Addresses:** user items 7 + 8 — "Outcome measures: only totals, no per-item + no graphs", "Rating scales dropdown blank; per-item + graphs over time".

## Current state (verified)

- `outcome_measures` table: has `items jsonb` column that already holds per-item responses + a `total_score` numeric. The items shape is `Record<string, number>` per `apps/web/src/features/patients/components/detail/tabs/OutcomeMeasuresTab.tsx:36`.
- `outcomeRoutes.ts:102` GET `/outcomes/patient/:patientId` **DOES return `items`** in the response (`items: typeof r.items === 'string' ? JSON.parse(r.items) : (r.items ?? {})`). Per-item data is already on the wire.
- **The user's complaint is not that per-item data is missing from the DB — it's that the UI doesn't RENDER per-item breakdown or graphs.** This reframes USER-D as a frontend-only change (no migration, no schema).
- Rating scales: saved as clinical-note text with structured fields (not as rows in a `rating_scales` table). `AssessmentsTab.tsx:128` pulls `ratingTemplates` from `templates` table filtered by `category='Rating Scales'`; completed instances land in `clinical_notes` with a `ratingScale` JSON blob in content. The "dropdown blank" issue is likely that no template-rows with `category='Rating Scales'` are seeded in the current DB.

## Revised D plan (dramatically smaller)

### D.1 — verify the "dropdown blank" claim (1 diagnostic commit)

- Query live DB: `SELECT COUNT(*) FROM templates WHERE category = 'Rating Scales'`.
- If 0: seed script for 5-8 canonical scales (PHQ-9, GAD-7, AUDIT, MADRS, YMRS, CGI, HAMD, BPRS). Minimum scope: PHQ-9 + GAD-7 + MADRS.
- If > 0: frontend bug — investigate `patientTemplatesKeys.ratingScales()` query + component filter logic.

### D.2 — per-item rendering (1 frontend commit)

- `OutcomeMeasuresTab.tsx`: expandable row reveal already exists (`expandedId` state at line 210). Confirm per-item rendering is wired; if not, add an items-breakdown block that lists each item with its response and subscale total.
- Reuse existing expansion-chip UX from EpisodesTab for consistency.

### D.3 — graph component (1 frontend commit)

- Backend endpoint already exists: `/outcomes/patient/:patientId/graph?type=<measureType>` at `outcomeRoutes.ts:111-121`. Returns `{ measureType, dataPoints: [{id, created_at, total_score, collection_occasion}] }`.
- New component `OutcomeMeasureChart.tsx` — reuses Recharts (already a dependency? verify). Line chart over `created_at` with `total_score` on y-axis; points coloured by `collection_occasion` (admission / discharge / review).
- Embed in `OutcomeMeasuresTab` above the existing table with a measure-type tab bar (HoNOS / K10 / LSP-16) — default to the most-recent measure type.

### D.4 — episode-scoped graph filter (1 frontend commit; depends on D.3)

- The graph endpoint at `outcomeRoutes.ts:115` currently has NO episode filter. Add optional `episodeId` query param to match `outcomeRoutes.ts:91` (which already supports it for the list endpoint).
- Frontend passes `episodeId` when the tab is rendered inside an episode view (same pattern as USER-A.3 noteSnippets).
- Reopens the same PHI-isolation concern as USER-A.3 — cross-episode outcome data should not appear in the "this episode" view.

### D.5 — rating scales per-item + graphs (1-2 commits)

Harder because rating scales are stored as JSON-in-note content, not relational rows. Two sub-options:

**Option A (lightweight)**: extract the `ratingScale` JSON blob from `clinical_notes.content` on the way out of the GET endpoint, present per-item + totals over time. No schema change.

**Option B (structural)**: new `rating_scale_instances` table with `(id, clinic_id, patient_id, episode_id, staff_id, template_id, items jsonb, total_score, created_at)` — mirrors `outcome_measures` shape. Backfill existing clinical-notes rating-scale data. All future saves write to the relational table AND retain a summary in the note for traceability.

Option B is the gold-standard structural answer; Option A is the iterative patch. Decision required — Option B is what the plan's no-band-aid rule favours.

## Dependencies / prereqs

- Recharts (verify in `apps/web/package.json`).
- No schema change in the minimum D plan. Only Option B (D.5) introduces a new table.

## Tests

- D.2: OutcomeMeasuresTab component test — per-item expansion renders exactly the items in the JSONB field.
- D.3: chart component snapshot test + endpoint happy-path test (already implicitly covered by outcomeRoutes tests).
- D.4: vitest — graph query respects episodeId filter.
- D.5: depends on A vs B.

## Why not build now

- The minimum D plan is 3-5 frontend commits — feasible in its own sub-cluster session.
- USER-D.5 Option B requires new schema + backfill + migration (§12.4 skeleton + RLS + CHECK + snapshot regen).
- Review gates: L3 + L4 for D.4 (PHI episode scoping) + L5 for D.5-B (new table).

## Fix-registry anchors (when shipped)

- `R-FIX-OUTCOME-MEASURES-PER-ITEM-RENDER`
- `R-FIX-OUTCOME-MEASURES-GRAPH-COMPONENT`
- `R-FIX-OUTCOME-MEASURES-EPISODE-SCOPED-GRAPH`
- `R-FIX-RATING-SCALES-PER-ITEM-RENDER`
- `R-FIX-RATING-SCALES-INSTANCES-TABLE` (if Option B)
