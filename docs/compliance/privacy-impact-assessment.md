# Privacy Impact Assessment (PIA)
## Signacare EMR — Mental Health Electronic Medical Record

**Organisation:** Signacare Health Technologies Pty Ltd
**System:** Signacare EMR v1.0.0
**Date:** 30 March 2026 (initial) · **Refreshed:** 2026-05-29 (May-2026 S0 closure-wave deltas reflected in §3 and §4)
**Assessor:** Chief Technology Officer
**Framework:** Office of the Australian Information Commissioner (OAIC) PIA Guide

---

## 1. Description of the Project

Signacare EMR is a cloud-hosted mental health Electronic Medical Record designed for Australian public and private mental health services. It manages:
- Patient demographics, healthcare identifiers (Medicare, IHI, DVA)
- Clinical notes, assessments, risk assessments, safety plans
- Medication prescribing, administration, and monitoring
- Mental Health Act orders and legal status
- Referrals, appointments, correspondence
- AI-assisted clinical documentation (Whisper transcription + Ollama AI)
- Integration with Zitavi patient mobile app

**Personal information collected:** Full name, DOB, gender, address, phone, email, Medicare number, IHI, DVA number, Indigenous status, clinical diagnoses, medications, mental state, risk status, carer details.

**Sensitive information collected:** Health information (all clinical data), mental health status, medication history, substance use, sexual orientation, gender identity, Indigenous status.

---

## 2. Information Flow Mapping

### 2.1 Collection
| Source | Data | Method |
|---|---|---|
| Patient/carer | Demographics, contacts, consent | Registration wizard |
| Clinician | Clinical notes, assessments, prescriptions | Clinical workflows |
| AI (Whisper/Ollama) | Transcriptions, AI-generated notes | Audio processing |
| External referrals | Referral letters, GP details | Manual entry / OCR |
| Zitavi mobile app | Patient self-reported mood, vitals, journal | MongoDB gateway sync |
| My Health Record | Medicare validation, IHI lookup | NHSD API (planned) |

### 2.2 Storage
| Data | Location | Encryption |
|---|---|---|
| All structured clinical data | PostgreSQL 16 (RDS or on-premise) | TLS in transit, AES-256-GCM for healthcare identifiers (Medicare/IHI/DVA) |
| Uploaded documents | Server filesystem (`/uploads/`) | Authenticated access only |
| Audio recordings | Server filesystem (`/uploads/audio/`) | Authenticated access only |
| Session tokens | Redis (in-memory) | HttpOnly cookies, SameSite strict |

### 2.3 Access
| Role | Access Level |
|---|---|
| Receptionist | Patient demographics, appointments, waitlist |
| Clinician (Nurse) | All clinical data for assigned patients |
| Clinician (Psychologist) | All clinical data, outcome measures |
| Clinician (Psychiatrist) | All clinical data, prescribing |
| Admin/Manager | All data + staff management + reports |
| SuperAdmin | Full system access + settings |

Access is enforced via:
- JWT role-based access control (6 roles, 48 permissions)
- PostgreSQL Row-Level Security (107 policies, clinic_id scoping)
- Module-level access control (staff_module_access table)

### 2.4 Disclosure
| Recipient | Data | Legal Basis |
|---|---|---|
| GPs (via letter/email) | Clinical correspondence | Consent + treatment relationship |
| Mental Health Tribunal | MHA orders, clinical reports | Mental Health Act |
| DHHS (CMI/NOCC) | De-identified outcome data | Public health reporting obligation |
| My Health Record | Clinical summaries | My Health Records Act 2012 |
| Law enforcement | As required by law | Court order / mandatory reporting |

### 2.5 Retention & Destruction
- Clinical records retained for minimum 7 years after last service (25 years for minors) per Health Records Act 2001
- `data_retention_policies` table tracks per-category retention periods
- Destruction via `anonymise_patient()` function — removes PII, preserves de-identified clinical structure

---

## 3. Privacy Risk Assessment

### 3.1 Risk: Unauthorised access to patient records
- **Likelihood:** Low (RLS + FORCE RLS baseline, JWT with ghost-session fix, MFA with attempt cap, IP allowlisting, atomic failed-login counter, patient-app layered rate limits)
- **Impact:** High (mental health data is highly sensitive)
- **Mitigations:** Multi-layer access control (RBAC + ABAC + service-auth-context mandate + frontend fail-CLOSED anchor), per-patient read-access audit logging, account lockout, rate limiting, patient match hardening (BUG-WF71-PATIENT-MATCH-NAIVE)

### 3.2 Risk: Data breach via database compromise
- **Likelihood:** Low (separate DB role, RLS + FORCE RLS, network segmentation)
- **Impact:** Critical (Medicare/IHI/DVA numbers)
- **Mitigations:** AES-256-GCM column encryption for healthcare identifiers; **PHI key MANDATORY at runtime** (BUG-ARCH-PHI-KEY-MANDATORY) fails closed when key missing; **versioned PHI keyring** (BUG-ARCH-PHI-KEY-ROTATION) supports zero-downtime rotation; **clinical-note signature hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) detects DB-write tamper; TLS in transit; RDS encryption at rest

### 3.3 Risk: Cross-tenant data leakage
- **Likelihood:** Very Low (RLS enforced at DB level via separate non-owner role + FORCE RLS baseline)
- **Impact:** Critical
- **Mitigations:** 191 tenant-scoped tables with RLS policies, **FORCE RLS baseline** (BUG-ARCH-FORCE-RLS-BASELINE) so owner role cannot bypass, AsyncLocalStorage transaction scoping, `app_user` DB role (not table owner), **worker tenant context** via `withTenantContext` (BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT), application-layer `clinic_id` filter on every query (`guard:query-has-clinic-id`), `guard:empty-where-on-mutation`

### 3.4 Risk: AI/LLM data leakage
- **Likelihood:** Low (local Ollama default + `assertAiDataResidency` boot check pins production to AU region)
- **Impact:** High (clinical transcripts contain PHI)
- **Mitigations:** Local-only AI processing by default; `assertAiDataResidency` blocks non-AU LLM hosts in production; AU-cloud opt-in requires BAA reference; **scribe consent revoke mid-stream fail-closed with audio delete** (BUG-WF51-CONSENT-REVOKE-RACE); **non-diagnostic egress posture** via `responseGuard` (BUG-SCRIBE25-001); **AI-draft sign attestation safety-locked** (BUG-WF51-ATTESTATION-BYPASS); audio retention 30 days; PHI redaction Pass 1 before LLM

### 3.5 Risk: Insider threat (staff misuse)
- **Likelihood:** Medium
- **Impact:** High
- **Mitigations:** Per-patient access audit logging, role-based access, module-level access control, audit trail with 126 database triggers

---

## 4. Australian Privacy Principles (APP) Compliance

| APP | Requirement | Status |
|---|---|---|
| APP 1 | Open and transparent management of PI | Privacy policy in application |
| APP 2 | Anonymity and pseudonymity | Anonymisation function available |
| APP 3 | Collection of solicited PI | Consent forms, minimum data collection |
| APP 4 | Dealing with unsolicited PI | N/A — system only processes solicited data |
| APP 5 | Notification of collection | Registration consent workflow |
| APP 6 | Use or disclosure of PI | Role-based access (RBAC + ABAC), audit trail, AI-draft sign attestation safety-locked, scribe consent revoke fail-closed |
| APP 7 | Direct marketing | Not applicable — clinical system only |
| APP 8 | Cross-border disclosure | AU-region cloud only; `assertAiDataResidency` boot check; ACS region = Australia; non-AU LLM hosts blocked by default |
| APP 9 | Government identifiers | Medicare/IHI/DVA AES-256-GCM encrypted with MANDATORY key + versioned keyring + blind indexes; access logged; strict HPI-I gate (BUG-WF81-HPII-MISSING) |
| APP 10 | Quality of PI | Data validation via Zod schemas |
| APP 11 | Security of PI | RLS, encryption, MFA, rate limiting, CSRF |
| APP 12 | Access to PI | Patient data export endpoint |
| APP 13 | Correction of PI | Patient edit workflow with audit trail |

---

## 5. Recommendations

1. Complete My Health Record integration with NASH certificate management
2. Implement automated OAIC breach notification workflow within 30-day timeframe
3. Conduct annual PIA review
4. Engage external penetration tester before production deployment
5. Document data processing agreements with all sub-processors

---

**Approval:**
Name: _________________________ Date: _________
Title: Chief Privacy Officer
