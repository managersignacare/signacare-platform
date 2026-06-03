/**
 * Advance Care Directives Routes
 * Mental Health Advance Directives, Nominated Persons
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requireClinicalAccessRole } from '../../shared/authGuards';
import { CreateAdvanceDirectiveSchema, UpdateAdvanceDirectiveSchema } from '@signacare/shared';
import {
  mapAdvanceDirectiveRowToResponse,
} from './advanceDirectiveRepository';
import { advanceDirectiveService } from './advanceDirectiveService';

const router = Router();
router.use(authMiddleware);
router.use((req: Request, _res: Response, next: NextFunction) => {
  try {
    requireClinicalAccessRole(buildAuthContext(req));
    next();
  } catch (err) {
    next(err);
  }
});
router.use(requireModuleRead(MODULE_KEYS.ADVANCE_DIRECTIVES));

router.get('/patient/:patientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // advance_directives has NO deleted_at column (verified against
    // schema-snapshot.json). Soft-delete is not used; status transitions
    // ('active'→'expired'→'revoked') are the supersedure mechanism.
    // Removed pre-existing .whereNull('deleted_at') call which would have
    // crashed any actual hit on this route. CLAUDE.md §1.4 lists tables
    // without deleted_at; advance_directives belongs there too.
    const auth = buildAuthContext(req, req.params.patientId);
    const rows = await advanceDirectiveService.listByPatient(auth, req.params.patientId);
    res.json(rows.map(mapAdvanceDirectiveRowToResponse));
  } catch (err) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req, req.body?.patientId as string | undefined);
    const dto = CreateAdvanceDirectiveSchema.parse(req.body);
    const { patientId, type, validFrom, validUntil, status, content,
      documentDate, expiryDate, treatmentPreferences, refusedTreatments,
      nominatedPersonName, nominatedPersonRelationship, nominatedPersonPhone, nominatedPersonEmail,
      crisisInstructions, notes } = dto;

    // Build the JSONB content payload from either an explicit content object or individual fields
    const contentPayload = content ?? {
      ...(documentDate && { documentDate }),
      ...(expiryDate && { expiryDate }),
      ...(treatmentPreferences && { treatmentPreferences }),
      ...(refusedTreatments && { refusedTreatments }),
      ...(nominatedPersonName && { nominatedPersonName }),
      ...(nominatedPersonRelationship && { nominatedPersonRelationship }),
      ...(nominatedPersonPhone && { nominatedPersonPhone }),
      ...(nominatedPersonEmail && { nominatedPersonEmail }),
      ...(crisisInstructions && { crisisInstructions }),
      ...(notes && { notes }),
    };

    const row = await advanceDirectiveService.create(auth, {
      patientId,
      type,
      content: contentPayload,
      status: status || 'active',
      validFrom: validFrom || null,
      validUntil: validUntil || null,
    });
    res.status(201).json(mapAdvanceDirectiveRowToResponse(row));
  } catch (err) { next(err); }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const dto = UpdateAdvanceDirectiveSchema.parse(req.body);
    const { expectedLockVersion, ...mutable } = dto;
    const ALLOWED_COLUMNS = new Set(['type', 'status', 'valid_from', 'valid_until']);
    const updates: Record<string, unknown> = {};
    const contentPatch: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(mutable)) {
      const snakeKey = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (snakeKey === 'id' || snakeKey === 'clinic_id' || snakeKey === 'patient_id') continue;
      if (snakeKey === 'content') {
        // Full content replacement
        updates.content = JSON.stringify(v);
      } else if (ALLOWED_COLUMNS.has(snakeKey)) {
        updates[snakeKey] = v;
      } else {
        // Everything else gets merged into the content jsonb
        contentPatch[k] = v;
      }
    }

    // If individual content fields were sent (not a full content object), merge them into existing content
    if (Object.keys(contentPatch).length > 0 && !updates.content) {
      updates.content = db.raw(
        `COALESCE(content, '{}'::jsonb) || ?::jsonb`,
        [JSON.stringify(contentPatch)]
      );
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('No mutable fields supplied for update', 400, 'VALIDATION_ERROR');
    }

    // R-FIX-BUG-565-ROUTE-PATCH-OPTLOCK
    const row = await advanceDirectiveService.update(
      auth,
      req.params.id,
      expectedLockVersion,
      updates,
    );
    res.json(mapAdvanceDirectiveRowToResponse(row));
  } catch (err) { next(err); }
});

export default router;
