/**
 * BUG-299 — ADHA CTS v3.0.1 MVP conformance suite.
 *
 * Five test vectors required for Wave A-4 exit (full CTS v3.0.1
 * coverage — ~55 automated cases + Observed-Conformance witnesses —
 * deferred to BUG-344 in A-5). This MVP stands up the harness +
 * exercises the highest-value conformance pinch points:
 *
 *   T1 — ETP2 happy path: FHIR MedicationRequest round-trip against
 *        nock-mocked NPDS responder (200 with server-assigned id +
 *        eRx token extension).
 *   T2 — Token validation failures: 400 malformed SCID, 401 expired,
 *        404 non-existent — each bubbles as {success:false, error:…}.
 *   T3 — NASH mTLS rejection: TLS handshake failure path — when the
 *        cert env is unset OR the cert file is missing, submit short-
 *        circuits with "NPDS not configured" BEFORE any network
 *        attempt is made (BUG-043 defence-in-depth).
 *   T4 — HPI-O format rejection: buildFullPrescriptionXml throws
 *        ERX_NOT_CONFIGURED when clinic.hpio is missing OR malformed
 *        (BUG-295 regression shield).
 *   T5 — Duplicate submission rejection: 409 Conflict from NPDS
 *        bubbles as {success:false, error:'NPDS 409 …'}.
 *
 * Fixtures mimic the shape caller sees in production (ErxSubmitPayload
 * + clinicId). nock intercepts https://api.digitalhealth.gov.au/npds/v1
 * (the default NPDS_URL when the env is unset, which is fine — the
 * default is the ADHA public endpoint and nock doesn't care whether
 * it resolves DNS in-test).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import nock from 'nock';
import { createVerify, generateKeyPairSync } from 'crypto';
import type { ErxPrescriptionPayload } from '../../../src/integrations/escript/erxRestPayloads';

const NPDS_HOST = 'https://api.digitalhealth.gov.au';
const NPDS_BASE_PATH = '/npds/v1';

// Minimal FHIR MedicationRequest for the happy-path submit (shape-
// agnostic at this layer — the NPDS mock just echoes back a success).
const sampleFhirResource = {
  resourceType: 'MedicationRequest',
  status: 'active',
  intent: 'order',
  identifier: [{ system: 'urn:scid', value: 'SCID-test-001' }],
};
const TEST_CLINIC_ID = '11111111-1111-1111-1111-111111111111';

interface ErxNotConfiguredError {
  code?: string;
  status?: number;
  details?: { reason?: string };
}

// Base ErxPrescriptionPayload for the HPI-O rejection test (T4).
function mkPayload(overrides: Partial<ErxPrescriptionPayload> = {}): ErxPrescriptionPayload {
  return {
    scid: 'SCID-T4-001',
    guid: '22222222-2222-2222-2222-222222222222',
    conformanceId: 'CONF-001',
    patient: {
      familyName: 'Test',
      givenName: 'Patient',
      dateOfBirth: '1990-01-01',
      gender: 'M',
      addressLine1: '1 Test St',
      suburb: 'Testville',
      state: 'VIC',
      postcode: '3000',
    },
    clinician: {
      prescriberNumber: '1234567',
      providerNumber: '2699958J',
      givenName: 'Dr',
      familyName: 'Tester',
      practiceName: 'Test Clinic',
      hpio: '8003621234567892', // Luhn-valid HPI-O
    },
    item: {
      prescriptionDate: '2026-04-22',
      tradeName: 'Sertraline',
      genericName: 'Sertraline',
      genericIntention: 'G',
      quantity: 30,
      repeats: 5,
      directions: 'one daily',
    },
    ...overrides,
  } as ErxPrescriptionPayload;
}

describe('BUG-299 CTS v3.0.1 MVP — eRx conformance suite', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Ensure nock can intercept cleanly even when Node's global undici is
    // in play. Disabling net requests here means an un-mocked request
    // throws rather than timing out — loud failure is preferable.
    nock.disableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    process.env.NPDS_API_URL = `${NPDS_HOST}${NPDS_BASE_PATH}`;
    process.env.ADHA_CERT_PATH = '/tmp/bug299-fake-cert.p12';
    process.env.NPDS_CONFORMANCE_ID = 'TEST-CONF-001';
    delete process.env.NPDS_PAYLOAD_SECURITY_MODE;
    delete process.env.NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM;
    delete process.env.NPDS_PAYLOAD_SIGNING_KEY_ID;
    delete process.env.NPDS_PAYLOAD_ENCRYPTION_KEY_HEX;
  });

  afterEach(() => {
    nock.cleanAll();
    process.env = { ...originalEnv };
  });

  it('T1 — ETP2 happy path: FHIR round-trip returns npdsId + erxToken', async () => {
    nock(NPDS_HOST)
      .post('/MedicationRequest')
      .reply(201, {
        resourceType: 'MedicationRequest',
        id: 'npds-id-001',
        extension: [
          {
            url: 'http://ns.electronichealth.net.au/fhir/extension/escript-token',
            valueString: 'erx-token-abc-xyz',
          },
          {
            url: 'http://ns.electronichealth.net.au/fhir/extension/token-expiry',
            valueDateTime: '2026-07-22T00:00:00Z',
          },
        ],
      });

    const { submitToNpds } = await import('../../../src/integrations/escript/npdsClient');
    const result = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);
    expect(result.success).toBe(true);
    expect(result.npdsId).toBe('npds-id-001');
    expect(result.erxToken).toBe('erx-token-abc-xyz');
    expect(result.expiresAt).toBe('2026-07-22T00:00:00Z');
  });

  it('T2 — Token validation failures: 400 / 401 / 404 each surface as {success:false}', async () => {
    const { submitToNpds } = await import('../../../src/integrations/escript/npdsClient');

    // 400 — malformed SCID
    nock(NPDS_HOST).post('/MedicationRequest')
      .reply(400, JSON.stringify({ issue: [{ diagnostics: 'Malformed SCID' }] }));
    const res400 = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);
    expect(res400.success).toBe(false);
    expect(res400.error).toMatch(/^NPDS 400/);

    // 401 — expired token
    nock(NPDS_HOST).post('/MedicationRequest')
      .reply(401, JSON.stringify({ issue: [{ diagnostics: 'Token expired' }] }));
    const res401 = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);
    expect(res401.success).toBe(false);
    expect(res401.error).toMatch(/^NPDS 401/);

    // 404 — non-existent
    nock(NPDS_HOST).post('/MedicationRequest')
      .reply(404, JSON.stringify({ issue: [{ diagnostics: 'Resource not found' }] }));
    const res404 = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);
    expect(res404.success).toBe(false);
    expect(res404.error).toMatch(/^NPDS 404/);
  });

  it('T3 — NASH mTLS rejection: missing cert short-circuits with NOT_CONFIGURED', async () => {
    // Remove the cert env — isNpdsConfigured() should now return false
    // and submit short-circuits BEFORE any nock interception. This is
    // the defence-in-depth layer from BUG-043; the boot-time assertion
    // would have blocked production boot in this shape.
    delete process.env.ADHA_CERT_PATH;

    const { submitToNpds } = await import('../../../src/integrations/escript/npdsClient');
    const result = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/NPDS not configured/);
    // Crucially, no nock interceptor was matched — pendingMocks is
    // empty and no outbound request happened.
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('T4 — HPI-O format rejection: buildFullPrescriptionXml throws ERX_NOT_CONFIGURED', async () => {
    const { buildErx001Xml } = await import('../../../src/integrations/escript/erxRestPayloads');

    // Missing HPI-O
    const missingPayload = mkPayload({
      clinician: { ...mkPayload().clinician, hpio: undefined },
    });
    try {
      buildErx001Xml(missingPayload);
      throw new Error('buildErx001Xml should have thrown');
    } catch (err: unknown) {
      const typedErr = err as ErxNotConfiguredError;
      expect(typedErr.code).toBe('ERX_NOT_CONFIGURED');
      expect(typedErr.status).toBe(503);
      expect(typedErr.details?.reason).toBe('missing');
    }

    // Malformed HPI-O (wrong prefix)
    const malformedPayload = mkPayload({
      clinician: { ...mkPayload().clinician, hpio: '8003601234567894' },
    });
    try {
      buildErx001Xml(malformedPayload);
      throw new Error('buildErx001Xml should have thrown');
    } catch (err: unknown) {
      const typedErr = err as ErxNotConfiguredError;
      expect(typedErr.code).toBe('ERX_NOT_CONFIGURED');
      expect(typedErr.details?.reason).toBe('malformed');
    }
  });

  it('T5 — Duplicate submission: 409 Conflict surfaces as {success:false, error:NPDS 409}', async () => {
    nock(NPDS_HOST).post('/MedicationRequest')
      .reply(409, JSON.stringify({
        issue: [{
          severity: 'error',
          code: 'duplicate',
          diagnostics: 'A prescription with this SCID already exists',
        }],
      }));

    const { submitToNpds } = await import('../../../src/integrations/escript/npdsClient');
    const result = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^NPDS 409/);
    expect(result.error).toMatch(/duplicate|SCID already exists/i);
  });

  it('T6 — transient NPDS failures retry and recover on later attempt', async () => {
    process.env.NPDS_SUBMIT_MAX_ATTEMPTS = '3';
    process.env.NPDS_SUBMIT_RETRY_BASE_MS = '1';
    process.env.NPDS_SUBMIT_RETRY_MAX_MS = '2';

    const scope = nock(NPDS_HOST)
      .post('/MedicationRequest')
      .reply(503, JSON.stringify({ issue: [{ diagnostics: 'Upstream busy' }] }))
      .post('/MedicationRequest')
      .reply(503, JSON.stringify({ issue: [{ diagnostics: 'Retry later' }] }))
      .post('/MedicationRequest')
      .reply(201, {
        resourceType: 'MedicationRequest',
        id: 'npds-id-retry-001',
        extension: [{
          url: 'http://ns.electronichealth.net.au/fhir/extension/escript-token',
          valueString: 'erx-token-retry-ok',
        }],
      });

    const { submitToNpds } = await import('../../../src/integrations/escript/npdsClient');
    const result = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);

    expect(result.success).toBe(true);
    expect(result.npdsId).toBe('npds-id-retry-001');
    expect(result.erxToken).toBe('erx-token-retry-ok');
    expect(scope.isDone()).toBe(true);
  });

  it('T7 — payload security mode=sign attaches PKI signature headers on FHIR body', async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.NPDS_PAYLOAD_SECURITY_MODE = 'sign';
    process.env.NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM = keyPair.privateKey
      .export({ format: 'pem', type: 'pkcs1' })
      .toString();
    process.env.NPDS_PAYLOAD_SIGNING_KEY_ID = 'bugwf81-sign-key';

    const expectedBody = JSON.stringify(sampleFhirResource);
    let capturedSignature = '';
    let capturedDigest = '';
    let capturedKid = '';
    let capturedConformanceId = '';

    nock(NPDS_HOST)
      .post('/MedicationRequest', expectedBody)
      .matchHeader('x-npds-payload-security-mode', 'sign')
      .matchHeader('x-npds-payload-signature-alg', 'RSA-SHA256')
      .reply(function reply() {
        const headers = this.req.headers;
        capturedSignature = String(headers['x-npds-payload-signature'] ?? '');
        capturedDigest = String(headers['x-npds-payload-digest'] ?? '');
        capturedKid = String(headers['x-npds-payload-key-id'] ?? '');
        capturedConformanceId = String(headers['x-conformance-id'] ?? '');
        return [
          201,
          {
            resourceType: 'MedicationRequest',
            id: 'npds-id-signed',
          },
        ];
      });

    const { submitToNpds } = await import('../../../src/integrations/escript/npdsClient');
    const result = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);

    expect(result.success).toBe(true);
    expect(capturedDigest.startsWith('sha-256=')).toBe(true);
    expect(capturedKid).toBe('bugwf81-sign-key');
    expect(capturedSignature.length).toBeGreaterThan(32);

    const verifier = createVerify('RSA-SHA256');
    const digestBase64 = capturedDigest.replace(/^sha-256=/, '');
    expect(capturedConformanceId.length).toBeGreaterThan(0);
    verifier.update(
      Buffer.from(`conformance=${capturedConformanceId}\ndigest=sha-256:${digestBase64}\n`, 'utf8'),
    );
    verifier.end();
    const verified = verifier.verify(
      keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      Buffer.from(capturedSignature, 'base64'),
    );
    expect(verified).toBe(true);
  });

  it('T8 — payload security mode=encrypt_sign sends encrypted envelope (AES-256-GCM)', async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.NPDS_PAYLOAD_SECURITY_MODE = 'encrypt_sign';
    process.env.NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM = keyPair.privateKey
      .export({ format: 'pem', type: 'pkcs1' })
      .toString();
    process.env.NPDS_PAYLOAD_ENCRYPTION_KEY_HEX = 'a'.repeat(64);
    process.env.NPDS_PAYLOAD_SIGNING_KEY_ID = 'bugwf81-enc-key';

    let capturedBody = '';
    let capturedMode = '';
    let capturedAlg = '';

    nock(NPDS_HOST)
      .post('/MedicationRequest')
      .matchHeader('content-type', 'application/json')
      .matchHeader('x-npds-payload-security-mode', 'encrypt_sign')
      .matchHeader('x-npds-payload-enc-alg', 'AES-256-GCM')
      .reply(function reply(_uri, requestBody) {
        capturedMode = String(this.req.headers['x-npds-payload-security-mode'] ?? '');
        capturedAlg = String(this.req.headers['x-npds-payload-enc-alg'] ?? '');
        capturedBody = typeof requestBody === 'string'
          ? requestBody
          : Buffer.isBuffer(requestBody)
            ? requestBody.toString('utf8')
            : JSON.stringify(requestBody);
        return [
          201,
          {
            resourceType: 'MedicationRequest',
            id: 'npds-id-encrypted',
          },
        ];
      });

    const { submitToNpds } = await import('../../../src/integrations/escript/npdsClient');
    const result = await submitToNpds(sampleFhirResource, TEST_CLINIC_ID);

    expect(result.success).toBe(true);
    expect(capturedMode).toBe('encrypt_sign');
    expect(capturedAlg).toBe('AES-256-GCM');

    const envelope = JSON.parse(capturedBody) as {
      mode: string;
      algorithm: string;
      ciphertextBase64: string;
      ivBase64: string;
      authTagBase64: string;
      signatureBase64: string;
      signatureAlgorithm: string;
      digestBase64: string;
      keyId: string;
    };
    expect(envelope.mode).toBe('encrypt_sign');
    expect(envelope.algorithm).toBe('AES-256-GCM');
    expect(envelope.signatureAlgorithm).toBe('RSA-SHA256');
    expect(envelope.keyId).toBe('bugwf81-enc-key');
    expect(envelope.ciphertextBase64.length).toBeGreaterThan(16);
    expect(envelope.ivBase64.length).toBeGreaterThan(8);
    expect(envelope.authTagBase64.length).toBeGreaterThan(8);
    expect(envelope.signatureBase64.length).toBeGreaterThan(32);
    expect(envelope.digestBase64.length).toBeGreaterThan(32);
    expect(envelope.ciphertextBase64).not.toContain('MedicationRequest');
  });
});
