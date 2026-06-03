import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { todayLocal } from '../../utils/dateUtils';
import { escapeLike } from '../../shared/escapeLike';
import { escalationService } from './escalation.service';
import {
  CreateEscalationSchema,
  UpdateEscalationSchema,
  ResolveEscalationSchema,
  AddEscalationNoteSchema,
} from '@signacare/shared';
import { logger } from '../../utils/logger';
import { buildAuthContext } from '../../shared/buildAuthContext';

export const escalationController = {
  async listByPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { patientId } = req.params;
      const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;
      const auth = buildAuthContext(req, patientId);
      const escalations = await escalationService.listByPatient(auth, patientId, episodeId);
      res.json(escalations);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const esc = await escalationService.getById(auth, req.params.id);
      res.json(esc);
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = CreateEscalationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const auth = buildAuthContext(req, parsed.data.patientId);
      const { clinicId, staffId: userId } = auth;
      const esc = await escalationService.create(auth, parsed.data);
      logger.info({ clinicId, escalationId: esc.id, priority: esc.priority }, 'escalation raised');

      // Add patient to target team + create intake episode + save escalation document as note
      try {
        const team = esc.assignedTeam;
        if (team && parsed.data.patientId) {
          const { db } = await import('../../db/db');
          const orgUnit = await db('org_units').where({ clinic_id: clinicId }).whereRaw('name ILIKE ?', [`%${escapeLike(team)}%`]).first();
          if (orgUnit) {
            const today = todayLocal();

            // 1. Team assignment with 'new' referral status
            const existing = await db('patient_team_assignments')
              .where({ patient_id: parsed.data.patientId, org_unit_id: orgUnit.id })
              .first();
            if (!existing) {
              // Tier 2.4 — referred_by_id + escalation_id now real via
              // migration 6 (Tier 2.1). patient_team_assignments has no
              // clinic_id column (tenancy is via patient_id → patients).
              await db('patient_team_assignments').insert({
                id: randomUUID(), patient_id: parsed.data.patientId,
                org_unit_id: orgUnit.id, is_active: false,
                referral_status: 'new', referred_by_id: userId, escalation_id: esc.id,
                created_at: new Date(), updated_at: new Date(),
              });
            } else {
              await db('patient_team_assignments')
                .where({ patient_id: parsed.data.patientId, org_unit_id: orgUnit.id })
                .update({ referral_status: 'new', referred_by_id: userId, escalation_id: esc.id, updated_at: new Date() });
            }

            // 2. Create intake episode: "TeamName — Intake — Date"
            const intakeTitle = `${orgUnit.name} — Intake — ${today}`;
            const [intakeEp] = await db('episodes').insert({
              clinic_id: clinicId, patient_id: parsed.data.patientId,
              episode_type: 'intake', team_id: orgUnit.id, status: 'open',
              start_date: today, title: intakeTitle,
              presenting_problem: `Escalation/transfer of care to ${orgUnit.name}`,
              created_at: new Date(), updated_at: new Date(),
            }).returning('id');

            // 3. Save escalation ISBAR as a clinical note in the intake episode
            const isbar = parsed.data.isbar;
            const isbarText = [
              `**Escalation/Transfer of Care to ${orgUnit.name}**`,
              `**Priority:** ${esc.priority}`, '',
              `**I — Identify:** ${isbar.identify ?? ''}`,
              `**S — Situation:** ${isbar.situation ?? ''}`,
              `**B — Background:** ${isbar.background ?? ''}`,
              `**A — Assessment:** ${isbar.assessment ?? ''}`,
              `**R — Recommendation:** ${isbar.recommendation ?? ''}`,
            ].join('\n');
            await db('clinical_notes').insert({
              clinic_id: clinicId, patient_id: parsed.data.patientId,
              episode_id: intakeEp?.id ?? null, author_id: userId,
              title: `Escalation of Care — ${orgUnit.name}`,
              note_type: 'escalation', content: isbarText, status: 'signed',
              note_date_time: new Date(), created_at: new Date(), updated_at: new Date(),
            });

            logger.info({ clinicId, team: orgUnit.name, patientId: parsed.data.patientId, intakeEpisodeId: intakeEp?.id }, 'Escalation: intake episode created');
          }
        }
      } catch (epErr: unknown) {
        const errorMessage = epErr instanceof Error ? epErr.message : String(epErr);
        logger.warn({ err: errorMessage }, 'Failed to create team intake episode (non-fatal)');
      }

      res.status(201).json(esc);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = UpdateEscalationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const auth = buildAuthContext(req);
      const esc = await escalationService.update(auth, req.params.id, parsed.data);
      res.json(esc);
    } catch (err) {
      next(err);
    }
  },

  async acknowledge(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      const esc = await escalationService.acknowledge(auth, req.params.id);
      logger.info({ clinicId: auth.clinicId, escalationId: esc.id, acknowledgedBy: auth.staffId }, 'escalation acknowledged');
      res.json(esc);
    } catch (err) {
      next(err);
    }
  },

  async resolve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = ResolveEscalationSchema.parse(req.body);
      const notes = parsed.notes ?? '';
      const auth = buildAuthContext(req);
      const esc = await escalationService.resolve(auth, req.params.id, notes, parsed.expectedLockVersion);
      logger.info({ clinicId: auth.clinicId, escalationId: esc.id, resolvedBy: auth.staffId }, 'escalation resolved');
      res.json(esc);
    } catch (err) {
      next(err);
    }
  },

  async addNote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = AddEscalationNoteSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const esc = await escalationService.addNote(auth, req.params.id, parsed.notes, parsed.expectedLockVersion);
      res.json(esc);
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = buildAuthContext(req);
      await escalationService.softDelete(auth, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
