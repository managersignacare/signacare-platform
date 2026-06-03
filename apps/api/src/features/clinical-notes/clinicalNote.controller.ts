import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { clinicalNoteService } from './clinicalNote.service';
import type { ClinicalNoteRow } from './clinicalNote.repository';
import { CreateNoteSchema, SignNoteSchema, UpdateNoteSchema } from '@signacare/shared';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { logger } from '../../utils/logger';
import { AppError } from '../../shared/errors';

// Local Zod schema (CLAUDE.md §12) for the updateCode endpoint — scoped
// to this file, not worth promoting to @signacare/shared yet.
// BUG-PR-R1-12-FIX-S1-clinical_note_codes — REQUIRED expectedLockVersion
// per CLAUDE.md §1.6. Multi-clinician accept/reject concurrency on
// AI-suggested ICD-10 codes; silent overwrite of accepted_by/rejected_by
// would corrupt the AHPRA attribution chain.
const UpdateCodeBodySchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  status: z.enum(['accepted', 'rejected']),
  rejectReason: z.string().max(500).optional(),
});

// Fallback lockVersion schema for If-Match absence — only a number is
// acceptable. Still local per §12.
const LockVersionFallbackSchema = z.object({
  lockVersion: z.number().int().nonnegative().optional(),
}).passthrough();

function mapNoteRowToResponse(row: ClinicalNoteRow): Record<string, unknown> {
  return {
    id:             row.id,
    clinicId:       row.clinicId,
    patientId:      row.patientId,
    episodeId:      row.episodeId,
    appointmentId:  row.appointmentId,
    authorId:       row.authorId,
    authorName:     row.authorName,
    noteType:       row.noteType,
    status:         row.status,
    noteDateTime:   row.noteDateTime ?? row.createdAt,
    content:        row.content,
    soapSubjective: row.soapSubjective,
    soapObjective:  row.soapObjective,
    soapAssessment: row.soapAssessment,
    soapPlan:       row.soapPlan,
    templateId:     row.templateId,
    isAiDraft:      row.isAiDraft,
    amendedFromId:  row.amendedFromId,
    signedAt:       row.signedAt,
    signedById:     row.signedById,
    createdAt:      row.createdAt,
    updatedAt:      row.updatedAt,
    lockVersion:    row.lockVersion,
  };
}

export const clinicalNoteController = {
  async listByPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const { patientId } = req.params;
      const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;
      const notes = await clinicalNoteService.listByPatient(auth, patientId, episodeId);
      res.json(notes.map(mapNoteRowToResponse));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const note = await clinicalNoteService.getById(auth, req.params.id);
      res.json(mapNoteRowToResponse(note));
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const parsed = CreateNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        // @response-shape-exempt: explicit zod-validation envelope used by legacy clinical-note amend clients
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const note = await clinicalNoteService.create(auth, parsed.data);
      logger.info({ clinicId: auth.clinicId, noteId: note.id }, 'clinical note created');
      res.status(201).json(mapNoteRowToResponse(note));
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const parsed = UpdateNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      let expectedLockVersion: number | undefined;
      const ifMatch = req.headers['if-match'];
      if (typeof ifMatch === 'string') {
        const match = /"(\d+)"/.exec(ifMatch);
        if (match) expectedLockVersion = parseInt(match[1], 10);
      }
      if (expectedLockVersion === undefined) {
        const fallback = LockVersionFallbackSchema.safeParse(req.body);
        if (fallback.success && typeof fallback.data.lockVersion === 'number') {
          expectedLockVersion = fallback.data.lockVersion;
        }
      }

      const note = await clinicalNoteService.update(auth, req.params.id, parsed.data, expectedLockVersion);
      res.setHeader('ETag', `"${note.lockVersion}"`);
      res.json(mapNoteRowToResponse(note));
    } catch (err) {
      next(err);
    }
  },

  async listVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const note = await clinicalNoteService.getById(auth, req.params.id);
      const { db } = await import('../../db/db');
      const versions = await db('clinical_note_versions')
        .where({ note_id: note.id, clinic_id: auth.clinicId })
        .orderBy('version_number', 'desc')
        .select('id', 'note_id as noteId', 'version_number as versionNumber', 'snapshot', 'edited_by_staff_id as editedByStaffId', 'edited_at as editedAt', 'edit_reason as editReason', 'status_at_snapshot as statusAtSnapshot');
      res.json({ noteId: note.id, versions });
    } catch (err) {
      next(err);
    }
  },

  async listCodes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const note = await clinicalNoteService.getById(auth, req.params.id);
      const { db } = await import('../../db/db');
      const codes = await db('clinical_note_codes')
        .where({ note_id: note.id, clinic_id: auth.clinicId })
        .orderBy('confidence', 'desc')
        .orderBy('created_at', 'asc')
        .select(
          'id', 'note_id as noteId', 'system', 'code', 'display',
          'confidence', 'status', 'source',
          'source_excerpt as sourceExcerpt',
          'accepted_by_staff_id as acceptedByStaffId',
          'accepted_at as acceptedAt',
          'rejected_by_staff_id as rejectedByStaffId',
          'rejected_at as rejectedAt',
          'reject_reason as rejectReason',
          'created_at as createdAt',
        );
      res.json({ noteId: note.id, codes });
    } catch (err) {
      next(err);
    }
  },

  async updateCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const parsed = UpdateCodeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const { status, rejectReason, expectedLockVersion } = parsed.data;
      await clinicalNoteService.getById(auth, req.params.id);
      const patch: Record<string, unknown> = { status };
      if (status === 'accepted') {
        patch.accepted_by_staff_id = auth.staffId;
        patch.accepted_at = new Date();
        patch.rejected_by_staff_id = null;
        patch.rejected_at = null;
        patch.reject_reason = null;
      } else {
        patch.rejected_by_staff_id = auth.staffId;
        patch.rejected_at = new Date();
        patch.reject_reason = rejectReason ?? null;
        patch.accepted_by_staff_id = null;
        patch.accepted_at = null;
      }
      // BUG-PR-R1-12-FIX-S1-clinical_note_codes — opt-locked UPDATE.
      const { updateWithOptimisticLock } = await import('../../shared/db/optimisticLock');
      try {
        await updateWithOptimisticLock<Record<string, unknown>>({
          table: 'clinical_note_codes',
          where: { id: req.params.codeId, note_id: req.params.id, clinic_id: auth.clinicId },
          expectedLockVersion,
          patch,
          returning: ['id'],
        });
      } catch (err: unknown) {
        const e = err as { status?: number; code?: string };
        if (e?.status === 404 || e?.code === 'NOT_FOUND') {
          res.status(404).json({ error: 'code not found', code: 'NOT_FOUND' });
          return;
        }
        throw err;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },

  async sign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const parsed = SignNoteSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError('Validation failed', 400, 'VALIDATION_ERROR', parsed.error.flatten());
      }
      const { reviewedAndAdopted } = parsed.data;
      const note = await clinicalNoteService.sign(auth, req.params.id, { reviewedAndAdopted });
      logger.info({ clinicId: auth.clinicId, noteId: note.id, signedById: auth.staffId, reviewedAndAdopted }, 'clinical note signed');
      res.json(mapNoteRowToResponse(note));
    } catch (err) {
      next(err);
    }
  },

  async amend(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const parsed = CreateNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const note = await clinicalNoteService.amend(auth, req.params.id, parsed.data);
      logger.info({ clinicId: auth.clinicId, noteId: note.id, amendedFromId: req.params.id }, 'clinical note amended');
      res.status(201).json(mapNoteRowToResponse(note));
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      await clinicalNoteService.softDelete(auth, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
