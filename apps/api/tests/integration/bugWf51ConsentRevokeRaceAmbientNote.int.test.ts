import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import type { Express } from 'express';

const blobMock = vi.hoisted(() => ({
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../../src/shared/blobStorage', () => ({
  blobStorage: {
    put: blobMock.put,
    delete: blobMock.delete,
  },
}));

const ambientMock = vi.hoisted(() => ({
  processAmbientAudio: vi.fn(),
}));
vi.mock('../../src/mcp/ambientProcessor', () => ({
  processAmbientAudio: ambientMock.processAmbientAudio,
}));

const relationshipMock = vi.hoisted(() => ({
  requirePatientRelationship: vi.fn(),
}));
vi.mock('../../src/shared/authGuards', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, requirePatientRelationship: relationshipMock.requirePatientRelationship };
});

const bypassAuditMock = vi.hoisted(() => ({
  writeLlmAccessBypassAudit: vi.fn(),
}));
vi.mock('../../src/shared/writeLlmAccessBypassAudit', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, writeLlmAccessBypassAudit: bypassAuditMock.writeLlmAccessBypassAudit };
});

const verifyMock = vi.hoisted(() => ({
  verifyRecordingConsent: vi.fn(),
}));
vi.mock('../../src/shared/recordingConsent', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, verifyRecordingConsent: verifyMock.verifyRecordingConsent };
});

import { HttpError } from '../../src/shared/errors';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-WF51-CONSENT-REVOKE-RACE — ambient-note fails closed mid-processing', () => {
  let app: Express;
  let token = '';
  let clinicId = '';
  let staffId = '';
  let patientId = '';

  beforeAll(async () => {
    vi.resetModules();
    const appModule = await import('../../src/server');
    app = appModule.default;
    bypassAuditMock.writeLlmAccessBypassAudit.mockResolvedValue(undefined);
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;
    staffId = session.userId;
    const patient = await withTenantContext(
      clinicId,
      async () => dbAdmin('patients').where({ clinic_id: clinicId }).whereNull('deleted_at').first('id'),
      staffId,
    );
    if (!patient?.id) {
      throw new Error('No patient fixture available for BUG-WF51 consent-revoke regression test');
    }
    patientId = patient.id as string;
  });

  beforeEach(() => {
    blobMock.put.mockReset();
    blobMock.delete.mockReset();
    ambientMock.processAmbientAudio.mockReset();
    relationshipMock.requirePatientRelationship.mockReset();
    bypassAuditMock.writeLlmAccessBypassAudit.mockReset();
    verifyMock.verifyRecordingConsent.mockReset();

    blobMock.put.mockResolvedValue({ key: 'audio/test/key.webm', bucket: 'local' });
    blobMock.delete.mockResolvedValue(undefined);
    ambientMock.processAmbientAudio.mockResolvedValue({
      summary: '',
      transcript: 'Transcript content',
      structured: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' },
      medications: [],
      suggestedDiagnosis: [],
    });
    relationshipMock.requirePatientRelationship.mockResolvedValue(undefined);
    bypassAuditMock.writeLlmAccessBypassAudit.mockResolvedValue(undefined);
    verifyMock.verifyRecordingConsent.mockResolvedValue(undefined);
  });

  function postAmbientNote(patientId: string, consentId: string) {
    return request(app)
      .post('/api/v1/llm/ambient-note')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .field('patientId', patientId)
      .field('consentId', consentId)
      .attach('audio', Buffer.alloc(2000, 0x55), {
        filename: 'test.webm',
        contentType: 'audio/webm',
      });
  }

  it('deletes uploaded audio and returns CONSENT_REVOKED when consent becomes inactive after processing', async () => {
    let callCount = 0;
    verifyMock.verifyRecordingConsent.mockImplementation(async () => {
      callCount += 1;
      if (callCount >= 3) {
        throw new HttpError(
          403,
          'CONSENT_REVOKED',
          'Recording consent has been revoked. Capture a fresh consent before recording.',
        );
      }
    });

    const res = await postAmbientNote(patientId, randomUUID());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REVOKED');
    expect(verifyMock.verifyRecordingConsent).toHaveBeenCalledTimes(3);
    expect(blobMock.put).toHaveBeenCalledTimes(1);
    expect(ambientMock.processAmbientAudio).toHaveBeenCalledTimes(1);
    expect(blobMock.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps normal success path when consent remains active across all checkpoints', async () => {
    const res = await postAmbientNote(patientId, randomUUID());
    expect(res.status).toBe(200);
    expect(verifyMock.verifyRecordingConsent).toHaveBeenCalledTimes(3);
    expect(blobMock.put).toHaveBeenCalledTimes(1);
    expect(ambientMock.processAmbientAudio).toHaveBeenCalledTimes(1);
    expect(blobMock.delete).not.toHaveBeenCalled();
  });
});
