// tests/auth.test.ts — Authentication flow tests
import { describe, it, expect } from 'vitest';
import { isLiveServerReachable, TEST_API_BASE } from './helpers/liveServer';

const BASE = TEST_API_BASE;
const LIVE = await isLiveServerReachable();

async function api(method: string, path: string, body?: unknown, cookies?: string) {
  const headers: Record<string, string> = { 'X-CSRF-Token': 'test', 'Content-Type': 'application/json' };
  if (cookies) headers['Cookie'] = cookies;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

describe.skipIf(!LIVE)('Authentication', () => {
  it('rejects requests without auth token', async () => {
    const { status } = await api('GET', '/patients');
    expect(status).toBe(401);
  });

  it('rejects forged JWT tokens', async () => {
    const { status } = await api('GET', '/patients', undefined, 'signacare_access=invalid.jwt.token');
    expect(status).toBe(401);
  });

  it('rejects requests without CSRF token on mutations', async () => {
    // Login first to get cookies
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' },
      body: JSON.stringify({ email: 'admin@signacare.local', password: 'Password1!' }),
    });
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');

    // POST without CSRF token
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookies },
      body: JSON.stringify({ title: 'test', priority: 'low' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 401 for expired tokens', async () => {
    const { status } = await api('GET', '/patients', undefined,
      'signacare_access=eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImZha2UiLCJleHAiOjF9.x');
    expect(status).toBe(401);
  });
});

describe.skipIf(!LIVE)('FHIR Authentication', () => {
  it('allows unauthenticated access to /fhir/metadata', async () => {
    const res = await fetch(`${BASE}/fhir/metadata`);
    expect(res.status).toBe(200);
  });

  it('blocks unauthenticated access to /fhir/Patient', async () => {
    const res = await fetch(`${BASE}/fhir/Patient`);
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!LIVE)('Input Sanitization', () => {
  it('strips HTML tags from patient names (XSS prevention)', async () => {
    // Login
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' },
      body: JSON.stringify({ email: 'admin@signacare.local', password: 'Password1!' }),
    });
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    const cookies = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');

    const res = await fetch(`${BASE}/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test', Cookie: cookies },
      body: JSON.stringify({
        givenName: '<script>alert(1)</script>Test',
        familyName: 'XSSTest',
        dateOfBirth: '1990-01-01',
        gender: 'male',
      }),
    });
    const data = await res.json();
    if (res.status === 201) {
      expect(data.givenName).not.toContain('<script>');
    }
    // 409 is also acceptable (duplicate)
    expect([201, 409]).toContain(res.status);
  });
});
