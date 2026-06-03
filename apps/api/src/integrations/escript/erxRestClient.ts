/**
 * eRx REST API Client (v1.6 — Nov 2025)
 *
 * Communicates with the eRx Script Exchange REST API at
 * https://integration-api.erx.com.au/ for electronic prescribing.
 *
 * Authentication: Basic auth (EntityId:) + mutual TLS client certificate.
 * Content type: application/xml throughout.
 *
 * Reference: "eRx REST API — Implementation Guide 2025-11 v1.6"
 */

import https from 'https';
import fs from 'fs';
import { randomBytes } from 'crypto';
import logger from '../../utils/logger';

// ── Configuration ────────────────────────────────────────────────────────────

const ERX_REST_BASE_URL = process.env['ERX_REST_BASE_URL'] ?? 'https://integration-api.erx.com.au';
const ERX_REST_ENTITY_ID = process.env['ERX_REST_ENTITY_ID'] ?? '';
const ERX_REST_CERT_PATH = process.env['ERX_REST_CERT_PATH'] ?? '';
const ERX_REST_CERT_PASS = process.env['ERX_REST_CERT_PASS'] ?? '';
const ERX_REST_CONFORMANCE_ID = process.env['ERX_REST_CONFORMANCE_ID'] ?? '';
const ERX_REST_API_VERSION = process.env['ERX_REST_API_VERSION'] ?? '2024-03';
const APP_VERSION = '1.0.0';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ErxRestResponse {
  status: number;
  body: string;
  success: boolean;
  entityId?: string;
  errorCode?: string;
  errorDescription?: string;
}

// ── HTTPS Agent (mutual TLS, cached) ─────────────────────────────────────────

let cachedAgent: https.Agent | null = null;

function getAgent(): https.Agent | null {
  if (cachedAgent) return cachedAgent;
  if (!ERX_REST_CERT_PATH) return null;
  try {
    const pfx = fs.readFileSync(ERX_REST_CERT_PATH);
    cachedAgent = new https.Agent({
      pfx,
      passphrase: ERX_REST_CERT_PASS,
      rejectUnauthorized: true,
    });
    return cachedAgent;
  } catch (err) {
    logger.error({ err }, '[eRxREST] Failed to load client certificate');
    return null;
  }
}

// ── Core request helper ──────────────────────────────────────────────────────

function buildAuthHeader(): string {
  // Basic auth: base64(EntityId:) — note the trailing colon, no password
  return 'Basic ' + Buffer.from(`${ERX_REST_ENTITY_ID}:`).toString('base64');
}

function buildUserAgent(): string {
  if (ERX_REST_CONFORMANCE_ID) {
    return `${ERX_REST_CONFORMANCE_ID}/${APP_VERSION}`;
  }
  return APP_VERSION;
}

async function request(
  method: 'GET' | 'POST',
  path: string,
  body?: string,
): Promise<ErxRestResponse> {
  // BUG-043 — env vars were declared with `?? ''` at module load, so
  // isConfigured() correctly detects unset vars but a partial config
  // (entity id empty + cert path set, or vice versa) could produce an
  // empty Basic auth header. Belt-and-suspenders: assert non-empty
  // before any request. Boot assertion should prevent reaching here
  // in misconfigured production.
  if (!ERX_REST_ENTITY_ID) {
    return { status: 0, body: '', success: false, errorDescription: 'ERX_REST_ENTITY_ID not configured' };
  }
  const agent = getAgent();
  if (!agent) {
    return { status: 0, body: '', success: false, errorDescription: 'Client certificate not configured' };
  }

  const url = new URL(path, ERX_REST_BASE_URL);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        agent,
        headers: {
          'Accept': `application/xml;v=${ERX_REST_API_VERSION}`,
          'Authorization': buildAuthHeader(),
          'User-Agent': buildUserAgent(),
          ...(body ? { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;
          const success = status >= 200 && status < 300;

          // Parse error from XML if present
          let errorCode: string | undefined;
          let errorDescription: string | undefined;
          let entityId: string | undefined;
          if (responseBody.includes('<Error')) {
            errorCode = responseBody.match(/<Code>([^<]+)<\/Code>/)?.[1];
            errorDescription = responseBody.match(/<Description>([^<]+)<\/Description>/)?.[1];
          }
          if (responseBody.includes('<EntityId')) {
            entityId = responseBody.match(/<EntityId>([^<]+)<\/EntityId>/)?.[1];
          }

          resolve({ status, body: responseBody, success, entityId, errorCode, errorDescription });
        });
      },
    );

    req.on('error', (err) => {
      logger.error({ err }, '[eRxREST] Request failed');
      resolve({ status: 0, body: '', success: false, errorDescription: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: '', success: false, errorDescription: 'Request timed out' });
    });

    if (body) req.write(body);
    req.end();
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  return !!(ERX_REST_ENTITY_ID && ERX_REST_CERT_PATH);
}

export async function healthCheck(): Promise<boolean> {
  try {
    // Health endpoint is public — no cert required, but we test with it anyway
    const res = await request('GET', '/health');
    return res.status === 200;
  } catch { return false; }
}

/**
 * Create an e-prescription (ERX001 operation).
 * POST /eprescriptions/{SCID}/$erx001
 */
export async function createPrescription(scid: string, xmlPayload: string): Promise<ErxRestResponse> {
  logger.info({ scid }, '[eRxREST] Submitting prescription ERX001');
  return request('POST', `/eprescriptions/${scid}/$erx001`, xmlPayload);
}

/**
 * View an e-prescription (ERX049 operation).
 * GET /eprescriptions/{SCID}/$erx049
 */
export async function viewPrescription(scid: string): Promise<ErxRestResponse> {
  return request('GET', `/eprescriptions/${scid}/$erx049`);
}

/**
 * Cancel a prescription (ERX023 operation).
 * POST /eprescriptions/{SCID}/$erx023
 */
export async function cancelPrescription(scid: string, xmlPayload: string): Promise<ErxRestResponse> {
  return request('POST', `/eprescriptions/${scid}/$erx023`, xmlPayload);
}

/**
 * Amend a prescription (ERX027 operation — prescriber amend).
 * Requires prior checkout via ERX025.
 * POST /eprescriptions/{SCID}/$erx027
 */
export async function amendPrescription(scid: string, xmlPayload: string): Promise<ErxRestResponse> {
  logger.info({ scid }, '[eRxREST] Amending prescription ERX027');
  return request('POST', `/eprescriptions/${scid}/$erx027`, xmlPayload);
}

/**
 * Checkout a prescription for prescriber amendment (ERX025 operation).
 * Locks the script so it can be amended via ERX027.
 * POST /eprescriptions/{SCID}/$erx025
 */
export async function checkoutForAmend(scid: string, xmlPayload: string): Promise<ErxRestResponse> {
  logger.info({ scid }, '[eRxREST] Checkout for amend ERX025');
  return request('POST', `/eprescriptions/${scid}/$erx025`, xmlPayload);
}

/**
 * Reactivate a cancelled prescription (ERX019 operation).
 * POST /eprescriptions/{SCID}/$erx019
 */
export async function reactivatePrescription(scid: string, xmlPayload: string): Promise<ErxRestResponse> {
  logger.info({ scid }, '[eRxREST] Reactivating prescription ERX019');
  return request('POST', `/eprescriptions/${scid}/$erx019`, xmlPayload);
}

/**
 * Cease the latest supply of a prescription (ERX061 operation).
 * POST /eprescriptions/{SCID}/$erx061
 */
export async function ceasePrescription(scid: string, xmlPayload: string): Promise<ErxRestResponse> {
  logger.info({ scid }, '[eRxREST] Ceasing prescription ERX061');
  return request('POST', `/eprescriptions/${scid}/$erx061`, xmlPayload);
}

/**
 * Reissue a token for a prescription (ERX065 operation — prescriber side).
 * Sends a new SMS/email with the eScript token.
 * POST /eprescriptions/{SCID}/$erx065
 */
export async function reissueToken(scid: string, xmlPayload: string): Promise<ErxRestResponse> {
  logger.info({ scid }, '[eRxREST] Reissuing token ERX065');
  return request('POST', `/eprescriptions/${scid}/$erx065`, xmlPayload);
}

/**
 * Register a service provider with eRx.
 * POST /serviceproviders
 */
export async function registerServiceProvider(xmlPayload: string): Promise<ErxRestResponse> {
  return request('POST', '/serviceproviders', xmlPayload);
}

// ── SCID Generation (§4.1) ──────────────────────────────────────────────────
//
// SCID = {HealthIdentityCode}{EntityId}{Random}{CheckDigit}
// - HealthIdentityCode: 1 char ("2" for prescribers, "1" for dispensers, "3" for medication charts)
// - EntityId: 5 chars (the eRx Entity ID)
// - Random: 11 chars from BCDFGHJKMNPQRTVWXY1234567890 (no vowels)
// - CheckDigit: 1 char (mod 11 weighted sum)
// Total: 18 chars. Must match /^[123][A-Z0-9]{17}$/

const SCID_CHARSET = 'BCDFGHJKMNPQRTVWXY1234567890';

export function generateScid(healthIdentityCode: '1' | '2' | '3' = '2'): string {
  const entityId = ERX_REST_ENTITY_ID.padEnd(5, '0').slice(0, 5);

  // Generate 11 random characters from the charset using CSPRNG
  const randomPart: string[] = [];
  const randBytes = randomBytes(11);
  for (let i = 0; i < 11; i++) {
    const idx = randBytes[i]! % SCID_CHARSET.length;
    randomPart.push(SCID_CHARSET[idx]!);
  }

  const scidWithoutCheck = healthIdentityCode + entityId + randomPart.join('');
  const checkDigit = calculateCheckDigit(scidWithoutCheck);
  return scidWithoutCheck + checkDigit;
}

/**
 * Check digit calculation per §4.1.2.
 * Weighted sum of character values (numeric value for digits, Unicode code point
 * for letters), each multiplied by (position + 1), then mod 11. 10+ → "A".
 */
function calculateCheckDigit(scidWithoutCheck: string): string {
  let sum = 0;
  for (let i = 0; i < scidWithoutCheck.length; i++) {
    const ch = scidWithoutCheck[i]!;
    const val = /^\d$/.test(ch) ? parseInt(ch, 10) : ch.charCodeAt(0);
    sum += val * (i + 1);
  }
  const digit = sum % 11;
  return digit >= 10 ? 'A' : String(digit);
}

export { calculateCheckDigit };
