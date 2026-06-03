// apps/api/src/integrations/fhir/smartAuth.ts
//
// SMART on FHIR / OAuth 2 Authorization Server (HL7 SMART App Launch v2.0)
// Required by: ADHA Conformance Framework, FHIR R4 AU Core, Cures Act
//
// S3.1a hardening pass — replaces the prior in-memory authCodes Map and
// trusting-by-default client_id check with a real OAuth 2 server backed
// by the migration tables added in 20260411000002_smart_oauth_tables.ts.
//
// Endpoints:
//
//   GET  /fhir/.well-known/smart-configuration  Public discovery doc
//   GET  /fhir/auth/authorize                   PKCE-required auth start
//   POST /fhir/auth/token                       Code -> token, refresh
//   POST /fhir/auth/introspect                  RFC 7662 token introspection
//   POST /fhir/auth/revoke                      RFC 7009 token revocation
//
// Hardening summary vs the pre-S3.1a code:
//
//   - client_id and redirect_uri are now validated against the smart_apps
//     table at /authorize. An unknown client or unregistered redirect_uri
//     gets a 400 with no redirect (RFC 6749 §10.6 — open redirect guard).
//   - PKCE is REQUIRED on /authorize and verified on /token.
//   - client_secret is checked at /token for confidential clients.
//   - Authorization codes are persisted (oauth_authorization_codes), not
//     stored in a process-local Map. They survive restarts and work in a
//     cluster of replicas.
//   - Refresh tokens are issued for clients with the offline_access scope.
//     Rotation is enforced — using a refresh token marks the row consumed
//     and the new token is the one that goes back to the client.
//   - Issued access tokens are recorded in oauth_access_tokens so revoke
//     and introspect can work without verifying the JWT signature alone.
//   - Codes and tokens are stored as SHA-256 hashes; a leaked DB doesn't
//     hand out usable secrets.
//
// Naming compliance:
//   DB columns snake_case. HTTP responses are spec-mandated snake_case
//   (access_token, expires_in, etc.) — protected by the existing /fhir/
//   exemption in apps/api/src/middleware/camelCaseResponse.ts.

import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { isUserRevokedAfter } from '../../middleware/jwtBlacklist';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function newOpaqueToken(byteLen = 32): string {
  // 32 bytes -> 43-char base64url. Cryptographically random.
  return randomBytes(byteLen).toString('base64url');
}

/** Constant-time string equality. Both args must be the same length. */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * SMART App Launch v2 mandates PKCE S256:
 *   code_challenge = BASE64URL(SHA256(code_verifier))
 * Verifier comes back at /token; we re-derive and compare.
 */
function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const derived = createHash('sha256').update(verifier).digest('base64url');
  return safeEquals(derived, challenge);
}

interface SmartAppRow {
  id: string;
  clinic_id: string;
  client_id: string;
  client_secret_hash: string | null;
  app_type: string; // 'confidential' | 'public'
  redirect_uris: string[];
  scopes: string[];
  is_active: boolean;
  is_approved: boolean;
}

async function findApprovedApp(clientId: string): Promise<SmartAppRow | null> {
  const row = await db<SmartAppRow>('smart_apps')
    .where({ client_id: clientId, is_active: true, is_approved: true })
    .first();
  return row ?? null;
}

// ── Discovery (public, unauthenticated) ──────────────────────────────────────

router.get('/.well-known/smart-configuration', (_req: Request, res: Response) => {
  const baseUrl = config.apiBaseUrl;
  res.json({
    issuer: `${baseUrl}/api/v1/fhir`,
    authorization_endpoint: `${baseUrl}/api/v1/fhir/auth/authorize`,
    token_endpoint: `${baseUrl}/api/v1/fhir/auth/token`,
    introspection_endpoint: `${baseUrl}/api/v1/fhir/auth/introspect`,
    revocation_endpoint: `${baseUrl}/api/v1/fhir/auth/revoke`,
    capabilities: [
      'launch-ehr',
      'launch-standalone',
      'client-public',
      'client-confidential-symmetric',
      'context-ehr-patient',
      'context-standalone-patient',
      'sso-openid-connect',
      'permission-patient',
      'permission-user',
      'permission-offline',
    ],
    scopes_supported: [
      'patient/*.read',
      'patient/*.write',
      'user/*.read',
      'user/*.write',
      'launch',
      'launch/patient',
      'openid',
      'fhirUser',
      'offline_access',
    ],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  });
});

// ── Authorization endpoint ───────────────────────────────────────────────────
//
// SMART standalone-launch flow: app requests authorization, user
// authenticates, app receives a one-time code, app exchanges code at
// /token. PKCE is required.
//
// In dev/test the user auth step is short-circuited (req.user is set
// elsewhere). Production should put this behind a session-based auth
// gate so the user has actually logged in first.

router.get('/auth/authorize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
      launch,
      aud,
    } = req.query as Record<string, string | undefined>;

    if (response_type !== 'code') {
      res.status(400).json({ error: 'unsupported_response_type' });
      return;
    }
    if (!client_id || !redirect_uri) {
      res.status(400).json({ error: 'invalid_request', error_description: 'client_id and redirect_uri required' });
      return;
    }
    if (!code_challenge || code_challenge_method !== 'S256') {
      res.status(400).json({ error: 'invalid_request', error_description: 'PKCE S256 required' });
      return;
    }

    const app = await findApprovedApp(client_id);
    if (!app) {
      // Don't redirect — RFC 6749 §10.6 says unknown clients must NOT be
      // redirected (open redirect class).
      res.status(400).json({ error: 'invalid_client' });
      return;
    }
    if (!app.redirect_uris.includes(redirect_uri)) {
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    // The aud parameter MUST equal the FHIR base URL (SMART spec). We
    // accept missing for backward compat with the prior scaffold.
    const fhirBase = `${config.apiBaseUrl}/api/v1/fhir`;
    if (aud && aud !== fhirBase) {
      res.status(400).json({ error: 'invalid_request', error_description: 'aud must match FHIR base' });
      return;
    }

    // Look up an EHR launch context if the launch param was provided.
    // The launch token was issued by /fhir/launch/:appId in the registry.
    let launchPatientId: string | null = null;
    if (launch) {
      const ctx = await db('smart_launch_contexts')
        .where({ launch_token: launch, client_id: app.client_id })
        .whereNull('consumed_at')
        .first();
      if (!ctx || new Date(ctx.expires_at).getTime() < Date.now()) {
        res.status(400).json({ error: 'invalid_request', error_description: 'invalid or expired launch token' });
        return;
      }
      launchPatientId = ctx.patient_id ?? null;
      // Mark the launch context consumed so it can't be replayed.
      await db('smart_launch_contexts').where({ id: ctx.id }).update({ consumed_at: new Date() });
    }

    const requestedScopes = (scope ?? '').split(/\s+/).filter(Boolean);
    // Intersect with what the app is registered for.
    const grantedScopes = requestedScopes.filter((s) => app.scopes.includes(s));

    // Generate the auth code, store its hash. The plaintext goes in the
    // redirect.
    const code = newOpaqueToken(32);
    const codeHash = sha256Hex(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    await db('oauth_authorization_codes').insert({
      code_hash: codeHash,
      client_id: app.client_id,
      clinic_id: app.clinic_id,
      // In dev the user is plumbed via req.user. Production must put a
      // login wall in front of this endpoint.
      user_id: (req as Request & { user?: { id: string } }).user?.id ?? app.clinic_id, // dev fallback
      patient_id: launchPatientId,
      redirect_uri,
      scopes: grantedScopes,
      code_challenge,
      code_challenge_method,
      launch_token: launch ?? null,
      expires_at: expiresAt,
    });

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);

    logger.info({ client_id: app.client_id, scopes: grantedScopes }, 'SMART authorize: code issued');
    res.redirect(redirectUrl.toString());
  } catch (err) { next(err); }
});

// ── Token endpoint ───────────────────────────────────────────────────────────

interface DecodedClientCredentials {
  clientId: string;
  clientSecret: string | null;
}

/**
 * Extract client credentials from either Authorization: Basic or the
 * request body (form params). Spec allows either.
 */
function extractClientCredentials(req: Request): DecodedClientCredentials | null {
  const auth = req.header('authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8');
      const [clientId, clientSecret] = decoded.split(':');
      if (clientId) return { clientId, clientSecret: clientSecret ?? null };
    } catch { /* fall through */ }
  }
  const bodyId = req.body?.client_id as string | undefined;
  if (bodyId) {
    return { clientId: bodyId, clientSecret: (req.body?.client_secret as string | undefined) ?? null };
  }
  return null;
}

router.post('/auth/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { grant_type } = req.body ?? {};
    const creds = extractClientCredentials(req);
    if (!creds) {
      res.status(401).json({ error: 'invalid_client', error_description: 'client credentials required' });
      return;
    }

    const app = await findApprovedApp(creds.clientId);
    if (!app) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    // Confidential clients MUST present the secret. Public clients
    // MUST NOT (and we don't care if they do — public means no secret
    // exists in the first place).
    if (app.app_type === 'confidential') {
      if (!creds.clientSecret || !app.client_secret_hash) {
        res.status(401).json({ error: 'invalid_client' });
        return;
      }
      const presentedHash = sha256Hex(creds.clientSecret);
      if (!safeEquals(presentedHash, app.client_secret_hash)) {
        res.status(401).json({ error: 'invalid_client' });
        return;
      }
    }

    if (grant_type === 'authorization_code') {
      return await handleAuthCodeGrant(req, res, app);
    }
    if (grant_type === 'refresh_token') {
      return await handleRefreshTokenGrant(req, res, app);
    }
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  } catch (err) { next(err); }
});

async function handleAuthCodeGrant(req: Request, res: Response, app: SmartAppRow): Promise<void> {
  const { code, redirect_uri, code_verifier } = req.body ?? {};
  if (!code || !redirect_uri || !code_verifier) {
    res.status(400).json({ error: 'invalid_request', error_description: 'code, redirect_uri, code_verifier required' });
    return;
  }

  const codeHash = sha256Hex(code);
  const row = await db('oauth_authorization_codes').where({ code_hash: codeHash }).first();
  if (!row) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }
  if (row.client_id !== app.client_id) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }
  if (row.redeemed_at) {
    // Replay — kill any tokens that were issued from this code in case
    // an attacker has them.
    await db('oauth_access_tokens')
      .where({ client_id: app.client_id, user_id: row.user_id })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date(), revoked_reason: 'auth_code_replay' });
    res.status(400).json({ error: 'invalid_grant', error_description: 'code already redeemed' });
    return;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' });
    return;
  }
  if (row.redirect_uri !== redirect_uri) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    return;
  }
  if (!verifyPkce(code_verifier, row.code_challenge, row.code_challenge_method)) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    return;
  }

  await db('oauth_authorization_codes').where({ id: row.id }).update({ redeemed_at: new Date() });

  const issued = await issueAccessAndRefreshTokens({
    clientId: app.client_id,
    clinicId: row.clinic_id,
    userId: row.user_id,
    patientId: row.patient_id,
    scopes: row.scopes,
  });

  res.json(issued);
}

async function handleRefreshTokenGrant(req: Request, res: Response, app: SmartAppRow): Promise<void> {
  const { refresh_token } = req.body ?? {};
  if (!refresh_token) {
    res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token required' });
    return;
  }
  const tokenHash = sha256Hex(refresh_token);
  const row = await db('oauth_refresh_tokens').where({ token_hash: tokenHash }).first();
  if (!row || row.client_id !== app.client_id) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }
  if (row.revoked_at) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token revoked' });
    return;
  }
  if (row.rotated_to_id) {
    // Replay of an already-rotated refresh token. Revoke the new one too —
    // an attacker likely has it.
    await db('oauth_refresh_tokens').where({ id: row.rotated_to_id }).update({
      revoked_at: new Date(),
      // No revoked_reason column on this table; we keep it sparse.
    });
    res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token replay' });
    return;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token expired' });
    return;
  }

  const issued = await issueAccessAndRefreshTokens({
    clientId: app.client_id,
    clinicId: row.clinic_id,
    userId: row.user_id,
    patientId: row.patient_id,
    scopes: row.scopes,
  });

  // Mark the old refresh token rotated to the new one. The lookup must
  // succeed because we just issued this token — failing here would mean
  // a race or data-integrity bug in issueAccessAndRefreshTokens.
  const newRow = await db('oauth_refresh_tokens')
    .where({ token_hash: sha256Hex(issued.refresh_token!) })
    .first();
  if (!newRow) {
    res.status(500).json({ error: 'server_error', error_description: 'newly issued refresh token not found' });
    return;
  }
  await db('oauth_refresh_tokens').where({ id: row.id }).update({ rotated_to_id: newRow.id });

  res.json(issued);
}

interface IssueParams {
  clientId: string;
  clinicId: string;
  userId: string;
  patientId: string | null;
  scopes: string[];
}

interface IssuedTokens {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
  patient?: string;
}

async function issueAccessAndRefreshTokens(params: IssueParams): Promise<IssuedTokens> {
  const { clientId, clinicId, userId, patientId, scopes } = params;
  const ttlSeconds = 60 * 60; // 1 hour
  const jti = randomUUID();
  const accessToken = jwt.sign(
    {
      sub: userId,
      jti,
      clinicId,
      scope: scopes.join(' '),
      smart: true,
      client_id: clientId,
      ...(patientId ? { patient: patientId } : {}),
    },
    config.jwt.accessSecret,
    { expiresIn: ttlSeconds, audience: clientId },
  );
  const accessExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db('oauth_access_tokens').insert({
    jti,
    client_id: clientId,
    clinic_id: clinicId,
    user_id: userId,
    patient_id: patientId,
    scopes,
    expires_at: accessExpiresAt,
  });

  const response: IssuedTokens = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ttlSeconds,
    scope: scopes.join(' '),
  };

  // Refresh tokens only when the client requested offline_access.
  if (scopes.includes('offline_access')) {
    const refreshToken = newOpaqueToken(48);
    const refreshExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
    await db('oauth_refresh_tokens').insert({
      token_hash: sha256Hex(refreshToken),
      client_id: clientId,
      clinic_id: clinicId,
      user_id: userId,
      patient_id: patientId,
      scopes,
      expires_at: refreshExpiresAt,
    });
    response.refresh_token = refreshToken;
  }

  if (patientId) response.patient = patientId;

  logger.info({ client_id: clientId, scopes, has_refresh: !!response.refresh_token }, 'SMART token issued');
  return response;
}

// ── Introspection (RFC 7662) ─────────────────────────────────────────────────

router.post('/auth/introspect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const creds = extractClientCredentials(req);
    if (!creds) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    const app = await findApprovedApp(creds.clientId);
    if (!app) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    const { token } = req.body ?? {};
    if (!token) {
      res.json({ active: false });
      return;
    }
    let decoded: jwt.JwtPayload | null = null;
    try {
      decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      res.json({ active: false });
      return;
    }
    if (!decoded.jti) {
      res.json({ active: false });
      return;
    }
    const row = await db('oauth_access_tokens').where({ jti: decoded.jti }).first();
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
      res.json({ active: false });
      return;
    }
    // BUG-356 L4 Rule 6 absorb — FHIR introspect is a PHI-egress
    // authorisation surface. If the token's subject staff has been
    // blacklisted since the token was issued (demotion / deactivation
    // / soft-delete), return active:false per RFC 7662 so SMART apps
    // stop honouring the token. `row.user_id` is the staff id; the
    // token's `iat` comes from `row.issued_at`. Fails-open on Redis
    // error with logger.warn (degradation observable, not silent).
    let revoked = false;
    try {
      const issuedAtSec = Math.floor(new Date(row.issued_at).getTime() / 1000);
      revoked = await isUserRevokedAfter(row.user_id as string, issuedAtSec);
    } catch (err) {
      logger.warn(
        { err, userId: row.user_id, kind: 'jwt_blacklist_fail_open', surface: 'fhir_introspect' },
        'BUG-356: FHIR introspect isUserRevokedAfter check failed — failing open',
      );
    }
    if (revoked) {
      res.json({ active: false });
      return;
    }
    res.json({
      active: true,
      scope: (row.scopes as string[]).join(' '),
      client_id: row.client_id,
      sub: row.user_id,
      exp: Math.floor(new Date(row.expires_at).getTime() / 1000),
      iat: Math.floor(new Date(row.issued_at).getTime() / 1000),
      patient: row.patient_id ?? undefined,
    });
  } catch (err) { next(err); }
});

// ── Revocation (RFC 7009) ────────────────────────────────────────────────────

router.post('/auth/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const creds = extractClientCredentials(req);
    if (!creds) {
      // RFC 7009 says unauthenticated revoke MUST still return 200 to
      // avoid leaking which tokens exist. We're stricter: 401.
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    const app = await findApprovedApp(creds.clientId);
    if (!app) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    const { token, token_type_hint } = req.body ?? {};
    if (!token) {
      res.status(200).end();
      return;
    }
    // Try refresh token first if hinted, otherwise try access token,
    // then fall back to refresh token.
    if (token_type_hint === 'refresh_token') {
      await db('oauth_refresh_tokens')
        .where({ token_hash: sha256Hex(token), client_id: app.client_id })
        .update({ revoked_at: new Date() });
    } else {
      try {
        const decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
        if (decoded.jti) {
          await db('oauth_access_tokens')
            .where({ jti: decoded.jti, client_id: app.client_id })
            .update({ revoked_at: new Date(), revoked_reason: 'client_revoked' });
        }
      } catch {
        // Not a JWT — try refresh token table
        await db('oauth_refresh_tokens')
          .where({ token_hash: sha256Hex(token), client_id: app.client_id })
          .update({ revoked_at: new Date() });
      }
    }
    res.status(200).end();
  } catch (err) { next(err); }
});

export default router;
