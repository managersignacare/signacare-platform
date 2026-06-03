/**
 * eRx Enterprise Adapter HTTPS Client
 *
 * Communicates with the eRx Enterprise Adapter via HTTPS + site certificate.
 *
 * The Enterprise Adapter is a cloud-hosted single point of contact between
 * the vendor's application and the eRx Script Exchange Gateway.
 * Only one site certificate is needed for all sites (vs Standard Adapter
 * which requires one cert per site).
 *
 * Architecture:
 *   Signacare EMR → [HTTPS/SOAP] → eRx Enterprise Adapter → [encrypted] → eRx Gateway
 *
 * Environment Variables:
 *   ERX_ADAPTER_URL       — Base URL of the Enterprise Adapter
 *   ERX_SITE_CERT_PATH    — Path to the site certificate (.pfx / .p12)
 *   ERX_SITE_CERT_PASS    — Certificate passphrase
 *   ERX_SITE_ID           — eRx-assigned site identifier
 *
 * Reference: eRx Adapter Integration Design V 1.6
 */

import https from 'https';
import { logger } from '../../utils/logger';
// Audit Tier 7.1 (CRIT-A1) ⚠ BREAKING — see shared/requireEnv.ts.
import { requireEnv, optionalEnv } from '../../shared/requireEnv';
import { createMtlsAgent } from '../../shared/mtls';

export function isErxAdapterConfigured(): boolean {
  return !!(optionalEnv('ERX_ADAPTER_URL') && optionalEnv('ERX_SITE_CERT_PATH'));
}

export function getErxSiteId(): string {
  return optionalEnv('ERX_SITE_ID') ?? '';
}

function getAgent(): https.Agent | undefined {
  return createMtlsAgent({
    certPathEnv: 'ERX_SITE_CERT_PATH',
    passphraseEnv: 'ERX_SITE_CERT_PASS',
    integrationName: 'eRx Adapter',
    passphraseDescription: 'eRx Adapter mTLS certificate',
  });
}

/**
 * Send a SOAP request to the eRx Enterprise Adapter.
 * Returns the raw XML response body.
 */
export async function sendToAdapter(
  soapAction: string,
  soapXml: string,
): Promise<{ status: number; body: string }> {
  if (!isErxAdapterConfigured()) {
    throw new Error('eRx Adapter not configured. Set ERX_ADAPTER_URL and ERX_SITE_CERT_PATH.');
  }

  // Tier 7.1 — fetch the adapter URL via requireEnv at call time so
  // runtime env unsets raise ENV_MISSING with a structured remediation.
  const ERX_ADAPTER_URL = requireEnv('ERX_ADAPTER_URL', 'eRx Adapter SOAP endpoint');
  return new Promise((resolve, reject) => {
    const url = new URL(ERX_ADAPTER_URL);
    const agent = getAgent();

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': soapAction,
        'Content-Length': Buffer.byteLength(soapXml, 'utf-8'),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        logger.info({ status: res.statusCode, soapAction, bodyLen: body.length }, '[eRx Adapter] Response received');
        resolve({ status: res.statusCode ?? 500, body });
      });
    });

    req.on('error', (err) => {
      logger.error({ err: err.message, soapAction }, '[eRx Adapter] Request failed');
      reject(err);
    });

    req.setTimeout(30_000, () => {
      req.destroy(new Error('eRx Adapter request timed out (30s)'));
    });

    req.write(soapXml);
    req.end();
  });
}

/**
 * Upload a prescription to eRx Gateway via the Enterprise Adapter (ERX001).
 */
export async function uploadPrescription(soapXml: string): Promise<{ status: number; body: string }> {
  return sendToAdapter(
    'http://ns.electronichealth.net.au/erx/adapter/UploadPrescription',
    soapXml,
  );
}

/**
 * Download a dispense notification from eRx Gateway (ERX004/ERX005).
 * Called periodically or via webhook to check for dispensed prescriptions.
 */
export async function downloadDispenseNotifications(): Promise<{ status: number; body: string }> {
  if (!isErxAdapterConfigured()) {
    throw new Error('eRx Adapter not configured.');
  }

  const requestXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:erx="http://ns.electronichealth.net.au/erx/prescription/1.0">
  <soap:Header>
    <erx:MessageHeader>
      <erx:MessageType>ERX003</erx:MessageType>
      <erx:Timestamp>${new Date().toISOString()}</erx:Timestamp>
      <erx:SiteId>${escapeXml(getErxSiteId())}</erx:SiteId>
    </erx:MessageHeader>
  </soap:Header>
  <soap:Body>
    <erx:DownloadDispenseNotifications />
  </soap:Body>
</soap:Envelope>`;

  return sendToAdapter(
    'http://ns.electronichealth.net.au/erx/adapter/DownloadDispenseNotifications',
    requestXml,
  );
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
