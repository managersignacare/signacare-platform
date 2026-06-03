/**
 * Tab Configuration — Per-clinic patient tab visibility
 *
 * GET  /api/v1/settings/tab-config           — Get tab config for current clinic
 * PUT  /api/v1/settings/tab-config           — Update tab config (admin only)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { randomUUID } from 'crypto';

// Local Zod schema (Phase R3b / CLAUDE.md §12) — batch upsert of
// per-tab visibility rows. Required_role is free-form role string.
const TabConfigBatchSchema = z.object({
  tabs: z.array(z.object({
    tabId: z.string().min(1).max(100),
    isEnabled: z.boolean().optional(),
    requiredRole: z.string().max(50).nullable().optional(),
    sortOrder: z.number().int().optional(),
  })),
});

const router = Router();
router.use(authMiddleware);

// Get tab configuration
router.get('/tab-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await db('clinic_tab_config')
      .where({ clinic_id: req.clinicId })
      .orderBy('sort_order');
    res.json({ data: config });
  } catch (err) {
    next(err);
  }
});

// Update tab configuration (batch upsert)
router.put(
  '/tab-config',
  requireRoles(['superadmin', 'admin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tabs } = TabConfigBatchSchema.parse(req.body);

      for (const tab of tabs) {
        await db('clinic_tab_config')
          .insert({
            id: randomUUID(),
            clinic_id: req.clinicId,
            tab_id: tab.tabId,
            is_enabled: tab.isEnabled ?? true,
            required_role: tab.requiredRole ?? null,
            sort_order: tab.sortOrder ?? 0,
            updated_at: db.fn.now(),
          })
          .onConflict(['clinic_id', 'tab_id'])
          .merge(['is_enabled', 'required_role', 'sort_order', 'updated_at']);
      }

      const updated = await db('clinic_tab_config').where({ clinic_id: req.clinicId }).orderBy('sort_order');
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
