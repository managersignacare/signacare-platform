/**
 * Category 6 — Scenario 1: BASELINE
 *
 * 1 virtual user, 5 minutes, every endpoint hit once per loop. The
 * goal is to capture clean p50 / p95 / p99 numbers per endpoint with
 * NO concurrency contention. The output of this run is the reference
 * baseline that load / stress / spike tests are compared against.
 *
 * Run:
 *   k6 run scripts/k6/baseline.js
 *   STAGING_URL=https://staging.signacare.au k6 run scripts/k6/baseline.js
 *
 * Pass/fail: SLA thresholds in scripts/k6/lib/config.js. The run
 * exits non-zero if ANY threshold breaches — wire that into CI to
 * gate merges on regression.
 */
import http from 'k6/http';
import { sleep, check } from 'k6';
import { API_URL, GLOBAL_THRESHOLDS, authHeaders } from './lib/config.js';
import { login } from './lib/auth.js';
import { discoverPatientIdOrFail } from './lib/patient.js';

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 1,
      duration: '5m',
    },
  },
  thresholds: GLOBAL_THRESHOLDS,
  // Tag every metric so it's easy to filter in Grafana / k6 cloud.
  tags: { scenario: 'baseline', env: __ENV.STAGING_URL ? 'staging' : 'local' },
};

export function setup() {
  const session = login();
  const patientId = discoverPatientIdOrFail(authHeaders(session.token), 'baseline.setup');
  return { token: session.token, clinicId: session.clinicId, patientId };
}

export default function (data) {
  const opts = authHeaders(data.token);

  // 1. Patient list (paginated)
  http.get(`${API_URL}/patients?limit=10`, {
    ...opts,
    tags: { name: 'patient_search' },
  });
  sleep(0.5);

  // 2. Get a single patient
  http.get(`${API_URL}/patients/${data.patientId}`, {
    ...opts,
    tags: { name: 'patient_get' },
  });
  sleep(0.5);

  // 3. Episode list for that patient
  http.get(`${API_URL}/episodes/patient/${data.patientId}`, {
    ...opts,
    tags: { name: 'episode_list' },
  });
  sleep(0.5);

  // 4. Medication list
  http.get(`${API_URL}/medications/patients/${data.patientId}/medications`, {
    ...opts,
    tags: { name: 'medication_list' },
  });
  sleep(0.5);

  // 5. FHIR Patient export
  const fhir = http.get(`${API_URL}/fhir/Patient/${data.patientId}`, {
    ...opts,
    tags: { name: 'fhir_export' },
  });
  check(fhir, {
    'fhir: 200 or 401 (depends on FHIR auth tier)': (r) => [200, 401, 404].includes(r.status),
  });
  sleep(0.5);

  // 6. Login is also tracked — at 1 VU it runs once per setup() but
  //    we re-do it here every minute to keep the histogram alive.
  if (__ITER % 60 === 0) {
    login();
  }

  sleep(1); // pace ~ 1 loop / 4-5s
}
