// apps/api/src/features/notifications/notificationRoutes.ts
//
// Phase 10A — read + acknowledge routes for the notification centre.
//
// Mounted at /api/v1/notifications. Reads return the current user's
// bell feed, writes mark rows read or soft-delete them. There is NO
// client-facing POST for creating notifications — only the backend
// services emit them via notificationService.emit.
//
// Reads use note:read... wait, not quite. We minted three fresh
// permissions (notification:read, notification:update, notification:delete)
// in packages/shared/src/rbac.schemas.ts so the bell is properly
// gated without piggy-backing on clinical-note permissions.
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  ListNotificationsQuerySchema,
  MarkReadBodySchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import {
  notificationRepository,
} from './notificationRepository';
import { mapNotificationRowToResponse } from './notificationService';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// GET /notifications?unread=1&limit=50&offset=0
router.get(
  '/',
  requirePermission('notification:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = ListNotificationsQuerySchema.parse(req.query);
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;

      const rows = await notificationRepository.listForUser(req.clinicId, req.user!.id, {
        unreadOnly: q.unread === true,
        limit,
        offset,
      });
      const unreadCount = await notificationRepository.countUnreadForUser(req.clinicId, req.user!.id);

      res.json({
        items: rows.map(mapNotificationRowToResponse),
        unreadCount,
      });
    } catch (err) { next(err); }
  },
);

// POST /notifications/:id/read — mark one row read (idempotent)
router.post(
  '/:id/read',
  requirePermission('notification:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await notificationRepository.markRead(
        req.clinicId,
        req.user!.id,
        [req.params.id],
      );
      res.json({ updated });
    } catch (err) { next(err); }
  },
);

// POST /notifications/read-all — mark every unread notification read
router.post(
  '/read-all',
  requirePermission('notification:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await notificationRepository.markAllRead(
        req.clinicId,
        req.user!.id,
      );
      res.json({ updated });
    } catch (err) { next(err); }
  },
);

// POST /notifications/read — mark a batch of rows read
router.post(
  '/read',
  requirePermission('notification:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = MarkReadBodySchema.parse(req.body);
      const ids = body.ids ?? [];
      const updated = await notificationRepository.markRead(
        req.clinicId,
        req.user!.id,
        ids,
      );
      res.json({ updated });
    } catch (err) { next(err); }
  },
);

// DELETE /notifications/:id — soft-delete (dismiss from bell)
router.delete(
  '/:id',
  requirePermission('notification:delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await notificationRepository.softDeleteTargeted(
        req.clinicId,
        req.user!.id,
        req.params.id,
      );
      res.json({ deleted });
    } catch (err) { next(err); }
  },
);

export default router;
