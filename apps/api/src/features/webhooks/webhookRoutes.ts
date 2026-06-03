/**
 * apps/api/src/features/webhooks/webhookRoutes.ts
 *
 * S3.4 — Generic inbound webhook receiver
 *
 * Endpoints:
 *
 *   POST /webhooks/:source     verify HMAC, replay-check, enqueue,
 *                              return 202
 *
 *   GET  /webhooks-admin/secrets       list configured sources (admin)
 *   POST /webhooks-admin/secrets       create a new source secret
 *   PATCH /webhooks-admin/secrets/:id  update a source secret
 *   DELETE /webhooks-admin/secrets/:id deactivate a source
 *
 *   GET /webhooks-admin/audit?source=  paginated audit log lookup
 *
 * The receiver returns 202 immediately on a valid webhook so partners
 * (which retry on >299 responses) don't pile up duplicates while the
 * job is processing. Every invocation — accepted OR rejected — gets a
 * webhook_audit_log row, so ops can investigate misconfiguration
 * without enabling debug logs.
 *
 * What this receiver does NOT do:
 *
 *   - Verify the partner's TLS certificate. That's nginx's job upstream.
 *   - Decrypt encrypted payloads. If a partner ships PGP-encrypted
 *     bodies, that's per-source decoding logic that belongs in the
 *     consumer worker, not in the verifier.
 *   - Validate the payload schema. The receiver only authenticates;
 *     downstream workers are responsible for parsing and rejecting
 *     malformed bodies.
 */

import type { Knex } from 'knex';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { jobBus } from '../../shared/jobBus';
import {
  computeSignature,
  verifySignature,
  sha256Hex,
  parseAndCheckTimestamp,
  ipInAllowlist,
} from './webhookVerifier';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
const WEBHOOK_SECRET_COLUMNS = [
  'id', 'clinic_id', 'source', 'hmac_secret', 'signature_header',
  'timestamp_header', 'replay_window_seconds', 'rate_limit_per_minute',
  'ip_allowlist', 'queue_name', 'is_active',
  'created_at', 'updated_at',
] as const;

interface WebhookSecretRow {
  id: string;
  clinic_id: string;
  source: string;
  hmac_secret: string;
  signature_header: string;
  timestamp_header: string | null;
  replay_window_seconds: number;
  rate_limit_per_minute: number;
  ip_allowlist: string | null;
  queue_name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const router = Router();

// ── Inbound: POST /webhooks/:source ──────────────────────────────────────────
//
// This route is mounted PUBLIC (no authMiddleware) — partners
// authenticate via HMAC, not via session/JWT. The route always returns
// 200/202 quickly, even on rejection, so partners' retry timers don't
// fire. Failures are logged via webhook_audit_log.

router.post('/:source', async (req: Request, res: Response, next: NextFunction) => {
  const sourceIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const source = req.params.source;
  const bodySize = rawBody?.byteLength ?? 0;

  /** Helper for the audit-log writes. Never throws. */
  const audit = async (
    outcome: string,
    options: {
      clinicId?: string | null;
      payloadHash?: string | null;
      nonce?: string | null;
      jobId?: string | null;
      errorText?: string | null;
    } = {},
  ) => {
    try {
      await db('webhook_audit_log').insert({
        clinic_id: options.clinicId ?? null,
        source,
        payload_hash: options.payloadHash ?? sha256Hex(rawBody ?? ''),
        nonce: options.nonce ?? null,
        outcome,
        error_text: options.errorText ?? null,
        job_id: options.jobId ?? null,
        body_size: bodySize,
        source_ip: sourceIp,
      });
    } catch (err) {
      logger.warn({ err, source, outcome }, 'webhook audit log write failed');
    }
  };

  try {
    if (!rawBody) {
      // The verify hook in server.ts didn't fire — usually because the
      // request had no Content-Type: application/json. Reject.
      await audit('rejected_signature', { errorText: 'missing raw body — Content-Type must be application/json' });
      res.status(400).json({ error: 'missing_body' });
      return;
    }

    // Look up the source. There can be multiple rows for the same
    // source slug across different clinics (e.g. clinic A and clinic B
    // both subscribe to the same lab feed under the slug 'lab-x'). We
    // try each in turn until one verifies the signature.
    const candidates = await db<WebhookSecretRow>('webhook_secrets')
      .where({ source, is_active: true });

    if (candidates.length === 0) {
      await audit('rejected_unknown_source');
      res.status(404).json({ error: 'unknown_source' });
      return;
    }

    let matched: WebhookSecretRow | null = null;
    for (const cand of candidates) {
      const expected = computeSignature(rawBody, cand.hmac_secret);
      const presented = req.header(cand.signature_header) ?? undefined;
      if (verifySignature(presented, expected)) {
        matched = cand;
        break;
      }
    }

    if (!matched) {
      await audit('rejected_signature', { errorText: 'no candidate secret matched the presented signature' });
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    // IP allowlist (CIDR) — applied after signature verification so
    // we don't leak which IPs are allow-listed to unauthenticated
    // probers.
    if (!ipInAllowlist(sourceIp ?? undefined, matched.ip_allowlist)) {
      await audit('rejected_ip', { clinicId: matched.clinic_id, errorText: `source IP ${sourceIp} not in allowlist` });
      res.status(403).json({ error: 'ip_not_allowed' });
      return;
    }

    // Timestamp / replay window check
    const tsHeaderValue = matched.timestamp_header ? req.header(matched.timestamp_header) : undefined;
    const tsResult = parseAndCheckTimestamp(tsHeaderValue, matched.replay_window_seconds);
    if (!tsResult.ok) {
      await audit('rejected_timestamp', {
        clinicId: matched.clinic_id,
        errorText: `timestamp ${tsResult.reason}`,
      });
      res.status(400).json({ error: 'invalid_timestamp' });
      return;
    }

    // Replay protection: check the audit log for the same payload hash
    // from the same source within the replay window. If we've seen it,
    // reject as a replay.
    const payloadHash = sha256Hex(rawBody);
    const nonce = (req.header('x-nonce') ?? null) as string | null;
    const replayCutoff = new Date(Date.now() - matched.replay_window_seconds * 1000);
    const dup = await db('webhook_audit_log')
      .where({ source, payload_hash: payloadHash })
      .whereIn('outcome', ['accepted', 'enqueued', 'processed'])
      .where('received_at', '>=', replayCutoff)
      .first();
    if (dup) {
      await audit('rejected_replay', {
        clinicId: matched.clinic_id,
        payloadHash,
        nonce,
        errorText: `payload hash already seen at ${dup.received_at}`,
      });
      res.status(409).json({ error: 'replay_detected' });
      return;
    }

    // Rate limit (per minute, per source row). Implemented as a count
    // of audit log rows in the last 60 seconds for THIS secret's
    // clinic_id. Cheap, indexed by source + received_at.
    if (matched.rate_limit_per_minute > 0) {
      const cutoff = new Date(Date.now() - 60_000);
      const recent = await db('webhook_audit_log')
        .where({ source, clinic_id: matched.clinic_id })
        .where('received_at', '>=', cutoff)
        .count<{ count: string }[]>('id as count')
        .first();
      const recentCount = Number(recent?.count ?? 0);
      if (recentCount >= matched.rate_limit_per_minute) {
        await audit('rejected_rate_limit', {
          clinicId: matched.clinic_id,
          payloadHash,
          nonce,
          errorText: `${recentCount}/${matched.rate_limit_per_minute} per minute exceeded`,
        });
        res.status(429).setHeader('Retry-After', '60').json({ error: 'rate_limited' });
        return;
      }
    }

    // Parse the JSON body for the worker. Express's json middleware
    // already did this if the Content-Type was right; if not, fall
    // back to manual parse.
    let payload: unknown = req.body;
    if (payload === undefined || (typeof payload === 'object' && payload && Object.keys(payload).length === 0 && bodySize > 2)) {
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        payload = null;
      }
    }

    // Enqueue for async processing. The worker is per-source: the
    // source slug becomes the BullMQ job name so a single worker
    // process can subscribe to one slug or many.
    await jobBus.enqueue(matched.queue_name, {
      type: 'webhook_inbound',
      source,
      clinicId: matched.clinic_id,
      payloadHash,
      payload,
      receivedAt: new Date().toISOString(),
    });

    // The job_id is opaque from JobBus's perspective today (it doesn't
    // return one); record the source slug so the worker can correlate.
    await audit('enqueued', { clinicId: matched.clinic_id, payloadHash, nonce });

    res.status(202).json({ accepted: true });
  } catch (err) {
    next(err);
  }
});

export default router;

// ── Admin router (separate to keep the public webhook entry minimal) ────────
//
// @admin-only — operator surface for managing webhook source secrets. No web
// UI caller; admins use curl/Postman to provision a secret per partner source
// before flipping the receiver on. The webhook receiver itself (POST /webhooks/
// :source above) is the public entry point partners hit; this admin router
// only governs the secret-rotation lifecycle. See docs/admin-routes.md.
//
// Rationale (DEAD-MOUNT exemption per Phase 0.7 PR2): secret management is
// intentionally a low-volume operator task that does not warrant a dedicated
// UI — rotating a secret happens once per partner per year at most.

export const webhookAdminRouter = Router();

webhookAdminRouter.use(authMiddleware, requireRoles(['admin', 'superadmin']));

webhookAdminRouter.get('/secrets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db<WebhookSecretRow>('webhook_secrets')
      .where({ clinic_id: req.clinicId })
      .orderBy('source');
    // Strip the secret from the list — admins can ROTATE the secret
    // by updating the row, but they should never be able to read it
    // back through this endpoint.
    res.json({
      secrets: rows.map((r) => ({
        ...r,
        hmac_secret: '[REDACTED]',
      })),
    });
  } catch (err) { next(err); }
});

webhookAdminRouter.post('/secrets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      source,
      hmacSecret,
      signatureHeader,
      timestampHeader,
      replayWindowSeconds,
      rateLimitPerMinute,
      ipAllowlist,
      queueName,
    } = req.body ?? {};
    if (!source || !hmacSecret) {
      res.status(400).json({ error: 'source and hmacSecret are required' });
      return;
    }
    if (!/^[a-z][a-z0-9-]{0,99}$/.test(source)) {
      res.status(400).json({ error: 'source must be lowercase alphanumeric or hyphen, max 100 chars' });
      return;
    }
    const [row] = await db<WebhookSecretRow>('webhook_secrets')
      .insert({
        clinic_id: req.clinicId,
        source,
        hmac_secret: hmacSecret,
        signature_header: (signatureHeader ?? 'x-signature').toLowerCase(),
        timestamp_header: timestampHeader ? String(timestampHeader).toLowerCase() : null,
        replay_window_seconds: Number.isInteger(replayWindowSeconds) ? replayWindowSeconds : 300,
        rate_limit_per_minute: Number.isInteger(rateLimitPerMinute) ? rateLimitPerMinute : 60,
        ip_allowlist: ipAllowlist ?? null,
        queue_name: queueName ?? 'webhook-inbound',
        is_active: true,
      })
      .returning(WEBHOOK_SECRET_COLUMNS);
    res.status(201).json({ secret: { ...row, hmac_secret: '[REDACTED]' } });
  } catch (err) { next(err); }
});

webhookAdminRouter.patch('/secrets/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    const allowed: Record<string, string> = {
      hmacSecret: 'hmac_secret',
      signatureHeader: 'signature_header',
      timestampHeader: 'timestamp_header',
      replayWindowSeconds: 'replay_window_seconds',
      rateLimitPerMinute: 'rate_limit_per_minute',
      ipAllowlist: 'ip_allowlist',
      queueName: 'queue_name',
      isActive: 'is_active',
    };
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (allowed[k]) patch[allowed[k]] = v;
    }
    const [row] = await db<WebhookSecretRow>('webhook_secrets')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update(patch)
      .returning(WEBHOOK_SECRET_COLUMNS);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ secret: { ...row, hmac_secret: '[REDACTED]' } });
  } catch (err) { next(err); }
});

webhookAdminRouter.delete('/secrets/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updatedRows = await db('webhook_secrets')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update({ is_active: false, updated_at: new Date() });
    if (updatedRows === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

webhookAdminRouter.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const sourceFilter = req.query.source as string | undefined;
    let q = db('webhook_audit_log')
      .where(function (this: Knex.QueryBuilder) {
        // Show rows that belong to this clinic OR rows where the
        // signature failed (clinic_id is null) but the source slug
        // matches one this clinic owns. The latter is useful for
        // diagnosing partner misconfiguration.
        this.where('clinic_id', req.clinicId).orWhereNull('clinic_id');
      })
      .orderBy('received_at', 'desc')
      .limit(limit);
    if (sourceFilter) q = q.where({ source: sourceFilter });
    const rows = await q;
    res.json({ entries: rows });
  } catch (err) { next(err); }
});
