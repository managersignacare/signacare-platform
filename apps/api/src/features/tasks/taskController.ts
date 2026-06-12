import type { Request, Response, NextFunction } from 'express';
import * as taskService from './taskService';
import {
  TaskCreateSchema,
  TaskMonitoringSummarySchema,
  TaskUpdateSchema,
  TaskListQuerySchema,
} from '@signacare/shared';
import { buildAuthContext } from '../../shared/buildAuthContext';

export async function createTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = TaskCreateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId ?? undefined);
    const task = await taskService.createTask(auth, dto);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
}

export async function listTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = TaskListQuerySchema.parse(req.query);
    const auth = buildAuthContext(req, filters.patientId ?? undefined);
    const tasks = await taskService.listTasks(auth, filters);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
}

export async function getTaskMonitoringSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = TaskListQuerySchema.parse(req.query);
    const auth = buildAuthContext(req, filters.patientId ?? undefined);
    const summary = await taskService.getTaskMonitoringSummary(auth, filters);
    res.json(TaskMonitoringSummarySchema.parse(summary));
  } catch (err) {
    next(err);
  }
}

export async function getTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const task = await taskService.getTask(auth, req.params['taskId']!);
    res.json(task);
  } catch (err) {
    next(err);
  }
}

export async function updateTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = TaskUpdateSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const task = await taskService.updateTask(auth, req.params['taskId']!, dto);
    res.json(task);
  } catch (err) {
    next(err);
  }
}

export async function deleteTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    await taskService.deleteTask(auth, req.params['taskId']!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
