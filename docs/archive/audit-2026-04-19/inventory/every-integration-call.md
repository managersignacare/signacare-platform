# Integration Call Inventory — 2026-04-19

Scope: external integration call sites in `apps/api/src/integrations/**`, callers under `apps/api/src/features/**`, `apps/api/src/jobs/workers/**`, and `apps/api/src/mcp/**` (LLM / Whisper) plus a single `apps/api/src/shared/blobStorage.ts` for S3/local persistence and `apps/api/src/server.ts` for Sentry bootstrap.

Total rows: **107**

Per-integration summary:
Pathology-HL7v2(6), eScript/NPDS(5), eRx-Adapter/ETP1(6), eRx-REST(8), MySL(3), SafeScript(3), HI-Service(2), HealthLink-SMD(2), MHR-DocRef(2), Medicare-ECLIPSE(1), Radiology-HL7(1), NHSD(4), CMI(4), FCM(6), ACS-SMS(2), Outlook-Email(7), Outlook-Calendar(6), Outlook-Teams/SharePoint/O365(4), SMTP-fallback(2), Token-Delivery(3), Admin-Alert(6), Ollama(10), Whisper(6), Blob-Storage(11), Sentry(3), Evidence(1), FHIR-bulk-export(2).

Legend:
- "isConfigured check?" — YES = explicit `isXxxConfigured()`/env gate before work; NO = not guarded; N/A = N/A.
- "Last-success tracked?" — YES when the call site records `delivered_at` / equivalent DB column; NO otherwise.
- "Error handling" — summary of the catch / failed branch.

---

## apps/api/src/integrations/healthlink/ — HealthLink / Argus (SMD)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 1 | apps/api/src/integrations/healthlink/healthLinkClient.ts:45 | HealthLink SMD | healthCheck | YES (line 50) | returns UNCONFIGURED/UNREACHABLE | NO | Tier 8 skeleton — never reaches OK |
| 2 | apps/api/src/integrations/healthlink/healthLinkClient.ts:54 | HealthLink SMD | sendLetter | YES (line 55) | throws HEALTHLINK_NOT_IMPLEMENTED | NO | Skeleton; requireEnv guards |

## apps/api/src/integrations/mhr/ — My Health Record (NASH / ADHA)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 3 | apps/api/src/integrations/mhr/mhrDocumentClient.ts:43 | MHR DocumentReference | healthCheck | YES (line 48) | returns UNCONFIGURED/UNREACHABLE | NO | Tier 8 skeleton |
| 4 | apps/api/src/integrations/mhr/mhrDocumentClient.ts:52 | MHR DocumentReference | pushDocument | YES (line 53) | throws MHR_NOT_IMPLEMENTED | NO | Skeleton; requireEnv guards |

## apps/api/src/integrations/acs/ — Azure Communication Services (SMS)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 5 | apps/api/src/integrations/acs/acsClient.ts:66 | ACS SMS | sendSms (mock branch) | YES via `loadAcsConfig().mockMode` (line 69) | returns success=true with MOCK id | NO (logged only) | MOCK mode default |
| 6 | apps/api/src/integrations/acs/acsClient.ts:85 | ACS SMS | sendSms (real `client.send`) | YES (real-mode branch) | try/catch → `{success:false, errorMessage}`; logger.error | via patientOutreachService `delivered_at` write (logId row) | dynamic import of `@azure/communication-sms` |

## apps/api/src/integrations/fcm/ — Firebase Cloud Messaging

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 7 | apps/api/src/integrations/fcm/fcmClient.ts:57 | FCM | sendToTokens (mock) | YES via `mockMode()` (line 65) | returns fake success counts | NO | Default when `FCM_SERVICE_ACCOUNT_PATH` unset |
| 8 | apps/api/src/integrations/fcm/fcmClient.ts:77 | FCM | sendToTokens (real `sendEachForMulticast`) | YES (real-mode branch) | try/catch → failureCount, errorMessage; logger.error | NO (delivery recorded upstream) | Dead-token pruning by code match |
| 9 | apps/api/src/integrations/fcm/fcmService.ts:41 | FCM | sendToStaff | N/A (delegates to client) | rethrows; caller catches | NO | Prunes dead staff tokens |
| 10 | apps/api/src/integrations/fcm/fcmService.ts:68 | FCM | sendToPatient | N/A (delegates to client) | rethrows; caller catches | NO | Prunes dead patient tokens |
| 11 | apps/api/src/features/notifications/notificationService.ts:245 | FCM | sendToStaff (call site) | N/A | try/catch logger.warn; continues | NO | Per-staff loop inside emit |
| 12 | apps/api/src/features/patient-outreach/patientOutreachService.ts:231 | FCM | sendToPatient (call site) | N/A | writes `delivered_at` on success / `failed_at` on fail | YES (patient_outreach_log.delivered_at) | Phase 11A fan-out |

## apps/api/src/integrations/hiService/ — HI Service (IHI/HPII)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 13 | apps/api/src/integrations/hiService/hiServiceClient.ts:68 | HI Service (SOAP) | searchIhi (fetch POST) | YES (line 69) | try/catch → `{found:false,error}` | NO | requireEnv at call time |
| 14 | apps/api/src/integrations/hiService/hiServiceClient.ts:108 | HI Service (SOAP) | verifyIhi (fetch POST) | YES (line 113) | try/catch → `{found:false,error}` | NO | Luhn + offline fallback |

## apps/api/src/integrations/escript/npdsClient.ts — NPDS / ETP2 (FHIR R4)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 15 | apps/api/src/integrations/escript/npdsClient.ts:102 | NPDS | submitToNpds (mtlsRequest POST) | YES (line 110) | try/catch → `{success:false,error}`; logger.error | via erx_tokens audit_log | mutual-TLS via PFX cert |
| 16 | apps/api/src/integrations/escript/npdsClient.ts:143 | NPDS | queryActiveScriptList (mtlsRequest GET) | YES (line 148) | try/catch → `{success:false}` | NO | Bundle→resource map |
| 17 | apps/api/src/integrations/escript/npdsClient.ts:173 | NPDS | cancelOnNpds (mtlsRequest PATCH) | YES (line 174) | try/catch → `{success:false}` | NO | — |

## apps/api/src/integrations/escript/myslClient.ts — MySL (Active Script List)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 18 | apps/api/src/integrations/escript/myslClient.ts:62 | MySL OAuth2 | getBearerToken (token URL POST) | Implicit (callers gate) | throws on `!res.ok` | NO | Cached token |
| 19 | apps/api/src/integrations/escript/myslClient.ts:112 | MySL | checkPatientMySLStatus (GET Patient) | YES (line 113) | try/catch → `{status:'red',error}` | NO | RED/AMBER/GREEN classification |
| 20 | apps/api/src/integrations/escript/myslClient.ts:164 | MySL | requestConsent (POST Consent) | YES (line 165) | try/catch → `{success:false,error}` | NO | — |
| 21 | apps/api/src/integrations/escript/myslClient.ts:211 | MySL | getActiveScripts (GET MedicationRequest) | YES (line 212) | try/catch → `{success:false,error}` | NO | — |

## apps/api/src/integrations/escript/erxRestClient.ts — eRx REST API v1.6

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 22 | apps/api/src/integrations/escript/erxRestClient.ts:148 | eRx REST | healthCheck (GET /health) | N/A | try/catch → false | NO | No cert required |
| 23 | apps/api/src/integrations/escript/erxRestClient.ts:160 | eRx REST | createPrescription (ERX001 POST) | YES via `request()` agent gate | response-code success flag; logger.error on req error | via erx_tokens audit_log | SCID path |
| 24 | apps/api/src/integrations/escript/erxRestClient.ts:169 | eRx REST | viewPrescription (ERX049 GET) | YES | response-code success flag | NO | — |
| 25 | apps/api/src/integrations/escript/erxRestClient.ts:177 | eRx REST | cancelPrescription (ERX023 POST) | YES | response-code success flag | NO | — |
| 26 | apps/api/src/integrations/escript/erxRestClient.ts:186 | eRx REST | amendPrescription (ERX027 POST) | YES | response-code success flag | NO | Requires ERX025 first |
| 27 | apps/api/src/integrations/escript/erxRestClient.ts:196 | eRx REST | checkoutForAmend (ERX025 POST) | YES | response-code success flag | NO | — |
| 28 | apps/api/src/integrations/escript/erxRestClient.ts:205 | eRx REST | reactivatePrescription (ERX019 POST) | YES | response-code success flag | NO | — |
| 29 | apps/api/src/integrations/escript/erxRestClient.ts:214 | eRx REST | ceasePrescription (ERX061 POST) | YES | response-code success flag | NO | — |
| 30 | apps/api/src/integrations/escript/erxRestClient.ts:224 | eRx REST | reissueToken (ERX065 POST) | YES | response-code success flag | NO | — |
| 31 | apps/api/src/integrations/escript/erxRestClient.ts:233 | eRx REST | registerServiceProvider (POST /serviceproviders) | YES | response-code success flag | NO | — |

## apps/api/src/integrations/escript/erxAdapterClient.ts — eRx Adapter (ETP1 SOAP)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 32 | apps/api/src/integrations/escript/erxAdapterClient.ts:61 | eRx Adapter | sendToAdapter (SOAP POST) | YES (line 65) | rejects on socket error; 30s timeout | NO | requireEnv for URL/cert pass |
| 33 | apps/api/src/integrations/escript/erxAdapterClient.ts:116 | eRx Adapter | uploadPrescription (ERX001) | YES via sendToAdapter | rejects on transport failure | via erx_etp1_submissions audit | — |
| 34 | apps/api/src/integrations/escript/erxAdapterClient.ts:127 | eRx Adapter | downloadDispenseNotifications (ERX003) | YES (line 128) | rejects on transport failure | NO | Polled by erxAdapterService |

## apps/api/src/integrations/escript/erxAdapterService.ts — ETP1 orchestrator

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 35 | apps/api/src/integrations/escript/erxAdapterService.ts:137 | eRx ETP1 | submit → uploadPrescription | YES (line 94) | try/catch → audit 'connection_error' + `{success:false,error}` | YES (erx_etp1_submissions row) | writeAuditLog on every attempt |
| 36 | apps/api/src/integrations/escript/erxAdapterService.ts:210 | eRx ETP1 | pollDispenseNotifications → downloadDispenseNotifications | YES (line 207) | try/catch → []; logger.error | YES (erx_dispense_notifications row per hit) | Splits multi-ERX005 body |

## apps/api/src/integrations/escript/escriptService.ts — unified orchestrator

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 37 | apps/api/src/integrations/escript/escriptService.ts:195 | eRx ETP1 | erxAdapterService.submit | YES (line 173) | swallows adapter errors → `etp1Error` state | YES (writeAuditLog pathway=adapter) | Orchestrated step 2 |
| 38 | apps/api/src/integrations/escript/escriptService.ts:211 | NPDS ETP2 | submitToNpds | YES (line 210) | swallows NPDS errors → `etp2Error` state | YES (writeAuditLog pathway=npds) | Orchestrated step 3 |
| 39 | apps/api/src/integrations/escript/escriptService.ts:277 | eRx REST | createPrescription (erx-rest fallback) | YES (line 231) | try/catch → `erxRestError`; logger.error | YES (writeAuditLog pathway=erx-rest) | Only when ETP1+ETP2 fail |
| 40 | apps/api/src/integrations/escript/escriptService.ts:315 | Admin Alert | sendAdminAlert ('prescription_pathway_exhausted') | N/A | try/catch logger.warn; non-blocking | YES (audit_log) | MED-I3 |
| 41 | apps/api/src/integrations/escript/escriptService.ts:363 | NPDS | cancelOnNpds | YES (line 362) | swallows error → retry REST | YES (writeAuditLog action=cancel) | — |
| 42 | apps/api/src/integrations/escript/escriptService.ts:372 | eRx REST | cancelPrescription (ERX023) | YES (line 369) | try/catch → `{success:false,error}` | YES (audit_log) | fallback path |
| 43 | apps/api/src/integrations/escript/escriptService.ts:395-401 | eRx REST | checkoutForAmend + amendPrescription | YES (line 388) | try/catch; returns error with HTTP status | YES (audit_log action=amend) | Two-step (ERX025→ERX027) |
| 44 | apps/api/src/integrations/escript/escriptService.ts:420 | eRx REST | ceasePrescription (ERX061) | YES (line 414) | try/catch → structured error | YES (audit_log action=cease) | — |
| 45 | apps/api/src/integrations/escript/escriptService.ts:438 | eRx REST | reactivatePrescription (ERX019) | YES (line 433) | try/catch → structured error | YES (audit_log action=reactivate) | — |
| 46 | apps/api/src/integrations/escript/escriptService.ts:457 | eRx REST | reissueToken (ERX065) | YES (line 451) | try/catch → structured error | YES (audit_log action=reissue_token) | — |

## apps/api/src/integrations/escript/tokenDeliveryService.ts — patient token SMS/email

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 47 | apps/api/src/integrations/escript/tokenDeliveryService.ts:75 | SMS Gateway | sendSms (fetch POST) | YES (line 64) | try/catch → `{sent:false,error}` | NO (returned in result) | requireEnv at call |
| 48 | apps/api/src/integrations/escript/tokenDeliveryService.ts:135-136 | Outlook Email | sendEmail (token HTML) | N/A (dynamic import) | try/catch on MODULE_NOT_FOUND or 'not configured' | NO | Fallback path |
| 49 | apps/api/src/integrations/escript/tokenDeliveryService.ts:155 | Token Delivery | deliverToken orchestrator | YES via sub-checks | audit row always written | YES (erx_token_delivery audit) | Called by prescriptionController:214 |

## apps/api/src/integrations/safeScript/ — Victoria PDMP

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 50 | apps/api/src/integrations/safeScript/safeScriptService.ts:53 | SafeScript OAuth2 | getAccessToken (token POST) | Implicit via caller gate | throws on `!resp.ok` | NO | Cached token |
| 51 | apps/api/src/integrations/safeScript/safeScriptService.ts:103 | SafeScript | checkPatient → /patients/:id/supplies (GET) | YES (line 89) | try/catch → `{checked:false,error}` | YES (safescript_checks audit row) | Audit logged REGARDLESS |
| 52 | apps/api/src/integrations/safeScript/safeScriptService.ts:145 | SafeScript | checkPatient → /patients/:id/risk-indicators (GET) | N/A (inside checkPatient) | try { … } catch silent (risk is optional) | NO | Silent catch by design |
| 53 | apps/api/src/integrations/safeScript/safeScriptService.ts:172 | SafeScript | enforceSafeScriptCheck (S8 gate) | YES | THROWS if check failed + configured | YES (audit_log) | Blocks S8 prescribe |

## apps/api/src/integrations/outlook/outlookEmailService.ts — Microsoft Graph email

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 54 | apps/api/src/integrations/outlook/outlookEmailService.ts:38 | Microsoft OAuth | refreshAccessToken (token POST) | Implicit (staff row gate) | propagates axios error | NO | Updates staff row expiresAt |
| 55 | apps/api/src/integrations/outlook/outlookEmailService.ts:87 | Microsoft Graph | sendEmail (POST /sendMail) | Implicit via `ensureAccessToken` | throws on axios error | NO | Direct |
| 56 | apps/api/src/integrations/outlook/outlookEmailService.ts:130 | Microsoft Graph | readInboxEmails (GET messages) | Implicit | throws on axios error | NO | Used by referral inbox |

## apps/api/src/integrations/outlook/outlookCalendarService.ts — Graph calendar

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 57 | apps/api/src/integrations/outlook/outlookCalendarService.ts:30 | Microsoft OAuth | refreshAccessToken | Implicit | propagates axios error | NO | Same shape as email service |
| 58 | apps/api/src/integrations/outlook/outlookCalendarService.ts:72 | Microsoft Graph | createStaffEvent (POST /events) | Implicit | throws on axios error | via appointments.outlook_event_id | — |
| 59 | apps/api/src/integrations/outlook/outlookCalendarService.ts:102 | Microsoft Graph | updateStaffEvent (PATCH) | Implicit | throws on axios error | NO | — |
| 60 | apps/api/src/integrations/outlook/outlookCalendarService.ts:132 | Microsoft Graph | deleteStaffEvent (DELETE) | Implicit | throws on axios error | NO | — |

## apps/api/src/integrations/outlook/outlookRoutes.ts — route wrappers

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 61 | apps/api/src/integrations/outlook/outlookRoutes.ts:137 | Outlook Email | sendEmail (from /send-email) | Implicit | try/catch next(err); logger.error | NO | — |
| 62 | apps/api/src/integrations/outlook/outlookRoutes.ts:155 | Teams | createTeamsMeeting | N/A (office365Service) | try/catch next(err) | NO | — |
| 63 | apps/api/src/integrations/outlook/outlookRoutes.ts:167 | Outlook Calendar | createCalendarEvent | N/A | try/catch next(err) | NO | — |
| 64 | apps/api/src/integrations/outlook/outlookRoutes.ts:180 | Outlook Calendar | listUpcomingEvents | N/A | try/catch next(err) | NO | — |
| 65 | apps/api/src/integrations/outlook/outlookRoutes.ts:196 | SharePoint | uploadToSharePoint | YES via `getSharepointSiteForClinic` | try/catch next(err) | NO | Per-clinic site override |
| 66 | apps/api/src/integrations/outlook/outlookRoutes.ts:232 | Outlook Email | readInboxEmails | Implicit | try/catch next(err) | NO | — |
| 67 | apps/api/src/integrations/outlook/outlookRoutes.ts:210 | O365 | isOffice365Configured | YES | returns `{configured,connected}` | NO | Status endpoint |

## apps/api/src/integrations/pathology/ — HL7 v2.5 / MLLP

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 68 | apps/api/src/integrations/pathology/mllpTransport.ts:39 | MLLP (outbound) | sendMllpMessage (TCP socket) | YES (line 42) | timeout + NACK handled → `{success:false,error}` | NO | VT/FS/CR framing |
| 69 | apps/api/src/integrations/pathology/mllpTransport.ts:108 | MLLP (listener) | startMllpListener (TCP server) | N/A (bind call) | `socket.on('error')` logger.error | NO | Pushes to `hl7-inbound` queue |
| 70 | apps/api/src/integrations/pathology/resultNotifier.ts:28 | Pathology | checkAndNotify (task insert) | N/A | try/catch logger.error; no throw | NO | Writes tasks table |
| 71 | apps/api/src/jobs/workers/hl7Worker.ts:119 | HL7 outbound worker | BullMQ worker handler (ORM^O01 build) | N/A | TODO: wire MLLP; updates order status | YES (pathology_orders.status) | Stub |
| 72 | apps/api/src/jobs/workers/hl7Worker.ts:152 | HL7 outbound worker | 'failed' event handler | N/A | `if (attemptsMade === maxAttempts)` → sendAdminAlert + updateOrderStatus='failed' | YES (audit_log) | Tier 7.4 MED-I1 |
| 73 | apps/api/src/jobs/workers/hl7Worker.ts:196 | HL7 inbound worker | BullMQ worker (parseOruR01) | N/A | throws on parse fail → retry | NO | Stub ingestion TODO |

## apps/api/src/integrations/radiology/ — Radiology RIS (HL7 ORM/ORU)

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 74 | apps/api/src/integrations/radiology/radiologyClient.ts:58 | Radiology RIS | sendOrder | YES (line 62) | throws RADIOLOGY_NOT_IMPLEMENTED | NO | Tier 8 skeleton |

## apps/api/src/integrations/medicare/ — Medicare ECLIPSE

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 75 | apps/api/src/integrations/medicare/eclipseClient.ts:60 | Medicare ECLIPSE | submitClaim | YES (line 61) | throws ECLIPSE_NOT_IMPLEMENTED | NO | Tier 8 skeleton |

## apps/api/src/integrations/nhsd/ — National Health Services Directory

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 76 | apps/api/src/integrations/nhsd/nhsdClient.ts:213 | NHSD Consumer v5 | searchProviders (POST /_search) | YES (line 214) | try/catch → error in result; logger.error | NO | x-api-key header |
| 77 | apps/api/src/integrations/nhsd/nhsdClient.ts:354 | NHSD FHIR v4 | searchPractitionerFhir (GET PractitionerRole) | YES (line 355) | try/catch → error in result | NO | FHIR Bundle walk |
| 78 | apps/api/src/integrations/nhsd/nhsdClient.ts:441 | NHSD Consumer v5 | getServiceById (GET /:id) | YES (line 442) | silent catch → null | NO | — |
| 79 | apps/api/src/integrations/nhsd/nhsdRoutes.ts:28-53 | NHSD | route wrappers (searchProviders / searchPractitionerFhir / getServiceById) | YES (via client) | try/catch next(err) | NO | — |

## apps/api/src/integrations/cmi/ — Vic DoH CMI

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 80 | apps/api/src/integrations/cmi/cmiService.ts:96 | CMI API | submitToCmi (fetch POST /submissions) | YES (line 113) | try/catch → validationErrors | YES (audit_log) | Falls back to test mode |
| 81 | apps/api/src/integrations/cmi/cmiService.ts:64 | CMI | prepareCmiSubmission (pure build) | N/A | sync throws propagate | NO | — |
| 82 | apps/api/src/integrations/cmi/cmiRoutes.ts:24 | CMI | prepareCmiSubmission (from /prepare) | Implicit | try/catch next(err) | NO | — |
| 83 | apps/api/src/integrations/cmi/cmiRoutes.ts:36 | CMI | submitToCmi (from /submit) | Implicit | try/catch next(err) | YES (audit_log) | — |

## apps/api/src/integrations/evidence/ — Evidence retrieval

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 84 | apps/api/src/integrations/evidence/evidenceClient.ts:82 | Evidence (pg + future pgvector) | retrieveEvidence (dbRead ILIKE) | YES via `evidenceBackendName()` | try/catch → []; logger.warn | NO | Fail-closed by design |

## apps/api/src/integrations/fhir/ — FHIR R4 (internal) + bulk export

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 85 | apps/api/src/integrations/fhir/bulkExportWorker.ts:229 | Blob Storage (via worker) | blobStorage.put (NDJSON export) | N/A | outer try/catch → fhir_bulk_export_jobs.status='failed' + error_text | YES (fhir_bulk_export_jobs.status='completed') | Per-type loop |
| 86 | apps/api/src/integrations/fhir/bulkExportWorker.ts:230 | Blob Storage (via worker) | blobStorage.getDownloadUrl (presigned) | N/A | same try/catch | YES | 24h TTL |

## apps/api/src/features/llm/ — Ollama / Whisper / letter pipeline

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 87 | apps/api/src/features/llm/llmService.ts:150 | Ollama | callOllama (POST /api/generate) | NO (falls back via errorCode) | try/catch → success=false; writes `llm_interactions` | YES (llm_interactions.success) | — |
| 88 | apps/api/src/features/llm/streamingTranscribeRoutes.ts:59 | Whisper | axios.post /transcribe (chunk) | NO (env WHISPER_URL) | try/catch → next(err); destroys read stream | NO | FormData upload |
| 89 | apps/api/src/features/llm/streamingTranscribeRoutes.ts:117 | Whisper | axios.post /transcribe (final) | NO | try/catch → logger.warn; partial transcript | NO | — |
| 90 | apps/api/src/features/llm/llmRoutes.ts:178-200 | Ollama (clinicalAi.*) | dynamic import + action switch | N/A | outer try/catch next(err) | NO | dispatch to 15 actions |
| 91 | apps/api/src/features/llm/llmRoutes.ts:474 | Blob Storage | blobStorage.put (audio blob) | N/A | dynamic import; try/catch | NO | — |
| 92 | apps/api/src/features/llm/llmRoutes.ts:485 | Whisper (via mcp) | processAmbientAudio | N/A | try/catch propagate | NO | Calls mcp/ambientProcessor |
| 93 | apps/api/src/features/llm/llmRoutes.ts:713-728 | Whisper (local proc) | /whisper/status + /whisper/start | YES (proc pid check) | try/catch next(err) | NO | — |
| 94 | apps/api/src/features/llm/llmTrainingRoutes.ts:250 | Ollama CLI | execFile(ollama create) | N/A (binaryResolver) | try/finally unlink; rejects propagate | NO | Writes modelfile |
| 95 | apps/api/src/features/reports/reportsRoutes.ts:548 | Ollama | axios.post /api/chat (audit scoring) | NO | fire-and-forget async, per-note try/catch; sets status='llm_failed' | YES (audit_runs.status) | void IIFE |
| 96 | apps/api/src/features/roles/psychiatristFeatureRoutes.ts:515 | Whisper | axios.post /inference (voice memo) | NO | try/catch next(err); 422 on empty | NO | — |
| 97 | apps/api/src/features/episode/episodeRoutes.ts:355 | Ollama (clinicalAi) | generateDischargeSummary | N/A | propagates | NO | — |

## apps/api/src/mcp/ — LLM + Whisper + classifier internals

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 98 | apps/api/src/mcp/localLlmAgent.ts:219 | Ollama | fetch `${OLLAMA_URL}/api/generate` | NO (falls back to default model) | try/catch; fallback to default model if non-default fails | NO | DEFAULT_MODEL retry |
| 99 | apps/api/src/mcp/ambientProcessor.ts:166 | Whisper | transcribeWithWhisper (axios) | Implicit (server process gate) | throws with clear remediation | NO | Semaphore-gated |
| 100 | apps/api/src/mcp/chatClassifier.ts:88 | Ollama classifier | fetch `/api/chat` | NO | — | NO | — |

## apps/api/src/features/patient-outreach/adminAlert.ts — admin alert dispatcher

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 101 | apps/api/src/features/patient-outreach/adminAlert.ts:34 | Admin Alert | sendAdminAlert (audit + email) | N/A | inner try/catch for audit + email; non-throwing | YES (audit_log primary) | Nil-UUID actor |
| 102 | apps/api/src/features/patient-outreach/adminAlertEmail.ts:10 | Outlook (via admin) | sendEmailIfConfigured | YES inside | silent if unconfigured | NO | — |

## apps/api/src/features/messaging + referrals — Outlook+SMTP fallback

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 103 | apps/api/src/features/messaging/messageRoutes.ts:54 | Outlook Email + SMTP | sendEmail + nodemailer fallback | YES (env gates SMTP) | try/catch chain; throws if neither configured | NO | SMTP fallback with env gate |
| 104 | apps/api/src/features/referrals/referralFeedbackService.ts:234-236 | Outlook Email | sendEmail (dynamic import) | Implicit typeof check | try/catch → SMTP path | NO | — |
| 105 | apps/api/src/features/referrals/referralFeedbackService.ts:252 | SMTP | nodemailer.createTransport.sendMail | YES (env gate) | try/catch logger.warn | NO | — |

## apps/api/src/shared/blobStorage.ts — S3 / local

| # | File:Line | Integration | Operation | isConfigured check? | Error handling | Last-success tracked? | Notes |
|---|---|---|---|---|---|---|---|
| 106 | apps/api/src/shared/blobStorage.ts:182-195 | S3 | client.send(PutObjectCommand) | YES via `buildDefaultBlobStorage` | propagates; caller catches | NO | MinIO compatible via `BLOB_S3_ENDPOINT` |
| 107 | apps/api/src/shared/blobStorage.ts:210-226 | S3 | client.send(GetObjectCommand) | YES | propagates | NO | — |

---

## apps/api/src/server.ts — Sentry (observability)

Sentry is bootstrapped in `apps/api/src/server.ts` lines 122–142 (`Sentry.init`) and line 721 (`Sentry.setupExpressErrorHandler`). Gated on `SENTRY_DSN`. Included here for completeness but not counted as a per-site row because there is no per-request call — Sentry hooks Express via middleware once. PHI scrubbing is noted in the init block (line 129 comment).

---

## Key observations (not required rows, but flagged while cataloguing)

1. **Tier 8 skeletons** (HealthLink, MHR, Radiology, ECLIPSE) all throw a `*_NOT_IMPLEMENTED` error after `isConfigured()` returns true — callers **must** treat these as failures end-to-end, not as "configured = ready". `letterDeliveryService.deliverLetter` correctly catches and records `letter_deliveries.error`.
2. **Missing isConfigured gate** — `apps/api/src/mcp/localLlmAgent.ts:219` and `streamingTranscribeRoutes.ts:59` don't gate on env presence; they attempt the fetch and return a stub response after failure. Consider explicit `isOllamaConfigured()` / `isWhisperConfigured()` helpers consistent with every other integration.
3. **Silent catch in safeScriptService.ts:153** (`catch { /* risk check is optional */ }`) — violates §9.6 + §1.x spirit. Risk-indicator failure should at least logger.warn.
4. **Last-success NOT tracked** for most integrations. Only `patient_outreach_log`, `erx_*` tables, `llm_interactions`, `audit_runs`, `fhir_bulk_export_jobs`, `letter_deliveries`, and `pathology_orders.status` persist a success timestamp. No cross-integration `integration_health` table exists.
5. **Outlook token refresh** (outlookEmailService.ts:38 + outlookCalendarService.ts:30) has duplicated code — candidate for consolidation into a single `o365TokenService`.
6. **Fire-and-forget async** — `apps/api/src/features/reports/reportsRoutes.ts:541` uses a `void (async () => {...})()` IIFE (auditRun LLM scoring). Should chain a `.catch` per §9.6; currently swallows via inner try/catch + final audit_run status update.
7. **ACS caller containment** enforced by `check-acs-callers.sh` — only `patientOutreachService.ts` imports `acsClient.sendSms`. Verified.
