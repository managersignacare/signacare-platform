// apps/api/src/features/calendar/calendarIcalPublicRoutes.ts
//
// Phase 13 PR2c — the public iCal subscription endpoint.
//
// GET /api/v1/calendar/ical/:clinicianId.ics?token=<HMAC>
//
// This is the ONE calendar route that bypasses authMiddleware —
// Outlook, Google Calendar, and Apple Calendar all subscribe via
// a bare HTTPS URL and can't attach an Authorization header. The
// token in the query string IS the credential.
//
// Security properties:
//
//  1. Token signed with HMAC-SHA256 over `clinicId|clinicianId|issuedAt`
//     (icalTokenService from PR2a). Constant-time compare via
//     crypto.timingSafeEqual.
//
//  2. Token carries the clinician's current issuedAt. We look up
//     the staff_settings row and reject any token whose embedded
//     issuedAt doesn't match. Rotating issuedAt instantly
//     invalidates every previously-subscribed URL for that
//     clinician — the rotation knob.
//
//  3. Rate-limited per-token so a flood from a single stolen URL
//     can't exhaust the app pool. Separate from the global
//     api-rate-limit so legitimate subscribers (one refresh every
//     5-10 minutes per calendar app) aren't counted against the
//     per-IP budget.
//
//  4. Returns null on ANY failure mode — no oracle information
//     about why a token was rejected (bad signature vs. wrong
//     issuedAt vs. unknown clinician). Every failure is a 401.
//
//  5. Looks up the clinician's live staff row to resolve clinic
//     timezone + name for the VTIMEZONE block. No RLS context
//     needed — the query uses dbAdmin because this route has no
//     authenticated session.

import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { dbAdmin } from '../../db/db';
import { config } from '../../config/config';
import { logger } from '../../utils/logger';
import { verifyToken } from './icalTokenService';
import { calendarRepository } from './calendarRepository';
import { calendarService, mapBlockDbToResponse } from './calendarService';
import { buildCalendarIcs } from './icalService';

void calendarService; // Used only for its type — avoid unused-import lint
void mapBlockDbToResponse; // Used by the repo path below

export const calendarIcalPublicRoutes = Router();

// Rate limit per token (not per IP) — 60 fetches / hour is
// generous for subscribers (most apps refresh every 5-15 min).
// express-rate-limit computes the key from the req, we derive
// it from the token query param so a single compromised URL
// can't bleed others' budgets.
const icalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120, // 2 req/min sustained + burst headroom
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    return `rl:ical:${token.slice(0, 32)}`;
  },
  message: {
    error: 'Too many iCal subscription requests. Try again later.',
    code: 'RATE_LIMITED',
  },
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

interface StaffSettingRow {
  setting_value: {
    icalToken?: string;
    icalTokenIssuedAt?: string;
  } | null;
}

interface ClinicianLookupRow {
  staff_clinic_id: string;
  staff_given_name: string;
  staff_family_name: string;
  clinic_time_zone: string;
}

/**
 * Public GET — returns a text/calendar body for a clinician.
 * Path param: :clinicianId.ics
 * Query: ?token=<HMAC>
 *
 * No authMiddleware. The rate limiter + token verification are
 * the entire access control.
 */
calendarIcalPublicRoutes.get(
  '/:clinicianId([0-9a-fA-F-]{8,}).ics',
  icalLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clinicianId = req.params['clinicianId'] ?? '';
      if (!clinicianId) {
        res.status(404).end();
        return;
      }

      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) {
        res.status(401).end();
        return;
      }

      // Look up the clinician's staff row + clinic metadata.
      // Uses dbAdmin (bypasses RLS) because there's no
      // authenticated session to set current_setting('app.clinic_id').
      const lookup = (await dbAdmin('staff')
        .join('clinics', 'clinics.id', 'staff.clinic_id')
        .where('staff.id', clinicianId)
        .whereNull('staff.deleted_at')
        .whereNull('clinics.deleted_at')
        .select({
          staff_clinic_id: 'staff.clinic_id',
          staff_given_name: 'staff.given_name',
          staff_family_name: 'staff.family_name',
          clinic_time_zone: 'clinics.time_zone',
        })
        .first()) as ClinicianLookupRow | undefined;

      if (!lookup) {
        // Clinician doesn't exist OR is deleted. 401, not 404 —
        // don't leak the existence of a specific clinicianId to
        // an attacker with an invalid token.
        res.status(401).end();
        return;
      }

      // Fetch the clinician's current (token, issuedAt) via the
      // same repository path the authenticated management UI
      // uses. If there's no current token OR the embedded
      // issuedAt doesn't match, verify fails.
      const prefsRow = (await dbAdmin('staff_settings')
        .where({ staff_id: clinicianId, setting_key: 'calendar_preferences' })
        .first()) as StaffSettingRow | undefined;

      const currentIssuedAt = prefsRow?.setting_value?.icalTokenIssuedAt;
      if (!currentIssuedAt) {
        res.status(401).end();
        return;
      }

      const payload = verifyToken(
        token,
        clinicianId,
        currentIssuedAt,
        config.calendar.icalSecret,
      );
      if (!payload) {
        res.status(401).end();
        return;
      }

      // Extra belt-and-braces: token.clinicId must match the
      // staff row's clinic_id. This prevents a token minted for
      // clinicianA in clinicX from being replayed against a
      // clinician who has since been transferred to clinicY.
      if (payload.clinicId !== lookup.staff_clinic_id) {
        res.status(401).end();
        return;
      }

      // Fetch the clinician's availability blocks via the
      // repository. No date window — subscribers want everything
      // current. The repo already filters deleted_at + clinic_id.
      const blocks = await calendarRepository.listAvailabilityBlocks({
        clinicId: payload.clinicId,
        clinicianId,
      });

      const ics = buildCalendarIcs({
        clinicId: payload.clinicId,
        clinicianId,
        clinicianName: `${lookup.staff_given_name} ${lookup.staff_family_name}`.trim(),
        clinicTimeZone: lookup.clinic_time_zone,
        blocks: blocks.map(mapBlockDbToResponse),
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="clinician-${clinicianId.slice(0, 8)}.ics"`,
      );
      // 5-minute cache — most subscribers re-fetch more often
      // than this, so the cache-control mostly affects a
      // misbehaving client loop.
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(200).send(ics);
    } catch (err) {
      logger.error({ err }, 'calendarIcalPublicRoutes: unhandled error');
      next(err);
    }
  },
);

export default calendarIcalPublicRoutes;
