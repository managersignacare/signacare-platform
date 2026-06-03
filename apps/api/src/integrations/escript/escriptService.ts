/**
 * eScript Integration Service — Unified Prescription Submission
 *
 * Orchestrates BOTH ETP1 (eRx SOAP Adapter) and ETP2 (NPDS FHIR) flows:
 *
 * Flow priority:
 *   1. If NPDS configured → submit ETP2 (FHIR R4 MedicationRequest)
 *   2. If eRx Adapter configured → submit ETP1 (SOAP ERX001 via adapter)
 *   3. If neither → offline mode (build FHIR resource, log, return error)
 *
 * When BOTH are configured (required for full Conformance Profile V3):
 *   1. Submit to eRx Adapter (ETP1) — paper backup + pharmacy download
 *   2. Submit to NPDS (ETP2) — electronic token + Active Script List
 *
 * ADHA conformance profile: General Prescribing Systems v3.0.1
 */
import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import { buildFhirMedicationRequest, validateFhirPrescription } from './fhirPrescriptionBuilder';
import { submitToNpds, cancelOnNpds, isNpdsConfigured } from './npdsClient';
import { erxAdapterService, type ErxAdapterSubmitOptions } from './erxAdapterService';
import * as erxRestClient from './erxRestClient';
import {
  buildErx001Xml,
  buildErx023Xml,
  buildErx025Xml,
  buildErx027Xml,
  buildErx019Xml,
  buildErx061Xml,
  buildErx065Xml,
} from './erxRestPayloads';
import type { ErxPrescriptionPayload } from './erxRestPayloads';

export interface ErxSubmitPayload {
  prescriptionId: string;
  patientIhi: string;
  prescriberHpii: string;
  prescriberHpio: string;
  medicationName: string;
  dose: string;
  route: string;
  frequency: string;
  quantity: number;
  repeats: number;
  pbsItemCode?: string;
  isS8: boolean;
  directions?: string;
  prescribedDate: string;
  authorityMode?: 'general' | 'streamlined' | 'phone' | 'written' | 'private';
  authorityApprovalNumber?: string;
  isPrivateScript?: boolean;
  privateScriptNumber?: string;
  privatePriceCents?: number;
  repeatIntervalDays?: number;
  deferredUntilDate?: string;
}

export interface ErxSubmitResult {
  success: boolean;
  erxToken?: string;
  dspId?: string;
  npdsReference?: string;
  /** eRx ETP1 script number (for pharmacy download) */
  scriptNumber?: string;
  expiresAt?: string;
  fhirResource?: unknown;
  rawResponse?: unknown;
  /** Which pathway succeeded: 'npds' (ETP2), 'adapter' (ETP1), 'erx-rest' (REST API), 'both', or 'offline' */
  pathway?: 'npds' | 'adapter' | 'erx-rest' | 'both' | 'offline';
  /** SCID assigned to the prescription (eRx REST pathway) */
  scid?: string;
  error?: string;
}

export interface ErxCancelResult {
  success: boolean;
  rawResponse?: unknown;
  error?: string;
}

/** Extended payload for ETP1 submission (needs patient/prescriber demographics) */
export interface ErxSubmitWithDemographics extends ErxSubmitPayload {
  patientFamilyName: string;
  patientGivenName: string;
  patientDob: string;
  patientGender: string;
  patientMedicareNumber?: string;
  patientMobile?: string;
  patientEmail?: string;
  prescriberFamilyName: string;
  prescriberGivenName: string;
  prescriberNumber: string;
  practiceAddress?: string;
  practicePhone?: string;
  brandName?: string;
  brandSubstitutionNotPermitted?: boolean;
  authorityApprovalNumber?: string;
  deliverViaSms?: boolean;
  deliverViaEmail?: boolean;
}

/** Optional context for eRx REST cancellation (ERX023 — requires full prescription payload) */
export interface ErxCancelContext {
  /** SCID of the prescription (required for eRx REST cancel) */
  scid?: string;
  /** Full prescription payload for ERX023 (same structure as ERX001 but submitted with State=Cancelled) */
  prescriptionPayload?: import('./erxRestPayloads').ErxPrescriptionPayload;
}

/** Generic result for REST-only operations (amend, cease, reactivate, reissue) */
export interface ErxOperationResult {
  success: boolean;
  rawResponse?: unknown;
  error?: string;
}

export interface EscriptService {
  submitPrescription(clinicId: string, actorId: string, payload: ErxSubmitPayload | ErxSubmitWithDemographics): Promise<ErxSubmitResult>;
  cancelToken(clinicId: string, actorId: string, erxToken: string, reason: string, context?: ErxCancelContext): Promise<ErxCancelResult>;
  /** ERX025 + ERX027: checkout then amend a prescription */
  amendPrescription(clinicId: string, actorId: string, scid: string, payload: ErxPrescriptionPayload): Promise<ErxOperationResult>;
  /** ERX061: cease the latest supply */
  ceasePrescription(clinicId: string, actorId: string, scid: string): Promise<ErxOperationResult>;
  /** ERX019: reactivate a cancelled prescription */
  reactivatePrescription(clinicId: string, actorId: string, scid: string, payload: ErxPrescriptionPayload): Promise<ErxOperationResult>;
  /** ERX065: reissue token (send new SMS/email) */
  reissueToken(clinicId: string, actorId: string, scid: string, tokenDelivery?: { sms?: string; email?: string }): Promise<ErxOperationResult>;
  isConfigured(): boolean;
  isEtp1Configured(): boolean;
  isEtp2Configured(): boolean;
}

function hasDemographics(p: ErxSubmitPayload | ErxSubmitWithDemographics): p is ErxSubmitWithDemographics {
  return 'patientFamilyName' in p && !!p.patientFamilyName;
}

function getAuditTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

type ErxAuditExtensionInput = {
  operation:
    | 'submit'
    | 'cancel'
    | 'amend'
    | 'cease'
    | 'reactivate'
    | 'reissue_token';
  outcome: 'success' | 'failure' | 'attempted';
  guid?: string | null;
  scid?: string | null;
  npdsReference?: string | null;
  npdsAcknowledgedAt?: string | null;
  erxToken?: string | null;
  pathway?: ErxSubmitResult['pathway'] | null;
  error?: string | null;
};

function buildErxAuditExtension(input: ErxAuditExtensionInput): Record<string, unknown> {
  return {
    operation: input.operation,
    outcome: input.outcome,
    guid: input.guid ?? null,
    scid: input.scid ?? null,
    npdsReference: input.npdsReference ?? null,
    npdsAcknowledgedAt: input.npdsAcknowledgedAt ?? null,
    erxToken: input.erxToken ?? null,
    pathway: input.pathway ?? null,
    timezone: getAuditTimezone(),
    auditedAt: new Date().toISOString(),
    // BUG-P6 anchor fields requested by DH-3945 §2B + DH-4155 §4
    auditSpec: 'dh3945-2B-dh4155-4',
  };
}

class EscriptServiceImpl implements EscriptService {
  isConfigured(): boolean {
    return isNpdsConfigured() || erxAdapterService.isConfigured() || erxRestClient.isConfigured();
  }

  isEtp1Configured(): boolean {
    return erxAdapterService.isConfigured();
  }

  isEtp2Configured(): boolean {
    return isNpdsConfigured();
  }

  isErxRestConfigured(): boolean {
    return erxRestClient.isConfigured();
  }

  async submitPrescription(
    clinicId: string,
    actorId: string,
    payload: ErxSubmitPayload | ErxSubmitWithDemographics,
  ): Promise<ErxSubmitResult> {
    // Step 1: Build FHIR resource (always — used for NPDS and as structured record)
    const fhirResource = buildFhirMedicationRequest(payload);
    const validation = validateFhirPrescription(fhirResource);
    if (!validation.valid) {
      return { success: false, error: `Validation failed: ${validation.errors.join(', ')}`, fhirResource, pathway: 'offline' };
    }

    let etp1Success = false;
    let etp1ScriptNumber: string | undefined;
    let etp1DspId: string | undefined;
    let etp1Token: string | undefined;
    let etp1Error: string | undefined;

    let etp2Success = false;
    let etp2Token: string | undefined;
    let etp2NpdsRef: string | undefined;
    let etp2ExpiresAt: string | undefined;
    let etp2Error: string | undefined;
    let etp2RawResponse: unknown;

    // Step 2: Submit ETP1 (eRx Adapter) if configured and demographics available
    if (erxAdapterService.isConfigured() && hasDemographics(payload)) {
      const adapterOpts: ErxAdapterSubmitOptions = {
        prescription: payload,
        patientFamilyName: payload.patientFamilyName,
        patientGivenName: payload.patientGivenName,
        patientDob: payload.patientDob,
        patientGender: payload.patientGender,
        patientMedicareNumber: payload.patientMedicareNumber,
        patientMobile: payload.patientMobile,
        patientEmail: payload.patientEmail,
        prescriberFamilyName: payload.prescriberFamilyName,
        prescriberGivenName: payload.prescriberGivenName,
        prescriberNumber: payload.prescriberNumber,
        practiceAddress: payload.practiceAddress,
        practicePhone: payload.practicePhone,
        brandName: payload.brandName,
        brandSubstitutionNotPermitted: payload.brandSubstitutionNotPermitted,
        authorityApprovalNumber:
          payload.authorityMode === 'phone' || payload.authorityMode === 'written'
            ? payload.authorityApprovalNumber
            : undefined,
        deliverViaSms: payload.deliverViaSms,
        deliverViaEmail: payload.deliverViaEmail,
      };

      const etp1Result = await erxAdapterService.submit(clinicId, actorId, adapterOpts);
      etp1Success = etp1Result.success;
      etp1ScriptNumber = etp1Result.scriptNumber;
      etp1DspId = etp1Result.dspId;
      etp1Token = etp1Result.erxToken;
      etp1Error = etp1Result.error;

      logger.info({
        prescriptionId: payload.prescriptionId,
        etp1Success,
        scriptNumber: etp1ScriptNumber,
      }, '[eScript] ETP1 submission result');
    }

    // Step 3: Submit ETP2 (NPDS) if configured
    if (isNpdsConfigured()) {
      // BUG-302 — pass clinicId so NPDS receives per-clinic conformance ID.
      const npdsResult = await submitToNpds(fhirResource, clinicId);
      etp2Success = npdsResult.success;
      etp2Token = npdsResult.erxToken;
      etp2NpdsRef = npdsResult.npdsId;
      etp2ExpiresAt = npdsResult.expiresAt;
      etp2RawResponse = npdsResult.rawResponse;
      etp2Error = npdsResult.error;

      logger.info({
        prescriptionId: payload.prescriptionId,
        etp2Success,
        erxToken: etp2Token,
      }, '[eScript] ETP2 submission result');
    }

    // Step 3b: Submit via eRx REST API if configured and demographics available
    let erxRestSuccess = false;
    let erxRestScid: string | undefined;
    let erxRestError: string | undefined;

    if (erxRestClient.isConfigured() && hasDemographics(payload) && !etp1Success && !etp2Success) {
      try {
        const scid = erxRestClient.generateScid('2');
        const xmlPayload = buildErx001Xml({
          scid,
          guid: payload.prescriptionId,
          conformanceId: process.env['ERX_REST_CONFORMANCE_ID'] ?? 'Signacare|1.0.0',
          patient: {
            familyName: payload.patientFamilyName,
            givenName: payload.patientGivenName,
            dob: payload.patientDob,
            gender: (payload.patientGender?.charAt(0)?.toUpperCase() as 'M' | 'F' | 'U') ?? 'U',
            medicareNumber: payload.patientMedicareNumber,
            mobile: payload.patientMobile,
            email: payload.patientEmail,
            ihi: payload.patientIhi,
          },
          clinician: {
            prescriberNumber: payload.prescriberNumber,
            providerNumber: payload.prescriberNumber, // provider number from staff profile
            givenName: payload.prescriberGivenName,
            familyName: payload.prescriberFamilyName,
            hpii: payload.prescriberHpii,
            // BUG-295 — propagate HPI-O from payload so the eRx XML
            // carries a real <PrescriberHPIO>. Pre-fix this field was
            // not set on the clinician object at all, even though the
            // ErxSubmitPayload interface has carried prescriberHpio
            // since day one. Layer 1 defence — erxRestPayloads'
            // buildFullPrescriptionXml now hard-throws on missing or
            // malformed HPI-O.
            hpio: payload.prescriberHpio,
            practiceName: 'Signacare EMR',
            practiceAddress1: payload.practiceAddress,
            practicePhone: payload.practicePhone,
          },
          item: {
            prescriptionDate: payload.prescribedDate,
            tradeName: payload.medicationName,
            genericName: payload.medicationName,
            genericIntention: payload.brandSubstitutionNotPermitted ? 'B' : 'G',
            quantity: payload.quantity,
            repeats: payload.repeats,
            route: payload.route,
            directions: payload.directions ?? '',
            isSchedule8: payload.isS8,
            pbsCode: payload.pbsItemCode,
            isPrivate: payload.authorityMode === 'private' || payload.isPrivateScript === true,
            authorityNumber: payload.authorityApprovalNumber,
            phoneApprovalNumber: payload.authorityMode === 'phone'
              ? payload.authorityApprovalNumber
              : undefined,
            repeatIntervalDays: payload.repeatIntervalDays ?? 0,
            scriptNumber: payload.privateScriptNumber,
            aipDescription: payload.medicationName,
          },
          tokenDelivery: {
            sms: payload.patientMobile,
            email: payload.patientEmail,
          },
        });

        const result = await erxRestClient.createPrescription(scid, xmlPayload);
        erxRestSuccess = result.success;
        erxRestScid = scid;
        if (!result.success) erxRestError = result.errorDescription ?? `HTTP ${result.status}`;

        logger.info({ prescriptionId: payload.prescriptionId, erxRestSuccess, scid }, '[eScript] eRx REST API submission result');
      } catch (err) {
        erxRestError = err instanceof Error ? err.message : String(err) || 'eRx REST submission error';
        logger.error({ err, prescriptionId: payload.prescriptionId }, '[eScript] eRx REST API submission failed');
      }
    }

    // Step 4: Determine pathway and result
    const pathway = (etp1Success && etp2Success) ? 'both'
      : etp2Success ? 'npds'
      : etp1Success ? 'adapter'
      : erxRestSuccess ? 'erx-rest'
      : 'offline';

    const submitAudit = buildErxAuditExtension({
      operation: 'submit',
      outcome: pathway === 'offline' ? 'failure' : 'success',
      guid: payload.prescriptionId,
      npdsReference: etp2NpdsRef ?? null,
      npdsAcknowledgedAt: etp2Success ? new Date().toISOString() : null,
      erxToken: etp2Token ?? etp1Token ?? null,
      pathway,
      error: pathway === 'offline' ? [etp1Error, etp2Error, erxRestError].filter(Boolean).join(' | ') : null,
    });
    await writeAuditLog({
      actorId, clinicId, action: 'CREATE', tableName: 'erx_tokens',
      recordId: payload.prescriptionId,
      newData: {
        ...submitAudit,
        etp1Success,
        etp1ScriptNumber,
        etp2Success,
        etp2Token,
        medication: payload.medicationName,
        authorityMode: payload.authorityMode ?? null,
        authorityApprovalNumber: payload.authorityApprovalNumber ?? null,
        isPrivateScript: payload.authorityMode === 'private' || payload.isPrivateScript === true,
        privateScriptNumber: payload.privateScriptNumber ?? null,
        privatePriceCents: payload.privatePriceCents ?? null,
        repeatIntervalDays: payload.repeatIntervalDays ?? null,
        deferredUntilDate: payload.deferredUntilDate ?? null,
      },
    });

    if (pathway === 'offline') {
      logger.info({ prescriptionId: payload.prescriptionId }, '[eScript] Offline mode — no adapter or NPDS configured/succeeded');
      // Audit Tier 7.3 (MED-I3) — all 3 pathways failed. Raise an
      // admin alert so a clinic operator can investigate the exhaustion
      // (could be transient — all pathways back ONLINE next call — or
      // systemic — credentials expired / endpoints unreachable).
      try {
        const { sendAdminAlert } = await import('../../features/patient-outreach/adminAlert');
        await sendAdminAlert({
          clinicId,
          kind: 'prescription_pathway_exhausted',
          payload: {
            prescriptionId: payload.prescriptionId,
            medicationName: payload.medicationName,
            etp1Error,
            etp2Error,
            erxRestError,
            raisedAt: new Date().toISOString(),
          },
        });
      } catch (alertErr) {
        logger.warn(
          { err: alertErr instanceof Error ? alertErr.message : String(alertErr), prescriptionId: payload.prescriptionId },
          '[eScript] Offline mode — admin alert dispatch failed (non-blocking)',
        );
      }
      return {
        success: false,
        fhirResource,
        pathway: 'offline',
        error: [etp1Error, etp2Error, erxRestError].filter(Boolean).join(' | ') || 'No eRx pathway configured or succeeded.',
      };
    }

    return {
      success: true,
      erxToken: etp2Token ?? etp1Token,
      dspId: etp1DspId,
      scriptNumber: etp1ScriptNumber,
      npdsReference: etp2NpdsRef,
      expiresAt: etp2ExpiresAt,
      scid: erxRestScid,
      fhirResource,
      rawResponse: etp2RawResponse,
      pathway,
    };
  }

  async cancelToken(clinicId: string, actorId: string, erxToken: string, reason: string, context?: ErxCancelContext): Promise<ErxCancelResult> {
    await writeAuditLog({
      actorId, clinicId, action: 'UPDATE', tableName: 'erx_tokens',
      recordId: erxToken,
      newData: {
        ...buildErxAuditExtension({
          operation: 'cancel',
          outcome: 'attempted',
          guid: context?.prescriptionPayload?.guid ?? null,
          scid: context?.scid ?? null,
          erxToken,
        }),
        reason,
      },
    });

    // Try NPDS (ETP2) first
    if (isNpdsConfigured()) {
      // BUG-302 — pass clinicId so NPDS receives per-clinic conformance ID.
      const result = await cancelOnNpds(erxToken, reason, clinicId);
      if (result.success) return { success: true };
      logger.warn({ erxToken, error: result.error }, '[eScript] NPDS cancel failed, trying eRx REST fallback');
    }

    // Fallback: eRx REST (ERX023) if SCID and full payload context available
    if (erxRestClient.isConfigured() && context?.scid && context.prescriptionPayload) {
      try {
        const xmlPayload = buildErx023Xml(context.prescriptionPayload);
        const result = await erxRestClient.cancelPrescription(context.scid, xmlPayload);
        if (result.success) {
          logger.info({ scid: context.scid }, '[eScript] eRx REST cancel succeeded (ERX023)');
          return { success: true, rawResponse: result.body };
        }
        return { success: false, error: result.errorDescription ?? `HTTP ${result.status}` };
      } catch (err) {
        logger.error({ err, scid: context.scid }, '[eScript] eRx REST cancel failed');
        return { success: false, error: err instanceof Error ? err.message : String(err) || 'eRx REST cancel error' };
      }
    }

    return { success: false, error: 'No cancel pathway available — NPDS not configured and eRx REST context missing.' };
  }

  async amendPrescription(clinicId: string, actorId: string, scid: string, payload: ErxPrescriptionPayload): Promise<ErxOperationResult> {
    if (!erxRestClient.isConfigured()) {
      return { success: false, error: 'eRx REST API not configured.' };
    }
    try {
      const conformanceId = process.env['ERX_REST_CONFORMANCE_ID'] ?? 'Signacare|1.0.0';
      // Step 1: Checkout (ERX025)
      const checkoutXml = buildErx025Xml({ scid, conformanceId });
      const checkoutResult = await erxRestClient.checkoutForAmend(scid, checkoutXml);
      if (!checkoutResult.success) {
        return { success: false, error: `ERX025 checkout failed: ${checkoutResult.errorDescription ?? `HTTP ${checkoutResult.status}`}` };
      }
      // Step 2: Amend (ERX027)
      const amendXml = buildErx027Xml(payload);
      const amendResult = await erxRestClient.amendPrescription(scid, amendXml);
      await writeAuditLog({
        actorId,
        clinicId,
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: scid,
        newData: buildErxAuditExtension({
          operation: 'amend',
          outcome: amendResult.success ? 'success' : 'failure',
          guid: payload.guid ?? null,
          scid,
          error: amendResult.success ? null : amendResult.errorDescription ?? `HTTP ${amendResult.status}`,
        }),
      });
      if (!amendResult.success) {
        return { success: false, error: `ERX027 amend failed: ${amendResult.errorDescription ?? `HTTP ${amendResult.status}`}` };
      }
      return { success: true, rawResponse: amendResult.body };
    } catch (err) {
      logger.error({ err, scid }, '[eScript] Amend prescription failed');
      return { success: false, error: err instanceof Error ? err.message : String(err) || 'Amend error' };
    }
  }

  async ceasePrescription(clinicId: string, actorId: string, scid: string): Promise<ErxOperationResult> {
    if (!erxRestClient.isConfigured()) {
      return { success: false, error: 'eRx REST API not configured.' };
    }
    try {
      const conformanceId = process.env['ERX_REST_CONFORMANCE_ID'] ?? 'Signacare|1.0.0';
      const xml = buildErx061Xml({ scid, conformanceId });
      const result = await erxRestClient.ceasePrescription(scid, xml);
      await writeAuditLog({
        actorId,
        clinicId,
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: scid,
        newData: buildErxAuditExtension({
          operation: 'cease',
          outcome: result.success ? 'success' : 'failure',
          scid,
          error: result.success ? null : result.errorDescription ?? `HTTP ${result.status}`,
        }),
      });
      if (!result.success) {
        return { success: false, error: result.errorDescription ?? `HTTP ${result.status}` };
      }
      return { success: true, rawResponse: result.body };
    } catch (err) {
      logger.error({ err, scid }, '[eScript] Cease prescription failed');
      return { success: false, error: err instanceof Error ? err.message : String(err) || 'Cease error' };
    }
  }

  async reactivatePrescription(clinicId: string, actorId: string, scid: string, payload: ErxPrescriptionPayload): Promise<ErxOperationResult> {
    if (!erxRestClient.isConfigured()) {
      return { success: false, error: 'eRx REST API not configured.' };
    }
    try {
      const xml = buildErx019Xml(payload);
      const result = await erxRestClient.reactivatePrescription(scid, xml);
      await writeAuditLog({
        actorId,
        clinicId,
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: scid,
        newData: buildErxAuditExtension({
          operation: 'reactivate',
          outcome: result.success ? 'success' : 'failure',
          guid: payload.guid ?? null,
          scid,
          error: result.success ? null : result.errorDescription ?? `HTTP ${result.status}`,
        }),
      });
      if (!result.success) {
        return { success: false, error: result.errorDescription ?? `HTTP ${result.status}` };
      }
      return { success: true, rawResponse: result.body };
    } catch (err) {
      logger.error({ err, scid }, '[eScript] Reactivate prescription failed');
      return { success: false, error: err instanceof Error ? err.message : String(err) || 'Reactivate error' };
    }
  }

  async reissueToken(clinicId: string, actorId: string, scid: string, tokenDelivery?: { sms?: string; email?: string }): Promise<ErxOperationResult> {
    if (!erxRestClient.isConfigured()) {
      return { success: false, error: 'eRx REST API not configured.' };
    }
    try {
      const conformanceId = process.env['ERX_REST_CONFORMANCE_ID'] ?? 'Signacare|1.0.0';
      const xml = buildErx065Xml({ scid, conformanceId, tokenDelivery });
      const result = await erxRestClient.reissueToken(scid, xml);
      await writeAuditLog({
        actorId,
        clinicId,
        action: 'UPDATE',
        tableName: 'erx_tokens',
        recordId: scid,
        newData: {
          ...buildErxAuditExtension({
            operation: 'reissue_token',
            outcome: result.success ? 'success' : 'failure',
            scid,
            error: result.success ? null : result.errorDescription ?? `HTTP ${result.status}`,
          }),
          tokenDelivery,
        },
      });
      if (!result.success) {
        return { success: false, error: result.errorDescription ?? `HTTP ${result.status}` };
      }
      return { success: true, rawResponse: result.body };
    } catch (err) {
      logger.error({ err, scid }, '[eScript] Reissue token failed');
      return { success: false, error: err instanceof Error ? err.message : String(err) || 'Reissue token error' };
    }
  }
}

export const escriptService: EscriptService = new EscriptServiceImpl();
