// apps/api/src/controllers/staffController.ts
import type { Request, Response, NextFunction } from "express";
import { StaffCreateSchema, StaffUpdateSchema } from "@signacare/shared";
import { z } from "zod";
import { buildAuthContext } from "../../shared/buildAuthContext";
import { db } from "../../db/db";
import { HttpError } from "../../shared/errors";
import { StaffService } from "./staffService";
import { StaffRepository } from "./staffRepository";

const staffService = new StaffService(new StaffRepository());

const ClinicIdSchema = z.string().uuid();

function resolveClinicScope(
  req: Request,
  requestedClinicId: string | undefined,
): string {
  const sessionClinicId = req.clinicId;
  if (!sessionClinicId) {
    throw new HttpError(401, "UNAUTHENTICATED", "Tenant context missing");
  }

  if (!requestedClinicId) {
    return sessionClinicId;
  }

  const parsed = ClinicIdSchema.safeParse(requestedClinicId);
  if (!parsed.success) {
    throw new HttpError(422, "VALIDATION_ERROR", "clinicId must be a valid UUID");
  }

  const isSuperadmin = req.user?.role === "superadmin";
  if (!isSuperadmin && parsed.data !== sessionClinicId) {
    throw new HttpError(403, "FORBIDDEN", "Cross-clinic staff access is superadmin-only");
  }

  return parsed.data;
}

async function applyClinicScopeOverrideIfNeeded(_req: Request, clinicId: string): Promise<void> {
  await db.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
}

export async function listStaffController(req: Request, res: Response, next: NextFunction) {
  try {
    const requestedClinicId = typeof req.query.clinicId === "string" ? req.query.clinicId : undefined;
    const clinicId = resolveClinicScope(req, requestedClinicId);
    await applyClinicScopeOverrideIfNeeded(req, clinicId);
    const staff = await staffService.listStaff(clinicId);
    res.status(200).json(staff);
  } catch (err) { next(err); }
}

export async function getStaffController(req: Request, res: Response, next: NextFunction) {
  try {
    const requestedClinicId = typeof req.query.clinicId === "string" ? req.query.clinicId : undefined;
    const clinicId = resolveClinicScope(req, requestedClinicId);
    await applyClinicScopeOverrideIfNeeded(req, clinicId);
    const staff = await staffService.getStaff(clinicId, req.params.id);
    res.status(200).json(staff);
  } catch (err) { next(err); }
}

export async function createStaffController(req: Request, res: Response, next: NextFunction) {
  try {
    const requestedClinicId = typeof req.body?.clinicId === "string" ? req.body.clinicId : undefined;
    const clinicId = resolveClinicScope(req, requestedClinicId);
    await applyClinicScopeOverrideIfNeeded(req, clinicId);
    const body = StaffCreateSchema.parse({ ...req.body, clinicId });
    const auth = { ...buildAuthContext(req), clinicId };
    const staff = await staffService.createStaff(clinicId, body, auth);
    res.status(201).json(staff);
  } catch (err) {
    next(err);
  }
}

export async function updateStaffController(req: Request, res: Response, next: NextFunction) {
  try {
    const requestedClinicId = typeof req.query.clinicId === "string" ? req.query.clinicId : undefined;
    const clinicId = resolveClinicScope(req, requestedClinicId);
    await applyClinicScopeOverrideIfNeeded(req, clinicId);
    const body = StaffUpdateSchema.parse(req.body);
    const auth = { ...buildAuthContext(req), clinicId };
    const staff = await staffService.updateStaff(clinicId, req.params.id, body, auth);
    res.status(200).json(staff);
  } catch (err) {
    next(err);
  }
}
