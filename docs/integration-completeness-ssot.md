# Integration Completeness SSOT

**Last refreshed:** 2026-06-03

This document is the current code-grounded source of truth for Signacare's
integration completeness. It is based on mounted routes, workflow wiring,
runtime guards, and explicit stub markers in the repository. It is not a
partner-readiness statement and it is not a marketing checklist.

## Status Legend

- `fully-linked`: mounted and used by at least one real workflow, with no explicit `NOT_IMPLEMENTED` barrier in the current path.
- `partially-linked`: substantial implementation exists, but the live workflow is subset-only, still uses placeholder fields, or depends on partner/runtime onboarding before full go-live.
- `stubbed`: explicit skeleton or `NOT_IMPLEMENTED` path remains in the product flow.

## Surface Matrix

| Surface | Status | Exact anchors | Current reality |
|---|---|---|---|
| ACS SMS | `fully-linked` | [ACS client](../apps/api/src/integrations/acs/acsClient.ts#L59), [patient outreach use](../apps/api/src/features/patient-outreach/patientOutreachService.ts#L39), [outreach send path](../apps/api/src/features/patient-outreach/patientOutreachService.ts#L192), [prod boot guard](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L131) | Real send path exists, is fail-visible when unconfigured, and is wired into patient outreach. |
| FCM push | `fully-linked` | [FCM client](../apps/api/src/integrations/fcm/fcmClient.ts#L57), [FCM dispatcher](../apps/api/src/integrations/fcm/fcmService.ts#L41), [patient outreach use](../apps/api/src/features/patient-outreach/patientOutreachService.ts#L40), [prod boot guard](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L122) | Push dispatch is wired for staff/patient tokens, dead-token pruning exists, and missing config fails visibly. |
| eScript / NPDS / eRx REST / MySL | `fully-linked` | [prescription routes](../apps/api/src/features/prescriptions/prescriptionRoutes.ts#L47), [NPDS config + submit](../apps/api/src/integrations/escript/npdsClient.ts#L216), [NPDS retry loop](../apps/api/src/integrations/escript/npdsClient.ts#L385), [eRx REST health + operations](../apps/api/src/integrations/escript/erxRestClient.ts#L153), [delivery token route](../apps/api/src/features/prescriptions/prescriptionRoutes.ts#L70), [boot guard](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L79) | Core prescribing pathways are implemented and guarded; production success depends on mTLS certs, per-clinic conformance IDs, and provider onboarding. |
| SafeScript | `fully-linked` | [service](../apps/api/src/integrations/safeScript/safeScriptService.ts#L59), [mandatory S8 enforcement](../apps/api/src/integrations/safeScript/safeScriptService.ts#L191), [prescription route](../apps/api/src/features/prescriptions/prescriptionRoutes.ts#L67), [frontend API](../apps/web/src/features/medications/services/prescriptionApi.ts#L21), [prod boot guard](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L94) | Real check flow, audit logging, and prescribing gate are present; runtime still depends on actual SafeScript credentials. |
| HL7 pathology transport | `fully-linked` | [HL7 dispatcher](../apps/api/src/integrations/hl7/hl7Transport.ts#L39), [MLLP transport](../apps/api/src/integrations/pathology/mllpTransport.ts#L39), [pathology outbound queue](../apps/api/src/features/pathology/pathologyService.ts#L30), [worker dispatch](../apps/api/src/jobs/workers/hl7Worker.ts#L160), [integration health snapshot](../apps/api/src/routes/health.ts#L108) | MLLP outbound/inbound is wired for pathology. Unsupported `sftp` and `rest` are explicitly refused rather than silently faked. |
| FHIR R4 + SMART | `partially-linked` | [public metadata mount](../apps/api/src/server.ts#L717), [FHIR protected mount](../apps/api/src/server.ts#L737), [SMART mounts](../apps/api/src/server.ts#L740), [subscription mount](../apps/api/src/server.ts#L748), [core FHIR routes](../apps/api/src/integrations/fhir/fhirRoutes.ts#L97), [additional resources](../apps/api/src/server.ts#L769) | A usable subset is live, but current scope is still selective rather than a full enterprise FHIR surface. |
| HI Service | `partially-linked` | [prescription HI routes](../apps/api/src/features/prescriptions/prescriptionRoutes.ts#L57), [admin verify mount](../apps/api/src/server.ts#L648), [verify routes](../apps/api/src/features/hi-service/hiServiceRoutes.ts#L20), [SOAP client](../apps/api/src/integrations/hiService/hiServiceClient.ts#L221), [web admin API](../apps/web/src/features/settings/services/hiServiceApi.ts#L11), [eRx config UI](../apps/web/src/features/settings/components/ErxConfigPanel.tsx#L104) | The core client is real and multiple routes use it, but live success still depends on NASH certs and Services Australia onboarding. |
| NHSD | `partially-linked` | [server mount](../apps/api/src/server.ts#L688), [NHSD routes](../apps/api/src/integrations/nhsd/nhsdRoutes.ts#L16), [provider search hook](../apps/web/src/features/patients/hooks/useProviderSearch.ts#L32), [registration UI wiring](../apps/web/src/features/patients/components/registration/Step7Providers.tsx#L86) | More than a bare client exists: provider search is wired into registration/edit flows. It is still a narrow workflow integration, not a platform-wide provider directory substrate. |
| Outlook / O365 | `partially-linked` | [server mount](../apps/api/src/server.ts#L657), [OAuth + mail/calendar routes](../apps/api/src/integrations/outlook/outlookRoutes.ts#L14), [teams/calendar/sharepoint service](../apps/api/src/integrations/outlook/office365Service.ts#L110) | The integration is functionally wired, but real behavior depends on tenant consent, Graph app registration, and clinic sender configuration. |
| CMI | `partially-linked` | [server mount](../apps/api/src/server.ts#L653), [CMI routes](../apps/api/src/integrations/cmi/cmiRoutes.ts#L8), [extractor](../apps/api/src/integrations/cmi/cmiDataExtractor.ts#L68) | Export/prepare/submit flows are present, but actual reporting completeness still depends on jurisdictional partner onboarding and operational validation. |
| MHR document push | `partially-linked` | [client](../apps/api/src/integrations/mhr/mhrDocumentClient.ts#L60), [push operation](../apps/api/src/integrations/mhr/mhrDocumentClient.ts#L229), [delivery service wiring](../apps/api/src/features/llm/letterDeliveryService.ts#L24), [current placeholder fields](../apps/api/src/features/llm/letterDeliveryService.ts#L124), [feature-flag guard](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L362) | The transport client is code-complete, but current letter-delivery wiring still passes placeholder HPI-O/HPI-I/CDA fields, so this is not full production-ready workflow wiring yet. |
| Evidence retrieval backend | `partially-linked` | [backend selector](../apps/api/src/integrations/evidence/evidenceClient.ts#L51), [retrieveEvidence](../apps/api/src/integrations/evidence/evidenceClient.ts#L82), [pgvector placeholder](../apps/api/src/integrations/evidence/evidenceClient.ts#L134) | `keyword` backend is usable; `pgvector` is still a fail-closed placeholder. |
| Agentic / ambient scribe LLM pipeline | `partially-linked` | [scribe mount](../apps/api/src/server.ts#L595), [agentic mount](../apps/api/src/server.ts#L599), [scribe route guards](../apps/api/src/features/llm/scribeRoutes.ts#L94), [agentic drafts route](../apps/api/src/features/llm/agenticScribeRoutes.ts#L84), [integration health snapshot for Ollama/Whisper](../apps/api/src/routes/health.ts#L180) | Core clinical AI wiring is present and gated, but reliability remains runtime-dependent on Ollama/Whisper availability and model-host operations. |
| HealthLink secure messaging | `stubbed` | [client header](../apps/api/src/integrations/healthlink/healthLinkClient.ts#L1), [explicit skeleton note](../apps/api/src/integrations/healthlink/healthLinkClient.ts#L14), [runtime throw](../apps/api/src/integrations/healthlink/healthLinkClient.ts#L54), [letter delivery hook](../apps/api/src/features/llm/letterDeliveryService.ts#L98) | The workflow touches the client, but the transport is explicitly not implemented. |
| Medicare ECLIPSE | `stubbed` | [client](../apps/api/src/integrations/medicare/eclipseClient.ts#L1), [config check](../apps/api/src/integrations/medicare/eclipseClient.ts#L47), [runtime throw](../apps/api/src/integrations/medicare/eclipseClient.ts#L60) | Still a skeleton guarded by partner/SAS2 requirements. |
| Radiology RIS | `stubbed` | [client](../apps/api/src/integrations/radiology/radiologyClient.ts#L1), [config check](../apps/api/src/integrations/radiology/radiologyClient.ts#L43), [runtime throw](../apps/api/src/integrations/radiology/radiologyClient.ts#L58), [feature-flag guard](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L372) | Explicit skeleton; no end-to-end radiology transport is live. |

## Deployment Blockers By Risk

| Risk | Blocker | Exact anchors | Why it matters |
|---|---|---|---|
| `P0` | Stubbed integrations still exist in live workflow surfaces | [HealthLink throw](../apps/api/src/integrations/healthlink/healthLinkClient.ts#L58), [ECLIPSE throw](../apps/api/src/integrations/medicare/eclipseClient.ts#L64), [Radiology throw](../apps/api/src/integrations/radiology/radiologyClient.ts#L72) | These are not “config pending”; they are explicit code stubs and must not be treated as go-live complete. |
| `P0` | Production boot requires exact secret contracts for regulated integrations | [boot assertion header](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L75), [NPDS payload key contract](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L254), [PHI key contract](../apps/api/src/shared/assertProductionIntegrationsConfigured.ts#L306), [Key Vault boot guard](../apps/api/src/server.ts#L47) | A wrong secret shape or missing cert does not degrade gracefully in production; it blocks safe startup or safe transaction flow. |
| `P1` | MHR transport exists but the current workflow wiring still uses placeholder document/identifier data | [letter delivery MHR branch](../apps/api/src/features/llm/letterDeliveryService.ts#L113), [placeholder fields](../apps/api/src/features/llm/letterDeliveryService.ts#L127), [real client expectation](../apps/api/src/integrations/mhr/mhrDocumentClient.ts#L34) | This is a classic “client complete, workflow incomplete” gap. |
| `P1` | Linux App Service and Windows VM deployment tracks are intentionally separate, but the repo currently contains active changes for deployment plus app code in the same worktree | [deployment split note](../deploy/azure/linux-deployment-readiness.md#L3), [deployment README](../deploy/azure/README.md#L1) | Mixed deployment/app slices increase review noise, staging confusion, and bad commits. |
| `P1` | Temporary deployment bundles were being left at repo root | [.gitignore](../.gitignore#L31) | This does not break runtime, but it pollutes release hygiene and makes it harder to isolate real source changes. |
| `P2` | Partial integrations still need partner tenancy, cert issuance, or sender-profile onboarding | [Outlook auth](../apps/api/src/integrations/outlook/outlookRoutes.ts#L14), [HI Service mTLS](../apps/api/src/integrations/hiService/hiServiceClient.ts#L53), [CMI routes](../apps/api/src/integrations/cmi/cmiRoutes.ts#L8), [SafeScript config](../apps/api/src/integrations/safeScript/safeScriptService.ts#L29) | These are likely deploy-ready in code, but not operationally ready without external setup. |
| `P2` | Evidence retrieval remains mixed-mode (`keyword` live, `pgvector` placeholder) | [backend selector](../apps/api/src/integrations/evidence/evidenceClient.ts#L51), [pgvector placeholder](../apps/api/src/integrations/evidence/evidenceClient.ts#L134) | AI evidence quality can vary by environment until vector retrieval is completed or explicitly deferred. |

## Current Repo Hygiene State

- Temporary root-level deployment ZIP bundles are non-source artifacts and should stay out of version control.
- Active tracked modifications still span both app/runtime files and deployment files. That means the repo is cleaner after artifact cleanup, but it is still **not yet a single atomic release slice**.

## Exact Next Slice To Execute

**Slice ID:** `DEP-LNX-01 — Linux deployment contract hardening and release isolation`

**Goal:** finish one clean deployment-only slice without changing application behavior.

**Scope:**

1. Stage only deployment/release-hygiene artifacts:
   - `deploy/azure/*`
   - `.github/workflows/azure-deploy.yml`
   - `.gitignore`
   - this document
2. Exclude active app feature edits from the deployment commit.
3. Run deterministic preflight against the target environment:
   - `bash deploy/azure/preflight-linux.sh staging`
4. Validate post-deploy smoke assumptions:
   - `ENV=staging bash deploy/azure/post-deploy-smoke.sh`
5. Produce an env-contract checklist for every `P0`/`P1` integration secret before the next cloud rollout.

**Do not start next:**

- finishing HealthLink/ECLIPSE/Radiology,
- broad app refactors,
- Windows VM recovery work,
- MHR workflow completion.

Those are separate slices and should not be bundled into `DEP-LNX-01`.
