# Findings 6a — Unbounded SELECT queries

**Agent:** E-unbounded
**Scope:** `.ts` under `apps/api/src/**`.

## Summary

| Tag | Count |
|---|---:|
| `[UNBOUND_LARGE]` primary | 24 |
| `[UNBOUND_LARGE]` related (AI/MCP/FHIR paths) | 19 |
| `[UNBOUND_SMALL]` | 8 |
| `[CLAMPED]` (exemplar good patterns) | 13 |

## Top-5 worst

1. **`apps/api/src/features/messaging/messageRepository.ts:265-276`** — `getInbox` selects whole inbox across all time. No limit, no cursor. Mature inboxes = latency bomb.
2. **`apps/api/src/features/messaging/messageRepository.ts:168`** — `getThread` pulls every message in a thread unbounded.
3. **`apps/api/src/features/patients/patientRoutes.ts:670-683`** — `GET /:id/notes` returns every clinical note for a patient (with 4 JOINs), filters in JS. Patients with long histories return thousands of rows.
4. **`apps/api/src/features/pathology/pathologyRoutes.ts:17-18`** — `/pathology/patient/:patientId` returns every order + `whereIn('pathology_order_id', orders.map(...))` — double-unbounded; multiplied by analytes per panel.
5. **`apps/api/src/features/tasks/taskRepository.ts:106-133`** — `findMany` across clinic with filter-but-no-limit.

## Honourable mentions

- `apps/api/src/features/clinical-notes/clinicalNote.repository.ts:65-72` — `listByPatient` unbounded
- `apps/api/src/features/prescriptions/prescriptionRepository.ts:141-152` — `findByPatient` unbounded; surfaces via FHIR `/MedicationRequest`
- `apps/api/src/integrations/fhir/fhirRoutes.ts:123` — FHIR `/MedicationStatement` — whole rx history
- `apps/api/src/mcp/server/mcpServer.ts:205,227,265,281,347,361,380,471,500` — 9 MCP tool queries clinic-wide with no limit (AI surface latency)
- `apps/api/src/mcp/aiEnhancer.ts:93,95,97` — patient_medications active / patient_alerts / patient_legal_orders joined without `.limit()` (+ missing-clinic_id on 95/97 — overlap with E-rls)

## Potentially catastrophic at scale

1. `patientRoutes.ts:312-338` `/review-status` — full clinic-wide scan of `clinical_notes` twice (medical reviews + clinician reviews) with regex `title ILIKE` predicates, groupBy patient_id. At 100k+ notes per mature clinic, page loads block.
2. `mcpServer.ts:471` `waitlist_metrics` — `.select('*')` on every waiting entry, then computes avg/max/by-urgency in JS. Should be SQL aggregation.
3. `contactRecordRoutes.ts:60-122` `/patient/:patientId/unified` — TWO unbounded queries in parallel (clinical_notes + contact_records), merges in JS. Long-history patients yield huge payloads.

## Exemplar clamps (copy these patterns)

- `apps/api/src/features/clinical-notes/clinicalNote.routes.ts:30` — `Math.min(parseInt(req.query.limit as string, 10) || 50, 200)` — canonical clamp-with-default-and-max
- `apps/api/src/integrations/fhir/bulkExportWorker.ts:87-158` — keyset pagination, gold standard
- `apps/api/src/features/mobile-sync/mobileSyncRoutes.ts:92-115` — `.limit(500)` with since-cursor + `.catch(() => [])`

## Partial-clamp gaps (default-but-no-max)

- `apps/api/src/features/audit/auditReplayRoutes.ts:29,46,81,87` — reads `req.query.limit` with default, no `Math.min(…, MAX)` ceiling; caller can request `limit=10000000`
- `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:545,594` — `/audit-log` accepts `req.query.limit` without clamp
- `apps/api/src/mcp/server/mcpServer.ts:190,212,497,527` — MCP tool args `a.limit` with `|| N` default, no ceiling

## Per-feature heatmap

| Feature | UNBOUND_LARGE |
|---|---:|
| clinical-notes (repo + patientRoutes + contacts + versions) | 8 |
| patient_medications (correspondence + docs + episode + mcp + aiEnhancer + fhir + noteSnippets) | 7 |
| mcp/server (caseload / risk / legal / waitlist / team / workload) | 8 |
| pathology (orders + results + critical + routes) | 4 |
| messaging (thread + inbox) | 2 |
| patient_alerts (patientRoutes + aiEnhancer + mcp) | 3 |
| tasks / legal / risk / letter_audit / attachments | 1 each |

## Related BUGs

- **BUG-370** (first audit) — `.limit()` on 5 patientRoutes endpoints (subset of this)
- **BUG-437** (new) — extend BUG-370 scope to the 24 primary unbounded sites
- **BUG-438** (new) — FHIR surface should honour `_count` query parameter (currently ignored)
- **BUG-439** (new) — shared `pageLimit(req, def=50, max=200)` helper + enforce at every list endpoint
- **BUG-440** (new) — MCP waitlist_metrics SQL-aggregation refactor
