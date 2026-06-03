import { db } from '../../db/db';

export type ClinicEmailSenderMode = 'staff_delegated' | 'clinic_mailbox';

export interface ClinicSenderProfile {
  emailSenderMode: ClinicEmailSenderMode;
  clinicSenderEmail: string | null;
  clinicSenderName: string | null;
}

function rowToResponse(row: Record<string, unknown>): ClinicSenderProfile {
  const defaultGuidelines = row['default_guidelines'];
  void defaultGuidelines;
  const mode: ClinicEmailSenderMode =
    row['email_sender_mode'] === 'clinic_mailbox' ? 'clinic_mailbox' : 'staff_delegated';
  const clinicSenderEmail = normalizeNullableString(row['clinic_sender_email']);
  const clinicSenderName = normalizeNullableString(row['clinic_sender_name']);

  return {
    emailSenderMode: mode,
    clinicSenderEmail,
    clinicSenderName,
  };
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getClinicSenderProfile(clinicId: string): Promise<ClinicSenderProfile> {
  const row = await db('clinic_settings')
    .where({ clinic_id: clinicId })
    .first();

  return rowToResponse(row ?? {});
}
