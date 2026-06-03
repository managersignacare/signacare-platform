import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  authedAgent,
  isIntegrationReady,
  loginAsClinician,
  loginAsManager,
} from './_helpers';

const READY = await isIntegrationReady();
const CANONICAL_PATIENT_ID = 'b1111111-1111-4111-8111-111111111111';

describe.skipIf(!READY)('messages manager workflow', () => {
  let managerToken = '';
  let clinicianToken = '';
  let clinicianId = '';
  let threadId = '';

  beforeAll(async () => {
    const manager = await loginAsManager();
    const clinician = await loginAsClinician();
    managerToken = manager.token;
    clinicianToken = clinician.token;
    clinicianId = clinician.userId;
  });

  it('manager can load threads and exercise thread-level endpoints', async () => {
    const createThread = await authedAgent(managerToken)
      .post('/api/v1/messages/threads')
      .send({
        subject: `Manager workflow ${randomUUID()}`,
        patientId: CANONICAL_PATIENT_ID,
        participantIds: [clinicianId],
      });
    expect(createThread.status).toBe(201);
    threadId = createThread.body?.id;
    expect(typeof threadId).toBe('string');

    const listActive = await authedAgent(managerToken)
      .get('/api/v1/messages/threads')
      .query({ isArchived: false });
    expect(listActive.status).toBe(200);
    expect(Array.isArray(listActive.body)).toBe(true);
    expect(listActive.body.some((row: { id: string }) => row.id === threadId)).toBe(true);

    const messagesBefore = await authedAgent(managerToken)
      .get(`/api/v1/messages/threads/${threadId}/messages`);
    expect(messagesBefore.status).toBe(200);
    expect(Array.isArray(messagesBefore.body)).toBe(true);

    const send = await authedAgent(managerToken)
      .post(`/api/v1/messages/threads/${threadId}/messages`)
      .send({ body: 'Manager integration test message' });
    expect(send.status).toBe(201);

    const managerUnreadAfterOwnSend = await authedAgent(managerToken)
      .get('/api/v1/messages/unread-count');
    expect(managerUnreadAfterOwnSend.status).toBe(200);
    expect(typeof managerUnreadAfterOwnSend.body?.count).toBe('number');
    expect(managerUnreadAfterOwnSend.body.count).toBeGreaterThanOrEqual(0);

    const clinicianUnread = await authedAgent(clinicianToken)
      .get('/api/v1/messages/unread-count');
    expect(clinicianUnread.status).toBe(200);
    expect(clinicianUnread.body.count).toBeGreaterThanOrEqual(1);

    const markRead = await authedAgent(clinicianToken)
      .patch(`/api/v1/messages/threads/${threadId}/read`);
    expect(markRead.status).toBe(204);

    const clinicianUnreadAfterRead = await authedAgent(clinicianToken)
      .get('/api/v1/messages/unread-count');
    expect(clinicianUnreadAfterRead.status).toBe(200);
    expect(clinicianUnreadAfterRead.body.count).toBe(0);

    const archive = await authedAgent(managerToken)
      .patch(`/api/v1/messages/threads/${threadId}/archive`);
    expect(archive.status).toBe(204);

    const archivedList = await authedAgent(managerToken)
      .get('/api/v1/messages/threads')
      .query({ isArchived: true });
    expect(archivedList.status).toBe(200);
    expect(Array.isArray(archivedList.body)).toBe(true);
    expect(archivedList.body.some((row: { id: string }) => row.id === threadId)).toBe(true);
  });
});
