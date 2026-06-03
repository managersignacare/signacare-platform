/**
 * Category 6 — Scenario 3: STRESS (find the breaking point)
 *
 * Ramp from 0 to 1000 VUs over 10 minutes. The goal is NOT to pass
 * SLAs at 1000 VUs (that would mean we provisioned for 5x the
 * realistic peak); the goal is to RECORD the VU count at which the
 * first SLA breach occurs and the VU count at which error rate
 * crosses 1%.
 *
 * Run:
 *   k6 run scripts/k6/stress.js
 *
 * Reading the result:
 *   - Look at the per-stage iteration_duration trend
 *   - The first stage where http_req_duration{name:patient_get} p95
 *     crosses 300ms is your headroom ceiling. Provision capacity for
 *     1.5x the peak observed traffic on that ceiling.
 *   - http_req_failed > 1% is your hard ceiling — beyond this, the
 *     app is shedding requests, not just slowing down.
 *
 * Note: this scenario does NOT enforce SLA thresholds (they would
 * trip immediately at high VU counts and obscure the data). It
 * enforces only the global error-rate cap (10%) so a runaway crash
 * still aborts the run.
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { API_URL, authHeaders } from './lib/config.js';
import { login } from './lib/auth.js';
import { discoverPatientIdOrFail } from './lib/patient.js';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m',  target: 100 },
        { duration: '1m',  target: 200 },
        { duration: '1m',  target: 400 },
        { duration: '1m',  target: 600 },
        { duration: '1m',  target: 800 },
        { duration: '2m',  target: 1000 },  // hold at peak
        { duration: '3m',  target: 0 },     // ramp down
      ],
    },
  },
  thresholds: {
    // Hard cap — abort the run if errors exceed 10% (system is dead)
    http_req_failed: ['rate<0.10'],
    // Soft observation threshold (won't fail the run, just emits a
    // warning in the summary)
    'http_req_duration{name:patient_get}': [
      { threshold: 'p(95)<300', abortOnFail: false },
    ],
  },
  tags: { scenario: 'stress', env: __ENV.STAGING_URL ? 'staging' : 'local' },
};

export function setup() {
  const s = login();
  const patientId = discoverPatientIdOrFail(authHeaders(s.token), 'stress.setup');
  return { token: s.token, patientId };
}

export default function (data) {
  const opts = authHeaders(data.token);

  // Stress scenario hammers the read path — the most common
  // production failure mode is "DB pool exhausted on a flood of
  // patient detail reads", not write contention.
  http.get(`${API_URL}/patients/${data.patientId}`, {
    ...opts,
    tags: { name: 'patient_get' },
  });

  // No artificial think time — we WANT to find the ceiling.
  sleep(0.1);
}
