/**
 * Category 6 — Scenario 2: LOAD (busy clinic morning)
 *
 * 200 virtual users, 10 minutes steady state. Mix:
 *   40% — patient record reads (the bread-and-butter clinical action)
 *   20% — clinical note creates (the most-write-heavy clinical action)
 *   20% — medication list reads
 *   10% — patient search
 *   10% — login / logout cycling
 *
 * SLAs are enforced via thresholds — the run exits non-zero on any
 * breach, which gates merges in CI.
 *
 * Run:
 *   k6 run scripts/k6/load.js
 *   STAGING_URL=https://staging.signacare.au k6 run scripts/k6/load.js
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { API_URL, GLOBAL_THRESHOLDS, authHeaders } from './lib/config.js';
import { login } from './lib/auth.js';
import { discoverPatientIdOrFail } from './lib/patient.js';

export const options = {
  scenarios: {
    busy_morning: {
      executor: 'constant-vus',
      vus: 200,
      duration: '10m',
    },
  },
  thresholds: GLOBAL_THRESHOLDS,
  tags: { scenario: 'load', env: __ENV.STAGING_URL ? 'staging' : 'local' },
  // Don't drop iterations — we want every VU's load on the system.
  noConnectionReuse: false,
};

export function setup() {
  // Single warm login captures one valid token. The 10% login-cycling
  // VUs below will create their own fresh tokens to exercise the auth
  // path under load — those count toward the login SLA.
  const s = login();
  const patientId = discoverPatientIdOrFail(authHeaders(s.token), 'load.setup');
  return { token: s.token, patientId };
}

export default function (data) {
  const opts = authHeaders(data.token);

  // Pick a workflow per the 40/20/20/10/10 mix using a uniform random.
  const r = Math.random();

  if (r < 0.40) {
    // 40% — patient record read
    http.get(`${API_URL}/patients/${data.patientId}`, {
      ...opts,
      tags: { name: 'patient_get' },
    });
  } else if (r < 0.60) {
    // 20% — clinical note create (POST). Body is a small structured
    // SOAP note; the test doesn't worry about idempotency because the
    // load test is intentionally generating churn.
    http.post(
      `${API_URL}/clinical-notes`,
      JSON.stringify({
        patientId: data.patientId,
        noteType: 'soap',
        content: {
          subjective: 'k6 load test note',
          objective: 'BP 120/80, HR 72',
          assessment: 'stable',
          plan: 'continue current management',
        },
      }),
      {
        ...opts,
        tags: { name: 'note_post' },
      },
    );
  } else if (r < 0.80) {
    // 20% — medication list read
    http.get(`${API_URL}/medications/patients/${data.patientId}/medications`, {
      ...opts,
      tags: { name: 'medication_list' },
    });
  } else if (r < 0.90) {
    // 10% — patient search
    const term = ['Smith', 'Johnson', 'Brown', 'Williams', 'Jones'][__ITER % 5];
    http.get(`${API_URL}/patients?search=${term}&limit=20`, {
      ...opts,
      tags: { name: 'patient_search' },
    });
  } else {
    // 10% — login round-trip (the auth path under load)
    login();
  }

  // Realistic clinician pacing — most clicks are 1-3s apart.
  sleep(1 + Math.random() * 2);
}
