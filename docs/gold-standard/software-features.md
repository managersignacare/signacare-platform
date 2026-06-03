# 01 — Software Features

**Last refreshed:** 2026-05-29 (full refresh — supersedes 2026-04-14 baseline; reflects 2026-05-28 S0 closure wave, d10 repo-hygiene cluster, PART 13 UI/theme/font work, eRx maturity wave, PHI architecture hardening, and scribe-25 non-diagnostic posture).

Clinical and operational feature inventory for Signacare EMR. Every capability listed maps to a backend domain under [apps/api/src/features/](../../apps/api/src/features/), a frontend surface under `apps/web/src/features/`, and where relevant a mobile screen under `apps/mobile/lib/features/` (Sara clinician) or `apps/patient-app/lib/features/` (Viva patient).

Legend: ✅ shipped · 🟡 partial · ⚠️ deferred with explicit reason · ❌ out of scope.

---

## 1. Patient record & demographics

| Capability | Status | Where |
|---|---|---|
| Patient CRUD + fuzzy duplicate detection | ✅ | [patients/](../../apps/api/src/features/patients/) — `DUPLICATE_PATIENT` 409 contract |
| **Strict registration validation** (DOB/phone/Medicare schemas; BUG-WF31) | ✅ in code; staging replay remaining | `bugWf31RegistrationValidation.int.test.ts` + `patient.schemas.test.ts` |
| EMR number (configurable prefix per clinic) | ✅ | [patients/](../../apps/api/src/features/patients/) |
| Multi-tenant search (FTS + fallback) | ✅ | `patientRepository.ts` — `search_tsv` GIN + ILIKE fallback |
| Patient timeline | ✅ | [roleFeatureRoutes.ts](../../apps/api/src/features/roles/roleFeatureRoutes.ts) |
| Privacy / masked demographics | ✅ | `patients_masked` view |
| Proxy access (carer / guardian) | ✅ | [carers/](../../apps/api/src/features/carers/) |
| Patient SMS consent + mobile number | ✅ | `patients.sms_consent` |
| Patient-initiated sync preferences (Viva) | ✅ | `patient_sync_preferences` |
| Bulk patient CSV import | ✅ | [patientImportAdapter.ts](../../apps/api/src/features/imports/adapters/patientImportAdapter.ts) — delegates to `patientService.create` so every row goes through duplicate detection + PHI encryption + blind indexes |
| **Strict prescriber HPI-I gate** (no NULL + no WARN bypass; BUG-WF81-HPII-MISSING) | ✅ fixed | `hpiiValidation.int.test.ts` + clozapine extension |

## 2. Episodes of care

| Capability | Status | Where |
|---|---|---|
| Episode CRUD + state machine (open → closed) | ✅ | [episode/](../../apps/api/src/features/episode/) |
| One open episode per specialty per patient | ✅ | Partial unique index on (`patient_id`, `type`) where `status='open'` |
| Episode-per-specialty model | ✅ | `episodes.specialty` column — 7 specialties |
| Episode reopen gate (HAZARD-007) | ✅ | [episodeStateMachine.test.ts](../../apps/api/tests/integration/episodeStateMachine.test.ts) |

## 3. Clinical documentation

| Capability | Status | Where |
|---|---|---|
| Clinical notes CRUD with `lock_version` optimistic concurrency | ✅ | [clinical-notes/](../../apps/api/src/features/clinical-notes/) |
| Note amendment chain (append-only) | ✅ | `amended_from_id` + `NoteType='amended'` |
| **Signed-note content hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) | ✅ in code; staging tamper drill remaining | `compute_note_hash` trigger |
| Sign-off workflow | ✅ | `sign` + `amend` routes |
| **AI-draft sign attestation safety-locked** (no runtime bypass; BUG-WF51-ATTESTATION-BYPASS) | ✅ fixed | `bug417AiDraftSignAttestation.int.test.ts` + utility guard tests |
| Bulk clinical-notes CSV import | ✅ | [clinicalNoteImportAdapter.ts](../../apps/api/src/features/imports/adapters/clinicalNoteImportAdapter.ts) |
| Document cache (Viva offline) | ✅ | [document_cache.dart](../../apps/patient-app/lib/core/services/document_cache.dart) |
| SOAP template + clinical template store | ✅ | [templates/](../../apps/api/src/features/templates/) |

## 4. Medications & prescribing

| Capability | Status | Where |
|---|---|---|
| Patient medication list (CRUD + cease + categorisation) | ✅ | [medications/](../../apps/api/src/features/medications/) |
| Contraindication screen before INSERT | ✅ | `medicationService.create` |
| **Web medication-status union pinned to enum parity** (BUG-ARCH-MEDICATION-STATUS-ENUM-DRIFT) | ✅ in code; cross-surface runtime replay remaining | unit tests + Zod schema |
| LAI schedule + `recordGiven` flow (HAZARD-003, HAZARD-013) | ✅ — LAI transaction race fixed | [lai/](../../apps/api/src/features/lai/) — `recordGiven` wraps `forUpdate` + writes in `db.transaction` |
| Clozapine titration + ANC classifier (HAZARD-002, HAZARD-014) | ✅ — upsert cross-clinic defence-in-depth | [clozapine/](../../apps/api/src/features/clozapine/) |
| Prescription (eRx) with ETP2 SMS token | ✅ | [prescriptions/](../../apps/api/src/features/prescriptions/) + [integrations/escript/](../../apps/api/src/integrations/escript/) |
| **NPDS payload sign + encrypt modes** (RSA-SHA256 + AES-256-GCM; BUG-WF81-NPDS-PAYLOAD-ENCRYPTION) | ✅ in code; staging partner validation remaining | conformance tests T7/T8 |
| **NPDS retry + backoff** (BUG-ARCH-NPDS-SUBMIT-RETRY) | ✅ in code; fault-injection evidence remaining | `NPDS_SUBMIT_MAX_ATTEMPTS` env |
| **PBS authority fail-closed in create + submit** (BUG-WF81-PBS-AUTHORITY-MISSING) | ✅ in code; staging replay + backfill audit remaining | `prescription.schemas.test.ts` + `bugP5IhiStatusPrescribeGate.int.test.ts` |
| **MySL/ASLR write path** (BUG-WF81-ASLR-READONLY) | ✅ in code; staging replay + runbook remaining | `syncMedicationRequestFromPrescription` + `myslMedicationSync.test.ts` |
| **ADHA eRx conformance suite 60/60 local pass** (BUG-344) | ✅ in code; ADHA sandbox canary + burn-in remaining | `erxConformanceA5.test.ts` |
| **End-of-prescription redaction contract** (BUG-P1) | ✅ in code; token-delivery canary remaining | `bugP1EopRedaction.test.ts` + `guard:eop-redaction` |
| Bulk LAI CSV import | ✅ | [laiImportAdapter.ts](../../apps/api/src/features/imports/adapters/laiImportAdapter.ts) |
| Bulk Clozapine CSV import | ✅ | [clozapineImportAdapter.ts](../../apps/api/src/features/imports/adapters/clozapineImportAdapter.ts) |
| Taper schedule monotonic guard (HAZARD-011) | ✅ | `validateTaperSchedule` |
| Medication reconciliation | ✅ | [internal-medicine/medRecRepository.ts](../../apps/api/src/features/internal-medicine/medRecRepository.ts) |

## 5. Mental Health clinical workflow

| Capability | Status | Where |
|---|---|---|
| MHA / legal orders + expiry scheduler + review dates | ✅ | [mha/](../../apps/api/src/features/mha/) + [mhaExpiryScheduler.ts](../../apps/api/src/jobs/schedulers/mhaExpiryScheduler.ts) |
| Bulk MHA CSV import | ✅ | [mhaImportAdapter.ts](../../apps/api/src/features/imports/adapters/mhaImportAdapter.ts) |
| Risk assessments | ✅ | [risk/](../../apps/api/src/features/risk/) |
| Safety plans (Stanley-Brown 6-element) | ✅ | [safety-plan/](../../apps/api/src/features/safety-plan/) |
| **Safety-plan collaboration attestation gate** (BUG-SCRIBE25-002) | ✅ in code; staging role-matrix/UAT remaining | `bugScribe25SafetyPlanAttestation.int.test.ts` |
| Advance directives | ✅ | [advance-directives/](../../apps/api/src/features/advance-directives/) |
| 91-day clinical review | ✅ | [clinical-review/](../../apps/api/src/features/clinical-review/) |
| Treatment pathways / psychology | ✅ | [treatment-pathways/](../../apps/api/src/features/treatment-pathways/) |
| Inpatient care + ECT + TMS | ✅ | [roleFeatureRoutes.ts](../../apps/api/src/features/roles/roleFeatureRoutes.ts) |
| Group therapy | ✅ | [group-therapy/](../../apps/api/src/features/group-therapy/) |
| **PHQ-9 Q9 / total ≥20 suicide-risk auto-escalation** (BUG-WF52-SUICIDE-ALERT-MISSING) | ✅ fixed | `assessmentRisk.test.ts` + `bugWf52AssessmentSuicideRiskEscalation.int.test.ts` |
| **Server-side assessment scoring** (anti-spoof; BUG-WF52-SCORING-CALCULATOR-MISSING) | ✅ in code; extend across all instruments + staging replay remaining | same |

## 6. Multi-specialty modules

| Specialty | Status | Feature coverage |
|---|---|---|
| Mental Health (baseline) | ✅ | LAI, clozapine, MHA, risk, safety plans, 91-day review, pathways, inpatient, ECT/TMS, group therapy |
| Internal Medicine | ✅ | Problem list (FHIR Condition), med rec, chronic disease register |
| Endocrinology | ✅ | Glucose readings + TIR, insulin regimens, HbA1c trend |
| Paediatrics | ✅ | Growth measurements (WHO / CDC LMS), CVX immunizations, developmental milestones, weight-based dosing |
| Obstetrics & Gynaecology | ✅ | Pregnancies + GTPAL, antenatal visits, partograms, Naegele EDD calculator |
| Surgery | ✅ | Surgical cases, WHO 3-phase checklist (enforced at repository), op notes, PACU records |
| **Oncology (Phase 8, mCODE-aligned)** | ⚠️ **DEFERRED** | Specialty enum + seed migration scaffolding; no clinical tables yet. Planned resources: PrimaryCancerCondition, TNMStageGroup, ECOGPerformanceStatus, CancerTreatmentPlan, ChemoCycle, TumourBoardDecision |

### Specialty visibility gate

Every specialty tab renders through `useModuleVisibility` — the intersection of `clinic.enabled_specialties ∩ staff.specialties ∩ patient.active_episodes`. Every tab id in `PATIENT_TABS` has a matching entry in [moduleRegistry.ts](../../packages/shared/src/moduleRegistry.ts). 34 of 34. **Fail-CLOSED on isError** (BUG-416 anchor pinned).

## 7. Pathology, imaging & attachments

| Capability | Status | Where |
|---|---|---|
| Pathology report ingestion (HL7 ORU^R01) | ✅ | [pathology/](../../apps/api/src/features/pathology/) |
| Patient attachments with pre-signed download URLs | ✅ | [patient_attachments](../../apps/api/migrations/20260401000000_v2_baseline.ts) |
| S3 blob storage | ✅ | [blobStorage.ts](../../apps/api/src/shared/blobStorage.ts) |
| OCR adapter (ocrmypdf / pdftotext / tesseract) with shared binary resolver | ✅ | [ocrAdapter.ts](../../apps/api/src/ocr/ocrAdapter.ts) |
| **Referral upload MIME allowlist + signature + AV policy** (BUG-WF71-UPLOAD-MIME-VALIDATION) | ✅ in code; staging AV-required mode replay remaining | `bugWf71ReferralAttachmentSafety.int.test.ts` |

## 8. Referrals & re-allocations

| Capability | Status | Where |
|---|---|---|
| eReferral (ServiceRequest + Task split) | ✅ | [referrals/](../../apps/api/src/features/referrals/) |
| Referral coordinator queue + auto-degrade for solo clinics | ✅ | [referralRoutes.ts](../../apps/api/src/features/referrals/referralRoutes.ts) |
| SLA scheduler with tiered reminders | ✅ | [referralSlaScheduler.ts](../../apps/api/src/jobs/schedulers/referralSlaScheduler.ts) |
| **1-hour intake acknowledgement** (BUG-WF71-ACK-EMAIL-MISSING) | ✅ in code; staging mail-channel telemetry remaining | `bugWf71ReferralAckEmail.int.test.ts` + SLA scheduler backfill |
| **12-month expiry path active in scheduler** (BUG-WF71-EXPIRY-SCHEDULER-MISSING) | ✅ in code; staging cron-tick replay remaining | `bugWf71ReferralExpiryScheduler.int.test.ts` |
| **Clinic-scoped patient-match hardening** (BUG-WF71-PATIENT-MATCH-NAIVE) | ✅ in code; staging UAT remaining | rejects cross-clinic patientId + blocks demographic quick-register on duplicate candidates |
| Patient care-team re-allocation approval workflow | ✅ | [reallocations/](../../apps/api/src/features/reallocations/) — manager / team-leader two-step + four-eyes self-approval block |
| **Bulk reassignment transaction + four-eyes guard** (BUG-SA-003) | ✅ in code; staging canary + rollback drill remaining | `applyPatientAllocationMutation` + `bugBulkPlannedReallocationAssignmentPath.int.test.ts` |
| **Assignment-drift reconciliation tooling** (BUG-SA-006) | ✅ fixed | `apps/api/scripts/reconcile-assignment-drift.ts` + operator runbook |

## 9. Scheduling & tasks

| Capability | Status | Where |
|---|---|---|
| Appointments (with waitlist, reminders, telehealth URL field) | ✅ | [appointments/](../../apps/api/src/features/appointments/) |
| **DB unique active-slot index** (BUG-WF41-SLOT-RACE) | ✅ fixed | `appointmentSlotUniqueness.int.test.ts` |
| **Deterministic reminder job-key idempotency** (BUG-WF41-REMINDER-TX-ORDER) | ✅ in code; tenant-context replay under FORCE RLS remaining | `bugWf41ReminderTxOrder.int.test.ts` |
| **Booking-created clinician notification** (BUG-WF41-CLINICIAN-NOTIFY-MISSING) | ✅ in code; staging fan-out parity remaining | `appointmentCreateClinicianNotification.int.test.ts` |
| **Cancel-path queue cleanup for email + outreach** (BUG-WF42-CANCEL-CLEANUP-MISSING) | ✅ fixed | `appointmentCancelReminderCleanup.int.test.ts` |
| **check_in_at + checked_in_by_id persistence** (BUG-WF43-CHECK-IN-COLUMN-MISSING) | ✅ in code; staging replay remaining | `bugWf43CheckInPersistence.int.test.ts` |
| **Outstanding-items aggregation endpoint** (BUG-WF43-ITEMS-AGGREGATION-MISSING) | ✅ in code; staging board-parity remaining | `GET /appointments/:id/check-in-outstanding` |
| Bed board | ✅ | [beds/](../../apps/api/src/features/beds/) |
| Task management | ✅ | [tasks/](../../apps/api/src/features/tasks/) |
| Appointment reminder scheduler (patient-outreach queue) | ✅ | [appointmentReminderScheduler.ts](../../apps/api/src/jobs/schedulers/appointmentReminderScheduler.ts) |
| **Telehealth video (WebRTC)** | ⚠️ **DEFERRED** — `telehealth_url` + `telehealth_provider` columns exist; no native WebRTC signalling. Deployments link out to Jitsi / a hospital's existing provider |

## 10. Patient surround — communications

| Capability | Status | Where |
|---|---|---|
| Notification centre — durable `notifications` table + live SSE + unread bell + per-user scoping + dedupe | ✅ | [notifications/](../../apps/api/src/features/notifications/) |
| **Email worker (non-stub) + dispatch unit tests** (BUG-WF42-EMAIL-WORKER-STUB) | ✅ fixed | `emailWorkerService.ts` + `emailWorkerService.test.ts` |
| **Password-reset request/confirm routes + token table** (BUG-WF22-PWD-RESET-MISSING) | ✅ fixed | `passwordResetFlow.int.test.ts` |
| **Receipt / invoice email dispatch via email worker** (BUG-WF61-RECEIPT-EMAIL-MISSING) | ✅ fixed | `billingServiceReceiptEmail.test.ts` + `bugWf61ReceiptEmail.int.test.ts` |
| SMS removal from staff surfaces + `no-telecom` CI guard | ✅ | [check-no-telecom.sh](../../.github/scripts/check-no-telecom.sh) |
| Mobile delta sync `/api/v1/mobile/sync?since=…` for Sara + Viva | ✅ | [mobile-sync/](../../apps/api/src/features/mobile-sync/) |
| FCM + Flutter sync client + document cache + on-device reminders + per-module opt-in | ✅ | [fcm/](../../apps/api/src/integrations/fcm/), [sync_client.dart](../../apps/patient-app/lib/core/services/sync_client.dart) |
| Patient outreach dispatcher — FCM first, ACS SMS fallback, consent gate, clinician override, monthly budget, critical-alert fan-out | ✅ | [patient-outreach/](../../apps/api/src/features/patient-outreach/) |
| **Patient-outreach worker tenant context** (BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT) | ✅ in code; controlled drain/replay remaining | `bugWf42OutreachWorkerTenantContext.int.test.ts` |
| Messaging (inter-staff) | ✅ | [messaging/](../../apps/api/src/features/messaging/) |
| Correspondence (patient letters, audit-logged "Send Patient Message") | ✅ | [correspondence/](../../apps/api/src/features/correspondence/) |
| Viva consent flow — first-launch module opt-in + Sync Settings | ✅ | [sync_settings_screen.dart](../../apps/patient-app/lib/features/sync/sync_settings_screen.dart) |
| **Patient-app login + activation rate limiting** (BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT + ACTIVATION-ATTEMPT-CAP) | ✅ fixed | `rateLimiting.test.ts` L4/L5b/L5c |

## 11. Ambient AI Scribe

| Capability | Status | Where |
|---|---|---|
| 3-pass non-inferential pipeline (transcribe → structure → safety gate) | ✅ | [docs/gold-standard/ai-scribe.md](ai-scribe.md) |
| **Non-diagnostic risk-surfacing posture** (BUG-SCRIBE25-001) | ✅ in code; UAT + governance sign-off remaining | `responseGuard.ts` + `responseGuard.test.ts` |
| **Consent revoke mid-stream fail-closed** (BUG-WF51-CONSENT-REVOKE-RACE) | ✅ fixed | `ambientNoteConsentGate.int.test.ts` (re-checks at post-upload + post-processing) |
| Audio retention scheduler (30 days default) | ✅ | [audioRetentionScheduler.ts](../../apps/api/src/jobs/schedulers/audioRetentionScheduler.ts) |
| PHI redaction before LLM (Pass 1) | ✅ | `pii_redactor.ts` |
| Model-version lock | ✅ | `ollamaModelRegistry.ts` |
| Hallucination detector (HAZARD-010) | ✅ | `detectScribeHallucinations` |

## 12. Reports & BI

| Capability | Status | Where |
|---|---|---|
| Pre-built operational reports (LAI overdue, clozapine flags, MHA expiring) | ✅ | [reports/](../../apps/api/src/features/reports/) |
| Clinical list views (LAI, clozapine, MHA, 91-day, hot spots, admission waitlist) | ✅ | [list/](../../apps/web/src/features/list/) |
| **Worker failure observability + DLQ retention guard** (BUG-SA-008) | ✅ fixed | `guard:worker-failure-observability` |
| **Compliance BI dashboard** | ⚠️ **DEFERRED** — data SQL-queryable today; no dedicated UI layer |

## 13. Administration

| Capability | Status | Where |
|---|---|---|
| Staff CRUD + invitation + password reset | ✅ | [staff/](../../apps/api/src/features/staff/) |
| **MFA / OTP attempt cap** (BUG-WF21-OTP-CAP-MISSING) | ✅ fixed | `mfaAttemptCap.int.test.ts` |
| **Session-row persisted BEFORE access-token issuance** (BUG-WF21-JWT-GHOST-SESSION) | ✅ in code; concurrent-login replay remaining | authService order-of-operations |
| **Atomic failed-login counter** (BUG-WF21-AUTH-COUNTER-RACE) | ✅ in code; parallel-attempt replay remaining | DB atomic update |
| Staff team assignments + role assignments + clinical roles | ✅ | [staff-settings/](../../apps/api/src/features/staff-settings/) |
| Per-staff module-access matrix (Org Settings → Access Control) | ✅ | [ModuleAccessMatrix.tsx](../../apps/web/src/features/staff-settings/components/ModuleAccessMatrix.tsx) — 36+ modules × staff grid |
| Org units / teams | ✅ | [org-settings/](../../apps/api/src/features/org-settings/) |
| Clinical policies + thresholds | ✅ | [clinical-decision/](../../apps/api/src/features/clinical-decision/) |
| Bulk import pipeline (patients / MHA / LAI / clozapine / clinical notes) | ✅ | [imports/](../../apps/api/src/features/imports/) — dry-run → commit with drift detection |
| **Dashboard role-view + clinic-scoped cache** (BUG-SA-001 + BUG-SA-002) | ✅ fixed | dashboard role-view logic + `dashboardKeys.dashAll(...)` factory |

## 14. UI / theme system (PART 13 — May 2026)

| Capability | Status | Where |
|---|---|---|
| **13 themes WCAG-AA verified** (8 original + 5 PART 13 additions) | ✅ | eucalyptus + warmth + clinicalAaa (AAA) + therapeutic + crisisSafeDark |
| **SEVERITY_COLORS theme-orthogonal** (red means red regardless of theme) | ✅ | terracotta `#B0413E` replaces Material panic-red |
| **Tabular numerals on body1/body2/caption/data variants** | ✅ | eliminates misread on aligned dose/lab columns |
| **Safety-action touch targets 56pt** (escalation/risk-flag/safety-plan/restrictive-intervention) | ✅ | `TOUCH_TARGETS.safetyAction` |
| **Local font bundle for offline-strict clinics** (47 woff2 files, 1.4 MB) | ✅ partial (Latin + 8 small-script Noto Sans); CJK on CDN | `apps/web/public/fonts.css` + `installer/regen-font-bundle.md` |
| **Inter primary face** (operator selection 2026-05-26) | ✅ fixed | Albert Sans removed; closes BUG-FONT-PRIMARY-FACE-DECISION |
| **15 supported scripts** (Latin/Cyrillic/Greek/CJK SC-JP-KR/Arabic/Devanagari/Tamil/Gurmukhi/Bengali/Sinhala/Hebrew/Thai) | ✅ fixed | `guard:font-coverage` PASS |
| **Cross-language design token codegen** (TS → Dart for Sara + Viva) | ✅ fixed | closes BUG-CROSS-LANG-DESIGN-TOKEN-CODEGEN |

## 15. Mobile apps

| App | Platform | Scope | Status |
|---|---|---|---|
| **Sara** (clinician companion) | Flutter iOS + Android | Offline write queue (sqflite) + notification bell + FCM push + design-token-driven theme | ✅ |
| **Viva** (patient companion) | Flutter iOS + Android | Appointments, messages, documents, notifications, reminders + per-module sync opt-in + FCM push + design-token-driven theme + safety-plan editor | ✅ |

---

## Deferred items (explicit — tracked in [docs/quality/bugs-remaining.md](../quality/bugs-remaining.md))

| Item | Why deferred | Blocker |
|---|---|---|
| **Oncology Phase 8 (mCODE)** | Out of scope for MH-focused v1 product | Design + clinical validation |
| **Telehealth video (native WebRTC)** | External link-out works for v1; native integration is year-2 | Vendor choice + signalling infra |
| **Compliance BI dashboard** | Raw data SQL-queryable; UI layer deferred | UX scope + BI tool selection |
| **Pharmacy dispense callback flow** (BUG-WF81-DISPENSE-FLOW-MISSING) | NPDS dispense steps 23-31 | Specification + partner |
| **CJK glyph subset pipeline** (BUG-FONT-BUNDLING-CJK-SUBSET-TOOLING) | Full CJK woff2 sets ~10-15 MB each; need corpus-driven subset | Glyph corpus + pyftsubset/glyphhanger pipeline |
| **External pentest report** | Engineering ready; budget not committed | CEO budget approval |
| **ISO 27001 ISMS certification** | Year-2 roadmap | CEO + external auditor engagement |
| **Cyber-liability insurance** | Quotes being gathered | CEO signature |
| **Uptime SLA (signed)** | Template drafted | Legal + CEO signature |

---

## Comparison — Feature breadth

| Domain | Signacare | Epic | Oracle Cerner | Best Practice |
|---|---|---|---|---|
| Core EMR (patients, episodes, notes, meds) | ✅ | ✅ | ✅ | ✅ |
| Multi-specialty chassis (6 specialties + MH baseline) | ✅ | ✅ | ✅ | ⚠️ |
| ISO 14971 hazard register integrated with tests | ✅ 14 hazards | ✅ | ✅ | ⚠️ |
| Clinical decision support (contraindication + taper monotonic) | ✅ | ✅ | ✅ | ⚠️ |
| **PHQ-9 Q9 / total ≥20 suicide-risk auto-escalation** | ✅ | ⚠️ vendor config | ⚠️ vendor config | ❌ |
| **Server-side assessment scoring (anti-spoof)** | ✅ | ✅ | ✅ | ⚠️ |
| **Safety-plan collaboration attestation** | ✅ | ⚠️ template-only | ⚠️ template-only | ⚠️ |
| Patient companion app with offline sync + per-module opt-in | ✅ **Viva** | ⚠️ MyChart (subset) | ⚠️ patient portal | ⚠️ |
| Clinician mobile app with offline write queue | ✅ **Sara** | ⚠️ Rover | ⚠️ CareAware | ❌ |
| Notification centre with FCM push + SSE live fan-out | ✅ | ✅ | ✅ | ⚠️ |
| **Email worker (non-stub) + receipt + reset + ack dispatch** | ✅ fixed | ✅ | ✅ | ✅ |
| **AI-draft sign attestation safety-locked** | ✅ | ⚠️ banner only | ⚠️ banner only | ❌ |
| Bulk CSV import pipeline (audit-logged, drift-detected) | ✅ | ✅ | ✅ | ⚠️ |
| Care-team re-allocation with approval workflow + four-eyes | ✅ | ✅ | ✅ | ⚠️ |
| **Assignment-drift reconciliation tooling + runbook** | ✅ unique | ⚠️ vendor-internal | ⚠️ vendor-internal | ❌ |
| Per-staff module-access matrix | ✅ | ✅ | ✅ | ❌ |
| Oncology mCODE profiles | ⚠️ **deferred** | ✅ | ✅ | ❌ |
| Native telehealth video | ⚠️ **deferred** — link-out today | ✅ | ✅ | ⚠️ |
| BI / compliance dashboard | ⚠️ **deferred** — SQL ready | ✅ | ✅ | ⚠️ |
| **MH-specific clozapine + LAI + MHA workflows (RANZCP-aligned)** | ✅ | ⚠️ US-centric | ⚠️ US-centric | ⚠️ |
| **13-theme design system + offline-safe multi-script font bundle** | ✅ unique | ⚠️ branding only | ⚠️ branding only | ⚠️ |
| **eRx maturity: NPDS sign+encrypt + retry + PBS authority + MySL/ASLR** | ✅ in code | ⚠️ via partner | ⚠️ via partner | ✅ |
| **ADHA eRx conformance 60/60 + EoP redaction contract** | ✅ in code | N/A | N/A | ✅ |
| Cross-language design token codegen (TS → Dart) | ✅ | ⚠️ vendor-internal | ⚠️ vendor-internal | ❌ |

**Verdict:** Feature breadth is competitive with Epic / Cerner **in the mental health domain** and **on the multi-specialty chassis** (six specialties shipped with shared primitives). The May-2026 closure wave (S0 hardening + scribe-25 + eRx maturity) brings safety-critical clinical workflow to gold-standard with explicit staging-evidence gates remaining. The Australian-regulatory chassis (NPDS sign + encrypt, PBS authority fail-closed, MySL/ASLR write, ADHA conformance, IHI/DVA encryption, HPI-I strict gate, RANZCP clozapine/LAI/MHA) is distinctly stronger than US-centric Epic/Cerner workflows. The PART 13 UI/theme/font infrastructure (13 themes WCAG-AA, 15 scripts, offline-safe bundle, cross-language token codegen) is unique posture not seen in any of the comparators. Outstanding gaps — oncology, native telehealth, BI dashboards, dispense flow, CJK subset tooling — are each explicitly tracked and non-blocking for a paying tenant.
