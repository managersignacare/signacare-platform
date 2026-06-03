// apps/api/src/features/roles/psychologistFeatureRoutes.ts
//
// Audit Tier 6.2 (MED-H2) — psychology session notes routes.
//
// Access model:
//   - Author psychologist (role='clinician' + specialty='psychology'):
//     full read/write on their own notes. Read their colleagues' notes
//     only when `shared_with_clinicians=true`.
//   - Admin / Superadmin: read-only across all notes in the clinic
//     (governance + medico-legal review).
//   - All other clinicians (psychiatrist / nurse / case manager etc.):
//     read iff `shared_with_clinicians=true`. No write path.
//   - Patient-relationship is enforced on every handler that touches a
//     specific patient via requirePatientRelationship, per §13.
//
// `requireSpecialty(auth, ['psychology'])` is the specialty gate on
// write paths. Admin/superadmin bypass that check via BYPASS_ROLES in
// the guard itself.

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbRead } from '../../db/db';
import { CLINICAL_ROLES } from '../../shared/roleGroups';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requireSpecialty, requirePatientRelationship } from '../../shared/authGuards';

const router = Router();

const PSYCHOLOGY_SESSION_NOTE_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'staff_id',
  'session_date', 'duration_min', 'session_type',
  'content', 'outcome_scores', 'shared_with_clinicians',
  'created_at', 'updated_at', 'deleted_at',
] as const;

const CreateSessionNoteSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMin: z.number().int().min(1).max(600).optional(),
  sessionType: z.string().max(60).optional(),
  content: z.string().max(50000).optional(),
  outcomeScores: z.record(z.string(), z.unknown()).optional(),
  sharedWithClinicians: z.boolean().optional(),
});

const UpdateSessionNoteSchema = CreateSessionNoteSchema.partial().omit({ patientId: true });

// Tier 6.2 access predicate — who can see a given session note row.
function canSeeSessionNote(
  row: { staff_id: string; shared_with_clinicians: boolean },
  authStaffId: string,
  authRole: string,
): boolean {
  const isAuthor = row.staff_id === authStaffId;
  const isAdmin = authRole === 'admin' || authRole === 'superadmin';
  return isAuthor || isAdmin || row.shared_with_clinicians;
}

// GET /psychology-session-notes — list for the authenticated clinician.
router.get(
  '/psychology-session-notes',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const { patientId, limit = '50' } = req.query;
      if (patientId) await requirePatientRelationship(auth, patientId as string);

      const isAdmin = auth.role === 'admin' || auth.role === 'superadmin';
      let query = dbRead('psychology_session_notes')
        .where({ clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .orderBy('session_date', 'desc')
        .limit(parseInt(limit as string, 10));

      if (patientId) query = query.where({ patient_id: patientId });

      // Visibility filter: author OR shared OR admin.
      query = query.where(function () {
        this.where('staff_id', auth.staffId).orWhere('shared_with_clinicians', true);
        if (isAdmin) {
          // Admin sees everything; adding an always-true clause expands
          // the OR to include non-shared rows authored by others.
          this.orWhereNotNull('id');
        }
      });

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// GET /psychology-session-notes/:id
router.get(
  '/psychology-session-notes/:id',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const row = await dbRead('psychology_session_notes')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .first();
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      if (!canSeeSessionNote(row, auth.staffId, auth.role)) {
        // Minimal disclosure — 404 rather than 403.
        res.status(404).json({ error: 'Not found' });
        return;
      }
      await requirePatientRelationship(auth, row.patient_id);
      res.json(row);
    } catch (err) { next(err); }
  },
);

// POST /psychology-session-notes
router.post(
  '/psychology-session-notes',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateSessionNoteSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      // Only psychologists (or admin override) may WRITE psychology session notes.
      await requireSpecialty(auth, ['psychology']);
      await requirePatientRelationship(auth, dto.patientId);

      const [row] = await db('psychology_session_notes')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: dto.patientId,
          episode_id: dto.episodeId || null,
          staff_id: auth.staffId,
          session_date: dto.sessionDate,
          duration_min: dto.durationMin ?? null,
          session_type: dto.sessionType ?? null,
          content: dto.content ?? null,
          outcome_scores: dto.outcomeScores ? JSON.stringify(dto.outcomeScores) : null,
          shared_with_clinicians: dto.sharedWithClinicians ?? false,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(PSYCHOLOGY_SESSION_NOTE_COLUMNS);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PATCH /psychology-session-notes/:id
router.patch(
  '/psychology-session-notes/:id',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateSessionNoteSchema.parse(req.body);
      const auth = buildAuthContext(req);
      await requireSpecialty(auth, ['psychology']);

      const existing = await db('psychology_session_notes')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      if (existing.staff_id !== auth.staffId) {
        res.status(403).json({ error: 'Only the author may edit this session note', code: 'NOT_AUTHOR' });
        return;
      }

      const patch: Record<string, unknown> = { updated_at: db.fn.now() };
      if (dto.episodeId !== undefined) patch.episode_id = dto.episodeId || null;
      if (dto.sessionDate !== undefined) patch.session_date = dto.sessionDate;
      if (dto.durationMin !== undefined) patch.duration_min = dto.durationMin;
      if (dto.sessionType !== undefined) patch.session_type = dto.sessionType;
      if (dto.content !== undefined) patch.content = dto.content;
      if (dto.outcomeScores !== undefined) patch.outcome_scores = dto.outcomeScores ? JSON.stringify(dto.outcomeScores) : null;
      if (dto.sharedWithClinicians !== undefined) patch.shared_with_clinicians = dto.sharedWithClinicians;

      const [row] = await db('psychology_session_notes')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(patch)
        .returning(PSYCHOLOGY_SESSION_NOTE_COLUMNS);

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /psychology-session-notes/:id (soft delete — author-only)
router.delete(
  '/psychology-session-notes/:id',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requireSpecialty(auth, ['psychology']);

      const existing = await db('psychology_session_notes')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      if (existing.staff_id !== auth.staffId) {
        res.status(403).json({ error: 'Only the author may delete this session note', code: 'NOT_AUTHOR' });
        return;
      }

      await db('psychology_session_notes')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update({ deleted_at: db.fn.now(), updated_at: db.fn.now() });
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);

export default router;
