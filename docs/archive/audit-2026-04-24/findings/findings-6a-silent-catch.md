# Findings 6a — Silent catch enumeration

**Agent:** E-silent-catch
**Scope:** `.ts` and `.tsx` under `apps/api/src/**`, `apps/web/src/**`, `packages/shared/src/**`.

## Summary

| Tag | Count |
|---|---:|
| `[SILENT]` (unambiguous swallow, no log, no throw) | **34** |
| `[INTENTIONAL_BUT_UNCOMMENTED]` (clearly best-effort but lacking canonical `// intentionally ignored: …`) | ~70 |
| `[PARTIAL]` (has SOME observability — counter/metric — but no log) | ~15 |

## CRITICAL — PHI / security-critical silent swallows

| File:line | Risk |
|---|---|
| `apps/api/src/shared/phiEncryption.ts:60` | **P0** — returns PLAINTEXT on encrypt failure |
| `apps/api/src/shared/phiEncryption.ts:85` | **P0** — returns raw ciphertext on decrypt failure |
| `apps/api/src/utils/phiEncryption.ts:59` | **P0** — duplicate implementation with plaintext fallback |

An encryption-key rotation or HSM blip silently writes plaintext PHI with zero log. This is a **pre-staging blocker class of finding**.

Other security-critical:
| File:line | Risk |
|---|---|
| `apps/api/src/middleware/jwtBlacklist.ts:46,71` | **P0** — `isTokenBlacklisted` + `isUserRevokedAfter` return `false` on Redis error with NO log — silent session-revocation fail-open (undermines BUG-356) |
| `apps/api/src/middleware/licenseMiddleware.ts:50` | Fabricates `{valid:true, edition:'development'}` on module-import failure — silent licence bypass |
| `apps/api/src/middleware/csrfMiddleware.ts:101` | Silently degrades to header-only check on Redis down |
| `apps/api/src/mcp/scribeStreaming.ts:207` | Closes WS with 401 on auth failure but emits NO log — reason lost |

## Top-5 [SILENT] in request handlers (BUG-360 regression family)

1. `apps/api/src/features/auth/authController.ts:118` — login audit write swallowed; login succeeds with no `staff_sessions` / `LOGIN` audit row on DB failure. AHPRA compliance regression.
2. `apps/api/src/features/auth/authController.ts:192` — logout audit symmetric twin. Same shape.
3. `apps/api/src/features/llm/aiJobRoutes.ts:120, 151` — GET `/jobs/:id` returns 404 on any BullMQ/Redis error; GET `/jobs` returns `{jobs:[]}`. Clinician sees empty queue while infra is down.
4. `apps/api/src/features/llm/llmRoutes.ts:953` + `llmTrainingRoutes.ts:273` — Whisper/Ollama health + adapter-list routes fabricate empty/false shapes on error. No log distinguishing "unreachable" from "empty".
5. `apps/api/src/integrations/outlook/outlookRoutes.ts:106, 220` — O365 connected-status routes silently return `connected:false` on any DB/import error.

## Frontend fabrications (lie-about-success)

- `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:530` — bulk SMS UI reports `{sent:0, failed:0, message:'Bulk reminders will be sent via in-app notifications…'}` when send actually failed. **P0 clinical-safety** — clinician thinks messages sent.
- `apps/web/src/features/patients/pages/PatientsPage.tsx:510`
- `apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1906`
- `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:643, 652`
- `apps/web/src/features/beds/pages/BedBoardPage.tsx:257`

## Full [SILENT] list (34)

**PHI / security (3):** `shared/phiEncryption.ts:60,85`, `utils/phiEncryption.ts:59`
**Auth / session (7):** `features/auth/authController.ts:118,192`, `features/auth/authService.ts:173`, `middleware/csrfMiddleware.ts:101`, `middleware/jwtBlacklist.ts:46,71`, `middleware/hmacSigning.ts:37`, `middleware/licenseMiddleware.ts:50`, `mcp/scribeStreaming.ts:207`
**Route handlers (14):** `features/llm/llmTrainingRoutes.ts:273`, `features/llm/llmRoutes.ts:953`, `features/llm/aiJobRoutes.ts:120,151`, `features/license/licenseRoutes.ts:36`, `integrations/outlook/outlookRoutes.ts:106,220`, `server.ts:475`, `integrations/fhir/smartAppRegistry.ts:91`, `integrations/fhir/fhirSubscription.ts:75`, `integrations/fhir/smartAuth.ts:523,604`, `integrations/nhsd/nhsdClient.ts:472`, `integrations/escript/erxRestClient.ts:162`
**Audit swallows on clinical writes (6):** `features/patient-app/patientAppRoutes.ts:422,1074`, `features/patient-outreach/patientOutreachRoutes.ts:104`, `features/power-settings/powerSettingsRoutes.ts:445`, `features/workflows/workflowEngine.ts:200`, `features/patients/duplicateDetection.ts:160`
**Web empty/fabricated (6):** `features/beds/pages/BedBoardPage.tsx:257`, `features/patients/pages/PatientsPage.tsx:510`, `features/patients/components/detail/tabs/SummaryTab.tsx:1906`, `features/patients/components/detail/tabs/VivaTab.tsx:643,652`, `features/receptionist/pages/ReceptionistPage.tsx:530`

## Per-surface heatmap

| Surface | [SILENT] | Risk rating |
|---|---:|---|
| phiEncryption (both files) | 3 | **P0 SECURITY** (plaintext fallback) |
| auth + auth-middleware + license-middleware | 7 | **P0** (audit / session revocation fail-open) |
| llm/* + mcp/** | 6 | 2 routes lie about Ollama/Redis state |
| patient-app + patient-outreach + power-settings | 3 | Audit swallows on consent/admin writes |
| integrations (Outlook/FHIR/MHR/NHSD/eRx) | 6 | Silent external disconnect |
| patients + episode + workflows | 3 | Workflow silently no-ops on missing table |
| Web pages + tabs | 4 | `ReceptionistPage:530` fabricates SMS success |

## Pattern note

Most `[INTENTIONAL_BUT_UNCOMMENTED]` catches use `/* best-effort */`, `/* non-blocking */`, `/* ignore */`, `/* table may not exist yet */` — shape is correct but comment doesn't match the canonical `// intentionally ignored: <reason>` the guard keys off. Follow-up: migrate them to canonical directive so `check-no-silent-catches.sh` can distinguish these from actionable `[SILENT]` entries.

## Related BUGs

- **BUG-441 (S0)** (new) — phiEncryption plaintext-fallback is a compliance-blocker; 3 sites must fail-fast with structured error + logger.error
- **BUG-442 (S0)** (new) — jwtBlacklist fail-open on Redis error undermines BUG-356 session revocation; must fail-closed with alert
- **BUG-443 (S1)** (new) — authController login/logout audit-write swallow (AHPRA compliance regression)
- **BUG-444 (S1)** (new) — licenseMiddleware silent bypass on module-import failure
- **BUG-445 (S1)** (new) — ReceptionistPage bulk-SMS fabricated success message — patient safety
- **BUG-446 (S2)** (new) — Whisper/Ollama/Outlook health routes lie on infra error — observability
- **BUG-360** (already shipped) — covers class; this audit identifies 34 new instances
