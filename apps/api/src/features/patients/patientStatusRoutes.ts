// apps/api/src/features/patients/patientStatusRoutes.ts
// Separate router for patient activate/deactivate to avoid catch-all /:id interference.
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../../db/db';

export const patientStatusRoutes = Router();

// GET /:id/can-deactivate — Check if patient can be deactivated
patientStatusRoutes.get('/:id/can-deactivate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const patientId = req.params.id;

    const activeEpisodes = await db('episodes')
      .where({ patient_id: patientId, clinic_id: clinicId, status: 'open' })
      .whereNull('deleted_at')
      .count('* as count');
    const count = parseInt(String(activeEpisodes[0]?.count ?? '0'), 10);

    res.json({ canDeactivate: count === 0, activeEpisodeCount: count });
  } catch (err) { next(err); }
});

// PATCH /:id/deactivate — Set patient status to inactive (only if no active episodes)
// REST convention: status change on an existing resource → PATCH, not POST.
patientStatusRoutes.patch('/:id/deactivate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const patientId = req.params.id;

    // Check for active episodes
    const activeEpisodes = await db('episodes')
      .where({ patient_id: patientId, clinic_id: clinicId, status: 'open' })
      .whereNull('deleted_at')
      .count('* as count');
    const count = parseInt(String(activeEpisodes[0]?.count ?? '0'), 10);

    if (count > 0) {
      res.status(422).json({
        error: `Cannot deactivate patient with ${count} active episode(s). Close all episodes first.`,
        code: 'ACTIVE_EPISODES_EXIST',
        activeEpisodeCount: count,
      });
      return;
    }

    // Set status to inactive
    await db('patients')
      .where({ id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ status: 'inactive', updated_at: new Date() });

    res.json({ ok: true, status: 'inactive' });
  } catch (err) { next(err); }
});

// PATCH /:id/reactivate — Set patient status back to active
// REST convention: status change on an existing resource → PATCH, not POST.
patientStatusRoutes.patch('/:id/reactivate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const patientId = req.params.id;

    await db('patients')
      .where({ id: patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ status: 'active', updated_at: new Date() });

    res.json({ ok: true, status: 'active' });
  } catch (err) { next(err); }
});
