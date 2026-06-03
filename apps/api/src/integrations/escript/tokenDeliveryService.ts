/**
 * eScript Token Delivery Service
 *
 * Delivers electronic prescription tokens to patients via SMS or email.
 * Per ADHA Conformance Profile V2.2.1+, the vendor must be able to send
 * the token to a patient's mobile or email address.
 *
 * Uses the existing Outlook email integration for email delivery,
 * and a generic SMS gateway for SMS (Twilio, MessageMedia, etc).
 */

import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';

export interface TokenDeliveryPayload {
  patientId: string;
  patientName?: string;
  phoneMobile?: string;
  email?: string;
  erxToken: string;
  scid?: string;
  dspId?: string;
  medicationName?: string;
  prescribedDate?: string;
  prescribedBy?: string;
  clinicName?: string;
}

export interface TokenDeliveryResult {
  sms: { sent: boolean; error?: string };
  email: { sent: boolean; error?: string };
}

// ── SMS Delivery ──────────────────────────────────────────────────────────────
// Audit Tier 7.1 (CRIT-A1) ⚠ BREAKING — fail-fast on missing env. The
// previous `|| ''` fallback silently fed empty creds to the gateway.
// `requireEnv()` now throws AppError('ENV_MISSING') at first use; the
// error message names the env var + the remediation (configure OR
// disable the integration via clinic_feature_flags).
import { requireEnv, optionalEnv } from '../../shared/requireEnv';

// Optional sender-id has a legitimate default, so it stays on the
// optionalEnv path.
const SMS_SENDER_ID = optionalEnv('SMS_SENDER_ID') ?? 'SignacareEMR';

function isSmsConfigured(): boolean {
  return !!(optionalEnv('SMS_GATEWAY_URL') && optionalEnv('SMS_GATEWAY_API_KEY'));
}

export function buildRedactedEopSmsBody(payload: TokenDeliveryPayload): string {
  return [
    `Electronic prescription token`,
    `eScript Token: ${payload.erxToken}`,
    `SCID: ${payload.scid ?? 'N/A'}`,
    `DSPID: ${payload.dspId ?? 'N/A'}`,
  ].join('\n');
}

async function sendSms(phone: string, body: string): Promise<{ sent: boolean; error?: string }> {
  if (!isSmsConfigured()) {
    return { sent: false, error: 'SMS gateway not configured. Set SMS_GATEWAY_URL and SMS_GATEWAY_API_KEY.' };
  }

  // Tier 7.1 — requireEnv throws if the integration is configured-yet-
  // racy (isSmsConfigured() returned true but the env vanished between
  // the check and the call). Defensive.
  const SMS_GATEWAY_URL = requireEnv('SMS_GATEWAY_URL', 'patient-outreach SMS dispatch');
  const SMS_GATEWAY_KEY = requireEnv('SMS_GATEWAY_API_KEY', 'patient-outreach SMS dispatch');

  try {
    const res = await fetch(SMS_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SMS_GATEWAY_KEY}`,
      },
      body: JSON.stringify({
        to: phone,
        from: SMS_SENDER_ID,
        body,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { sent: false, error: `SMS failed (${res.status}): ${errText.substring(0, 200)}` };
    }

    return { sent: true };
  } catch (err) {
    return { sent: false, error: `SMS error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Email Delivery ────────────────────────────────────────────────────────────

export function buildRedactedEopEmailHtml(payload: TokenDeliveryPayload): string {
  return `
    <div style="font-family: 'Albert Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #327C8D; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">Electronic Prescription Token</h2>
      </div>
      <div style="border: 1px solid #e0e0e0; border-top: 0; padding: 24px; border-radius: 0 0 8px 8px;">
        <div style="background: #FFF8F2; border: 2px solid #f0852c; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
          <p style="margin: 0 0 8px; font-size: 12px; color: #666;">eScript Token</p>
          <p style="margin: 0; font-size: 22px; font-weight: 700; font-family: monospace; color: #3D484B; letter-spacing: 2px;">
            ${payload.erxToken}
          </p>
        </div>
        <p>Use this token identifier to access dispensing details through approved pharmacy systems.</p>
        <table style="width: 100%; margin-top: 16px; font-size: 14px;">
          <tr><td style="color: #666; padding: 4px 0;">SCID:</td><td style="font-weight: 500;">${payload.scid ?? 'N/A'}</td></tr>
          <tr><td style="color: #666; padding: 4px 0;">DSPID:</td><td style="font-weight: 500;">${payload.dspId ?? 'N/A'}</td></tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999;">
          This is an automated electronic token notification.
        </p>
      </div>
    </div>
  `;
}

async function sendTokenEmail(staffId: string, email: string, payload: TokenDeliveryPayload): Promise<{ sent: boolean; error?: string }> {
  try {
    // Use the existing Outlook email service if available
    const { sendEmail } = await import('../outlook/outlookEmailService');
    await sendEmail(staffId, {
      to: [email],
      subject: 'Your electronic prescription token',
      htmlBody: buildRedactedEopEmailHtml(payload),
    });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    // Fallback: if Outlook not configured, log and return error
    if (msg.includes('not configured') || code === 'MODULE_NOT_FOUND') {
      return { sent: false, error: 'Email service not configured (Outlook integration required).' };
    }
    return { sent: false, error: `Email error: ${msg}` };
  }
}

// ── Main delivery function ────────────────────────────────────────────────────

export async function deliverToken(
  clinicId: string,
  actorId: string,
  payload: TokenDeliveryPayload,
): Promise<TokenDeliveryResult> {
  const result: TokenDeliveryResult = {
    sms: { sent: false },
    email: { sent: false },
  };

  // Send SMS if mobile phone provided
  if (payload.phoneMobile) {
    const smsBody = buildRedactedEopSmsBody(payload);
    result.sms = await sendSms(payload.phoneMobile, smsBody);
    logger.info({ patientId: payload.patientId, smsSent: result.sms.sent }, '[TokenDelivery] SMS attempt');
  }

  // Send email if address provided
  if (payload.email) {
    result.email = await sendTokenEmail(actorId, payload.email, payload);
    logger.info({ patientId: payload.patientId, emailSent: result.email.sent }, '[TokenDelivery] Email attempt');
  }

  // Audit log
  await writeAuditLog({
    actorId,
    clinicId,
    action: 'CREATE',
    tableName: 'erx_token_delivery',
    recordId: payload.patientId,
    newData: {
      token: payload.erxToken.substring(0, 8) + '...', // Don't log full token
      scid: payload.scid ?? null,
      dspId: payload.dspId ?? null,
      smsSent: result.sms.sent,
      emailSent: result.email.sent,
      smsError: result.sms.error,
      emailError: result.email.error,
    },
  });

  return result;
}
