// tests/clinical-workflows.test.ts — Clinical data integrity tests
import { describe, it, expect, beforeAll } from 'vitest';
import { isLiveServerReachable, TEST_API_BASE } from './helpers/liveServer';

const BASE = TEST_API_BASE;
const LIVE = await isLiveServerReachable();
let bearerToken = '';

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test', 'X-Client': 'mobile' },
    body: JSON.stringify({ email: 'admin@signacare.local', password: 'Password1!' }),
  });
  const data = await res.json().catch(() => null);
  bearerToken = data?.accessToken ?? '';
  return res.status;
}

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'X-CSRF-Token': 'test',
    'Content-Type': 'application/json',
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe.skipIf(!LIVE)('Clinical Workflows', () => {
  beforeAll(async () => {
    const status = await login();
    expect(status).toBe(200);
  });

  it('Lists patients', async () => {
    const { status, data } = await api('GET', '/patients?limit=5');
    expect(status).toBe(200);
    expect(data).toBeDefined();
  });

  it('Creates and retrieves a nursing assessment', async () => {
    // Get a patient
    const { data: patientData } = await api('GET', '/patients?limit=1');
    const patientId = patientData?.data?.[0]?.id;
    if (!patientId) return; // Skip if no patients

    // Create NEWS2
    const { status } = await api('POST', '/nursing-assessments', {
      patientId,
      assessmentType: 'news2',
      data: { respRate: 18, spo2: 97, systolicBp: 120, heartRate: 76, consciousness: 'alert', temperature: 36.8 },
      totalScore: 2,
    });
    expect(status).toBe(201);

    // Retrieve
    const { status: listStatus, data: listData } = await api('GET', `/nursing-assessments?patientId=${patientId}`);
    expect(listStatus).toBe(200);
    expect(listData?.data?.length).toBeGreaterThan(0);
  });

  it('Creates a clinical note', async () => {
    const { data: patientData } = await api('GET', '/patients?limit=1');
    const patientId = patientData?.data?.[0]?.id;
    if (!patientId) return;

    const { data: episodes } = await api('GET', `/episodes/patient/${patientId}`);
    const episodeId = episodes?.data?.[0]?.id ?? episodes?.[0]?.id;

    const { status, data } = await api('POST', `/patients/${patientId}/notes`, {
      episodeId,
      noteType: 'progress',
      content: 'Integration test note — clinical workflow verification.',
    });
    expect(status).toBe(201);
    expect(data?.note?.id ?? data?.id).toBeDefined();
  });

  it('Retrieves risk assessments', async () => {
    const { data: patientData } = await api('GET', '/patients?limit=1');
    const patientId = patientData?.data?.[0]?.id;
    if (!patientId) return;

    const { status } = await api('GET', `/patients/${patientId}/risk-assessments`);
    expect(status).toBe(200);
  });

  it('Retrieves medications', async () => {
    const { data: patientData } = await api('GET', '/patients?limit=1');
    const patientId = patientData?.data?.[0]?.id;
    if (!patientId) return;

    const { status } = await api('GET', `/medications/patients/${patientId}/medications`);
    expect(status).toBe(200);
  });

  it('Retrieves bed board', async () => {
    const { status } = await api('GET', '/beds/board');
    expect(status).toBe(200);
  });

  it('Retrieves shift handovers', async () => {
    const { status } = await api('GET', '/shift-handovers');
    expect(status).toBe(200);
  });

  it('Retrieves templates', async () => {
    const { status } = await api('GET', '/templates');
    expect(status).toBe(200);
  });
});
