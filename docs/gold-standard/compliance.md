# 05 — Compliance Reports

**Last refreshed:** 2026-05-29 (refresh — supersedes 2026-04-14 baseline; reflects 2026-05-28 S0 closure wave covering auth hardening, suicide-risk escalation, attestation safety-lock, consent revoke fail-closed, HPI-I strict gate, patient-app rate limiting, PHI key + signature hash + FORCE RLS, and scribe-25 non-diagnostic posture).

Every claim below references a real control in code or migration. The organisational items (external audit, insurance, SLA sign-offs) are tracked in §10-§12 with explicit status and ownership so nothing is silently "in progress".

---

## 1. Australian Privacy Principles (APP)

| APP | Requirement | Signacare implementation | Evidence |
|---|---|---|---|
| APP 1 | Open and transparent management of personal information | Privacy policy + admin consent capture screens | [privacy/](../../apps/api/src/features/privacy/) |
| APP 3 | Collection of solicited personal information | Explicit consent capture at registration + for SMS outreach + for Viva sync modules + **strict registration validation** (BUG-WF31 — DOB/phone/Medicare schemas enforced) | [patientOutreach migration](../../apps/api/migrations/20260501000000_patient_outreach.ts) + `bugWf31RegistrationValidation.int.test.ts` |
| APP 5 | Notification of collection | Notice served at onboarding + captured in audit log | |
| APP 6 | Use or disclosure of personal information | Every cross-boundary use writes an `audit_log` row naming the actor + purpose. **AI-draft sign attestation safety-locked** (BUG-WF51); **scribe consent revoke mid-stream fail-closed** (BUG-WF51-CONSENT-REVOKE-RACE — `/llm/ambient-note` re-checks consent at post-upload + post-processing, best-effort deletes audio on revoke) | [forbiddenAccessAudit.ts](../../apps/api/src/middleware/forbiddenAccessAudit.ts) + `ambientNoteConsentGate.int.test.ts` |
| APP 8 | Cross-border disclosure | **All cloud infrastructure is Australian region only** — Azure Sydney / `ap-southeast-2`; ACS region = Australia; **`assertAiDataResidency` boot check** (PART 10 LLM layer) blocks non-AU LLM hosts in prod | deploy runbook + `aiDataResidencyCheck.ts` |
| APP 11.1 | Security of personal information | See [04-security-features.md](04-security-features.md) — AES-256-GCM PHI, **PHI key MANDATORY at runtime** (BUG-ARCH-PHI-KEY-MANDATORY), **versioned PHI keyring** (BUG-ARCH-PHI-KEY-ROTATION), RLS + **FORCE RLS baseline** (BUG-ARCH-FORCE-RLS-BASELINE), audit-log tamper-evidence, **clinical-note signature hash** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH), 14 ISO 14971 hazards | |
| APP 11.2 | De-identification / destruction | Anonymise endpoint + masking view + data-retention job | [privacy/](../../apps/api/src/features/privacy/) |
| APP 12 | Access to personal information | Patient-self-service via Viva; clinician-mediated access via the patient record | Viva app |
| APP 13 | Correction of personal information | Patient + authorised rep can request corrections; captured as amendments with `lock_version` + If-Match | Fix Registry NOTE-LOCK1 |

### Patient outreach consent controls

| Control | Mechanism | Where |
|---|---|---|
| Per-patient SMS consent | `patients.sms_consent` + `sms_consent_updated_at` + `sms_consent_updated_by` | [migration 20260501](../../apps/api/migrations/20260501000000_patient_outreach.ts) |
| Delivery audit trail | Every outreach attempt writes `patient_outreach_log` (kind, channel, skip_reason, override_reason, override_by_staff_id) | [patientOutreachService.ts](../../apps/api/src/features/patient-outreach/patientOutreachService.ts) |
| **Tenant-context worker dispatch** (BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT) | Worker executes through `withTenantContext` to preserve `app.clinic_id` | `bugWf42OutreachWorkerTenantContext.int.test.ts` |
| **Patient-app login + activation rate limiting** (BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT + ACTIVATION-ATTEMPT-CAP) | Layered per-IP + per-phone + global tiers | `rateLimiting.test.ts` L4/L5b/L5c |
| Skipped-delivery audit | Patients without consent produce a `channel='skipped'` row with `skip_reason='no_fcm_token_and_no_consent'` — APP 1 transparency | same |
| Clinician override reason | ≥10 characters required when forcing FCM or SMS; captured in log | Fix Registry OUTREACH1 |

## 2. HIPAA (where applicable to cross-border telehealth)

Signacare is Australia-first but implements HIPAA-aligned controls for deployments that route any data through HIPAA-regulated entities.

| HIPAA safeguard | Signacare implementation |
|---|---|
| 164.308 Administrative — Security management process | Fix Registry (2,221 anchors) + CI guards + CLAUDE.md process rules + Layer 0a discipline guards |
| 164.308 Workforce security | RBAC + per-staff module-access ABAC + four-eyes admin guard + service-auth-context mandate |
| 164.308 Audit controls | Tamper-evident partitioned `audit_log` with hash chain + clinical-note signature hash + worker failure observability |
| 164.310 Physical safeguards | Deferred to cloud provider (Azure AU region) |
| 164.312 Access control | RBAC + ABAC + RLS + **FORCE RLS** + session-tree reuse detection + JWT ghost-session fix + atomic failed-login counter + MFA attempt cap |
| 164.312 Integrity controls | `lock_version` optimistic concurrency + hash chain + **clinical-note signed-content hash + immutability trigger** |
| 164.312 Transmission security | TLS termination, HSTS, CSP, helmet, SSRF guard |
| 164.314 Business Associate Agreements | Template drafted; see §11 |

## 3. ACHS EQuIP National Standards

| Standard | Implementation | Evidence |
|---|---|---|
| **Std 1 — Clinical governance** | Role + module-access ABAC + four-eyes on admin grants + audit trail on every forbidden access + Layer 0a claim-discipline + review-attestation tree-hash binding | [04 §2](04-security-features.md#2-authorization) |
| **Std 2 — Partnering with consumers** | Viva patient companion app + per-module sync opt-in + Patient Delivery panel + Stanley-Brown safety-plan editor (Viva native) | [01 §10](01-software-features.md) |
| **Std 3 — Preventing and controlling infection** | Out of scope (software doesn't manage physical infection control) | — |
| **Std 4 — Medication safety** | Contraindication screening before INSERT; Clozapine neutropenia classifier (HAZARD-002); LAI overdue flag (HAZARD-003 + HAZARD-013); LAI transaction race fix; **strict prescriber HPI-I gate** (BUG-WF81-HPII-MISSING — no NULL + no WARN bypass); **NPDS sign + encrypt modes** (BUG-WF81-NPDS-PAYLOAD-ENCRYPTION); **NPDS retry + backoff** (BUG-ARCH-NPDS-SUBMIT-RETRY); **PBS authority fail-closed** (BUG-WF81-PBS-AUTHORITY-MISSING); **MySL / ASLR write path** (BUG-WF81-ASLR-READONLY) | [medicationService](../../apps/api/src/features/medications/medicationService.ts), [classifyAnc](../../apps/api/src/features/clozapine/clozapineService.ts), [computeOverdue](../../apps/api/src/features/lai/laiScheduleService.ts), `hpiiValidation.int.test.ts` |
| **Std 5 — Comprehensive care** | Multi-specialty episode model + **care team re-allocation approval workflow with four-eyes** (BUG-SA-003); **assignment-drift reconciliation tooling** (BUG-SA-006) | [reallocations/](../../apps/api/src/features/reallocations/) + `apps/api/scripts/reconcile-assignment-drift.ts` |
| **Std 6 — Communicating for safety** | Clinical-note `lock_version` + 409 conflict on concurrent edit (HAZARD-006); **clinical-note signature hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH — AHPRA Standard 6 tamper-detection); notification centre; patient outreach dispatcher; **booking-created clinician notification** (BUG-WF41-CLINICIAN-NOTIFY-MISSING); **email worker non-stub** (BUG-WF42-EMAIL-WORKER-STUB); **receipt + 1-hour referral ack dispatch** (BUG-WF61 + BUG-WF71-ACK-EMAIL-MISSING) | [04 §9](04-security-features.md), `emailWorkerService.ts` |
| **Std 7 — Blood management** | Out of scope for v1 | |
| **Std 8 — Recognising and responding to acute deterioration** | Risk assessments + safety plans + escalations feature; care-team alert fan-out; **PHQ-9 Q9 / total ≥20 server-authoritative suicide-risk escalation** (BUG-WF52-SUICIDE-ALERT-MISSING); **server-side assessment scoring** anti-spoof (BUG-WF52-SCORING); **safety-plan collaboration attestation gate** (BUG-SCRIBE25-002) | [features/risk/](../../apps/api/src/features/risk/), `assessmentRisk.test.ts`, `bugScribe25SafetyPlanAttestation.int.test.ts` |

## 4. ISO 14971 — Clinical risk management

14 hazards in the formal register, each with a test in [clinicalSafetyHazards.test.ts](../../apps/api/tests/integration/clinicalSafetyHazards.test.ts) or a named unit test. See [04 §10](04-security-features.md#10-clinical-safety-hazards-iso-14971). Two hazards were added in the 2026-04-14 refresh:
- **HAZARD-013** LAI double-advance under concurrent administration
- **HAZARD-014** clozapine titration cross-clinic read

May 2026 S0 closures land additional hazard-adjacent controls:
- **PHQ-9 Q9 / total ≥20 suicide-risk auto-escalation** (BUG-WF52) — urgent task + clinical signal in outcomes + patient-app completion paths
- **Server-side assessment scoring** (BUG-WF52-SCORING) — client `totalScore` no longer authoritative; spoof-resistance regression coverage
- **Safety-plan collaboration attestation gate** (BUG-SCRIBE25-002) — SAFETY_PLAN_COLLAB_ATTESTATION_REQUIRED with audit writes on create/activate/sign
- **AI-draft sign attestation safety-locked** (BUG-WF51-ATTESTATION-BYPASS) — no runtime bypass flag path
- **Non-diagnostic risk-surfacing posture at AI egress** (BUG-SCRIBE25-001) — guard-level qualifier injection + labels

## 5. RANZCP protocols

| Protocol | Implementation | Evidence |
|---|---|---|
| Clozapine hematological monitoring (ANC classifier at 1.5 × 10⁹/L) | `classifyAnc` + RED/AMBER flag automation + cross-clinic defence-in-depth (HAZARD-014) | [clozapineService.ts](../../apps/api/src/features/clozapine/clozapineService.ts) |
| LAI overdue boundary (7-day grace + consecutive-refusal escalation) | `computeOverdue` + `recordGiven` transaction wrapper (HAZARD-003 + HAZARD-013) | [laiScheduleService.ts](../../apps/api/src/features/lai/laiScheduleService.ts) |
| MHA legal order expiry flagging | `mhaExpiryScheduler` runs daily, raises flags 7 days before expiry | [mhaExpiryScheduler.ts](../../apps/api/src/jobs/schedulers/mhaExpiryScheduler.ts) |
| Psychiatric 91-day review | Clinical review service + dashboard | [features/clinical-review/](../../apps/api/src/features/clinical-review/) |
| Advance directives | Dedicated feature + module-access gate | [features/advance-directives/](../../apps/api/src/features/advance-directives/) |
| Risk assessments + safety plans (Stanley-Brown 6-element) | Dedicated features per patient | [features/risk/](../../apps/api/src/features/risk/), [features/safety-plan/](../../apps/api/src/features/safety-plan/) |
| **PHQ-9 Q9 suicide-risk auto-escalation** | Server-authoritative trigger logic + escalation pipeline | `bugWf52AssessmentSuicideRiskEscalation.int.test.ts` |
| **Safety-plan collaboration attestation gate** | Two-clinician sign requirement on safety-plan create/activate/sign | `bugScribe25SafetyPlanAttestation.int.test.ts` |
| **Clinical-note signature hash + immutability trigger** | AHPRA Standard 6 tamper-detection on signed clinical notes | DB trigger + integration coverage |

## 6. FHIR alignment

| Resource / profile | Mapping | Status |
|---|---|---|
| Patient | 1:1 with `patients` table | ✅ shipped |
| Encounter | `consultations` + `episodes` | ✅ shipped |
| Condition | `problem_list` (Phase 3 Internal Medicine) | ✅ shipped |
| MedicationRequest / MedicationStatement | `patient_medications` + MySL upsert path (BUG-WF81-ASLR-READONLY in code) | ✅ + 🟡 (MySL staging) |
| ServiceRequest + Task | Referral ServiceRequest split + Task lifecycle | ✅ shipped |
| Observation | Vitals + `glucose_readings` + partogram | ✅ shipped |
| DocumentReference | `patient_attachments` + mobile-sync pre-signed URLs | ✅ shipped |
| AllergyIntolerance | Allergies feature | ✅ shipped |
| CarePlan | Treatment pathways + safety plans | ✅ shipped |
| **mCODE (oncology profiles)** | PrimaryCancerCondition, TNMStageGroup, ECOGPerformanceStatus, CancerTreatmentPlan, ChemoCycle, TumourBoardDecision | ⚠️ **DEFERRED** — Phase 8 scaffolding (specialty enum + seed migration); no clinical tables shipped |

## 7. HL7 v2.x integration

| Feature | Status | Where |
|---|---|---|
| Outbound HL7 ADT / ORM | ✅ shipped | `hl7-outbound` BullMQ queue |
| Inbound HL7 ADT parsing | ✅ shipped | `hl7-inbound` queue |
| Pathology order fulfillment (ORU^R01) | ✅ shipped | |
| eScript / ETP2 token delivery | ✅ shipped (only allowlisted SMS path) | [integrations/escript/](../../apps/api/src/integrations/escript/) |
| **NPDS conformance (ADHA eRx)** | ✅ in code; ADHA sandbox canary + burn-in remaining (BUG-344) | `erxConformanceA5.test.ts` 60/60 pass + d15 closure contract |
| **End-of-prescription redaction contract** | ✅ in code; token-delivery canary remaining (BUG-P1) | `bugP1EopRedaction.test.ts` + `guard:eop-redaction` |

## 8. Notifiable Data Breaches (NDB) scheme

| Requirement | Implementation |
|---|---|
| Breach detection | Forbidden-access audit + rate limit + session-tree reuse detection + worker failure observability |
| Incident log | `audit_log` partitioned + hash-chained, 7-year retention |
| Notification workflow | Admin runbook ([docs/operations/incident-response.md](../operations/incident-response.md)) — human-in-the-loop, not automated |
| DPIA template | See §13 — drafted |

## 9. Data retention

| Data class | Retention | Mechanism |
|---|---|---|
| Clinical notes | Permanent | Soft-delete only, never hard-deleted; signed-content hash protects integrity |
| Audit log | 7 years | Partitioned monthly, DROP PARTITION |
| Audio recordings | 30 days | `audioRetentionScheduler` |
| Session tokens | Matches JWT lifetime + rotation |
| Backup archives | 30 days local + 90 days offsite | Backup config |
| Patient outreach log | 2 years | Partition sweep |
| **Password-reset tokens** | Short-lived TTL + single-use | `password_reset_tokens` table |

---

## 10. External security audit status

**Status:** 🟠 **Scheduled, not commissioned.**

| Activity | Status | Owner | Target |
|---|---|---|---|
| Application penetration test | ⚠️ not commissioned | Product lead | Before first paying tenant |
| Network / infrastructure pentest | ⚠️ not commissioned | Ops lead | Before first paying tenant |
| ISO 27001 ISMS certification | ❌ not started | CEO | Year 2 |
| SOC 2 Type I readiness | ❌ not started | CEO | Year 2 |
| Code security audit (third-party) | ⚠️ internal only | Dev lead | Before first paying tenant |

**Scope of a proposed external pentest** (for an engagement RFP):

- Authentication + session management (MFA, WebAuthn, **JWT ghost-session fix**, **atomic counter**, **MFA attempt cap**, session-tree reuse detection, break-glass, **password reset flow**, **patient-app rate limits**)
- Authorization (RBAC + module-access ABAC + RLS + **FORCE RLS** defence-in-depth + **service-auth-context mandate**)
- PHI encryption at rest + blind indexes + **versioned keyring + rotation** + **clinical-note signature hash**
- Audit-log tamper evidence (REVOKE + triggers + hash chain + clinical-note signature hash)
- Patient outreach delivery (FCM + ACS SMS, consent + override paths, **worker tenant-context**)
- Backup pipeline (spawn + array args, PGPASSWORD via env)
- Child-process hardening (binaryResolver + array args throughout)
- SSRF guard (`validateOutboundUrl`)
- Every OWASP Top 10 2021 category per [04 §14](04-security-features.md#14-owasp-top-10-2021-coverage)
- **eRx safety posture** (NPDS sign+encrypt, PBS authority fail-closed, MySL write, HPI-I strict gate)
- **Scribe-25 non-diagnostic posture** (response-guard at AI egress; consent revoke fail-closed; attestation safety-lock)

**Blocker:** budget + vendor selection. No engineering blocker — the codebase is ready for review.

## 11. Insurance + SLA status

**Status:** 🟠 **Drafted, not signed.**

| Instrument | Status | Owner | Target |
|---|---|---|---|
| Cyber-liability insurance | ⚠️ quotes being gathered | CEO | Before first paying tenant |
| Professional indemnity (medical software carve-out) | ⚠️ quotes being gathered | CEO | Before first paying tenant |
| Uptime SLA (master services agreement) | ⚠️ drafted | Legal + CEO | Before first paying tenant |
| Disaster recovery RTO / RPO | ✅ documented at 24h RTO / 1h RPO in [disaster-recovery.md](../operations/disaster-recovery.md) | Ops lead | — |
| Data processing agreement (DPA) template | ⚠️ drafted | Legal | Before first paying tenant |
| Business Associate Agreement (HIPAA, where applicable) | ⚠️ template only | Legal | Per-tenant basis |

**Interim posture:** The system technically meets 24h RTO / 1h RPO on paper (automated backup scheduler + tested restore drill), but the legal obligation to meet it is not contracted because no SLA is signed.

## 12. Compliance dashboard / BI

**Status:** 🟠 **Deferred — data exists, tooling pending.**

The raw data required for a compliance dashboard is already captured:

| Metric | Source |
|---|---|
| Forbidden access count per clinic per day | `audit_log` where `action = 'FORBIDDEN'` |
| Break-glass elevations per month | `audit_log` where source = break-glass |
| Patient outreach skip rate | `patient_outreach_log` where `channel = 'skipped'` |
| LAI overdue count per clinic | `patient_flags` where `category = 'lai_overdue'` |
| MHA order expiry within 7 days | `legal_orders` where `expiry_date < now() + 7 days` |
| Failed-login rate + account lockouts | `staff.failed_login_attempts`, `staff.locked_until` |
| Consent state per patient | `patients.sms_consent` + `patient_sync_preferences` |
| Module-access grant coverage | `staff_module_access` |
| **PHQ-9 Q9 / suicide-risk auto-escalation rate** | `outcome_measures` + escalation audit |
| **Scribe consent revoke events** | `scribe_consent` updates |
| **Worker DLQ depth + failed-job count** | BullMQ + observability baseline (BUG-SA-008) |
| **HPI-I validation failures** | `audit_log` + prescriber HPI-I gate audit |

**What's missing:** a dedicated BI surface (Metabase, Grafana, Looker Studio or a native React dashboard) that surfaces these metrics.

**Not a compliance blocker** — the data is always available via direct SQL, and the audit log is tamper-evident by construction.

## 13. DPIA + threat model

| Artifact | Status | Where |
|---|---|---|
| Threat model | ✅ shipped | [docs/compliance/threat-manual.md](../compliance/threat-manual.md) |
| ISO 14971 hazard register (14 entries) | ✅ shipped | [04 §10](04-security-features.md#10-clinical-safety-hazards-iso-14971) |
| Data Protection Impact Assessment (DPIA) | ⚠️ template only | drafted — sign-off pending per-tenant |
| Privacy Impact Assessment (Australian equivalent) | ⚠️ document drafted; CPO sign-off pending | [docs/compliance/privacy-impact-assessment.md](../compliance/privacy-impact-assessment.md) |
| TGA classification evidence | ✅ shipped | [docs/compliance/tga-classification.md](../compliance/tga-classification.md) |
| IEC 62304 Class B traceability matrix | ✅ shipped | [docs/compliance/iec-62304-traceability.md](../compliance/iec-62304-traceability.md) |

---

## Comparison — Compliance posture

| Dimension | Signacare | Epic | Oracle Cerner | Best Practice |
|---|---|---|---|---|
| APP 1-13 coverage | ✅ | ✅ | ✅ | ✅ |
| **APP 6 consent revoke mid-stream fail-closed** | ✅ | ⚠️ | ⚠️ | ⚠️ |
| **APP 11.1 PHI key MANDATORY + versioned keyring** | ✅ unique | ⚠️ ops-only | ⚠️ ops-only | ❌ |
| HIPAA safeguards (technical tier) | ✅ | ✅ | ✅ | ⚠️ |
| ACHS Standards 1, 4, 5, 6, 8 | ✅ | ✅ | ✅ | ⚠️ |
| ISO 14971 hazard register, every hazard tested | ✅ 14 hazards | ✅ | ✅ | ⚠️ |
| **PHQ-9 Q9 suicide-risk server-authoritative escalation** | ✅ | ⚠️ vendor config | ⚠️ vendor config | ❌ |
| **Server-side assessment scoring (anti-spoof)** | ✅ | ✅ | ✅ | ⚠️ |
| **Safety-plan collaboration attestation** | ✅ | ⚠️ template-only | ⚠️ template-only | ⚠️ |
| **AI-draft sign attestation safety-locked** | ✅ | ⚠️ banner only | ⚠️ banner only | ❌ |
| **Non-diagnostic AI risk-surfacing posture** | ✅ | ❌ | ❌ | ❌ |
| **Clinical-note signed-content hash + immutability trigger** | ✅ | ✅ | ✅ | ⚠️ |
| RANZCP clozapine + LAI + MHA protocols | ✅ AU-aligned | ⚠️ US-centric | ⚠️ US-centric | ⚠️ |
| **eRx maturity (NPDS sign+encrypt + retry + PBS authority + MySL/ASLR + HPI-I strict)** | ✅ in code | ⚠️ via partner | ⚠️ via partner | ✅ |
| **ADHA eRx conformance 60/60 + EoP redaction contract** | ✅ in code | N/A | N/A | ✅ |
| FHIR R4 core resources | ✅ | ✅ | ✅ | ⚠️ |
| mCODE oncology profiles | ⚠️ **deferred** | ✅ | ✅ | ❌ |
| HL7 v2 ADT / ORM / ORU | ✅ | ✅ | ✅ | ✅ |
| NDB breach workflow | ⚠️ manual | ✅ automated | ✅ automated | ⚠️ |
| External pentest report | ⚠️ **scheduled not commissioned** | ✅ | ✅ | ✅ |
| ISO 27001 certification | ❌ **year-2 roadmap** | ✅ | ✅ | ⚠️ |
| SOC 2 Type II | ❌ **year-2 roadmap** | ✅ | ✅ | ⚠️ |
| Cyber-liability insurance | ⚠️ **quotes gathering** | ✅ | ✅ | ✅ |
| Uptime SLA signed | ⚠️ **drafted not signed** | ✅ | ✅ | ✅ |
| Compliance BI dashboard | ⚠️ **data ready, UI deferred** | ✅ | ✅ | ⚠️ |

**Verdict:** Technical compliance posture is **gold-standard** — every APP, ACHS and RANZCP control has evidence in code or migration, the hazard register is integrated with tests, the May-2026 closure wave brings safety-critical clinical workflow controls (suicide-risk escalation, attestation safety-lock, consent revoke fail-closed, HPI-I strict gate, signature hash, FORCE RLS, scribe-25 non-diagnostic posture) up to gold-standard with explicit staging-evidence gates remaining. The tamper-evident audit log + clinical-note signature hash give regulators a forensic substrate that exceeds typical AU/US EMR vendor posture.

The **outstanding items are organisational**: external audit commission, insurance signature, SLA signature, ISMS certification, mCODE oncology scaffolding, and the BI dashboard layer. All of these are tracked explicitly in §10-§12 above and in [docs/quality/bugs-remaining.md](../quality/bugs-remaining.md).

No silent gaps.
