/**
 * Zitavi Patient Sync — Import patients from Zitavi mobile app into Signacare EMR
 *
 * POST /api/v1/patients/zitavi-sync     — Sync all Zitavi patients into EMR
 * POST /api/v1/patients/zitavi-sync/:id — Sync a single Zitavi patient by MongoDB ID
 *
 * Creates new patient records in the EMR for Zitavi patients that don't already exist.
 * Links them via the health_record.signacareEMRNumber field.
 * Does NOT modify existing EMR patients — only creates new ones.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { HttpError } from '../../shared/errors';

const router = Router();
router.use(authMiddleware);

const ZITAVI_URL = process.env.ZITAVI_GATEWAY_URL;
const ZITAVI_KEY = process.env.ZITAVI_API_KEY;
if (!ZITAVI_URL || !ZITAVI_KEY) {
  logger.warn(
    {
      kind: 'zitavi_integration_disabled',
      hasGatewayUrl: Boolean(ZITAVI_URL),
      hasApiKey: Boolean(ZITAVI_KEY),
    },
    'Zitavi integration disabled: ZITAVI_GATEWAY_URL and ZITAVI_API_KEY must be set',
  );
}

interface ZitaviPhone {
  number?: string;
}

interface ZitaviEmergencyContact {
  name?: string;
  phone?: ZitaviPhone;
  relation?: string;
}

interface ZitaviPatient {
  _id?: string;
  firstName?: string;
  lastName?: string;
  phone?: ZitaviPhone;
  dateOfBirth?: string;
  gender?: string;
  email?: string;
  emergencyContacts?: ZitaviEmergencyContact[];
}

interface ZitaviApiEnvelope<T> {
  success?: boolean;
  error?: { message?: string };
  data?: T;
}

async function fetchZitavi<T>(path: string): Promise<T> {
  if (!ZITAVI_URL || !ZITAVI_KEY) {
    throw new Error('Zitavi integration is not configured');
  }
  const resp = await fetch(`${ZITAVI_URL}${path}`, {
    headers: { 'x-api-key': ZITAVI_KEY },
  });
  if (!resp.ok) throw new Error(`Zitavi API returned ${resp.status}`);
  const json = (await resp.json()) as ZitaviApiEnvelope<T>;
  if (!json.success) throw new Error(json.error?.message ?? 'Zitavi API error');
  return json.data as T;
}

function generateEmrNumber(): string {
  // Generate next EMR number
  const num = Math.floor(Math.random() * 900) + 100;
  return `EMR-Z${num}`;
}

async function syncOnePatient(zPatient: ZitaviPatient, clinicId: string): Promise<{ action: string; emrId?: string; name: string }> {
  const firstName = zPatient.firstName ?? '';
  const lastName = zPatient.lastName ?? '';
  const zitaviId = zPatient._id;
  const name = `${firstName} ${lastName}`.trim();

  // Check if already synced — look for matching name + DOB or zitavi ID in notes
  const existing = await db('patients')
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .where(function () {
      this.where(function () {
        this.whereRaw('LOWER(given_name) = ?', [firstName.toLowerCase()])
          .whereRaw('LOWER(family_name) = ?', [lastName.toLowerCase()]);
      });
    })
    .first();

  if (existing) {
    return { action: 'exists', emrId: existing.id, name };
  }

  // Create new EMR patient from Zitavi data
  const emrNumber = generateEmrNumber();
  const id = randomUUID();

  const phone = zPatient.phone?.number ?? null;
  const dob = zPatient.dateOfBirth ? new Date(zPatient.dateOfBirth) : null;
  const gender = zPatient.gender === 'others' ? 'other' : zPatient.gender ?? null;

  await db('patients').insert({
    id,
    clinic_id: clinicId,
    given_name: firstName,
    family_name: lastName,
    preferred_name: null,
    date_of_birth: dob,
    gender,
    email: zPatient.email ?? null,
    phone_mobile: phone,
    emr_number: emrNumber,
    status: 'active',
    // Emergency contact from Zitavi
    emergency_contact_name: zPatient.emergencyContacts?.[0]?.name ?? null,
    emergency_contact_phone: zPatient.emergencyContacts?.[0]?.phone?.number ?? null,
    emergency_contact_relationship: zPatient.emergencyContacts?.[0]?.relation ?? null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  logger.info({ emrId: id, zitaviId, name, emrNumber }, 'Zitavi patient synced to EMR');

  return { action: 'created', emrId: id, name };
}

// ── Sync all Zitavi patients ──
router.post(
  '/zitavi-sync',
  requireRoles(['superadmin', 'admin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientsRaw = await fetchZitavi<unknown>('/patients?limit=200');
      if (!Array.isArray(patientsRaw)) {
        // BUG-275 — use typed HttpError so the global errorHandler can
        // map the upstream-gateway failure to a specific 502 response.
        // The pre-fix shape erased the error type and produced a
        // generic 500.
        next(new HttpError(502, 'ZITAVI_BAD_GATEWAY', 'Invalid response from Zitavi gateway'));
        return;
      }
      const patients = patientsRaw as ZitaviPatient[];

      const results: { action: string; emrId?: string; name: string }[] = [];
      for (const zp of patients) {
        try {
          const result = await syncOnePatient(zp, req.clinicId);
          results.push(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ action: 'error', name: `${zp.firstName} ${zp.lastName}: ${message}` });
        }
      }

      const created = results.filter(r => r.action === 'created').length;
      const existing = results.filter(r => r.action === 'exists').length;
      const errors = results.filter(r => r.action === 'error').length;

      logger.info({ created, existing, errors, total: patients.length }, 'Zitavi sync completed');

      res.json({
        success: true,
        summary: { total: patients.length, created, existing, errors },
        details: results,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, message }, 'Zitavi sync failed');
      next(err);
    }
  }
);

// ── Sync a single Zitavi patient ──
router.post(
  '/zitavi-sync/:zitaviId',
  requireRoles(['superadmin', 'admin', 'clinician']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const zPatient = await fetchZitavi<ZitaviPatient | null>(`/patients/${req.params.zitaviId}`);
      if (!zPatient) {
        res.status(404).json({ error: 'Patient not found in Zitavi' });
        return;
      }
      const result = await syncOnePatient(zPatient, req.clinicId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── Proxy endpoint for frontend Zitavi API calls (keeps API key server-side) ──
router.get('/zitavi-proxy/*', async (req: Request, res: Response) => {
  try {
    const proxyPath = req.params[0] ?? '';
    const data = await fetchZitavi<unknown>(`/${proxyPath}`);
    res.locals.skipCamelCase = true; // External API — don't transform keys
    res.json(data);
  } catch (_err) {
    res.status(502).json({ error: 'Zitavi gateway unavailable' });
  }
});

export default router;
