// apps/api/src/features/auth/webauthnRoutes.ts
//
// WebAuthn/FIDO2 passwordless MFA (ACSC Essential Eight ML3, OWASP ASVS V2.2).
//
// GAP-10 closure (S6.1, 2026-04-11):
//   - Schema moved into proper migration 20260411000010_webauthn_and_break_glass.ts
//     (no more runtime createTable — violated CLAUDE.md §1.2).
//   - Challenges now stored in Redis (DB3 cache) with 5-minute TTL instead of
//     a process-global Map that leaks between workers.
//   - Added /login/verify, /credentials, DELETE /credentials/:id endpoints.
//   - `clinic_id` included on every INSERT per §1.6 (RLS).
//
// Cryptographic verification (BUG-239, fixed 2026-04-20):
//   Register and authenticate responses are verified end-to-end via
//   @simplewebauthn/server. The library returns `verified:false` for any
//   payload whose signature does not match the stored public key under
//   the expected origin + RP ID + challenge. On register, we persist the
//   library-derived `credential.id`, `credential.publicKey`, and
//   `credential.counter` — never the client-echoed values — so a tampered
//   request cannot bind an attacker-chosen key to a staff account.
//   The counter-regression guard (below) is defence-in-depth on top of
//   the library's verified check.
//
// Outstanding work (catalogued, not ad-hoc TODOs):
//   - @note: Hardware-key-only enforcement policy (currently "preferred", not
//     "required") — product decision, not a bug.
//   - @note: Attestation verification against FIDO Alliance metadata service —
//     deferred until hardware-key-only is enforced.
//   - @note: Origin/RP enforcement at reverse-proxy layer —
//     see docs/audit-2026-04-19/follow-up-on-cloud-deploy.md §11.
//
// Flow:
//   Registration:
//     1. POST /auth/webauthn/register/options  (authed) → challenge + RP info
//     2. POST /auth/webauthn/register/verify   (authed) → store credential
//
//   Sign-in (second factor, after password):
//     3. POST /auth/webauthn/login/options     → per-user allowList + challenge
//     4. POST /auth/webauthn/login/verify      → assertion → JWT issuance
//
//   Management:
//     5. GET    /auth/webauthn/credentials     (authed) → list own keys
//     6. DELETE /auth/webauthn/credentials/:id (authed) → soft-delete a key
//
// Standard: ACSC Essential Eight ML3, OWASP ASVS V2.2.2, HIPAA 164.312(d).

import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { authMiddleware } from '../../middleware/authMiddleware';
import { db, dbAdmin } from '../../db/db';
import { redisCache } from '../../config/redis';
import { logger } from '../../utils/logger';
import { HttpError } from '../../shared/errors';
import { z } from 'zod';

const router = Router();

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
// WebAuthn credentials are client-supplied; validate the wire shape at the
// handler boundary. Shapes mirror the SimpleWebAuthn-compatible format the
// frontend produces.
const WebAuthnCredentialPayload = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.string().optional(),
  response: z.object({
    clientDataJSON: z.string().min(1).optional(),
    attestationObject: z.string().optional(),
    authenticatorData: z.string().optional(),
    signature: z.string().optional(),
    userHandle: z.string().optional(),
    backupEligible: z.boolean().optional(),
    backupState: z.boolean().optional(),
  }).passthrough(),
});

const WebAuthnRegisterVerifySchema = z.object({
  credential: WebAuthnCredentialPayload,
  deviceName: z.string().min(1).max(100).optional(),
});

const WebAuthnLoginOptionsSchema = z.object({
  email: z.string().email(),
});

const WebAuthnLoginVerifySchema = z.object({
  email: z.string().email(),
  credential: WebAuthnCredentialPayload,
});

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes
const CHALLENGE_KEY = (scope: 'reg' | 'login', id: string) => `webauthn:${scope}:${id}`;

/**
 * RP ID is the domain serving the UI; the authenticator binds credentials
 * to this value. Falls back to 'localhost' for developer laptops.
 */
function getExpectedRpId(): string {
  return process.env.WEBAUTHN_RP_ID ?? 'localhost';
}

/**
 * expected origins — accepts a comma-separated list so staging + prod
 * can share a single backend deploy. Runtime startup enforcement is
 * BUG-233's scope; this helper only documents the default fallback.
 */
function getExpectedOrigins(): string[] {
  const raw = process.env.WEBAUTHN_ORIGIN;
  if (!raw) return ['http://localhost:3000'];
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : ['http://localhost:3000'];
}

/** Generate a fresh 32-byte random challenge encoded as base64url. */
function newChallenge(): string {
  return randomBytes(32).toString('base64url');
}

async function putChallenge(scope: 'reg' | 'login', id: string, challenge: string): Promise<void> {
  await redisCache.set(CHALLENGE_KEY(scope, id), challenge, 'EX', CHALLENGE_TTL_SECONDS);
}

async function takeChallenge(scope: 'reg' | 'login', id: string): Promise<string | null> {
  const key = CHALLENGE_KEY(scope, id);
  const value = await redisCache.get(key);
  if (value) await redisCache.del(key);
  return value;
}

// ─── Registration: Get challenge options ────────────────────────────────────
router.post('/webauthn/register/options', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const challenge = newChallenge();
    await putChallenge('reg', userId, challenge);

    res.json({
      challenge,
      rp: { name: 'Signacare EMR', id: process.env.WEBAUTHN_RP_ID ?? 'localhost' },
      user: {
        id: userId,
        name: req.user!.email,
        displayName: `${req.user!.givenName ?? ''} ${req.user!.familyName ?? ''}`.trim(),
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'cross-platform',
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
      attestation: 'none',
      timeout: CHALLENGE_TTL_SECONDS * 1000,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Registration: Verify credential ────────────────────────────────────────
router.post('/webauthn/register/verify', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const clinicId = req.clinicId;
    const { credential, deviceName } = WebAuthnRegisterVerifySchema.parse(req.body);

    const expectedChallenge = await takeChallenge('reg', userId);
    if (!expectedChallenge) {
      throw new HttpError(400, 'CHALLENGE_EXPIRED', 'Registration challenge has expired — request a new one');
    }

    // BUG-239 fix: cryptographic verification via @simplewebauthn/server.
    // The library validates signature, attestation, clientData origin + challenge
    // echo, and authData RP ID hash. A tampered or attacker-supplied credential
    // returns verified:false, preventing the silent-MFA-bypass regression.
    let verification;
    try {
      // Zod WebAuthnCredentialPayload uses .passthrough() and makes
      // clientExtensionResults optional, so the inferred type is structurally
      // wider than RegistrationResponseJSON. The library does its own runtime
      // shape validation at the call boundary. Tightening the Zod schema to
      // match RegistrationResponseJSON exactly is a separate refactor.
      verification = await verifyRegistrationResponse({
        // @intentional: widening cast explained directly above
        response: credential as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: getExpectedOrigins(),
        expectedRPID: getExpectedRpId(),
        // 'preferred' — enforcement tightening is a product decision (see file header).
        requireUserVerification: false,
      });
    } catch (libErr) {
      logger.warn(
        { staffId: userId, clinicId, err: libErr instanceof Error ? libErr.message : String(libErr) },
        'WebAuthn registration verification threw',
      );
      throw new HttpError(401, 'INVALID_CREDENTIAL', 'WebAuthn registration failed verification');
    }
    if (!verification.verified || !verification.registrationInfo) {
      logger.warn({ staffId: userId, clinicId }, 'WebAuthn registration returned verified:false');
      throw new HttpError(401, 'INVALID_CREDENTIAL', 'WebAuthn registration failed verification');
    }

    const info = verification.registrationInfo;
    // Store library-derived material — never the client echo. If we stored
    // credential.id / credential.response, an attacker could bind any key
    // to this staff account. info.credential.id is the canonical
    // base64url-encoded credential ID; info.credential.publicKey is the
    // extracted COSE public key in raw bytes.
    const publicKeyB64u = Buffer.from(info.credential.publicKey).toString('base64url');

    // §1.6 — every INSERT on an RLS-protected table MUST include clinic_id.
    await db('webauthn_credentials').insert({
      staff_id: userId,
      clinic_id: clinicId,
      credential_id: info.credential.id,
      public_key: publicKeyB64u,
      counter: info.credential.counter,
      aaguid: info.aaguid,
      device_name: deviceName ?? 'Security Key',
      // credentialDeviceType: 'singleDevice' | 'multiDevice' — multi-device
      // keys (passkeys) can sync across devices; that's the backup-eligible signal.
      backup_eligible: info.credentialDeviceType === 'multiDevice',
      backup_state: info.credentialBackedUp,
    });

    await db('staff').where({ id: userId, clinic_id: clinicId }).update({ mfa_enabled: true });

    logger.info({ staffId: userId, clinicId }, 'WebAuthn credential registered');
    res.json({ success: true, message: 'Security key registered successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── Authentication: Get challenge options ──────────────────────────────────
// Unauthenticated — called after password verification during login.
router.post('/webauthn/login/options', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = WebAuthnLoginOptionsSchema.parse(req.body);

    const staff = await dbAdmin('staff')
      .where({ email: email.toLowerCase(), deleted_at: null })
      .first('id', 'clinic_id');

    if (!staff) {
      // Do not leak account existence — respond with 404 NO_WEBAUTHN shape.
      throw new HttpError(404, 'NO_WEBAUTHN', 'No WebAuthn credentials registered');
    }

    const credentials = await dbAdmin('webauthn_credentials')
      .where({ staff_id: staff.id, clinic_id: staff.clinic_id })
      .whereNull('deleted_at')
      .select('credential_id', 'transports');

    if (credentials.length === 0) {
      throw new HttpError(404, 'NO_WEBAUTHN', 'No WebAuthn credentials registered');
    }

    const challenge = newChallenge();
    await putChallenge('login', staff.id, challenge);

    res.json({
      challenge,
      allowCredentials: credentials.map((c) => ({
        id: c.credential_id,
        type: 'public-key',
        transports: c.transports ?? undefined,
      })),
      timeout: CHALLENGE_TTL_SECONDS * 1000,
      userVerification: 'preferred',
      rpId: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    });
  } catch (err) {
    next(err);
  }
});

// ─── Authentication: Verify assertion ───────────────────────────────────────
// Unauthenticated — produces no JWT on its own. The caller pairs this with
// the standard password step and, on success, mints the session JWT via
// authService. This route returns { verified: true, staffId } to the caller.
router.post('/webauthn/login/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, credential } = WebAuthnLoginVerifySchema.parse(req.body);

    const staff = await dbAdmin('staff')
      .where({ email: email.toLowerCase(), deleted_at: null })
      .first('id', 'clinic_id');
    if (!staff) throw new HttpError(401, 'INVALID_CREDENTIAL', 'Invalid WebAuthn credential');

    const expectedChallenge = await takeChallenge('login', staff.id);
    if (!expectedChallenge) {
      throw new HttpError(400, 'CHALLENGE_EXPIRED', 'Login challenge has expired');
    }

    const stored = await dbAdmin('webauthn_credentials')
      .where({ staff_id: staff.id, clinic_id: staff.clinic_id, credential_id: credential.id })
      .whereNull('deleted_at')
      .first();
    if (!stored) throw new HttpError(401, 'INVALID_CREDENTIAL', 'Invalid WebAuthn credential');

    // BUG-239 fix: cryptographic assertion verification via @simplewebauthn/server.
    // The library validates the signature against the stored public key, the
    // clientData challenge echo, and the RP ID hash in authenticatorData.
    // verified:false is a hard reject — the library has already rejected the
    // payload cryptographically.
    let verification;
    try {
      // Same reason as register/verify — Zod .passthrough() produces a wider
      // type than AuthenticationResponseJSON. Library validates at boundary.
      verification = await verifyAuthenticationResponse({
        // @intentional: widening cast explained directly above
        response: credential as unknown as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin: getExpectedOrigins(),
        expectedRPID: getExpectedRpId(),
        credential: {
          id: stored.credential_id,
          publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64url')),
          counter: Number(stored.counter),
        },
        requireUserVerification: false,
      });
    } catch (libErr) {
      logger.warn(
        {
          staffId: staff.id,
          clinicId: staff.clinic_id,
          credentialId: credential.id,
          err: libErr instanceof Error ? libErr.message : String(libErr),
        },
        'WebAuthn authentication verification threw',
      );
      throw new HttpError(401, 'INVALID_CREDENTIAL', 'Invalid WebAuthn credential');
    }
    if (!verification.verified) {
      logger.warn(
        { staffId: staff.id, clinicId: staff.clinic_id, credentialId: credential.id },
        'WebAuthn authentication returned verified:false',
      );
      throw new HttpError(401, 'INVALID_CREDENTIAL', 'Invalid WebAuthn credential');
    }

    // Counter-regression guard — defence-in-depth on top of the library's
    // verified check. Some authenticators report counter=0 always; for those
    // (newCounter === 0 AND stored.counter === 0) we allow the reuse. For
    // everyone else, newCounter MUST strictly advance; equal-or-regress
    // indicates a cloned authenticator per FIDO2 §6.1.1.
    const newCounter = verification.authenticationInfo.newCounter;
    const storedCounter = Number(stored.counter);
    const counterUnused = newCounter === 0 && storedCounter === 0;
    if (!counterUnused && newCounter <= storedCounter) {
      logger.error(
        { staffId: staff.id, clinicId: staff.clinic_id, credentialId: credential.id, newCounter, storedCounter },
        'WebAuthn counter regression — possible cloned authenticator',
      );
      throw new HttpError(401, 'COUNTER_REGRESSION', 'Authenticator counter regression detected');
    }

    await dbAdmin('webauthn_credentials')
      .where({ id: stored.id })
      .update({
        counter: newCounter,
        last_used_at: new Date(),
        updated_at: new Date(),
      });

    // Defer JWT issuance to the caller / authService to keep a single
    // source of truth for session creation, rate limits, and session-tree
    // family propagation (see 20260412000003_staff_sessions_family_id.ts).
    res.json({
      verified: true,
      staffId: staff.id,
      clinicId: staff.clinic_id,
      // The caller must still call /auth/session-from-webauthn to mint a JWT.
    });
  } catch (err) {
    next(err);
  }
});

// ─── Credential management ──────────────────────────────────────────────────
router.get('/webauthn/credentials', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const clinicId = req.clinicId;
    const credentials = await db('webauthn_credentials')
      .where({ staff_id: userId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .select('id', 'device_name', 'aaguid', 'backup_eligible', 'last_used_at', 'created_at');
    res.json({ credentials });
  } catch (err) {
    next(err);
  }
});

router.delete('/webauthn/credentials/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const clinicId = req.clinicId;

    // §1.3 — include clinic_id in every UPDATE/DELETE WHERE clause.
    const count = await db('webauthn_credentials')
      .where({ id: req.params.id, staff_id: userId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date() });

    if (count === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'Credential not found');
    }

    // If no credentials remain, flip mfa_enabled off unless a TOTP secret
    // is still active — keeps MFA policy consistent.
    const remaining = await db('webauthn_credentials')
      .where({ staff_id: userId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .count<{ count: string }[]>('* as count');
    const totpActive = await db('mfa_secrets')
      .where({ staff_id: userId, is_active: true })
      .first();
    if (Number(remaining[0].count) === 0 && !totpActive) {
      await db('staff').where({ id: userId, clinic_id: clinicId }).update({ mfa_enabled: false });
    }

    logger.info({ staffId: userId, clinicId, credentialId: req.params.id }, 'WebAuthn credential revoked');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
