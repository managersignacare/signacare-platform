/**
 * eRx Adapter Service — ETP1 Paper Prescription Exchange
 *
 * Orchestrates the full ETP1 prescription lifecycle:
 *
 * 1. Build ERX001 SOAP payload from prescription data
 * 2. Submit to eRx Enterprise Adapter (HTTPS + site cert)
 * 3. Parse ERX002 acknowledgement
 * 4. Store eRx script number / token
 * 5. Poll for ERX005 dispense notifications
 *
 * This is the ETP1 layer that eRx requires BEFORE ETP2 (electronic prescribing).
 * Once ETP1 is accredited, the existing NPDS/FHIR layer handles ETP2.
 *
 * Integration flow:
 *   prescriptionService.submitErx()
 *     → escriptService.submitPrescription()
 *       → [ETP2] FHIR → NPDS
 *     → erxAdapterService.submitViaAdapter()
 *       → [ETP1] SOAP → eRx Adapter → eRx Gateway
 */

import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import { buildErx001, parseErx002, parseErx005, type Erx001Options, type Erx002Response } from './erxSoapPayloads';
import { uploadPrescription, downloadDispenseNotifications, isErxAdapterConfigured, getErxSiteId } from './erxAdapterClient';
import type { ErxSubmitPayload } from './escriptService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ErxAdapterSubmitOptions {
  prescription: ErxSubmitPayload;
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

export interface ErxAdapterSubmitResult {
  success: boolean;
  /** eRx-assigned script number (pharmacy uses this to download) */
  scriptNumber?: string;
  /** Digital Signing Platform ID */
  dspId?: string;
  /** eRx token (for ETP2 electronic prescriptions) */
  erxToken?: string;
  tokenExpiry?: string;
  /** Raw ERX002 response */
  erx002Response?: Erx002Response;
  error?: string;
}

export interface DispenseNotification {
  scriptNumber: string;
  prescriptionId?: string;
  dispensedDate: string;
  dispensedQuantity: number;
  pharmacyName?: string;
  pharmacistName?: string;
  pharmacyHpio?: string;
  repeatNumber?: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const erxAdapterService = {
  isConfigured(): boolean {
    return isErxAdapterConfigured();
  },

  /**
   * Submit a prescription to eRx Gateway via the Enterprise Adapter (ETP1).
   *
   * Flow: Build ERX001 XML → POST to adapter → Parse ERX002 response.
   */
  async submit(
    clinicId: string,
    actorId: string,
    opts: ErxAdapterSubmitOptions,
  ): Promise<ErxAdapterSubmitResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'eRx Adapter not configured. Set ERX_ADAPTER_URL, ERX_SITE_CERT_PATH, ERX_SITE_ID.' };
    }

    const siteId = getErxSiteId();
    if (!siteId) {
      return { success: false, error: 'ERX_SITE_ID not configured.' };
    }

    // Step 1: Build SOAP payload
    const erx001Options: Erx001Options = {
      prescription: opts.prescription,
      siteId,
      patientFamilyName: opts.patientFamilyName,
      patientGivenName: opts.patientGivenName,
      patientDob: opts.patientDob,
      patientGender: opts.patientGender,
      patientMedicareNumber: opts.patientMedicareNumber,
      prescriberFamilyName: opts.prescriberFamilyName,
      prescriberGivenName: opts.prescriberGivenName,
      prescriberNumber: opts.prescriberNumber,
      practiceAddress: opts.practiceAddress,
      practicePhone: opts.practicePhone,
      brandName: opts.brandName,
      brandSubstitutionNotPermitted: opts.brandSubstitutionNotPermitted,
      authorityApprovalNumber: opts.authorityApprovalNumber,
      deliverViaSms: opts.deliverViaSms,
      patientMobile: opts.patientMobile,
      deliverViaEmail: opts.deliverViaEmail,
      patientEmail: opts.patientEmail,
    };

    const soapXml = buildErx001(erx001Options);

    logger.info({
      prescriptionId: opts.prescription.prescriptionId,
      medication: opts.prescription.medicationName,
      siteId,
    }, '[eRx ETP1] Submitting prescription to adapter');

    // Step 2: Send to adapter
    let rawResponse: { status: number; body: string };
    try {
      rawResponse = await uploadPrescription(soapXml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error = `eRx Adapter connection failed: ${message}`;
      logger.error({ err, message }, '[eRx ETP1] Adapter connection error');

      await writeAuditLog({
        actorId, clinicId, action: 'CREATE', tableName: 'erx_etp1_submissions',
        recordId: opts.prescription.prescriptionId,
        newData: { status: 'connection_error', error },
      });

      return { success: false, error };
    }

    // Step 3: Parse ERX002 response
    const erx002 = parseErx002(rawResponse.body);

    await writeAuditLog({
      actorId, clinicId, action: 'CREATE', tableName: 'erx_etp1_submissions',
      recordId: opts.prescription.prescriptionId,
      newData: {
        httpStatus: rawResponse.status,
        erx002Success: erx002.success,
        scriptNumber: erx002.scriptNumber,
        errorCode: erx002.errorCode,
        errorMessage: erx002.errorMessage,
      },
    });

    if (!erx002.success) {
      logger.warn({
        prescriptionId: opts.prescription.prescriptionId,
        errorCode: erx002.errorCode,
        errorMessage: erx002.errorMessage,
      }, '[eRx ETP1] Upload rejected');

      return {
        success: false,
        erx002Response: erx002,
        error: `eRx rejected: ${erx002.errorCode ?? 'unknown'} — ${erx002.errorMessage ?? 'no details'}`,
      };
    }

    logger.info({
      prescriptionId: opts.prescription.prescriptionId,
      scriptNumber: erx002.scriptNumber,
      dspId: erx002.dspId,
    }, '[eRx ETP1] Prescription uploaded successfully');

    return {
      success: true,
      scriptNumber: erx002.scriptNumber,
      dspId: erx002.dspId,
      erxToken: erx002.erxToken,
      tokenExpiry: erx002.tokenExpiry,
      erx002Response: erx002,
    };
  },

  /**
   * Poll eRx Gateway for dispense notifications (ERX003 → ERX005).
   *
   * Call this periodically (e.g. every 15 minutes via BullMQ scheduler)
   * to update prescription statuses when pharmacies dispense.
   */
  async pollDispenseNotifications(
    clinicId: string,
    actorId: string,
  ): Promise<DispenseNotification[]> {
    if (!this.isConfigured()) return [];

    try {
      const rawResponse = await downloadDispenseNotifications();
      if (rawResponse.status < 200 || rawResponse.status >= 300) {
        logger.warn({ status: rawResponse.status }, '[eRx ETP1] Dispense poll returned non-200');
        return [];
      }

      // The response may contain multiple ERX005 notifications
      // Split on the ERX005 boundary and parse each
      const notifications: DispenseNotification[] = [];
      const blocks = rawResponse.body.split(/(?=<(?:\w+:)?DispenseNotification[\s>])/i);

      for (const block of blocks) {
        const parsed = parseErx005(block);
        if (parsed) {
          notifications.push({
            scriptNumber: parsed.scriptNumber,
            prescriptionId: parsed.prescriptionId,
            dispensedDate: parsed.dispensedDate,
            dispensedQuantity: parsed.dispensedQuantity,
            pharmacyName: parsed.dispensingPharmacyName,
            pharmacistName: parsed.dispensingPharmacistName,
            pharmacyHpio: parsed.pharmacyHpio,
            repeatNumber: parsed.repeatNumber,
          });

          await writeAuditLog({
            actorId, clinicId, action: 'CREATE', tableName: 'erx_dispense_notifications',
            recordId: parsed.scriptNumber,
            newData: {
              prescriptionId: parsed.prescriptionId,
              pharmacy: parsed.dispensingPharmacyName,
              dispensedDate: parsed.dispensedDate,
              quantity: parsed.dispensedQuantity,
            },
          });
        }
      }

      if (notifications.length > 0) {
        logger.info({ count: notifications.length }, '[eRx ETP1] Dispense notifications received');
      }

      return notifications;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, message }, '[eRx ETP1] Dispense poll failed');
      return [];
    }
  },
};
