import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { TRIGGER_EVENTS } from './workflowEvents';

// Local Zod schemas (Phase R3b / CLAUDE.md §12). `steps` is a flexible
// array of action nodes consumed by workflowEngine — keep the element
// permissive with passthrough.
const WorkflowCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  triggerEvent: z.string().min(1).max(100),
  steps: z.array(z.record(z.string(), z.unknown())).optional(),
});

const WorkflowUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  triggerEvent: z.string().min(1).max(100).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).optional(),
  isActive: z.boolean().optional(),
});

const router = Router();
router.use(requireAuth);

const ADMIN = ['admin', 'superadmin'];

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
const WORKFLOW_COLUMNS = [
  'id', 'clinic_id', 'name', 'description', 'trigger_event',
  'steps', 'is_active', 'created_by_staff_id',
  'created_at', 'updated_at', 'deleted_at',
] as const;

// GET /workflows — list all workflows for this clinic
router.get('/', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('workflows')
      .where({ clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .orderBy('name', 'asc');
    res.json({ workflows: rows, triggerEvents: TRIGGER_EVENTS });
  } catch (err) { next(err); }
});

// GET /workflows/:id — get a specific workflow with recent executions
router.get('/:id', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wf = await db('workflows')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }

    const executions = await db('workflow_executions')
      .where({ workflow_id: wf.id, clinic_id: req.clinicId })
      .orderBy('started_at', 'desc')
      .limit(20);

    res.json({ workflow: wf, executions });
  } catch (err) { next(err); }
});

// POST /workflows — create a new workflow
router.post('/', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, triggerEvent, steps } = WorkflowCreateSchema.parse(req.body);
    const [row] = await db('workflows')
      .insert({
        id: uuidv4(),
        clinic_id: req.clinicId,
        name: name.trim(),
        description: description?.trim() ?? null,
        trigger_event: triggerEvent,
        steps: JSON.stringify(steps ?? []),
        is_active: true,
        created_by_staff_id: req.user!.id,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(WORKFLOW_COLUMNS);
    res.status(201).json({ workflow: row });
  } catch (err) { next(err); }
});

// PUT /workflows/:id — update a workflow
router.put('/:id', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, triggerEvent, steps, isActive } = WorkflowUpdateSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (name !== undefined) patch.name = name.trim();
    if (description !== undefined) patch.description = description?.trim() ?? null;
    if (triggerEvent !== undefined) patch.trigger_event = triggerEvent;
    if (steps !== undefined) patch.steps = JSON.stringify(steps);
    if (isActive !== undefined) patch.is_active = isActive;

    const [row] = await db('workflows')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .update(patch)
      .returning(WORKFLOW_COLUMNS);
    if (!row) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json({ workflow: row });
  } catch (err) { next(err); }
});

// DELETE /workflows/:id — soft delete
router.delete('/:id', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('workflows')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .update({ deleted_at: new Date(), is_active: false });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /workflows/:id/executions — execution history
router.get('/:id/executions', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('workflow_executions')
      .where({ workflow_id: req.params.id, clinic_id: req.clinicId })
      .orderBy('started_at', 'desc')
      .limit(50);
    res.json({ executions: rows });
  } catch (err) { next(err); }
});

export default router;
