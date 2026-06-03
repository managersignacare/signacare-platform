import type { Request, Response, NextFunction } from 'express';
import {
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
  EpisodeSearchSchema,
  CloseEpisodeSchema,
  EpisodeResponseSchema,
  EpisodeListResponseSchema,
} from '@signacare/shared';
import { episodeService } from './episodeService';
import { buildAuthContext } from '../../shared/buildAuthContext';

export const episodeController = {
  async listForPatient(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { patientId } = req.params;
      const filters = EpisodeSearchSchema.parse(req.query);
      const auth = buildAuthContext(req, patientId);
      const result = await episodeService.listForPatient(
        auth,
        patientId,
        filters
      );
      res.status(200).json(EpisodeListResponseSchema.parse(result));
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const auth = buildAuthContext(req);
      const episode = await episodeService.getById(auth, id);
      res.status(200).json(EpisodeResponseSchema.parse(episode));
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = CreateEpisodeSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      const episode = await episodeService.create(auth, dto);
      res.status(201).json(EpisodeResponseSchema.parse(episode));
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const dto = UpdateEpisodeSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const episode = await episodeService.update(auth, id, dto);
      res.status(200).json(EpisodeResponseSchema.parse(episode));
    } catch (err) {
      next(err);
    }
  },

  async close(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const dto = CloseEpisodeSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const episode = await episodeService.close(auth, id, dto);
      res.status(200).json(EpisodeResponseSchema.parse(episode));
    } catch (err) {
      next(err);
    }
  },
};
