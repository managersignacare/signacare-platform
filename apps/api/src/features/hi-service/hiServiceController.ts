// apps/api/src/features/hi-service/hiServiceController.ts
//
// BUG-336 + BUG-339 — admin-facing endpoints that live-validate HPI-I and
// HPI-O against the HI Service (via NASH mTLS from BUG-297). Two routes:
//   POST /hi-service/verify-hpii — wraps verifyHpii, gated by staff:update
//   POST /hi-service/verify-hpio — wraps verifyHpio, gated by clinic:update
//
// Offline/stub behaviour (no NASH cert): format + Luhn pass returns
// { found:true, ..., error:'…unverified' } so the admin UI can surface a
// warning banner and still allow save. When configured, returns the
// HI Service response verbatim (name, organisationType, qualification).
import type { Request, Response, NextFunction } from 'express';
import {
  HpiiVerifyRequestSchema,
  HpioVerifyRequestSchema,
} from '@signacare/shared';
import { verifyHpii, verifyHpio } from '../../integrations/hiService/hiServiceClient';

export async function verifyHpiiController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = HpiiVerifyRequestSchema.parse(req.body);
    const result = await verifyHpii(dto.hpii);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyHpioController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = HpioVerifyRequestSchema.parse(req.body);
    const result = await verifyHpio(dto.hpio);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
