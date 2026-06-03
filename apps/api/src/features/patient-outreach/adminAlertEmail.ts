// apps/api/src/features/patient-outreach/adminAlertEmail.ts
//
// Audit Tier 7.3 — thin wrapper around Outlook / SMTP email for admin
// alerts. Returns { sent: false } without throwing when no email
// infrastructure is configured so the caller's audit_log row remains
// the authoritative delivery record.

import { logger } from '../../utils/logger';

export async function sendEmailIfConfigured(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ sent: boolean; channel?: string; error?: string }> {
  // Admin-alert email channel is a v2 follow-up. The outlookEmailService
  // currently signs emails as a specific staff member (staffId +
  // payload) — appropriate for clinical correspondence, not for system-
  // generated alerts. Until a dedicated system-from-address + SMTP
  // sender lands, the audit_log row in adminAlert.ts IS the delivery
  // mechanism; the clinic admin reads alerts via the dashboard.
  logger.info(
    { subject: opts.subject },
    'adminAlertEmail: email channel not yet configured — relying on audit_log surface',
  );
  return { sent: false, error: 'No system email channel configured for admin alerts.' };
}
