// apps/api/src/integrations/radiology/radiologyClient.ts
//
// Audit Tier 8 — Radiology RIS integration skeleton.
//
// Scope (when enabled via `integration-radiology-hl7` feature flag):
//   1. Outbound ORM^O01 (radiology order) via MLLP to the lab RIS.
//   2. Inbound ORU^R01 (radiology result) via MLLP listener.
//   3. Append-audit on every transmission + result ingest.
//
// THIS FILE IS A SKELETON. The actual transport + parser lands after
// the clinic provisions: (a) the RIS vendor's MLLP host + port
// credentials, (b) mutual-TLS certs, (c) the HL7 profile document
// negotiated with the vendor. None of those are auto-provisioned;
// the integration ships OFF by default via feature flag.
//
// Every route that invokes radiology functionality must gate on
// `requireFeatureEnabled('integration-radiology-hl7')` per §5.1.

import { logger } from '../../utils/logger';
import { optionalEnv } from '../../shared/requireEnv';

export interface RadiologyOrder {
  orderId: string;
  orderNumber: string;
  patientId: string;
  clinicalIndication: string;
  modality: 'xray' | 'ct' | 'mri' | 'us' | 'pet';
  bodyRegion: string;
  urgency: 'routine' | 'urgent' | 'stat';
  orderedById: string;
  orderedByName: string;
}

export interface RadiologyResult {
  orderNumber: string;
  status: 'preliminary' | 'final' | 'corrected' | 'cancelled';
  modality: string;
  reportText: string;
  radiologistName: string;
  reportedAt: string;
}

export function isRadiologyConfigured(): boolean {
  return !!(optionalEnv('RIS_MLLP_HOST') && optionalEnv('RIS_MLLP_PORT'));
}

export async function healthCheck(): Promise<{
  status: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE';
  lastCheckedAt: string;
}> {
  const now = new Date().toISOString();
  if (!isRadiologyConfigured()) return { status: 'UNCONFIGURED', lastCheckedAt: now };
  // Real: open a TCP socket to RIS_MLLP_HOST:RIS_MLLP_PORT + exchange a
  // test ACK. Skeleton returns UNREACHABLE until wired.
  return { status: 'UNREACHABLE', lastCheckedAt: now };
}

export async function sendOrder(_order: RadiologyOrder): Promise<{
  ack: 'AA' | 'AE' | 'AR';
  error?: string;
}> {
  if (!isRadiologyConfigured()) {
    return { ack: 'AE', error: 'Radiology RIS not configured. Set RIS_MLLP_HOST + RIS_MLLP_PORT, provision cert via RIS_MLLP_CERT_PATH.' };
  }
  // Tier 8 skeleton — throws at runtime when a clinic enables the flag
  // but hasn't fully wired the transport. The actual MLLP transport
  // implementation re-uses the existing integrations/pathology/mllpTransport
  // pattern once the radiology-specific HL7 profile is signed.
  logger.warn(
    '[Radiology] sendOrder: transport not implemented — awaiting RIS vendor HL7 profile',
  );
  throw new Error('RADIOLOGY_NOT_IMPLEMENTED: transport layer awaits vendor HL7 profile. See Tier 8 follow-up plan.');
}
