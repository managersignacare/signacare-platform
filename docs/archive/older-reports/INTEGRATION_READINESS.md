# Signacare EMR — Integration Readiness Assessment

**Date:** 22 March 2026
**Assessed by:** AI Clinical Agent

---

## 1. eRx Script Exchange (Electronic Prescriptions)

### Status: 🟡 FRAMEWORK READY — Awaiting ADHA Conformance

### What Exists
| Component | Status | Location |
|-----------|--------|----------|
| eScript service interface | ✅ Complete | `apps/api/src/integrations/escript/escriptService.ts` |
| Prescription data model | ✅ Complete | `prescriptions` table — erx_token, erx_status, erx_payload columns |
| Prescription CRUD routes | ✅ Complete | `apps/api/src/features/prescriptions/` |
| Prescription repository | ✅ Complete | create, update, findByPatient, findByMedication |
| SafeScript pre-check hookpoint | ✅ Complete | Called before S8 prescriptions |
| Audit logging | ✅ Complete | All eRx operations audit-logged |
| Frontend eRx token field | ✅ Complete | PrescribeDialog has "eRx Token" field |
| PBS authority/streamlined codes | ✅ Complete | PBS codes for 30+ psych medications |

### What's Needed for Go-Live
| Requirement | Status | Notes |
|-------------|--------|-------|
| ADHA Conformance ID | ❌ Not started | Apply at developer.digitalhealth.gov.au |
| ADHA Mutual TLS Certificate | ❌ Not started | PKI certificate for NPDS endpoint auth |
| HPII/HPIO registration | ❌ Not started | Healthcare Provider Identifier for each prescriber |
| IHI lookup integration | ❌ Not started | Individual Healthcare Identifier for patients |
| FHIR R4 MedicationRequest builder | ❌ Not started | Build HL7 FHIR payload for NPDS |
| NPDS endpoint wiring | ❌ Stubbed | Replace stub in escriptService.submitPrescription() |
| Token display/barcode | ❌ Not started | QR/barcode for pharmacy scanning |
| Active Script List (ASL) query | ❌ Not started | Check existing prescriptions on ASL |
| Conformance testing | ❌ Not started | ADHA test environment validation |

### API Specification
```
NPDS Base URL: https://api.digitalhealth.gov.au/npds/v1
Auth: Mutual TLS (ADHA-issued certificate)
Format: FHIR R4 JSON

POST /MedicationRequest — submit prescription
GET  /MedicationRequest?patient={IHI} — query ASL
PUT  /MedicationRequest/{id} — cancel/update
```

### Environment Variables Required
```env
NPDS_API_URL=https://api.digitalhealth.gov.au/npds/v1
NPDS_CONFORMANCE_ID=<from ADHA>
ADHA_HPII=<prescriber HPII>
ADHA_CERT_PATH=/certs/adha-mutual-tls.p12
ADHA_CERT_PASSPHRASE=<passphrase>
```

### Effort Estimate
- ADHA registration & conformance: 4-8 weeks (external dependency)
- FHIR payload builder: 2-3 days dev
- NPDS wiring + error handling: 2-3 days dev
- Conformance testing: 1-2 weeks
- **Total: 6-12 weeks** (mostly blocked on ADHA approval)

---

## 2. SafeScript (Victoria RTPM)

### Status: 🟡 FRAMEWORK READY — Awaiting API Credentials

### What Exists
| Component | Status | Location |
|-----------|--------|----------|
| SafeScript service interface | ✅ Complete | `apps/api/src/integrations/safeScript/safeScriptService.ts` |
| Patient identifier model | ✅ Complete | IHI, Medicare, name, DOB |
| Supply/history response model | ✅ Complete | SafeScriptSupply interface |
| Risk indicator handling | ✅ Complete | riskIndicators array |
| Pre-prescription check hookpoint | ✅ Complete | Called in prescriptionService before S8 Rx |
| Audit logging (APP compliance) | ✅ Complete | All checks logged per APP 12 |
| Frontend SafeScript panel | ✅ Complete | SafeScript alert card in MedicationsTab |
| S8 medication flagging | ✅ Complete | is_s8 flag on patient_medications |

### What's Needed for Go-Live
| Requirement | Status | Notes |
|-------------|--------|-------|
| SafeScript API credentials | ❌ Not started | Apply via safescript.vic.gov.au |
| OAuth2 client registration | ❌ Not started | client_id + client_secret |
| API endpoint wiring | ❌ Stubbed | Replace stub in checkPatient() |
| IHI resolution for patients | ❌ Not started | Need HI Service for IHI lookup |
| Alert display logic | ⚠️ Partial | Card exists but shows "No alerts" always |
| Multi-state PDMP support | ❌ Not started | NSW HealthConnect, QLD QScript |
| Mandatory check enforcement | ⚠️ Partial | S8 flag exists but doesn't block prescribing |

### API Specification
```
SafeScript Base URL: https://api.safescript.vic.gov.au/v1
Auth: OAuth2 Client Credentials

POST /oauth/token — get bearer token
GET  /patients/{ihi}/supplies?lookbackDays=90 — supply history
GET  /patients/{ihi}/risk-indicators — risk flags
```

### Environment Variables Required
```env
SAFESCRIPT_API_URL=https://api.safescript.vic.gov.au/v1
SAFESCRIPT_CLIENT_ID=<from registration>
SAFESCRIPT_CLIENT_SECRET=<from registration>
```

### Effort Estimate
- SafeScript registration: 2-4 weeks (external)
- OAuth + API wiring: 1-2 days dev
- Alert display logic: 1 day dev
- Mandatory check enforcement: 1 day dev
- Testing with sandbox: 1 week
- **Total: 4-6 weeks** (mostly blocked on registration)

---

## 3. Pathology Integration (HL7 v2 / FHIR)

### Status: 🟢 MOST COMPLETE — Awaiting Lab Endpoint Configuration

### What Exists
| Component | Status | Location |
|-----------|--------|----------|
| HL7 v2.5 ORM^O01 builder | ✅ Complete | `apps/api/src/jobs/workers/hl7Worker.ts` |
| HL7 v2 ORU^R01 parser | ✅ Complete | Parses OBX segments → structured results |
| HL7 flag mapping | ✅ Complete | Normal/Low/High/Critical/Abnormal |
| Result status mapping | ✅ Complete | Preliminary/Final/Corrected/Cancelled |
| Pathology order CRUD | ✅ Complete | `pathology_orders` table + service |
| Pathology result CRUD | ✅ Complete | `pathology_results` table + service |
| BullMQ outbound queue | ✅ Complete | Async order submission |
| BullMQ inbound queue | ✅ Complete | Async result ingestion |
| Order number generation | ✅ Complete | PATH-YYYYMMDD-XXXXXXXX format |
| Frontend pathology order form | ✅ Complete | PathologyOrderForm component |
| Frontend results display | ✅ Complete | PathologyResultsList component |
| Panel/test configuration | ✅ Complete | Configurable in staff-settings |

### What's Needed for Go-Live
| Requirement | Status | Notes |
|-------------|--------|-------|
| Lab endpoint URL | ❌ Not configured | MLLP/TCP or REST endpoint |
| MLLP transport layer | ❌ Not started | TCP socket for HL7 v2 |
| SFTP transport option | ❌ Not started | Alternative for batch results |
| Lab-specific message profiles | ❌ Not started | Each lab has variations |
| Patient ID mapping | ⚠️ Partial | Uses internal ID — need UR/MRN mapping |
| Result auto-notification | ❌ Not started | Alert clinician on abnormal results |
| Cumulative result view | ⚠️ Partial | Individual results but no trending |
| PDF report attachment | ❌ Not started | Labs often send PDF alongside structured |

### Transport Options
```
Option 1: MLLP (Minimum Lower Layer Protocol)
  - TCP socket, port 2575 (standard)
  - Real-time bidirectional
  - Most pathology labs support this

Option 2: SFTP Batch
  - Scheduled file drop/pickup
  - Suitable for labs without MLLP
  - Batch processing via cron

Option 3: FHIR R4 REST (newer labs)
  - POST /DiagnosticReport
  - POST /Observation
  - Growing adoption in Australia
```

### Environment Variables Required
```env
# MLLP Transport
HL7_LAB_HOST=lab.pathology.com.au
HL7_LAB_PORT=2575
HL7_LAB_RECEIVING_APP=LAB_LIS
HL7_LAB_RECEIVING_FACILITY=PATHOLOGY_CO

# SFTP Transport (alternative)
HL7_SFTP_HOST=sftp.pathology.com.au
HL7_SFTP_USER=signacare_emr
HL7_SFTP_KEY_PATH=/certs/sftp_key

# Redis (for BullMQ workers)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Effort Estimate
- MLLP transport implementation: 2-3 days dev
- Lab-specific message profiling: 1-2 days per lab
- Result notification system: 1 day dev
- Cumulative trending: 2 days dev
- **Total: 1-2 weeks** (mostly dev work, less external dependency)

---

## Summary Matrix

| Integration | Data Model | Service Layer | API Client | Frontend | External Registration | Go-Live Ready |
|-------------|-----------|---------------|------------|----------|-----------------------|---------------|
| **eRx/NPDS** | ✅ | ✅ Stubbed | ❌ | ⚠️ Partial | ❌ ADHA | 🟡 6-12 weeks |
| **SafeScript** | ✅ | ✅ Stubbed | ❌ | ⚠️ Partial | ❌ DHHS Vic | 🟡 4-6 weeks |
| **Pathology** | ✅ | ✅ Complete | ⚠️ Transport | ✅ | ⚠️ Lab config | 🟢 1-2 weeks |

### Recommended Next Steps
1. **Pathology** — closest to production. Wire MLLP transport and configure first lab.
2. **SafeScript** — begin registration process (long lead time). Dev work is minimal.
3. **eRx** — begin ADHA conformance application. Largest dev effort for FHIR builder.

### Common Prerequisite: Healthcare Identifiers
All three integrations require access to the **HI Service** (Healthcare Identifiers):
- **IHI** (Individual Healthcare Identifier) for patients
- **HPII** (Healthcare Provider Identifier - Individual) for clinicians
- **HPIO** (Healthcare Provider Identifier - Organisation) for the service

Apply at: https://developer.digitalhealth.gov.au/products/hi-service
