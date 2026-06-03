// apps/api/src/features/calendar/calendarRoutes.ts
//
// Phase 13 PR2b — HTTP surface for the calendar feature.
//
// Mounted by server.ts as `app.use(\`${API}/calendar\`, calendarRoutes)`
// so every internal route is relative. Every handler carries
// authMiddleware + tenantMiddleware + requireModuleRead/Write per
// CLAUDE.md §9.4 + §6 — callers need a real auth context AND a
// module-access grant on `calendar`.
//
// Routes:
//
//   GET    /preferences          → clinician's slot/week/ical config
//   PUT    /preferences          → partial update
//   GET    /blocks               → list availability blocks
//   POST   /blocks               → create
//   PUT    /blocks/:id           → update
//   DELETE /blocks/:id           → soft-delete
//   GET    /ical/subscribe       → return the current subscription URL (mints on first read)
//   POST   /ical/rotate          → rotate the token (invalidates all existing subscribers)
//
// The public `/ical/:clinicianId.ics?token=...` endpoint ships in
// PR2c — it doesn't require auth middleware (tokens are the
// credential) so it needs a separate route file.

import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import {
  requireModuleRead,
  requireModuleWrite,
} from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { calendarController } from './calendarController';

export const calendarRoutes = Router();

calendarRoutes.use(authMiddleware, tenantMiddleware);

// ── Preferences ──────────────────────────────────────────────────
calendarRoutes.get(
  '/preferences',
  requireModuleRead(MODULE_KEYS.CALENDAR),
  calendarController.getPreferences,
);
calendarRoutes.put(
  '/preferences',
  requireModuleWrite(MODULE_KEYS.CALENDAR),
  calendarController.updatePreferences,
);

// ── Availability blocks ──────────────────────────────────────────
calendarRoutes.get(
  '/blocks',
  requireModuleRead(MODULE_KEYS.CALENDAR),
  calendarController.listBlocks,
);
calendarRoutes.post(
  '/blocks',
  requireModuleWrite(MODULE_KEYS.CALENDAR),
  calendarController.createBlock,
);
calendarRoutes.put(
  '/blocks/:id',
  requireModuleWrite(MODULE_KEYS.CALENDAR),
  calendarController.updateBlock,
);
calendarRoutes.delete(
  '/blocks/:id',
  requireModuleWrite(MODULE_KEYS.CALENDAR),
  calendarController.deleteBlock,
);

// ── Today view (aggregate for one clinician on one date) ───────
calendarRoutes.get(
  '/today',
  requireModuleRead(MODULE_KEYS.CALENDAR),
  calendarController.getToday,
);

// ── iCal subscription URL management ────────────────────────────
// NOTE: the public iCal endpoint (GET /ical/:clinicianId.ics?token)
// lives in calendarIcalPublicRoutes.ts and is exempt from auth
// middleware because the token IS the credential. These two
// routes are the authenticated management surface that lets a
// clinician fetch / rotate their URL.
calendarRoutes.get(
  '/ical/subscribe',
  requireModuleRead(MODULE_KEYS.CALENDAR),
  calendarController.getIcalSubscriptionUrl,
);
calendarRoutes.post(
  '/ical/rotate',
  requireModuleWrite(MODULE_KEYS.CALENDAR),
  calendarController.rotateIcalToken,
);

export default calendarRoutes;
