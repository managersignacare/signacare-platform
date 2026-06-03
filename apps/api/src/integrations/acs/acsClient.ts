// apps/api/src/integrations/acs/acsClient.ts
//
// Phase 12B — thin wrapper around Azure Communication Services SMS.
//
// Scoped import rule (enforced by the Phase 12D caller-containment
// guard): the ONLY file allowed to import `acsClient.sendSms` is
// `apps/api/src/features/patient-outreach/patientOutreachService.ts`.
// Any other importer will be flagged at CI time.
//
// Runtime modes:
//
//   - UNCONFIGURED (any env): when ACS_CONNECTION_STRING or
//     ACS_FROM_PHONE is unset, `sendSms` returns a structured
//     failure result (`success=false`) and logs a warning. This is
//     intentionally fail-visible so missing telecom config cannot
//     masquerade as delivery success.
//
//   - REAL: when both env vars are set, the wrapper dynamically
//     imports `@azure/communication-sms` (keeps the production
//     dependency optional — CI doesn't need to install it) and
//     issues a single SMS per call. Returns ACS's operation id.
//
// This module holds no state. A future optimisation can cache the
// SmsClient between calls, but for the dispatcher's one-call-at-a
// -time pattern the overhead is irrelevant.
import { loadAcsConfig } from './acsConfig';
import logger from '../../utils/logger';

export interface SendSmsInput {
  /** E.164 destination number, e.g. "+61400000000". */
  to: string;
  /** Plain-text body. Single-segment (≤160 chars) is ideal. */
  body: string;
  /**
   * Opaque audit tag attached to the ACS send. Shows up in ACS's
   * delivery reports so ops can trace "which tenant sent this?".
   * Typical format: `${clinicId}:${patientId}:${kind}`.
   */
  tag?: string;
}

export interface SendSmsResult {
  /** Whether the call was accepted by the provider (or the mock). */
  success: boolean;
  /**
   * Provider operation id when success=true. MOCK-<uuid> format in
   * mock mode, real ACS operation id in production.
   */
  operationId?: string;
  /** Error message when success=false. */
  errorMessage?: string;
}

/**
 * Send a single SMS. Returns a result object rather than throwing so
 * the patient-outreach worker can record structured failure rows in
 * `patient_outreach_log` without try/catch noise around every call.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const config = loadAcsConfig();

  if (config.mockMode) {
    // BUG-043 — MOCK mode is dev/test only. Production callers
    // believed SMS went out while the integration returned a fake
    // operation id. Boot assertion blocks misconfigured production
    // boot; this throw is belt-and-suspenders for any runtime path.
    if (process.env.NODE_ENV === 'production') {
      const { AppError } = await import('../../shared/errors');
      throw new AppError(
        'ACS SMS not configured in production — set ACS_CONNECTION_STRING + ACS_FROM_PHONE',
        503,
        'ACS_NOT_CONFIGURED',
      );
    }
    logger.warn(
      { to: input.to, bodyLength: input.body.length, tag: input.tag },
      'acsClient.sendSms — skipped because ACS is not configured',
    );
    return {
      success: false,
      errorMessage: 'ACS_NOT_CONFIGURED: set ACS_CONNECTION_STRING and ACS_FROM_PHONE.',
    };
  }

  // Dynamic import so production-only contributors don't need to
  // install @azure/communication-sms when they never touch this
  // directory — the package is an optional peer dependency. Missing
  // package in real mode is a bug; log loudly and fall through to
  // the "send failed" return.
  try {
    // @ts-expect-error — @azure/communication-sms is an optional peer
    // dep. dev and CI don't install it; production deploys that use
    // real ACS must add it to package.json alongside this file.
    const mod = (await import('@azure/communication-sms')) as {
      SmsClient: new (connectionString: string) => {
        send(
          request: { from: string; to: string[]; message: string },
          options?: { tag?: string; enableDeliveryReport?: boolean },
        ): Promise<Array<{ messageId?: string; successful: boolean; errorMessage?: string; httpStatusCode?: number }>>;
      };
    };
    const client = new mod.SmsClient(config.connectionString!);
    const response = await client.send(
      {
        from: config.fromPhoneE164!,
        to: [input.to],
        message: input.body,
      },
      {
        tag: input.tag,
        enableDeliveryReport: true,
      },
    );

    const first = Array.isArray(response) ? response[0] : undefined;
    if (!first) {
      return { success: false, errorMessage: 'ACS returned no response rows' };
    }
    if (first.successful) {
      return { success: true, operationId: first.messageId ?? undefined };
    }
    return {
      success: false,
      errorMessage: `ACS: ${first.errorMessage ?? 'unknown provider error'} (HTTP ${first.httpStatusCode ?? '?'})`,
    };
  } catch (err) {
    logger.error({ err }, 'acsClient.sendSms — real-mode send failed');
    return {
      success: false,
      errorMessage: (err as Error).message ?? 'ACS send failed (see server logs)',
    };
  }
}
