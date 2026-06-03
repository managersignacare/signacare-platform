# IEC 62304 Software Traceability Matrix
## Signacare EMR — Software as a Medical Device (SaMD) Class B

**Standard:** IEC 62304:2006+AMD1:2015
**Date:** 30 March 2026 (initial) · **Refreshed:** 2026-05-29 (May-2026 S0 closure-wave additions per row)

---

## 1. Software Safety Classification: Class B

Signacare EMR provides clinical decision support that clinicians can override. Per TGA guidance for SaMD, features that provide recommendations (not autonomous actions) are Class B.

---

## 2. Requirements → Design → Code → Test Traceability

### 2.1 Authentication & Access Control

| Req ID | Requirement | Design | Code | Test |
|---|---|---|---|---|
| SEC-001 | Users must authenticate before accessing clinical data | JWT HttpOnly cookies + Bearer token | `authMiddleware.ts` | `auth.test.ts` V2 tests |
| SEC-002 | Multi-factor authentication for clinical roles | TOTP via speakeasy | `authService.ts`, `authRoutes.ts` | `auth.test.ts` MFA tests |
| SEC-002b | **MFA / OTP attempt cap** (BUG-WF21-OTP-CAP-MISSING) | Bounded retries before lockout | `authService.ts` | `mfaAttemptCap.int.test.ts` |
| SEC-003 | Account lockout after 5 failed attempts | Counter in staff table | `authService.ts:91-103` | Manual test verified |
| SEC-003b | **Atomic failed-login counter** (BUG-WF21-AUTH-COUNTER-RACE) | DB atomic update | `authService.ts` | Staging parallel-attempt replay remaining |
| SEC-004 | Session timeout | 15-minute access JWT + refresh rotation | `config.ts`, `authService.ts:refresh` | Token expiry test |
| SEC-004b | **Session row persisted before token issuance** (BUG-WF21-JWT-GHOST-SESSION) | Order-of-operations in authService | `authService.ts` | Staging concurrent-login replay remaining |
| SEC-005 | Maximum 5 concurrent sessions | Session count on login | `authService.ts` session limits | Session test |
| SEC-006 | Emergency break-glass access with audit | Time-limited token + audit log | `breakGlassRoutes.ts` | Break-glass endpoint test |
| SEC-007 | **Password reset flow** (BUG-WF22-PWD-RESET-MISSING) | Request/confirm routes + token table + rate limit | `passwordResetRoutes.ts` | `passwordResetFlow.int.test.ts` |
| SEC-008 | **Patient-app login + activation rate limiting** (BUG-ARCH-PATIENTAPP-*) | Layered per-IP + per-phone + global tiers | `patientAppRoutes.ts` middleware | `rateLimiting.test.ts` L4/L5b/L5c |
| SEC-009 | **Service-layer AuthContext mandate** (CLAUDE.md §13) | Every service method takes AuthContext as 1st param | `guard:service-auth-context` | 180 baseline allowlisted; new methods cannot regress |

### 2.2 Data Protection

| Req ID | Requirement | Design | Code | Test |
|---|---|---|---|---|
| DAT-001 | Medicare/IHI/DVA numbers encrypted at rest | AES-256-GCM application-layer | `phiEncryption.ts` | `phi-encryption.test.ts` (6 tests) |
| DAT-001b | **PHI key MANDATORY at runtime** (BUG-ARCH-PHI-KEY-MANDATORY) | Boot fails closed when key missing outside tests | `config.ts` | Staging+prod secret-contract validation remaining |
| DAT-001c | **Versioned PHI keyring + rotation** (BUG-ARCH-PHI-KEY-ROTATION) | `PHI_ENCRYPTION_KEYRING_JSON` with active version | `phiEncryption.ts` | Live rotation drill remaining |
| DAT-002 | Multi-tenant data isolation | PostgreSQL RLS with separate DB role | `rlsMiddleware.ts`, `db.ts` | `rls-isolation.test.ts` (4 tests) |
| DAT-002b | **FORCE RLS baseline** (BUG-ARCH-FORCE-RLS-BASELINE) | Owner role cannot bypass | Migration `20260701000083_force_rls_baseline` | `forceRlsBaseline.int.test.ts` + DBA posture proof remaining |
| DAT-002c | **Worker tenant context** (BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT) | `withTenantContext` wrapper | `processPatientOutreachJob` | `bugWf42OutreachWorkerTenantContext.int.test.ts` |
| DAT-003 | Audit trail for all clinical data modifications | Database triggers on 191+ tenant-scoped tables | `audit_trigger_fn()` | Audit count verification |
| DAT-004 | Audit trail for patient record access (reads) | API middleware logging GET requests | `patientAccessAudit.ts` | Read audit count test |
| DAT-005 | Tamper-evident audit log | INSERT-only + SHA-256 hash chain | `audit_log_hash_chain()` trigger | Hash chain integrity test |
| DAT-006 | **Clinical-note signed-content hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) | DB-write tamper detection (AHPRA Standard 6) | `compute_note_hash` trigger | Staging tamper drill remaining |
| DAT-007 | **Env-contract catalog SSoT** (BUG-INFRA-ENV-CONTRACT-GAP) | 5 templates × 197 runtime keys | `guard:env-template-contract` AST runtime discovery | 197 runtime keys = 197 catalog keys |
| DAT-008 | **Strict prescriber HPI-I gate** (BUG-WF81-HPII-MISSING) | No NULL + no WARN bypass in `requireValidHpii` | `prescriptionService.ts` | `hpiiValidation.int.test.ts` + clozapine extension |

### 2.3 Clinical Functionality

| Req ID | Requirement | Design | Code | Test |
|---|---|---|---|---|
| CLN-001 | Record nursing observations (NEWS2) | Structured assessment forms | `roleFeatureRoutes.ts` nursing | `clinical-workflows.test.ts` |
| CLN-002 | Risk assessment with severity levels | Validated risk scoring | `riskRepository.ts`, `riskService.ts` | Risk assessment CRUD test |
| CLN-002b | **PHQ-9 Q9 / total ≥20 suicide-risk auto-escalation** (BUG-WF52-SUICIDE-ALERT-MISSING) | Server-authoritative trigger + escalation pipeline | `assessmentRisk.ts` | `bugWf52AssessmentSuicideRiskEscalation.int.test.ts` |
| CLN-002c | **Server-side assessment scoring** (BUG-WF52-SCORING-CALCULATOR-MISSING) | Client `totalScore` not authoritative | `assessmentService.ts` | `assessmentRisk.test.ts` spoof-resistance |
| CLN-003 | Medication prescribing with allergy checking | Allergy conflict detection | `allergyService.ts:checkDrugConflict` | Allergy interaction test |
| CLN-003b | **NPDS sign + encrypt modes** (BUG-WF81-NPDS-PAYLOAD-ENCRYPTION) | RSA-SHA256 + AES-256-GCM envelope | `npdsClient.ts` | Conformance T7/T8 + staging partner validation remaining |
| CLN-003c | **NPDS retry + backoff** (BUG-ARCH-NPDS-SUBMIT-RETRY) | `NPDS_SUBMIT_MAX_ATTEMPTS` configurable | `npdsClient.ts` | Staging fault-injection remaining |
| CLN-003d | **PBS authority fail-closed** (BUG-WF81-PBS-AUTHORITY-MISSING) | Schema + submitErx | `prescription.schemas.ts`, `prescriptionService.ts` | `prescription.schemas.test.ts` + `bugP5IhiStatusPrescribeGate.int.test.ts` |
| CLN-003e | **MySL / ASLR write path** (BUG-WF81-ASLR-READONLY) | `syncMedicationRequestFromPrescription` | `myslClient.ts` | `myslMedicationSync.test.ts` |
| CLN-004 | Safety plan management | JSONB content storage | `safetyPlanRoutes.ts` | Safety plan CRUD test |
| CLN-004b | **Safety-plan collaboration attestation gate** (BUG-SCRIBE25-002) | Two-clinician sign requirement | `safetyPlanService.ts` | `bugScribe25SafetyPlanAttestation.int.test.ts` |
| CLN-005 | Clinical note integrity verification | SHA-256 content hash + immutability trigger (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) | `compute_note_hash()` trigger | Note hash verification + staging tamper drill remaining |
| CLN-006 | Optimistic concurrency on note edits | ETag / If-Match headers + `lock_version` | `optimisticLockMiddleware.ts` | Concurrent edit test |
| CLN-007 | **AI-draft sign attestation safety-locked** (BUG-WF51-ATTESTATION-BYPASS) | No runtime bypass flag | `clinicalNoteService.ts` | `bug417AiDraftSignAttestation.int.test.ts` |
| CLN-008 | **Scribe consent revoke mid-stream fail-closed** (BUG-WF51-CONSENT-REVOKE-RACE) | Re-check at post-upload + post-processing | `scribeRoutes.ts` | `ambientNoteConsentGate.int.test.ts` |
| CLN-009 | **Non-diagnostic AI risk-surfacing posture** (BUG-SCRIBE25-001) | Guard-level qualifier injection at AI egress | `responseGuard.ts` | `responseGuard.test.ts` |
| CLN-010 | **DB unique active-slot index** (BUG-WF41-SLOT-RACE) | Double-booking prevention | Migration `20260701000081_appointments_active_slot_unique` | `appointmentSlotUniqueness.int.test.ts` |
| CLN-011 | **Cancel-path queue cleanup** (BUG-WF42-CANCEL-CLEANUP-MISSING) | Reminder jobs cleared on cancel | `appointmentService.cancel` | `appointmentCancelReminderCleanup.int.test.ts` |

### 2.4 Interoperability

| Req ID | Requirement | Design | Code | Test |
|---|---|---|---|---|
| INT-001 | FHIR R4 Patient resource read/write | REST endpoints with AU identifiers | `fhirRoutes.ts` | FHIR auth test |
| INT-002 | FHIR CapabilityStatement (public) | Unauthenticated metadata endpoint | `server.ts` metadata route | FHIR metadata test |
| INT-003 | SMART on FHIR authorization | OAuth2 authorization code flow | `smartAuth.ts` | SMART config test |
| INT-004 | FHIR bulk export ($export) | NDJSON format | `fhirRoutes.ts` $export | Bulk export test |

### 2.5 Privacy & Compliance

| Req ID | Requirement | Design | Code | Test |
|---|---|---|---|---|
| PRV-001 | Patient data export (portability) | JSON export of all patient data | `privacyRoutes.ts` export | Privacy export test |
| PRV-002 | Patient data anonymisation | PII removal preserving clinical structure | `privacyRoutes.ts` anonymise | Anonymisation test |
| PRV-003 | NDB assessment and notification | Severity assessment + OAIC form | `ndbNotification.ts` | NDB assessment test |
| PRV-004 | Data sharing agreement management | CRUD for inter-provider agreements | `privacyRoutes.ts` DSA | DSA CRUD test |

---

## 3. Risk Management (ISO 14971 Alignment)

| Risk ID | Hazard | Severity | Probability | Risk Level | Mitigation | Residual Risk |
|---|---|---|---|---|---|---|
| RSK-001 | Wrong patient medication displayed | Serious | Remote | Medium | RLS tenant isolation + patient ID validation | Acceptable |
| RSK-002 | Missed deterioration alert | Serious | Occasional | High | NEWS2 auto-scoring + escalation pathway | Acceptable with monitoring |
| RSK-003 | Unauthorised access to clinical data | Serious | Remote | Medium | JWT + MFA + RLS + audit trail | Acceptable |
| RSK-004 | Clinical note modification after signing | Moderate | Remote | Low | Optimistic locking + content hash + signed status immutable | Acceptable |
| RSK-005 | AI-generated note contains fabricated information | Moderate | Occasional | Medium | Zero-fabrication prompt constraint + clinician review required | Acceptable |

---

## 4. Software Bill of Materials (SBOM)

Generated automatically via CycloneDX in CI pipeline. See CI artifact `sbom.json`.

Key dependencies:
- Node.js 20.x (LTS)
- Express 4.x
- Knex 3.x (PostgreSQL query builder)
- React 18.x
- PostgreSQL 16.x
- Redis 7.x
- Ollama (local LLM inference)
- Whisper (local speech-to-text)

---

## 5. Document Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 30 Mar 2026 | CTO | Initial traceability matrix |
| 1.1 | 29 May 2026 | Claude refresh | May-2026 S0 closure-wave additions: SEC-002b/003b/004b/007/008/009; DAT-001b/c/002b/c/006/007/008; CLN-002b/c/003b/c/d/e/004b/007/008/009/010/011. All new rows cite BUG-ID; staging-evidence gates documented per row. |
