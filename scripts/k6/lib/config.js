/**
 * Category 6 — Shared k6 configuration: SLA thresholds + base URL +
 * test-fixture credentials. Imported by every scenario script under
 * scripts/k6/ so the SLAs live in exactly one place.
 *
 * SLA thresholds map 1:1 to the targets in the prompt — they're
 * enforced as `thresholds:` in each k6 scenario, which means the
 * test process exits with a non-zero code on breach (perfect for CI).
 *
 * The thresholds are tagged per-endpoint via http_req_duration{name=...}
 * so a single test run can prove that, e.g., GET /patients/:id is
 * within p95<300ms while GET /fhir/Patient/:id is within p95<3000ms,
 * even though both come out of the same overall histogram.
 */

// Base URL — defaults to a local dev API. Override in CI / staging:
//   STAGING_URL=https://staging.signacare.au k6 run scripts/k6/load.js
//
// NEVER set this to production. Load tests against a live patient-
// data instance are a clinical-safety incident.
export const BASE_URL = __ENV.STAGING_URL || __ENV.K6_BASE_URL || 'http://localhost:4000';
export const API_PATH = '/api/v1';
export const API_URL = `${BASE_URL}${API_PATH}`;

// Seeded admin from apps/api/src/seed-demo*.ts. The same credentials
// every other test suite uses (Category 2 helpers, e2e fixtures).
// Override in CI via K6_TEST_USER / K6_TEST_PASS.
export const TEST_USER = __ENV.K6_TEST_USER || 'admin@signacare.local';
export const TEST_PASS = __ENV.K6_TEST_PASS || 'Password1!';

// ────────────────────────────────────────────────────────────────────
// SLA thresholds (per-endpoint p95 latency in ms + global error rate)
// ────────────────────────────────────────────────────────────────────
//
// These match the targets in the Category 6 prompt. They are emitted
// as k6 `thresholds:` so a breach fails the run (exit code 99). The
// `name` tag set on each request below is what makes per-endpoint
// scoping possible inside one merged histogram.
export const SLA = {
  // Patient record load: p95 < 300ms
  patient_get:        ['p(95)<300'],
  // Clinical note save: p95 < 500ms
  note_post:          ['p(95)<500'],
  // Medication list: p95 < 200ms
  medication_list:    ['p(95)<200'],
  // Login: p95 < 400ms
  login:              ['p(95)<400'],
  // Episode list: p95 < 250ms
  episode_list:       ['p(95)<250'],
  // Patient search: p95 < 500ms
  patient_search:     ['p(95)<500'],
  // File upload: p95 < 2000ms
  file_upload:        ['p(95)<2000'],
  // FHIR export: p95 < 3000ms
  fhir_export:        ['p(95)<3000'],
};

// Global thresholds applied to every scenario:
//   - error rate < 0.1% across all endpoints
//   - 99th percentile request duration < 5s (sanity bound)
export const GLOBAL_THRESHOLDS = {
  http_req_failed:   ['rate<0.001'],
  http_req_duration: ['p(99)<5000'],
  // Per-endpoint thresholds tagged via {name:"..."} in the request opts:
  'http_req_duration{name:patient_get}':     SLA.patient_get,
  'http_req_duration{name:note_post}':       SLA.note_post,
  'http_req_duration{name:medication_list}': SLA.medication_list,
  'http_req_duration{name:login}':           SLA.login,
  'http_req_duration{name:episode_list}':    SLA.episode_list,
  'http_req_duration{name:patient_search}':  SLA.patient_search,
  'http_req_duration{name:file_upload}':     SLA.file_upload,
  'http_req_duration{name:fhir_export}':     SLA.fhir_export,
};

/**
 * Standard request headers for an authenticated call. The Bearer
 * token comes from setup() in each scenario.
 */
export function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-CSRF-Token': 'k6-load-test',
      'Content-Type': 'application/json',
    },
  };
}
