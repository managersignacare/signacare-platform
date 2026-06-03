# Threat Model — Signacare EMR

**Framework:** STRIDE (Microsoft)
**Date:** 30 March 2026 (last full review) · **Refreshed:** 2026-05-29 (May-2026 S0 closure-wave deltas — see notes per row)

---

## System Boundaries

```
[Browser] → HTTPS → [Nginx] → [Express API (Node.js)] → [PostgreSQL + RLS]
                                      ↕                        ↕
                                    [Redis]              [Ollama AI]
                                      ↕                        ↕
                                 [BullMQ Workers]       [Whisper STT]
```

## STRIDE Analysis

### S — Spoofing (Identity)
| Threat | Mitigation | Status |
|---|---|---|
| Stolen JWT token | HttpOnly cookies, short TTL (60min), refresh rotation | MITIGATED |
| **JWT ghost-session window** (token issued before session row persisted) | **Session row persisted BEFORE token issuance** (BUG-WF21-JWT-GHOST-SESSION) | MITIGATED (in code; staging replay remaining) |
| Session hijacking | SameSite=strict, Secure flag, CSRF header | MITIGATED |
| Forged MFA | TOTP with time window (±60s), rate limited | MITIGATED |
| **MFA brute-force** (unlimited attempt window) | **MFA / OTP attempt cap** (BUG-WF21-OTP-CAP-MISSING) | MITIGATED |
| Credential stuffing | Account lockout after 5 failures, rate limiting (30/15min) | MITIGATED |
| **Lockout counter race** (parallel attempts bypass cap) | **Atomic DB-update counter strategy** (BUG-WF21-AUTH-COUNTER-RACE) | MITIGATED (in code; parallel-attempt replay remaining) |
| **Password-reset abuse** (no rate limit / no token table) | **Request/confirm flow + token table + per-IP rate limit** (BUG-WF22-PWD-RESET-MISSING) | MITIGATED |
| Break-glass abuse | Requires password + MFA + reason, full audit trail, time-limited (30min) | MITIGATED |
| **Patient-app login brute-force** | **Layered rate limiting on /patient-app/login** (BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT) | MITIGATED |
| **Patient-app activation invite-code enumeration** | **Layered rate limiting on /patient-app/activate** (BUG-ARCH-PATIENTAPP-ACTIVATION-ATTEMPT-CAP) | MITIGATED |

### T — Tampering
| Threat | Mitigation | Status |
|---|---|---|
| SQL injection | Parameterized queries via Knex (100% coverage) + AST `guard:knex-column-references` | MITIGATED |
| XSS (stored) | Input sanitization middleware, DOMPurify on output | MITIGATED |
| Request body tampering | Zod schema validation on all inputs | MITIGATED |
| **Spoofed assessment score** (client `totalScore` trusted) | **Server-side scoring** (BUG-WF52-SCORING-CALCULATOR-MISSING) | MITIGATED (in code; extend to all instruments + staging replay remaining) |
| **Strict registration validation** (DOB / phone / Medicare schemas) | BUG-WF31-VALIDATION-MISSING | MITIGATED |
| Audit log tampering | INSERT-only for app_user, hash chain integrity | MITIGATED |
| **Clinical note DB-write tampering** (post-signing edit of content row) | **Signed-content hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH; AHPRA Standard 6) | MITIGATED (in code; staging tamper drill remaining) |
| Clinical note concurrent-edit silent loss | Optimistic locking (ETag/If-Match), signed notes immutable | MITIGATED |
| **PHI-key absence at runtime** (PHI stored plaintext) | **PHI encryption key MANDATORY** (BUG-ARCH-PHI-KEY-MANDATORY) — fails closed outside tests | MITIGATED (staging+prod secret-contract validation remaining) |
| **PHI-key compromise** (no rotation path) | **Versioned PHI keyring + active version** (BUG-ARCH-PHI-KEY-ROTATION) | MITIGATED (live rotation drill remaining) |
| API parameter tampering | UUID validation middleware, type coercion via Zod | MITIGATED |
| **Empty WHERE on UPDATE/DELETE** | `guard:empty-where-on-mutation` structurally banned | MITIGATED |
| **eRx payload tampering** (NPDS plaintext) | **NPDS sign + encrypt modes** (RSA-SHA256 + AES-256-GCM; BUG-WF81-NPDS-PAYLOAD-ENCRYPTION) | MITIGATED (staging partner validation remaining) |
| **Prescriber impersonation** (NULL HPI-I bypass) | **Strict prescriber HPI-I gate** (BUG-WF81-HPII-MISSING) | MITIGATED |
| **AI-draft sign attestation bypass** | **Safety-locked** (no runtime bypass flag; BUG-WF51-ATTESTATION-BYPASS) | MITIGATED |

### R — Repudiation
| Threat | Mitigation | Status |
|---|---|---|
| Deny clinical actions | Database audit triggers (126 tables), hash chain | MITIGATED |
| Deny record access | API-level read-access audit logging | MITIGATED |
| Deny login | Session log with IP, user agent, timestamp | MITIGATED |

### I — Information Disclosure
| Threat | Mitigation | Status |
|---|---|---|
| Cross-tenant data leak | PostgreSQL RLS (191 tenant-scoped tables), separate DB role | MITIGATED |
| **Owner-role RLS bypass** | **FORCE RLS baseline** (BUG-ARCH-FORCE-RLS-BASELINE) — owner role cannot bypass RLS | MITIGATED (in code; staging/prod DBA posture proof `ALTER ROLE owner-role NOBYPASSRLS` remaining) |
| **Worker dispatch without tenant context** (cross-clinic outreach leak) | **`withTenantContext` wrapper** (BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT) | MITIGATED (in code; controlled drain/replay remaining) |
| PHI in error messages | Global error handler strips details, Sentry PHI scrubbing | MITIGATED |
| PHI in logs | Pino logger redacts 20+ PHI fields | MITIGATED |
| PHI at rest | AES-256-GCM encryption for Medicare/IHI/DVA | MITIGATED |
| **Scribe consent revoke mid-stream PHI persistence** | **`/llm/ambient-note` re-checks consent at post-upload + post-processing; best-effort deletes audio on revoke** (BUG-WF51-CONSENT-REVOKE-RACE) | MITIGATED |
| **AI diagnostic claim without qualifier** | **Non-diagnostic egress posture via `responseGuard`** (BUG-SCRIBE25-001) | MITIGATED (in code; UAT + governance sign-off remaining) |
| PHI in browser | sessionStorage (not localStorage), no console.log of PHI | MITIGATED |
| **Patient match by name+DOB false-positive** (notes attached to wrong patient) | **Clinic-scoped patient resolution hardening** (BUG-WF71-PATIENT-MATCH-NAIVE) — rejects cross-clinic patientId, blocks demographic quick-register on duplicate candidates | MITIGATED (in code; operator UAT remaining) |
| **Frontend security gates fail-OPEN on error** (clinician sees gated PHI surface) | **Fail-CLOSED anchor** (BUG-416) — no `() => true` predicate on isError | MITIGATED |
| File exposure | Authenticated /uploads endpoint | MITIGATED |
| **Malicious file upload (no MIME check)** | **MIME allowlist + signature + AV policy** (BUG-WF71-UPLOAD-MIME-VALIDATION) | MITIGATED (in code; staging AV-required mode remaining) |

### D — Denial of Service
| Threat | Mitigation | Status |
|---|---|---|
| API flooding | Three-tier rate limiting (API/Auth/LLM) | MITIGATED |
| Connection pool exhaustion | Pool monitoring, transaction timeout (30s), SSE caps (500), `guard:pool-budget-contract` | MITIGATED |
| Large payload | 2MB JSON limit, 20MB file limit, multer error handling | MITIGATED |
| **Email worker disappearance (silent backlog)** | **Non-stub worker + dispatch tests + worker failure observability** (BUG-WF42-EMAIL-WORKER-STUB + BUG-SA-008) | MITIGATED |
| **Background-job silent failure (no DLQ retention)** | **`guard:worker-failure-observability`** | MITIGATED |

### E — Elevation of Privilege
| Threat | Mitigation | Status |
|---|---|---|
| Clinician → Admin | RBAC middleware (`requireRoles`), permission checks | MITIGATED |
| App user → DB owner | Separate `app_user` DB role, cannot ALTER/DROP | MITIGATED |
| JWT claim manipulation | Cryptographic signing (HS256), clinicId from DB not user input | MITIGATED |

---

## Residual Risks

| Risk | Likelihood | Impact | Acceptance |
|---|---|---|---|
| Zero-day in Node.js/Express | Low | High | Accept — mitigated by regular patching |
| Insider threat (admin misuse) | Medium | High | Accept — mitigated by tamper-evident audit trail + clinical-note signature hash + Layer 0a discipline |
| Ollama model poisoning | Low | Medium | Accept — AI output reviewed by clinician + non-diagnostic egress posture (BUG-SCRIBE25-001) |
| Quantum computing threat to AES-256 | Very Low | Critical | Monitor — no action required pre-2030 |
| **2026-12-31 allowlist expiry cliff** (~1,479 entries) | High | High | **Track — proactive burn-down plan tracked as BUG-ARCH-ALLOWLIST-TIMEBOMB-2026-12-31** |
| **Staging-evidence gates** for ~30 in-progress S0/S1 BUGs | Medium | Medium | Track — see [docs/quality/bugs-remaining.md](../quality/bugs-remaining.md) |

## May-2026 closure-wave deltas (added to model)

The 2026-05-28 S0 closure wave added the following STRIDE-tracked mitigations: JWT ghost-session fix, atomic failed-login counter, MFA attempt cap, password-reset flow, patient-app rate limits (login + activation), server-side scoring, strict registration validation, clinical-note signature hash, PHI key mandatory, versioned PHI keyring, FORCE RLS baseline, NPDS sign+encrypt, strict HPI-I gate, AI-draft attestation safety-lock, scribe consent revoke mid-stream, scribe non-diagnostic egress, patient match hardening, frontend fail-CLOSED, MIME+AV upload, worker tenant context, email worker non-stub + observability. Each row above is annotated with the relevant BUG-ID for cross-reference.

## Cross-references

- [`docs/gold-standard/security-features.md`](../gold-standard/security-features.md) — full control inventory
- [`docs/gold-standard/compliance.md`](../gold-standard/compliance.md) — APP / HIPAA / ACHS / RANZCP mappings
- [`docs/quality/bugs-remaining.md`](../quality/bugs-remaining.md) — live BUG ledger
