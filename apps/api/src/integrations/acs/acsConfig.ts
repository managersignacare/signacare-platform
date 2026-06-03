// apps/api/src/integrations/acs/acsConfig.ts
//
// Phase 12B — Azure Communication Services environment config.
//
// This file is ONE of the two directories the no-telecom CI guard
// allowlists (the other is apps/api/src/integrations/escript/**).
// Every ACS-adjacent module MUST live under this directory; a second
// guard (Phase 12D) enforces that `patientOutreachService.ts` is
// the only caller of anything in here.
//
// The ACS_CONNECTION_STRING is the classic Azure endpoint connection
// string ("endpoint=https://…;accesskey=…"). ACS_FROM_PHONE is the
// E.164 number ACS provisions for the tenant that all outbound SMS
// is sent from. When either is missing the client runs in MOCK
// mode so development boxes and CI can test the dispatcher without
// touching the real ACS API (or incurring billing).

export interface AcsConfig {
  /** Real connection string; null means mock mode. */
  connectionString: string | null;
  /** E.164 sender number. null = mock mode. */
  fromPhoneE164: string | null;
  /** Runtime flag. True when either env var is missing. */
  mockMode: boolean;
}

export function loadAcsConfig(): AcsConfig {
  const raw = process.env.ACS_CONNECTION_STRING ?? null;
  const from = process.env.ACS_FROM_PHONE ?? null;
  const connectionString = raw && raw.trim().length > 0 ? raw : null;
  const fromPhoneE164 = from && from.trim().length > 0 ? from : null;
  const mockMode = !(connectionString && fromPhoneE164);
  return { connectionString, fromPhoneE164, mockMode };
}
