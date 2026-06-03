/**
 * Audit Replay — "Who knew what, when" reconstruction
 *
 * GET /api/v1/audit/patient/:patientId/timeline   — Full event timeline for a patient
 * GET /api/v1/audit/record/:table/:id              — History of a specific record
 * GET /api/v1/audit/staff/:staffId/activity        — Staff activity log
 * GET /api/v1/audit/ai-provenance/:patientId       — AI output provenance for a patient
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.AUDIT));

const ADMIN_ROLES = ['superadmin', 'admin', 'manager'];

interface StaffActivityEvent {
  id: string;
  event_time: string;
  action: string | null;
  table_name: string | null;
  record_id: string | null;
}

// ── Patient Event Timeline ──
router.get(
  '/patient/:patientId/timeline',
  requireRoles(ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const { patientId } = req.params;
    const { from, to, limit = '100' } = req.query;

    let query = db('audit_events_canonical as al')
      .leftJoin('staff as s', db.raw('s.id = COALESCE(al.staff_id, al.user_id)'))
      .where(function () {
        this.whereRaw("al.new_data->>'patient_id' = ?", [patientId])
          .orWhereRaw("al.old_data->>'patient_id' = ?", [patientId])
          .orWhere('al.record_id', patientId);
      })
      .select(
        'al.id', 'al.created_at as event_time', db.raw('COALESCE(al.operation, al.action) as event_type'),
        'al.table_name', 'al.record_id',
        db.raw('COALESCE(al.staff_id, al.user_id) as staff_id'),
        db.raw("s.given_name || ' ' || s.family_name as staff_name"),
        'al.old_data', 'al.new_data'
      )
      .orderBy('al.created_at', 'desc')
      .limit(parseInt(limit as string, 10));

    if (from) query = query.where('al.created_at', '>=', from);
    if (to) query = query.where('al.created_at', '<=', to);

    const events = await query;
    res.json({ data: events, total: events.length });
  }
);

// ── Record History (any table/record) ──
router.get(
  '/record/:table/:recordId',
  requireRoles(ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const { table, recordId } = req.params;
    const events = await db('audit_events_canonical as al')
      .leftJoin('staff as s', db.raw('s.id = COALESCE(al.staff_id, al.user_id)'))
      .where({ 'al.table_name': table, 'al.record_id': recordId })
      .select(
        'al.id', 'al.created_at as event_time', db.raw('COALESCE(al.operation, al.action) as action'),
        db.raw("s.given_name || ' ' || s.family_name as staff_name"),
        'al.old_data', 'al.new_data'
      )
      .orderBy('al.created_at', 'asc')
      .limit(2000); // BUG-437 — audit-ceiling per-record audit history
    res.json({ data: events, total: events.length });
  }
);

// ── Staff Activity Log ──
router.get(
  '/staff/:staffId/activity',
  requireRoles(ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const { staffId } = req.params;
    const { from, to, limit = '50' } = req.query;

    let query = db('audit_events_canonical')
      .whereRaw('COALESCE(staff_id, user_id) = ?', [staffId])
      .select(
        'id',
        'created_at as event_time',
        db.raw('COALESCE(operation, action) as action'),
        db.raw('COALESCE(table_name, module) as table_name'),
        db.raw('COALESCE(record_id::text, entity_id) as record_id'),
      )
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit as string, 10));

    if (from) query = query.where('created_at', '>=', from);
    if (to) query = query.where('created_at', '<=', to);

    const events = await query as StaffActivityEvent[];

    // Summarise by action type
    const summary: Record<string, number> = {};
    events.forEach((e) => {
      const key = `${e.action}:${e.table_name}`;
      summary[key] = (summary[key] || 0) + 1;
    });

    res.json({ data: events, summary, total: events.length });
  }
);

// ── AI Provenance for Patient ──
router.get(
  '/ai-provenance/:patientId',
  requireRoles(ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const { patientId } = req.params;
    const records = await db('ai_provenance')
      .where({ patient_id: patientId })
      .leftJoin('staff as s', 's.id', 'ai_provenance.created_by_staff_id')
      .leftJoin('staff as r', 'r.id', 'ai_provenance.reviewed_by_staff_id')
      .select(
        'ai_provenance.*',
        db.raw("s.given_name || ' ' || s.family_name as created_by_name"),
        db.raw("r.given_name || ' ' || r.family_name as reviewed_by_name"),
      )
      .orderBy('ai_provenance.created_at', 'desc')
      .limit(2000); // BUG-437 — audit-ceiling per-patient AI provenance
    res.json({ data: records });
  }
);

export default router;
