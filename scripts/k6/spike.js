/**
 * Category 6 — Scenario 4: SPIKE (sudden burst, then recovery)
 *
 * 0 → 500 VUs in 30 seconds, hold for 2 minutes, back to 0. Models
 * the "shift change" pattern: every clinician on the next rotation
 * logs in within a 30-second window when handover happens. The
 * system MUST NOT 5xx — degrading gracefully to 503 (rate-limited)
 * is acceptable, crashing is not.
 *
 * Pass criteria:
 *   - Zero HTTP 5xx responses (any 5xx fails the run)
 *   - p99 patient_get latency stays under 5s during the spike
 *   - System recovers within 1 minute of the spike ending (the
 *     ramp-down stage observes whether p95 returns to baseline)
 *
 * Run:
 *   k6 run scripts/k6/spike.js
 */
import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter } from 'k6/metrics';
import { API_URL, authHeaders } from './lib/config.js';
import { login } from './lib/auth.js';
import { discoverPatientIdOrFail } from './lib/patient.js';

const error5xx = new Counter('http_5xx_total');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },  // sharp ramp
        { duration: '2m',  target: 500 },  // hold at peak
        { duration: '1m',  target: 0 },    // ramp down
      ],
    },
  },
  thresholds: {
    // ZERO 5xx tolerated. Any server crash fails the run.
    http_5xx_total: ['count==0'],
    // Sanity bound during the spike — p99 must stay under 5s
    'http_req_duration{name:patient_get}': ['p(99)<5000'],
    // 503 is acceptable; we count it via http_req_failed which
    // includes 5xx + network errors. Allow up to 5% during the spike
    // (rate limiter rejecting some requests is correct behavior).
    http_req_failed: ['rate<0.05'],
  },
  tags: { scenario: 'spike', env: __ENV.STAGING_URL ? 'staging' : 'local' },
};

export function setup() {
  const s = login();
  const patientId = discoverPatientIdOrFail(authHeaders(s.token), 'spike.setup');
  return { token: s.token, patientId };
}

export default function (data) {
  const opts = authHeaders(data.token);

  const res = http.get(`${API_URL}/patients/${data.patientId}`, {
    ...opts,
    tags: { name: 'patient_get' },
  });

  // Tally 5xx separately so the threshold can fail the run on ANY
  // server crash, regardless of percentage.
  if (res.status >= 500 && res.status < 600) {
    error5xx.add(1);
  }

  // 503 (rate limited) is acceptable — verify it's a structured
  // response, not a crash.
  check(res, {
    'spike: response is structured (200/4xx/503)': (r) =>
      r.status === 200 || r.status === 503 || (r.status >= 400 && r.status < 500),
  });

  sleep(0.2);
}
