/**
 * eRx SOAP XML Payload Builders — ETP1 (Paper Prescription Exchange)
 *
 * Implements the eRx Script Exchange SOAP message types required for
 * ETP1 accreditation:
 *
 *   ERX001 — Prescription Upload (Prescribing → eRx Gateway)
 *   ERX002 — Upload Acknowledgement (response)
 *   ERX005 — Dispense Notification (pharmacy-side, parsed only)
 *
 * References:
 *   - eRx Adapter Integration Design V 1.6
 *   - Australian Standard AS 4700.2 (ePrescription)
 *   - HL7 V2 CDA prescription payload
 *
 * The ERX001 payload wraps a prescription in a SOAP envelope for
 * submission via the eRx Enterprise Adapter.
 */

import { randomUUID } from 'crypto';
import type { ErxSubmitPayload } from './escriptService';
import { lookupAmtCode } from './amtCodeMap';

// ── ERX001: Prescription Upload ─────────────────────────────────────────────

export interface Erx001Options {
  /** Prescription data */
  prescription: ErxSubmitPayload;
  /** eRx site ID (assigned by eRx on registration) */
  siteId: string;
  /** Patient Medicare number (for pharmacy matching) */
  patientMedicareNumber?: string;
  /** Patient family name */
  patientFamilyName: string;
  /** Patient given name */
  patientGivenName: string;
  /** Patient DOB (YYYYMMDD) */
  patientDob: string;
  /** Patient gender (M/F/U) */
  patientGender: string;
  /** Prescriber family name */
  prescriberFamilyName: string;
  /** Prescriber given name */
  prescriberGivenName: string;
  /** Prescriber number (Medicare prescriber number) */
  prescriberNumber: string;
  /** Practice address line */
  practiceAddress?: string;
  /** Practice phone */
  practicePhone?: string;
  /** Brand name (optional, for brand substitution) */
  brandName?: string;
  /** Brand substitution not permitted flag */
  brandSubstitutionNotPermitted?: boolean;
  /** Authority approval number */
  authorityApprovalNumber?: string;
  /** Whether to deliver token via SMS */
  deliverViaSms?: boolean;
  /** Patient mobile for token delivery */
  patientMobile?: string;
  /** Whether to deliver token via email */
  deliverViaEmail?: boolean;
  /** Patient email for token delivery */
  patientEmail?: string;
}

/**
 * Build ERX001 SOAP XML payload for prescription upload to eRx Gateway.
 *
 * This follows the eRx Adapter Integration Design specification.
 * The payload is a SOAP 1.2 envelope containing an HL7 CDA-based
 * prescription document.
 */
export function buildErx001(opts: Erx001Options): string {
  const rx = opts.prescription;
  const messageId = randomUUID();
  const timestamp = new Date().toISOString();
  const amt = lookupAmtCode(rx.medicationName);

  // PBS authority block
  const authorityBlock = rx.pbsItemCode
    ? `<authority>
        <prescriptionType>${opts.authorityApprovalNumber ? 'authority' : 'streamlined'}</prescriptionType>
        <pbsCode>${escapeXml(rx.pbsItemCode)}</pbsCode>
        ${opts.authorityApprovalNumber ? `<approvalNumber>${escapeXml(opts.authorityApprovalNumber)}</approvalNumber>` : ''}
      </authority>`
    : '';

  // Token delivery preferences (ETP2 extension — included for forward compat)
  const tokenDeliveryBlock = (opts.deliverViaSms || opts.deliverViaEmail)
    ? `<tokenDelivery>
        ${opts.deliverViaSms && opts.patientMobile ? `<sms>${escapeXml(opts.patientMobile)}</sms>` : ''}
        ${opts.deliverViaEmail && opts.patientEmail ? `<email>${escapeXml(opts.patientEmail)}</email>` : ''}
      </tokenDelivery>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:erx="http://ns.electronichealth.net.au/erx/prescription/1.0"
  xmlns:hl7="urn:hl7-org:v3">
  <soap:Header>
    <erx:MessageHeader>
      <erx:MessageId>${messageId}</erx:MessageId>
      <erx:MessageType>ERX001</erx:MessageType>
      <erx:Timestamp>${timestamp}</erx:Timestamp>
      <erx:SiteId>${escapeXml(opts.siteId)}</erx:SiteId>
      <erx:SoftwareVendor>Signacare EMR</erx:SoftwareVendor>
      <erx:SoftwareVersion>1.0.0</erx:SoftwareVersion>
    </erx:MessageHeader>
  </soap:Header>
  <soap:Body>
    <erx:UploadPrescription>
      <erx:PrescriptionDocument>
        <!-- Prescription Identifier -->
        <erx:PrescriptionId>${escapeXml(rx.prescriptionId)}</erx:PrescriptionId>
        <erx:PrescribedDate>${escapeXml(rx.prescribedDate)}</erx:PrescribedDate>

        <!-- Patient -->
        <erx:Patient>
          <erx:FamilyName>${escapeXml(opts.patientFamilyName)}</erx:FamilyName>
          <erx:GivenName>${escapeXml(opts.patientGivenName)}</erx:GivenName>
          <erx:DateOfBirth>${escapeXml(opts.patientDob)}</erx:DateOfBirth>
          <erx:Gender>${escapeXml(opts.patientGender)}</erx:Gender>
          ${opts.patientMedicareNumber ? `<erx:MedicareNumber>${escapeXml(opts.patientMedicareNumber)}</erx:MedicareNumber>` : ''}
          ${rx.patientIhi ? `<erx:IHI>${escapeXml(rx.patientIhi)}</erx:IHI>` : ''}
        </erx:Patient>

        <!-- Prescriber -->
        <erx:Prescriber>
          <erx:FamilyName>${escapeXml(opts.prescriberFamilyName)}</erx:FamilyName>
          <erx:GivenName>${escapeXml(opts.prescriberGivenName)}</erx:GivenName>
          <erx:PrescriberNumber>${escapeXml(opts.prescriberNumber)}</erx:PrescriberNumber>
          ${rx.prescriberHpii ? `<erx:HPII>${escapeXml(rx.prescriberHpii)}</erx:HPII>` : ''}
          ${rx.prescriberHpio ? `<erx:HPIO>${escapeXml(rx.prescriberHpio)}</erx:HPIO>` : ''}
          ${opts.practiceAddress ? `<erx:PracticeAddress>${escapeXml(opts.practiceAddress)}</erx:PracticeAddress>` : ''}
          ${opts.practicePhone ? `<erx:PracticePhone>${escapeXml(opts.practicePhone)}</erx:PracticePhone>` : ''}
        </erx:Prescriber>

        <!-- Medication -->
        <erx:Medication>
          <erx:GenericName>${escapeXml(rx.medicationName)}</erx:GenericName>
          ${opts.brandName ? `<erx:BrandName>${escapeXml(opts.brandName)}</erx:BrandName>` : ''}
          ${amt ? `<erx:AMTCode>${escapeXml(amt.sctId)}</erx:AMTCode>` : ''}
          <erx:Dose>${escapeXml(rx.dose)}</erx:Dose>
          <erx:Route>${escapeXml(rx.route)}</erx:Route>
          <erx:Frequency>${escapeXml(rx.frequency)}</erx:Frequency>
          <erx:Quantity>${rx.quantity}</erx:Quantity>
          <erx:Repeats>${rx.repeats}</erx:Repeats>
          ${rx.directions ? `<erx:Directions>${escapeXml(rx.directions)}</erx:Directions>` : ''}
          <erx:IsSchedule8>${rx.isS8}</erx:IsSchedule8>
          ${opts.brandSubstitutionNotPermitted ? '<erx:BrandSubstitutionNotPermitted>true</erx:BrandSubstitutionNotPermitted>' : ''}
        </erx:Medication>

        <!-- PBS / Authority -->
        ${authorityBlock}

        <!-- Token Delivery (ETP2 forward-compatible) -->
        ${tokenDeliveryBlock}

      </erx:PrescriptionDocument>
    </erx:UploadPrescription>
  </soap:Body>
</soap:Envelope>`;
}

// ── ERX002: Upload Acknowledgement Parser ───────────────────────────────────

export interface Erx002Response {
  success: boolean;
  messageId?: string;
  prescriptionId?: string;
  /** eRx-assigned script number (used for pharmacy download) */
  scriptNumber?: string;
  /** Digital Secure Platform ID */
  dspId?: string;
  /** eRx token (for ETP2 electronic prescriptions) */
  erxToken?: string;
  /** Token expiry date */
  tokenExpiry?: string;
  /** Error code from eRx */
  errorCode?: string;
  /** Error description */
  errorMessage?: string;
  /** Raw XML response */
  rawXml: string;
}

/**
 * Parse the ERX002 SOAP response from eRx Gateway.
 */
export function parseErx002(xml: string): Erx002Response {
  const result: Erx002Response = { success: false, rawXml: xml };

  // Check for SOAP fault
  const faultMatch = xml.match(/<(?:soap:)?Fault[\s>][\s\S]*?<faultstring>([^<]+)<\/faultstring>/i);
  if (faultMatch) {
    result.errorMessage = faultMatch[1];
    result.errorCode = extractTag(xml, 'faultcode') ?? 'SOAP_FAULT';
    return result;
  }

  // Check for eRx error response
  const errorCode = extractTag(xml, 'ErrorCode') ?? extractTag(xml, 'erx:ErrorCode');
  if (errorCode) {
    result.errorCode = errorCode;
    result.errorMessage = extractTag(xml, 'ErrorMessage') ?? extractTag(xml, 'erx:ErrorMessage') ?? 'Unknown eRx error';
    return result;
  }

  // Success — extract fields
  result.success = true;
  result.messageId = extractTag(xml, 'MessageId') ?? extractTag(xml, 'erx:MessageId');
  result.prescriptionId = extractTag(xml, 'PrescriptionId') ?? extractTag(xml, 'erx:PrescriptionId');
  result.scriptNumber = extractTag(xml, 'ScriptNumber') ?? extractTag(xml, 'erx:ScriptNumber');
  result.dspId = extractTag(xml, 'DspId') ?? extractTag(xml, 'erx:DspId');
  result.erxToken = extractTag(xml, 'Token') ?? extractTag(xml, 'erx:Token') ?? extractTag(xml, 'erx:EScriptToken');
  result.tokenExpiry = extractTag(xml, 'TokenExpiry') ?? extractTag(xml, 'erx:TokenExpiry');

  return result;
}

// ── ERX005: Dispense Notification Parser (inbound from pharmacy) ────────────

export interface Erx005DispenseNotification {
  scriptNumber: string;
  prescriptionId?: string;
  dispensedDate: string;
  dispensedQuantity: number;
  dispensingPharmacyName?: string;
  dispensingPharmacistName?: string;
  pharmacyHpio?: string;
  repeatNumber?: number;
  patientFamilyName?: string;
  patientGivenName?: string;
}

/**
 * Parse an ERX005 dispense notification (received from eRx when pharmacy dispenses).
 * Used to update prescription status to 'dispensed' and record pharmacy details.
 */
export function parseErx005(xml: string): Erx005DispenseNotification | null {
  const msgType = extractTag(xml, 'MessageType') ?? extractTag(xml, 'erx:MessageType');
  if (msgType && msgType !== 'ERX005') return null;

  const scriptNumber = extractTag(xml, 'ScriptNumber') ?? extractTag(xml, 'erx:ScriptNumber');
  if (!scriptNumber) return null;

  return {
    scriptNumber,
    prescriptionId: extractTag(xml, 'PrescriptionId') ?? extractTag(xml, 'erx:PrescriptionId'),
    dispensedDate: extractTag(xml, 'DispensedDate') ?? extractTag(xml, 'erx:DispensedDate') ?? new Date().toISOString(),
    dispensedQuantity: parseInt(extractTag(xml, 'DispensedQuantity') ?? extractTag(xml, 'erx:DispensedQuantity') ?? '0', 10),
    dispensingPharmacyName: extractTag(xml, 'PharmacyName') ?? extractTag(xml, 'erx:PharmacyName'),
    dispensingPharmacistName: extractTag(xml, 'PharmacistName') ?? extractTag(xml, 'erx:PharmacistName'),
    pharmacyHpio: extractTag(xml, 'PharmacyHPIO') ?? extractTag(xml, 'erx:PharmacyHPIO'),
    repeatNumber: parseInt(extractTag(xml, 'RepeatNumber') ?? extractTag(xml, 'erx:RepeatNumber') ?? '0', 10) || undefined,
    patientFamilyName: extractTag(xml, 'FamilyName') ?? extractTag(xml, 'erx:FamilyName'),
    patientGivenName: extractTag(xml, 'GivenName') ?? extractTag(xml, 'erx:GivenName'),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${tagName}[^>]*>([^<]+)<\\/(?:\\w+:)?${tagName}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : undefined;
}
