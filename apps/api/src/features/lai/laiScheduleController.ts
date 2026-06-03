import { Request, Response, NextFunction } from 'express';
import { laiScheduleService } from './laiScheduleService';
import {
  LaiScheduleCreateSchema,
  LaiScheduleUpdateSchema,
  LaiScheduleResponseSchema,
  LaiGivenCreateSchema,
  AimsAssessmentCreateSchema,
} from '@signacare/shared';
import { z } from 'zod';
import { buildAuthContext } from '../../shared/buildAuthContext';

const LaiScheduleListResponseSchema = z.object({
  data: z.array(LaiScheduleResponseSchema),
});

export const listActiveLaiSchedules = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const result = await laiScheduleService.listActiveByClinic(auth);
    res.json(LaiScheduleListResponseSchema.parse({ data: result }));
  } catch (err) {
    next(err);
  }
};

export const listLaiSchedules = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { patientId } = req.params;
    const auth = buildAuthContext(req, patientId);
    const result = await laiScheduleService.listByPatient(auth, patientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getLaiSchedule = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = buildAuthContext(req);
    const result = await laiScheduleService.getById(auth, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createLaiSchedule = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = LaiScheduleCreateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId);
    const result = await laiScheduleService.create(auth, dto);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const updateLaiSchedule = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = LaiScheduleUpdateSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const result = await laiScheduleService.update(auth, req.params.id, dto);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const listLaiGiven = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { scheduleId } = req.params;
    const auth = buildAuthContext(req);
    const result = await laiScheduleService.listGiven(auth, scheduleId);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const recordLaiGiven = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = LaiGivenCreateSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const result = await laiScheduleService.recordGiven(auth, dto);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const createAimsAssessment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const dto = AimsAssessmentCreateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId);
    const result = await laiScheduleService.createAimsAssessment(auth, dto);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const listAimsAssessments = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { patientId } = req.params;
    const { scheduleId } = req.query as { scheduleId?: string };
    const auth = buildAuthContext(req, patientId);
    const result = await laiScheduleService.listAimsAssessments(auth, patientId, scheduleId);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
