// apps/api/src/features/pathology/pathologyController.ts
import type { Request, Response, NextFunction } from 'express';
import * as pathologyService from './pathologyService';
import {
  PathologyOrderCreateSchema,
  PathologyResultIngestSchema,
  CriticalAckSchema,
} from '@signacare/shared';
import { buildAuthContext } from '../../shared/buildAuthContext';

export async function placeOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = PathologyOrderCreateSchema.parse(req.body);
    const auth = buildAuthContext(req, dto.patientId);
    const order = await pathologyService.placeOrder(auth, dto);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
}

export async function listOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { patientId } = req.params;
    const auth = buildAuthContext(req, patientId);
    const orders = await pathologyService.listOrders(auth, patientId!);
    res.json(orders);
  } catch (err) {
    next(err);
  }
}

export async function getOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const data = await pathologyService.getOrderWithResults(auth, req.params['id']!);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function ingestResult(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Tier 3.4 — ingestResult is the LIS/HL7 webhook. This path is
    // authenticated by the integration API-key middleware mounted on
    // the route (see pathologyRoutes), NOT by clinician session.
    // Keeping the raw (clinicId, dto) signature here reflects that
    // the caller is an integration actor, not a patient-care clinician.
    const dto = PathologyResultIngestSchema.parse(req.body);
    const result = await pathologyService.ingestResult(req.user!.clinicId, dto);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listCriticalUnacknowledged(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const results = await pathologyService.listCriticalUnacknowledged(auth);
    res.json(results);
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeCritical(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    CriticalAckSchema.parse(req.body);
    const auth = buildAuthContext(req);
    await pathologyService.acknowledgeCritical(auth, req.params['resultId']!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
