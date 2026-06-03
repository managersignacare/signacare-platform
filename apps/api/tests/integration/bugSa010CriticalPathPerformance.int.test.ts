import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

function percentile95(valuesMs: number[]): number {
  if (valuesMs.length === 0) return 0;
  const sorted = [...valuesMs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? 0;
}

function isRetryableTransportParseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes('Parse Error: Expected HTTP/, RTSP/ or ICE/');
}

async function getWithTransportRetry(
  token: string,
  path: string,
  attempt = 1,
): Promise<request.Response> {
  try {
    return await request(app)
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test');
  } catch (err) {
    if (attempt >= 2 || !isRetryableTransportParseError(err)) {
      throw err;
    }
    return getWithTransportRetry(token, path, attempt + 1);
  }
}

async function measureEndpointP95(
  token: string,
  path: string,
  iterations = 8,
): Promise<{ p95: number; samples: number[] }> {
  const samples: number[] = [];

  // Warm-up call so one-time middleware/cache setup does not skew the baseline.
  const warmup = await getWithTransportRetry(token, path);
  expect(warmup.status).toBe(200);

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    const res = await getWithTransportRetry(token, path);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    expect(res.status).toBe(200);
    samples.push(elapsedMs);
  }

  return { p95: percentile95(samples), samples };
}

describe.skipIf(!READY)('BUG-SA-010 — critical-path performance baseline (dashboard/allocation)', () => {
  test('critical-path endpoints stay within bounded p95 latency envelopes', async () => {
    const session = await loginAsAdmin();
    const token = session.token;

    const clinicianDashboard = await measureEndpointP95(token, '/api/v1/dashboard/clinician');
    const teamScopes = await measureEndpointP95(token, '/api/v1/dashboard/team/scopes');
    const plannedTransitions = await measureEndpointP95(token, '/api/v1/staff-settings/transitions');
    const pendingReallocations = await measureEndpointP95(token, '/api/v1/reallocations/pending');

    // Emit measured baseline so the closure evidence can pin real numbers, not just boolean asserts.
    // eslint-disable-next-line no-console
    console.info('BUG-SA-010 baseline p95 (ms)', {
      dashboardClinician: Number(clinicianDashboard.p95.toFixed(2)),
      dashboardTeamScopes: Number(teamScopes.p95.toFixed(2)),
      staffTransitions: Number(plannedTransitions.p95.toFixed(2)),
      reallocationsPending: Number(pendingReallocations.p95.toFixed(2)),
    });

    // SA-010 baseline gates: fail loudly on large regressions (N+1 / join blowups).
    expect(clinicianDashboard.p95).toBeLessThan(1200);
    expect(teamScopes.p95).toBeLessThan(1200);
    expect(plannedTransitions.p95).toBeLessThan(1400);
    expect(pendingReallocations.p95).toBeLessThan(1400);
  });
});
