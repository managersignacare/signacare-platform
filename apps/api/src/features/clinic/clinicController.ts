// apps/api/src/controllers/clinicController.ts
import type { Request, Response, NextFunction } from "express";
import {
  ClinicCreateSchema,
  ClinicUpdateSchema,
  ClinicCreateDTO,
  ClinicUpdateDTO,
} from "@signacare/shared";
import { ClinicService } from "./clinicService";
import { ClinicRepository } from "./clinicRepository";
import { validateBody } from "../../middleware/validationMiddleware";
import { AppError, ErrorCode } from "../../shared/errors";

const clinicService = new ClinicService(new ClinicRepository());

export const validateClinicCreate = validateBody(ClinicCreateSchema);
export const validateClinicUpdate = validateBody(ClinicUpdateSchema);

export async function listClinicsController(req: Request, res: Response) {
  const isSuperadmin = req.user?.role === 'superadmin';
  const clinics = isSuperadmin
    ? await clinicService.listClinics()
    : [await clinicService.getClinic(req.clinicId)];
  res.status(200).json(clinics);
}

export async function getClinicController(req: Request, res: Response, next: NextFunction) {
  const isSuperadmin = req.user?.role === 'superadmin';
  if (!isSuperadmin && req.params.id !== req.clinicId) {
    next(new AppError('Clinic not found', 404, ErrorCode.NOT_FOUND));
    return;
  }
  const clinic = await clinicService.getClinic(req.params.id);
  res.status(200).json(clinic);
}

export async function createClinicController(req: Request, res: Response) {
  const dto = req.body as ClinicCreateDTO;
  const clinic = await clinicService.createClinic(dto);
  res.status(201).json(clinic);
}

export async function updateClinicController(req: Request, res: Response, next: NextFunction) {
  const isSuperadmin = req.user?.role === 'superadmin';
  if (!isSuperadmin && req.params.id !== req.clinicId) {
    next(new AppError('Clinic not found', 404, ErrorCode.NOT_FOUND));
    return;
  }
  const dto = req.body as ClinicUpdateDTO;
  const clinic = await clinicService.updateClinic(req.params.id, dto);
  res.status(200).json(clinic);
}

export async function getMyClinicController(req: Request, res: Response) {
  const clinic = await clinicService.getClinic(req.clinicId);
  res.status(200).json(clinic);
}

export async function updateMyClinicController(req: Request, res: Response) {
  const dto = req.body as ClinicUpdateDTO;
  const clinic = await clinicService.updateClinic(req.clinicId, dto);
  res.status(200).json(clinic);
}
