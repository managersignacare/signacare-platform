// apps/api/src/integrations/medicare/eclipseClient.ts
//
// Audit Tier 8 — Medicare ECLIPSE billing claims submission.
//
// Scope (when `integration-medicare-eclipse` flag enabled):
//   1. Submit bulk-bill and patient-claim transactions to Services
//      Australia via the ECLIPSE B2B gateway.
//   2. Poll for claim status + Remittance Advice (835).
//   3. Reconcile claim response codes into billing.invoices state.
//
// Real-world preconditions BEFORE this can ship live:
//   - Practice registers with Services Australia for ECLIPSE
//   - PRODA Organisation Record linked to provider numbers
//   - Medicare Online Software Vendor test registration (MOSVT)
//   - Integration test environment access (SAS2) + production sign-off
//
// None of these are automatable — clinic onboarding workflow provisions
// them manually. Until then, this client is OFF by default.

import { logger } from '../../utils/logger';
import { optionalEnv } from '../../shared/requireEnv';

export type EclipseClaimType = 'bulk_bill' | 'patient_claim' | 'medicare_rebate';

export interface EclipseClaim {
  claimId: string;
  claimType: EclipseClaimType;
  patientId: string;
  providerNumber: string;
  serviceDate: string;              // YYYY-MM-DD
  mbsItems: Array<{
    itemNumber: string;             // e.g. '104' for specialist consult
    chargeAmount: number;           // AUD
    serviceDateTime: string;
  }>;
  referringProviderNumber?: string;
}

export interface EclipseClaimResponse {
  claimId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'paid';
  externalClaimId?: string;
  benefitAmount?: number;
  rejectionReason?: string;
}

export function isEclipseConfigured(): boolean {
  return !!(optionalEnv('MEDICARE_PRODA_CLIENT_ID') && optionalEnv('MEDICARE_PRODA_CLIENT_SECRET') && optionalEnv('MEDICARE_MINOR_ID'));
}

export async function healthCheck(): Promise<{
  status: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE';
  lastCheckedAt: string;
}> {
  const now = new Date().toISOString();
  if (!isEclipseConfigured()) return { status: 'UNCONFIGURED', lastCheckedAt: now };
  return { status: 'UNREACHABLE', lastCheckedAt: now };
}

export async function submitClaim(_claim: EclipseClaim): Promise<EclipseClaimResponse> {
  if (!isEclipseConfigured()) {
    throw new Error('ECLIPSE not configured. Register via PRODA + set MEDICARE_PRODA_CLIENT_ID, MEDICARE_PRODA_CLIENT_SECRET, MEDICARE_MINOR_ID.');
  }
  logger.warn('[ECLIPSE] submitClaim: transport not implemented — awaiting Services Australia SAS2 test environment sign-off.');
  throw new Error('ECLIPSE_NOT_IMPLEMENTED: SAS2 → production path awaits MOSVT sign-off. See Tier 8 + Tier 17.4 plan.');
}
