import { Request, Response, NextFunction } from 'express';
import { clozapineService } from './clozapineService';
import {
  ClozapineRegistrationCreateSchema,
  ClozapineRegistrationUpdateSchema,
  ClozapineRegistrationResponseSchema,
  ClozapineBloodResultCreateSchema,
  ClozapineBloodResultResponseSchema,
  ClozapineTitrationDayCreateSchema,
  ClozapineAdministrationCreateSchema,
  ClozapineObservationCreateSchema,
  ClozapineMonitoringCheckCreateSchema,
} from '@signacare/shared';
import { z } from 'zod';
// BUG-293 — clozapineService migrated to AuthContext-first. Every
// prescribing-adjacent call routes through the service so the
// discipline-barrier (Layer A) guard runs before the repository.
import { buildAuthContext } from '../../shared/buildAuthContext';
// BUG-618 — apply response mappers at the controller boundary so the
// frontend receives canonical camelCase per CLAUDE.md §5.2 ("Backend
// must map snake_case DB columns to camelCase response fields").
// Registration + blood-result mappers are applied service-side
// (clozapineService imports them under the legacy alias names);
// titration / administration / observation / monitoring-check
// responses are mapped at this controller boundary after service-layer
// orchestration.
import {
  mapClozapineTitrationDayRowToResponse,
  mapClozapineAdministrationRowToResponse,
  mapClozapineObservationRowToResponse,
  mapClozapineMonitoringCheckRowToResponse,
} from './clozapineMappers';

const ClozapineRegistrationListResponseSchema = z.array(ClozapineRegistrationResponseSchema);
const ClozapineBloodResultListResponseSchema = z.array(ClozapineBloodResultResponseSchema);

export const listActiveClozapineRegistrations = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const result = await clozapineService.listActiveByClinic(auth);
    res.json(ClozapineRegistrationListResponseSchema.parse(result));
  } catch (err) {
    next(err);
  }
};

export const listClozapineRegistrations = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { patientId } = req.params;
    const auth = buildAuthContext(req, patientId);
    const result = await clozapineService.listByPatient(auth, patientId);
    res.json(ClozapineRegistrationListResponseSchema.parse(result));
  } catch (err) {
    next(err);
  }
};

export const getClozapineRegistration = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const result = await clozapineService.getById(auth, req.params.id);
    res.json(ClozapineRegistrationResponseSchema.parse(result));
  } catch (err) {
    next(err);
  }
};

export const createClozapineRegistration = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = ClozapineRegistrationCreateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId);
    const result = await clozapineService.createRegistration(auth, dto);
    res.status(201).json(ClozapineRegistrationResponseSchema.parse(result));
  } catch (err) {
    next(err);
  }
};

export const updateClozapineRegistration = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = ClozapineRegistrationUpdateSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const result = await clozapineService.updateRegistration(auth, req.params.id, dto);
    res.json(ClozapineRegistrationResponseSchema.parse(result));
  } catch (err) {
    next(err);
  }
};

export const listBloodResults = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { registrationId } = req.params;
    const auth = buildAuthContext(req);
    const result = await clozapineService.listBloodResults(auth, registrationId);
    res.json(ClozapineBloodResultListResponseSchema.parse(result));
  } catch (err) {
    next(err);
  }
};

export const recordBloodResult = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = ClozapineBloodResultCreateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId);
    const result = await clozapineService.recordBloodResult(auth, dto);
    res.status(201).json(ClozapineBloodResultResponseSchema.parse(result));
  } catch (err) {
    next(err);
  }
};

// ── Titration Days ─────────────────────────────────────────────────────────
export const listTitrationDays = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const rows = await clozapineService.listTitrationDays(auth, req.params.registrationId);
    res.json(rows.map(mapClozapineTitrationDayRowToResponse));
  } catch (err) { next(err); }
};

export const upsertTitrationDay = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dto = ClozapineTitrationDayCreateSchema.parse(req.body);
    // BUG-293 — titration day writes `prescribed_by_staff_id`. Route
    // through the service so the discipline barrier (Layer A) gates the
    // write. DB trigger (Layer B) also fires for dbAdmin paths.
    const auth = buildAuthContext(req);
    const row = await clozapineService.upsertTitrationDay(auth, dto);
    res.status(201).json(mapClozapineTitrationDayRowToResponse(row));
  } catch (err) { next(err); }
};

// ── Administrations ────────────────────────────────────────────────────────
export const listAdministrations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const rows = await clozapineService.listAdministrations(auth, req.params.registrationId);
    res.json(rows.map(mapClozapineAdministrationRowToResponse));
  } catch (err) { next(err); }
};

export const createAdministration = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dto = ClozapineAdministrationCreateSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const row = await clozapineService.createAdministration(auth, dto);
    res.status(201).json(mapClozapineAdministrationRowToResponse(row));
  } catch (err) { next(err); }
};

// ── Observations ───────────────────────────────────────────────────────────
export const listObservations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const rows = await clozapineService.listObservations(auth, req.params.registrationId);
    res.json(rows.map(mapClozapineObservationRowToResponse));
  } catch (err) { next(err); }
};

export const createObservation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dto = ClozapineObservationCreateSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const row = await clozapineService.createObservation(auth, dto);
    res.status(201).json(mapClozapineObservationRowToResponse(row));
  } catch (err) { next(err); }
};

// ── Monitoring Checks ──────────────────────────────────────────────────────
export const listMonitoringChecks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const rows = await clozapineService.listMonitoringChecks(auth, req.params.registrationId);
    res.json(rows.map(mapClozapineMonitoringCheckRowToResponse));
  } catch (err) { next(err); }
};

export const upsertMonitoringCheck = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dto = ClozapineMonitoringCheckCreateSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const row = await clozapineService.upsertMonitoringCheck(auth, dto);
    res.status(201).json(mapClozapineMonitoringCheckRowToResponse(row));
  } catch (err) { next(err); }
};
