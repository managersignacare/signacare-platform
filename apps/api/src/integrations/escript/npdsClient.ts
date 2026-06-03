/**
 * NPDS (National Prescription Delivery Service) HTTP Client
 *
 * Handles mutual-TLS authentication and FHIR R4 operations
 * against the ADHA NPDS endpoint.
 *
 * Uses Node https.Agent with PFX certificate for mutual-TLS.
 *
 * When ADHA conformance credentials are available:
 * 1. Set env vars: NPDS_API_URL, NPDS_CONFORMANCE_ID, ADHA_CERT_PATH, ADHA_CERT_PASSPHRASE
 * 2. The client will use mutual-TLS for all requests
 */

import https from 'https';
import crypto from 'crypto';
import { URL } from 'url';
import { logger } from '../../utils/logger';
// Audit Tier 7.1 (CRIT-A1) ⚠ BREAKING — see shared/requireEnv.ts.
import { optionalEnv } from '../../shared/requireEnv';
// BUG-332 — shared NASH / mTLS agent factory. See apps/api/src/shared/mtls.ts.
import { createMtlsAgent } from '../../shared/mtls';

// NPDS URL has a legitimate default (the ADHA public NPDS endpoint),
// so optionalEnv is correct here. The other three are credentials
// that MUST be set when the clinic invokes NPDS; requireEnv throws at
// first use.
const NPDS_URL = optionalEnv('NPDS_API_URL') ?? 'https://api.digitalhealth.gov.au/npds/v1';

type JsonRecord = Record<string, unknown>;
type NpdsPayloadSecurityMode = 'off' | 'sign' | 'encrypt_sign';
type ClinicConformanceLookupRow = {
  id: string;
  npds_conformance_id: string | null;
  hpio: string | null;
  deleted_at: Date | null;
  is_active: boolean | null;
};

interface NpdsExtension {
  url?: string;
  valueString?: string;
  valueDateTime?: string;
}

interface PayloadSecurityEnvelope {
  mode: NpdsPayloadSecurityMode;
  algorithm: 'AES-256-GCM';
  digestBase64: string;
  ciphertextBase64: string;
  ivBase64: string;
  authTagBase64: string;
  signatureBase64: string;
  signatureAlgorithm: 'RSA-SHA256';
  keyId: string;
}

interface SecureNpdsSubmitPayload {
  body: string;
  contentType: string;
  headers: Record<string, string>;
  mode: NpdsPayloadSecurityMode;
}

function asRecord(value: unknown): JsonRecord | null {
  return value != null && typeof value === 'object' ? (value as JsonRecord) : null;
}

function asExtensions(value: unknown): NpdsExtension[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonRecord => entry != null)
    .map((entry) => ({
      url: typeof entry.url === 'string' ? entry.url : undefined,
      valueString: typeof entry.valueString === 'string' ? entry.valueString : undefined,
      valueDateTime: typeof entry.valueDateTime === 'string' ? entry.valueDateTime : undefined,
    }));
}

function normalizeConformanceId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveNpdsPayloadSecurityMode(): NpdsPayloadSecurityMode {
  const raw = (process.env.NPDS_PAYLOAD_SECURITY_MODE ?? 'off').trim().toLowerCase();
  if (raw === 'off' || raw === 'sign' || raw === 'encrypt_sign') return raw;
  logger.warn(
    { mode: raw },
    '[BUG-WF81] Invalid NPDS payload security mode; defaulting to off (valid: off | sign | encrypt_sign)',
  );
  return 'off';
}

function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

function requireNpdsSigningPrivateKeyPem(): string {
  const raw = process.env.NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'NPDS payload signing key is not configured. Set NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM.',
    );
  }
  return normalizePem(raw);
}

function requireNpdsPayloadEncryptionKey(): Buffer {
  const raw = process.env.NPDS_PAYLOAD_ENCRYPTION_KEY_HEX?.trim() ?? '';
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error(
      'NPDS payload encryption key must be 64 hex chars (AES-256). Set NPDS_PAYLOAD_ENCRYPTION_KEY_HEX.',
    );
  }
  return Buffer.from(raw, 'hex');
}

function buildSigningMaterial(payload: string, conformanceId: string): Buffer {
  const digest = crypto.createHash('sha256').update(payload, 'utf8').digest('base64');
  return Buffer.from(`conformance=${conformanceId}\ndigest=sha-256:${digest}\n`, 'utf8');
}

function signPayload(signingMaterial: Buffer): { signatureBase64: string; keyId: string } {
  const key = requireNpdsSigningPrivateKeyPem();
  const signature = crypto.sign('RSA-SHA256', signingMaterial, key).toString('base64');
  const keyId = process.env.NPDS_PAYLOAD_SIGNING_KEY_ID?.trim() || 'npds-signing-key';
  return { signatureBase64: signature, keyId };
}

function buildPayloadDigestBase64(payload: string): string {
  return crypto.createHash('sha256').update(payload, 'utf8').digest('base64');
}

function buildSecureSubmitPayload(
  plainPayload: string,
  conformanceId: string,
): SecureNpdsSubmitPayload {
  const mode = resolveNpdsPayloadSecurityMode();
  if (mode === 'off') {
    return {
      mode,
      body: plainPayload,
      contentType: 'application/fhir+json',
      headers: {},
    };
  }

  const digestBase64 = buildPayloadDigestBase64(plainPayload);
  const signingMaterial = buildSigningMaterial(plainPayload, conformanceId);
  const { signatureBase64, keyId } = signPayload(signingMaterial);

  if (mode === 'sign') {
    return {
      mode,
      body: plainPayload,
      contentType: 'application/fhir+json',
      headers: {
        'X-NPDS-Payload-Security-Mode': 'sign',
        'X-NPDS-Payload-Digest': `sha-256=${digestBase64}`,
        'X-NPDS-Payload-Signature': signatureBase64,
        'X-NPDS-Payload-Signature-Alg': 'RSA-SHA256',
        'X-NPDS-Payload-Key-Id': keyId,
      },
    };
  }

  const iv = crypto.randomBytes(12);
  const key = requireNpdsPayloadEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plainPayload, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const envelope: PayloadSecurityEnvelope = {
    mode: 'encrypt_sign',
    algorithm: 'AES-256-GCM',
    digestBase64,
    ciphertextBase64: ciphertext.toString('base64'),
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
    signatureBase64,
    signatureAlgorithm: 'RSA-SHA256',
    keyId,
  };

  return {
    mode,
    body: JSON.stringify(envelope),
    contentType: 'application/json',
    headers: {
      'X-NPDS-Payload-Security-Mode': 'encrypt_sign',
      'X-NPDS-Payload-Enc-Alg': 'AES-256-GCM',
      'X-NPDS-Payload-Digest': `sha-256=${digestBase64}`,
      'X-NPDS-Payload-Key-Id': keyId,
    },
  };
}

// BUG-332 — getHttpsAgent delegates to the shared createMtlsAgent helper.
// Cache lives inside the helper keyed by integrationName='NPDS'. Prior
// behaviour preserved: stub mode (undefined) when cert absent, ERROR log
// in production (last-mile surface for BUG-043 boot-assertion escape),
// requireEnv for passphrase when cert exists.
function getHttpsAgent(): https.Agent | undefined {
  return createMtlsAgent({
    certPathEnv: 'ADHA_CERT_PATH',
    passphraseEnv: 'ADHA_CERT_PASSPHRASE',
    integrationName: 'NPDS',
    passphraseDescription: 'NPDS mTLS certificate',
  });
}

export function isNpdsConfigured(): boolean {
  // BUG-302 — transitional: env var NPDS_CONFORMANCE_ID remains a
  // valid signal until every clinic row is backfilled. isNpdsConfigured
  // returns true if EITHER the env var is set (single-tenant dev) OR
  // the transport layer is otherwise configured (multi-tenant prod:
  // conformance ID is per-clinic, looked up at request time via
  // resolveNpdsConformanceId(clinicId)).
  return !!(process.env.NPDS_API_URL && process.env.ADHA_CERT_PATH);
}

/**
 * BUG-302 — resolve the NPDS conformance ID for a specific clinic.
 * Reads clinics.npds_conformance_id first (the canonical source for
 * multi-tenant prod); falls back to the NPDS_CONFORMANCE_ID env var
 * if the column is NULL (transitional period while ops backfills).
 *
 * Throws ERX_NOT_CONFIGURED if BOTH are absent — a clinic without
 * a conformance ID cannot submit to NPDS (ADHA requirement).
 */
export async function resolveNpdsConformanceId(clinicId: string): Promise<string> {
  // BUG-341 — keep db import lazy/dynamic so this integration client does
  // not take a static dependency on db bootstrap at module-load time.
  const { db } = await import('../../db/db');
  const row = await db<ClinicConformanceLookupRow>('clinics')
    .where({ id: clinicId })
    .whereNull('deleted_at')
    .select('id', 'npds_conformance_id', 'hpio', 'deleted_at', 'is_active')
    .first();
  const perClinic = normalizeConformanceId(row?.npds_conformance_id);
  if (perClinic) return perClinic;

  // BUG-340 — clinic rename/merge fallback. If the source clinic row
  // has no conformance ID but shares HPI-O with a live clinic that does,
  // use that unique sibling conformance ID for cancel/query continuity.
  const hpio = typeof row?.hpio === 'string' ? row.hpio.trim() : '';
  if (hpio) {
    const siblingRows = await db<ClinicConformanceLookupRow>('clinics')
      .where({ hpio })
      .whereNot({ id: clinicId })
      .whereNull('deleted_at')
      .andWhere('is_active', true)
      .select('id', 'npds_conformance_id', 'hpio', 'deleted_at', 'is_active');
    const siblingConformanceIds = Array.from(
      new Set(
        siblingRows
          .map((sibling) => normalizeConformanceId(sibling.npds_conformance_id))
          .filter((value): value is string => value != null),
      ),
    );

    if (siblingConformanceIds.length === 1) {
      const [resolved] = siblingConformanceIds;
      if (resolved) {
        logger.warn(
          {
            clinicId,
            hpio,
            source: 'hpio_sibling_fallback',
            siblingCount: siblingRows.length,
          },
          '[BUG-340] clinic npds_conformance_id missing; resolved via live sibling clinic with same HPI-O',
        );
        return resolved;
      }
    }

    if (siblingConformanceIds.length > 1) {
      logger.error(
        {
          clinicId,
          hpio,
          siblingConformanceIds,
        },
        '[BUG-340] ambiguous sibling NPDS conformance IDs for shared HPI-O; falling back to env path',
      );
    }
  }

  const envFallback = process.env.NPDS_CONFORMANCE_ID;
  const envConformanceId = normalizeConformanceId(envFallback ?? null);
  if (envConformanceId) {
    logger.warn(
      { clinicId },
      '[BUG-302] clinic has NULL npds_conformance_id — falling back to NPDS_CONFORMANCE_ID env. Ops must backfill the clinics table before STRICT_NPDS_CONFORMANCE=true.',
    );
    return envConformanceId;
  }

  const err = new Error(
    'NPDS conformance ID is not configured for this clinic. Populate clinics.npds_conformance_id via admin UI or set NPDS_CONFORMANCE_ID env.',
  ) as Error & { status: number; code: string; details: Record<string, unknown> };
  err.status = 503;
  err.code = 'ERX_NOT_CONFIGURED';
  err.details = { field: 'clinics.npds_conformance_id', clinicId };
  throw err;
}

/**
 * Make an HTTPS request with mutual-TLS via Node's native http/https modules.
 * This bypasses the limitation that Node's global `fetch()` does not support
 * custom https agents in Node 18-20.
 *
 * BUG-302 — conformance ID is now passed in as a required parameter
 * (rather than read from env inline) so per-clinic attribution is
 * deterministic. Callers resolve via resolveNpdsConformanceId(clinicId)
 * before invoking.
 */
function mtlsRequest(
  method: string,
  path: string,
  conformanceId: string,
  body?: string,
  opts?: { contentType?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, NPDS_URL);
    const agent = getHttpsAgent();
    const contentType = opts?.contentType ?? 'application/fhir+json';
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      agent,
      headers: {
        'Content-Type': contentType,
        'Accept': 'application/fhir+json',
        'X-Conformance-ID': conformanceId,
        ...(opts?.headers ?? {}),
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
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
    req.setTimeout(30_000, () => { req.destroy(new Error('NPDS request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRetryableNpdsStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit a FHIR MedicationRequest to NPDS.
 * Returns the server-assigned ID and eScript token.
 *
 * BUG-302 — clinicId is required: the NPDS conformance ID is resolved
 * per-clinic from the clinics table. Pre-fix this was a single env
 * var shared across every tenant, breaking multi-tenant attribution.
 */
export async function submitToNpds(fhirResource: object, clinicId: string): Promise<{
  success: boolean;
  npdsId?: string;
  erxToken?: string;
  expiresAt?: string;
  rawResponse?: unknown;
  error?: string;
}> {
  if (!isNpdsConfigured()) {
    return { success: false, error: 'NPDS not configured. Set NPDS_API_URL and ADHA_CERT_PATH.' };
  }

  try {
    const conformanceId = await resolveNpdsConformanceId(clinicId);
    const payload = JSON.stringify(fhirResource);
    const securePayload = buildSecureSubmitPayload(payload, conformanceId);
    const maxAttempts = toPositiveInt(process.env.NPDS_SUBMIT_MAX_ATTEMPTS, 3);
    const baseDelayMs = toPositiveInt(process.env.NPDS_SUBMIT_RETRY_BASE_MS, 250);
    const maxDelayMs = toPositiveInt(process.env.NPDS_SUBMIT_RETRY_MAX_MS, 2_000);

    let lastResponse: { status: number; body: string } | null = null;
    let lastNetworkError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: { status: number; body: string };
      try {
        response = await mtlsRequest(
          'POST',
          '/MedicationRequest',
          conformanceId,
          securePayload.body,
          {
            contentType: securePayload.contentType,
            headers: securePayload.headers,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastNetworkError = msg;
        if (attempt < maxAttempts) {
          const delayMs = Math.min(baseDelayMs * (2 ** (attempt - 1)), maxDelayMs);
          logger.warn(
            { attempt, maxAttempts, delayMs, err: msg },
            '[NPDS] Network failure on submit; retrying',
          );
          await sleep(delayMs);
          continue;
        }
        logger.error({ err: msg }, '[NPDS] Network error');
        return { success: false, error: `Network error: ${msg}` };
      }

      lastResponse = response;
      if (response.status >= 200 && response.status < 300) break;

      const retryable = isRetryableNpdsStatus(response.status);
      if (retryable && attempt < maxAttempts) {
        const delayMs = Math.min(baseDelayMs * (2 ** (attempt - 1)), maxDelayMs);
        logger.warn(
          { attempt, maxAttempts, delayMs, status: response.status },
          '[NPDS] Transient submit failure; retrying',
        );
        await sleep(delayMs);
        continue;
      }

      logger.error({ status: response.status, body: response.body.substring(0, 300) }, '[NPDS] Submission failed');
      return {
        success: false,
        error: `NPDS ${response.status}: ${response.body.substring(0, 200)}`,
        rawResponse: response.body,
      };
    }

    if (!lastResponse) {
      const fallback = lastNetworkError ?? 'unknown';
      logger.error({ err: fallback }, '[NPDS] Submission failed before receiving any response');
      return { success: false, error: `Network error: ${fallback}` };
    }

    const parsed: unknown = JSON.parse(lastResponse.body);
    const result = asRecord(parsed) ?? {};
    // NPDS returns the created resource with server-assigned identifiers
    const npdsId = typeof result.id === 'string' ? result.id : undefined;
    const extensions = asExtensions(result.extension);
    const tokenExt = extensions.find((e) => e.url?.includes('escript-token'));
    const erxToken = tokenExt?.valueString;
    const expiryExt = extensions.find((e) => e.url?.includes('token-expiry'));
    const expiresAt = expiryExt?.valueDateTime;

    logger.info(
      {
        npdsId,
        erxToken,
        payloadSecurityMode: securePayload.mode,
      },
      '[NPDS] Prescription submitted successfully',
    );
    return { success: true, npdsId, erxToken, expiresAt, rawResponse: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[NPDS] Submission error');
    return { success: false, error: `NPDS submission error: ${msg}` };
  }
}

/**
 * Query Active Script List (ASL / MySL) for a patient by IHI.
 * BUG-302 — clinicId required for per-clinic conformance-ID attribution.
 */
export async function queryActiveScriptList(patientIhi: string, clinicId: string): Promise<{
  success: boolean;
  prescriptions?: JsonRecord[];
  error?: string;
}> {
  if (!isNpdsConfigured()) {
    return { success: false, error: 'NPDS not configured.' };
  }

  try {
    const conformanceId = await resolveNpdsConformanceId(clinicId);
    const path = `/MedicationRequest?patient.identifier=${encodeURIComponent(
      `http://ns.electronichealth.net.au/id/hi/ihi/1.0|${patientIhi}`
    )}&status=active`;
    const res = await mtlsRequest('GET', path, conformanceId);

    if (res.status < 200 || res.status >= 300) {
      return { success: false, error: `NPDS ${res.status}` };
    }

    const parsed: unknown = JSON.parse(res.body);
    const bundle = asRecord(parsed) ?? {};
    const entries = Array.isArray(bundle.entry)
      ? bundle.entry
        .map((entry) => {
          const row = asRecord(entry);
          return row ? asRecord(row.resource) : null;
        })
        .filter((resource): resource is JsonRecord => resource != null)
      : [];
    return { success: true, prescriptions: entries };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Cancel an eScript on NPDS.
 * BUG-302 — clinicId required for per-clinic conformance-ID attribution.
 */
export async function cancelOnNpds(npdsId: string, reason: string, clinicId: string): Promise<{ success: boolean; error?: string }> {
  if (!isNpdsConfigured()) {
    return { success: false, error: 'NPDS not configured.' };
  }

  try {
    const conformanceId = await resolveNpdsConformanceId(clinicId);
    const body = JSON.stringify({
      resourceType: 'MedicationRequest',
      id: npdsId,
      status: 'cancelled',
      statusReason: { text: reason },
    });
    const res = await mtlsRequest('PATCH', `/MedicationRequest/${npdsId}`, conformanceId, body);
    return { success: res.status >= 200 && res.status < 300, error: res.status >= 300 ? `NPDS ${res.status}` : undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
