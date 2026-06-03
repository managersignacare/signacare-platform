/**
 * Carer/Family Module Routes
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { CreateCarerSchema, UpdateCarerSchema } from '@signacare/shared';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.CARERS));
const ROLES = ['clinician', 'admin', 'superadmin'];

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified against schema-snapshot.json: carers has these 11 columns.
// NO deleted_at, NO status column — DELETE is a hard delete (audit
// trail preserved by audit_trigger_fn AFTER trigger on carers).
const CARER_COLUMNS = [
  'id',
  'patient_id',
  'clinic_id',
  'given_name',
  'family_name',
  'relationship',
  'phone',
  'email',
  'is_primary',
  'created_at',
  'updated_at',
] as const;

router.get('/patient/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('carers').where({ patient_id: req.params.patientId, clinic_id: req.clinicId }).orderBy('is_primary', 'desc');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateCarerSchema.parse(req.body);
    const { patientId, givenName, familyName, relationship, phone, email, isPrimary } = dto;
    const [row] = await db('carers').insert({
      clinic_id: req.clinicId, patient_id: patientId, given_name: givenName, family_name: familyName,
      relationship, phone, email, is_primary: isPrimary ?? false,
    }).returning(CARER_COLUMNS);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/:id', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = UpdateCarerSchema.parse(req.body);
    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const [k, v] of Object.entries(dto)) {
      updates[k.replace(/([A-Z])/g, '_$1').toLowerCase()] = v;
    }
    delete updates.id; delete updates.clinic_id;
    const [row] = await db('carers').where({ id: req.params.id, clinic_id: req.clinicId }).update(updates).returning(CARER_COLUMNS);
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // carers has no soft-delete column (verified post-R2); hard-delete
    // is the canonical pattern. Audit trail preserved by audit_trigger_fn
    // AFTER DELETE trigger on the table — every removal lands in audit_log
    // with old_data populated.
    await db('carers').where({ id: req.params.id, clinic_id: req.clinicId }).delete();
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
