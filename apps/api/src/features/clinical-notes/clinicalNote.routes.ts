import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import { clinicalNoteController as ctrl } from './clinicalNote.controller';
import { buildNoteSnippets, SNIPPET_TYPES, type SnippetType } from './noteSnippets';
import { HttpError } from '../../shared/errors';

// USER-A.3 absorb-1: boundary-validate episodeId query param. A
// malformed UUID would otherwise reach Postgres and surface as
// `22P02 invalid input syntax` → generic 500. Fail fast at 400
// with VALIDATION_ERROR per §errors contract (L5 "fail fast" standard).
const SnippetsQuerySchema = z.object({
  types: z.string().min(1),
  episodeId: z.string().uuid().optional(),
});

const router = Router();

router.use(requireAuth);
router.use(requireModuleRead(MODULE_KEYS.CLINICAL_NOTES));

// List drafts for current staff (used by DraftsPage)
router.get('/', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const status = req.query.status as string || 'draft';
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const rows = await db('clinical_notes')
      .leftJoin('patients', 'patients.id', 'clinical_notes.patient_id')
      .where('clinical_notes.clinic_id', req.clinicId)
      .andWhere('clinical_notes.status', status)
      .whereNull('clinical_notes.deleted_at')
      .select(
        'clinical_notes.*',
        db.raw("coalesce(patients.given_name, '') || ' ' || coalesce(patients.family_name, '') as patient_name"),
        'patients.emr_number as patient_emr_number',
      )
      .orderBy('clinical_notes.updated_at', 'desc')
      .limit(limit);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// S7.2 — Note quick-insert snippets. The frontend NoteEditor binds
// Alt+Shift+<key> shortcuts to this endpoint, fetches the requested
// snippets, and inserts the returned markdown at the cursor. The
// endpoint is GET because the inputs are non-sensitive (patient id
// from URL + type list from query). Every snippet is RLS-scoped via
// the clinic_id filter in noteSnippets.ts.
router.get(
  '/patient/:patientId/snippets',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.params;
      // USER-A.3 absorb-1: Zod boundary validation. episodeId must be
      // a UUID when present; malformed values fail fast at 400 rather
      // than surface as a 500 from Postgres.
      const parsed = SnippetsQuerySchema.safeParse({
        types: typeof req.query.types === 'string' ? req.query.types : '',
        episodeId: typeof req.query.episodeId === 'string' && req.query.episodeId.trim().length > 0
          ? req.query.episodeId.trim()
          : undefined,
      });
      if (!parsed.success) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Invalid query parameters',
          { issues: parsed.error.issues },
        );
      }
      const requested = parsed.data.types
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0) as SnippetType[];
      if (requested.length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', `types query param required — one or more of ${SNIPPET_TYPES.join(', ')}`);
      }
      const episodeId = parsed.data.episodeId ?? null;
      const snippets = await buildNoteSnippets(req.clinicId, patientId, requested, episodeId);
      res.json({ snippets });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/patient/:patientId',    ctrl.listByPatient);
// S5.4 + S5.6: subroutes MUST be declared BEFORE the catch-all /:id
// route or Express will match the literal segment ('versions',
// 'codes') as the :id param.
router.get('/:id/versions',          ctrl.listVersions);
router.get('/:id/codes',             ctrl.listCodes);
router.patch('/:id/codes/:codeId',   ctrl.updateCode);
router.get('/:id',                   ctrl.getById);
// S1.2: Idempotency-Key on note create — clinical notes are the
// canonical clinical write; double-creation is the worst case for an EMR.
router.post('/',                     idempotencyMiddleware(), ctrl.create);
router.patch('/:id',                 ctrl.update);
router.post('/:id/sign',             ctrl.sign);
router.post('/:id/amend',            ctrl.amend);
router.delete('/:id',                ctrl.softDelete);

export default router;
