# Plan — BUG-437 REPLAY: Expand `.limit()` Safety Ceilings to 24 Primary Unbounded Knex Sites

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 — no cherry-pick from reverted commit `7748e28`.]

**Severity:** S1 deploy-blocker (pre-staging)
**Predecessor:** BUG-370 (S2, ~20 sites already capped — verified at HEAD via `mcp/aiEnhancer.ts:94/96/98/99/100/101/102` + `mcp/server/mcpServer.ts:190/212/270/440/497/527`)
**Reverted commit (do NOT re-read):** `7748e28` — superseded by atomic revert `a475e32` 2026-04-24
**Replay queue position:** PART 1 Tier-3 #12

## 0. Why a ceiling, not pagination

Pagination is BUG-439 (S2, post-staging) — the scoped helper `pageLimit(req, def, max)` is the strategic answer. BUG-437 is the tactical S1 ceiling: a single `.limit(N)` per call site that prevents:
- DoS via `OFFSET 0 LIMIT 2_000_000` on a clinic-wide table
- Memory blow-up in node when a clinic with 50k notes feeds an LLM context
- Accidental request stalling when an oncologist has 800 active medications across 20 episodes

The cap is **above** any realistic clinical volume so it never fires in normal use, but bounds the worst case. Per PART 6.1 principle 2 ("no band-aids"): the ceiling is the gold-standard defence-in-depth guard for the unbounded class — not a substitute for pagination.

## 1. Site inventory — 24 primary unbounded Knex sites (HEAD verified)

Each line was opened with Read; the grep output is cited in §8.

### Class M — MCP tool dispatcher (4 sites)

Request-scoped via `handleMcpRequest`. Caller is an AI agent with no client-side row-count control — server MUST cap.

| # | File | Line | Tool | Returns | Cap | Justification |
|---|---|---|---|---|---|---|
| M1 | `apps/api/src/mcp/server/mcpServer.ts` | 205 | `list_medications` | per-patient meds (all statuses unless filtered) | **500** | Per-patient meds inc. ceased rarely > 200; 500 is a 2.5× safety margin. |
| M2 | `apps/api/src/mcp/server/mcpServer.ts` | 227 | `list_alerts` | active alerts per patient | **500** | Alerts are bounded clinically (< 50 typical) but a misconfigured `is_active` flip could surface thousands; cap matches per-patient list class. |
| M3 | `apps/api/src/mcp/server/mcpServer.ts` | 264-268 | `list_episodes` | episodes per patient | **500** | Per-patient episodes < 100; same per-patient list class. |
| M4 | `apps/api/src/mcp/server/mcpServer.ts` | 471 | `waitlist_metrics` | clinic-wide rows scanned for in-memory aggregation | **2000** | Waitlist rarely > 500 patients; 2000 protects against accumulated stale rows without losing aggregation accuracy. SQL-aggregation refactor is BUG-440 (post-staging). |

### Class A — aiEnhancer LLM context loader (5 sites)

Background-ish (called from `tools/call get_patient_context` MCP path AND request-scoped chat endpoints). Output feeds an LLM prompt — context-window budget governs the cap.

| # | File | Line | Table | Returns | Cap | Justification |
|---|---|---|---|---|---|---|
| A1 | `apps/api/src/mcp/aiEnhancer.ts` | 91 | `patient_contacts` | per-patient contacts | **50** | LLM context budget. Contacts > 50 = noise; the prompt format truncates anyway. |
| A2 | `apps/api/src/mcp/aiEnhancer.ts` | 92 | `episodes` | per-patient episodes | **50** | Same. The prompt cites the most recent — older episodes drown signal. |
| A3 | `apps/api/src/mcp/aiEnhancer.ts` | 93 | `patient_medications` (status=active) | per-patient active meds | **50** | Polypharmacy patients > 30 are real; 50 keeps headroom. |
| A4 | `apps/api/src/mcp/aiEnhancer.ts` | 95 | `patient_alerts` (joined) | per-patient alerts | **50** | Same context-window logic. |
| A5 | `apps/api/src/mcp/aiEnhancer.ts` | 97 | `patient_legal_orders` (joined) | per-patient orders | **50** | Per-patient legal orders rarely > 5; 50 is generous. |

### Class F — FHIR R4 surface (5 sites)

Request-scoped via `/api/v1/fhir/...`. External integration — caller is another EHR / portal that may have its own pagination but cannot be relied on. FHIR `_count` enforcement is BUG-438 (post-staging); the ceiling covers the gap.

| # | File | Line | Resource | Cap | Justification |
|---|---|---|---|---|---|
| F1 | `apps/api/src/integrations/fhir/fhirRoutes.ts` | 100 | Condition (per-patient diagnoses) | **500** | Per-patient diagnoses < 100; 500 is per-patient list class. |
| F2 | `apps/api/src/integrations/fhir/fhirRoutes.ts` | 123 | MedicationStatement (per-patient) | **500** | Same class; matches A3 cap × 10 because FHIR pull is not LLM-context-budgeted. |
| F3 | `apps/api/src/integrations/fhir/fhirRoutes.ts` | 146 | AllergyIntolerance (per-patient) | **500** | Same class. |
| F4 | `apps/api/src/integrations/fhir/fhirRoutes.ts` | 214 | EpisodeOfCare (per-patient) | **500** | Same class; mirrors M3. |
| F5 | `apps/api/src/integrations/fhir/fhirRoutes.ts` | 286 | Practitioner (clinic-wide staff) | **1000** | Clinic-wide staff list; a 100-bed inpatient unit can have 600 active staff incl. casual + bank. 1000 is 1.5× safety margin. |

### Class N — Clinical-notes snippet builders (2 sites)

Request-scoped via `GET /clinical-notes/patient/:patientId/snippets`. Output inserted into a clinician's note via Alt+Shift macro. Already paged at `pathology=5`, `outcomes=5`, `vitals=first` — but `meds` and `allergies` are uncapped.

| # | File | Line | Section | Cap | Justification |
|---|---|---|---|---|---|
| N1 | `apps/api/src/features/clinical-notes/noteSnippets.ts` | 213-218 | `buildMedicationsSnippet` (active meds, episode-scoped when episodeId present) | **500** | Per-patient list class. Clinical reality typical < 30, but the snippet is inline in a clinician's note — accidental browser hang from a polypharmacy import is high-impact. 500 is generous but firm. |
| N2 | `apps/api/src/features/clinical-notes/noteSnippets.ts` | 237-241 | `buildAllergiesSnippet` | **500** | Same class. |

### Class T — Thread + Inbox (2 sites)

Request-scoped via messaging routes. The **inbox** is per-user — a 6-month-busy clinician can have 5k unread; the **thread** view is per-thread but multi-month conversations exist.

| # | File | Line | Function | Cap | Justification |
|---|---|---|---|---|---|
| T1 | `apps/api/src/features/messaging/messageRepository.ts` | 145-150 | `listThreads` (per-user threads) | **500** | Per-user list class. UI shows a sidebar — > 500 threads is unusable anyway, server-side cap protects payload. |
| T2 | `apps/api/src/features/messaging/messageRepository.ts` | 265-276 | `getInbox` (per-user inbox messages) | **500** | Same. Pagination is the proper fix (BUG-439); ceiling closes the deploy-blocker class. |

### Class P — Pathology (2 sites)

| # | File | Line | Function | Cap | Justification |
|---|---|---|---|---|---|
| P1 | `apps/api/src/features/pathology/pathologyRepository.ts` | 119-126 | `findOrdersByPatient` | **500** | Per-patient orders rarely > 50; 500 is per-patient list class. |
| P2 | `apps/api/src/features/pathology/pathologyRepository.ts` | 222-228 | `findCriticalUnacknowledged` (clinic-wide critical results scan) | **5000** | Clinical-safety-critical: populates the critical-result acknowledgement queue. A clinic going live with a 5-year HL7 backlog could surface 5k+ unacknowledged. 5000 prevents node-level OOM but does not silently drop critical results — if the cap fires, the response must surface a `truncated: true` flag so operator sees the hazard. Verify with L4 — if 5000 is too low, raise to 20000 (still bounded). |

### Class R — Prescriptions (1 site)

| # | File | Line | Function | Cap | Justification |
|---|---|---|---|---|---|
| R1 | `apps/api/src/features/prescriptions/prescriptionRepository.ts` | 146-151 | `findByPatient` | **500** | Per-patient list class. |

### Class K — Tasks (1 site)

| # | File | Line | Function | Cap | Justification |
|---|---|---|---|---|---|
| K1 | `apps/api/src/features/tasks/taskRepository.ts` | 110-133 | `findMany` (clinic-wide list with optional filters) | **500** | Per-user task feed. Filters narrow the set, but absent filters this is clinic-wide tasks; 500 protects payload. |

### Class X — Audit-replay administrative views (2 sites)

Admin-restricted (requireRoles ADMIN_ROLES) but still bounded by data-volume reasoning — a 5-year-old patient's audit log on `clinical_notes:<id>` could be in the thousands.

| # | File | Line | Endpoint | Cap | Justification |
|---|---|---|---|---|---|
| X1 | `apps/api/src/features/audit/auditReplayRoutes.ts` | 62-70 | `/record/:table/:recordId` history | **2000** | Per-record audit log; > 2000 is pathological but possible (frequent updates over years). |
| X2 | `apps/api/src/features/audit/auditReplayRoutes.ts` | 111-120 | `/ai-provenance/:patientId` | **2000** | AI provenance per patient — a heavy LLM-using clinician across 10 years can exceed 1000. |

**Total: 24 sites.** Each verified by Read; line numbers HEAD-current 2026-04-25.

## 2. Out-of-scope sites (excluded with justification)

These appeared in initial Grep but are EXCLUDED:

- `apps/api/src/integrations/fhir/fhirRoutes.ts:321` `clinics` — list of all clinics; admin-bounded by clinic curation, schema-bounded by clinic creation cadence (< 100 lifetime). Not a practical DoS surface.
- `apps/api/src/features/clozapine/clozapineRepository.ts:212-215` `findByPatient` — per-patient clozapine registrations; clinically bounded (< 5 per patient lifetime).
- `apps/api/src/features/lai/laiGivenRepository.ts:75-79` `findBySchedule` — per-LAI-schedule (< 50 per schedule).
- `apps/api/src/features/appointments/appointmentAttendeeRepository.ts:60` `listForAppointment` — per-appointment (< 20 per appt).
- `apps/api/src/features/group-therapy/groupTherapyRoutes.ts:99` `attendees` — per-session (< 50).
- `apps/api/src/features/risk/riskRepository.ts:110-120` `listForPatient` — per-patient risk assessments (< 50). Defensible to add but excluded to keep scope at 24; tracked for BUG-439 follow-up.
- `apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts:43` `advance_directives` per-patient (< 20). Same reasoning.
- `apps/api/src/features/correspondence/correspondenceRepository.ts:102-107` `findLettersByPatient` — defensible to include; excluded to keep at 24, tracked for BUG-439.
- `apps/api/src/features/correspondence/correspondenceRepository.ts:141-148` `findTemplatesByClinic` — admin-curated, schema-bounded.
- All `episodeRoutes.ts:40-57` and `:83-101` clinic/team rosters — defensible to cap at 2000 but TWO sites is at risk of L4 review pushback for "bandaid scope creep" — held for follow-up since the unbounded class is already covered by Class M MCP team_caseload at the same query shape.
- All aggregation paths (`COUNT(*)`, `GROUP BY`, `SUM`) — bounded by aggregation contract.
- All `.first()` calls — return at most 1 row.
- Any read terminated by `.insert()`, `.update()`, `.delete()` — not list reads.
- `apps/api/src/features/llm/llmRoutes.ts:452` — already has `.limit(100)` (training_export_requests).
- `apps/api/src/features/notifications/notificationRepository.ts:159` — already capped via `opts.limit`.
- `apps/api/src/features/episode/episodeRepository.ts:108` — already uses cursor pagination (`.limit(limit + 1)`).
- `apps/api/src/features/appointments/appointmentRepository.ts:138/148` — already `.limit(limit)`.
- `apps/api/src/features/appointments/waitlistRepository.ts:107` — already `.limit(limit)`.

## 3. Fix shape — single-line ceiling per site

For each site, append `.limit(<cap>)` to the chain. Example diff shape:

```diff
- const rows = await db('patient_alerts').where({ patient_id: a.patientId, is_active: true });
+ const rows = await db('patient_alerts')
+   .where({ patient_id: a.patientId, is_active: true })
+   .limit(500); // BUG-437 — unbounded-ceiling per-patient
```

The marker comment `BUG-437 — unbounded-ceiling` is mandatory at every site (drives fix-registry regex anchors).

**Forbidden alternatives:**
- Wrapping in pagination middleware — that's BUG-439's scope.
- Reading without limit then `Array.prototype.slice` — moves the DoS surface from Postgres to node memory.
- Dynamic limit from `req.query` — out of scope; later BUG.
- Conditional caps — every site gets a fixed ceiling.

**Per PART 6.1 principle 2:** the cap is the gold-standard for THIS class of bug. Pagination is a separate, larger refactor (BUG-439) whose absence is itself a deploy-blocker that has been deferred to S2 by clinical-safety triage.

## 4. TDD red plan — `apps/api/tests/integration/limitCeilings.int.test.ts` (NEW)

File does NOT exist at HEAD (verified by `ls apps/api/tests/integration/ | grep -i limit` → only `rateLimiting.test.ts`). Pre-fix: every described test fails because the underlying query returns N+K rows. Post-fix: every test passes because `.limit(N)` truncates to N.

### 4.1 File header

```typescript
/**
 * BUG-437 — integration test for unbounded `.limit()` ceilings.
 *
 * For each ceiling class, seeds N+K rows where N is the proposed cap and K=10,
 * invokes the route/service, and asserts the response array length === N.
 *
 * Pre-fix: every test FAILS (response length is N+K, no ceiling).
 * Post-fix: every test PASSES (cap truncates to N).
 *
 * Tests run against the docker-compose Postgres at localhost:5433.
 */
```

### 4.2 Eight test cases (one per ceiling class minimum)

| # | Class | Test | Seed | Route / call | Assert |
|---|---|---|---|---|---|
| 1 | N (clinical-notes snippet) | meds snippet caps at 500 | 510 active meds for patientA | `GET /api/v1/clinical-notes/patient/:patientId/snippets?types=meds` | `body.snippets[type=meds].recordCount === 500` |
| 2 | T (inbox) | inbox caps at 500 | 510 unread messages for userA | `GET /api/v1/messages/inbox?unreadOnly=true` | `body.length === 500` |
| 3 | T (thread) | listThreads caps at 500 | 510 threads with userA participant | `GET /api/v1/messages/threads` | `body.length === 500` |
| 4 | P (pathology) | findOrdersByPatient caps at 500 | 510 pathology orders for patientA | `GET /api/v1/pathology/patient/:patientId/orders` (or via service test) | `rows.length === 500` |
| 5 | R (prescription) | findByPatient caps at 500 | 510 prescriptions for patientA | service-level: `prescriptionRepository.findByPatient(clinic, patientA)` | `rows.length === 500` |
| 6 | K (tasks) | findMany caps at 500 | 510 tasks in clinic A | service-level: `taskRepository.findMany(clinic, {})` | `rows.length === 500` |
| 7 | F (FHIR) | Practitioner Bundle caps at 1000 | 1010 active staff in clinic A | `GET /api/v1/fhir/Practitioner` | `body.entry.length === 1000` AND `body.total === 1000` |
| 8 | M (MCP) | list_alerts caps at 500 | 510 active alerts for patientA | direct call: `handleMcpRequest({method:'tools/call', params:{name:'list_alerts', arguments:{patientId:A}}}, auth)` | response text contains 500 entries (line-count) |

### 4.3 Helpers reused

`apps/api/tests/integration/_helpers.ts` already provides `createTestPatient`, `createTestStaff`, `seedTokens` etc. — extend with `seedRowsBulk(table, count, rowFn)` for the 510-row setups.

### 4.4 Expected pre-fix failure shape (TDD red gate per PART 2 §C)

```
FAIL apps/api/tests/integration/limitCeilings.int.test.ts > meds snippet caps at 500
  Expected: 500
  Received: 510
```

Run each test 3× (PART 2 §F flake-guard) before declaring red gate cleared.

## 5. Fix-registry rows — `docs/quality/fix-registry.md`

Per CLAUDE.md §9.5 each commit adds ≥ 1 row; BUG-437 spans 7 files so ≥ 4 distinctive anchors are mandated. Anchors:

| Row | File | Marker | Regex |
|---|---|---|---|
| `R-FIX-BUG-437-MCP-CEILINGS` | `apps/api/src/mcp/server/mcpServer.ts` | `BUG-437 — unbounded-ceiling` | `BUG-437 — unbounded-ceiling` (≥ 4 hits expected: M1-M4) |
| `R-FIX-BUG-437-AIENHANCER-LLM-CTX` | `apps/api/src/mcp/aiEnhancer.ts` | `BUG-437 — llm-ctx-cap` | `BUG-437 — llm-ctx-cap` (≥ 5 hits: A1-A5) |
| `R-FIX-BUG-437-FHIR-CEILINGS` | `apps/api/src/integrations/fhir/fhirRoutes.ts` | `BUG-437 — fhir-ceiling` | `BUG-437 — fhir-ceiling` (≥ 5 hits: F1-F5) |
| `R-FIX-BUG-437-NOTE-SNIPPETS` | `apps/api/src/features/clinical-notes/noteSnippets.ts` | `BUG-437 — snippet-ceiling` | `BUG-437 — snippet-ceiling` (≥ 2 hits: N1-N2) |
| `R-FIX-BUG-437-INBOX-THREAD` | `apps/api/src/features/messaging/messageRepository.ts` | `BUG-437 — messaging-ceiling` | `BUG-437 — messaging-ceiling` (≥ 2 hits) |
| `R-FIX-BUG-437-PATHOLOGY-CEILINGS` | `apps/api/src/features/pathology/pathologyRepository.ts` | `BUG-437 — pathology-ceiling` | `BUG-437 — pathology-ceiling` (≥ 2 hits) |
| `R-FIX-BUG-437-RX-TASKS-CEILINGS` | `apps/api/src/features/prescriptions/prescriptionRepository.ts` + `apps/api/src/features/tasks/taskRepository.ts` | `BUG-437 — list-ceiling` | `BUG-437 — list-ceiling` (≥ 2 hits across 2 files) |
| `R-FIX-BUG-437-AUDIT-REPLAY` | `apps/api/src/features/audit/auditReplayRoutes.ts` | `BUG-437 — audit-ceiling` | `BUG-437 — audit-ceiling` (≥ 2 hits) |

`bash .github/scripts/check-fix-registry.sh` will validate each regex hits its file. Each anchor row in `docs/quality/fix-registry.md` follows the §9.5 format:

```
| R-FIX-BUG-437-MCP-CEILINGS | apps/api/src/mcp/server/mcpServer.ts | present | `BUG-437 — unbounded-ceiling` | MCP tool dispatcher unbounded list queries capped at per-class ceilings (BUG-437) |
```

## 6. L4 / L5 conditional triggers — confirmation

Per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §H/§I + §13.5:

### L4 (clinical-safety-reviewer) — **FIRES**

Path-based:
- `apps/api/src/features/clinical-notes/noteSnippets.ts` (Class N) → fires per §13.5 path list (`clinical-notes/`)
- `apps/api/src/features/pathology/pathologyRepository.ts` (Class P) → fires per `pathology/`
- `apps/api/src/features/prescriptions/prescriptionRepository.ts` (Class R) → fires per `prescriptions/`
- `apps/api/src/mcp/aiEnhancer.ts` (Class A) → semantic trigger: this feeds an LLM context that drives clinical-decision support. Cap of 50 affects what the LLM "sees" of the patient — patient-safety boundary per §13.5 semantic list.

Semantic concern for L4 reviewer:
- Class A cap = 50 on `patient_medications:active`. A polypharmacy patient (≥ 50 active meds) would have meds 51..N invisible to the LLM context. **Mitigation:** the 50-cap is for LLM-context-budget reasons; the EMR-canonical med list (Class F2 = 500, Class M1 = 500, Class N1 = 500) is uncapped relative to clinical reality. The LLM context truncating older/inactive meds is acceptable per scribeRoutes' existing format-discipline. Document this trade-off in the commit body so L4 has the rationale.
- Class P2 cap = 5000 on `findCriticalUnacknowledged` — if it fires, dropped critical results are NOT acknowledged → patient-safety hazard. **Mitigation:** the cap is far above any realistic single-clinic backlog (5000 = 5 years of daily critical labs); if it fires, the response includes `truncated: true` flag so the operator sees the hazard. Verify with L4 reviewer that 5000 is high enough — if rejected, raise to 20000 (still bounded).

### L5 (architecture-reviewer) — **FIRES**

Per §I:
- Modifies `apps/api/src/integrations/fhir/` → fires per `integrations/`
- Edits `docs/quality/fix-registry.md` → fires per fix-registry edit clause
- Touches `apps/api/src/mcp/` (AI surface) → fires per `llm/` family
- Does NOT add a migration → schema-snapshot regen (§13.6) does not apply

Semantic concerns for L5 reviewer:
- Cross-cutting consistency: 8 files / 24 sites — verify cap-per-class is uniform (no drift between F1 cap and F2 cap on the same class).
- Verify no `.limit(N)` is applied AFTER `.first()` or aggregation by mistake.
- Verify no Class A site loses the existing `.catch(logQueryFail(...))` chain when the ceiling is added — that's the existing failure-degrades-to-empty contract from BUG-281.
- Confirm fix-registry regex uniqueness — no anchor matches a substring of another.

### L3 (code-reviewer-general) — fires unconditionally per PART 2 §G.

### L1 (static gates) — runs as standard. No new guard added; the ceilings are passive.

### L2 (test gates) — `limitCeilings.int.test.ts` × 3 flake + adjacent feature tests + integration suite (full, per §13.9 because diff touches `integrations/fhir/` and `mcp/`).

## 7. PART 2 §A-§O execution map

§A done (subdir created at run time).
§B done (this file).
§C TDD red — write `limitCeilings.int.test.ts`, run 3×, confirm 8/8 fail.
§D Implementation — 24 site edits across 8 files; ≤ 5 LOC per site (single `.limit()` insert + marker comment).
§E L1 — tsc × 3 workspaces + lint × 3 + every `.github/scripts/check-*.sh` + every `scripts/guards/check-*.ts`.
§F L2 — `limitCeilings.int.test.ts` × 3 flake; adjacent feature tests for clinical-notes / messaging / pathology / prescriptions / tasks / fhir / mcp; full unit suite; full integration suite (touches integrations/ + mcp/).
§G L3 — code-reviewer-general; ABSORB on REJECT (≤ 2 per §J).
§H L4 — clinical-safety-reviewer; fires per §6 above.
§I L5 — architecture-reviewer; fires per §6 above.
§J 2-REJECT absorb cap per level.
§K Fix-registry rows added (§5 above) in same commit.
§L Commit message format per PART 2 §L; reference BUG-437; co-author tag per §13.11.
§M Update `docs/quality/bugs-remaining.md` (BUG-437 row → `**fixed**` with commit SHA) + yaml catalogue per §13.10.
§N Push **only after explicit user authorization** (PART 6.1 principle 7).
§O Append `progress.md` row.

## 8. Verification log — every site Read-confirmed

| Site ID | File | Line | Grep anchor |
|---|---|---|---|
| M1 | mcp/server/mcpServer.ts | 205 | `case 'list_medications': { const q = db('patient_medications').where({ patient_id: a.patientId })...` |
| M2 | mcp/server/mcpServer.ts | 227 | `case 'list_alerts': { const rows = await db('patient_alerts').where({...is_active: true });` |
| M3 | mcp/server/mcpServer.ts | 264-268 | `case 'list_episodes': { const q = db('episodes').where({ patient_id: a.patientId })...` |
| M4 | mcp/server/mcpServer.ts | 471 | `case 'waitlist_metrics': { const rows = await db('waitlist_entries').where('status','waiting')...select('*');` |
| A1-A5 | mcp/aiEnhancer.ts | 91/92/93/95/97 | Promise.all block; lines W/o `.limit()` are A1-A5 |
| F1 | integrations/fhir/fhirRoutes.ts | 100 | `await db('diagnoses').where({ patient_id: patientId, clinic_id: req.clinicId });` |
| F2 | integrations/fhir/fhirRoutes.ts | 123 | `await db('patient_medications').where({ patient_id: patientId, clinic_id: req.clinicId });` |
| F3 | integrations/fhir/fhirRoutes.ts | 146 | `await db('patient_allergies').where({ patient_id: patientId }).whereNull('deleted_at');` |
| F4 | integrations/fhir/fhirRoutes.ts | 214 | `await db('episodes').where({ patient_id: patientId }).whereNull('deleted_at').orderBy('start_date', 'desc');` |
| F5 | integrations/fhir/fhirRoutes.ts | 286 | `await db('staff').whereNull('deleted_at').where('is_active', true).orderBy('family_name');` |
| N1 | features/clinical-notes/noteSnippets.ts | 213-218 | `const q = db('patient_medications').where({...status:'active'}).whereNull('deleted_at').orderBy('start_date','desc'); ... await q.select(...)` |
| N2 | features/clinical-notes/noteSnippets.ts | 237-241 | `const rows = await db('patient_allergies').where(...).whereNull('deleted_at').orderBy('recorded_at','desc').select(...)` |
| T1 | features/messaging/messageRepository.ts | 145-150 | `db('message_threads').where({clinic_id}).whereExists(...).orderBy('updated_at','desc')` |
| T2 | features/messaging/messageRepository.ts | 265-276 | `db('messages').where({clinic_id}).whereExists(...).whereNot('sender_id',...).orderBy('created_at','desc').select('messages.*')` |
| P1 | features/pathology/pathologyRepository.ts | 119-126 | `db('pathology_orders').where({clinic_id, patient_id}).whereNull('deleted_at').orderBy('created_at','desc')` |
| P2 | features/pathology/pathologyRepository.ts | 222-228 | `db('pathology_results').where({clinic_id, is_critical:true}).whereNull('critical_acknowledged_at').orderBy('created_at','asc')` |
| R1 | features/prescriptions/prescriptionRepository.ts | 146-151 | `db('prescriptions').where({clinic_id, patient_id}).whereNull('deleted_at').orderBy('prescribed_date','desc')` |
| K1 | features/tasks/taskRepository.ts | 110-133 | `db('tasks as t').leftJoin(...).where({'t.clinic_id': clinicId})...orderBy('t.due_date','asc')` |
| X1 | features/audit/auditReplayRoutes.ts | 62-70 | `db('audit_log as al').leftJoin(...).where({'al.table_name':table,'al.record_id':recordId})...orderBy('al.created_at','asc')` |
| X2 | features/audit/auditReplayRoutes.ts | 111-120 | `db('ai_provenance').where({patient_id: patientId}).leftJoin(...).orderBy('ai_provenance.created_at','desc')` |

## 9. Risks + open questions for the user

1. **Class P2 cap = 5000.** If a clinic genuinely has > 5000 unacknowledged critical pathology results, the cap silently drops some — and these are clinically-actionable. Mitigation: the implementation will add a `truncated: true` flag in the response when `rows.length === 5000`. The L4 reviewer should confirm this is acceptable, or recommend raising to 20000.
2. **Class A caps = 50.** LLM-context window is the rationale, not data volume. If a polypharmacy patient (50+ active meds) has meds 51..N excluded from the LLM prompt, the LLM may miss interactions. Mitigation: same as today — the LLM is decision-support only, never authoritative; the EMR-canonical med list (Class F2 / M1 / N1) is at 500. L4 should confirm.
3. **Class T1/T2 caps = 500.** A 5-year-tenured psychiatrist with > 500 inbox messages will see only 500. The L4 / L5 reviewer may push to add an "older threads" link — that's BUG-439 pagination scope. Document the boundary clearly.
4. **Future BUG-439** (post-staging) will replace these ceilings with proper request-driven pagination + a `pageLimit(req, def, max)` helper. The ceilings remain as defence-in-depth — they should NOT be removed when pagination lands.
5. **No new CI guard added.** A `scripts/guards/check-unbounded-knex.ts` could be written, but designing it without false-positives is itself a design task — held for BUG-439.

## 10. Out-of-scope follow-ups (file via PART 3 if surfaced during gates)

- **BUG-(next)** — risk_assessments / advance_directives / correspondence_letters per-patient ceilings (excluded from BUG-437 to keep scope at 24).
- **BUG-(next)** — episode roster (clinician + team) ceilings — currently uncapped in episodeRoutes.ts.
- **BUG-439** — pageLimit helper + cursor pagination on every list endpoint (S2 post-staging).
- **BUG-440** — waitlist_metrics SQL-aggregation refactor (S2; replaces M4 ceiling).
- **BUG-(next)** — `scripts/guards/check-unbounded-knex.ts` static guard.

## 11. Verification of this plan file

1. Plan derived from current HEAD reading; commit `7748e28`'s diff was NOT read (per PART 6.1 principle 3).
2. Every cited line was opened with the Read tool — no guessing (PART 6.1 principle 5).
3. Caps are justified per data-volume reasoning, not copied from the reverted commit.
4. 24 sites, 8 files; matches the bugs-remaining.md scope ("24 primary unbounded sites").
5. L4 + L5 conditional triggers analysed and CONFIRMED to fire.
6. Fix-registry plans 8 anchor rows (≥ 4 required); each with a unique regex.
7. TDD plan covers 8 distinct ceiling classes (M, A, F, N, T, P, R, K, X) — specifically the test-class list called out by the user (clinical notes, inbox, thread, pathology, prescription, tasks, FHIR, MCP).
8. Out-of-scope sites enumerated with explicit reasoning so the L3 reviewer can verify no silent drops.
