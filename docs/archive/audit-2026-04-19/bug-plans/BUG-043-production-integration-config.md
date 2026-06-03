# BUG-043 — Production integration-config startup check (fail-fast on silent MOCK fallbacks)

**Severity:** S0 | **Track:** A | **Wave:** A-2 | **Date:** 2026-04-21

---

## 1. Metadata

| Field | Value |
|---|---|
| Bug ID | BUG-043 |
| Plan source | EXECUTION-PLAN-v3-FULL §2.1 Wave A-2 |
| Related | BUG-042 (server lifecycle), CLAUDE.md §6.2 (secrets fail loudly) |
| Owner | Security Approver |
| Change-class | risky (server boot lifecycle + integration production behaviour) |

## 2. Diagnosis

17 integration subdirectories exist under `apps/api/src/integrations/`. Most gate behaviour through `isXxxConfigured()` checks, but several silently return mock success in production when env vars are unset — **clinicians believe real data is flowing (eRx dispatch, patient SMS/push notifications) while the integration returns fake success**, and no production-boot-time assertion exists to prevent this. CLAUDE.md §6.2 requires secrets fail loudly when missing; this fix enforces that at startup.

**Antipatterns verified in code:**
- `fcm/fcmClient.ts:52-74` — silent mock returns `{ successCount: tokens.length, failureCount: 0 }` when `FCM_SERVICE_ACCOUNT_PATH` unset. Push notifications silently drop.
- `acs/acsClient.ts:55-77` — silent mock returns `MOCK-<uuid>` when `ACS_CONNECTION_STRING` unset. SMS silently drops.
- `escript/erxRestClient.ts:20-25` — uses `?? ''` for env vars; empty strings pass `isConfigured()` check at line 144.
- `escript/npdsClient.ts:32-37` — "stub mode" logs at WARN when TLS cert missing (WARN not ERROR in production).

## 3. Approach — three layers

### Layer 1 — Boot-time assertion
New `apps/api/src/shared/assertProductionIntegrationsConfigured.ts` mirrors existing `assertAiDataResidency()` pattern. Called from `server.ts` after `assertAiDataResidency()` (before `app` is created). In `NODE_ENV=production`, asserts eRx (at least one pathway) + SafeScript + HL7 (if enabled) + FCM + ACS + feature-flag-first obligations + consistency (eRx → HI Service). In dev: WARN-logs missing but does not throw.

### Layer 2 — Fix silent-mock antipatterns
- `fcm/fcmClient.ts` — production throws `AppError` `FCM_NOT_CONFIGURED` instead of mock.
- `acs/acsClient.ts` — production throws `AppError` `ACS_NOT_CONFIGURED` instead of mock.
- `escript/erxRestClient.ts` — `?? ''` → `requireEnv()` at first use.
- `escript/npdsClient.ts` — stub-mode log WARN → ERROR in production.

### Layer 3 — Scope limit + follow-ups
Trust existing `isXxxConfigured()` semantics (not re-auditing each). Filed: BUG-310 (per-clinic config drift, S2 B-11), BUG-311 (SafeScript `.checked` type contract, S3 B-11).

## 4. Reviewer refinement trail

Two pre-execution reviews. Absorbed:

**Review 1 (Tactical):**
- #1 explicit feature-flag-first code shape → implemented
- #3 bulleted remediation list with env-var names → implemented in `ProductionConfigError`
- #4 server.ts try/catch + `process.exit(1)` → implemented
- **Rejected #2** (SafeScript throw) — misattribution; I never planned to change `safeScriptService`. Runtime behaviour unchanged.

**Review 2 (L3-calibre):**
- R1 CrashLoopBackoff rationale → one-liner in header comment
- R2 error message secret-safety (corrected from "PHI-safe") → explicit in remediation builder
- R3 `isXxxConfigured()` scope-limit → documented
- P1 Evidence/Eclipse skip tags → documented

**My own additions neither review caught:**
- Feature-flag-check-vs-DB-availability timing (DB lazy-connects; no new ordering risk).
- Belt-and-suspenders vs sole-defence tagging per integration (see §5 table).

## 5. Belt-and-suspenders vs sole-defence

| Integration | Boot value | Runtime gate |
|---|---|---|
| npdsClient, erxAdapterClient, hiServiceClient | Belt-and-suspenders | `requireEnv()` already throws on first request |
| fcm, acs | **Sole defence** | No runtime throw without this fix |
| erxRestClient | **Sole defence** | `?? ''` passes gates silently today |
| SafeScript | Prevention | Runtime unchanged; boot blocks misconfig |

## 6. Tests (10, red-first)

See test file for T1–T10. Red-first: T1–T6, T9, T10 fail pre-fix (module doesn't exist, mock paths silent). T7, T8 pass unconditionally. Post-fix 10/10 PASS.

## 7. Non-goals (explicit)

- Per-clinic integration config — BUG-310.
- Strengthening individual `isConfigured()` implementations — each integration's own bug.
- Runtime re-validation after env-var hot-swap — not supported; process restart required.
- SafeScript `.checked` type-level contract — BUG-311.

## 8. QA agent verdicts

_Populated post-review._
- **L1 static:** _pending_
- **L2 narrative:** _pending_
- **L3 code judgement:** _pending_
- **L4 clinical safety:** _pending_ (silent-mock → real clinical harm)
- **L5 architecture:** _pending_ (fail-fast boot invariant; SSoT vs `assertAiDataResidency`)
