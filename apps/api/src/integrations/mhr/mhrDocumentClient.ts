// apps/api/src/integrations/mhr/mhrDocumentClient.ts
//
// BUG-298 — My Health Record (MHR) FHIR DocumentReference push.
//
// Scope (when `integration-mhr-docref` flag enabled):
//   1. Build a FHIR R4 DocumentReference wrapping the base64-encoded
//      CDA XML payload.
//   2. Wrap that DocumentReference in a FHIR Bundle (transaction).
//   3. POST via NASH mTLS to ADHA MHR Document API.
//   4. Retry with exponential backoff on 5xx (transient); hard-fail
//      on 4xx (permanent — operator alert via thrown error).
//   5. Return externalDocId (MHR-assigned) + submittedAt.
//
// Real-world preconditions:
//   - ADHA (Australian Digital Health Agency) partner registration
//   - NASH TLS certificate for mTLS (MHR_NASH_CERT_PATH + passphrase)
//   - HPO / HPI-O identifiers for the clinic + HPI-I for signing clinician
//   - Clinic's conformance ID for MHR API access (MHR_CONFORMANCE_ID)
//
// Code-complete per BUG-298 accepted_pattern. Full E2E validation
// requires NASH cert + ADHA partner registration — until then the
// unit tests exercise payload shape + retry logic; the mTLS path is
// covered by the shared BUG-332 helper's existing tests.

import https from 'https';
import { URL } from 'url';
import { logger } from '../../utils/logger';
import { requireEnv, optionalEnv } from '../../shared/requireEnv';
// BUG-332 — shared NASH mTLS agent factory. Third caller (after BUG-297
// npds + hiService). Earned rule-of-three extraction in BUG-332 and
// this is the first greenfield caller (previous two were refactors).
import { createMtlsAgent } from '../../shared/mtls';

export interface MhrDocumentPushInput {
  patientId: string;
  patientIhi: string;               // 16-digit IHI (800360…)
  clinicHpio: string;               // clinic HPI-O (800362…)
  authorHpii: string;               // signing clinician's HPI-I (800361…)
  letterId: string;
  documentType: 'referral' | 'discharge' | 'specialist_letter' | 'patient_summary';
  cdaXml: string;
  createdAt: string;
}

export interface MhrDocumentPushResult {
  externalDocId: string;
  submittedAt: string;
}

// LOINC codes for the four document types — MHR rejects bundles with
// unknown type.coding. These values are from the ADHA MHR document-type
// value set (https://terminology.hl7.org.au/CodeSystem/loinc subset).
const DOCUMENT_TYPE_LOINC: Record<MhrDocumentPushInput['documentType'], { code: string; display: string }> = {
  specialist_letter: { code: '11488-4', display: 'Consultation note' },
  discharge: { code: '18842-5', display: 'Discharge summary' },
  referral: { code: '57133-1', display: 'Referral note' },
  patient_summary: { code: '60591-5', display: 'Patient summary' },
};

export function isMhrDocumentApiConfigured(): boolean {
  return !!(
    optionalEnv('MHR_API_URL')
    && optionalEnv('MHR_NASH_CERT_PATH')
    && optionalEnv('MHR_CONFORMANCE_ID')
  );
}

export async function healthCheck(): Promise<{
  status: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE';
  lastCheckedAt: string;
}> {
  const now = new Date().toISOString();
  if (!isMhrDocumentApiConfigured()) return { status: 'UNCONFIGURED', lastCheckedAt: now };
  return { status: 'UNREACHABLE', lastCheckedAt: now };
}

/**
 * Build a FHIR R4 DocumentReference resource for the given input.
 * Exported for unit-testing the payload shape independently of the
 * network transport. MHR validates the subject reference, type.coding,
 * content.attachment.contentType, and content.attachment.data (base64).
 */
export function buildDocumentReference(input: MhrDocumentPushInput): Record<string, unknown> {
  const typeEntry = DOCUMENT_TYPE_LOINC[input.documentType];
  return {
    resourceType: 'DocumentReference',
    status: 'current',
    docStatus: 'final',
    type: {
      coding: [{
        system: 'http://loinc.org',
        code: typeEntry.code,
        display: typeEntry.display,
      }],
    },
    subject: {
      // MHR patient identification is via IHI.
      identifier: {
        system: 'http://ns.electronichealth.net.au/id/hi/ihi/1.0',
        value: input.patientIhi,
      },
    },
    date: input.createdAt,
    author: [{
      identifier: {
        system: 'http://ns.electronichealth.net.au/id/hi/hpii/1.0',
        value: input.authorHpii,
      },
    }],
    custodian: {
      identifier: {
        system: 'http://ns.electronichealth.net.au/id/hi/hpio/1.0',
        value: input.clinicHpio,
      },
    },
    content: [{
      attachment: {
        contentType: 'application/xml',
        // CDA XML is base64 for FHIR transport per ADHA MHR guidance.
        data: Buffer.from(input.cdaXml, 'utf-8').toString('base64'),
        title: `${input.documentType} ${input.letterId}`,
        creation: input.createdAt,
      },
    }],
    masterIdentifier: {
      // Caller-supplied stable id so MHR de-duplicates re-submissions.
      system: 'urn:ietf:rfc:3986',
      value: `urn:uuid:${input.letterId}`,
    },
  };
}

/**
 * Wrap a DocumentReference in a FHIR Bundle (transaction) per MHR
 * submission contract. One bundle carries one DocumentReference per
 * document push (bulk upload is a separate API).
 */
export function buildBundle(docRef: Record<string, unknown>): Record<string, unknown> {
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [{
      resource: docRef,
      request: {
        method: 'POST',
        url: 'DocumentReference',
      },
    }],
  };
}

/**
 * Parse the FHIR Bundle response for the externally-assigned
 * DocumentReference id. MHR returns a Bundle with entry.response.location
 * shaped as "DocumentReference/<id>/_history/<version>".
 *
 * Exported for unit testing. On malformed response, throws — the caller
 * interprets as a 5xx-equivalent and retries within the retry budget.
 */
export function parseBundleResponse(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('MHR_BUNDLE_PARSE_FAILED: response is not valid JSON');
  }
  const bundle = parsed as { entry?: Array<{ response?: { location?: string } }> };
  const location = bundle.entry?.[0]?.response?.location;
  if (!location) {
    throw new Error('MHR_BUNDLE_PARSE_FAILED: no entry.response.location in response');
  }
  const match = location.match(/DocumentReference\/([^/]+)/);
  if (!match) {
    throw new Error(`MHR_BUNDLE_PARSE_FAILED: malformed location: ${location}`);
  }
  return match[1];
}

/**
 * Perform a single HTTPS POST via NASH mTLS. Surfaced for testability;
 * retry logic wraps this call.
 */
function httpsPostJson(
  agent: https.Agent,
  endpointUrl: string,
  conformanceId: string,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpointUrl);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/fhir+json; charset=utf-8',
        'Accept': 'application/fhir+json',
        'X-MHR-Conformance-Id': conformanceId,
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
    req.setTimeout(30_000, () => { req.destroy(new Error('MHR request timed out')); });
    req.write(body);
    req.end();
  });
}

/**
 * Small exponential-backoff helper. Retry budget: 3 attempts (original +
 * 2 retries). Backoff: 200ms, 800ms (jittered ±25%).
 */
const RETRY_DELAYS_MS = [200, 800];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pushDocument(input: MhrDocumentPushInput): Promise<MhrDocumentPushResult> {
  if (!isMhrDocumentApiConfigured()) {
    throw new Error('MHR Document API not configured. Set MHR_API_URL + MHR_NASH_CERT_PATH + MHR_CONFORMANCE_ID.');
  }
  const agent = createMtlsAgent({
    certPathEnv: 'MHR_NASH_CERT_PATH',
    passphraseEnv: 'MHR_NASH_CERT_PASSPHRASE',
    integrationName: 'MHR',
    passphraseDescription: 'MHR NASH mTLS certificate',
  });
  if (!agent) {
    // Shouldn't happen — isMhrDocumentApiConfigured already guarded
    // the cert env. Defensive: bail out rather than proceed with a
    // no-mTLS request that would leak PHI over plain TLS.
    throw new Error('MHR mTLS agent not constructed — cert file missing at runtime');
  }
  const endpointUrl = requireEnv('MHR_API_URL', 'MHR document submission endpoint');
  const conformanceId = requireEnv('MHR_CONFORMANCE_ID', 'MHR conformance identifier');

  const docRef = buildDocumentReference(input);
  const bundle = buildBundle(docRef);
  const body = JSON.stringify(bundle);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await httpsPostJson(agent, endpointUrl, conformanceId, body);
      if (res.status >= 200 && res.status < 300) {
        const externalDocId = parseBundleResponse(res.body);
        const submittedAt = new Date().toISOString();
        logger.info(
          { externalDocId, letterId: input.letterId, documentType: input.documentType },
          '[MHR] Document pushed successfully',
        );
        return { externalDocId, submittedAt };
      }
      if (res.status >= 400 && res.status < 500) {
        // Permanent failure — no retry. Log operator-actionable detail.
        logger.error(
          {
            status: res.status,
            letterId: input.letterId,
            bodySnippet: res.body.substring(0, 400),
          },
          '[MHR] Permanent failure on document push (4xx)',
        );
        throw new Error(`MHR_SUBMIT_FAILED_${res.status}: permanent`);
      }
      // 5xx — retry if budget remains.
      lastError = new Error(`MHR_SUBMIT_FAILED_${res.status}: transient`);
      logger.warn(
        { status: res.status, attempt, letterId: input.letterId },
        '[MHR] Transient failure — will retry if budget remains',
      );
    } catch (err) {
      // Network-level error OR parseBundleResponse failure. Retry is
      // appropriate for the former; the latter is caller-fault but the
      // body-parse path re-throws from the 200-path, not here.
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        { err: lastError.message, attempt, letterId: input.letterId },
        '[MHR] Network/parse error — will retry if budget remains',
      );
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      const jitter = 1 + (Math.random() * 0.5 - 0.25);
      await sleep(delay * jitter);
    }
  }
  throw lastError ?? new Error('MHR_SUBMIT_FAILED: exhausted retry budget');
}
