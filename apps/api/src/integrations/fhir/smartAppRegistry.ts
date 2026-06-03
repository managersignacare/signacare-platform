// apps/api/src/integrations/fhir/smartAppRegistry.ts
//
// SMART on FHIR App Registry — equivalent to Epic's App Orchard
//
// Allows third-party FHIR apps to:
//   1. Register with Signacare EMR
//   2. Request specific scopes (patient/*.read, user/*.write, etc.)
//   3. Launch within the EMR context (EHR launch)
//   4. Launch standalone (patient picker)
//
// Each registered app gets a client_id and can configure:
//   - Redirect URIs (whitelist)
//   - Requested scopes
//   - App type (confidential or public)
//   - Launch context requirements

import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../../db/db';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { logger } from '../../utils/logger';
import { config } from '../../config/config';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Matches smart_apps baseline Section M.
const SMART_APP_COLUMNS = [
  'id', 'clinic_id', 'client_id', 'client_secret_hash',
  'name', 'description', 'vendor', 'vendor_url', 'logo_url',
  'app_type', 'redirect_uris', 'scopes', 'launch_modes',
  'is_active', 'is_approved', 'approved_by_id', 'approved_at',
  'created_at', 'updated_at',
] as const;

const router = Router();

// S3.1a: helpers
function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ── App Registry CRUD (admin only) ──────────────────────────────────────────
//
// S3.1a: the lazy create-on-first-request table block has been removed.
// Migration 20260411000002_smart_oauth_tables.ts now owns the schema and
// adds the client_secret_hash column alongside the legacy client_secret
// column for backwards compat. New rows write the hash; the plaintext
// is returned to the client ONCE (in the registration response) and
// never stored.

// GET /fhir/apps — List registered SMART apps
router.get('/apps', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apps = await db('smart_apps').where({ clinic_id: req.clinicId });
    res.json({ apps });
  } catch (err) { next(err); }
});

// POST /fhir/apps — Register a new SMART app
router.post('/apps', authMiddleware, requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, vendor, vendorUrl, logoUrl, appType, redirectUris, scopes, launchModes } = req.body;

      if (!name || !redirectUris?.length || !scopes?.length) {
        res.status(400).json({ error: 'name, redirectUris, and scopes are required' });
        return;
      }

      // Validate scopes
      const VALID_SCOPES = [
        'patient/*.read', 'patient/*.write', 'patient/Patient.read', 'patient/Observation.read',
        'patient/Condition.read', 'patient/MedicationStatement.read', 'patient/AllergyIntolerance.read',
        'user/*.read', 'user/*.write', 'launch', 'launch/patient', 'openid', 'fhirUser', 'offline_access',
      ];
      const invalidScopes = (scopes as string[]).filter((s: string) => !VALID_SCOPES.includes(s));
      if (invalidScopes.length > 0) {
        res.status(400).json({ error: `Invalid scopes: ${invalidScopes.join(', ')}`, validScopes: VALID_SCOPES });
        return;
      }

      // Validate redirect URIs (must be HTTPS in production, allow localhost in dev)
      for (const uri of redirectUris as string[]) {
        try {
          const u = new URL(uri);
          if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') {
            res.status(400).json({ error: `Redirect URI must use HTTPS: ${uri}` });
            return;
          }
        } catch {
          res.status(400).json({ error: `Invalid redirect URI: ${uri}` });
          return;
        }
      }

      const clientId = `sc_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      // S3.1a: store SHA-256 of the secret, return plaintext to the
      // caller ONCE so they can copy it. A leaked DB cannot be used to
      // impersonate the client.
      const clientSecret = appType === 'public' ? null : randomUUID() + randomUUID();
      const clientSecretHash = clientSecret ? sha256Hex(clientSecret) : null;

      const [app] = await db('smart_apps').insert({
        clinic_id: req.clinicId,
        client_id: clientId,
        client_secret_hash: clientSecretHash,
        name, description: description ?? null,
        vendor: vendor ?? null, vendor_url: vendorUrl ?? null,
        logo_url: logoUrl ?? null,
        app_type: appType ?? 'confidential',
        redirect_uris: redirectUris,
        scopes,
        launch_modes: launchModes ?? ['ehr', 'standalone'],
        is_active: true,
        is_approved: false,
      }).returning(SMART_APP_COLUMNS);

      logger.info({ clientId, name, scopes }, 'SMART app registered');

      // Strip the hash from the response (defence in depth — it's not
      // sensitive on its own but there's no reason to expose it).
      const { client_secret_hash: _hash, ...safeApp } = app as Record<string, unknown>;
      res.status(201).json({
        app: safeApp,
        credentials: {
          clientId,
          clientSecret: clientSecret ?? '(public client — no secret)',
          message: 'Store the client_secret securely. It will not be shown again.',
        },
      });
    } catch (err) { next(err); }
  },
);

// PATCH /fhir/apps/:appId — Update app (admin)
router.patch('/apps/:appId', authMiddleware, requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description, redirectUris, scopes, isActive, isApproved } = req.body;
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (name !== undefined) patch.name = name;
      if (description !== undefined) patch.description = description;
      if (redirectUris !== undefined) patch.redirect_uris = redirectUris;
      if (scopes !== undefined) patch.scopes = scopes;
      if (isActive !== undefined) patch.is_active = isActive;
      if (isApproved !== undefined) {
        patch.is_approved = isApproved;
        patch.approved_by_id = req.user!.id;
        patch.approved_at = new Date();
      }

      const [app] = await db('smart_apps')
        .where({ id: req.params.appId, clinic_id: req.clinicId })
        .update(patch)
        .returning(SMART_APP_COLUMNS);

      if (!app) { res.status(404).json({ error: 'App not found' }); return; }
      res.json({ app });
    } catch (err) { next(err); }
  },
);

// DELETE /fhir/apps/:appId — Deactivate app
router.delete('/apps/:appId', authMiddleware, requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await db('smart_apps')
        .where({ id: req.params.appId, clinic_id: req.clinicId })
        .update({ is_active: false, updated_at: new Date() });
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ── EHR Launch ──────────────────────────────────────────────────────────────

// GET /fhir/launch/:appId — EHR Launch endpoint (called from within EMR UI)
// S3.1a: launch context now persisted to smart_launch_contexts table
// instead of an in-process globalThis Map. Survives restart and works
// across cluster replicas.
router.get('/launch/:appId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await db('smart_apps')
      .where({ id: req.params.appId, clinic_id: req.clinicId, is_active: true, is_approved: true })
      .first();

    if (!app) { res.status(404).json({ error: 'App not found or not approved' }); return; }

    const patientId = req.query.patient as string | undefined;
    const encounterId = req.query.encounter as string | undefined;
    const launchToken = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db('smart_launch_contexts').insert({
      launch_token: launchToken,
      client_id: app.client_id,
      clinic_id: req.clinicId,
      user_id: req.user!.id,
      patient_id: patientId ?? null,
      encounter_id: encounterId ?? null,
      scopes: app.scopes,
      expires_at: expiresAt,
    });

    // Redirect to app's first redirect URI with launch token + iss.
    // The SMART app will then call /fhir/auth/authorize?launch=<token>&iss=<base>
    // and the authorize handler will resolve the launch context.
    const redirectUri = app.redirect_uris[0];
    const url = new URL(redirectUri);
    url.searchParams.set('launch', launchToken);
    url.searchParams.set('iss', `${config.apiBaseUrl}/api/v1/fhir`);

    logger.info({ appId: app.id, appName: app.name, patientId }, 'SMART EHR launch initiated');

    res.redirect(url.toString());
  } catch (err) { next(err); }
});

export default router;
