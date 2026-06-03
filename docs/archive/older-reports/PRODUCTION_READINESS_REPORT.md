# SIGNACARE EMR — Enterprise Production Readiness Assessment

**Date:** 30 March 2026
**Version:** 1.0.0
**Overall Score:** 62/100 — NOT YET PRODUCTION-READY for enterprise healthcare

---

## Readiness Summary by Category

| Category | Score | Status |
|---|---|---|
| Authentication & Access Control | 9/10 | STRONG |
| Data Security & Encryption | 6/8 | PHI encryption missing |
| Application Security (OWASP) | 13/15 | Pen test needed |
| Audit & Compliance | 8/11 | Read-access logging + PIA missing |
| Infrastructure & Operations | 14/19 | Tests + monitoring missing |
| Interoperability & Standards | 5/7 | MHR + API docs missing |
| Australian Regulatory | 5/10 | Access logging + PIA + incident plan |
| SOC 2 Type II | 2/8 | Incident plan + BCP + vendor mgmt |
| ISO 27001 | 3/7 | Key mgmt + incident mgmt |
| Quality Assurance | 1/10 | Zero automated tests |

---

## 8 CRITICAL Items (Must Fix Before Go-Live)

### 1. Column-Level Encryption for Healthcare Identifiers
- **Gap:** Medicare, IHI, DVA numbers stored as plain varchar
- **Requirement:** Australian Privacy Act 1988, My Health Records Act 2012
- **Fix:** AES-256-GCM encryption via application layer for 8 columns
- **Effort:** 2 weeks
- **Risk if skipped:** Regulatory non-compliance, reportable breach if DB compromised

### 2. Per-Patient Read-Access Audit Logging
- **Gap:** Only write operations logged via triggers. No log of who VIEWED a patient record
- **Requirement:** Health Records Act 2001 (Vic) HPP 6, NSQHS Standard 1
- **Fix:** Add middleware that logs every GET /patients/:id access to audit_log
- **Effort:** 1 week
- **Risk if skipped:** Cannot prove compliance with access audit requirements

### 3. Automated Test Suite
- **Gap:** Zero test files exist. CI pipeline is scaffolding only
- **Fix:** Minimum viable: auth flow tests, patient CRUD tests, RLS isolation tests, clinical note tests
- **Target:** 80% coverage on auth + clinical modules
- **Effort:** 3-4 weeks
- **Risk if skipped:** Every deployment is a manual gamble

### 4. Penetration Test by Certified Assessor
- **Gap:** No independent security assessment
- **Requirement:** NSQHS, SOC 2, cyber insurance
- **Fix:** Engage CREST/OSCP-certified pen tester
- **Effort:** 2-3 weeks (including remediation)
- **Risk if skipped:** Cannot obtain cyber insurance or pass health service procurement

### 5. Privacy Impact Assessment (PIA)
- **Gap:** No PIA document
- **Requirement:** Australian Privacy Act 1988 Section 33D
- **Fix:** Document data flows, risks, mitigations using OAIC PIA template
- **Effort:** 1 week
- **Risk if skipped:** Required by law for new health record systems

### 6. Incident Response Plan
- **Gap:** No documented response procedure
- **Requirement:** SOC 2 CC7.3/CC7.4, ISO 27001 A.16, Notifiable Data Breach scheme
- **Fix:** Document: detection → containment → eradication → recovery → notification → post-incident review
- **Effort:** 1 week
- **Risk if skipped:** SOC 2 non-compliance, OAIC enforcement action after breach

### 7. Activate Error Monitoring (Sentry)
- **Gap:** Sentry SDK integrated but SENTRY_DSN is placeholder
- **Fix:** Create Sentry project, set DSN in production env
- **Effort:** 1 day
- **Risk if skipped:** Errors in production go unnoticed until user reports

### 8. CI Pipeline with Real Tests
- **Gap:** .github/workflows/ci.yml exists but runs 0 tests
- **Fix:** Add Vitest for API, configure CI to gate on test pass + coverage threshold
- **Effort:** 1 week (after test suite exists)
- **Risk if skipped:** Broken code reaches production

---

## 14 HIGH Items (Within 30 Days of Go-Live)

| # | Item | Effort |
|---|---|---|
| 1 | Expired session cleanup background job | 2 hours |
| 2 | Secrets management (AWS Secrets Manager / Vault) | 1 week |
| 3 | Infrastructure as Code (Terraform for AWS) | 2 weeks |
| 4 | Blue/green deployment strategy | 1 week |
| 5 | Database migration tracking (Knex CLI) | 2 days |
| 6 | OpenAPI/Swagger documentation | 1 week |
| 7 | My Health Record gateway integration | 2 weeks |
| 8 | Business Continuity Plan with RTO/RPO | 1 week |
| 9 | Vendor risk assessment (Sentry, cloud, AI) | 1 week |
| 10 | Audit log INSERT-only for app_user | 2 hours |
| 11 | NSQHS governance documentation | 1 week |
| 12 | Key management lifecycle documentation | 2 days |
| 13 | WCAG 2.1 AA accessibility audit | 2 weeks |
| 14 | Data Processing Agreement template | 2 days |

---

## 10 MEDIUM Items (Within 90 Days)

| # | Item |
|---|---|
| 1 | Password complexity enforcement on change endpoints |
| 2 | Encryption at rest documentation (RDS config) |
| 3 | HL7v2 integration verification and testing |
| 4 | Data classification policy document |
| 5 | Change management process documentation |
| 6 | Log aggregation (CloudWatch / ELK) |
| 7 | SAST/DAST tooling in CI pipeline |
| 8 | Browser compatibility testing matrix |
| 9 | Mobile responsiveness testing |
| 10 | Load testing with k6/Artillery |

---

## Architecture Strengths (Already Gold Standard)

| Strength | Assessment |
|---|---|
| RLS via AsyncLocalStorage proxy | Top-tier multi-tenancy — queries auto-scoped without route changes |
| Dual DB role separation | app_user (RLS) + signacare (owner) — PostgreSQL best practice |
| PHI-aware structured logging | 20+ field names redacted in Pino logger |
| Three-tier rate limiting | API + Auth + LLM with Redis-backed storage |
| Comprehensive FHIR R4 | 10+ resource types with AU namespaces, write + bulk export |
| Privacy management API | Export, anonymise, consent, breach log, retention |
| Clinical decision support | Metabolic monitoring, drug interactions, dose anomaly detection |
| Backup with verification | Automated pg_dump + S3 + weekly restore test |

---

## Recommended Go-Live Timeline

| Phase | Weeks | Focus |
|---|---|---|
| Phase 1 | 4-6 | Column encryption, test suite, pen test, PIA, incident plan |
| Phase 2 | 4-6 | IaC, monitoring, BCP, API docs, WCAG, session cleanup |
| Phase 3 | 2-4 | SOC 2 readiness, ADHA conformance, final pen test remediation |
| **Go-Live** | **Week 10-16** | Earliest responsible production date |

---

## Comparison to Competitors

| Capability | Signacare | Epic | Cerner | Best Practice |
|---|---|---|---|---|
| RLS multi-tenancy | Gold standard | Application-level | Application-level | Single-tenant |
| AI/ML native | Yes (Ollama + Whisper) | Add-on | Add-on | No |
| FHIR R4 | Read + Write + $export | Full | Full | Limited |
| Australian compliance | Partial (needs PIA + encryption) | Configurable | Configurable | Built-in |
| Time to deploy | Weeks | 12-18 months | 6-12 months | Days |
| Test coverage | 0% (critical gap) | >90% | >80% | N/A |

---

*End of Assessment*
