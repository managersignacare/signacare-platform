// apps/api/src/integrations/healthlink/healthLinkClient.ts
//
// Audit Tier 8 — HealthLink / Argus secure-messaging outbound.
//
// Scope (when `integration-healthlink` flag enabled):
//   1. Send a signed clinical letter (referral, discharge summary,
//      specialist-to-GP) via HealthLink SMD (Secure Message Delivery)
//      protocol. Real-world: HL7 v2 / CDA over SOAP-over-SFTP per
//      HealthLink's EDIFACT specification.
//   2. Track delivery status callbacks (delivered / viewed /
//      acknowledged / bounced).
//   3. Retry via BullMQ queue `letter-delivery-healthlink`.
//
// THIS FILE IS A SKELETON. Real integration requires:
//   - HealthLink partner contract + SMD ID provisioned by HealthLink
//   - TLS client certificate issued by HealthLink CA
//   - Vendor-specific SMD endpoint + credentials
//
// The ship-off-by-default flag + requireEnv fail-fast means clinics
// cannot accidentally send unencrypted letters.

import { logger } from '../../utils/logger';
import { optionalEnv } from '../../shared/requireEnv';

export interface HealthLinkLetterDispatch {
  letterId: string;
  recipientHealthLinkId: string;  // provider's SMD ID
  recipientName: string;
  cdaXml: string;                  // HL7 v3 CDA R2 document
  attachments?: Array<{ fileName: string; contentBase64: string }>;
}

export interface HealthLinkDeliveryStatus {
  letterId: string;
  status: 'queued' | 'sent' | 'delivered' | 'viewed' | 'acknowledged' | 'bounced' | 'failed';
  externalId?: string;
  error?: string;
  updatedAt: string;
}

export function isHealthLinkConfigured(): boolean {
  return !!(optionalEnv('HEALTHLINK_SMD_ID') && optionalEnv('HEALTHLINK_CERT_PATH'));
}

export async function healthCheck(): Promise<{
  status: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE';
  lastCheckedAt: string;
}> {
  const now = new Date().toISOString();
  if (!isHealthLinkConfigured()) return { status: 'UNCONFIGURED', lastCheckedAt: now };
  return { status: 'UNREACHABLE', lastCheckedAt: now };
}

export async function sendLetter(_dispatch: HealthLinkLetterDispatch): Promise<{ externalId: string }> {
  if (!isHealthLinkConfigured()) {
    throw new Error('HealthLink not configured. Set HEALTHLINK_SMD_ID + HEALTHLINK_CERT_PATH + HEALTHLINK_CERT_PASS.');
  }
  logger.warn('[HealthLink] sendLetter: transport not implemented — awaiting HealthLink partner contract + SMD endpoint.');
  throw new Error('HEALTHLINK_NOT_IMPLEMENTED: SMD transport layer awaits partner contract. See Tier 8 + Tier 16.1 plan.');
}
