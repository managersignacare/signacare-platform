# Findings 6b — Shared Zod schema drift

**Agent:** F-shared-types
**Scope:** 306 Zod schema exports across 61 files under `packages/shared/src/`. 13 shipment-critical schema surfaces audited in depth.

## Summary

| Tag | Count |
|---|---:|
| `[MATCH]` (Patient, Prescription, PathologyOrder, Letter, Referral — modulo minor gaps) | 5 |
| `[EXTRA]` backend fabricates / adds fields not in schema | 6 raw-row routes + AppointmentService |
| `[MISSING]` schema demands fields backend doesn't return | 2 critical (Medication, LlmInteraction) |
| `[ENUM_DRIFT]` | 6 distinct drifts |

## [EXTRA] — backend leaks beyond shared schema

| Schema | Backend file:line | Extra / fabricated |
|---|---|---|
| `AppointmentResponse` | `features/appointments/appointmentService.ts:65` | Hardcodes `reminderScheduled:false, reminderSent:false, reminderSentAt:null, rescheduledFromId:null, outlookEventId:null, telehealthProvider:null, telehealthPasscode:null` — these DB columns don't exist |
| `MedicationResponse` | `features/medications/medicationService.ts:10-36` | **Backend REDECLARES its own interface** — ignores shared schema entirely |
| `EpisodeResponse` | `features/episode/episodeService.ts:25` | `createdById` mismapped; `title`/`summary` duplicated from same column |
| Raw-row `res.json({…})` | `features/patients/patientRoutes.ts:790, 864, 992, 1109, 1212, 1332` | snake_case Knex rows unmapped — §5.1 violation |

## [MISSING] — schema demands, backend doesn't provide

- **`MedicationResponseSchema`** demands `drugProductId, drugCode, brandName, instructions, startDate, endDate, reasonForCessation, isRegular, isPrn, taperSchedule, source, prescribedByStaffId, notes`. Backend provides **none** — returns different shape. Any frontend using shared type crashes.
- **`LlmInteractionResponseSchema`** has NO backend emitter. `/llm/suggest` returns only `LlmSuggestionResponseSchema`.
- **`PatientResponseSchema.emrNumber`** required non-null — legacy rows with NULL `emr_number` crash Zod.
- **`PrescriptionResponseSchema.prescribedDate`** non-null — backend does `r.prescribed_date` with no null-guard.

## [ENUM_DRIFT]

| Rank | Schema pair | Canonical (shared) | Actual |
|---|---|---|---|
| **CRITICAL** | `LlmFeature` vs frontend `LLMSuggestionType` | `ambient_note, suggestion, summarisation, risk_flag, coding_assist, other` | `soap_note, clinical_summary, referral_letter, risk_analysis, medication_review, discharge_summary, care_plan` — **zero overlap** |
| HIGH | `NoteType` dual schemas | open `z.string().max(50)` in one file, 14-value enum in another | Two shared schemas disagree |
| HIGH | `EpisodeType` | Shared open `z.string()`. Frontend: 7-value enum. DB emits `triage, intake, mst, cct, parc, ccu, ipu, residential, consultation` | none in frontend enum |
| MED | `NoteStatus` | `['draft','signed']` | Inline has `['draft','signed','addendum']` |
| MED | `PathologyOrderResponseSchema.status` | `pending, sent, partial, complete, cancelled` | Frontend `LabOrderStatusSchema`: `pending, collected, in_transit, resulted, partial, cancelled` |
| LOW | `PrescriptionStatusEnum` | includes `locked` | No frontend handling for `locked` |

## Frontend re-declaration violations (§5.1)

| File:line | Interface | Notes |
|---|---|---|
| `features/medications/medicationService.ts:10` | `MedicationResponse` | **BACKEND** duplicates shared schema — critical |
| `apps/web/src/features/pathology/types/pathologyTypes.ts:36, 79` | `LabOrderResponseSchema`, `LabResultResponseSchema` | Header comment self-admits drift |
| `apps/web/src/features/llm/types/llmTypes.ts:71` | `LLMInteractionSchema` | Total field/enum drift |
| `apps/web/src/features/episodes/types/episodeTypes.ts:30` | `Episode` | Adds `referralId, keyClinicianId, caseManagerId, deletedAt` not in shared |
| `apps/web/src/features/clinical-notes/types/noteTypes.ts:43` | `NoteResponse` | No shared equivalent |
| `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:38` | `Episode` inline | Half-duplicate |
| `apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:55` | `Appointment` inline | JOIN-aliased fields |
| `apps/web/src/features/appointments/pages/AppointmentsPage.tsx:37` | `Appointment` inline | Second inline redup |
| `apps/web/src/features/patients/components/detail/tabs/LegalTab.tsx:18` | `LegalOrder` | NO shared `LegalOrderResponseSchema` exists |
| `apps/web/src/features/patients/components/notes/NotesList.tsx:19` | `Note` inline | Third note-shape surface |
| `apps/web/src/features/referrals/pages/ReferralsPage.tsx:50` | `Referral` inline | ~12 of 40 fields |
| `apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:22` | `AlertType` | No shared schema |
| `apps/web/src/features/patients/services/patientApi.ts:45` | `PatientContact` | No shared schema |

## Worst-case ENUM_DRIFT

`apps/web/src/features/llm/types/llmTypes.ts:71` `LLMInteractionSchema.interactionType` uses 7 values with **zero overlap** with shared `LlmFeatureSchema`'s 6 values. Field names also drift: `modelUsed/tokensInput/tokensOutput` vs shared `modelName/promptTokens/completionTokens`. Any frontend parsing a backend response against `LlmInteractionResponseSchema` Zod-fails.

## Known-bug-source redeclarations

1. `features/medications/medicationService.ts:10` — the BACKEND redeclares `MedicationResponse`. Neither frontend nor backend uses shared `MedicationResponseSchema` → shared contract is dead. Phase R3 comments (L40-44) document `isClozapine, isS8, laiFrequency, laiNextDue, laiLastAdmin, prescriber` returned as computed defaults / hardcoded nulls.
2. `apps/web/src/features/pathology/types/pathologyTypes.ts` — entire `LabOrder*`/`LabResult*` family shadows shared `Pathology*`; header comment self-admits.
3. Six inline interfaces (`EpisodesTab, AppointmentsTab, AppointmentsPage, ReferralsPage, LegalTab, NotesList`) shaped to backend JOIN-aliased raw-row returns. `check-no-duplicate-api-types.sh` missed them because it only scans `types/` directories.

## Related BUGs

- **BUG-456 (S1)** (new) — Medication backend/frontend schema alignment: wire `MedicationResponseSchema` at both ends; stop backend redeclaration
- **BUG-457 (S1)** (new) — LlmFeature / LLMInteraction enum drift — zero overlap between schema and actual type values
- **BUG-458 (S1)** (new) — Appointment service fabricated null/false fields for non-existent DB columns
- **BUG-459 (S2)** (new) — patientRoutes raw-row `res.json({…})` at 6 endpoints — map to camelCase responses per §5.1
- **BUG-460 (S2)** (new) — extend `check-no-duplicate-api-types.sh` to scan inline `interface X` / `type X` declarations in tsx files, not just `types/` directories
- **BUG-461 (S2)** (new) — create shared `LegalOrderResponseSchema` (currently absent)
- **BUG-462 (S3)** (new) — NoteType / EpisodeType / NoteStatus / PathologyStatus enum reconciliation
