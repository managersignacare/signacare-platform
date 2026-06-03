// apps/api/src/mcp/scribeAudioRetention.ts
//
// Audit Tier 5.13 — configurable scribe-audio retention policy.
//
// Clinic admins pick one of:
//   - `immediate_delete` (default) — audio deleted as soon as the
//     transcript is produced. Safest; satisfies most privacy
//     principles out of the box.
//   - `24h` / `7d` / `30d` / `90d` — audio retained for the window
//     to support clinician re-listening, quality review, or
//     medico-legal evidence. A background cleanup job deletes files
//     whose `created_at + window` has lapsed.
//
// This module exposes the policy lookup + the retention-decision
// recording that streamingTranscribeRoutes uses to stamp audit
// metadata on every scribe session.

import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { db } from '../db/db';

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

export async function getRetentionForClinic(clinicId: string): Promise<ScribeAudioRetention> {
  try {
    const row = await db('clinic_settings')
      .where({ clinic_id: clinicId })
      .select('scribe_audio_retention')
      .first();
    const v = row?.scribe_audio_retention as ScribeAudioRetention | undefined;
    if (v === '24h' || v === '7d' || v === '30d' || v === '90d') return v;
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
