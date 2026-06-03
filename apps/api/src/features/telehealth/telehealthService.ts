/**
 * apps/api/src/features/telehealth/telehealthService.ts
 *
 * Pragmatic telehealth: generate a Jitsi Meet room URL per
 * appointment and stash it in `appointments.telehealth_url`. The
 * URL is unguessable (uuid-derived room slug) and the room is
 * created on demand by Jitsi the first time anyone joins — there
 * is no server to provision.
 *
 * Why Jitsi Meet (meet.jit.si by default):
 *
 *   - Free, open-source, no account needed on the public server
 *   - Rooms are ephemeral — they exist while participants are in
 *     them and vanish when empty, so there's no PHI retention
 *   - Self-hostable later without changing any code (set
 *     TELEHEALTH_JITSI_BASE_URL to the self-hosted domain)
 *   - End-to-end encryption is supported in recent Jitsi builds
 *
 * Why NOT Twilio / Daily.co / Vonage:
 *
 *   - Signacare's NO-TELECOM policy bans commercial telecom
 *     providers on the staff surface. Jitsi is a WebRTC
 *     signalling server, not a telecom provider, and is covered
 *     by the same allowlist logic as FCM (in-app push).
 *
 * URL shape:
 *
 *   https://meet.jit.si/signacare-<clinicId-prefix>-<random-slug>
 *
 * The clinic prefix means a room slug is never shared across
 * tenants even if the random part collides (which it won't at
 * 128-bit entropy anyway).
 */
import crypto from 'crypto';

const JITSI_BASE_URL = (process.env.TELEHEALTH_JITSI_BASE_URL ?? 'https://meet.jit.si').replace(/\/$/, '');

/**
 * Generate an unguessable Jitsi room URL for an appointment. The
 * clinic prefix stops cross-tenant collisions; the random suffix
 * is 128 bits of entropy from crypto.randomBytes.
 */
export function generateTelehealthUrl(clinicId: string): string {
  const clinicPrefix = clinicId.replace(/-/g, '').slice(0, 8);
  const randomSuffix = crypto.randomBytes(16).toString('hex');
  const room = `signacare-${clinicPrefix}-${randomSuffix}`;
  return `${JITSI_BASE_URL}/${room}`;
}

/** Lightweight validity check — is a string plausibly one of our rooms? */
export function isTelehealthUrl(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  try {
    const u = new URL(candidate);
    return u.pathname.includes('/signacare-');
  } catch {
    return false;
  }
}
