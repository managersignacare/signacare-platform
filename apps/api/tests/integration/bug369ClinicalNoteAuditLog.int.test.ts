/**
 * BUG-369 — clinical-note mutations MUST write audit_log rows.
 *
 * HIPAA §164.312(b) requires a forensic audit trail separate from
 * the restore/undo ledger. Prior to the fix, clinicalNoteService
 * wrote to `clinical_note_versions` (restore) but NOT `audit_log`
 * (forensic). A clinical-incident investigation had no way to
 * answer "who edited note N, when, from where".
 *
 * This test drives each of the 5 mutation methods (create / update /
 * sign / amend / softDelete) through the HTTP router and asserts
 * a matching audit_log row with action IN (NOTE_CREATE, NOTE_UPDATE,
 * NOTE_SIGN, NOTE_AMEND, NOTE_SOFT_DELETE) + correct clinic_id +
 * staff_id + table_name='clinical_notes' + record_id = note.id.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { drainAuditOutbox } from '../../src/shared/auditOutbox';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let patientId = '';
let episodeId = '';

const TEST_TAG = `BUG-369-${Date.now()}`;

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();

  patientId = randomUUID();
  episodeId = randomUUID();

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Note',
    family_name: TEST_TAG,
    emr_number: TEST_TAG,
    date_of_birth: '1990-01-01',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_type: 'triage',
    presenting_problem: TEST_TAG,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterAll(async () => {
  if (!READY) return;
  // audit_log is append-only by design; never delete forensic rows in cleanup.
  await dbAdmin('clinical_note_versions').whereRaw(`snapshot::text ILIKE ?`, [`%${TEST_TAG}%`]).del();
  await dbAdmin('clinical_notes').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
  await dbAdmin('episodes').where({ id: episodeId }).del();
  await dbAdmin('patients').where({ id: patientId }).del();
});

async function createNote(content: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/clinical-notes/')
    .set('Authorization', `Bearer ${session.token}`)
    .set('X-Client', 'mobile')
    .send({
      patientId,
      episodeId,
      noteType: 'soap',
      content,
      noteDateTime: new Date().toISOString(),
    });
  if (res.status !== 201) {
    throw new Error(`create note failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return (res.body.note?.id ?? res.body.id) as string;
}

async function auditRowsFor(noteId: string, action: string): Promise<Array<Record<string, unknown>>> {
  return dbAdmin('audit_log')
    .where({
      clinic_id: session.clinicId,
      table_name: 'clinical_notes',
      record_id: noteId,
      operation: action,
    })
    .select('*');
}

async function waitForAuditRows(noteId: string, action: string): Promise<Array<Record<string, unknown>>> {
  let rows = await auditRowsFor(noteId, action);
  if (rows.length > 0) return rows;

  // BUG-283 durable path: when sync write times out, rows can land via outbox replay.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await drainAuditOutbox(200);
    await sleep(20);
    rows = await auditRowsFor(noteId, action);
    if (rows.length > 0) return rows;
  }
  return rows;
}

describe.skipIf(!READY)('BUG-369 — clinical-note mutations write audit_log rows', () => {
  it('NOTE_CREATE audit row written on POST /clinical-notes/', async () => {
    const noteId = await createNote(`${TEST_TAG}-create`);
    const rows = await waitForAuditRows(noteId, 'NOTE_CREATE');
    expect(rows.length).toBe(1);
    expect(rows[0].staff_id).toBe(session.userId);
    expect(rows[0].clinic_id).toBe(session.clinicId);
  });

  it('NOTE_UPDATE audit row written on PATCH /clinical-notes/:id', async () => {
    const noteId = await createNote(`${TEST_TAG}-update-base`);
    const res = await request(app)
      .patch(`/api/v1/clinical-notes/${noteId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({ content: `${TEST_TAG}-update-new` });
    if (res.status !== 200) {
      throw new Error(`update note failed ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const rows = await waitForAuditRows(noteId, 'NOTE_UPDATE');
    expect(rows.length).toBe(1);
    expect(rows[0].staff_id).toBe(session.userId);
  });

  it('NOTE_SIGN audit row written on POST /clinical-notes/:id/sign (same-author)', async () => {
    const noteId = await createNote(`${TEST_TAG}-sign-base`);
    const res = await request(app)
      .post(`/api/v1/clinical-notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({});
    if (res.status !== 200) throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
    const rows = await waitForAuditRows(noteId, 'NOTE_SIGN');
    expect(rows.length).toBe(1);
    expect(rows[0].staff_id).toBe(session.userId);
    // L4 absorb: cross-author path uses a distinct action literal
    const crossRows = await auditRowsFor(noteId, 'NOTE_CROSS_AUTHOR_SIGN');
    expect(crossRows.length).toBe(0);
  });

  it('NOTE_AMEND audit row written on POST /clinical-notes/:id/amend', async () => {
    const noteId = await createNote(`${TEST_TAG}-amend-base`);
    // Must be signed before amend
    await request(app)
      .post(`/api/v1/clinical-notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({});
    const res = await request(app)
      .post(`/api/v1/clinical-notes/${noteId}/amend`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        patientId,
        episodeId,
        noteType: 'soap',
        content: `${TEST_TAG}-amend-new`,
        noteDateTime: new Date().toISOString(),
      });
    if (res.status !== 201) throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
    const rows = await waitForAuditRows(noteId, 'NOTE_AMEND');
    expect(rows.length).toBe(1);
    expect(rows[0].staff_id).toBe(session.userId);
  });

  it('NOTE_SOFT_DELETE audit row written on DELETE /clinical-notes/:id', async () => {
    const noteId = await createNote(`${TEST_TAG}-del`);
    const res = await request(app)
      .delete(`/api/v1/clinical-notes/${noteId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile');
    if (res.status !== 204) throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
    const rows = await waitForAuditRows(noteId, 'NOTE_SOFT_DELETE');
    expect(rows.length).toBe(1);
    expect(rows[0].staff_id).toBe(session.userId);
  });
});
