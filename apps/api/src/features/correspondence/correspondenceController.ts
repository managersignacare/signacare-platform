import type { Request, Response, NextFunction } from 'express';
import * as correspondenceService from './correspondenceService';
import {
  LetterCreateSchema,
  LetterUpdateSchema,
  GenerateLetterFromNoteSchema,
} from '@signacare/shared';
import { logger } from '../../utils/logger';

export async function createLetter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = LetterCreateSchema.parse(req.body);
    const letter = await correspondenceService.createLetter(req.clinicId, req.user!.id, dto);
    res.status(201).json(letter);
  } catch (err) {
    // BUG-267 L4 absorption — use logger so err passes through the
    // custom serializer (sanitizeErrForLogging). Pre-fix this path
    // called console.error with the raw err.message, leaking PHI
    // from any PG constraint-violation caught here.
    logger.error({ err }, '[LETTER CREATE ERROR]');
    next(err);
  }
}

export async function listLetters(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const letters = await correspondenceService.listLettersByPatient(
      req.clinicId, req.params['patientId']!,
    );
    res.json(letters);
  } catch (err) { next(err); }
}

export async function getLetter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const letter = await correspondenceService.getLetter(req.clinicId, req.params['letterId']!);
    res.json(letter);
  } catch (err) { next(err); }
}

export async function updateLetter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = LetterUpdateSchema.parse(req.body);
    const letter = await correspondenceService.updateLetter(
      req.clinicId, req.params['letterId']!, dto,
    );
    res.json(letter);
  } catch (err) { next(err); }
}

export async function deleteLetter(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await correspondenceService.deleteLetter(req.clinicId, req.params['letterId']!);
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await correspondenceService.listTemplates(req.clinicId);
    res.json(templates);
  } catch (err) { next(err); }
}

export async function generateFromNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = GenerateLetterFromNoteSchema.parse(req.body);
    const drafts = await correspondenceService.generateLetterDraftsFromNote(
      req.clinicId, dto,
    );
    res.status(201).json(drafts);
  } catch (err) { next(err); }
}
