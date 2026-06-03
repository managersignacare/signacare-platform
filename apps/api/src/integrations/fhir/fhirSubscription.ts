// apps/api/src/integrations/fhir/fhirSubscription.ts
//
// FHIR R4 Subscription — Real-time notifications to external systems
// Equivalent to Epic's FHIR Subscription and Webhook infrastructure
//
// Supports:
//   - rest-hook: POST to a webhook URL when resource changes
//   - email: Send email notification
//   - Channel types per FHIR R4 spec
//
// When a FHIR resource is created/updated/deleted, active subscriptions
// matching the criteria are triggered via BullMQ async job.

import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../../db/db';
import { authMiddleware } from '../../middleware/authMiddleware';
import { logger } from '../../utils/logger';

const router = Router();
router.use(authMiddleware);

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Section P (baseline) declares fhir_subscriptions with these columns.
const FHIR_SUBSCRIPTION_COLUMNS = [
  'id', 'clinic_id', 'status', 'criteria', 'channel_type',
  'channel_endpoint', 'channel_header', 'channel_payload',
  'reason', 'end_time', 'created_by_id',
  'created_at', 'updated_at',
] as const;

interface FhirSubscriptionRow {
  id: string;
  status: string;
  criteria: string;
  reason: string | null;
  channel_type: string;
  channel_endpoint: string | null;
  channel_payload: string | null;
  channel_header: string[] | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// GET /fhir/Subscription — List active subscriptions
router.get('/Subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Phase R3: table now lives in baseline Section P. CLAUDE.md §7.3
    // forbids DDL in route handlers; the pre-R2 `db.schema.createTable`
    // + `hasTable` check has been removed.
    const subs = await db('fhir_subscriptions')
      .where({ clinic_id: req.clinicId, status: 'active' }) as FhirSubscriptionRow[];
    res.json({
      resourceType: 'Bundle', type: 'searchset', total: subs.length,
      entry: subs.map((s) => ({
        resource: {
          resourceType: 'Subscription', id: s.id, status: s.status,
          criteria: s.criteria, reason: s.reason,
          channel: { type: s.channel_type, endpoint: s.channel_endpoint, payload: s.channel_payload },
        },
      })),
    });
  } catch (err) { next(err); }
});

// POST /fhir/Subscription — Create subscription
router.post('/Subscription', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { criteria, channel, reason, end } = req.body;

    if (!criteria || !channel?.type || !channel?.endpoint) {
      res.status(400).json({ error: 'criteria, channel.type, and channel.endpoint are required' });
      return;
    }

    // Validate channel type
    if (!['rest-hook', 'email', 'websocket'].includes(channel.type)) {
      res.status(400).json({ error: 'channel.type must be rest-hook, email, or websocket' });
      return;
    }

    // Validate webhook URL (must be HTTPS in production)
    if (channel.type === 'rest-hook') {
      try {
        const u = new URL(channel.endpoint);
        if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') {
          res.status(400).json({ error: 'Webhook endpoint must use HTTPS in production' });
          return;
        }
      } catch {
        res.status(400).json({ error: 'Invalid webhook endpoint URL' });
        return;
      }
    }

    // fhir_subscriptions is a baseline table (Phase R3 / Section P).
    const [sub] = await db('fhir_subscriptions').insert({
      clinic_id: req.clinicId,
      status: 'active',
      criteria,
      channel_type: channel.type,
      channel_endpoint: channel.endpoint,
      channel_header: channel.header ?? null,
      channel_payload: channel.payload ?? 'application/fhir+json',
      reason: reason ?? null,
      end_time: end ? new Date(end) : null,
      created_by_id: req.user!.id,
    }).returning(FHIR_SUBSCRIPTION_COLUMNS);

    logger.info({ subscriptionId: sub.id, criteria, channelType: channel.type }, 'FHIR Subscription created');

    res.status(201).json({
      resourceType: 'Subscription', id: sub.id, status: 'active',
      criteria, reason,
      channel: { type: channel.type, endpoint: channel.endpoint, payload: channel.payload },
    });
  } catch (err) { next(err); }
});

// DELETE /fhir/Subscription/:id — Deactivate subscription
router.delete('/Subscription/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('fhir_subscriptions')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update({ status: 'off', updated_at: new Date() });
    res.status(204).send();
  } catch (err) { next(err); }
});

/**
 * Trigger subscriptions for a resource change.
 * Called internally after FHIR resource CRUD operations.
 */
export async function triggerSubscriptions(clinicId: string, resourceType: string, resourceId: string, action: 'create' | 'update' | 'delete'): Promise<void> {
  try {
    // fhir_subscriptions is a first-class baseline table (R2b Section P).
    // The pre-R2 `hasTable` guard has been removed.
    const subs = await db('fhir_subscriptions')
      .where({ clinic_id: clinicId, status: 'active' })
      .where('criteria', 'like', `%${resourceType}%`);

    for (const sub of subs) {
      if (sub.channel_type === 'rest-hook' && sub.channel_endpoint) {
        // Fire webhook asynchronously
        fetch(sub.channel_endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': sub.channel_payload ?? 'application/fhir+json',
            ...(sub.channel_header ? Object.fromEntries(sub.channel_header.map((h: string) => h.split(': ', 2))) : {}),
          },
          body: JSON.stringify({
            resourceType: 'Bundle', type: 'history',
            entry: [{ resource: { resourceType, id: resourceId }, request: { method: action.toUpperCase(), url: `${resourceType}/${resourceId}` } }],
          }),
        }).catch((error: unknown) => {
          logger.warn({ subscriptionId: sub.id, err: getErrorMessage(error) }, 'Webhook delivery failed');
        });
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to trigger FHIR subscriptions');
  }
}

export default router;
