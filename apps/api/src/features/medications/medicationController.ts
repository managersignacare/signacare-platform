import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { medicationService } from './medicationService';
import { buildAuthContext } from '../../shared/buildAuthContext';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §3.1) ───────────────────────────
// The controller accepts the frontend's dual-naming (`medicationName` or
// `drugName`) for convenience. At least one of the two must be present.
// Downstream service calls use the canonical `medicationName` after the
// resolvedName fallback logic runs. Schema is local per §12.

const MedicationCreateBodySchema = z
  .object({
    patientId: z.string().uuid(),
    episodeId: z.string().uuid().nullable().optional(),
    medicationName: z.string().min(1).max(300).optional(),
    drugName: z.string().min(1).max(300).optional(),
    genericName: z.string().min(1).max(200).optional(),
    dose: z.string().min(1).max(100),
    frequency: z.string().min(1).max(100),
    route: z.string().min(1).max(50).optional(),
    isLai: z.boolean().optional(),
    isClozapine: z.boolean().optional(),
    isS8: z.boolean().optional(),
    laiFrequency: z.string().max(50).optional(),
    prescriber: z.string().max(200).optional(),
    indication: z.string().max(500).optional(),
    prescribedBySpecialty: z
      .enum(['general_medicine', 'endocrinology', 'paediatrics',
             'obstetrics_gynaecology', 'surgery', 'oncology', 'mental_health'])
      .nullable()
      .optional(),
    category: z.string().max(50).nullable().optional(),
  })
  .refine((d) => !!(d.medicationName ?? d.drugName), {
    message: 'medicationName (or drugName) is required',
    path: ['medicationName'],
  });

const MedicationUpdateBodySchema = z.object({
  // BUG-371b — REQUIRED expected lock_version per CLAUDE.md §1.6.
  // Caller MUST send the lockVersion from the GET response. Helper
  // throws AppError(409, 'OPTIMISTIC_LOCK_CONFLICT') if mismatched.
  expectedLockVersion: z.number().int().positive(),
  episodeId: z.string().uuid().nullable().optional(),
  medicationName: z.string().min(1).max(300).optional(),
  drugName: z.string().min(1).max(300).optional(),
  genericName: z.string().min(1).max(200).optional(),
  dose: z.string().min(1).max(100).optional(),
  frequency: z.string().min(1).max(100).optional(),
  route: z.string().min(1).max(50).optional(),
  // BUG-554 — `'ceased'` REMOVED from the PATCH-status enum to close
  // the AHPRA forensic gap. Cessations MUST go through the dedicated
  // `/cease` path (`ceaseMedication` controller below) which enforces
  // required `endDate` + `reasonForCessation` per BUG-371b absorb-1.
  // The remaining values match the DB CHECK constraint
  // `patient_medications_status_valid` exactly: ['active','paused','draft'].
  // 'ceased_discontinued' is a terminal state reached only via the
  // dedicated cease path and is excluded here. The pre-fix enum also
  // listed 'tapering','suspended','on_hold' which the DB CHECK rejects;
  // those were always 500-on-write — schema/DB now aligned.
  status: z.enum(['active', 'paused', 'draft']).optional(),
  // endDate + reasonForCessation removed from the PATCH schema —
  // belong on the cease path only. A future "uncease" / reactivate
  // path would have its own dedicated endpoint with its own DTO.
  isLai: z.boolean().optional(),
  isClozapine: z.boolean().optional(),
  isS8: z.boolean().optional(),
  laiFrequency: z.string().max(50).optional(),
  indication: z.string().max(500).optional(),
  prescriber: z.string().max(200).optional(),
  prescribedBySpecialty: z.string().max(50).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  notes: z.string().optional(),
});

export const listMedications = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const { patientId } = req.params;
    const { status } = req.query as { status?: string };
    const result = await medicationService.listByPatient(auth, patientId, status);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getMedication = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const result = await medicationService.getById(auth, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createMedication = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const dto = MedicationCreateBodySchema.parse(req.body);
    const resolvedName = dto.medicationName ?? dto.drugName!; // refine guarantees one present
    const result = await medicationService.create(auth, {
      patientId: dto.patientId,
      episodeId: dto.episodeId ?? null,
      medicationName: resolvedName,
      genericName: dto.genericName,
      dose: dto.dose,
      frequency: dto.frequency,
      route: dto.route,
      isLai: dto.isLai,
      isClozapine: dto.isClozapine,
      isS8: dto.isS8,
      laiFrequency: dto.laiFrequency,
      prescriber: dto.prescriber,
      indication: dto.indication,
      prescribedBySpecialty: dto.prescribedBySpecialty ?? null,
      category: dto.category ?? null,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const updateMedication = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const dto = MedicationUpdateBodySchema.parse(req.body);
    const { expectedLockVersion, ...changes } = dto;
    const result = await medicationService.update(auth, req.params.id, changes, expectedLockVersion);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// BUG-371b absorb-1 (L4 Rule 4 BLOCK): restore endDate +
// reasonForCessation. Pre-absorb the schema accepted ONLY
// expectedLockVersion and the repository patched only {status: 'ceased'}
// — clinician's reason ("rash + suspected SJS") was silently lost.
// AHPRA forensic queries on "why was warfarin ceased" returned NULL.
const MedicationCeaseBodySchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonForCessation: z.string().min(1).max(500),
});

export const ceaseMedication = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const dto = MedicationCeaseBodySchema.parse(req.body);
    const result = await medicationService.cease(auth, req.params.id, dto);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const deleteMedication = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    await medicationService.softDelete(auth, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
