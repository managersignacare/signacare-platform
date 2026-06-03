# Signacare EMR — Third-Party Integration Guide

**For:** API Integration Engineers
**Version:** 1.0.0 | **Date:** 30 March 2026

---

## Table of Contents

1. [Microsoft Office 365 / Outlook](#1-microsoft-office-365--outlook)
2. [Electronic Prescribing (eScript)](#2-electronic-prescribing-escript)
3. [My Health Record / HI Service (ADHA)](#3-my-health-record--hi-service-adha)
4. [SafeScript (Victoria PDMP)](#4-safescript-victoria-pdmp)
5. [CMI / NOCC (Victorian Mental Health Reporting)](#5-cmi--nocc-victorian-mental-health-reporting)
6. [NHSD (National Health Services Directory)](#6-nhsd-national-health-services-directory)
7. [HL7 v2 Pathology (MLLP)](#7-hl7-v2-pathology-mllp)
8. [FHIR R4 / SMART on FHIR](#8-fhir-r4--smart-on-fhir)
9. [Zitavi Mobile Patient App](#9-zitavi-mobile-patient-app)
10. [Ollama (Local LLM)](#10-ollama-local-llm)
11. [Whisper (Speech-to-Text)](#11-whisper-speech-to-text)
12. [SMTP Email](#12-smtp-email)
13. [Sentry (Error Monitoring)](#13-sentry-error-monitoring)

---

## 1. Microsoft Office 365 / Outlook

### Purpose
Calendar sync (appointments → Outlook), email sending (clinical correspondence), Teams meeting links for telehealth, SharePoint document storage.

### External Service
Microsoft Graph API v1.0 (`https://graph.microsoft.com/v1.0/`)

### Prerequisites
1. Register an Azure AD application at https://portal.azure.com → App registrations
2. Grant API permissions:
   - `Calendars.ReadWrite` (delegated)
   - `Mail.Send`, `Mail.Read`, `Mail.ReadWrite` (delegated)
   - `OnlineMeetings.ReadWrite` (delegated)
   - `Files.ReadWrite.All` (application — for SharePoint)
   - `offline_access` (for refresh tokens)
3. Configure redirect URI: `https://<your-domain>/api/v1/integrations/outlook/auth-callback`
4. Generate a client secret

### Environment Variables
```bash
O365_TENANT_ID=<azure-tenant-id>
O365_CLIENT_ID=<azure-client-id>
O365_CLIENT_SECRET=<azure-client-secret>
O365_REDIRECT_URI=https://emr.example.com.au/api/v1/integrations/outlook/auth-callback
O365_SHAREPOINT_SITE=<sharepoint-site-id>  # Optional — for document storage
```

### Code Files
| File | Purpose |
|---|---|
| `integrations/outlook/outlookRoutes.ts` | OAuth2 flow (connect, callback, disconnect) |
| `integrations/outlook/outlookCalendarService.ts` | Create/update/delete calendar events |
| `integrations/outlook/outlookEmailService.ts` | Send emails via Graph API |
| `integrations/outlook/office365Service.ts` | Teams meetings, SharePoint, OneDrive |
| `jobs/workers/outlookWorker.ts` | BullMQ async calendar sync |

### Integration Flow
```
1. Staff clicks "Connect Outlook" in Settings
2. GET /integrations/outlook/auth-url → returns Azure AD authorization URL
3. Staff authenticates with Microsoft → redirected to callback
4. POST /integrations/outlook/auth-callback → exchanges code for tokens
5. Tokens stored in staff table (outlook_refresh_token, outlook_email)
6. On appointment create/update/delete → BullMQ job queued
7. outlookWorker processes job → creates/updates/deletes Outlook event
```

### Testing
```bash
# 1. Set env vars in .env
# 2. Start server
# 3. Login to EMR, go to Settings → Integrations
# 4. Click "Connect Outlook"
# 5. Authenticate with Microsoft
# 6. Create an appointment → check Outlook calendar
```

### Error Handling
- Token refresh failure → staff prompted to reconnect
- Graph API rate limiting → exponential backoff in worker
- Email send failure → falls back to SMTP

---

## 2. Electronic Prescribing (eScript)

### Purpose
Electronic Transfer of Prescriptions (ETP) — send prescriptions to pharmacies electronically via the Australian national infrastructure.

### External Services
| Service | Protocol | Purpose |
|---|---|---|
| **NPDS** (National Prescription Delivery Service) | FHIR R4 over HTTPS with mutual-TLS | ETP2 electronic prescription submission |
| **eRx Enterprise Adapter** | SOAP over HTTPS with site certificate | ETP1 paper-based prescription backup |
| **MySL** (Active Script Registry) | OAuth2 + FHIR R4 | Query patient's active prescriptions |
| **HI Service** | SOAP with NASH certificate | Validate IHI and HPI-I |
| **SMS Gateway** | HTTPS REST | Deliver eScript tokens to patients |

### Prerequisites
1. **ADHA Conformance Testing** — Must pass ADHA ETP conformance tests
2. **NASH Certificate** — Obtain from ADHA (PKI certificate for organisation)
3. **Site Certificate** — Obtain from eRx/MediSecure for your site
4. **NPDS Registration** — Register your software with ADHA
5. **SMS Provider** — Register with a bulk SMS gateway (e.g., MessageMedia, Twilio)

### Environment Variables
```bash
# NPDS (ETP2)
NPDS_API_URL=https://npds.digitalhealth.gov.au/api/v1
NPDS_CONFORMANCE_ID=<your-conformance-id>
ADHA_CERT_PATH=/certs/nash-cert.p12
ADHA_CERT_PASSPHRASE=<certificate-passphrase>

# eRx Adapter (ETP1 fallback)
ERX_ADAPTER_URL=https://erx-adapter.example.com/services
ERX_SITE_CERT_PATH=/certs/erx-site.p12
ERX_SITE_CERT_PASS=<site-certificate-passphrase>
ERX_SITE_ID=<your-erx-site-id>

# MySL (Active Script List)
MYSL_API_URL=https://mysl.digitalhealth.gov.au/api
MYSL_CLIENT_ID=<mysl-client-id>
MYSL_CLIENT_SECRET=<mysl-client-secret>
MYSL_TOKEN_URL=https://mysl.digitalhealth.gov.au/oauth/token

# HI Service
HI_SERVICE_URL=https://www.medicareaustralia.gov.au/ihis
HI_SERVICE_CERT_PATH=/certs/nash-cert.p12

# SMS Token Delivery
SMS_GATEWAY_URL=https://api.messagemedia.com/v1
SMS_GATEWAY_API_KEY=<sms-api-key>
SMS_SENDER_ID=Signacare
```

### Code Files
| File | Purpose |
|---|---|
| `integrations/escript/escriptService.ts` | Orchestrates ETP1/ETP2 pathway selection |
| `integrations/escript/npdsClient.ts` | NPDS FHIR submission with mutual-TLS |
| `integrations/escript/erxAdapterClient.ts` | eRx SOAP adapter (ERX001/ERX002/ERX005) |
| `integrations/escript/myslClient.ts` | Active Script List OAuth2 + FHIR queries |
| `integrations/escript/fhirPrescriptionBuilder.ts` | Builds FHIR R4 MedicationRequest |
| `integrations/escript/tokenDeliveryService.ts` | SMS + email token delivery |
| `integrations/escript/amtCodeMap.ts` | Australian Medicines Terminology mapping |
| `integrations/escript/erxSoapPayloads.ts` | SOAP XML template builders |

### Integration Flow
```
1. Psychiatrist prescribes medication via UI
2. System builds FHIR R4 MedicationRequest (fhirPrescriptionBuilder.ts)
3. Attempt ETP2 first: submit to NPDS via mutual-TLS
4. If NPDS fails: fallback to ETP1 (eRx Adapter SOAP)
5. On success: generate barcode token
6. Deliver token via SMS and/or email to patient
7. Record prescription in prescriptions table with erx_token
8. Patient presents token at pharmacy → pharmacy downloads script
```

### Testing
```bash
# ADHA provides a test environment:
# NPDS Test: https://npds-test.digitalhealth.gov.au/api/v1
# MySL Test: https://mysl-test.digitalhealth.gov.au/api
# Use test IHI numbers and test prescriber numbers from ADHA

# Test ETP2 submission:
curl -X POST http://localhost:4000/api/v1/prescriptions \
  -H "Content-Type: application/json" \
  -H "Cookie: signacare_access=<jwt>" \
  -H "X-CSRF-Token: test" \
  -d '{
    "patientId": "<patient-uuid>",
    "medicationName": "Sertraline",
    "dose": "50mg",
    "frequency": "daily",
    "route": "oral",
    "quantity": 30,
    "repeats": 5
  }'
```

### Compliance Requirements
- PBS/RPBS authority numbers for restricted medicines
- Schedule 8 SafeScript check before dispensing
- AMT code mapping for all medications
- Prescriber must have valid prescriber_number in staff record
- AHPRA registration must be current

---

## 3. My Health Record / HI Service (ADHA)

### Purpose
Validate healthcare identifiers (IHI, HPI-I, HPI-O), upload clinical documents to My Health Record (Shared Health Summaries, Discharge Summaries).

### External Services
| Service | URL | Purpose |
|---|---|---|
| **HI Service** | https://www.medicareaustralia.gov.au/ihis | IHI/HPI-I/HPI-O validation |
| **My Health Record** | https://mhr.digitalhealth.gov.au | Document upload/download |
| **PCEHR Gateway** | https://services.ehealth.gov.au | Conformance testing |

### Prerequisites
1. **NASH Certificate** — Organisation digital certificate from ADHA
2. **HPI-O** — Healthcare Provider Identifier for your organisation
3. **ADHA Conformance Testing** — Pass MHR conformance test suite
4. **Registered software** — Software must be registered with ADHA

### Environment Variables
```bash
NHSD_API_URL=https://api.nhsd.healthdirect.org.au
NHSD_API_KEY=<nhsd-api-key>
NHSD_FHIR_URL=https://api.fhir.nhsd.healthdirect.org.au/v4

# NASH Certificate (used by both HI Service and MHR)
NASH_CERT_PATH=/certs/nash-org.p12
NASH_CERT_PASSPHRASE=<passphrase>
HPI_O=<your-hpi-o>

# MHR Gateway (for conformance testing)
MHR_GATEWAY_URL=https://mhr-test.digitalhealth.gov.au/api
```

### Code Files
| File | Purpose |
|---|---|
| `integrations/nhsd/nhsdClient.ts` | NHSD provider/practitioner/service search |
| `integrations/nhsd/nhsdRoutes.ts` | REST endpoints for NHSD queries |
| `integrations/escript/hiServiceClient.ts` | IHI search + HPI-I validation (SOAP) |

### What Needs to Be Built
```
□ MHR document upload (Shared Health Summary, Discharge Summary)
□ MHR document download (view patient's existing MHR documents)
□ IHI batch validation on patient import
□ HPI-I validation on staff registration
□ NASH certificate auto-renewal handling
□ Conformance test suite (ADHA provides test patients/scenarios)
```

### Integration Flow for IHI Validation
```
1. Patient registered in EMR with Medicare number
2. System calls HI Service with Medicare number + name + DOB
3. HI Service returns validated IHI (or "no match")
4. IHI stored (encrypted) in patients.ihi_number
5. IHI used for MHR document upload and eScript
```

### Testing
```bash
# ADHA test environment IHI numbers:
# Test IHI: 8003608166690503 (John Smith, DOB 1990-01-01)
# Use ADHA's PCEHR Test Portal for end-to-end testing

# Test NHSD search:
curl http://localhost:4000/api/v1/nhsd/practitioners?name=Smith&postcode=3000 \
  -H "Cookie: signacare_access=<jwt>" \
  -H "X-CSRF-Token: test"
```

---

## 4. SafeScript (Victoria PDMP)

### Purpose
Real-time prescription monitoring for Schedule 8 and Schedule 4 medicines (opioids, benzodiazepines). Mandatory in Victoria before prescribing/dispensing monitored medicines.

### External Service
SafeScript PDMP API (`https://api.safescript.vic.gov.au`)

### Prerequisites
1. Register with SafeScript Victoria
2. Obtain OAuth2 client credentials
3. Prescriber must have AHPRA registration linked to SafeScript

### Environment Variables
```bash
SAFESCRIPT_API_URL=https://api.safescript.vic.gov.au
SAFESCRIPT_CLIENT_ID=<client-id>
SAFESCRIPT_CLIENT_SECRET=<client-secret>
```

### Code Files
| File | Purpose |
|---|---|
| `integrations/safeScript/safeScriptService.ts` | OAuth2 token, patient query, risk indicators |

### Integration Flow
```
1. Prescriber initiates prescription for Schedule 8/4 medicine
2. System auto-queries SafeScript with patient IHI
3. SafeScript returns 90-day supply history + risk indicators
4. Results displayed to prescriber before confirming prescription
5. Prescriber acknowledges SafeScript check
6. Prescription proceeds (or prescriber cancels based on risk)
7. SafeScript check recorded in audit_log
```

### Testing
```bash
# SafeScript provides a test environment:
# Test URL: https://api-test.safescript.vic.gov.au
# Test patients available from SafeScript vendor documentation
```

---

## 5. CMI / NOCC (Victorian Mental Health Reporting)

### Purpose
Submit Community Mental Health (CMI) data to the Victorian Department of Health. Includes episodes, service contacts, and outcome measures (HoNOS, K-10, LSP-16).

### External Service
CMI API Gateway (Department of Health Victoria)

### Prerequisites
1. Organisation code from DHHS Victoria
2. CMI API key from DHHS
3. Registered service types and team codes

### Environment Variables
```bash
CMI_API_URL=https://cmi.health.vic.gov.au/api/v1
CMI_ORG_CODE=<your-org-code>
CMI_API_KEY=<cmi-api-key>
CMI_SUBMISSION_MODE=test  # Change to 'production' when ready
```

### Code Files
| File | Purpose |
|---|---|
| `integrations/cmi/cmiService.ts` | Submit episodes, contacts, outcomes to CMI |
| `integrations/cmi/cmiDataExtractor.ts` | Extract EMR data into CMI format |
| `integrations/cmi/cmiTypes.ts` | TypeScript types for CMI data structures |
| `integrations/cmi/cmiRoutes.ts` | REST endpoints for CMI operations |

### Integration Flow
```
1. GET /cmi/status → check if CMI is configured
2. POST /cmi/prepare → extract and validate data for submission period
3. POST /cmi/submit → submit validated data to CMI API
4. GET /cmi/export?format=csv → download data for manual upload (backup)
```

### Data Mapping
| EMR Table | CMI Field | Notes |
|---|---|---|
| `episodes` | Episode | Start/end dates, episode type, closure reason |
| `contact_records` | Service Contact | Contact date, type, duration, practitioner |
| `outcome_measures` | Outcome Measure | HoNOS, K-10, LSP-16 with collection occasion |
| `staff` | Practitioner | Discipline, AHPRA number |

### Testing
```bash
# Use test mode first:
CMI_SUBMISSION_MODE=test

# Prepare submission:
curl -X POST http://localhost:4000/api/v1/cmi/prepare \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test" \
  -d '{"periodStart":"2026-01-01","periodEnd":"2026-03-31"}'

# Export for manual review:
curl http://localhost:4000/api/v1/cmi/export?format=csv \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test"
```

---

## 6. NHSD (National Health Services Directory)

### Purpose
Search for healthcare providers, practitioners, and services across Australia. Used for referral management and patient provider lookup.

### External Service
Healthdirect NHSD API v5 + FHIR v4

### Prerequisites
1. Register at https://developer.nhsd.healthdirect.org.au
2. Obtain API key

### Environment Variables
```bash
NHSD_API_URL=https://api.nhsd.healthdirect.org.au
NHSD_API_KEY=<nhsd-api-key>
NHSD_FHIR_URL=https://api.fhir.nhsd.healthdirect.org.au/v4
```

### Code Files
| File | Purpose |
|---|---|
| `integrations/nhsd/nhsdClient.ts` | Search practitioners, services, locations |
| `integrations/nhsd/nhsdRoutes.ts` | REST endpoints for NHSD queries |

### Testing
```bash
# Search for psychiatrists in Melbourne:
curl "http://localhost:4000/api/v1/nhsd/practitioners?specialty=psychiatry&postcode=3000" \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test"

# Search for mental health services:
curl "http://localhost:4000/api/v1/nhsd/services?type=mental_health&suburb=Melbourne" \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test"
```

---

## 7. HL7 v2 Pathology (MLLP)

### Purpose
Send pathology orders (ORM^O01) and receive results (ORU^R01) from laboratory systems via HL7 v2 over MLLP.

### External Service
Hospital/lab pathology system via TCP/MLLP

### Prerequisites
1. Network connectivity to lab system (often requires VPN or private network)
2. HL7 interface agreement with lab vendor
3. Segment mapping document from lab

### Environment Variables
```bash
HL7_LAB_HOST=lab-hl7.hospital.internal
HL7_LAB_PORT=2575
HL7_LAB_TIMEOUT=30000  # milliseconds
```

### Code Files
| File | Purpose |
|---|---|
| `integrations/pathology/mllpTransport.ts` | Raw TCP socket with MLLP framing |
| `jobs/workers/hl7Worker.ts` | BullMQ worker for async message processing |

### MLLP Protocol
```
Outbound message format:
  <0x0B> HL7 Message <0x1C><0x0D>

Inbound ACK format:
  <0x0B> MSA|AA|<message-control-id> <0x1C><0x0D>
```

### Integration Flow
```
1. Clinician orders pathology via EMR UI
2. ORM^O01 message built from order data
3. Message sent via MLLP to lab system
4. Lab sends ACK (AA=accepted, AE=error, AR=rejected)
5. Lab processes sample, generates result
6. Lab sends ORU^R01 result via MLLP back to EMR
7. HL7 inbound worker parses result → stores in pathology_results table
8. Clinician notified via SSE real-time event
```

### Testing
```bash
# Use a HL7 simulator (e.g., HAPI Test Panel, Mirth Connect):
# 1. Start simulator listening on port 2575
# 2. Configure HL7_LAB_HOST=localhost HL7_LAB_PORT=2575
# 3. Create a pathology order in EMR → verify ORM message received
# 4. Send ORU result from simulator → verify result appears in EMR
```

---

## 8. FHIR R4 / SMART on FHIR

### Purpose
Interoperability with other healthcare systems. Allows third-party FHIR apps to launch within Signacare EMR context.

### Endpoints Available
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/fhir/metadata` | Public | CapabilityStatement |
| GET | `/fhir/.well-known/smart-configuration` | Public | SMART discovery |
| GET | `/fhir/Patient` | JWT | Search patients |
| GET | `/fhir/Patient/:id` | JWT | Get patient by ID |
| POST | `/fhir/Patient` | JWT | Create patient from FHIR resource |
| GET | `/fhir/Condition` | JWT | Search diagnoses |
| GET | `/fhir/MedicationStatement` | JWT | Search medications |
| GET | `/fhir/AllergyIntolerance` | JWT | Search allergies |
| GET | `/fhir/Encounter` | JWT | Search episodes |
| GET | `/fhir/Observation` | JWT | Search assessments |
| POST | `/fhir/Observation` | JWT | Create observation |
| GET | `/fhir/DiagnosticReport` | JWT | Search pathology |
| GET | `/fhir/Practitioner` | JWT | Search staff |
| GET | `/fhir/Organization` | JWT | Search clinics |
| GET | `/fhir/$export` | JWT | Bulk NDJSON export |
| GET | `/fhir/auth/authorize` | None | SMART authorization |
| POST | `/fhir/auth/token` | None | SMART token exchange |

### SMART App Launch Flow
```
1. Third-party app discovers SMART config:
   GET /api/v1/fhir/.well-known/smart-configuration

2. App redirects user to authorization:
   GET /api/v1/fhir/auth/authorize?
     client_id=<app-id>&
     redirect_uri=<app-callback>&
     scope=patient/*.read launch&
     state=<random>

3. User authenticates in Signacare → redirected back with code

4. App exchanges code for token:
   POST /api/v1/fhir/auth/token
   { grant_type: "authorization_code", code: "<code>", client_id: "<app-id>" }

5. App uses token to access FHIR resources:
   GET /api/v1/fhir/Patient
   Authorization: Bearer <access_token>
```

### Testing
```bash
# Verify FHIR metadata (public):
curl http://localhost:4000/api/v1/fhir/metadata

# Verify SMART config (public):
curl http://localhost:4000/api/v1/fhir/.well-known/smart-configuration

# Search patients (authenticated):
curl http://localhost:4000/api/v1/fhir/Patient?family=Brown \
  -H "Authorization: Bearer <jwt>" -H "X-CSRF-Token: test"

# Bulk export:
curl http://localhost:4000/api/v1/fhir/\$export?_type=Patient \
  -H "Authorization: Bearer <jwt>" -H "X-CSRF-Token: test"
```

---

## 9. Zitavi Mobile Patient App

### Purpose
Sync patient-reported data (mood tracking, vitals, journal entries) from the Zitavi mobile app into Signacare EMR.

### Architecture
```
Zitavi Mobile App → MongoDB Atlas → EMR Gateway (port 4002) → Signacare API
```

### Prerequisites
1. MongoDB Atlas read-only credentials
2. EMR Gateway microservice running on port 4002

### Environment Variables

**EMR Gateway (`apps/emr-gateway/.env`):**
```bash
MONGO_URI=mongodb+srv://Signacare_emr_readonly:<password>@zitavi-dev.oygy189.mongodb.net/dev
PORT=4002
EMR_API_KEYS=dev-key-1,prod-key-abc123
```

**Signacare API (`apps/api/.env`):**
```bash
ZITAVI_GATEWAY_URL=http://localhost:4002/emr
ZITAVI_API_KEY=dev-key-1
```

### Code Files
| File | Purpose |
|---|---|
| `apps/emr-gateway/src/index.ts` | Express gateway with API key auth |
| `apps/emr-gateway/src/models/index.ts` | Mongoose models for Zitavi collections |
| `apps/api/src/features/patients/zitaviSyncRoutes.ts` | Sync + proxy endpoints |

### Testing
```bash
# Start EMR Gateway:
cd apps/emr-gateway && npm run dev

# Sync all Zitavi patients:
curl -X POST http://localhost:4000/api/v1/patients/zitavi-sync \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test"

# View Zitavi patient data (proxied):
curl http://localhost:4000/api/v1/patients/zitavi-proxy/patients \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test"
```

---

## 10. Ollama (Local LLM)

### Purpose
AI-powered clinical note generation, ICD-10 coding suggestions, clinical summaries, medication safety checks. All processing happens locally — no PHI sent to cloud.

### Prerequisites
1. Install Ollama: https://ollama.ai
2. Pull the model: `ollama pull qwen2.5:14b` (or `llama3.2`)
3. Ensure Ollama is running on port 11434

### Environment Variables
```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b   # or llama3.2 for lighter workloads
```

### Code Files
| File | Purpose |
|---|---|
| `features/llm/llmRoutes.ts` | Clinical AI endpoints (suggest, ambient-note, letter) |
| `features/llm/llmService.ts` | Ollama API interaction |
| `features/llm/scribeRoutes.ts` | Medical scribe (SOAP, ICD-10, MBS) |
| `mcp/ambientProcessor.ts` | 3-pass audio → SOAP pipeline |
| `mcp/server/aiAgent.ts` | MCP tool server for AI agent |

### Testing
```bash
# Verify Ollama is running:
curl http://localhost:11434/api/tags

# Test clinical suggestion:
curl -X POST http://localhost:4000/api/v1/llm/suggest \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Generate a progress note for a patient with treatment-resistant depression","context":"Patient on lithium 900mg, venlafaxine 225mg"}'
```

---

## 11. Whisper (Speech-to-Text)

### Purpose
Transcribe clinical consultations from audio to text for the AI medical scribe pipeline.

### Prerequisites
1. Deploy Whisper server (OpenAI Whisper or faster-whisper)
2. GPU recommended for real-time transcription
3. See `deploy/whisper-server/` for Docker setup

### Environment Variables
```bash
WHISPER_API_URL=http://localhost:8080
```

### Code Files
| File | Purpose |
|---|---|
| `features/llm/llmRoutes.ts` | POST `/llm/ambient-note` — full audio → SOAP |
| `features/llm/streamingTranscribeRoutes.ts` | Chunked streaming transcription |
| `mcp/ambientProcessor.ts` | Audio processing pipeline |

### Testing
```bash
# Verify Whisper is running:
curl http://localhost:8080/health

# Test transcription (requires audio file):
curl -X POST http://localhost:4000/api/v1/llm/ambient-note \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test" \
  -F "audio=@/path/to/recording.webm"
```

---

## 12. SMTP Email

### Purpose
Fallback email delivery when Outlook is not connected. Used for clinical correspondence, password resets, notifications.

### Prerequisites
1. SMTP server credentials (e.g., SendGrid, Mailgun, or institutional SMTP)

### Environment Variables
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<sendgrid-api-key>
SMTP_FROM=noreply@signacare.com.au
SMTP_NOREPLY=noreply@signacare.com.au
```

### Code Files
| File | Purpose |
|---|---|
| `features/messaging/messageRoutes.ts` | POST `/messages/send-email` |

### Testing
```bash
curl -X POST http://localhost:4000/api/v1/messages/send-email \
  -H "Cookie: signacare_access=<jwt>" -H "X-CSRF-Token: test" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "doctor@example.com",
    "subject": "Re: Patient — Clinical Correspondence",
    "body": "Dear Dr Smith,\n\nThis is a test email.\n\nRegards"
  }'
```

---

## 13. Sentry (Error Monitoring)

### Purpose
Production error tracking with PHI redaction.

### Prerequisites
1. Create Sentry project at https://sentry.io
2. Obtain DSN

### Environment Variables
```bash
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project-id>
```

### PHI Protection
The Sentry `beforeSend` hook in `server.ts` automatically redacts these fields from error reports:
- `medicareNumber`, `ihiNumber`, `dvaNumber`
- `phoneMobile`, `phoneHome`, `emailPrimary`
- `dateOfBirth`, `givenName`, `familyName`

### Testing
```bash
# Set SENTRY_DSN in .env and restart server
# Trigger an error (e.g., access non-existent endpoint)
# Check Sentry dashboard for the error
# Verify no PHI appears in the error report
```

---

## Integration Status Summary

| Integration | Status | Auth Type | Complexity | Priority |
|---|---|---|---|---|
| Outlook/O365 | ✅ Complete | OAuth2 | Medium | HIGH |
| eScript NPDS (ETP2) | 🟡 Partial | Mutual-TLS | High | HIGH |
| eScript eRx (ETP1) | 🟡 Partial | SOAP + Cert | High | HIGH |
| MySL | ✅ Complete | OAuth2 | Medium | HIGH |
| SafeScript | ✅ Complete | OAuth2 | Medium | HIGH (Vic) |
| CMI/NOCC | ✅ Complete | API Key | Medium | HIGH (Vic) |
| NHSD | ✅ Complete | API Key | Low | MEDIUM |
| HI Service | 🟡 Partial | SOAP + NASH | High | HIGH |
| My Health Record | ❌ Not started | NASH + Gateway | Very High | HIGH |
| HL7 v2 MLLP | ✅ Complete | TCP | Medium | MEDIUM |
| FHIR R4 | ✅ Complete | JWT | Low | HIGH |
| SMART on FHIR | ✅ Complete | OAuth2 | Medium | MEDIUM |
| Zitavi | ✅ Complete | API Key | Low | LOW |
| Ollama | ✅ Complete | Local HTTP | Low | HIGH |
| Whisper | ✅ Complete | Local HTTP | Low | HIGH |
| SMTP | ✅ Complete | Basic Auth | Low | MEDIUM |
| Sentry | ✅ Ready | DSN | Low | HIGH |

---

*End of Integration Guide*
