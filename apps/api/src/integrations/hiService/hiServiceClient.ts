/**
 * HI Service (Healthcare Identifiers Service) Client
 *
 * Validates and retrieves healthcare identifiers:
 * - IHI (Individual Healthcare Identifier) — for patients
 * - HPII (Healthcare Provider Identifier - Individual) — for clinicians
 * - HPIO (Healthcare Provider Identifier - Organisation) — for the service
 *
 * Required for eRx, SafeScript, and MySL integrations.
 *
 * Apply for access: https://developer.digitalhealth.gov.au/products/hi-service
 *
 * Auth: Mutual TLS with NASH (National Authentication Service for Health) certificate.
 *
 * BUG-297 — pre-fix, fetch() was called WITHOUT an https.Agent, so the
 * NASH mTLS certificate was never attached to the SOAP request. The
 * TLS handshake would have failed in production even when the cert
 * was installed. Fix mirrors npdsClient.ts — module-scope `httpsAgent`
 * cache + `getHttpsAgent()` lazy loader + native `https.request()`
 * (Node's global fetch() does NOT support custom https agents on
 * Node 18-20, documented pre-existing limitation). NASH certs are
 * typically `.p12` (clinic IT staff receive them in PFX format);
 * `https.Agent({ pfx, passphrase })` handles both `.p12` and `.pfx`
 * natively without .pem conversion.
 */

import https from 'https';
import { URL } from 'url';
import { logger } from '../../utils/logger';
// Audit Tier 7.1 (CRIT-A1) ⚠ BREAKING — see shared/requireEnv.ts.
import { requireEnv, optionalEnv } from '../../shared/requireEnv';
// BUG-296 — SSoT validator for the HI-number family (IHI / HPI-I /
// HPI-O). Refactored from this file's inline validateIhiFormat so
// all three identifiers share one implementation.
import { validateHiNumber, HI_PREFIX } from '../../shared/hiNumbers';
// BUG-332 — shared NASH / mTLS agent factory. Prior to extraction this
// file and npdsClient.ts each had a near-identical getHttpsAgent that
// did certPath + passphrase + https.Agent + module-scope cache. The
// shared helper keys the cache by integrationName.
import { createMtlsAgent, resetMtlsAgentCacheForTests } from '../../shared/mtls';

export function isHiServiceConfigured(): boolean {
  return !!(optionalEnv('HI_SERVICE_URL') && optionalEnv('HI_SERVICE_CERT_PATH'));
}

// ── mTLS Agent (BUG-297 / BUG-332) ────────────────────────────────────────────
//
// BUG-332 extracted createMtlsAgent into shared/mtls.ts. The call below
// keeps the same semantics: lazy-load, stub-mode on missing cert, ERROR
// log in production to surface any boot-assertion escape. Cache lives
// inside the shared helper keyed by integrationName='HI Service'.

function getHttpsAgent(): https.Agent | undefined {
  return createMtlsAgent({
    certPathEnv: 'HI_SERVICE_CERT_PATH',
    passphraseEnv: 'HI_SERVICE_CERT_PASSPHRASE',
    integrationName: 'HI Service',
    passphraseDescription: 'HI Service NASH mTLS certificate',
  });
}

/**
 * Make an HTTPS request with NASH mTLS via Node's native https module.
 * Uses native https.request() rather than global fetch() because Node 18-20
 * fetch() does NOT support custom https agents — the documented pre-existing
 * limitation that npdsClient.ts also works around.
 */
function mtlsRequest(
  path: string,
  soapAction: string,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const HI_SERVICE_URL = requireEnv('HI_SERVICE_URL', 'HI Service SOAP endpoint');
    const url = new URL(path, HI_SERVICE_URL);
    const agent = getHttpsAgent();
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': soapAction,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks).toString() });
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('HI Service request timed out')); });
    req.write(body);
    req.end();
  });
}

// ── IHI Types ─────────────────────────────────────────────────────────────────

export interface IhiSearchParams {
  familyName: string;
  givenName: string;
  dateOfBirth: string;       // YYYY-MM-DD
  gender: 'M' | 'F' | 'I' | 'N';
  medicareNumber?: string;
  medicareIrn?: string;
  dvaNumber?: string;
  mobile?: string;
  email?: string;
}

export interface IhiResult {
  found: boolean;
  ihi?: string;              // 16-digit IHI number
  ihiStatus?: 'active' | 'deceased' | 'retired' | 'expired' | 'resolved';
  ihiRecordStatus?: 'verified' | 'unverified' | 'provisional';
  displayName?: string;
  familyName?: string;
  givenName?: string;
  error?: string;
}

export interface IhiDetailsUpdateParams {
  ihi: string;
  familyName: string;
  givenName: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | 'I' | 'N';
  medicareNumber?: string;
  medicareIrn?: string;
  mobile?: string;
  email?: string;
}

export interface IhiDetailsUpdateResult {
  success: boolean;
  requestRef?: string;
  statusCode?: number;
  error?: string;
}

export interface NewbornIhiCreateParams {
  newbornFamilyName: string;
  newbornGivenName: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | 'I' | 'N';
  motherIhi: string;
  motherMedicareNumber?: string;
  motherMedicareIrn?: string;
}

export interface NewbornIhiCreateResult {
  success: boolean;
  ihi?: string;
  ihiStatus?: IhiResult['ihiStatus'];
  ihiRecordStatus?: IhiResult['ihiRecordStatus'];
  requestRef?: string;
  statusCode?: number;
  error?: string;
}

export interface HpiiResult {
  found: boolean;
  hpii?: string;             // 16-digit HPII number
  name?: string;
  qualification?: string;
  error?: string;
}

export interface HpioResult {
  found: boolean;
  hpio?: string;             // 16-digit HPI-O number
  name?: string;
  organisationType?: string;
  error?: string;
}

// ── IHI Validation ────────────────────────────────────────────────────────────

/**
 * Validate an IHI number format (16 digits, 800360 prefix, Luhn).
 * BUG-296 — delegates to the shared validateHiNumber helper so IHI /
 * HPI-I / HPI-O share one implementation.
 */
export function validateIhiFormat(ihi: string): boolean {
  return validateHiNumber(ihi, HI_PREFIX.IHI);
}

/**
 * Validate an HPI-I (Healthcare Provider Identifier - Individual)
 * format: 16 digits, 800361 prefix, Luhn check. BUG-296 — new
 * export so medicationService / prescriptionService gate on HPI-I
 * validity before submitting to eRx.
 */
export function validateHpiiFormat(hpii: string): boolean {
  return validateHiNumber(hpii, HI_PREFIX.HPI_I);
}

/**
 * Validate an HPI-O (Healthcare Provider Identifier - Organisation)
 * format: 16 digits, 800362 prefix, Luhn check. Paired with BUG-295's
 * DB CHECK constraint on clinics.hpio (format-only; Luhn at app layer).
 */
export function validateHpioFormat(hpio: string): boolean {
  return validateHiNumber(hpio, HI_PREFIX.HPI_O);
}

/**
 * Search for a patient's IHI using demographics.
 *
 * When HI Service is configured, performs a real SOAP request over
 * NASH mTLS. When not configured, performs format validation only.
 */
export async function searchIhi(params: IhiSearchParams): Promise<IhiResult> {
  const hasMedicare = !!params.medicareNumber || !!params.medicareIrn;
  const hasDva = !!params.dvaNumber;
  const hasMobile = !!params.mobile;
  const hasEmail = !!params.email;

  if (hasMedicare) {
    if (!params.medicareNumber || !/^\d{10,11}$/.test(params.medicareNumber)) {
      return { found: false, error: 'Medicare number must be 10-11 digits' };
    }
    if (!params.medicareIrn || !/^[1-9]$/.test(params.medicareIrn)) {
      return { found: false, error: 'Medicare IRN must be a single digit 1-9' };
    }
  }

  if (!hasMedicare && !hasDva && !hasMobile && !hasEmail) {
    return {
      found: false,
      error: 'Provide at least one HI identity path: Medicare+IRN, DVA number, mobile, or email.',
    };
  }

  if (!isHiServiceConfigured()) {
    logger.info('[HI Service] Not configured — performing offline validation only');
    return { found: false, error: 'HI Service not configured. Set HI_SERVICE_URL and HI_SERVICE_CERT_PATH.' };
  }

  try {
    const soapEnvelope = buildSearchIhiSoap(params);
    const res = await mtlsRequest(
      '/HI/ConsumerSearchIHI',
      'http://ns.electronichealth.net.au/hi/svc/ConsumerSearchIHIPortType/SearchIHI',
      soapEnvelope,
    );

    if (res.status < 200 || res.status >= 300) {
      return { found: false, error: `HI Service ${res.status}` };
    }

    return parseSearchIhiResponse(res.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[HI Service] IHI search failed');
    return { found: false, error: msg };
  }
}

/**
 * Validate a known IHI is still active.
 */
export async function verifyIhi(ihi: string): Promise<IhiResult> {
  if (!validateIhiFormat(ihi)) {
    return { found: false, error: 'Invalid IHI format. Must be 16 digits starting with 800360.' };
  }

  if (!isHiServiceConfigured()) {
    // Offline: format is valid, but can't verify status
    return { found: true, ihi, ihiStatus: 'active', ihiRecordStatus: 'unverified', error: 'HI Service not configured — format valid but status unverified.' };
  }

  try {
    const soapEnvelope = buildVerifyIhiSoap(ihi);
    const res = await mtlsRequest(
      '/HI/ConsumerSearchIHI',
      'http://ns.electronichealth.net.au/hi/svc/ConsumerSearchIHIPortType/SearchIHI',
      soapEnvelope,
    );

    if (res.status < 200 || res.status >= 300) return { found: false, error: `HI Service ${res.status}` };
    return parseSearchIhiResponse(res.body);
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * BUG-N1 — UC.016 patient-details write-back contract
 * (TECH.SIS.HI.05). This path updates patient demographics linked to a
 * known IHI in the HI Service.
 */
export async function updateIhiPatientDetails(
  params: IhiDetailsUpdateParams,
): Promise<IhiDetailsUpdateResult> {
  if (!validateIhiFormat(params.ihi)) {
    return { success: false, error: 'Invalid IHI format. Must be 16 digits starting with 800360.' };
  }
  const hasMedicare = !!params.medicareNumber || !!params.medicareIrn;
  if (hasMedicare) {
    if (!params.medicareNumber || !/^\d{10,11}$/.test(params.medicareNumber)) {
      return { success: false, error: 'Medicare number must be 10-11 digits' };
    }
    if (!params.medicareIrn || !/^[1-9]$/.test(params.medicareIrn)) {
      return { success: false, error: 'Medicare IRN must be a single digit 1-9' };
    }
  }

  if (!isHiServiceConfigured()) {
    return { success: false, error: 'HI Service not configured. Set HI_SERVICE_URL and HI_SERVICE_CERT_PATH.' };
  }

  try {
    const soapEnvelope = buildUpdateIhiDetailsSoap(params);
    const path = optionalEnv('HI_SERVICE_UPDATE_PATH') || '/HI/ConsumerUpdateIHI';
    const soapAction =
      optionalEnv('HI_SERVICE_UPDATE_SOAP_ACTION')
      || 'http://ns.electronichealth.net.au/hi/svc/ConsumerUpdateIHIPortType/UpdateIHI';
    const res = await mtlsRequest(path, soapAction, soapEnvelope);
    if (res.status < 200 || res.status >= 300) {
      return { success: false, statusCode: res.status, error: `HI Service ${res.status}` };
    }
    return parseUpdateIhiDetailsResponse(res.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[HI Service] patient-details write-back failed');
    return { success: false, error: msg };
  }
}

/**
 * BUG-N5 — UC.011 Create Verified IHI for Newborns.
 *
 * Feature-flagged fail-closed posture:
 * - Default (`ENABLE_HI_NEWBORN_CREATE !== 'true'`): explicit blocked
 *   result so production cannot silently claim newborn HI creation.
 * - Enabled: SOAP request path is executed against operator-supplied
 *   endpoint/action envs.
 */
export async function createVerifiedNewbornIhi(
  params: NewbornIhiCreateParams,
): Promise<NewbornIhiCreateResult> {
  if (optionalEnv('ENABLE_HI_NEWBORN_CREATE') !== 'true') {
    return {
      success: false,
      error: 'Newborn IHI creation is blocked until maternity workflow spike is approved (BUG-N5).',
      statusCode: 501,
    };
  }
  if (!validateIhiFormat(params.motherIhi)) {
    return { success: false, error: 'Invalid mother IHI format.', statusCode: 422 };
  }
  const hasMedicare = !!params.motherMedicareNumber || !!params.motherMedicareIrn;
  if (hasMedicare) {
    if (!params.motherMedicareNumber || !/^\d{10,11}$/.test(params.motherMedicareNumber)) {
      return { success: false, error: 'Mother Medicare number must be 10-11 digits.', statusCode: 422 };
    }
    if (!params.motherMedicareIrn || !/^[1-9]$/.test(params.motherMedicareIrn)) {
      return { success: false, error: 'Mother Medicare IRN must be a single digit 1-9.', statusCode: 422 };
    }
  }
  if (!isHiServiceConfigured()) {
    return {
      success: false,
      error: 'HI Service not configured. Set HI_SERVICE_URL and HI_SERVICE_CERT_PATH.',
      statusCode: 503,
    };
  }

  try {
    const soapEnvelope = buildCreateNewbornIhiSoap(params);
    const path = optionalEnv('HI_SERVICE_NEWBORN_PATH') || '/HI/CreateVerifiedIHIForNewborn';
    const soapAction =
      optionalEnv('HI_SERVICE_NEWBORN_SOAP_ACTION')
      || 'http://ns.electronichealth.net.au/hi/svc/ConsumerCreateIHIPortType/CreateVerifiedIHIForNewborn';
    const res = await mtlsRequest(path, soapAction, soapEnvelope);
    if (res.status < 200 || res.status >= 300) {
      return { success: false, statusCode: res.status, error: `HI Service ${res.status}` };
    }
    return parseCreateNewbornIhiResponse(res.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[HI Service] newborn IHI create failed');
    return { success: false, error: msg };
  }
}

/**
 * Verify a clinician's HPI-I is live in the HI Service directory. BUG-336
 * consumer — used by the Staff admin page to live-validate HPI-I before
 * the admin saves the column. Offline/stub behaviour mirrors verifyIhi:
 * when NASH mTLS is not configured, format+Luhn passes return
 * { found: true, ... error: '…unverified' } so the admin UI can proceed
 * with a warning banner. When configured, performs the SearchHPI SOAP
 * call and parses the response.
 */
export async function verifyHpii(hpii: string): Promise<HpiiResult> {
  if (!validateHpiiFormat(hpii)) {
    return { found: false, error: 'Invalid HPI-I format. Must be 16 digits starting with 800361.' };
  }

  if (!isHiServiceConfigured()) {
    return { found: true, hpii, error: 'HI Service not configured — format valid but status unverified.' };
  }

  try {
    const soapEnvelope = buildVerifyHpiiSoap(hpii);
    const res = await mtlsRequest(
      '/HI/ProviderSearchHPI',
      'http://ns.electronichealth.net.au/hi/svc/ProviderSearchHPIPortType/SearchHPI',
      soapEnvelope,
    );
    if (res.status < 200 || res.status >= 300) return { found: false, error: `HI Service ${res.status}` };
    return parseVerifyHpiiResponse(res.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[HI Service] HPI-I verify failed');
    return { found: false, error: msg };
  }
}

/**
 * Verify an organisation's HPI-O is live in the HI Service directory.
 * BUG-339 consumer — used by the Clinic settings admin page. Same
 * offline/stub shape as verifyHpii.
 */
export async function verifyHpio(hpio: string): Promise<HpioResult> {
  if (!validateHpioFormat(hpio)) {
    return { found: false, error: 'Invalid HPI-O format. Must be 16 digits starting with 800362.' };
  }

  if (!isHiServiceConfigured()) {
    return { found: true, hpio, error: 'HI Service not configured — format valid but status unverified.' };
  }

  try {
    const soapEnvelope = buildVerifyHpioSoap(hpio);
    const res = await mtlsRequest(
      '/HI/OrganisationSearchHPI',
      'http://ns.electronichealth.net.au/hi/svc/OrganisationSearchHPIPortType/SearchHPI',
      soapEnvelope,
    );
    if (res.status < 200 || res.status >= 300) return { found: false, error: `HI Service ${res.status}` };
    return parseVerifyHpioResponse(res.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[HI Service] HPI-O verify failed');
    return { found: false, error: msg };
  }
}

// ── SOAP Builders ─────────────────────────────────────────────────────────────

function buildSearchIhiSoap(params: IhiSearchParams): string {
  const medicareBlock = params.medicareNumber && params.medicareIrn
    ? `
        <searchIHI>
          <medicareCardNumber>${escapeXml(params.medicareNumber)}</medicareCardNumber>
          <medicareIRN>${escapeXml(params.medicareIrn)}</medicareIRN>
        </searchIHI>`
    : '';
  const dvaBlock = params.dvaNumber
    ? `<dvaNumber>${escapeXml(params.dvaNumber)}</dvaNumber>`
    : '';
  const contactBlock = params.mobile || params.email
    ? `
        <contactDetails>
          ${params.mobile ? `<mobileNumber>${escapeXml(params.mobile)}</mobileNumber>` : ''}
          ${params.email ? `<emailAddress>${escapeXml(params.email)}</emailAddress>` : ''}
        </contactDetails>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:ns="http://ns.electronichealth.net.au/hi/xsd/consumermessages/SearchIHI/5.0"
  xmlns:ns1="http://ns.electronichealth.net.au/hi/xsd/common/CommonCoreElements/3.0">
  <soap:Body>
    <ns:searchIHI>
      <ns:searchIHI>
        <ns1:familyName>${escapeXml(params.familyName)}</ns1:familyName>
        <ns1:givenName>${escapeXml(params.givenName)}</ns1:givenName>
        <ns1:dateOfBirth>${params.dateOfBirth}</ns1:dateOfBirth>
        <ns1:sex>${params.gender}</ns1:sex>
        ${medicareBlock}
        ${dvaBlock}
        ${contactBlock}
      </ns:searchIHI>
    </ns:searchIHI>
  </soap:Body>
</soap:Envelope>`;
}

function buildVerifyIhiSoap(ihi: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:ns="http://ns.electronichealth.net.au/hi/xsd/consumermessages/SearchIHI/5.0">
  <soap:Body>
    <ns:searchIHI>
      <ns:searchIHI>
        <ihiNumber>${escapeXml(ihi)}</ihiNumber>
      </ns:searchIHI>
    </ns:searchIHI>
  </soap:Body>
</soap:Envelope>`;
}

function buildVerifyHpiiSoap(hpii: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:ns="http://ns.electronichealth.net.au/hi/xsd/providermessages/SearchHPI/5.0">
  <soap:Body>
    <ns:searchHPI>
      <ns:searchHPI>
        <hpiiNumber>${escapeXml(hpii)}</hpiiNumber>
      </ns:searchHPI>
    </ns:searchHPI>
  </soap:Body>
</soap:Envelope>`;
}

function buildVerifyHpioSoap(hpio: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:ns="http://ns.electronichealth.net.au/hi/xsd/organisationmessages/SearchHPI/5.0">
  <soap:Body>
    <ns:searchHPI>
      <ns:searchHPI>
        <hpioNumber>${escapeXml(hpio)}</hpioNumber>
      </ns:searchHPI>
    </ns:searchHPI>
  </soap:Body>
</soap:Envelope>`;
}

function buildUpdateIhiDetailsSoap(params: IhiDetailsUpdateParams): string {
  const medicareBlock = params.medicareNumber && params.medicareIrn
    ? `
        <ns:medicare>
          <ns:medicareCardNumber>${escapeXml(params.medicareNumber)}</ns:medicareCardNumber>
          <ns:medicareIRN>${escapeXml(params.medicareIrn)}</ns:medicareIRN>
        </ns:medicare>`
    : '';
  const contactBlock = params.mobile || params.email
    ? `
        <ns:contactDetails>
          ${params.mobile ? `<ns:mobileNumber>${escapeXml(params.mobile)}</ns:mobileNumber>` : ''}
          ${params.email ? `<ns:emailAddress>${escapeXml(params.email)}</ns:emailAddress>` : ''}
        </ns:contactDetails>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:ns="http://ns.electronichealth.net.au/hi/xsd/consumermessages/UpdateIHI/5.0"
  xmlns:ns1="http://ns.electronichealth.net.au/hi/xsd/common/CommonCoreElements/3.0">
  <soap:Body>
    <ns:updateIHI>
      <ns:updateIHI>
        <ns:ihiNumber>${escapeXml(params.ihi)}</ns:ihiNumber>
        <ns1:familyName>${escapeXml(params.familyName)}</ns1:familyName>
        <ns1:givenName>${escapeXml(params.givenName)}</ns1:givenName>
        <ns1:dateOfBirth>${params.dateOfBirth}</ns1:dateOfBirth>
        <ns1:sex>${params.gender}</ns1:sex>
        ${medicareBlock}
        ${contactBlock}
      </ns:updateIHI>
    </ns:updateIHI>
  </soap:Body>
</soap:Envelope>`;
}

function buildCreateNewbornIhiSoap(params: NewbornIhiCreateParams): string {
  const medicareBlock = params.motherMedicareNumber && params.motherMedicareIrn
    ? `
        <ns:motherMedicare>
          <ns:medicareCardNumber>${escapeXml(params.motherMedicareNumber)}</ns:medicareCardNumber>
          <ns:medicareIRN>${escapeXml(params.motherMedicareIrn)}</ns:medicareIRN>
        </ns:motherMedicare>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:ns="http://ns.electronichealth.net.au/hi/xsd/consumermessages/CreateVerifiedIHIForNewborn/5.0"
  xmlns:ns1="http://ns.electronichealth.net.au/hi/xsd/common/CommonCoreElements/3.0">
  <soap:Body>
    <ns:createVerifiedIHIForNewborn>
      <ns:createVerifiedIHIForNewborn>
        <ns:motherIHI>${escapeXml(params.motherIhi)}</ns:motherIHI>
        ${medicareBlock}
        <ns1:familyName>${escapeXml(params.newbornFamilyName)}</ns1:familyName>
        <ns1:givenName>${escapeXml(params.newbornGivenName)}</ns1:givenName>
        <ns1:dateOfBirth>${params.dateOfBirth}</ns1:dateOfBirth>
        <ns1:sex>${params.gender}</ns1:sex>
      </ns:createVerifiedIHIForNewborn>
    </ns:createVerifiedIHIForNewborn>
  </soap:Body>
</soap:Envelope>`;
}

// ── SOAP Response Parser ──────────────────────────────────────────────────────

function parseSearchIhiResponse(xml: string): IhiResult {
  // Extract IHI number from SOAP response
  const ihiMatch = xml.match(/<ihiNumber>(800360\d{10})<\/ihiNumber>/);
  const statusMatch = xml.match(/<ihiStatus>(\w+)<\/ihiStatus>/);
  const recordStatusMatch = xml.match(/<ihiRecordStatus>(\w+)<\/ihiRecordStatus>/);
  const displayNameMatch = xml.match(/<displayName>([^<]+)<\/displayName>/);
  const familyNameMatch = xml.match(/<familyName>([^<]+)<\/familyName>/);
  const givenNameMatch = xml.match(/<givenName>([^<]+)<\/givenName>/);

  if (!ihiMatch) {
    // Check for SOAP fault
    const faultMatch = xml.match(/<faultstring>([^<]+)<\/faultstring>/);
    return { found: false, error: faultMatch ? faultMatch[1] : 'IHI not found in response' };
  }

  return {
    found: true,
    ihi: ihiMatch[1],
    ihiStatus: (statusMatch?.[1]?.toLowerCase() as IhiResult['ihiStatus']) ?? 'active',
    ihiRecordStatus: (recordStatusMatch?.[1]?.toLowerCase() as IhiResult['ihiRecordStatus']) ?? 'unverified',
    displayName: displayNameMatch?.[1],
    familyName: familyNameMatch?.[1],
    givenName: givenNameMatch?.[1],
  };
}

function parseVerifyHpiiResponse(xml: string): HpiiResult {
  const hpiiMatch = xml.match(/<hpiiNumber>(800361\d{10})<\/hpiiNumber>/);
  const nameMatch = xml.match(/<displayName>([^<]+)<\/displayName>/);
  const qualificationMatch = xml.match(/<qualification>([^<]+)<\/qualification>/);

  if (!hpiiMatch) {
    const faultMatch = xml.match(/<faultstring>([^<]+)<\/faultstring>/);
    return { found: false, error: faultMatch ? faultMatch[1] : 'HPI-I not found in response' };
  }

  return {
    found: true,
    hpii: hpiiMatch[1],
    name: nameMatch?.[1],
    qualification: qualificationMatch?.[1],
  };
}

function parseVerifyHpioResponse(xml: string): HpioResult {
  const hpioMatch = xml.match(/<hpioNumber>(800362\d{10})<\/hpioNumber>/);
  const nameMatch = xml.match(/<organisationName>([^<]+)<\/organisationName>/);
  const typeMatch = xml.match(/<organisationType>([^<]+)<\/organisationType>/);

  if (!hpioMatch) {
    const faultMatch = xml.match(/<faultstring>([^<]+)<\/faultstring>/);
    return { found: false, error: faultMatch ? faultMatch[1] : 'HPI-O not found in response' };
  }

  return {
    found: true,
    hpio: hpioMatch[1],
    name: nameMatch?.[1],
    organisationType: typeMatch?.[1],
  };
}

function parseUpdateIhiDetailsResponse(xml: string): IhiDetailsUpdateResult {
  const faultMatch = xml.match(/<faultstring>([^<]+)<\/faultstring>/i);
  if (faultMatch) {
    return { success: false, error: faultMatch[1] };
  }
  const requestRef =
    xml.match(/<(?:\w+:)?requestRef>([^<]+)<\/(?:\w+:)?requestRef>/i)?.[1]
    ?? xml.match(/<(?:\w+:)?transactionId>([^<]+)<\/(?:\w+:)?transactionId>/i)?.[1];
  const status =
    xml.match(/<(?:\w+:)?status>([^<]+)<\/(?:\w+:)?status>/i)?.[1]
    ?? xml.match(/<(?:\w+:)?resultCode>([^<]+)<\/(?:\w+:)?resultCode>/i)?.[1];
  if (status && !/^(success|ok|accepted|completed)$/i.test(status.trim())) {
    return { success: false, requestRef, error: `HI update rejected: ${status}` };
  }
  return { success: true, requestRef };
}

function parseCreateNewbornIhiResponse(xml: string): NewbornIhiCreateResult {
  const faultMatch = xml.match(/<faultstring>([^<]+)<\/faultstring>/i);
  if (faultMatch) {
    return { success: false, error: faultMatch[1] };
  }
  const parsed = parseSearchIhiResponse(xml);
  if (!parsed.found || !parsed.ihi) {
    return { success: false, error: parsed.error ?? 'IHI not found in newborn response' };
  }
  const requestRef =
    xml.match(/<(?:\w+:)?requestRef>([^<]+)<\/(?:\w+:)?requestRef>/i)?.[1]
    ?? xml.match(/<(?:\w+:)?transactionId>([^<]+)<\/(?:\w+:)?transactionId>/i)?.[1];
  return {
    success: true,
    ihi: parsed.ihi,
    ihiStatus: parsed.ihiStatus,
    ihiRecordStatus: parsed.ihiRecordStatus,
    requestRef,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// BUG-296 — luhnCheck moved to shared/hiNumbers.ts as the SSoT for
// all HI-number family checks. Import from there when needed.

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Test hooks ────────────────────────────────────────────────────────────────

/**
 * Test-only: reset the HI Service agent cache slice so tests that
 * install / remove the cert between runs observe fresh agent state.
 * Production callers never invoke this. Delegates to the shared
 * helper's cache (BUG-332) scoped to this integration name only.
 */
export function __resetHttpsAgentForTests(): void {
  resetMtlsAgentCacheForTests('HI Service');
}
