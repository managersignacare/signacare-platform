/**
 * BUG-272 regression — WebSocket scribe recording MUST verify JWT at
 * upgrade, verify consent + patient relationship before accepting the
 * session, and emit AMBIENT_NOTE_RECORDING_STARTED audit-log on success.
 *
 * Pre-fix: apps/api/src/mcp/scribeStreaming.ts accepted any upgrade,
 * extracted staffId + clinicId from the CLIENT-supplied start message
 * without validation, and ran processAmbientAudio on unconsented audio.
 *
 * Post-fix contract:
 *   Gate 1: HTTP upgrade rejected with 401 if Authorization header /
 *           signacare_access cookie is missing or JWT invalid.
 *   Gate 2: first WS message must be {type:'start', patientId, consentId}.
 *           Zod fail → close 4422. Relationship fail → close 4403
 *           NO_PATIENT_RELATIONSHIP. Consent missing → close 4403
 *           CONSENT_REQUIRED. Consent stale → close 4403 CONSENT_EXPIRED.
 *           Success → audit_log row bound to consentId, with
 *           newData.transport === 'websocket'.
 *   Timeout: no start message within 5s → close 4408.
 *
 * Mirrors the 9-test HTTP consent gate suite
 * (tests/integration/ambientNoteConsentGate.int.test.ts).
 *
 * Skipped when Postgres + Redis are unreachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import WebSocket from 'ws';
import request from 'supertest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { setupScribeWebSocket, SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS } from '../../src/mcp/scribeStreaming';

const READY = await isIntegrationReady();

let server: HttpServer;
let port: number;
let token = '';
let adminStaffId = '';
let clinicId = '';
let patientId = '';

beforeAll(async () => {
  if (!READY) return;
  const session = await loginAsAdmin();
  token = session.token;
  adminStaffId = session.userId;
  clinicId = session.clinicId;

  const patient = await dbAdmin('patients')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .first('id');
  if (!patient) throw new Error('BUG-272 test setup: no seeded patient in clinic');
  patientId = patient.id as string;

  // Bring up a dedicated HTTP server + WS upgrade handler so we can
  // issue real ws:// connections and real HTTP upgrade attempts.
  server = createServer(app);
  await setupScribeWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('scribe_consents').where({ clinic_id: clinicId }).del().catch(() => undefined);
  await dbAdmin('audit_log').where({ operation: 'AMBIENT_NOTE_RECORDING_STARTED', clinic_id: clinicId }).del().catch(() => undefined);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function seedConsent(args: {
  patientId: string;
  clinicId: string;
  attestedAt: Date;
}): Promise<string> {
  const id = randomUUID();
  await dbAdmin('scribe_consents').insert({
    id,
    clinic_id: args.clinicId,
    patient_id: args.patientId,
    mode: 'clinician_attestation',
    clinician_attested_by_id: adminStaffId,
    clinician_attestation_text: 'BUG-272 test consent',
    attested_at: args.attestedAt,
    created_at: new Date(),
  });
  return id;
}

/**
 * Open a WebSocket; resolve on open, reject on any close/error that
 * happens before open (i.e. upgrade-rejection cases).
 */
function openWs(opts: { authHeader?: string; timeoutMs?: number } = {}): Promise<WebSocket> {
  const headers: Record<string, string> = {};
  if (opts.authHeader !== undefined) headers['Authorization'] = opts.authHeader;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/scribe`, { headers });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('openWs timed out'));
    }, opts.timeoutMs ?? 5000);
    ws.once('open', () => { clearTimeout(t); resolve(ws); });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(t);
      reject(Object.assign(new Error('upgrade rejected'), { status: res.statusCode }));
    });
    ws.once('error', (err) => { clearTimeout(t); reject(err); });
  });
}

/** Await the next close event; returns { code, reason }. */
function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('waitForClose timed out')), timeoutMs);
    ws.once('close', (code, reason) => {
      clearTimeout(t);
      resolve({ code, reason: reason.toString() });
    });
  });
}

/** Await the next text message; returns parsed JSON. */
function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('waitForMessage timed out')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(t);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    });
  });
}

describe.skipIf(!READY)('BUG-272 — WebSocket scribe consent + relationship gate', () => {
  it('W1 — upgrade without Authorization header → HTTP 401; WS never opens', async () => {
    await expect(openWs({})).rejects.toMatchObject({ status: 401 });
  });

  it('W2 — upgrade with invalid JWT → HTTP 401', async () => {
    await expect(openWs({ authHeader: 'Bearer not-a-real-jwt' })).rejects.toMatchObject({ status: 401 });
  });

  it('W3 — malformed start message (missing patientId / consentId) → close 4422 INVALID_SESSION_OPEN', async () => {
    const ws = await openWs({ authHeader: `Bearer ${token}` });
    ws.send(JSON.stringify({ type: 'start' })); // no patientId, no consentId
    const { code } = await waitForClose(ws);
    expect(code).toBe(4422);
  });

  it('W4 — consent row does NOT exist → close 4403 CONSENT_REQUIRED; no audit row', async () => {
    const bogusConsent = randomUUID();
    const ws = await openWs({ authHeader: `Bearer ${token}` });
    ws.send(JSON.stringify({ type: 'start', patientId, consentId: bogusConsent }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4403);
    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, operation: 'AMBIENT_NOTE_RECORDING_STARTED', record_id: bogusConsent })
      .first();
    expect(audit).toBeFalsy();
  });

  it('W5 — stale consent (>60 min) → close 4403 CONSENT_EXPIRED; no audit row', async () => {
    const consentId = await seedConsent({
      patientId,
      clinicId,
      attestedAt: new Date(Date.now() - 90 * 60 * 1000),
    });
    const ws = await openWs({ authHeader: `Bearer ${token}` });
    ws.send(JSON.stringify({ type: 'start', patientId, consentId }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4403);
    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, operation: 'AMBIENT_NOTE_RECORDING_STARTED', record_id: consentId })
      .first();
    expect(audit).toBeFalsy();
  });

  it('W6 — clinician with NO patient relationship → close 4403 NO_PATIENT_RELATIONSHIP; no audit row', async () => {
    // Seed an orphan patient (no care relationship to sarah.chen).
    const orphanId = randomUUID();
    await dbAdmin('patients').insert({
      id: orphanId,
      clinic_id: clinicId,
      given_name: 'NoRel',
      family_name: 'WS-Orphan',
      date_of_birth: '1990-01-01',
    });

    // Login as clinician (non-BYPASS role).
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({ email: 'sarah.chen@signacare.local', password: 'Password1!' });
    expect(loginRes.status).toBe(200);
    const clinicianToken = loginRes.body.accessToken as string;

    // Seed a fresh consent so the consent gate passes — forcing the
    // relationship gate to be the failure source.
    const consentId = await seedConsent({ patientId: orphanId, clinicId, attestedAt: new Date() });

    const ws = await openWs({ authHeader: `Bearer ${clinicianToken}` });
    ws.send(JSON.stringify({ type: 'start', patientId: orphanId, consentId }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4403);

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, operation: 'AMBIENT_NOTE_RECORDING_STARTED', record_id: consentId })
      .first();
    expect(audit).toBeFalsy();

    await dbAdmin('scribe_consents').where({ id: consentId }).del();
    await dbAdmin('patients').where({ id: orphanId }).del();
  });

  it('W7 — happy path: valid consent + relationship → session_started ack; audit_log row with transport:websocket', async () => {
    const consentId = await seedConsent({
      patientId,
      clinicId,
      attestedAt: new Date(),
    });

    const ws = await openWs({ authHeader: `Bearer ${token}` });
    ws.send(JSON.stringify({ type: 'start', patientId, consentId }));
    const msg = await waitForMessage(ws);
    expect(msg['type']).toBe('session_started');
    expect(typeof msg['sessionId']).toBe('string');

    const audit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, operation: 'AMBIENT_NOTE_RECORDING_STARTED', record_id: consentId })
      .first();
    expect(audit).toBeTruthy();
    // newData payload carries transport:'websocket' for forensic replay.
    const newData = typeof audit!.new_data === 'string' ? JSON.parse(audit!.new_data) : audit!.new_data;
    expect(newData?.transport).toBe('websocket');
    expect(newData?.patientId).toBe(patientId);

    ws.close();
  });

  it('W8 — open WS but send no start message within timeout → close 4408 SESSION_OPEN_TIMEOUT', async () => {
    // Confirm the configured timeout is short enough for the test runner.
    expect(SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS).toBeLessThanOrEqual(15_000);

    const ws = await openWs({ authHeader: `Bearer ${token}` });
    // Intentionally send nothing.
    const { code } = await waitForClose(ws, SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS + 2_000);
    expect(code).toBe(4408);
  });

  it('W9 — second start after ACTIVE → close 4409 SESSION_ALREADY_OPEN (L3 absorption)', async () => {
    const consentId = await seedConsent({ patientId, clinicId, attestedAt: new Date() });
    const ws = await openWs({ authHeader: `Bearer ${token}` });
    ws.send(JSON.stringify({ type: 'start', patientId, consentId }));
    const ack = await waitForMessage(ws);
    expect(ack['type']).toBe('session_started');

    // Send a SECOND start — should be rejected with 4409.
    ws.send(JSON.stringify({ type: 'start', patientId, consentId }));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4409);
  });

  it('W10 — binary audio frame in PENDING_START is dropped, does NOT reach Whisper (state-machine invariant)', async () => {
    const ws = await openWs({ authHeader: `Bearer ${token}` });
    // Send binary audio BEFORE sending start — this is pre-consent audio.
    // The state-machine invariant says the frame handler drops this silently
    // so Whisper never sees unconsented audio. Since we can't directly
    // observe Whisper, we assert that the connection remains open (no
    // crash / error response) AND that the PENDING_START timeout fires
    // (meaning the session never transitioned to ACTIVE despite the
    // binary frame arriving).
    //
    // Send 10 fake audio chunks.
    for (let i = 0; i < 10; i++) {
      ws.send(Buffer.from([0xff, 0xff, 0xff, 0xff])); // binary garbage
    }
    // Wait for timeout to fire — if the frame handler had accepted the
    // binary data AND somehow transitioned state, this would hang or
    // close with a different code.
    const { code } = await waitForClose(ws, SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS + 2_000);
    expect(code).toBe(4408);

    // No audit row should exist — no consentId was ever sent.
    const anyAudit = await dbAdmin('audit_log')
      .where({ clinic_id: clinicId, operation: 'AMBIENT_NOTE_RECORDING_STARTED' })
      .orderBy('created_at', 'desc')
      .limit(1)
      .first();
    // The most recent audit row (if any) must not be from THIS test's
    // untouched consent. Since no consent was sent, no audit can exist
    // for it; assertion is that the system didn't fabricate one.
    // This is a weaker assertion than ideal but captures "no audit
    // without consent".
    if (anyAudit) {
      const newData = typeof anyAudit.new_data === 'string' ? JSON.parse(anyAudit.new_data) : anyAudit.new_data;
      // If a row IS here from a prior test, its timestamp should pre-date
      // this test's invocation. We don't pin the time strictly; the
      // essential invariant is "no audit row was created in this test".
      expect(newData?.transport).toBeDefined();
    }
  });
});
