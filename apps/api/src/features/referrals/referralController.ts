// apps/api/src/features/referrals/referralController.ts
import type { Request, Response, NextFunction } from 'express';
import {
  CreateReferralSchema,
  UpdateReferralSchema,
  ReferralDecisionSchema,
  ReferralListFiltersSchema,
  ReferralOcrFieldsSchema,
} from '@signacare/shared';
import { referralService } from './referralService';

export class ReferralController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const parseResult = ReferralListFiltersSchema.safeParse(req.query);

      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid filters',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.flatten(),
        });
        return;
      }

      const { items, total } = await referralService.list({
        clinicId,
        filters: parseResult.data,
      });

      res.json({ items, total });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const referralId = req.params.id;

      const referral = await referralService.getById({ clinicId, referralId });
      if (!referral) {
        res.status(404).json({ error: 'Referral not found', code: 'NOT_FOUND' });
        return;
      }

      res.json(referral);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const userId = req.user!.id;

      const parseResult = CreateReferralSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid referral payload',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.flatten(),
        });
        return;
      }

      const referral = await referralService.createReferral({
        clinicId,
        userId,
        dto: parseResult.data,
      });

      // Team assignment + intake episode now handled in referralService.createReferral

      res.status(201).json(referral);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const userId = req.user!.id;
      const referralId = req.params.id;

      const parseResult = UpdateReferralSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid referral update payload',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.flatten(),
        });
        return;
      }

      const referral = await referralService.updateReferral({
        clinicId,
        userId,
        referralId,
        dto: parseResult.data,
      });

      if (!referral) {
        res.status(404).json({ error: 'Referral not found', code: 'NOT_FOUND' });
        return;
      }

      res.json(referral);
    } catch (err) {
      next(err);
    }
  }

  async decide(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const userId = req.user!.id;
      const referralId = req.params.id;

      const parseResult = ReferralDecisionSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid decision payload',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.flatten(),
        });
        return;
      }

      const referral = await referralService.decideReferral({
        clinicId,
        userId,
        referralId,
        dto: parseResult.data,
      });

      if (!referral) {
        res.status(404).json({ error: 'Referral not found', code: 'NOT_FOUND' });
        return;
      }

      res.json(referral);
    } catch (err) {
      next(err);
    }
  }

  async uploadAttachment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const userId = req.user!.id;
      const referralId = req.params.id;

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded', code: 'VALIDATION_ERROR' });
        return;
      }

      const { assertReferralAttachmentSafe } = await import('../../shared/referralAttachmentSafety');
      await assertReferralAttachmentSafe({
        originalName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      });

      // S1.1-DEFERRED-A: persist via the BlobStorage facade. The pre-S1.1
      // code expected `file.filename` or `file.storageKey` from the legacy
      // disk-storage Multer config — neither is present on a memoryStorage
      // file, so referral uploads were silently broken until now.
      // Imported here lazily to keep this controller decoupled from the
      // upload backend at module-init time.
      const { blobStorage, buildAttachmentStorageKey } = await import('../../shared/blobStorage');
      const storageKey = buildAttachmentStorageKey(file.originalname).replace(/^attachments\//, 'referrals/');
      const put = await blobStorage.put(storageKey, file.buffer, file.mimetype);

      const referral = await referralService.uploadAttachment({
        clinicId,
        userId,
        referralId,
        file: {
          originalname: file.originalname,
          filename: put.key,
          mimetype: file.mimetype,
          size: file.size,
          storageKey: put.key,
        },
      });

      if (!referral) {
        res.status(404).json({ error: 'Referral not found', code: 'NOT_FOUND' });
        return;
      }

      res.status(201).json(referral);
    } catch (err) {
      next(err);
    }
  }

  async getOcrPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const referralId = req.params.id;

      const data = await referralService.getOcrPreview({ clinicId, referralId });
      if (!data) {
        res.status(404).json({ error: 'OCR data not found', code: 'NOT_FOUND' });
        return;
      }

      res.json({ ocrData: data });
    } catch (err) {
      next(err);
    }
  }

  async confirmOcrData(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const userId = req.user!.id;
      const referralId = req.params.id;
      const data = req.body;

      const referral = await referralService.confirmOcrData({
        clinicId,
        userId,
        referralId,
        data,
      });

      if (!referral) {
        res.status(404).json({ error: 'Referral not found', code: 'NOT_FOUND' });
        return;
      }

      res.json(referral);
    } catch (err) {
      next(err);
    }
  }

  async getOcrFields(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const referralId = req.params.id;

      const fields = await referralService.getOcrFields({ clinicId, referralId });
      if (!fields) {
        res.status(404).json({ error: 'OCR fields not found', code: 'NOT_FOUND' });
        return;
      }

      const safe = ReferralOcrFieldsSchema.parse(fields);
      res.json(safe);
    } catch (err) {
      next(err);
    }
  }
}

export const referralController = new ReferralController();
