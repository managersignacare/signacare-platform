// apps/api/src/mcp/scribeAudioRetention.ts
//
// Audit Tier 5.13 — proof-gated scribe-audio retention policy.
//
// Clinic admins pick one of:
//   - `immediate_delete` (default) — audio deleted as soon as the
//     transcript is produced. Safest; satisfies most privacy
//     principles out of the box.
//   - `24h` / `7d` / `30d` / `90d` — audio retained for the window
//     to support clinician re-listening, quality review, or
//     medico-legal evidence. These windows are structurally blocked
//     unless clinic_settings carries ADR evidence + clinical safety
//     review evidence + approver metadata. A background cleanup job
//     deletes files whose `created_at + window` has lapsed.
//
// This module exposes the policy lookup + the retention-decision
// recording that streamingTranscribeRoutes uses to stamp audit
// metadata on every scribe session.

import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { db, dbAdmin } from '../db/db';
import { blobStorage, buildBlobStorageForBackend, type BlobBackendName } from '../shared/blobStorage';

export type ScribeAudioRetention =
  | 'immediate_delete'
  | '24h'
  | '7d'
  | '30d'
  | '90d';

export function retentionToMs(policy: ScribeAudioRetention): number {
  switch (policy) {
    case 'immediate_delete': return 0;
    case '24h':  return 24 * 60 * 60 * 1000;
    case '7d':   return 7 * 24 * 60 * 60 * 1000;
    case '30d':  return 30 * 24 * 60 * 60 * 1000;
    case '90d':  return 90 * 24 * 60 * 60 * 1000;
  }
}

export function isScribeAudioRetention(value: unknown): value is ScribeAudioRetention {
  return value === 'immediate_delete'
    || value === '24h'
    || value === '7d'
    || value === '30d'
    || value === '90d';
}

function hasRetentionOverrideProof(row: {
  scribe_audio_retention_adr?: unknown;
  scribe_audio_retention_clinical_review?: unknown;
  scribe_audio_retention_approved_by_staff_id?: unknown;
  scribe_audio_retention_approved_at?: unknown;
}): boolean {
  return typeof row.scribe_audio_retention_adr === 'string'
    && row.scribe_audio_retention_adr.trim().length >= 6
    && typeof row.scribe_audio_retention_clinical_review === 'string'
    && row.scribe_audio_retention_clinical_review.trim().length >= 10
    && typeof row.scribe_audio_retention_approved_by_staff_id === 'string'
    && row.scribe_audio_retention_approved_by_staff_id.length > 0
    && row.scribe_audio_retention_approved_at != null;
}

function isBlobBackendName(value: unknown): value is BlobBackendName {
  return value === 'local' || value === 's3' || value === 'azure-blob';
}

export async function getRetentionForClinic(clinicId: string): Promise<ScribeAudioRetention> {
  try {
    const row = await db('clinic_settings')
      .where({ clinic_id: clinicId })
      .first(
        'scribe_audio_retention',
        'scribe_audio_retention_adr',
        'scribe_audio_retention_clinical_review',
        'scribe_audio_retention_approved_by_staff_id',
        'scribe_audio_retention_approved_at',
      );
    const v = row?.scribe_audio_retention as ScribeAudioRetention | undefined;
    if ((v === '24h' || v === '7d' || v === '30d' || v === '90d') && row && hasRetentionOverrideProof(row)) return v;
    if (v && v !== 'immediate_delete') {
      logger.warn(
        { clinicId, configuredRetention: v },
        'scribeAudioRetention: non-immediate retention ignored because ADR/clinical safety review proof is missing',
      );
    }
    return 'immediate_delete';
  } catch {
    return 'immediate_delete';
  }
}

/**
 * Background cleanup entrypoint — called from a cron or BullMQ job.
 * Walks every clinic with a non-immediate retention policy and
 * deletes audio files in its retained-audio directory that are older
 * than the policy window.
 *
 * This module does NOT itself place files into a retained-audio
 * directory — the current pipeline routes audio through `os.tmpdir()`
 * which the OS purges opportunistically. When a clinic flips the
 * policy to a retention window, streamingTranscribeRoutes must be
 * updated (follow-up item) to move the completed session's audio to
 * `process.env.SCRIBE_AUDIO_DIR/<clinicId>/<sessionId>.webm`. Until
 * that follow-up lands, the `immediate_delete` default holds and
 * this cleanup is a no-op.
 */
export async function runAudioRetentionCleanup(): Promise<{
  clinicsChecked: number;
  filesDeleted: number;
}> {
  const rootDir = process.env.SCRIBE_AUDIO_DIR;
  if (!rootDir) {
    logger.info('scribeAudioRetention: SCRIBE_AUDIO_DIR unset — retention cleanup is a no-op');
    return { clinicsChecked: 0, filesDeleted: 0 };
  }
  const clinics = await db('clinic_settings')
    .whereNot({ scribe_audio_retention: 'immediate_delete' })
    .select('clinic_id', 'scribe_audio_retention');
  let filesDeleted = 0;
  for (const c of clinics) {
    const policy = c.scribe_audio_retention as ScribeAudioRetention;
    const windowMs = retentionToMs(policy);
    const clinicDir = path.join(rootDir, String(c.clinic_id));
    let entries: string[] = [];
    try {
      entries = await fs.readdir(clinicDir);
    } catch {
      continue;  // no directory for this clinic yet
    }
    const cutoff = Date.now() - windowMs;
    for (const entry of entries) {
      const p = path.join(clinicDir, entry);
      try {
        const stat = await fs.stat(p);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fs.unlink(p);
          filesDeleted += 1;
          logger.info({ clinicId: c.clinic_id, file: entry, policy }, 'scribeAudioRetention: deleted expired audio');
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), path: p },
          'scribeAudioRetention: cleanup error on file',
        );
      }
    }
  }
  return { clinicsChecked: clinics.length, filesDeleted };
}

interface AsyncScribeAudioRetentionRow {
  id: string;
  clinic_id: string;
  staff_id: string | null;
  status: string;
  audio_storage_key: string;
  audio_storage_backend: string | null;
  audio_retention_policy: string | null;
  queued_at: Date | string | null;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
}

interface AsyncScribeAudioPurgeStats {
  scanned: number;
  deleted: number;
  retained: number;
  errors: number;
}

function retentionBaseTime(row: AsyncScribeAudioRetentionRow): number {
  const raw = row.completed_at ?? row.failed_at ?? row.queued_at;
  const parsed = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveAsyncRetentionPolicy(row: AsyncScribeAudioRetentionRow): Promise<ScribeAudioRetention> {
  if (isScribeAudioRetention(row.audio_retention_policy)) return row.audio_retention_policy;
  return getRetentionForClinic(row.clinic_id);
}

/**
 * Purge expired async-scribe audio from the blob facade.
 *
 * The legacy file cleanup above walks `SCRIBE_AUDIO_DIR`; async scribe jobs
 * store audio via `blobStorage` and stamp the durable `ai_job_runs` row. This
 * DB-driven cleanup is therefore the source of truth for long-running Azure
 * deployments: expired rows are deleted through the recorded backend and
 * stamped with `audio_deleted_at` as deletion proof.
 */
export async function purgeExpiredAsyncScribeAudioBlobs(
  now: Date = new Date(),
  limit = 100,
): Promise<AsyncScribeAudioPurgeStats> {
  const rows = await dbAdmin('ai_job_runs')
    .where({ action: 'ambient-audio' })
    .whereNull('deleted_at')
    .whereNotNull('audio_storage_key')
    .whereNull('audio_deleted_at')
    .whereIn('status', ['completed', 'failed', 'cancelled'])
    .orderBy('queued_at', 'asc')
    .limit(limit)
    .select<AsyncScribeAudioRetentionRow[]>(
      'id',
      'clinic_id',
      'staff_id',
      'status',
      'audio_storage_key',
      'audio_storage_backend',
      'audio_retention_policy',
      'queued_at',
      'completed_at',
      'failed_at',
    );

  const stats: AsyncScribeAudioPurgeStats = {
    scanned: rows.length,
    deleted: 0,
    retained: 0,
    errors: 0,
  };

  for (const row of rows) {
    const policy = await resolveAsyncRetentionPolicy(row);
    const baseTime = retentionBaseTime(row);
    const expiresAt = baseTime + retentionToMs(policy);
    if (policy !== 'immediate_delete' && (!baseTime || now.getTime() < expiresAt)) {
      stats.retained += 1;
      continue;
    }

    try {
      const backend = isBlobBackendName(row.audio_storage_backend)
        ? row.audio_storage_backend
        : blobStorage.backendName;
      const storage = backend === blobStorage.backendName
        ? blobStorage
        : buildBlobStorageForBackend(backend);
      await storage.delete(row.audio_storage_key);
      await dbAdmin('ai_job_runs')
        .where({ id: row.id, clinic_id: row.clinic_id })
        .whereNull('deleted_at')
        .update({
          audio_retention_policy: policy,
          audio_deleted_at: now,
          updated_at: now,
        });
      stats.deleted += 1;
      logger.info(
        { clinicId: row.clinic_id, jobId: row.id, policy, backend },
        'scribeAudioRetention: deleted expired async scribe audio blob',
      );
    } catch (err) {
      stats.errors += 1;
      logger.warn(
        { err, clinicId: row.clinic_id, jobId: row.id, policy, backend: row.audio_storage_backend },
        'scribeAudioRetention: async scribe audio blob cleanup failed',
      );
    }
  }

  return stats;
}
