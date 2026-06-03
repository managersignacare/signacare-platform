# 04 — Security Features

**Last refreshed:** 2026-05-29 (full refresh — supersedes 2026-04-14 baseline; reflects 2026-05-28 S0 closure wave including auth-hardening cluster, PHI key mandatory + versioned keyring + clinical-note signature hash, FORCE RLS baseline, patient-app rate limiting, scribe-25 non-diagnostic posture, d10 repo-hygiene guards, and Layer 0a claim-discipline guards).

OWASP Top 10 mapping + every control with evidence in code or migration. Every row references a real file. Comparison tables at the bottom rate Signacare against Epic / Oracle Cerner / Best Practice.

---

## 1. Authentication

| Control | Mechanism | Where |
|---|---|---|
| Password hashing | bcrypt (cost 12) — `bcryptjs` dep | [auth/authService.ts](../../apps/api/src/features/auth/authService.ts) |
| Password strength policy | length + class rules on change | `authService.changePassword` |
| Failed-login lockout | N failed → lock until `locked_until` | `authService.login` |
| **Atomic failed-login counter** (BUG-WF21-AUTH-COUNTER-RACE) | DB atomic update, eliminates race on lockout boundary | ✅ in code; staging parallel-attempt replay remaining |
| MFA (TOTP) | speakeasy, window = 1 | `verifyMfa` |
| **MFA / OTP attempt cap** (BUG-WF21-OTP-CAP-MISSING) | Bounded retries before lockout | ✅ fixed; `mfaAttemptCap.int.test.ts` + d39 closure pack |
| MFA setup panel | Frontend Settings → Security tab | Fix Registry SIG1 |
| WebAuthn (FIDO2) | passkey registration + challenge | [features/auth/webauthnRoutes.ts](../../apps/api/src/features/auth/webauthnRoutes.ts) |
| **Password-reset request/confirm flow** (BUG-WF22-PWD-RESET-MISSING) | Token table + integration coverage | ✅ fixed; `passwordResetFlow.int.test.ts` + d39 closure pack |
| JWT access token | HS256, 15 min default | `issueTokens` |
| JWT refresh token | HS256, rotating, `jti` per token | `issueTokens` |
| Session-tree reuse detection (RFC 6819 §5.2.2.3) | `family_id` propagated across rotations; replay revokes family | `authService.refresh` |
| **Session row persisted BEFORE access-token issuance** (BUG-WF21-JWT-GHOST-SESSION) | Eliminates ghost-session window | ✅ in code; concurrent-login + session-store fault replay remaining |
| Session idle timeout | Redis sliding window, 30 min default | [sessionIdleMiddleware.ts](../../apps/api/src/middleware/sessionIdleMiddleware.ts) |
| Concurrent session cap | 5 per staff, oldest revoked on login | `authService.login` |
| Break-glass elevation | Requires reason, audits every read | [breakGlassRoutes.ts](../../apps/api/src/features/auth/breakGlassRoutes.ts) |
| SMART-on-FHIR auth | EHR launch + standalone | [smartAuth.test.ts](../../apps/api/tests/smartAuth.test.ts) |
| **Patient-app login rate limiting** (layered; BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT) | Per-IP + per-phone + global tiers | ✅ fixed; `rateLimiting.test.ts` L4/L5b |
| **Patient-app activation attempt cap** (BUG-ARCH-PATIENTAPP-ACTIVATION-ATTEMPT-CAP) | Enumerable invite code defence | ✅ fixed; `rateLimiting.test.ts` L5/L5c |

## 2. Authorization

### 2.1 Role-based (RBAC)

| Control | Mechanism | Where |
|---|---|---|
| Role enum | `RoleEnum` with 7 roles: superadmin, admin, clinician, manager, receptionist, referral_coordinator, readonly | [rbac.schemas.ts](../../packages/shared/src/rbac.schemas.ts) |
| Permission enum | `PermissionEnum` (~60 permissions) | same |
| Role → permission matrix | `ROLE_PERMISSIONS` | same |
| `requirePermission` middleware | Any-of semantics against `req.user.permissions` | [rbacMiddleware.ts](../../apps/api/src/middleware/rbacMiddleware.ts) |
| `requireRole` / `requireRoles` | Single + any-of variants | same |
| Forbidden access audit | Every 403 writes an audit row | [forbiddenAccessAudit.ts](../../apps/api/src/middleware/forbiddenAccessAudit.ts) |
| **Service-layer AuthContext mandate** (CLAUDE.md §13) | Every new service method takes AuthContext as first param | ✅ + `guard:service-auth-context` |
| **Frontend security gates fail-CLOSED** (BUG-416) | No `() => true` predicate on `isError`; safe module-visibility delegation | ✅ + `R-FIX-BUG-416-FAIL-OPEN-ABSENT` + `R-FIX-BUG-416-NO-TRUE-PREDICATE-IN-ERROR` anchors |

### 2.2 Per-staff module-access ABAC

A second authorisation layer lets a clinic admin grant or **revoke** per-module access for an individual staff member beyond what their role implies.

| Control | Mechanism | Where |
|---|---|---|
| Canonical module keys | `MODULE_KEYS` — 36+ keys (31 legacy snake_case + 5 new kebab-case) | [moduleKeys.ts](../../apps/api/src/shared/moduleKeys.ts) |
| Grant storage | `staff_module_access (staff_id, clinic_id, module, access_level)` | baseline migration |
| `requireModuleRead` / `requireModuleWrite` | Checks explicit grant, then falls back to RBAC | [moduleAccessMiddleware.ts](../../apps/api/src/middleware/moduleAccessMiddleware.ts) |
| Explicit deny (`access_level='none'`) | **Beats** RBAC — lets an admin revoke even when the role would allow | same |
| RBAC fallback map | `MODULE_TO_PERMISSION` — each module key maps to any-of RBAC permissions when no explicit row exists | [moduleToPermission.ts](../../apps/api/src/shared/moduleToPermission.ts) |
| Admin / superadmin bypass | `BYPASS_ROLES` short-circuit | `moduleAccessMiddleware.ts` |
| Per-route retrofit | 28 legacy feature routers + 5 new | commit `d30fda1` |
| Backfill migrations | seed `write` grants for clinicians/admins so retrofit is additive-safe | baseline backfill migrations |
| Admin matrix UI | Org Settings → Access Control (staff × module matrix with tri-state selector) | [ModuleAccessMatrix.tsx](../../apps/web/src/features/staff-settings/components/ModuleAccessMatrix.tsx) |
| Four-eyes self-edit guard | Non-superadmin admins cannot edit their own grants (`CANNOT_EDIT_OWN_GRANTS`) | [staffSettingsRoutes.ts](../../apps/api/src/features/staff-settings/staffSettingsRoutes.ts) |

### 2.3 Tenant isolation

| Control | Mechanism | Where |
|---|---|---|
| Row-level security | Every specialty + clinical table has `tenant_isolation` RLS policy; middleware injects `app.clinic_id` per request | [rlsMiddleware.ts](../../apps/api/src/middleware/rlsMiddleware.ts) |
| **FORCE RLS baseline** (BUG-ARCH-FORCE-RLS-BASELINE) | Owner role cannot bypass RLS; backfill migration + tenant-safe integration coverage | ✅ in code; staging/prod DBA posture proof (`ALTER ROLE owner-role NOBYPASSRLS`) remaining; `forceRlsBaseline.int.test.ts` |
| Application-layer `clinic_id` filter | CLAUDE.md §1.3 — every query includes `clinic_id` in the WHERE | `guard:query-has-clinic-id` |
| **Empty-WHERE-on-mutation guard** | UPDATE/DELETE without WHERE is structurally banned | `guard:empty-where-on-mutation` (0 baseline violations) |
| Uploads tenant guard | Upload URL must match authed clinic | [uploadsTenantGuard.test.ts](../../apps/api/tests/uploadsTenantGuard.test.ts) |
| **Patient-outreach worker tenant context** (BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT) | Worker dispatch executes through `withTenantContext` | ✅ in code; controlled drain/replay remaining; `bugWf42OutreachWorkerTenantContext.int.test.ts` |

## 3. Data protection (PHI architecture)

| Control | Mechanism | Where |
|---|---|---|
| TLS termination | nginx + Let's Encrypt | deploy runbook |
| PHI encryption at rest | AES-256-GCM on `medicare_number`, `ihi_number`, `dva_number` | [phiEncryption.ts](../../apps/api/src/utils/phiEncryption.ts) + [phi-encryption.test.ts](../../apps/api/tests/phi-encryption.test.ts) |
| **PHI encryption key MANDATORY at runtime** (BUG-ARCH-PHI-KEY-MANDATORY) | Fails closed outside tests when PHI / blind-index key missing | ✅ in code; staging+prod secret-contract validation remaining; `config.ts` |
| **Versioned PHI keyring + active key version** (BUG-ARCH-PHI-KEY-ROTATION) | `PHI_ENCRYPTION_KEYRING_JSON` with active version pointer enables rotation | ✅ in code; operational rotation runbook + live rotation drill remaining |
| Blind indexes | HMAC-SHA256 for deterministic lookup on encrypted columns | [blindIndex.ts](../../apps/api/src/shared/blindIndex.ts) |
| **Clinical-note signed-content hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) | DB-write tamper detection (AHPRA Standard 6) | ✅ in code; staging tamper drill remaining |
| Audio retention | Transcripts auto-purged after 30 days | [audioRetentionScheduler.ts](../../apps/api/src/jobs/schedulers/audioRetentionScheduler.ts) |
| Secrets management | Env vars only; loud fail on missing; no fallbacks | [secrets.test.ts](../../apps/api/tests/secrets.test.ts) |
| **Env-contract catalog SSoT** (BUG-INFRA-ENV-CONTRACT-GAP) | 5 templates × 197 runtime env keys × 197 catalog keys; AST-based discovery guard | ✅ fixed; [docs/operations/env-contract-catalog.md](../operations/env-contract-catalog.md) + `guard:env-template-contract` |
| PHI masking view | `patients_masked` | |
| Anonymise path (APP 11.2) | [privacy/](../../apps/api/src/features/privacy/) — uses `set_config()` | |
| DB_PASSWORD never on command line | Backup `pg_dump` + `gzip` use `spawn` + programmatic pipe; PGPASSWORD via child env | [backupRoutes.ts](../../apps/api/src/features/backup/backupRoutes.ts) + Fix Registry BINRES4 |

## 4. Input validation

| Control | Mechanism | Where |
|---|---|---|
| Zod schemas on every route body | `@signacare/shared` schemas imported per feature | |
| Zod errors → 422 | [errors.ts](../../apps/api/src/shared/errors.ts) | |
| **Strict patient registration validation** (BUG-WF31-VALIDATION-MISSING) | Shared strict DOB/phone/Medicare schemas across create/quick-register/duplicate-check | ✅ in code; staging replay remaining; `bugWf31RegistrationValidation.int.test.ts` |
| **Server-side assessment scoring** (BUG-WF52-SCORING-CALCULATOR-MISSING) | Client `totalScore` no longer authoritative; mismatch telemetry + spoof-resistance regression | ✅ in code; extend across all instruments + staging replay remaining |
| **File upload MIME + signature check + AV policy** (BUG-WF71-UPLOAD-MIME-VALIDATION) | `assertReferralAttachmentSafe` on referral upload | ✅ in code; staging AV-required mode replay remaining; `bugWf71ReferralAttachmentSafety.int.test.ts` |
| Body size cap | `express.json({ limit: '25mb' })` | |
| CSRF | Double-submit cookie + `X-CSRF-Token` header | |

## 5. Output / rendering

| Control | Mechanism |
|---|---|
| No `innerHTML` with dynamic content | CLAUDE.md §6.1 |
| DOMPurify for HTML fields | `dompurify` dep |
| camelCase response middleware | Fix Registry CC-MW1 / CC-MW2 |
| Error responses sanitised | `toErrorResponse` — no stack traces, no SQL |
| **Response-shape Zod validation mandate (CLAUDE.md §5.3)** | Every new route ends with `Schema.parse(value)`; existing 884-entry allowlist drains per BUG-638-CASCADE |

## 6. Network / transport

| Control | Mechanism |
|---|---|
| Helmet headers | CSP, HSTS, X-Frame-Options, X-Content-Type, Referrer-Policy |
| CORS allowlist | `CORS_ORIGIN` env, rejects others |
| Rate limiting | express-rate-limit + Redis, strict `/auth/login` limiter |
| SSRF guard | [validateOutboundUrl.ts](../../apps/api/src/shared/validateOutboundUrl.ts) — blocks RFC 1918, link-local, loopback, metadata, IPv6 private, non-https |
| Security headers test | [securityHeaders.test.ts](../../apps/api/tests/integration/securityHeaders.test.ts) |

## 7. Child-process hardening

Every shell-out in the codebase goes through one auditable pattern.

| Control | Mechanism | Where |
|---|---|---|
| Shared binary resolver | `${NAME}_PATH` env override → fixed list of well-known absolute dirs → fall-through. Cached per name. | [binaryResolver.ts](../../apps/api/src/shared/binaryResolver.ts) |
| Backup pipeline | `pg_dump` + `gzip` wired via `spawn` + programmatic stdio pipe — no shell string, no template interpolation, DB_PASSWORD via child env | [backupRoutes.ts](../../apps/api/src/features/backup/backupRoutes.ts) |
| Gunzip verification | `execFileSync(gunzipBin, ['-t', filepath])` — array args, zero shell | same |
| LLM training (ollama create) | Regex-validated `adapterName` + `baseModel` BEFORE any child_process; `execFile` + array args | [llmTrainingRoutes.ts](../../apps/api/src/features/llm/llmTrainingRoutes.ts) + Fix Registry BINRES6 |
| OCR adapter | `ocrmypdf` / `pdftotext` / `tesseract` via `resolveBinary` + array args | [ocrAdapter.ts](../../apps/api/src/ocr/ocrAdapter.ts) |
| Whisper sidecar | `WHISPER_PYTHON` env override → `resolveBinary('python3')`; no-op fallback if unreachable | [bootstrap.ts](../../apps/api/src/jobs/bootstrap.ts) |

## 8. Communications policy — no telecom for staff

The system deliberately ships with **zero telecom (SMS / voice / ACS) on the staff-facing surface**. Patients without the Viva mobile app can still be reached via ACS SMS through a tightly-scoped single dispatcher.

| Control | Mechanism | Where |
|---|---|---|
| Staff notifications | WebSocket-discipline notification centre + FCM push for Sara; **no SMS, ever** | [notificationService.ts](../../apps/api/src/features/notifications/notificationService.ts) |
| NO-SMS CI guard | AST scan blocks `twilio`, `messagebird`, `vonage`, `@azure/communication-*`, `sendSms` declarations, `addJob('sms'…)` queue names outside two allowlisted dirs | [.github/scripts/check-no-telecom.sh](../../.github/scripts/check-no-telecom.sh) |
| eScript SMS allowlist | `apps/api/src/integrations/escript/**` — regulated ETP2 prescription-token delivery | allowlist |
| ACS SMS allowlist | `apps/api/src/integrations/acs/**` — patient outreach fallback ONLY | allowlist |
| ACS caller containment | CI guard pins ACS imports to `patientOutreachService.ts` — no other file may import from `integrations/acs/**` | [.github/scripts/check-acs-callers.sh](../../.github/scripts/check-acs-callers.sh) |
| Patient outreach dispatcher | FCM first if Viva token on file; ACS SMS only if patient has consent + mobile number; audit-logged skip otherwise | [patientOutreachService.ts](../../apps/api/src/features/patient-outreach/patientOutreachService.ts) |
| Consent capture | Per-patient `sms_consent` column + clinician UI in Patient Delivery panel | [patients table alter](../../apps/api/migrations/20260501000000_patient_outreach.ts) |
| Clinician override | Admin may force FCM or ACS on a single send with a mandatory ≥10-char reason; captured in `patient_outreach_log.override_reason` | same |
| Critical-alert fan-out | `kind='critical_alert'` escalates to both channels when available — cannot be silenced | `patientOutreachService.send` |
| Per-clinic monthly SMS budget | Default $50 / month; hard-fails to `skipped` when exhausted | same |

## 9. Tamper evidence

| Control | Mechanism |
|---|---|
| Audit-log tamper triggers | BEFORE UPDATE/DELETE trigger RAISES EXCEPTION |
| Grant-layer revoke | `app_user` REVOKEd UPDATE/DELETE/TRUNCATE on `audit_log` + all children |
| Hash chain | `prev_hash` + `row_hash` per row via `audit_log_hash_chain()` trigger |
| Partitioned retention | Monthly partitions — DROP PARTITION for 7-year retention |
| Immutability test | [auditLogImmutability.test.ts](../../apps/api/tests/integration/auditLogImmutability.test.ts) |
| **Clinical-note signature hash** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) | Per §3 — extends tamper-evidence from audit-log to clinical-note content |
| **Worker failure observability + DLQ retention** (BUG-SA-008) | `guard:worker-failure-observability` enforces failure handlers + DLQ retention baseline across non-stub workers |

## 10. Clinical safety hazards (ISO 14971)

| ID | Hazard | Control | Test |
|---|---|---|---|
| HAZARD-001 | Wrong medication dose displayed | String type guard, verbatim echo | [hazards test](../../apps/api/tests/integration/clinicalSafetyHazards.test.ts) |
| HAZARD-002 | Missed Clozapine neutropenia warning | `classifyAnc` at RANZCP 1.5 × 10⁹/L | [clozapineRiskClassification.test.ts](../../apps/api/tests/unit/clozapineRiskClassification.test.ts) |
| HAZARD-003 | LAI overdue dose not flagged | `computeOverdue` pure fn | [laiScheduling.test.ts](../../apps/api/tests/unit/laiScheduling.test.ts) |
| HAZARD-004 | Duplicate patient records | Fuzzy match → 409 DUPLICATE_PATIENT | [patientCrud.test.ts](../../apps/api/tests/integration/patientCrud.test.ts) |
| HAZARD-005 | Unauthorised medication change | RBAC + module-access ABAC → 401/403 | hazards test |
| HAZARD-006 | Silent data loss on concurrent note edit | `lock_version` + If-Match + 409 NOTE_CONFLICT | hazards test |
| HAZARD-007 | Incorrect episode state transition | `episodeService.update` rejects re-open of closed | [episodeStateMachine.test.ts](../../apps/api/tests/integration/episodeStateMachine.test.ts) |
| HAZARD-008 | PHI in error messages | `toErrorResponse` sanitiser + test | hazards test |
| HAZARD-009 | Consent restriction bypassed | Consent endpoint + 401 gate | hazards test |
| HAZARD-010 | AI scribe invents content | `detectScribeHallucinations` validator | [unit/detectScribeHallucinations.test.ts](../../apps/api/tests/unit/detectScribeHallucinations.test.ts) |
| HAZARD-011 | Taper schedule dose increase | `validateTaperSchedule` monotonic guard | [unit/validateTaperSchedule.test.ts](../../apps/api/tests/unit/validateTaperSchedule.test.ts) |
| HAZARD-012 | DB connection lost mid-request | `/ready` probes pg + redis | [healthEndpoints.test.ts](../../apps/api/tests/integration/healthEndpoints.test.ts) |
| HAZARD-013 | LAI double-advance under concurrent administration | `recordGiven` critical section wrapped in `db.transaction` with `forUpdate` row lock held through write | [laiScheduleService.ts](../../apps/api/src/features/lai/laiScheduleService.ts) + Fix Registry LAI-FIX1..3 |
| HAZARD-014 | Clozapine titration cross-clinic read | `upsertTitrationDay` + `upsertMonitoringCheck` existing-row lookups scoped by `clinic_id` | [clozapineRepository.ts](../../apps/api/src/features/clozapine/clozapineRepository.ts) + Fix Registry CLOZ-FIX1..2 |

All 14 hazards have real assertions — no `it.fails` remain in this suite.

### Hazard-adjacent S0 controls landed May 2026

- **PHQ-9 Q9 / total ≥20 suicide-risk auto-escalation** (BUG-WF52-SUICIDE-ALERT-MISSING) — urgent task + clinical signal in outcomes + patient-app completion paths. `assessmentRisk.test.ts` + `bugWf52AssessmentSuicideRiskEscalation.int.test.ts`.
- **Server-side assessment scoring** (BUG-WF52-SCORING-CALCULATOR-MISSING) — client `totalScore` no longer authoritative; spoof-resistance regression coverage.
- **Safety-plan collaboration attestation gate** (BUG-SCRIBE25-002) — SAFETY_PLAN_COLLAB_ATTESTATION_REQUIRED with audit writes on create/activate/sign.

## 11. LLM / AI safety

| Control | Mechanism |
|---|---|
| Prompt injection hardening | [unit/llmPromptInjection.test.ts](../../apps/api/tests/unit/llmPromptInjection.test.ts) |
| Hallucination detection | `detectScribeHallucinations` |
| K-shot example sanitisation | [buildKShotExamples.test.ts](../../apps/api/tests/buildKShotExamples.test.ts) |
| Per-staff AI access grant | `staff_module_access.module = 'ai'` / `'ai-agent'` / `'medical-scribe'` — three distinct keys | [moduleKeys.ts](../../apps/api/src/shared/moduleKeys.ts) |
| Audio retention scheduler | Auto-purge |
| **Non-diagnostic risk-surfacing posture at AI egress** (BUG-SCRIBE25-001) | Guard-level qualifier injection + labels on diagnosis/summary/agent outputs; non-inferential rail | ✅ in code; staging/UAT verification + governance sign-off remaining; `responseGuard.ts` + `responseGuard.test.ts` |
| **AI-draft sign attestation safety-locked** (BUG-WF51-ATTESTATION-BYPASS) | No runtime bypass flag path across API + web utility guards | ✅ fixed; `bug417AiDraftSignAttestation.int.test.ts` + `aiDraftSignAttestation.test.ts` |
| **Consent revoke mid-stream fail-closed** (BUG-WF51-CONSENT-REVOKE-RACE) | `/llm/ambient-note` re-checks consent at post-upload + post-processing; best-effort deletes audio on revoke | ✅ fixed; `ambientNoteConsentGate.int.test.ts` |

## 12. Mobile (MASVS L1)

| Control | Mechanism |
|---|---|
| Static scan | [mobileMasvsScan.test.ts](../../apps/api/tests/unit/mobileMasvsScan.test.ts) — Dart source scanned for hardcoded secrets, insecure HTTP, `print()` of PHI, WebView JS bridges, root-detection bypass |
| FCM token scoping | Tokens stored by clinic; stolen device token cannot receive another tenant's notifications | [fcmService.ts](../../apps/api/src/integrations/fcm/fcmService.ts) |
| Per-module sync opt-in | Viva patients explicitly opt each module (notifications / appointments / documents / reminders / messages) in/out before any PHI is cached on-device | [patient_sync_preferences](../../apps/api/migrations/20260502000000_mobile_sync_and_fcm.ts) |
| Tombstone-on-disable | Turning a module off clears the local cache on the next delta via server-returned tombstones | [sync_client.dart](../../apps/patient-app/lib/core/services/sync_client.dart) |
| iOS background wake | `UIBackgroundModes = remote-notification, fetch` on Sara + Viva | `ios/Runner/Info.plist` |
| **Cross-language design token codegen** (TS → Dart) | Sara + Viva consume the same design tokens as web; SEVERITY_COLORS / FONT_SIZES / TOUCH_TARGETS in lock-step | ✅ fixed; closes BUG-CROSS-LANG-DESIGN-TOKEN-CODEGEN |
| **Patient-app layered rate limiting** | Login + activation tiers (BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT + ACTIVATION-ATTEMPT-CAP) | ✅ fixed |

## 13. CI / regression guards

The repo ships an exceptionally large guard surface. Counted at last full run:

| Guard | Purpose | Where |
|---|---|---|
| **Fix Registry (2,221 verified anchors)** | Every bug-fix is pinned via a grep pattern so a regression fails CI | [docs/quality/fix-registry.md](../quality/fix-registry.md) + [check-fix-registry.sh](../../.github/scripts/check-fix-registry.sh) |
| **Layer 0a discipline guards** (confidence-label / shortcut-detector / gold-standard-enforcer / dod-completion-checker) | Claim-honesty at pre-commit | `.claude/agents/` + companion guards |
| **Review-attestation tree-hash binding** (BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1) | S0/S1/S2 bug-closure commits require cycle-1 + L3 + L5 review chain; artifact at `.git/signacare-review-attestation.json` | `scripts/guards/check-review-attestation.ts` |
| Commit-claims guard | Every commit-msg claim carries an honest qualifier or backing artifact | `scripts/guards/check-commit-claims.ts` |
| No-telecom | AST scan blocks telecom/ACS imports outside two allowlist dirs | [check-no-telecom.sh](../../.github/scripts/check-no-telecom.sh) |
| ACS callers | ACS imports must come from `patientOutreachService.ts` only | [check-acs-callers.sh](../../.github/scripts/check-acs-callers.sh) |
| Naming conventions | apiClient URL prefix, Knex `.as('camelCase')` ban, `parseInt` radix | [check-naming-conventions.sh](../../.github/scripts/check-naming-conventions.sh) |
| **Service-auth-context** (CLAUDE.md §13) | Every service method takes AuthContext as first param | `guard:service-auth-context` |
| **Query-has-clinic-id** (CLAUDE.md §1.3) | Every patient/clinical query includes `clinic_id` | `guard:query-has-clinic-id` |
| **Empty-WHERE-on-mutation** | UPDATE/DELETE without WHERE structurally banned | `guard:empty-where-on-mutation` |
| **Knex-column-references** (CLAUDE.md §1.1) | AST-walks every Knex builder column reference against `schema-snapshot.json` | `guard:knex-column-references` |
| **Code-writes-real-columns** (CLAUDE.md §12.2) | `.insert/.update` objects must only contain columns existing on target table | `guard:code-writes-real-columns` |
| **Row-iface drift** (CLAUDE.md §15) | Bidirectional: row interfaces match DB schema both directions | `guard:row-iface-drift` |
| **JSONB-extraction** (CLAUDE.md §1.7) | Routes querying JSONB-bearing tables must use mapper that extracts JSONB | `guard:jsonb-extraction` |
| **Migration-RLS-policy** (CLAUDE.md §6.3) | Every clinic_id-bearing table CREATE TABLE must include RLS policy | `guard:migration-rls-policy` |
| **Migration-index-discipline** (CLAUDE.md §7.1) | Every FK + clinic_id + patient_id column must have an index | `guard:migration-index-discipline` |
| **Migration-convention** + **Migration-rollback-discipline** (CLAUDE.md §12.4 + §12) | Taxonomy-enforced raw-SQL annotations + non-empty `down()` with `IF EXISTS` guards | `guard:migration-convention` + `guard:migration-rollback-discipline` |
| **Snapshot freshness** | `schema-snapshot.json` regenerated when migrations change | `guard:snapshot-freshness` |
| **Trx-not-db-inside-transaction** (CLAUDE.md §2.1) | Every query inside `db.transaction` uses `trx`, not `db` | `guard:trx-not-db-inside-transaction` |
| **Soft-delete-filter** (CLAUDE.md §1.4) | SELECTs on tables with `deleted_at` must filter | `guard:soft-delete-filter` (154 baseline allowlisted) |
| **Mapper-naming** + **Zod-schema-parity** (CLAUDE.md §5.1 + §15) | Mapper naming + Zod scaffold parity | `guard:mapper-naming` + `guard:zod-schema-parity` |
| **Bugs-remaining uniqueness** (CLAUDE.md §9.5) | Every BUG-ID in `bugs-remaining.md` appears in exactly one row | `guard:bugs-remaining-uniqueness` |
| **Fix-registry-decisiveness** | No anchor pattern matches more than 5 hits | `guard:fix-registry-decisiveness` |
| **No-fire-and-forget** + **No-silent-catches** (CLAUDE.md §3.4 + §9.6) | Every async call awaited; every rejection observable | `guard:no-fire-and-forget` + `check-no-silent-catches.sh` |
| **No-band-aid-annotations** | TODO / FIXME / "for now" / "interim" must cite BUG-ID OR carry `permanent:` rationale | `guard:no-band-aid-annotations` |
| **Allowlist-expiry** + **Allowlist-burndown-contract** | 2026-12-31 expiry-cluster tracked + burndown contract enforced | `guard:allowlist-expiry` + `guard:allowlist-burndown-contract` |
| **Atomic-catalogue-flip** | bugs-remaining state flip must be in same commit as fix code | `guard:atomic-catalogue-flip` |
| **Worker failure observability** (BUG-SA-008) | Non-stub workers must register failure handlers + DLQ retention | `guard:worker-failure-observability` |
| **Mutation idempotency contract** (BUG-SA-007) | High-risk routes carry idempotency middleware | `guard:route-idempotency-contract` |
| **Forward-fix migration governance** (BUG-SA-009) | Irreversible migrations registered + rehearsal-proof gated | `migration-forward-fix-only-register.json` |
| **Tracked-ignored-files** (BUG-D10-GUARD-TRACKED-IGNORED) | `git ls-files -ci --exclude-standard` must be empty | `guard:tracked-ignored-files` |
| **Zero-byte tracked files** (BUG-D10-GUARD-ZERO-BYTE) | No accidental empty source / data files | `guard:zero-byte-tracked-files` |
| **Env-template contract** (BUG-D10-GUARD-ENV-TEMPLATE) | AST-runtime env-key discovery vs templates; 197 keys verified | `guard:env-template-contract` |
| **Cross-project boundary** (BUG-D10-GUARD-XPROJECT-BOUNDARY) | Blocks raw imports between app/package domains | `guard:cross-project-boundary` |
| **Frontend route contract** | Every `apiClient.*` URL resolves to a backend handler | `guard:frontend-route-contract` |
| **EoP redaction** (BUG-P1) | End-of-prescription content redaction contract | `guard:eop-redaction` |
| **Font coverage** (BUG-GUARD-FONT-COVERAGE) | 15 scripts × FONT_STACKS SSoT × loader URL sync | `guard:font-coverage` |
| **No-explicit-any regression** | TypeScript `any` ratchet | `guard:no-explicit-any-regression` |
| **Lock-version coverage contract** | Multi-writer clinical tables have `lock_version` + optimistic-lock helper | `guard:lock-version-coverage-contract` |

The full set runs in `guard:claude-discipline:ci` for CI and via the local `.husky/pre-commit` hook chain.

## 14. OWASP Top 10 2021 coverage

| OWASP | Signacare control | Where |
|---|---|---|
| A01 Broken Access Control | RBAC + module-access ABAC + RLS + FORCE RLS baseline + break-glass audit + frontend fail-CLOSED | §2, §9 |
| A02 Cryptographic Failures | TLS + AES-256-GCM PHI encryption + blind indexes + versioned PHI keyring + clinical-note signature hash | §3 |
| A03 Injection | Zod + parameterised Knex + CLAUDE.md §1.8 + child-process hardening + Knex-column-references guard | §4, §7 |
| A04 Insecure Design | Threat model + 14-item hazard register + scribe-25 non-diagnostic posture + safety-plan collaboration attestation | §10 |
| A05 Security Misconfiguration | Helmet + loud-fail secrets + env-contract catalog (197 keys) + binary resolver pinning | §3, §5, §7 |
| A06 Vulnerable Components | Dependabot + renovate (recommended) | CI |
| A07 Identification & Auth Failures | MFA + OTP cap + WebAuthn + session-tree reuse detection + JWT ghost-session fix + atomic counter + password-reset flow + patient-app rate limits | §1 |
| A08 Software & Data Integrity Failures | Fix Registry (2,221 anchors) + migration hash chain + Layer 0a discipline guards + review-attestation tree-hash binding | §13 |
| A09 Security Logging & Monitoring | Patient-read audit + forbidden-access audit + tamper-evident `audit_log` + worker failure observability + clinical-note signature hash | §9 |
| A10 Server-Side Request Forgery | `validateOutboundUrl` | §6 |

---

## Comparison — Security posture

| Control | Signacare | Epic | Oracle Cerner | Best Practice |
|---|---|---|---|---|
| MFA (TOTP) | ✅ | ✅ | ✅ | ⚠️ |
| **MFA / OTP attempt cap** | ✅ | ✅ | ✅ | ⚠️ |
| WebAuthn / FIDO2 | ✅ | ✅ | ✅ | ❌ |
| **Atomic failed-login counter** | ✅ | ✅ | ✅ | ⚠️ |
| **Session-row persisted BEFORE token issuance** | ✅ | ✅ | ✅ | ⚠️ |
| RFC 6819 session-tree reuse detection | ✅ | ✅ | ✅ | ❌ |
| **Password-reset flow with token table + integration tests** | ✅ | ✅ | ✅ | ✅ |
| **Patient-app login + activation rate limiting** | ✅ | ✅ (MyChart) | ✅ (HealtheLife) | ⚠️ |
| PHI encryption at rest (AES-256-GCM) | ✅ | ✅ | ✅ | ⚠️ |
| **PHI key MANDATORY at runtime** | ✅ | ⚠️ | ⚠️ | ❌ |
| **Versioned PHI keyring + active-version rotation** | ✅ unique | ⚠️ ops-only | ⚠️ ops-only | ❌ |
| Blind indexes for encrypted lookup | ✅ | ⚠️ | ⚠️ | ❌ |
| **Clinical-note signed-content hash + immutability trigger** | ✅ | ✅ | ✅ | ⚠️ |
| Per-staff ABAC on top of RBAC | ✅ | ✅ | ✅ | ❌ |
| **Service-layer AuthContext mandate + guard** | ✅ unique | ⚠️ vendor-internal | ⚠️ vendor-internal | ❌ |
| **Frontend security gates fail-CLOSED anchor (BUG-416)** | ✅ unique | ⚠️ vendor-internal | ⚠️ vendor-internal | ❌ |
| SSRF outbound guard | ✅ dedicated | ✅ | ✅ | ❌ |
| Tamper-evident audit (REVOKE + triggers + hash) | ✅ | ✅ | ✅ | ⚠️ |
| **FORCE RLS baseline (owner cannot bypass)** | ✅ unique | ❌ | ❌ | ❌ |
| RLS multi-tenant isolation | ✅ | ⚠️ instance-per-tenant | ⚠️ instance-per-tenant | ❌ single-tenant |
| **Empty-WHERE-on-mutation guard** | ✅ unique | ⚠️ vendor-internal | ⚠️ vendor-internal | ❌ |
| Break-glass audit | ✅ | ✅ | ✅ | ⚠️ |
| Prompt-injection tests | ✅ | ⚠️ vendor dependent | ⚠️ vendor dependent | ❌ |
| LLM hallucination validator | ✅ HAZARD-010 | ⚠️ partner | ⚠️ partner | ❌ |
| **Non-diagnostic risk-surfacing posture at AI egress** | ✅ | ❌ | ❌ | ❌ |
| **AI-draft sign attestation safety-locked** | ✅ | ⚠️ banner only | ⚠️ banner only | ❌ |
| **Consent revoke mid-stream fail-closed** | ✅ | ⚠️ | ⚠️ | ⚠️ |
| **PHQ-9 Q9 / total ≥20 server-authoritative suicide-risk escalation** | ✅ | ⚠️ vendor-config | ⚠️ vendor-config | ❌ |
| **Server-side assessment scoring (anti-spoof)** | ✅ | ✅ | ✅ | ⚠️ |
| ISO 14971 hazard register integrated w/ tests | ✅ 14 hazards, all tested | ✅ | ✅ | ⚠️ |
| Child-process command-injection hardening | ✅ shared resolver + array args throughout | ✅ | ✅ | ⚠️ |
| **NO-TELECOM policy + CI guard** | ✅ unique | ❌ | ❌ | ❌ |
| MASVS L1 static mobile scan | ✅ | ✅ | ✅ | ❌ |
| **Cross-language design token codegen** | ✅ | ⚠️ vendor-internal | ⚠️ vendor-internal | ❌ |
| **Fix-registry regression guard (2,221 entries)** | ✅ unique | ❌ internal only | ❌ | ❌ |
| **Layer 0a agent-discipline guards** | ✅ unique | ❌ | ❌ | ❌ |
| **Review-attestation tree-hash binding (S1+)** | ✅ unique | ❌ | ❌ | ❌ |
| **d10 repo-hygiene cluster** (tracked-ignored / zero-byte / env-template / cross-project) | ✅ unique | ❌ | ❌ | ❌ |
| **Worker failure observability + DLQ retention guard** | ✅ | ✅ | ✅ | ⚠️ |
| External pentest report | ⚠️ **scheduled, not commissioned** | ✅ | ✅ | ✅ |
| Formal ISMS (ISO 27001 certification) | ❌ **not yet certified** | ✅ | ✅ | ⚠️ |

**Verdict:** Application-layer security is **gold-standard** for a system of this size and stage. The May 2026 wave (auth hardening: JWT ghost-session, counter race, OTP cap, password reset, patient-app rate limits; PHI architecture: mandatory key, versioned keyring, clinical-note signature hash; FORCE RLS baseline; scribe-25 non-diagnostic posture; attestation safety-lock + consent revoke fail-closed) closes a substantial S0 surface with code shipped and integration coverage in place — staging-evidence gates remain on most. Several controls are **rare even in enterprise EMRs** (fix-registry regression guard, NO-TELECOM policy, child-process hardening with a shared resolver, hallucination detector, session-family reuse detection, per-staff module ABAC with RBAC fallback, FORCE RLS baseline, versioned PHI keyring, clinical-note signature hash, frontend fail-CLOSED anchor, Layer 0a claim-discipline guards, review-attestation tree-hash binding, d10 repo-hygiene cluster, cross-language design token codegen). The outstanding items are **organisational**, not technical:

- **External penetration test** — scheduled but not commissioned
- **ISO 27001 ISMS certification** — roadmap, not yet engaged
- **Cyber-liability insurance** — quotes gathering
- **Staging-evidence gates** for ~30 in-progress BUGs (see [docs/quality/bugs-remaining.md](../quality/bugs-remaining.md))
