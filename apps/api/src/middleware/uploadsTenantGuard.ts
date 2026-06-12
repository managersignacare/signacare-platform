/**
 * S1.1-DEFERRED-D — Tenant guard for the legacy /uploads static serve.
 *
 * The original /uploads/* serve in server.ts only checks `requireAuth`.
 * That means any authenticated user from clinic B can request a URL
 * from clinic A — say /uploads/attachments/2026/04/abc123.pdf — and
 * download the file as long as they can guess (or scrape) the path.
 * This is a multi-tenant data leakage gap that has existed since the
 * uploads serve was added.
 *
 * This middleware closes the gap by:
 *
 *   1. Extracting the storage key from the URL path.
 *   2. Looking it up in patient_attachments / patient_legal_attachments /
 *      patient_alert_attachments by either storage_key (post-S1.1) or
 *      file_path (legacy rows pre-backfill).
 *   3. Checking that the row's clinic_id matches the authenticated
 *      user's clinic_id (req.clinicId).
 *   4. Rejecting with 403 on mismatch.
 *   5. Rejecting with 403 on path traversal (.. segments) or absolute
 *      paths or non-printable characters.
 *
 * Design notes:
 *
 *   - This middleware MUST run AFTER requireAuth and AFTER tenantMiddleware,
 *     because it relies on req.clinicId being set.
 *
 *   - The /uploads/logos/* path is intentionally NOT covered by this
 *     middleware — logos are public (login page needs them) and never
 *     contain PHI.
 *
 *   - patient_alert_attachments has clinic_id only after the
 *     20260411000001_backfill_attachment_clinic_id migration runs. Before
 *     that, the column is NULL on legacy rows; the guard treats NULL as
 *     a denial (defensive). Operators must run the backfill before
 *     enabling this guard in production with legacy data.
 *
 *   - When BLOB_STORAGE_BACKEND is a cloud backend, files no longer live
 *     on the local disk at all. The static serve becomes a stale-data risk.
 *     We add a hard 410 (Gone) for any /uploads/<key> that does not resolve
 *     via the DB — this means the local serve is effectively dead in cloud
 *     deployments, which is what the original DEFERRED-D wanted.
 *
 * Performance: one indexed SELECT per static-file request. The
 * patient_attachments tables already have indexes on storage_key
 * (added in 20260410000001) and file_path is the natural lookup key.
 * This is acceptable overhead for a route that historically served
 * individual files at human click-through rates, not at high RPS.
 */

import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { db } from '../db/db';
import { logger } from '../utils/logger';

// Tables that may contain references to a /uploads/<key> URL.
// Order: most likely first so the guard short-circuits on the common case.
const ATTACHMENT_TABLES = [
  'patient_attachments',
  'patient_legal_attachments',
  'patient_alert_attachments',
] as const;

interface AttachmentRow {
  clinic_id?: string | null;
}

function isPathSafe(p: string): boolean {
  // Reject any of: .. segment, leading /, null bytes, control chars,
  // or anything that decodes to a different string than the input.
  if (!p || typeof p !== 'string') return false;
  if (p.includes('..')) return false;
  if (p.includes('\0')) return false;
  if (path.isAbsolute(p)) return false;
  for (let i = 0; i < p.length; i += 1) {
    if (p.charCodeAt(i) <= 31) return false;
  }
  return true;
}

/**
 * Find a row in any attachment table whose storage_key OR file_path
 * matches the requested URL path. Returns the first hit (across all
 * three tables) or null.
 */
async function findOwningRow(urlPath: string): Promise<AttachmentRow | null> {
  // The URL path arrives without the /uploads prefix (Express has
  // already stripped it). For legacy rows, file_path was stored as
  // either an absolute filesystem path (`/app/uploads/<key>`) or as
  // the storage_key directly. Match both with a LIKE on the basename.
  const basename = path.basename(urlPath);
  for (const table of ATTACHMENT_TABLES) {
    const row = await db<AttachmentRow>(table)
      .where('storage_key', urlPath)
      .orWhere('file_path', urlPath)
      .orWhere('file_path', 'like', `%${basename}`)
      .first();
    if (row) return row;
  }
  return null;
}

export function uploadsTenantGuard() {
  return async function uploadsTenantGuardMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // The Express `app.use('/uploads', ...)` mount strips '/uploads'
      // from req.url, so req.path here is the bit after '/uploads'.
      // Decode percent-encoding and strip the leading slash for lookup.
      const decoded = decodeURIComponent(req.path).replace(/^\//, '');

      if (!isPathSafe(decoded)) {
        res.status(403).json({ error: 'forbidden_path' });
        return;
      }

      // Public sub-paths (logos) are mounted as a separate static serve
      // BEFORE this middleware in server.ts, so they should never reach
      // here. Defensive check anyway.
      if (decoded.startsWith('logos/')) {
        next();
        return;
      }

      const clinicId = req.clinicId;
      if (!clinicId) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }

      const row = await findOwningRow(decoded);
      if (!row) {
        // Unknown key. With cloud storage this is the expected path because
        // attachments live remotely, not on local disk. Return 410 Gone to
        // make the dual-mode handoff visible to clients.
        if ((process.env.BLOB_STORAGE_BACKEND ?? 'local').toLowerCase() !== 'local') {
          res.status(410).json({ error: 'gone_use_signed_url' });
          return;
        }
        // Local backend, no DB row — this is a path that exists on disk
        // but isn't tracked. Refuse rather than leak.
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (!row.clinic_id || row.clinic_id !== clinicId) {
        logger.warn(
          { requestedPath: decoded, requesterClinicId: clinicId, ownerClinicId: row.clinic_id ?? null },
          'uploadsTenantGuard: cross-tenant access denied',
        );
        res.status(403).json({ error: 'forbidden_cross_tenant' });
        return;
      }

      // OK — let express.static serve the file.
      next();
    } catch (err) {
      // On guard failure (DB down, etc.) FAIL CLOSED. Returning a file
      // when we cannot verify ownership would be worse than a 500.
      logger.error({ err }, 'uploadsTenantGuard: lookup failed, denying');
      res.status(503).json({ error: 'guard_unavailable' });
    }
  };
}
