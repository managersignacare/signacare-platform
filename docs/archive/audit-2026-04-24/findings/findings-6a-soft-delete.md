# Findings 6a — Soft-delete filter correctness

**Agent:** E-soft-delete
**Scope:** `.ts` under `apps/api/src/**`.
**Authoritative list source:** `apps/api/src/db/schema-snapshot.json` — 66 tables have `deleted_at`; 10 exempt tables confirmed without the column.

## Summary

| Mode | Count | Notes |
|---|---:|---|
| **Mode A** — soft-deletable table queried WITHOUT `.whereNull('deleted_at')` — returns deleted rows | 27 high-confidence + 13 advisory | Primary finding |
| **Mode B** — `.whereNull('deleted_at')` on an exempt table — runtime crash | **0** | Previously-fixed Mode-B sites confirmed clean |

**CLAUDE.md exempt list cross-check:** MATCHES schema snapshot exactly — no drift.

## Top Mode A clusters

| File | Hits | Context |
|---|---:|---|
| `apps/api/src/mcp/server/mcpServer.ts` | 14 | Agent-tool queries — LLM summarises deleted rows into clinician output |
| `apps/api/src/integrations/fhir/fhirRoutes.ts` | 5 | FHIR external surface leaks tombstones to integration partners |
| `apps/api/src/features/patients/patientRoutes.ts` | 4 | `:312,326,347,670` — notes + patient + list surfaces |
| `apps/api/src/mcp/scribeEnhancements.ts` | 1 | `:681` — prior-note context for scribe |
| `apps/api/src/features/documents/documentService.ts` | 1 | `:129` — legal_orders for tribunal docs |
| `apps/api/src/features/contacts/contactRecordRoutes.ts` | 1 | `:60` — unified ABF contact feed (clinical_notes) |

## Exact file:line list — Mode A high-confidence

### mcpServer.ts (14)
- `:205` — patient_medications
- `:265, 281, 287, 300, 306, 343, 347, 361, 451, 459` — episodes
- `:289, 302, 482` — patient_medications
- `:322` — staff
- `:344` — appointments

### fhirRoutes.ts (5)
- `:74` — patients detail
- `:100` — diagnoses
- `:123` — patient_medications
- `:309` — staff
- `:321` — clinics

### patientRoutes.ts (4)
- `:312, 326` — clinical_notes
- `:347` — patients
- `:670` — clinical_notes list

## Previously-fixed Mode B sites (clean)

Inline comments confirm fixes in:
- `voiceRepository.ts:32`
- `contactRecordRoutes.ts:303`
- `advanceDirectiveRoutes.ts:40`
- `safetyPlanRoutes.ts:18`

## Surprise

Biggest hotspot is the MCP agent layer — 14 hits in one file. The MCP "agent tools" code was added more recently and did NOT inherit the repository discipline used by `patientRepository.ts` / `staffRepository.ts` / `clinicalNote.repository.ts` (all correct). Second-biggest: FHIR external API has 5 hits — tombstone leakage to integration partners.

## Related BUGs

- **BUG-434** (new) — MCP server soft-delete filter family (14 sites in `mcpServer.ts`)
- **BUG-435** (new) — FHIR surface tombstone leakage (5 sites in `fhirRoutes.ts`) — ADHA conformance-relevant
- **BUG-436** (new) — patientRoutes soft-delete family (4 sites)
- **BUG-388** (first audit) — CI guard `check-soft-delete-filter.ts` becomes the Layer-2 prevention for future regressions
