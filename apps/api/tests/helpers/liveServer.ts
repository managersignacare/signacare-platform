/**
 * Live-server probe for integration tests.
 *
 * The api-endpoints, auth, and clinical-workflows suites hit a real
 * running API at TEST_API_URL (default http://localhost:4000/api/v1).
 * In CI and on local `pnpm test` runs there is no live server, so the
 * suites should skip cleanly rather than fail with ECONNREFUSED.
 *
 * Usage:
 *   const live = await isLiveServerReachable();
 *   describe.skipIf(!live)('My suite', () => { ... });
 */
export const TEST_API_BASE = process.env.TEST_API_URL ?? 'http://localhost:4000/api/v1';

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function isLiveServerReachable(timeoutMs = 500): Promise<boolean> {
  // /health is mounted at the app root, not under /api/v1
  const root = TEST_API_BASE.replace(/\/api\/v1\/?$/, '');

  const healthRes = await fetchWithTimeout(
    `${root}/health`,
    { method: 'GET' },
    timeoutMs,
  );
  if (!healthRes?.ok) return false;

  // Route-level probe: ensure auth pipeline responds promptly.
  // Use a synthetic email to avoid mutating real accounts.
  const authProbeRes = await fetchWithTimeout(
    `${TEST_API_BASE}/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test', 'X-Client': 'mobile' },
      body: JSON.stringify({
        email: 'probe@signacare.invalid',
        password: 'invalid-password',
      }),
    },
    Math.max(1000, timeoutMs * 2),
  );

  // A healthy auth stack should reject probe credentials quickly.
  // 401 = expected invalid credentials, 429 = responsive but rate-limited.
  return authProbeRes?.status === 401 || authProbeRes?.status === 429;
}
