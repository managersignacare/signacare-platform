# Agent A — Static analysis sweep (COMPLETED)

## CRITICAL findings

**[CRIT-A1]** Hardcoded secret fallbacks violating CLAUDE.md §6.2 (5 files):
- apps/api/src/features/patient-outreach/tokenDeliveryService.ts:34-36 — SMS_GATEWAY_KEY, SMS_GATEWAY_URL default to empty string
- apps/api/src/integrations/npdsClient.ts:19-22 — CERT_PATH, CERT_PASS, CONFORMANCE_ID empty fallbacks
- apps/api/src/integrations/erxAdapterClient.ts:27-29,38 — ERX certificate paths + site ID silent failures
- apps/api/src/integrations/hiServiceClient.ts:18-19 — HI_SERVICE cert path fallback
- apps/api/src/integrations/nhsdClient.ts:18 — NHSD_API_URL assumes production endpoint

**Gold-standard fix:** Each must throw `Error('Missing env: X_ENV_VAR')` if unset.

## HIGH findings

**[HIGH-A1]** 37 `as any` casts in web frontend, 15-20 actionable. Largest: PatientRegistrationWizard.tsx:112-146 (17+ casts on Formik values). Also TasksPage.tsx (task_type/taskType bridging), PatientsPage.tsx:573-610 (planDetail.transition untyped), AppointmentForm.tsx (error obj untyped).

**[HIGH-A2]** Fire-and-forget in SSE heartbeat: sseRoutes.ts:96,134 — setInterval callbacks lack error handling; silent heartbeat failure → dead connection with no log.

## MEDIUM findings

**[MED-A1]** Silent catch in scribeStreaming.ts:85,89,92,280 — temp file cleanup failures swallowed; accumulates orphaned files.

**[MED-A2]** Magic numbers: server.ts:173 (`1 * 60 * 1000`), server.ts:185 (`15 * 60 * 1000`), licenseMiddleware.ts:35 (`60 * 60 * 1000`). Should be env/config.

**[MED-A3]** TasksPage.tsx:89,106 bridges task_type ?? taskType — incomplete schema migration; define union type instead.

## BENIGN

- @ts-ignore/expect-error: 3 hits, all justified (optional peer dependencies: firebase-admin, azure/communication-sms)
- 50+ eslint-disable: mostly legitimate no-console at startup, exhaustive-deps omissions likely intentional
- Error narrowing: acceptable (logger.error accepts unknown)
- No unused exports / dead code detected

## Top 3 structural fixes by impact

1. Fix 5 secret fallbacks → fail-fast (currently silently disables critical integrations on misconfig)
2. Type PatientRegistrationWizard form (eliminates 17+ `as any` in one refactor)
3. Add SSE heartbeat error handler (prevents silent connection death)
