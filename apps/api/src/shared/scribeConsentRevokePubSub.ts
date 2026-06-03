import type IORedis from 'ioredis';
import { redisCache } from '../config/redis';
import { logger } from '../utils/logger';
import { registerShutdownHook } from './gracefulShutdown';

const CONSENT_REVOKE_CHANNEL = 'scribe-consent-revoke-cache-invalidation:v1';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConsentRevokeMessage {
  consentId: string;
  clinicId: string;
  source: string;
  revokedAt: string;
}

let subscriber: IORedis | null = null;
let subscriberStartPromise: Promise<boolean> | null = null;
let onRevokedHandler: ((consentId: string) => void) | null = null;
let shutdownHookRegistered = false;

function decodeConsentRevokeMessage(raw: string): ConsentRevokeMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentRevokeMessage>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.consentId !== 'string' || !UUID_RE.test(parsed.consentId)) return null;
    if (typeof parsed.clinicId !== 'string' || parsed.clinicId.length === 0) return null;
    if (typeof parsed.source !== 'string' || parsed.source.length === 0) return null;
    if (typeof parsed.revokedAt !== 'string' || Number.isNaN(Date.parse(parsed.revokedAt))) return null;
    return parsed as ConsentRevokeMessage;
  } catch {
    return null;
  }
}

function registerShutdownHookOnce(): void {
  if (shutdownHookRegistered || process.env.NODE_ENV === 'test') return;
  shutdownHookRegistered = true;
  registerShutdownHook({
    name: 'scribe-consent-revoke-cache-subscriber',
    priority: 15,
    handler: async () => {
      await stopScribeConsentRevokeSubscriber();
    },
  });
}

function bindSubscriberMessagePump(client: IORedis): void {
  client.on('message', (channel: string, raw: string) => {
    if (channel !== CONSENT_REVOKE_CHANNEL) return;
    const payload = decodeConsentRevokeMessage(raw);
    if (!payload) {
      logger.warn(
        { channel: CONSENT_REVOKE_CHANNEL },
        '[BUG-329] Dropped malformed scribe consent revoke cache-invalidation message',
      );
      return;
    }

    try {
      onRevokedHandler?.(payload.consentId);
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          consentId: payload.consentId,
          clinicId: payload.clinicId,
          source: payload.source,
        },
        '[BUG-329] revoke-cache subscriber handler failed',
      );
    }
  });

  client.on('error', (err: Error) => {
    logger.warn(
      { err: err.message },
      '[BUG-329] scribe consent revoke cache subscriber Redis error (fail-open)',
    );
  });
}

export async function startScribeConsentRevokeSubscriber(
  onRevoked: (consentId: string) => void,
): Promise<boolean> {
  onRevokedHandler = onRevoked;

  if (subscriber) return true;
  if (subscriberStartPromise) return subscriberStartPromise;

  subscriberStartPromise = (async () => {
    const client = redisCache.duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    }) as IORedis;

    bindSubscriberMessagePump(client);

    try {
      if (client.status === 'wait' || client.status === 'end' || client.status === 'close') {
        await client.connect();
      }
      await client.subscribe(CONSENT_REVOKE_CHANNEL);
      subscriber = client;
      registerShutdownHookOnce();
      logger.info(
        { channel: CONSENT_REVOKE_CHANNEL },
        '[BUG-329] scribe consent revoke cache subscriber ready',
      );
      return true;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[BUG-329] failed to start scribe consent revoke cache subscriber; running TTL-only fallback',
      );
      try {
        await client.quit();
      } catch {
        // no-op
      }
      return false;
    }
  })();

  try {
    return await subscriberStartPromise;
  } finally {
    subscriberStartPromise = null;
  }
}

export async function stopScribeConsentRevokeSubscriber(): Promise<void> {
  const current = subscriber;
  subscriber = null;
  onRevokedHandler = null;
  if (!current) return;

  try {
    await current.unsubscribe(CONSENT_REVOKE_CHANNEL);
  } catch {
    // no-op
  }
  try {
    await current.quit();
  } catch {
    // no-op
  }
}

export async function publishScribeConsentRevokedCacheInvalidation(args: {
  consentId: string;
  clinicId: string;
  source: string;
}): Promise<void> {
  const payload: ConsentRevokeMessage = {
    consentId: args.consentId,
    clinicId: args.clinicId,
    source: args.source,
    revokedAt: new Date().toISOString(),
  };

  try {
    await redisCache.publish(CONSENT_REVOKE_CHANNEL, JSON.stringify(payload));
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        consentId: args.consentId,
        clinicId: args.clinicId,
      },
      '[BUG-329] failed to publish revoke-cache invalidation; running TTL-only fallback',
    );
  }
}

export function __decodeConsentRevokeMessageForTests(
  raw: string,
): ConsentRevokeMessage | null {
  return decodeConsentRevokeMessage(raw);
}
