/**
 * Superadmin Guard — 4-Eyes Principle for Destructive Actions
 *
 * Certain high-risk operations require confirmation by a second superadmin.
 * This middleware checks if the action has been pre-approved.
 *
 * Guarded actions:
 *   - DELETE staff (deactivation)
 *   - DELETE clinic
 *   - Bulk data operations
 *   - Permission changes
 *   - Database purge operations
 *
 * Flow:
 *   1. First superadmin initiates action → creates pending approval
 *   2. Second superadmin approves → action is executed
 *   3. Both actions are logged to audit_log with full context
 */

import { Request, Response, NextFunction } from 'express';
import { db } from '../db/db';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

// Check if action needs 4-eyes approval
export function requireDualApproval(action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'superadmin') {
      res.status(403).json({ error: 'Superadmin access required' });
      return;
    }

    const approvalId = req.headers['x-approval-id'] as string;

    if (approvalId) {
      // Check if this approval exists and was created by a DIFFERENT superadmin
      try {
        const approval = await db('audit_events_canonical as al')
          .where('al.clinic_id', req.clinicId!)
          .where('al.table_name', 'superadmin_approvals')
          .where('al.record_id', approvalId)
          .whereRaw("UPPER(COALESCE(al.operation, al.action)) = 'APPROVAL_REQUEST'")
          .select('al.staff_id', 'al.user_id')
          .first();

        if (!approval) {
          res.status(400).json({ error: 'Invalid approval ID' });
          return;
        }

        const approvalRequestedBy = String(approval.staff_id ?? approval.user_id ?? '');
        if (!approvalRequestedBy) {
          res.status(400).json({ error: 'Approval requester could not be resolved' });
          return;
        }

        if (approvalRequestedBy === req.user.id) {
          res.status(403).json({ error: '4-eyes principle: A different superadmin must approve this action' });
          return;
        }

        // BUG-467 — migrated to typed writeAuditLog.
        const { writeAuditLog } = await import('../utils/audit');
        await writeAuditLog({
          clinicId: req.clinicId!,
          actorId: req.user.id,
          tableName: 'superadmin_approvals',
          recordId: approvalId,
          action: 'APPROVAL_EXECUTED',
          newData: { action, approvedBy: req.user.id, originalRequestBy: approvalRequestedBy },
        });

        logger.info({ approvalId, action, approvedBy: req.user.id }, '4-eyes approval executed');
        next();
        return;
      } catch (err) {
        next(err);
        return;
      }
    }

    // No approval ID — create a pending approval request
    const pendingId = randomUUID();
    // BUG-467 — migrated to typed writeAuditLog.
    const { writeAuditLog } = await import('../utils/audit');
    await writeAuditLog({
      clinicId: req.clinicId!,
      actorId: req.user.id,
      tableName: 'superadmin_approvals',
      recordId: pendingId,
      action: 'APPROVAL_REQUEST',
      newData: {
        action,
        resource: req.path,
        method: req.method,
        requestedBy: req.user.id,
        requestedAt: new Date().toISOString(),
      },
    });

    logger.info({ pendingId, action, requestedBy: req.user.id }, '4-eyes approval requested');

    res.status(202).json({
      approvalRequired: true,
      approvalId: pendingId,
      message: 'This action requires approval from a second superadmin. Provide the approvalId in the X-Approval-Id header.',
      action,
    });
  };
}
