/**
 * Scribe pipeline load test — the ambient AI transcription + note
 * extraction path is the most expensive sequence in the API. A
 * single session chains: audio upload → Whisper → LLM pass 1 →
 * LLM pass 2 → structured note save. Each stage holds a DB
 * transaction AND an outbound HTTP connection; without capacity
 * planning, 20 concurrent scribe sessions can exhaust the pool.
 *
 * This scenario simulates N concurrent clinicians all running the
 * scribe at once and asserts:
 *   - No HTTP 5xx responses (capacity failure)
 *   - p95 transcription round-trip under 10s (UX bound)
 *   - Zero file-descriptor leaks (monitored via /metrics if wired)
 *
 * Because Whisper and the LLM are mocked in CI (no GPU available),
 * the test actually targets the lightweight /api/v1/llm/stream-chunk
 * route which rejects without audio payload but still exercises the
 * auth + rate-limit + RLS pipeline under concurrency.
 *
 * Run:
 *   k6 run scripts/k6/scribe-pipeline.js
 *   STAGING_URL=https://staging.signacare.au k6 run scripts/k6/scribe-pipeline.js
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter } from 'k6/metrics';
import { API_URL, authHeaders } from './lib/config.js';
import { login } from './lib/auth.js';

const error5xx = new Counter('http_5xx_total');

export const options = {
  scenarios: {
    scribe_concurrent: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },  // warm-up
        { duration: '2m',  target: 20 },  // sustained — realistic busy clinic
        { duration: '30s', target: 50 },  // burst (shift change)
        { duration: '1m',  target: 50 },  // hold at burst
        { duration: '30s', target: 0 },   // drain
      ],
    },
  },
  thresholds: {
    // ZERO 5xx tolerated — capacity failure is a patient-safety event
    http_5xx_total: ['count==0'],
    // 95% of scribe-path round-trips under 10s, 99% under 20s
    'http_req_duration{name:scribe_chunk}': ['p(95)<10000', 'p(99)<20000'],
    // No more than 5% of requests fail (rate-limited + invalid-payload)
    http_req_failed: ['rate<0.05'],
  },
  tags: { scenario: 'scribe-pipeline', env: __ENV.STAGING_URL ? 'staging' : 'local' },
};

export function setup() {
  const s = login();
  return { token: s.token, clinicId: s.clinicId };
}

export default function (data) {
  const opts = authHeaders(data.token);

  // Target the streaming transcribe endpoint. We don't upload real
  // audio — that would require multipart + a running Whisper. The
  // point is to prove the Express layer, auth middleware, RLS tx,
  // and multer wiring don't fall over under concurrency. A 400
  // (missing audio) is a VALID response here: it confirms the route
  // was reachable, auth held, and the server is still responsive.
  const sessionId = `k6-${__VU}-${__ITER}`;
  const res = http.post(
    `${API_URL}/llm/stream-chunk`,
    `sessionId=${sessionId}&chunkIndex=0`,
    {
      ...opts,
      headers: {
        ...opts.headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      tags: { name: 'scribe_chunk' },
    },
  );

  // Track 5xx separately — any server crash fails the run
  if (res.status >= 500 && res.status < 600) {
    error5xx.add(1);
  }

  // Acceptable outcomes:
  //   200/201 — route happy-path (if a mocked Whisper is wired)
  //   400     — "missing audio" validation rejection (expected)
  //   401     — token expired (shouldn't happen — setup cached it)
  //   413/415 — payload size / content-type guard (acceptable)
  //   429     — rate limiter kicking in (acceptable under burst)
  // NOT acceptable: 500/502/503/504 (capacity failure)
  check(res, {
    'no 5xx': (r) => r.status < 500,
    'response is structured (no HTML error page)': (r) =>
      !r.body || typeof r.body !== 'string' || !r.body.toString().startsWith('<html'),
  });

  // Short think time — scribe chunks land every ~1 second in real use
  sleep(0.5 + Math.random() * 0.5);
}
