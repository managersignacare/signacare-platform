// apps/api/src/integrations/fcm/fcmClient.ts
//
// Phase 11A — Firebase Cloud Messaging client.
//
// Scoped directory — the Phase 12D-style caller-containment guard
// can be extended in a follow-up to pin FCM imports to exactly one
// caller (currently the notificationService.emit FCM fan-out path
// in apps/api/src/features/notifications/notificationService.ts and
// the patientOutreachService FCM write path in
// apps/api/src/features/patient-outreach/patientOutreachService.ts —
// both legitimate).
//
// Runtime modes (same pattern as integrations/acs/acsClient):
//
//   - UNCONFIGURED (any env): FCM_SERVICE_ACCOUNT_PATH unset
//     → sendToTokens returns a structured failure result
//     (`successCount=0`, `failureCount=tokens.length`) so missing
//     config is fail-visible and cannot masquerade as a successful
//     push dispatch.
//
//   - REAL: FCM_SERVICE_ACCOUNT_PATH points at a JSON file on disk
//     → dynamically imports firebase-admin, initialises the app
//     with the service account, calls messaging.sendEachForMulticast.
//     The package is an optional peer dep (dev/CI don't install
//     it) — the @ts-expect-error import matches the acsClient
//     pattern.
//
// The only exported function is `sendToTokens`. Callers don't see
// firebase-admin at all — they pass a list of FCM tokens + a payload
// and get back per-token delivery status + a list of "prune me"
// tokens that returned `UNREGISTERED`.

import logger from '../../utils/logger';

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface FcmDeliveryResult {
  /** Number of tokens the provider accepted. */
  successCount: number;
  /** Number of tokens the provider rejected. */
  failureCount: number;
  /** Tokens the provider says are permanently dead — caller deletes them. */
  deadTokens: string[];
  /** Human-readable error from the provider, when available. */
  errorMessage?: string;
}

function mockMode(): boolean {
  const p = process.env.FCM_SERVICE_ACCOUNT_PATH;
  return !p || p.trim().length === 0;
}

export async function sendToTokens(
  tokens: string[],
  payload: FcmPayload,
): Promise<FcmDeliveryResult> {
  if (tokens.length === 0) {
    return { successCount: 0, failureCount: 0, deadTokens: [] };
  }

  if (mockMode()) {
    // BUG-043 — MOCK mode is dev/test only. In production it was a
    // silent-fallback: clinicians believed push notifications were
    // sent while the integration returned fake success. Boot-time
    // assertProductionIntegrationsConfigured() should have blocked
    // boot, but belt-and-suspenders: throw on first call too.
    if (process.env.NODE_ENV === 'production') {
      const { AppError } = await import('../../shared/errors');
      throw new AppError(
        'FCM push notifications not configured in production — set FCM_SERVICE_ACCOUNT_PATH',
        503,
        'FCM_NOT_CONFIGURED',
      );
    }
    logger.warn(
      { tokenCount: tokens.length, title: payload.title },
      'fcmClient.sendToTokens — skipped because FCM is not configured',
    );
    return {
      successCount: 0,
      failureCount: tokens.length,
      deadTokens: [],
      errorMessage: 'FCM_NOT_CONFIGURED: set FCM_SERVICE_ACCOUNT_PATH.',
    };
  }

  try {
    // @ts-expect-error — firebase-admin is an optional peer dep,
    // installed only in production deploys that use real FCM.
    const admin = (await import('firebase-admin')) as {
      apps: { length: number };
      initializeApp: (config: { credential: unknown }) => void;
      credential: { cert: (path: string) => unknown };
      messaging: () => {
        sendEachForMulticast: (
          message: { tokens: string[]; notification: { title: string; body: string }; data?: Record<string, string> },
        ) => Promise<{
          successCount: number;
          failureCount: number;
          responses: Array<{ success: boolean; error?: { code?: string; message?: string } }>;
        }>;
      };
    };

    // Idempotent init — firebase-admin refuses to initializeApp twice.
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(process.env.FCM_SERVICE_ACCOUNT_PATH!),
      });
    }

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });

    const dead: string[] = [];
    res.responses.forEach((r, idx) => {
      if (!r.success && r.error) {
        const code = r.error.code ?? '';
        // FCM's canonical "this token is gone" codes. Treat
        // anything else (rate limit, invalid argument) as a
        // soft failure that's NOT pruned.
        if (
          code.endsWith('/registration-token-not-registered') ||
          code.endsWith('/invalid-registration-token')
        ) {
          dead.push(tokens[idx]);
        }
      }
    });

    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
      deadTokens: dead,
    };
  } catch (err) {
    logger.error({ err }, 'fcmClient.sendToTokens — real-mode send failed');
    return {
      successCount: 0,
      failureCount: tokens.length,
      deadTokens: [],
      errorMessage: (err as Error).message ?? 'FCM send failed',
    };
  }
}
