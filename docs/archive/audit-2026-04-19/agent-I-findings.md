# Agent I — Integration health audit (COMPLETED)

## HIGH findings — missing integrations

**[HIGH-I1]** Radiology integration NOT FOUND. No DICOM/HL7 ORM sender; imaging orders entirely manual. Zero RIS integration. Gold-standard fix: implement HL7 v2 ORM^O01 sender via MLLP (parallel to pathology) or RIS adapter pattern.

**[HIGH-I2]** HealthLink / Argus secure messaging NOT FOUND. No secure outbound to GPs / specialists / pharmacies. Referrals + discharge summaries require manual print/email. Gold-standard fix: HL7 v2 SOAP over SFTP (HealthLink EDIFACT) or Argus REST with TLS client cert.

## MEDIUM findings

**[MED-I1]** Pathology orders not queued — mllpTransport.ts:39-102 sends direct TCP. Network blip = order loss. Fix: wrap in BullMQ lab-order queue with exponential backoff.

**[MED-I2]** No integration health endpoint. Ops cannot diagnose without reading logs. Fix: add `/api/v1/health/integrations` returning per-integration OK/FAIL/UNCONFIGURED + last-error.

**[MED-I3]** No admin alert on prescription pathway exhaustion (escriptService.ts:289-328). All 3 fallbacks fail → offline mode logged but NOT escalated. Fix: patientOutreachService admin_alert OR email when pathway=offline && configured=true.

**[MED-I4]** Sharepoint site hardcoded to 'root' (outlookEmailService.ts:12). Multi-site deployments fail. Fix: make O365_SHAREPOINT_SITE env var configurable per clinic.

## LOW findings

**[LOW-I1]** OAuth2 client_secret may leak via error messages (safeScriptService.ts:52, outlookEmailService.ts:46). Use structured logging with secret redaction.

**[LOW-I2]** MLLP parser decode-only; no confirmed bidirectional SOAP for HIS orders. Verify hl7Worker.ts ORM^O01 wiring to pathology order workflow.

**[LOW-I3]** SafeScript risk-indicator query swallows errors (safeScriptService.ts:144-153). No logging. Fix: log at debug + escalate to warn if checked=true but risk fetch fails.

## Integration inventory (13 LIVE, 1 STUB, 0 orphans)

| Integration | Status | Files |
|---|---|---|
| Pathology HL7/MLLP | LIVE | mllpTransport + hl7v2Parser + hl7Worker |
| Pharmacy/eRx (triple pathway) | LIVE | escriptService + NPDS + Adapter + REST |
| IHI Service | LIVE | hiServiceClient (SOAP + mutual TLS) |
| SMS/ACS | LIVE+MOCK | acsClient + patientOutreachWorker (BullMQ) |
| SafeScript (Vic PDMP) | LIVE | safeScriptService (mandatory S8 check) |
| FCM push | LIVE | fcmClient |
| FHIR R4 | LIVE | fhirRoutes + SMART Auth + bulk export |
| Outlook O365 | LIVE | outlookEmailService + outlookCalendarService |
| NHSD Provider Directory | LIVE | nhsdClient |
| CMI Vic MH Funding | LIVE | cmiService + cmiDataExtractor |
| Scribe prompt guard | LIVE | promptGuard (14 OWASP LLM01 patterns) |
| Evidence retrieval | STUB/KEYWORD | evidenceClient (pgvector scaffolded) |
| MySL Active Script List | LIVE | myslClient |

## Strengths

- 14 integrations, all env-driven (no hardcoded URLs)
- All major ops audit-logged with clinic/user/action
- Fail-safe patterns (Evidence/ACS/SafeScript never throw into caller)
- BullMQ queue for SMS/FCM/calendar/FHIR-bulk-export
- Prompt injection guard (14 OWASP LLM01 patterns)
- ADHA V3.0.1, OWASP LLM01, TGA 2026, APP 12 compliance

## Partial / gaps

- Medicare/ECLIPSE: MBS seed data present, no real claims submission
- PCEHR / MHR push: FHIR subscription wired, MHR document push not confirmed
