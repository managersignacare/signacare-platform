// apps/api/src/features/calendar/icalTokenService.ts
//
// Phase 13 — HMAC token minting + verification for the public
// per-clinician iCal subscription endpoint.
//
// Requirements driving the shape of this module:
//
//   1. **No Authorization header.** Outlook, Google Calendar, and
//      Apple Calendar all subscribe to webcal/https URLs and cannot
//      attach a bearer token. The only credential available at
//      request time is the query-string `?token=...` parameter.
//
//   2. **Tenant-isolated without a session.** The subscription URL
//      is dereferenced by some third-party calendar cloud we can't
//      run middleware against. The token itself must carry the
//      (clinicId, clinicianId, issuedAt) triple so a request with
//      a valid signature can be mapped back to exactly one clinic
//      and one clinician at request time, without a DB lookup.
//
//   3. **Rotatable.** An operator must be able to invalidate every
//      currently-subscribed URL for a single clinician without
//      touching the global secret. Every mint records its issuedAt;
//      verifyToken() takes the clinician's current issuedAt from
//      staff_settings and rejects any signature that embeds a
//      different one. Rotating the clinician's stored issuedAt
//      (via calendarService) instantly orphans all older tokens.
//
//   4. **Constant-time comparison.** Never use a naive `===` on
//      HMAC output — it leaks byte-position information via an
//      early-exit timing side channel. Use
//      crypto.timingSafeEqual().
//
//   5. **No wall-clock expiry.** A subscription URL is a long-
//      lived credential by design. If a clinician leaves the
//      clinic, the operator rotates the clinician's issuedAt to
//      invalidate their URL. If the global secret ever leaks, the
//      operator rotates CALENDAR_ICAL_SECRET and every URL in the
//      fleet becomes invalid simultaneously.
//
//   6. **Refuses to mint when secret is missing.** If
//      CALENDAR_ICAL_SECRET is unset (e.g. staging env, test env,
//      dev env with a typo), every call to mintToken() throws.
//      Better to loud-fail at subscription-URL generation time
//      than to silently mint unverifiable tokens.

import { createHmac, timingSafeEqual } from 'crypto';

/** Payload embedded in every issued token. */
export interface TokenPayload {
  readonly clinicId: string;
  readonly clinicianId: string;
  /** ISO 8601 UTC string of the moment the token was minted. */
  readonly issuedAt: string;
}

/** The opaque base64url string a subscriber copies into Outlook. */
export type IcalToken = string;

/** Thrown by mintToken() when the runtime secret is missing. */
export class IcalSecretMissingError extends Error {
  constructor() {
    super(
      'CALENDAR_ICAL_SECRET is not configured. Subscription URLs cannot be minted until an operator sets the env var and restarts the API.',
    );
    this.name = 'IcalSecretMissingError';
  }
}

/**
 * The secret is passed as an argument rather than read from config
 * directly so that:
 *   1. Unit tests don't need to mock the config module (which runs
 *      zod validation + process.exit at module-load time).
 *   2. A single iCal route can cleanly handle "secret not configured"
 *      by returning a 503 at the edge rather than throwing out of
 *      a module-initialisation path.
 *   3. The service stays pure — all state flows in through function
 *      parameters and no module-level import is required.
 * The thin `config.calendar.icalSecret → mintToken/verifyToken` wiring
 * lives in the route handler in `calendarRoutes.ts`.
 */
function normaliseSecret(secret: string | null | undefined): string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new IcalSecretMissingError();
  }
  return secret;
}

const FIELD_SEPARATOR = '|';

function canonicalString(p: TokenPayload): string {
  // Pipe-delimited because ISO 8601 issuedAt contains colons — we'd
  // split into > 3 fields and reject a perfectly valid token if we
  // used ':'. '|' is absent from both uuid v4 and the ISO 8601
  // subset we emit, so it's an unambiguous framing character.
  return `${p.clinicId}${FIELD_SEPARATOR}${p.clinicianId}${FIELD_SEPARATOR}${p.issuedAt}`;
}

function signBytes(canonical: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(canonical).digest();
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(str: string): Buffer | null {
  const normalised = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalised.length % 4)) % 4;
  const padded = normalised + '='.repeat(padLen);
  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

/**
 * Mint a new subscription token for the given clinician. The
 * caller is responsible for persisting `issuedAt` into the
 * clinician's staff_settings so future verifyToken() calls can
 * reject older tokens after a rotation. Returns the token string
 * as it appears in the webcal URL.
 *
 * Throws IcalSecretMissingError when `secret` is missing / empty.
 */
export function mintToken(
  payload: TokenPayload,
  secret: string | null | undefined,
): IcalToken {
  const s = normaliseSecret(secret);
  const canonical = canonicalString(payload);
  const sig = signBytes(canonical, s);
  const payloadPart = base64UrlEncode(Buffer.from(canonical, 'utf8'));
  const sigPart = base64UrlEncode(sig);
  return `${payloadPart}.${sigPart}`;
}

/**
 * Verify a subscription token. Returns the decoded payload on
 * success, null on any failure mode (bad format, bad signature,
 * unknown clinician, rotated issuedAt). Callers MUST treat null
 * as "401 token invalid" — do NOT surface a more specific reason
 * because doing so hands an attacker free oracle information.
 */
export function verifyToken(
  token: IcalToken,
  expectedClinicianId: string,
  expectedIssuedAt: string,
  secret: string | null | undefined,
): TokenPayload | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;

  const payloadBuf = base64UrlDecode(payloadPart);
  const sigBuf = base64UrlDecode(sigPart);
  if (!payloadBuf || !sigBuf) return null;

  let s: string;
  try {
    s = normaliseSecret(secret);
  } catch {
    // Missing secret = no token can ever be valid. Never throw
    // into the request handler — return null and let the route
    // emit a 401.
    return null;
  }

  const canonical = payloadBuf.toString('utf8');
  const expectedSig = signBytes(canonical, s);

  // timingSafeEqual requires the two buffers to be the same
  // length. A mismatched length is trivially "invalid" — we
  // reject without calling the function (which would throw).
  if (expectedSig.length !== sigBuf.length) return null;
  if (!timingSafeEqual(expectedSig, sigBuf)) return null;

  // Parse the payload fields. Any missing field = reject.
  const fields = canonical.split(FIELD_SEPARATOR);
  if (fields.length !== 3) return null;
  const [clinicId, clinicianId, issuedAt] = fields;
  if (!clinicId || !clinicianId || !issuedAt) return null;

  // Clinician and issuedAt must match the persisted row. This is
  // the rotation knob: updating staff_settings.icalTokenIssuedAt
  // invalidates every token embedded with an older issuedAt.
  if (clinicianId !== expectedClinicianId) return null;
  if (issuedAt !== expectedIssuedAt) return null;

  return { clinicId, clinicianId, issuedAt };
}
