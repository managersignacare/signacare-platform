// apps/api/src/features/patient-outreach/adminAlert.ts
//
// Audit Tier 7.3 (MED-I3) — admin alert dispatcher.
//
// Thin shim that writes an audit_log row + best-effort email to the
// clinic's admin_email (from clinics.email). Not a patient-outreach
// channel — intentionally separate from patientOutreachService to
// keep the rate-limiting / consent logic from either direction
// cross-contaminating the other.
//
// Real email delivery depends on the existing outlookEmailService
// (Tier 7.5 per-clinic Sharepoint site applies symmetrically to
// the email sender). If email delivery fails, the audit_log row
// survives and surfaces in the admin dashboard.

import { dbAdmin } from '../../db/db';
import { writeAuditLog } from '../../utils/audit';
import { logger } from '../../utils/logger';

export type AdminAlertKind =
  | 'prescription_pathway_exhausted'
  | 'integration_unreachable'
  | 'integration_config_drift'
  | 'ai_canary_rollback'
  // BUG-577-FOLLOWUP / BUG-584-FOLLOWUP — preventive bootstrap signal
  // when a clinic has neither nominated nor delegated access-admin slot.
  | 'clinic_admin_slots_unconfigured'
  // Tier 13.1 — scribe sensitive-topic detector found one or more
  // flags at severity='critical' in a finalised transcript.
  | 'scribe_critical_flag';

export interface AdminAlertInput {
  clinicId: string;
  kind: AdminAlertKind;
  payload: Record<string, unknown>;
}

export async function sendAdminAlert(input: AdminAlertInput): Promise<void> {
  // Always write an audit_log row first — the persistent trail is
  // the primary delivery mechanism. Email is best-effort.
  try {
    await writeAuditLog({
      clinicId: input.clinicId,
      // System-actor UUID placeholder — admin alerts are raised by
      // the server itself, not a human user. audit_log.actor_id is a
      // required string field so we use the nil-UUID sentinel that
      // other system paths use (Tier 5.3 classifier block follows
      // the same pattern).
      actorId: '00000000-0000-0000-0000-000000000000',
      // BUG-467 — first-class ADMIN_ALERT literal (was 'UPDATE' as a
      // semantic-drift placeholder). Coronial review can now query
      // admin-alert events by exact action.
      action: 'ADMIN_ALERT',
      tableName: 'admin_alerts',
      recordId: `${input.clinicId}:${input.kind}:${Date.now()}`,
      newValues: { kind: input.kind, ...input.payload },
    });
  } catch (err) {
    logger.error(
      { err, kind: input.kind, clinicId: input.clinicId },
      'adminAlert: audit_log write failed',
    );
  }

  // Best-effort email — look up the clinic's email. Skip silently
  // when unset (the audit_log row is the durable record).
  try {
    const clinic = await dbAdmin('clinics').where({ id: input.clinicId }).select('email', 'name').first();
    const adminEmail = clinic?.email as string | undefined;
    if (!adminEmail) return;
    // We defer to the existing outlookEmailService if configured.
    // This module intentionally does not import it statically to
    // avoid tight coupling at boot time.
    const { sendEmailIfConfigured } = await import('./adminAlertEmail');
    await sendEmailIfConfigured({
      to: adminEmail,
      subject: `[Signacare admin] ${input.kind.replace(/_/g, ' ')} — ${clinic?.name ?? input.clinicId}`,
      body: JSON.stringify(input.payload, null, 2),
    });
  } catch (err) {
    logger.warn(
      { err, kind: input.kind },
      'adminAlert: email delivery failed (non-blocking)',
    );
  }
}
