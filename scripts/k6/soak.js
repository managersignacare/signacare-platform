/**
 * Category 6 — Scenario 5: SOAK (memory leak detector)
 *
 * 100 virtual users, 2 hours steady state. The point is NOT to
 * measure peak throughput — that's what stress.js is for. The point
 * is to detect:
 *   - Node.js memory leaks (heap size growth over time)
 *   - PG connection pool leaks (Knex pool count drift)
 *   - Redis connection leaks
 *   - BullMQ queue depth growth (if a worker silently dies)
 *
 * The k6 process itself doesn't measure those things — it just
 * generates steady traffic. The OBSERVATION is done by Prometheus
 * scraping /metrics on the API while this scenario runs. Run this
 * with the metrics dashboard open in another tab and watch for
 * monotonic growth in:
 *
 *   process_resident_memory_bytes
 *   nodejs_heap_size_used_bytes
 *   signacare_pg_pool_used
 *   bullmq_queue_depth
 *
 * Pass criterion: at the end of 2h, none of those metrics should be
 * higher than 1.5x their value at the 30-minute mark (steady state).
 *
 * Run:
 *   k6 run scripts/k6/soak.js
 *
 * For shorter local validation, override the duration:
 *   K6_SOAK_DURATION=10m k6 run scripts/k6/soak.js
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { API_URL, GLOBAL_THRESHOLDS, authHeaders } from './lib/config.js';
import { login } from './lib/auth.js';
import { discoverPatientIdOrFail } from './lib/patient.js';

const SOAK_DURATION = __ENV.K6_SOAK_DURATION || '2h';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 100,
      duration: SOAK_DURATION,
    },
  },
  // Soak still respects SLA thresholds — a slow degradation that
  // pushes p95 over budget IS the leak signal we're hunting.
  thresholds: GLOBAL_THRESHOLDS,
  tags: { scenario: 'soak', env: __ENV.STAGING_URL ? 'staging' : 'local' },
};

export function setup() {
  const s = login();
  const patientId = discoverPatientIdOrFail(authHeaders(s.token), 'soak.setup');
  return { token: s.token, patientId };
}

export default function (data) {
  const opts = authHeaders(data.token);

  // Mix that exercises read AND write paths (memory leaks tend to
  // hide in the write path because object retention is more common
  // when state is being mutated).
  http.get(`${API_URL}/patients/${data.patientId}`, {
    ...opts,
    tags: { name: 'patient_get' },
  });
  sleep(0.5);

  http.get(`${API_URL}/medications/patients/${data.patientId}/medications`, {
    ...opts,
    tags: { name: 'medication_list' },
  });
  sleep(0.5);

  // 1-in-20 iterations create a clinical note (writes are heavier
  // and more likely to surface a leak in the audit-write or RLS
  // transaction path).
  if (__ITER % 20 === 0) {
    http.post(
      `${API_URL}/clinical-notes`,
      JSON.stringify({
        patientId: data.patientId,
        noteType: 'soap',
        content: { subjective: 'soak iter ' + __ITER, plan: 'continue' },
      }),
      { ...opts, tags: { name: 'note_post' } },
    );
  }

  // Pace ~1 loop / 3s — typical clinician interaction rhythm
  sleep(2);
}
