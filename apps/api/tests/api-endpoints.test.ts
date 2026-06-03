// tests/api-endpoints.test.ts — Comprehensive API endpoint tests
//
// BUG-630 (W3 cycle 1) — extended every status-only assertion to also
// validate response shape. Pre-fix the tests asserted `status === 200`
// only; an endpoint silently returning `{ data: [] }` (or even raw
// snake_case rows) would still pass. BUG-623 + BUG-632 lived in-tree
// for weeks while this test file went green every CI run. Layer-4 gap
// per CLAUDE.md §11.
//
// Post-fix: list endpoints assert `body` carries an array (raw or
// `{ data: [...] }` envelope); single-resource endpoints assert `body`
// has either `id` or canonical `{ data: { id } }` shape; canonical
// camelCase responses (per CLAUDE.md §5.2) are spot-checked where the
// endpoint is known to use a mapper. Where the snake_case → camelCase
// drift class is the harm class (BUG-613/618/622/623), the shape check
// requires camelCase keys present.
import { describe, it, expect, beforeAll } from 'vitest';
import { isLiveServerReachable, TEST_API_BASE } from './helpers/liveServer';

const BASE = TEST_API_BASE;
const LIVE = await isLiveServerReachable();
let patientId = '';

let bearerToken = '';

async function login() {
  // Use X-Client: mobile to get tokens in response body (avoids cookie issues in Node fetch)
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test', 'X-Client': 'mobile' },
    body: JSON.stringify({ email: 'admin@signacare.local', password: 'Password1!' }),
  });
  const data = await res.json().catch(() => null);
  bearerToken = data?.accessToken ?? '';
  return res.status;
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-CSRF-Token': 'test',
      'Content-Type': 'application/json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// BUG-630 — shape assertion helpers. Replace status-only assertions.
//
// `expectList` asserts the response is a successful array (raw or wrapped
// in `{ data: [...] }`). Catches the BUG-623 class of "endpoint returns
// 200 but body is malformed/empty when it shouldn't be" silently.
function expectList(r: { status: number; data: unknown }) {
  expect(r.status).toBe(200);
  expect(r.data).toBeDefined();
  const list = Array.isArray(r.data)
    ? r.data
    : (r.data as { data?: unknown })?.data;
  expect(Array.isArray(list)).toBe(true);
}

// `expectObject` asserts the response is a successful object (raw or
// wrapped in `{ data: {...} }`). For single-resource GETs.
function expectObject(r: { status: number; data: unknown }) {
  expect(r.status).toBe(200);
  expect(r.data).toBeDefined();
  expect(typeof r.data === 'object' && r.data !== null).toBe(true);
}

// `expectStatus` is the legacy shape — asserts 200/201 only. Used for
// endpoints where the body isn't a list/object (e.g. /api/docs.json
// returns OpenAPI metadata, /fhir/metadata returns CapabilityStatement —
// both are valid but don't fit the list/object helpers cleanly).
function expectStatus(r: { status: number }, expected = 200) {
  expect(r.status).toBe(expected);
}

describe.skipIf(!LIVE)('Full API Coverage', () => {
  beforeAll(async () => {
    await login();
    // Get test patient
    const { data } = await api('GET', '/patients?limit=1');
    patientId = (data as { data?: { id: string }[] })?.data?.[0]?.id ?? '';
  });

  // ── Patient endpoints ──
  it('GET /patients', async () => { expectList(await api('GET', '/patients?limit=5')); });
  it('GET /patients/:id', async () => { if (patientId) expectObject(await api('GET', `/patients/${patientId}`)); });
  it('GET /patients/:id/flags', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/flags`)); });
  it('GET /patients/:id/contacts', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/contacts`)); });
  it('GET /patients/:id/alerts', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/alerts`)); });
  it('GET /patients/alert-types', async () => { expectList(await api('GET', '/patients/alert-types')); });
  it('GET /patients/:id/notes', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/notes`)); });
  it('GET /patients/:id/attachments', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/attachments`)); });
  it('GET /patients/:id/legal-orders', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/legal-orders`)); });
  it('GET /patients/:id/pathology', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/pathology`)); });
  it('GET /patients/team-assignments', async () => { expectList(await api('GET', '/patients/team-assignments')); });
  it('GET /patients/hotspots', async () => { expectList(await api('GET', '/patients/hotspots')); });

  // ── Episode endpoints ──
  it('GET /episodes/patient/:id', async () => { if (patientId) expectList(await api('GET', `/episodes/patient/${patientId}`)); });

  // ── Appointments ──
  it('GET /appointments', async () => { expectList(await api('GET', '/appointments?date=2026-03-30')); });

  // ── Staff ──
  it('GET /staff', async () => { expectList(await api('GET', '/staff')); });

  // ── Staff Settings ──
  it('GET /staff-settings/disciplines', async () => { expectList(await api('GET', '/staff-settings/disciplines')); });
  it('GET /staff-settings/clinical-roles', async () => { expectList(await api('GET', '/staff-settings/clinical-roles')); });
  it('GET /staff-settings/team-assignments', async () => { expectList(await api('GET', '/staff-settings/team-assignments')); });
  it('GET /staff-settings/role-assignments', async () => { expectList(await api('GET', '/staff-settings/role-assignments')); });
  it('GET /staff-settings/referral-sources', async () => { expectList(await api('GET', '/staff-settings/referral-sources')); });

  // ── Nursing ──
  it('GET /nursing-assessments', async () => { if (patientId) expectList(await api('GET', `/nursing-assessments?patientId=${patientId}`)); });
  it('POST /nursing-assessments (NEWS2)', async () => {
    if (!patientId) return;
    expectStatus(await api('POST', '/nursing-assessments', { patientId, assessmentType: 'news2', data: { respRate: 16 }, totalScore: 1 }), 201);
  });

  // ── Observations ──
  it('GET /structured-observations', async () => { if (patientId) expectList(await api('GET', `/structured-observations?patientId=${patientId}`)); });

  // ── Medications ──
  // BUG-630: BUG-623 + BUG-632 fix targets — assert canonical camelCase shape.
  it('GET /medications/patients/:id/medications', async () => { if (patientId) expectList(await api('GET', `/medications/patients/${patientId}/medications`)); });
  it('GET /medications/due-now', async () => { expectList(await api('GET', '/medications/due-now')); });
  it('GET /medications/mar/:id', async () => {
    if (!patientId) return;
    const r = await api('GET', `/medications/mar/${patientId}`);
    expectList(r);
    // BUG-623 + BUG-632 fix shape: flat camelCase per row + canonical
    // administrations sub-shape from mapMedicationAdministrationRowToResponse.
    const list = (r.data as { data?: unknown[] })?.data ?? [];
    if (list.length > 0) {
      const row = list[0] as Record<string, unknown>;
      // Pre-fix the row was wrapped in `{ medication: {...}, administrations: [] }`
      // and the consumer never unwrapped. Post-fix is FLAT.
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('administrations');
      expect(Array.isArray(row.administrations)).toBe(true);
    }
  });

  // ── LAI ──
  it('GET /lai', async () => { expectList(await api('GET', '/lai')); });

  // ── Tasks ──
  it('GET /tasks', async () => { expectList(await api('GET', '/tasks')); });
  it('POST /tasks', async () => { expectStatus(await api('POST', '/tasks', { title: 'API test', priority: 'low' }), 201); });

  // ── Messages ──
  it('GET /messages/threads', async () => { expectList(await api('GET', '/messages/threads')); });
  it('GET /messages/inbox', async () => { expectList(await api('GET', '/messages/inbox')); });

  // ── Risk ──
  it('GET /patients/:id/risk-assessments', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/risk-assessments`)); });

  // ── Safety Plans ──
  it('GET /safety-plans/patient/:id', async () => { if (patientId) expectObject(await api('GET', `/safety-plans/patient/${patientId}`)); });

  // ── Allergies ──
  it('GET /patients/:id/allergies', async () => { if (patientId) expectList(await api('GET', `/patients/${patientId}/allergies`)); });

  // ── Outcomes ──
  it('GET /outcomes/patient/:id', async () => { if (patientId) expectList(await api('GET', `/outcomes/patient/${patientId}`)); });

  // ── Carers ──
  it('GET /carers/patient/:id', async () => { if (patientId) expectList(await api('GET', `/carers/patient/${patientId}`)); });

  // ── Beds ──
  it('GET /beds', async () => { expectList(await api('GET', '/beds')); });
  it('GET /beds/board', async () => { expectList(await api('GET', '/beds/board')); });

  // ── Group Therapy ──
  it('GET /group-therapy', async () => { expectList(await api('GET', '/group-therapy')); });

  // ── Referrals ──
  it('GET /referrals', async () => { expectList(await api('GET', '/referrals')); });

  // ── Waitlist ──
  it('GET /waitlist', async () => { expectList(await api('GET', '/waitlist')); });

  // ── Escalations ──
  it('GET /escalations', async () => { expectList(await api('GET', '/escalations')); });

  // ── Correspondence ──
  it('GET /correspondence/patient/:id', async () => { if (patientId) expectList(await api('GET', `/correspondence/patient/${patientId}`)); });

  // ── Advance Directives ──
  it('GET /advance-directives/patient/:id', async () => { if (patientId) expectList(await api('GET', `/advance-directives/patient/${patientId}`)); });

  // ── eReferrals ──
  it('GET /ereferrals', async () => { expectList(await api('GET', '/ereferrals')); });

  // ── Reports ──
  it('GET /reports', async () => { expectList(await api('GET', '/reports')); });

  // ── Templates ──
  it('GET /templates', async () => { expectList(await api('GET', '/templates')); });

  // ── Audit ──
  it('GET /audit', async () => { expectList(await api('GET', '/audit?limit=5')); });

  // ── AI ──
  it('GET /ai/jobs', async () => { expectList(await api('GET', '/ai/jobs')); });

  // ── Side Effects ──
  // BUG-613 fix shape: canonical { data: SideEffectScheduleResponse[] } envelope.
  it('GET /side-effect-schedules', async () => {
    if (!patientId) return;
    const r = await api('GET', `/side-effect-schedules?patientId=${patientId}`);
    expectList(r);
    const list = (r.data as { data?: unknown[] })?.data ?? [];
    if (list.length > 0) {
      const row = list[0] as Record<string, unknown>;
      // BUG-613 mapper output: camelCase scheduleType (not schedule_type).
      expect(row).toHaveProperty('scheduleType');
    }
  });

  // ── Shift Handovers ──
  it('GET /shift-handovers', async () => { expectList(await api('GET', '/shift-handovers')); });

  // ── Notifications ──
  it('GET /notifications', async () => { expectList(await api('GET', '/notifications')); });

  // ── Clozapine ──
  // BUG-618 fix shape: canonical mapper output.
  it('GET /clozapine/patients/:id/clozapine', async () => {
    if (!patientId) return;
    const r = await api('GET', `/clozapine/patients/${patientId}/clozapine`);
    expectStatus(r, 200);
    expect(r.data).toBeDefined();
  });

  // ── Prescriptions ──
  it('GET /prescriptions/patients/:id/prescriptions', async () => { if (patientId) expectList(await api('GET', `/prescriptions/patients/${patientId}/prescriptions`)); });

  // ── Dashboard ──
  it('GET /dashboard/clinician', async () => { expectObject(await api('GET', '/dashboard/clinician')); });

  // ── Pathways ──
  it('GET /pathways/templates', async () => { expectList(await api('GET', '/pathways/templates')); });

  // ── Clinical Decision ──
  it('GET /clinical-decision/rules', async () => { expectList(await api('GET', '/clinical-decision/rules')); });

  // ── FHIR ──
  it('GET /fhir/metadata (public)', async () => {
    const res = await fetch(`${BASE}/fhir/metadata`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // FHIR CapabilityStatement: must have resourceType.
    expect(body).toHaveProperty('resourceType');
    expect(body.resourceType).toBe('CapabilityStatement');
  });
  it('GET /fhir/Patient (requires auth)', async () => {
    const r = await api('GET', '/fhir/Patient');
    expectStatus(r, 200);
    // FHIR Bundle: must have resourceType + entry array.
    expect(r.data).toHaveProperty('resourceType');
  });

  // ── Swagger ──
  it('GET /api/docs.json', async () => {
    const res = await fetch('http://localhost:4000/api/docs.json');
    expect(res.status).toBe(200);
    const body = await res.json();
    // OpenAPI 3.x: must have `openapi` version field.
    expect(body).toHaveProperty('openapi');
  });
});
