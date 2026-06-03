# Information Security Policy
## Signacare EMR — ISMS Documentation

**Organisation:** Signacare Health Technologies Pty Ltd
**Version:** 1.1 | **Date:** 30 March 2026 (initial) · **Refreshed:** 2026-05-29
**Standard:** ISO 27001:2022 (year-2 certification roadmap)

---

## 1. Purpose

This policy establishes the information security management system (ISMS) for Signacare EMR, ensuring the confidentiality, integrity, and availability of patient health information and clinical systems.

## 2. Scope

All systems, data, and personnel involved in the development, deployment, and operation of Signacare EMR, including:
- Production, staging, and development environments
- All patient health information (PHI) processed by the system
- Staff with access to clinical data or infrastructure
- Third-party services (cloud hosting, error monitoring, AI models)

## 3. Information Classification

| Level | Description | Examples | Controls |
|---|---|---|---|
| **PHI** | Protected Health Information | Patient names, Medicare numbers, clinical notes, medications | AES-256 encryption, RLS, RBAC, audit logging |
| **PII** | Personally Identifiable Information | Staff emails, phone numbers | Access controls, audit logging |
| **Confidential** | Business-sensitive | API keys, JWT secrets, database credentials | Env vars, secrets management, access restricted to ops team |
| **Internal** | Not public but low sensitivity | System architecture, internal documentation | Access restricted to employees |
| **Public** | No sensitivity | Marketing materials, public API documentation | No restrictions |

## 4. Access Control Policy

- **Principle of least privilege:** Users receive only permissions required for their role
- **Role-based access:** 7 roles (superadmin, admin, manager, clinician, receptionist, referral_coordinator, readonly)
- **Attribute-based per-module access (ABAC):** Per-staff module-access matrix on top of RBAC; tri-state (None / Read / Write) with four-eyes self-edit guard
- **Service-layer AuthContext mandate** (CLAUDE.md §13) — every service method takes AuthContext as first parameter; enforced by `guard:service-auth-context`
- **Database-level enforcement:** PostgreSQL Row-Level Security on 191 tenant-scoped tables; FORCE RLS baseline (BUG-ARCH-FORCE-RLS-BASELINE) means owner role cannot bypass — staging/prod DBA posture proof remaining
- **MFA required:** For admin, superadmin, and all clinician roles
- **MFA attempt cap** (BUG-WF21-OTP-CAP-MISSING) — bounded retries before lockout
- **Session limits:** Maximum 5 concurrent sessions per user
- **Atomic failed-login counter** (BUG-WF21-AUTH-COUNTER-RACE) — DB atomic update eliminates race on lockout boundary
- **Session-row persisted before token issuance** (BUG-WF21-JWT-GHOST-SESSION) — eliminates ghost-session window
- **Automatic lockout:** After 5 failed login attempts (15-minute lockout)
- **Session timeout:** 15-minute access token, N-day refresh token with RFC 6819 session-tree reuse detection
- **Password reset flow** (BUG-WF22-PWD-RESET-MISSING) — request/confirm routes + token table + per-IP rate limit
- **Patient-app layered rate limiting** (login + activation; BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT + ACTIVATION-ATTEMPT-CAP)
- **Frontend security gates fail-CLOSED** (BUG-416 anchor) — no permissive predicate on isError

## 5. Cryptography Policy

| Data State | Method | Standard |
|---|---|---|
| In transit | TLS 1.2/1.3 | NIST SP 800-52 |
| At rest (identifiers) | AES-256-GCM | NIST SP 800-38D |
| At rest (database) | Cloud provider disk encryption | Provider-dependent |
| Passwords | bcrypt (10 rounds) | OWASP recommendation |
| API signing | HMAC-SHA256 | RFC 2104 |

**Key Management:**
- **PHI encryption key MANDATORY at runtime** (BUG-ARCH-PHI-KEY-MANDATORY) — fails closed outside tests when PHI_ENCRYPTION_KEY / BLIND_INDEX_KEY missing; staging+prod secret-contract validation remaining
- **Versioned PHI keyring + active key version** (BUG-ARCH-PHI-KEY-ROTATION) — `PHI_ENCRYPTION_KEYRING_JSON` enables rotation; operational rotation runbook + live drill remaining
- **Env-contract catalog SSoT** (BUG-INFRA-ENV-CONTRACT-GAP) — 5 templates × 197 runtime keys validated by `guard:env-template-contract` with AST runtime discovery
- Production: Azure Key Vault (AU region) for key rotation
- Key rotation: Annual minimum, immediate on suspected compromise; versioned keyring supports zero-downtime rotation
- **Clinical-note signed-content hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) extends tamper-evidence beyond audit log to clinical-note content (AHPRA Standard 6)

## 6. Incident Management

See [INCIDENT_RESPONSE_PLAN.md](INCIDENT_RESPONSE_PLAN.md) for detailed procedures.

- Severity classification: P1 (Critical) through P4 (Low)
- Response team: Incident Commander, Technical Lead, Clinical Lead, Privacy Officer
- Notification: OAIC within 30 days for notifiable breaches (NDB scheme)
- Post-incident review within 7 days

## 7. Business Continuity

- **RTO (Recovery Time Objective):** 4 hours for critical clinical systems
- **RPO (Recovery Point Objective):** 1 hour (automated backups)
- **Backup schedule:** Daily full backup, hourly WAL archiving
- **Backup verification:** Weekly automated restore test
- **DR site:** Secondary availability zone (when deployed to cloud)

## 8. Change Management

- All code changes via pull request with CI gate (lint, typecheck, test, security audit, 35+ structural guards, 2,221 fix-registry anchors)
- **Layer 0a discipline guards** (confidence-label / shortcut-detector / gold-standard-enforcer / dod-completion-checker) at pre-commit
- **Review-attestation tree-hash binding** (BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1) — S0/S1/S2 bug-closure commits require cycle-1 + L3 + L5 review chain artifact at `.git/signacare-review-attestation.json`
- **Migration forward-fix governance** (BUG-SA-009) — irreversible migrations registered + rehearsal-proof gated
- **d10 repo-hygiene cluster** — tracked-ignored / zero-byte / env-template / cross-project-boundary guards
- Production deployments via PM2 cluster reload (zero-downtime)
- Database migrations tracked and versioned with `guard:migration-rollback-discipline` + `guard:migration-RLS-policy` + `guard:migration-index-discipline`
- Emergency changes: break-glass deployment with full post-mortem

## 9. Supplier Management

All third-party services must be assessed for:
- Data residency (must be AU or have adequate transfer mechanism)
- Encryption in transit and at rest
- SOC 2 or ISO 27001 certification
- Data processing agreement

| Supplier | Service | Data Access | Assessment |
|---|---|---|---|
| Cloud provider (AWS/Azure) | Infrastructure | Full | SOC 2 Type II required |
| Sentry | Error monitoring | Sanitised errors only | PHI scrubbed via beforeSend |
| Ollama | AI inference | Clinical text (local) | Self-hosted, no external transfer |
| Whisper | Speech-to-text | Audio (local) | Self-hosted, no external transfer |

## 10. Audit & Review

- **Internal audit:** Quarterly review of access logs, security events, policy compliance
- **External audit:** Annual penetration test by CREST-certified assessor
- **Policy review:** Annual or after any significant incident
- **Compliance register:** Maintained in this document suite

## 11. Document Control

| Document | Location | Owner |
|---|---|---|
| Information Security Policy | This document | CTO |
| Incident Response Plan | `INCIDENT_RESPONSE_PLAN.md` | CTO |
| Privacy Impact Assessment | `PRIVACY_IMPACT_ASSESSMENT.md` | Privacy Officer |
| Threat Model | `THREAT_MODEL.md` | CTO |
| Penetration Test Scope | `PENTEST_SCOPE.md` | CTO |
| Production Readiness Report | `PRODUCTION_READINESS_REPORT.md` | CTO |
| Gap Analysis | `GOLD_STANDARD_GAP_ANALYSIS.md` | CTO |

---

**Approved by:** _________________________ Date: _________
**Title:** Chief Executive Officer
