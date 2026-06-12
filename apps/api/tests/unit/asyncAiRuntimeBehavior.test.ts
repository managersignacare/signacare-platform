import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const updateSpy = vi.fn();
const selectSpy = vi.fn();
const firstSpy = vi.fn();
const deleteSpy = vi.fn();

const dbBuilder = {
  where: vi.fn(() => dbBuilder),
  whereNot: vi.fn(() => dbBuilder),
  whereIn: vi.fn(() => dbBuilder),
  whereNull: vi.fn(() => dbBuilder),
  whereNotNull: vi.fn(() => dbBuilder),
  orderBy: vi.fn(() => dbBuilder),
  limit: vi.fn(() => dbBuilder),
  select: selectSpy,
  first: firstSpy,
  update: updateSpy,
};

const dbMock = vi.fn(() => dbBuilder);
const dbAdminMock = vi.fn(() => dbBuilder);

vi.mock('../../src/db/db', () => ({
  db: dbMock,
  dbAdmin: dbAdminMock,
}));

vi.mock('../../src/shared/tenantContext', () => ({
  withTenantContext: async (_clinicId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../src/shared/blobStorage', () => ({
  blobStorage: {
    backendName: 'local',
    delete: deleteSpy,
  },
  buildBlobStorageForBackend: vi.fn(() => ({
    delete: deleteSpy,
  })),
}));

const { updateAiJobRun } = await import('../../src/features/llm/aiJobStore');
const { getRetentionForClinic, purgeExpiredAsyncScribeAudioBlobs } = await import('../../src/mcp/scribeAudioRetention');

describe('Async AI runtime behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectSpy.mockResolvedValue([]);
    firstSpy.mockResolvedValue(undefined);
    updateSpy.mockResolvedValue(1);
    deleteSpy.mockResolvedValue(undefined);
  });

  it('clears stale retry failure fields when a durable AI job completes', async () => {
    await updateAiJobRun('clinic-1', 'job-1', {
      status: 'completed',
      failedAt: null,
      errorCode: null,
      errorMessage: null,
    }, 'staff-1');

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      failed_at: null,
      error_code: null,
      error_message: null,
    }));
  });

  it('deletes expired async scribe audio through blob storage and stamps deletion proof', async () => {
    const now = new Date('2026-06-05T00:00:00.000Z');
    selectSpy.mockResolvedValueOnce([
      {
        id: 'job-expired',
        clinic_id: 'clinic-1',
        staff_id: 'staff-1',
        audio_storage_key: 'audio/2026/05/job-expired.webm',
        audio_storage_backend: 'local',
        audio_retention_policy: '24h',
        queued_at: '2026-06-01T00:00:00.000Z',
        completed_at: '2026-06-01T00:00:00.000Z',
        failed_at: null,
      },
    ]);

    const stats = await purgeExpiredAsyncScribeAudioBlobs(now);

    expect(dbBuilder.whereIn).toHaveBeenCalledWith('status', ['completed', 'failed', 'cancelled']);
    expect(deleteSpy).toHaveBeenCalledWith('audio/2026/05/job-expired.webm');
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      audio_retention_policy: '24h',
      audio_deleted_at: now,
      updated_at: now,
    }));
    expect(stats).toEqual({
      scanned: 1,
      deleted: 1,
      retained: 0,
      errors: 0,
    });
  });

  it('retains non-expired async scribe audio without deleting the blob', async () => {
    const now = new Date('2026-06-05T00:00:00.000Z');
    selectSpy.mockResolvedValueOnce([
      {
        id: 'job-fresh',
        clinic_id: 'clinic-1',
        staff_id: 'staff-1',
        audio_storage_key: 'audio/2026/06/job-fresh.webm',
        audio_storage_backend: 'local',
        audio_retention_policy: '7d',
        queued_at: '2026-06-04T00:00:00.000Z',
        completed_at: '2026-06-04T00:00:00.000Z',
        failed_at: null,
      },
    ]);

    const stats = await purgeExpiredAsyncScribeAudioBlobs(now);

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(stats).toEqual({
      scanned: 1,
      deleted: 0,
      retained: 1,
      errors: 0,
    });
  });

  it('falls back to immediate delete when a retained-audio clinic setting lacks ADR and clinical safety review proof', async () => {
    firstSpy.mockResolvedValueOnce({
      scribe_audio_retention: '7d',
      scribe_audio_retention_adr: null,
      scribe_audio_retention_clinical_review: null,
      scribe_audio_retention_approved_by_staff_id: null,
      scribe_audio_retention_approved_at: null,
    });

    await expect(getRetentionForClinic('clinic-1')).resolves.toBe('immediate_delete');
  });

  it('honours non-immediate retention only when ADR and clinical safety review proof are present', async () => {
    firstSpy.mockResolvedValueOnce({
      scribe_audio_retention: '24h',
      scribe_audio_retention_adr: 'ADR-0042',
      scribe_audio_retention_clinical_review: 'Clinical safety review approved retained audio.',
      scribe_audio_retention_approved_by_staff_id: 'staff-1',
      scribe_audio_retention_approved_at: '2026-06-05T00:00:00.000Z',
    });

    await expect(getRetentionForClinic('clinic-1')).resolves.toBe('24h');
  });

  it('loads and deletes async scribe audio through the backend recorded on the job', () => {
    const workerSource = readFileSync(
      resolve(__dirname, '../../src/jobs/workers/aiWorker.ts'),
      'utf8',
    );

    expect(workerSource).toContain('audioStorageBackend?: BlobBackendName');
    expect(workerSource).toContain('resolveAmbientAudioStorage');
    expect(workerSource).toContain('buildBlobStorageForBackend(recordedBackend)');
    expect(workerSource).toContain('audioStorageBackend: ambientAudioStorageBackendForCleanup');
    expect(workerSource).toContain('const audioStorage = await resolveAmbientAudioStorage(parsed.audioStorageBackend)');
  });
});
