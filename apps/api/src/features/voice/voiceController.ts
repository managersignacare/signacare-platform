// apps/api/src/features/voice/voiceController.ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  VoiceCallCreateDTOSchema,
  VoiceCallUpdateDTOSchema,
  VoiceScriptCreateDTOSchema,
  VoicePatientPreferencesDTOSchema,
} from '@signacare/shared';
import * as service from './voiceService';

// Local Zod schema for the script content update endpoint
// (Phase R3b / CLAUDE.md §12).
const UpdateScriptBodySchema = z.object({
  content: z.string().min(1).max(100000),
});

// ── Calls ─────────────────────────────────────────────────────────────────────

export async function createCall(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = VoiceCallCreateDTOSchema.parse(req.body);
    const result = await service.logCall(req.clinicId, req.user!.id, dto);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function patchCall(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = VoiceCallUpdateDTOSchema.parse(req.body);
    const result = await service.updateCall(
      req.clinicId,
      req.params.callId,
      dto,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getCallsByPatient(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 50;
    const offset = req.query.offset
      ? parseInt(req.query.offset as string, 10)
      : 0;
    const results = await service.listCallsForPatient(
      req.clinicId,
      req.params.patientId,
      limit,
      offset,
    );
    res.json({ data: results, limit, offset });
  } catch (err) {
    next(err);
  }
}

export async function getCallDetail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.getCallDetails(
      req.clinicId,
      req.params.callId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── Scripts ───────────────────────────────────────────────────────────────────

export async function createScript(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = VoiceScriptCreateDTOSchema.parse(req.body);
    const result = await service.createScript(
      req.clinicId,
      req.user!.id,
      dto,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getScripts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const results = await service.listScripts(req.clinicId);
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
}

export async function updateScript(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { content } = UpdateScriptBodySchema.parse(req.body);
    const result = await service.updateScriptContent(
      req.clinicId,
      req.params.scriptId,
      content,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── Patient preferences ───────────────────────────────────────────────────────

export async function setPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = VoicePatientPreferencesDTOSchema.parse(req.body);
    const result = await service.setPatientPreferences(
      req.clinicId,
      req.params.patientId,
      dto,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.getPatientPreferences(
      req.clinicId,
      req.params.patientId,
    );
    if (!result) {
      res.json({
        patientId: req.params.patientId,
        optedOut: false,
        preferredCallStart: null,
        preferredCallEnd: null,
        preferredDays: null,
      });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}
