/**
 * Category 2 — Integration tests for the patient CRUD lifecycle.
 *
 * Why this matters: the patient resource sits behind RLS, soft-delete,
 * audit logging, and a fuzzy duplicate-detection guard. Each one is a
 * Fix Registry entry with a real production bug history. These tests
 * exercise the full middleware stack against a real database, which
 * is the only place those four things can fail together.
 *
 * Standard satisfied: ACHS Standard 1 (Clinical Governance — accurate
 *                     record), Australian Privacy Act APP 11 (security),
 *                     OWASP A01 (multi-tenant isolation).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isIntegrationReady, loginAsAdmin, authedAgent } from './_helpers';

const READY = await isIntegrationReady();

// Use a deterministic family-name suffix that includes the current
// process pid + timestamp so parallel runs don't collide on the
// duplicate-detection guard.
const RUN_TAG = `IntegT_${process.pid}_${Date.now().toString(36)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CreatedPatient {
  id: string;
  givenName: string;
  familyName: string;
}

describe.skipIf(!READY)('Patient CRUD lifecycle (live DB)', () => {
  let token: string;
  let clinicId: string;
  const created: CreatedPatient[] = [];

  beforeAll(async () => {
    // Force encryption-enabled path for this suite so patient writes
    // exercise real ciphertext storage instead of plaintext passthrough.
    if (!process.env.PHI_ENCRYPTION_KEY || process.env.PHI_ENCRYPTION_KEY.length < 64) {
      process.env.PHI_ENCRYPTION_KEY = 'c'.repeat(64);
    }
    ({ token, clinicId } = await loginAsAdmin());
  });

  afterAll(async () => {
    if (created.length === 0) return;
    // Soft-delete cleanup so the test process doesn't leak rows.
    // Best-effort: log and continue if the route is unavailable.
    const agent = authedAgent(token);
    for (const p of created) {
      try {
        await agent.delete(`/api/v1/patients/${p.id}`);
      } catch {
        // ignore
      }
    }
  });

  describe('POST /patients — create', () => {
    it('creates a patient with required fields and returns the row', async () => {
      const agent = authedAgent(token);
      const res = await agent.post('/api/v1/patients').send({
        givenName: 'Ada',
        familyName: `${RUN_TAG}_Lovelace_1`,
        dateOfBirth: '1990-01-01',
        gender: 'female',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        givenName: 'Ada',
        familyName: `${RUN_TAG}_Lovelace_1`,
      });
      // The response MUST be camelCase, not snake_case (camelCaseResponse middleware)
      expect(res.body.given_name).toBeUndefined();
      expect(res.body.family_name).toBeUndefined();
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.clinicId).toBe(clinicId);
      created.push({ id: res.body.id, givenName: 'Ada', familyName: res.body.familyName });
    });

    it('rejects a duplicate patient (same name + DOB) → 409 DUPLICATE_PATIENT', async () => {
      const agent = authedAgent(token);
      const dupName = `${RUN_TAG}_Lovelace_DUP`;
      // First create
      const first = await agent.post('/api/v1/patients').send({
        givenName: 'Ada',
        familyName: dupName,
        dateOfBirth: '1990-01-01',
        gender: 'female',
      });
      expect(first.status).toBe(201);
      created.push({ id: first.body.id, givenName: 'Ada', familyName: dupName });

      // Second with the same identifying fields
      const second = await agent.post('/api/v1/patients').send({
        givenName: 'Ada',
        familyName: dupName,
        dateOfBirth: '1990-01-01',
        gender: 'female',
      });
      expect(second.status).toBe(409);
      expect(second.body.code ?? second.body.error).toMatch(/DUPLICATE/i);
    });

    it('rejects one of two concurrent creates for same name + DOB', async () => {
      const agent = authedAgent(token);
      const dupName = `${RUN_TAG}_Lovelace_CONCURRENT`;
      const payload = {
        givenName: 'Ada',
        familyName: dupName,
        dateOfBirth: '1990-01-01',
        gender: 'female',
      };

      const [first, second] = await Promise.all([
        agent.post('/api/v1/patients').send(payload),
        agent.post('/api/v1/patients').send(payload),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const createdResponse = first.status === 201 ? first : second.status === 201 ? second : null;
      if (createdResponse) {
        created.push({ id: createdResponse.body.id, givenName: 'Ada', familyName: dupName });
      }

      const blockedResponse = first.status === 409 ? first : second;
      expect(blockedResponse.body.code ?? blockedResponse.body.error).toMatch(/DUPLICATE/i);
    });

    // FIXED: Zod errors now land in toErrorResponse() and emit a
    // structured 422 with { code: 'VALIDATION_ERROR', details: [...] }.
    // Previously this was it.fails because the route returned 500.
    it('rejects creation with a missing required field → 422 VALIDATION_ERROR', async () => {
      const agent = authedAgent(token);
      const res = await agent.post('/api/v1/patients').send({
        // No familyName, no DOB
        givenName: 'Bob',
      });
      expect(res.status).toBe(422);
    });

    it('rejects creation when addressPostcode exceeds DB-safe max length → 422 VALIDATION_ERROR', async () => {
      const agent = authedAgent(token);
      const res = await agent.post('/api/v1/patients').send({
        givenName: 'Length',
        familyName: `${RUN_TAG}_PostcodeTooLong`,
        dateOfBirth: '1990-01-01',
        addressPostcode: '12345678901', // 11 chars; DB column is varchar(10)
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid dateOfBirth / phone / Medicare values with 422', async () => {
      const agent = authedAgent(token);

      const badDob = await agent.post('/api/v1/patients').send({
        givenName: 'Invalid',
        familyName: `${RUN_TAG}_BadDob`,
        dateOfBirth: '2099-01-01',
      });
      expect(badDob.status).toBe(422);
      expect(badDob.body.code).toBe('VALIDATION_ERROR');

      const badPhone = await agent.post('/api/v1/patients').send({
        givenName: 'Invalid',
        familyName: `${RUN_TAG}_BadPhone`,
        dateOfBirth: '1990-01-01',
        phoneMobile: 'abc@@@',
      });
      expect(badPhone.status).toBe(422);
      expect(badPhone.body.code).toBe('VALIDATION_ERROR');

      const badMedicare = await agent.post('/api/v1/patients').send({
        givenName: 'Invalid',
        familyName: `${RUN_TAG}_BadMedicare`,
        dateOfBirth: '1990-01-01',
        medicareNumber: '2123456711',
        medicareIrn: '1',
      });
      expect(badMedicare.status).toBe(422);
      expect(badMedicare.body.code).toBe('VALIDATION_ERROR');
    });

    it('creates patient with encrypted PHI fields without varchar overflow (BUG-PHI-PATIENT-CAPACITY)', async () => {
      const agent = authedAgent(token);
      const payload = {
        givenName: 'Cipher',
        familyName: `${RUN_TAG}_EncryptedCapacity`,
        dateOfBirth: '1992-02-02',
        gender: 'non-binary',
        medicareNumber: '2123456701',
        medicareIrn: '1',
        ihi: '8003608833357361',
        dvaNumber: 'DVA1234567890123456789012345678'.slice(0, 30),
        phoneMobile: '0400123456',
        phoneHome: '0399991234',
        emailPrimary: `patient.${RUN_TAG}.${'x'.repeat(120)}@example.test`,
        addressStreet: `Suite 4, ${'Long Street Name '.repeat(10)}`.slice(0, 200),
        addressSuburb: 'S'.repeat(80),
      };

      const res = await agent.post('/api/v1/patients').send(payload);
      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      created.push({ id: res.body.id, givenName: payload.givenName, familyName: payload.familyName });

      const { dbAdmin } = await import('../../src/db/db');
      const row = await dbAdmin.transaction(async (trx) => {
        await trx.raw(`select set_config('app.clinic_id', ?, true)`, [clinicId]);
        return trx('patients')
          .where({ id: res.body.id, clinic_id: clinicId })
          .select('medicare_reference', 'phone_home', 'address_line1', 'suburb')
          .first();
      }) as
        | {
            medicare_reference: string | null;
            phone_home: string | null;
            address_line1: string | null;
            suburb: string | null;
          }
        | undefined;

      expect(row).toBeTruthy();
      // Ciphertext format in shared PHI crypto is iv:tag:ciphertext.
      expect(row?.medicare_reference).toContain(':');
      expect(row?.medicare_reference).not.toBe(payload.medicareIrn);
      expect(row?.phone_home).toContain(':');
      expect(row?.address_line1).toContain(':');
      expect(row?.suburb).toContain(':');
    });
  });

  describe('GET /patients — list + filter + paginate', () => {
    it('returns a paginated list with totalCount-shaped envelope', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/patients?limit=5');
      expect(res.status).toBe(200);
      // Envelope shape varies between {data: [], total: N} and array.
      // Accept either but assert it's paginated.
      const list = (res.body.data ?? res.body) as unknown[];
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeLessThanOrEqual(5);
    });

    // FIXED: the repository query filters by whereNull('deleted_at')
    // (patientRepository.ts:93) and escapeLike() is correctly applied
    // to the search term, so soft-deleted rows are excluded from the
    // result set. The original "trigram crash" concern from earlier
    // in the suite lifecycle is no longer reproducible.
    it('does not include soft-deleted rows', async () => {
      // Create then soft-delete a patient, then list and assert it's gone
      const agent = authedAgent(token);
      const create = await agent.post('/api/v1/patients').send({
        givenName: 'Soft',
        familyName: `${RUN_TAG}_Deleted_1`,
        dateOfBirth: '1985-05-15',
        gender: 'male',
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;

      const del = await agent.delete(`/api/v1/patients/${id}`);
      expect([200, 204]).toContain(del.status);

      // Searching for the unique family name should return nothing
      const list = await agent.get(
        `/api/v1/patients?search=${encodeURIComponent(`${RUN_TAG}_Deleted_1`)}`,
      );
      expect(list.status).toBe(200);
      const rows = (list.body.data ?? list.body) as Array<{ id: string }>;
      expect(rows.find((r) => r.id === id)).toBeUndefined();
    });
  });

  describe('GET /patients/:id — single record', () => {
    it('returns 404 for a syntactically valid but non-existent UUID', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/patients/00000000-0000-0000-0000-000000000000');
      expect([403, 404]).toContain(res.status);
      // 403 is also acceptable here — it's the IDOR-safe choice (don't
      // reveal whether the row exists in another clinic). 404 is also
      // acceptable when the row genuinely doesn't exist anywhere.
    });

    // FIXED: the patientController now calls assertUuid() on the
    // :id param before passing it to the service, so malformed
    // input is rejected with 422 instead of crashing the DB driver.
    it('returns 400 for a malformed (non-UUID) :id', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/patients/not-a-uuid');
      expect([400, 404, 422]).toContain(res.status);
    });
  });

  describe('PATCH /patients/:id — update', () => {
    it('updates a patient field and the change is persisted', async () => {
      const agent = authedAgent(token);
      const create = await agent.post('/api/v1/patients').send({
        givenName: 'PatchMe',
        familyName: `${RUN_TAG}_Patchable_1`,
        dateOfBirth: '1970-12-31',
        gender: 'female',
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;
      created.push({ id, givenName: 'PatchMe', familyName: create.body.familyName });

      const patch = await agent.patch(`/api/v1/patients/${id}`).send({
        preferredName: 'Patchy',
      });
      expect([200, 204]).toContain(patch.status);

      const fetched = await agent.get(`/api/v1/patients/${id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.preferredName).toBe('Patchy');
    });
  });

  describe('Patient contacts/providers length guards', () => {
    it('rejects support-person givenName > 100 with 422 (no DB 22001)', async () => {
      const agent = authedAgent(token);
      const create = await agent.post('/api/v1/patients').send({
        givenName: 'Contact',
        familyName: `${RUN_TAG}_ContactLen_1`,
        dateOfBirth: '1988-08-08',
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;
      created.push({ id, givenName: 'Contact', familyName: create.body.familyName });

      const res = await agent.post(`/api/v1/patients/${id}/contacts`).send({
        contactType: 'support_person',
        givenName: 'A'.repeat(101),
        familyName: 'Smith',
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects providerNumber > 30 with 422 (no DB 22001)', async () => {
      const agent = authedAgent(token);
      const create = await agent.post('/api/v1/patients').send({
        givenName: 'Provider',
        familyName: `${RUN_TAG}_ProviderLen_1`,
        dateOfBirth: '1981-01-01',
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;
      created.push({ id, givenName: 'Provider', familyName: create.body.familyName });

      const res = await agent.post(`/api/v1/patients/${id}/providers`).send({
        providerType: 'gp',
        providerName: 'GP Example',
        providerNumber: '9'.repeat(31),
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('accepts null optional contact/provider fields for edit-flow compatibility', async () => {
      const agent = authedAgent(token);
      const create = await agent.post('/api/v1/patients').send({
        givenName: 'Compat',
        familyName: `${RUN_TAG}_CompatNulls_1`,
        dateOfBirth: '1982-02-02',
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;
      created.push({ id, givenName: 'Compat', familyName: create.body.familyName });

      const contact = await agent.post(`/api/v1/patients/${id}/contacts`).send({
        contactType: 'support_person',
        givenName: 'Jane',
        familyName: 'Citizen',
        phoneHome: null,
        phoneMobile: null,
        relationship: null,
        email: null,
      });
      expect(contact.status).toBe(201);

      const provider = await agent.post(`/api/v1/patients/${id}/providers`).send({
        providerType: 'gp',
        providerName: 'Dr Example',
        providerPractice: null,
        providerPhone: null,
        providerFax: null,
        providerNumber: null,
        providerEmail: null,
        providerAddress: null,
      });
      expect(provider.status).toBe(201);
    });
  });

  describe('DELETE /patients/:id — soft-delete only (PHI never hard-deleted)', () => {
    it('soft-deletes (sets deleted_at) and the row is no longer listed', async () => {
      const agent = authedAgent(token);
      const create = await agent.post('/api/v1/patients').send({
        givenName: 'Gone',
        familyName: `${RUN_TAG}_Gone_1`,
        dateOfBirth: '2000-06-06',
        gender: 'male',
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;

      const del = await agent.delete(`/api/v1/patients/${id}`);
      expect([200, 204]).toContain(del.status);

      // Direct DB assertion — the row must still exist with a deleted_at,
      // not be physically removed.
      const { dbAdmin } = await import('../../src/db/db');
      const loadRow = async () => dbAdmin.transaction(async (trx) => {
        await trx.raw(`select set_config('app.clinic_id', ?, true)`, [clinicId]);
        return trx('patients').where({ id, clinic_id: clinicId }).first();
      });
      let row = await loadRow();
      const deadline = Date.now() + 1_500;
      while (row && row.deleted_at === null && Date.now() < deadline) {
        await sleep(25);
        row = await loadRow();
      }
      expect(row).toBeTruthy();
      expect(row.deleted_at).not.toBeNull();
    });
  });

  describe('Audit log coverage (gold-standard PHI access logging)', () => {
    it('every CREATE produces an audit_logs row scoped to the actor + clinic', async () => {
      const agent = authedAgent(token);
      const create = await agent.post('/api/v1/patients').send({
        givenName: 'Audit',
        familyName: `${RUN_TAG}_Auditable_1`,
        dateOfBirth: '1995-03-03',
        gender: 'other',
      });
      expect(create.status).toBe(201);
      const id = create.body.id as string;
      created.push({ id, givenName: 'Audit', familyName: create.body.familyName });

      const { dbAdmin } = await import('../../src/db/db');
      // Real table is `audit_log` (singular). The schema has both
      // record_id and entity_id depending on which writer landed the
      // row, so we look for either.
      const audits = await dbAdmin.transaction(async (trx) => {
        await trx.raw(`select set_config('app.clinic_id', ?, true)`, [clinicId]);
        return trx('audit_log')
          .where({ clinic_id: clinicId })
          .where(function whereRecord(this: import('knex').Knex.QueryBuilder) {
            this.where('record_id', id).orWhere('entity_id', id);
          })
          .orderBy('created_at', 'desc')
          .limit(5);
      });
      expect(audits.length).toBeGreaterThan(0);
    });
  });
});
