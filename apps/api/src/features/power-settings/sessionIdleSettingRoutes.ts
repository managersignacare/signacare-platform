// apps/api/src/features/power-settings/sessionIdleSettingRoutes.ts
//
// BUG-P2 — Per-clinic session-idle-timeout configuration (PRES-6 DH-3869).
//
// Endpoints:
//   GET  /api/v1/power-settings/session-idle  — admin-readable (any role
//        with the power-settings module read can view their clinic's value)
//   PUT  /api/v1/power-settings/session-idle  — superadmin only; tightens
//        the per-clinic idle window. Body: { minutes: 5..15 | null }.
//        null clears the override (clinic falls back to server default 15).
//
// 4-layer defence-in-depth on the [5, 15] bound:
//   L1 — Zod schema (this file)
//   L2 — service guard (below — explicit re-check)
//   L3 — DB CHECK constraint `clinics_session_idle_minutes_pres6`
//   L4 — middleware ceiling clamp (effectiveIdleMinutesForClinic)
//
// Per-clinic value applies on NEXT login (the Redis idle-window value is
// captured at login time). Documented in BUG-P2 close note.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/rbacMiddleware';
import { logger } from '../../utils/logger';
import {
  PRES6_IDLE_MINUTES_CEILING,
  PRES6_IDLE_MINUTES_FLOOR,
} from '../../middleware/sessionIdleMiddleware';

export const sessionIdleSettingRoutes = Router();

const SetSessionIdleSchema = z.object({
  // null = clear override (clinic falls back to server default 15min)
  // numeric = tighten below 15 (minimum 5 to prevent pathological lockouts)
  minutes: z
    .number()
    .int()
    .min(PRES6_IDLE_MINUTES_FLOOR)
    .max(PRES6_IDLE_MINUTES_CEILING)
    .nullable(),
});

// BUG-P2 + CLAUDE.md §5.3 — Zod-parsed response shapes for both endpoints.
const SessionIdleGetResponseSchema = z.object({
  clinicSessionIdleMinutes: z.number().int().nullable(),
  serverDefaultMinutes: z.number().int(),
  pres6FloorMinutes: z.number().int(),
  pres6CeilingMinutes: z.number().int(),
});

const SessionIdlePutResponseSchema = z.object({
  clinicSessionIdleMinutes: z.number().int().nullable(),
  applied: z.literal('on-next-login'),
});

// GET — any authenticated user (admin / superadmin / clinical lead) can
// see their clinic's effective configuration. Helps clinicians know how
// long their session will idle out.
sessionIdleSettingRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    if (!clinicId) {
      res.status(400).json({ error: 'Missing clinic context' });
      return;
    }
    const { dbAdmin } = await import('../../db/db');
    const row = (await dbAdmin('clinics')
      .where({ id: clinicId })
      .whereNull('deleted_at')
      .select('session_idle_minutes')
      .first()) as { session_idle_minutes: number | null } | undefined;
    res.json(
      SessionIdleGetResponseSchema.parse({
        clinicSessionIdleMinutes: row?.session_idle_minutes ?? null,
        serverDefaultMinutes: PRES6_IDLE_MINUTES_CEILING,
        pres6FloorMinutes: PRES6_IDLE_MINUTES_FLOOR,
        pres6CeilingMinutes: PRES6_IDLE_MINUTES_CEILING,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// PUT — superadmin only. Tightens the per-clinic window or clears the
// override. The CHECK constraint at the DB level enforces [5, 15] as an
// L3 belt below the Zod L1 + service L2 guards.
sessionIdleSettingRoutes.put(
  '/',
  requireRole('superadmin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinicId = req.clinicId;
      const actorId = req.user?.id;
      if (!clinicId || !actorId) {
        res.status(400).json({ error: 'Missing clinic or actor context' });
        return;
      }
      const parsed = SetSessionIdleSchema.parse(req.body);
      // L2 belt: re-check bounds explicitly. The service-layer guard
      // matches the Zod min/max; if a future refactor weakens the Zod
      // schema, this ensures the DB CHECK isn't the only defence.
      if (
        parsed.minutes !== null
        && (parsed.minutes < PRES6_IDLE_MINUTES_FLOOR
          || parsed.minutes > PRES6_IDLE_MINUTES_CEILING)
      ) {
        res.status(400).json({
          error: `Session idle minutes must be between ${PRES6_IDLE_MINUTES_FLOOR} and ${PRES6_IDLE_MINUTES_CEILING} (PRES-6 DH-3869)`,
          code: 'PRES6_BOUND_VIOLATION',
        });
        return;
      }
      const { dbAdmin } = await import('../../db/db');
      const before = (await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('session_idle_minutes')
        .first()) as { session_idle_minutes: number | null } | undefined;
      await dbAdmin('clinics')
        .where({ id: clinicId })
        .update({
          session_idle_minutes: parsed.minutes,
          updated_at: new Date(),
        });
      try {
        const { writeAuditLog } = await import('../../utils/audit');
        await writeAuditLog({
          actorId,
          clinicId,
          action: 'UPDATE',
          tableName: 'clinics',
          recordId: clinicId,
          oldData: { sessionIdleMinutes: before?.session_idle_minutes ?? null },
          newData: { sessionIdleMinutes: parsed.minutes },
        });
      } catch (err) {
        logger.warn(
          {
            err,
            kind: 'audit_write_failure',
            action: 'session_idle_minutes_update',
            clinicId,
            actorStaffId: actorId,
          },
          'BUG-P2: audit write failed for session-idle-minutes update; mutation succeeded',
        );
      }
      res.json(
        SessionIdlePutResponseSchema.parse({
          clinicSessionIdleMinutes: parsed.minutes,
          applied: 'on-next-login',
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);
