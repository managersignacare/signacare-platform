# SIGNACARE EMR — Gold Standard Security & Architecture Audit

**Date:** 30 March 2026
**Auditor:** Expert system architect, coding expert, quality & security tester
**Scope:** Full stack — API, Frontend, Database, Infrastructure
**Method:** Static code analysis + runtime testing + database introspection + competitive benchmarking

---

## Executive Summary

The Signacare EMR codebase was subjected to a deep security and quality audit across three dimensions: API architecture, frontend security, and database integrity. The audit was benchmarked against gold standards including OWASP Top 10, NSQHS Standards, Australian Privacy Act 1988, and FHIR R4 conformance requirements.

**Overall Assessment:** The core architecture is sound (RLS-based multi-tenancy, JWT HttpOnly cookies, CSRF protection, parameterized queries), but there are **critical security gaps** that must be addressed before any production deployment or public health tender submission.

---

## CRITICAL FINDINGS (Must Fix Before Production)

### SEC-01: FHIR Routes Have No Authentication

- **Severity:** CRITICAL
- **Location:** `apps/api/src/integrations/fhir/fhirRoutes.ts` — no `authMiddleware` on router
- **Impact:** All 15 FHIR endpoints (Patient, Condition, Medication, Allergy, Encounter, Observation, Practitioner, Organization) are publicly accessible. The new POST Patient, POST Observation, and GET $export endpoints allow unauthenticated reads and writes of patient PII.
- **Gold Standard:** FHIR R4 mandates OAuth2/SMART for all protected resources. No healthcare standard permits unauthenticated access to patient data.
- **Fix:** Add `router.use(authMiddleware)` to fhirRoutes.ts. For external system access, implement Bearer token or HMAC-based auth.

### SEC-02: /uploads Directory Served Without Authentication

- **Severity:** CRITICAL
- **Location:** `apps/api/src/server.ts` line 201 — `app.use('/uploads', express.static(...))`
- **Impact:** Patient documents, clinical attachments, audio recordings (BUG-27 fix saves audio here) are accessible to anyone who can guess the UUID filename. No authentication, no authorization, no access logging.
- **Gold Standard:** NSQHS Standard 1 (Clinical Governance) requires access controls on all patient records. OWASP A01:2021 (Broken Access Control).
- **Fix:** Replace static serving with an authenticated download endpoint that checks the requesting user's clinic_id matches the file's patient's clinic_id.

### SEC-03: Zitavi API Key Exposed in Frontend JavaScript Bundle

- **Severity:** CRITICAL
- **Location:** `apps/web/src/features/patients/components/detail/tabs/TrackingTab.tsx` line 27 — `import.meta.env.VITE_ZITAVI_API_KEY`
- **Impact:** The API key is baked into the production JS bundle and visible in browser DevTools. Anyone can extract it and access the Zitavi EMR gateway directly.
- **Fix:** Remove `VITE_ZITAVI_API_KEY` from frontend. Proxy all Zitavi calls through the backend API (which already has the key server-side).

### SEC-04: Patient PHI Logged to Browser Console in Production

- **Severity:** CRITICAL
- **Location:** `apps/web/src/features/patients/components/registration/PatientRegistrationWizard.tsx` line 115 — `console.log('[PatientWizard] Submitting:', dto)`
- **Impact:** Medicare numbers, IHI numbers, DVA numbers, phone numbers, full patient demographics logged to browser console on every registration. Persists in console until cleared. On shared clinical workstations, visible to subsequent users.
- **Additional:** `apps/web/src/features/auth/services/authApi.ts` lines 12-18 — staff emails logged on every login attempt.
- **Gold Standard:** Australian Privacy Act 1988 Section 13G — unauthorized collection/disclosure of healthcare identifiers.
- **Fix:** Remove or wrap behind `import.meta.env.DEV` check.

### SEC-05: Privacy Routes Have No Authentication

- **Severity:** CRITICAL
- **Location:** `apps/api/src/features/privacy/privacyRoutes.ts` — no `authMiddleware`
- **Impact:** Patient data export and anonymization endpoints accessible without authentication.
- **Fix:** Add `router.use(authMiddleware)`.

### SEC-06: 62 PHI Columns Stored as Plain Text

- **Severity:** CRITICAL (compliance)
- **Location:** 16 tables including `patients`, `patient_contacts`, `billing_accounts`, `staff`
- **Affected Data:** Medicare numbers, IHI numbers, DVA numbers, phone numbers, email addresses, physical addresses
- **Gold Standard:** My Health Records Act 2012 requires "reasonable security safeguards" for healthcare identifiers. Column-level encryption (pgcrypto) or application-level encryption recommended for identifiers.
- **Fix:** Implement application-level encryption for the 8 most sensitive columns: `medicare_number`, `ihi_number`, `dva_number`, `phone_mobile`, `phone_home`, `email_primary`, `address_line1`, `nok_phone`. Use AES-256-GCM with a key management service.

---

## HIGH FINDINGS (Fix Before Clinical Use)

### SEC-07: XSS via dangerouslySetInnerHTML Without DOMPurify

- **Location:** `MarkdownRenderer.tsx` line 18 — renders AI-generated and clinician-authored notes as HTML
- **Additional:** 6 files use `document.write()` with unsanitized patient data for print views
- **Impact:** Stored XSS could exfiltrate PHI from any clinician who views a compromised note
- **Fix:** Add DOMPurify. Create `escapeHtml()` utility for all print window template literals.

### SEC-08: ErrorBoundary Component Exists But Is Never Used

- **Location:** `ErrorBoundary.tsx` exists but is imported nowhere. No route-level error boundary.
- **Impact:** Any React component crash = blank white page. In a clinical EMR during active patient care, this is a patient safety issue.
- **Fix:** Wrap `<ProtectedLayout>` and `<PublicLayout>` with `<ErrorBoundary>`.

### SEC-09: Password Hash, MFA Secret, Refresh Token in Memory

- **Location:** `staffRepository.ts` — `findByEmail()`, `findById()`, `listByClinic()` return full `StaffRow` including `password_hash`, `mfa_secret`, `recovery_codes`, `outlook_refresh_token`
- **Impact:** These traverse the full call stack. If any logging middleware, error handler, or APM tool serializes request/response objects, secrets leak.
- **Fix:** Use explicit `.select()` column lists instead of `SELECT *`. Never load `password_hash` except in the auth flow.

### SEC-10: err.message Leaked in 20+ API Responses

- **Location:** FHIR routes (5 handlers), Outlook routes (6), LLM routes (11), Zitavi routes (2)
- **Impact:** Internal error messages reveal database table names, column names, connection details, third-party service URLs
- **Gold Standard:** OWASP A09:2021 (Security Logging and Monitoring Failures)
- **Fix:** Replace `res.json({ error: err.message })` with `next(err)` to use the global error handler.

### SEC-11: 17 Staff FK Relationships Use SET NULL

- **Location:** `clinical_notes.author_id`, `prescriptions.prescribed_by_staff_id`, `audit_log.staff_id`, etc.
- **Impact:** Deleting a staff member NULLs out their name on clinical notes, prescriptions, and audit logs. Violates NSQHS Standard 1 (entries must be attributable to their author indefinitely).
- **Fix:** Change to RESTRICT. Use soft-delete for staff records.

### SEC-12: 6 Patient-Data Tables Without clinic_id or RLS

- **Tables:** `patient_attachments`, `patient_legal_attachments`, `patient_team_assignments`, `group_session_attendees`, `planned_transition_assignments`, `sms_campaign_recipients`
- **Impact:** In multi-tenant deployment, cross-tenant data access possible via patient_id enumeration
- **Fix:** Add `clinic_id` column + RLS policy to each table.

### SEC-13: Patient Identifiers Persisted to localStorage

- **Location:** `workspaceStore.ts` — patient names and EMR numbers persisted to `localStorage` under key `signacare-workspace`
- **Impact:** PHI survives browser restarts, accessible to any script on the same origin
- **Fix:** Switch to `sessionStorage` or persist only patient UUIDs (re-fetch names on load).

### SEC-14: 2 Critical Clinical Tables Missing Audit Triggers

- **Tables:** `clozapine_registrations`, `lai_schedules`
- **Impact:** Changes to clozapine monitoring status and LAI injection schedules are not audited. Both are high-risk medication management activities.
- **Fix:** Add audit triggers.

---

## MEDIUM FINDINGS

| # | Finding | Location | Impact |
|---|---|---|---|
| M-01 | Command injection surface in backup routes | `backupRoutes.ts` line 141 — `dbPass` shell escaping incomplete | Attacker with control of DB_PASSWORD env could inject commands |
| M-02 | TOCTOU race conditions (3 instances) | `episodeRoutes.ts`, `referralRoutes.ts`, `zitaviSyncRoutes.ts` | Concurrent requests can create duplicate records |
| M-03 | 40+ direct `process.env` accesses bypass config.ts | Secrets like `DB_PASSWORD`, `SAFESCRIPT_CLIENT_SECRET`, `API_KEYS` | No Zod validation on these values |
| M-04 | Pool monitoring `setInterval` never cleared | `db.ts` line 116 | Minor memory leak |
| M-05 | SSE idle cleanup `setInterval` never cleared | `sseRoutes.ts` line 97 | Minor memory leak |
| M-06 | CSRF fallback to static string | `apiClient.ts` line 79 — `'signacare-spa'` | Header-presence-only CSRF is weaker than token-based |
| M-07 | OAuth redirect URL not validated | `ConnectOutlookButton.tsx` | Server-supplied URL used for navigation without origin check |
| M-08 | `auth_bypass` RLS policy allows full table access | `staff`, `mfa_secrets`, `staff_sessions` | By design for login flow, but overly permissive |

---

## LOW FINDINGS

| # | Finding | Location |
|---|---|---|
| L-01 | Redis subscriber not closed on shutdown | `sseRoutes.ts` |
| L-02 | Multiple Redis instances without shutdown hooks | `redis.ts` — 3 instances, only 1 closed |
| L-03 | Backup scheduler starts on import (side effect) | `backupRoutes.ts` line 227 |
| L-04 | Silent catch blocks in server.ts | Lines 93, 425, 462 — intentional but undocumented |
| L-05 | MFA upsert has TOCTOU race (unlikely to be triggered) | `authRepository.ts` |
| L-06 | Subscription data in localStorage | `SubscriptionPage.tsx` — billing, not PHI |
| L-07 | FHIR GET endpoints have no try/catch (8 of 15) | Unhandled async rejections in Express 4 |

---

## POSITIVE FINDINGS (Gold Standard Met)

| Area | Assessment | Evidence |
|---|---|---|
| SQL injection | SAFE | All `db.raw()` and `whereRaw()` use parameterized `?` placeholders |
| Password storage | SAFE | bcrypt with 10 rounds, lockout after 5 failures |
| JWT implementation | SAFE | HttpOnly cookies, separate access/refresh tokens, clinicId from DB not user input |
| CSRF protection | ADEQUATE | Header-presence check + SameSite cookie policy |
| RLS coverage | GOOD | 106/106 tables with `clinic_id` have RLS policies |
| RLS scoping | CORRECT | `set_config(..., true)` for transaction-local scope, no connection-level leaks |
| Soft-delete | GOOD | 0 orphaned records across clinical tables |
| Check constraints | EXCELLENT | Every table has at least one CHECK constraint (860 total) |
| Session management | GOOD | No stale sessions, proper revocation |
| Audit trail | GOOD | 42 tables audited via triggers (17/19 critical clinical tables covered) |
| Rate limiting | PRESENT | Redis-backed rate limiting with per-endpoint configuration |
| Input validation | GOOD | Zod schemas on all major create/update endpoints |
| Node.js version | SAFE | v20.20.1 — AsyncLocalStorage context propagation reliable |
| Dependency versions | CURRENT | Express 4.x, Knex latest, React 18 |

---

## COMPARISON TO GOLD STANDARDS

### OWASP Top 10 (2021)

| Risk | Status | Notes |
|---|---|---|
| A01: Broken Access Control | **FAIL** | FHIR routes unauthenticated, /uploads public |
| A02: Cryptographic Failures | **FAIL** | PHI stored as plain text, no column encryption |
| A03: Injection | **PASS** | Parameterized queries throughout |
| A04: Insecure Design | **PASS** | RLS architecture, separate DB roles |
| A05: Security Misconfiguration | **PARTIAL** | FHIR/privacy routes missing auth |
| A06: Vulnerable Components | **PASS** | No known CVEs in dependencies |
| A07: Auth Failures | **PASS** | JWT + CSRF + MFA + lockout |
| A08: Data Integrity | **PARTIAL** | No content signing, no optimistic locking on most routes |
| A09: Logging Failures | **PARTIAL** | Good audit triggers but PHI in console.log |
| A10: SSRF | **PASS** | No user-controlled URLs in server-side requests |

### NSQHS Standards (Australian Healthcare)

| Standard | Status | Notes |
|---|---|---|
| Standard 1: Clinical Governance | **PARTIAL** | Audit trail good, but SET NULL on staff FKs violates attribution requirement |
| Standard 4: Medication Safety | **PASS** | Prescriber gating, dose anomaly detection, clozapine monitoring |
| Standard 6: Communicating for Safety | **PASS** | ISBAR escalation schema, shift handover structure |
| Standard 8: Recognising Deterioration | **PASS** | NEWS2, structured observations, automated flag raising |

### Australian Privacy Act / My Health Records Act

| Requirement | Status | Notes |
|---|---|---|
| Reasonable security safeguards for PHI | **PARTIAL** | RLS good, but no encryption at rest for identifiers |
| Healthcare identifier protection | **FAIL** | Medicare/IHI/DVA stored as plain varchar |
| Audit trail for PHI access | **PARTIAL** | DB triggers good, but no API-level access logging per-patient |
| Right to access/correct | **PRESENT** | Privacy routes exist but unauthenticated |

---

## PRIORITY REMEDIATION PLAN

### Immediate (Before Any Clinical Use)

1. **SEC-01:** Add `authMiddleware` to FHIR routes
2. **SEC-02:** Replace `/uploads` static serving with authenticated endpoint
3. **SEC-03:** Remove `VITE_ZITAVI_API_KEY` from frontend, proxy via backend
4. **SEC-04:** Remove console.log of patient data, wrap auth logs behind DEV check
5. **SEC-05:** Add `authMiddleware` to privacy routes
6. **SEC-08:** Wrap main app layout with ErrorBoundary

### Before Production Deployment

7. **SEC-06:** Implement encryption for Medicare/IHI/DVA numbers
8. **SEC-07:** Add DOMPurify to MarkdownRenderer and all document.write calls
9. **SEC-09:** Use explicit column select instead of SELECT * on staff table
10. **SEC-10:** Replace err.message in 20+ handlers with next(err)
11. **SEC-11:** Change SET NULL to RESTRICT on clinical staff FKs
12. **SEC-12:** Add clinic_id + RLS to 6 patient-data tables
13. **SEC-13:** Move patient tab data to sessionStorage
14. **SEC-14:** Add audit triggers to clozapine_registrations and lai_schedules

### Before Public Health Tender

15. **M-01:** Fix backup shell escaping
16. **M-02:** Add transaction wrapping to TOCTOU patterns
17. **M-03:** Route all process.env access through config.ts with Zod validation

---

*End of Audit Report*
