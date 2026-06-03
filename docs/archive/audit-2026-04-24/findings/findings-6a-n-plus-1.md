# Findings 6a — N+1 / loop-with-await patterns

**Agent:** E-n-plus-1
**Scope:** `apps/api/src/**/*.ts` + `apps/web/src/**/*.{ts,tsx}`. Tests/seeds/migrations excluded.

## Summary

| Classification | Count |
|---|---:|
| `[HOT]` | 11 |
| `[PARALLEL]` (unbounded fan-out risk) | 10 |
| `[FOR_EACH_BUG]` (`.forEach(async …)`) | **0** |
| `[COLD]` (bounded by config / enum) | 19+ |

**Zero `forEach(async …)` bugs.** The `check-no-fire-and-forget` Layer-2 guard held. Maturity evidence.

## `[HOT]` findings

| # | File:line | Iterable | Per-iter call |
|---|---|---|---|
| HOT-1 | `apps/api/src/features/billing/billingService.ts:174-180` | rows from `findInvoicesByPatient` | `billingRepo.getInvoiceWithItems` per invoice |
| HOT-2 | `apps/api/src/features/referrals/referralService.ts:365-371` | rows from `list` | `referralRepository.listAttachments` per row |
| HOT-3 | `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:812-816` | planned_transitions rows | `db('planned_transition_assignments').count` per row |
| HOT-4 | `apps/api/src/features/patients/patientRoutes.ts:814-820` | legal-order rows on GET | per-row UPDATE `.status='expired'` |
| HOT-5 | `apps/api/src/integrations/cmi/cmiDataExtractor.ts:75-96` | episodes (bulk-export scale) | `db('patient_legal_orders').where({patient_id})` |
| HOT-6 | `apps/api/src/features/clinical-decision/clinicalDecisionRoutes.ts:77-98` | rules × medications | `db('pathology_results').whereRaw(ILIKE)` |
| HOT-7 | `apps/api/src/jobs/schedulers/referralSlaScheduler.ts:29-65, 72-110` | all referrals | `listPendingOfferStaffIds` + `getPatientName` + `notifyStaff` (nested) |
| HOT-8 | `apps/api/src/jobs/schedulers/appointmentReminderScheduler.ts:27-29` | upcoming appointments | `settingsService.getThresholds(appt.clinic_id)` per appt |
| HOT-9 | `apps/api/src/mcp/server/mcpServer.ts:291,350,371` | team patients / staff patients | `resolveStaffName` + `resolveTeamName` per row |
| HOT-10 | `apps/api/src/mcp/server/mcpServer.ts:504,508` | highRiskRows + unassessedIds | `resolvePatientName` per row |
| HOT-11 | `apps/api/src/features/correspondence/correspondenceService.ts:180-210` | `dto.recipientProviderIds` | 2 queries per ID |

## `[PARALLEL]` (bounded / unbounded — fan-out risk)

| File:line | Concern |
|---|---|
| `patientRoutes.ts:460-462` | attachments — UNBOUNDED, N S3 signed-URL RPCs per GET |
| `patientRoutes.ts:636-647` | pathology — UNBOUNDED, same shape |
| `patient-app/patientAppRoutes.ts:1215-1227` | docs sync — cap 200 but still 200 signed-URL calls per sync |
| `billingService.ts:174-180` | duplicate of HOT-1 |
| `correspondenceService.ts:180-210` | duplicate of HOT-11 |
| `mcpServer.ts:291,310,350,371,504,508` | 6 resolver-driven N+1 sites |
| `EditPatientWizard.tsx:593-615, 622-626` | contacts + providers DELETE+POST storm (small iterables but N round-trips) |

## `[COLD]` (bounded, low priority)

- `features/provisioning/provisioningService.ts:225,240,256,275,282,297,316,334,406` — 9 seed-array loops (one-time per clinic)
- `features/beds/bedRoutes.ts:126-135` — bulk-create loop, should use `insert(array)`
- `features/billing/billingRepository.ts:427-433` — invoice line items, bulk-insert candidate
- `features/messaging/messageRepository.ts:128-135` — participants, bulk-insert candidate
- `features/group-therapy/groupTherapyRoutes.ts:152-166` — attendance upsert, bulk-upsert candidate
- `features/workflows/workflowEngine.ts:205-220,245-260` — sequential by design
- Various MDT task / role-assignment loops (≤~10 iterations)

## Per-feature heatmap

| Feature | HOT | PARALLEL | COLD |
|---|---:|---:|---:|
| `mcp/server/mcpServer.ts` | 2 | 6 | 0 |
| `features/patients/patientRoutes.ts` | 1 | 2 | 2 |
| `features/billing/` | 1 | 1 | 1 |
| `features/referrals/` | 1 | 0 | 1 |
| `features/staff-settings/` | 1 | 0 | 3 |
| `jobs/schedulers/` | 2 | 0 | 0 |
| `integrations/cmi/` | 1 | 0 | 0 |
| `features/clinical-decision/` | 1 | 0 | 0 |
| `features/correspondence/` | 1 | 1 | 0 |
| `features/patient-app/` | 0 | 1 | 0 |
| `features/provisioning/` | 0 | 0 | 9 |

## Related BUGs

- **BUG-383** (first audit) — N+1 attachment query — covers HOT-4-like pattern in alerts
- **BUG-384** (first audit) — pathology `Promise.all` over-fetch — covers PARALLEL on `patientRoutes.ts:636`
- **BUG-431** (new) — MCP server resolver N+1 family (HOT-9/10 + 6 PARALLEL sites in `mcpServer.ts`); refactor to JOIN-based lookup
- **BUG-432** (new) — Billing + referrals service N+1 (HOT-1/2)
- **BUG-433** (new) — Scheduler jobs N+1 (HOT-7/8)
