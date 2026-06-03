import type { Request, Response, NextFunction } from 'express';
import {
  CreatePatientSchema,
  UpdatePatientSchema,
  PatientSearchSchema,
} from '@signacare/shared';
import { patientService } from './patientService';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError } from '../../shared/errors';

// UUID shape guard — 8-4-4-4-12 hex, case-insensitive. We deliberately
// don't check the version/variant bits (v1-v5) because the NIL UUID
// 00000000-0000-0000-0000-000000000000 and some external system
// UUIDs don't conform. The purpose is to reject obviously-malformed
// input (non-hex, wrong shape) before it reaches the DB driver, NOT
// to validate UUID semantics — the service layer handles
// "not found" for UUIDs that don't exist.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string | undefined, field: string): void {
  if (!value || !UUID_REGEX.test(value)) {
    throw new AppError(
      `Invalid ${field}: expected a UUID`,
      422,
      'VALIDATION_ERROR',
      { field, value },
    );
  }
}

export const patientController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth    = buildAuthContext(req);
      const filters = PatientSearchSchema.parse(req.query);
      const result  = await patientService.list(auth, filters);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth   = buildAuthContext(req);
      const { id } = req.params;
      assertUuid(id, 'patient id');
      const patient = await patientService.getById(auth, id);
      res.status(200).json(patient);
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth    = buildAuthContext(req);
      const dto     = CreatePatientSchema.parse(req.body);
      const patient = await patientService.create(auth, dto);
      res.status(201).json(patient);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth   = buildAuthContext(req);
      const { id } = req.params;
      assertUuid(id, 'patient id');
      const dto     = UpdatePatientSchema.parse(req.body);
      const patient = await patientService.update(auth, id, dto);
      res.status(200).json(patient);
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth   = buildAuthContext(req);
      const { id } = req.params;
      assertUuid(id, 'patient id');
      await patientService.softDelete(auth, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
