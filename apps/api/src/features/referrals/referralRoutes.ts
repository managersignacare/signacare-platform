// apps/api/src/features/referrals/referralRoutes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { referralController } from './referralController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import { multerUpload } from '../../middleware/uploadMiddleware';
import { uploadLimiter } from '../../middleware/rateLimiters';
import { db } from '../../db/db';
import { todayLocal } from '../../utils/dateUtils';
import { AppError } from '../../shared/errors';
import { ReferralDecisionSchema, ReferralResponseSchema } from '@signacare/shared';
import { referralClarificationCommands } from './referralClarificationCommands';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { referralStateCommands } from './referralStateCommands';
import { referralTaskCommands } from './referralTaskCommands';
import { referralService } from './referralService';
import { requirePermission, requireRole } from '../../middleware/rbacMiddleware';
import { mapReferralRowToResponse } from './referralResponseMapper';

const router = Router();
const ReferralQueueResponseSchema = z.object({
  items: z.array(ReferralResponseSchema),
  total: z.number().int().nonnegative(),
});

// All routes secured, with clinic context
router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.REFERRALS));

const canCreateReferral = requirePermission('referral:create');
const canUpdateReferral = requirePermission('referral:update');
const canTriageReferral = requirePermission('referral:triage');
const canAssignReferral = requirePermission('referral:assign');

router.get('/', (req, res, next) => referralController.list(req, res, next));

// ── Referral-out queue + task state machine ─────────────────────────────────
//
// These routes must be declared BEFORE `/:id` to avoid route collision.
// The queue is tenant-scoped by tenantMiddleware. It is now used as the
// "Referral Out" surface; intake remains on `/referrals`.

router.get('/queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ReferralQueueFiltersSchema } = await import('@signacare/shared');
    const filters = ReferralQueueFiltersSchema.parse(req.query);
    const { referralRepository: repo } = await import('./referralRepository');
    const { rows, total } = await repo.listCoordinatorQueue(req.clinicId, {
      specialty: filters.specialty,
      taskStatus: filters.taskStatus,
      direction: filters.direction ?? 'outbound',
      mineOnly: filters.mineOnly,
      coordinatorId: req.user!.id,
      page: filters.page,
      pageSize: filters.pageSize,
    });
    const items = rows.map((r) =>
      mapReferralRowToResponse(r as Parameters<typeof mapReferralRowToResponse>[0], []),
    );
    res.json(ReferralQueueResponseSchema.parse({
      items,
      total,
    }));
  } catch (err) { next(err); }
});

router.post('/:id/triage', canTriageReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ReferralTriageSchema } = await import('@signacare/shared');
    const dto = ReferralTriageSchema.parse(req.body);
    const updated = await referralTaskCommands.triageReferral({
      clinicId: req.clinicId,
      referralId: req.params.id,
      actorId: req.user!.id,
      reason: dto.reason,
    });
    res.json(mapReferralRowToResponse(updated, []));
  } catch (err) { next(err); }
});

router.post('/:id/assign', canAssignReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ReferralAssignSchema } = await import('@signacare/shared');
    const dto = ReferralAssignSchema.parse(req.body);
    const updated = await referralTaskCommands.assignReferral({
      clinicId: req.clinicId,
      referralId: req.params.id,
      actorId: req.user!.id,
      assignedToStaffId: dto.assignedToStaffId,
      reason: dto.reason,
    });
    res.json(mapReferralRowToResponse(updated, []));
  } catch (err) { next(err); }
});

// "Private small clinic" workflow — accept a referral without naming a
// specific clinician yet. Moves the task to 'accepted' so the queue
// filter shows it as confirmed intake.
router.post('/:id/accept', canUpdateReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ReferralAcceptSchema } = await import('@signacare/shared');
    const dto = ReferralAcceptSchema.parse(req.body);
    const updated = await referralTaskCommands.acceptReferral({
      clinicId: req.clinicId,
      referralId: req.params.id,
      actorId: req.user!.id,
      reason: dto.reason,
    });
    res.json(mapReferralRowToResponse(updated, []));
  } catch (err) { next(err); }
});

// Decline a referral with a mandatory reason. Terminal state.
router.post('/:id/decline', canUpdateReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ReferralDeclineSchema } = await import('@signacare/shared');
    const dto = ReferralDeclineSchema.parse(req.body);
    const reason = dto.decisionReasonCategory
      ? `[${dto.decisionReasonCategory}] ${dto.reason}`
      : dto.reason;
    const updated = await referralTaskCommands.declineReferral({
      clinicId: req.clinicId,
      referralId: req.params.id,
      actorId: req.user!.id,
      reason,
    });
    res.json(mapReferralRowToResponse(updated, []));
  } catch (err) { next(err); }
});

// Append a free-text note to a referral. The referral_state_transitions
// audit table stores the note as a same-state transition — reusing the
// audit log means notes surface in the same timeline as status changes
// without a new table. PATH1 (clinic_id) preserved on read and write.
router.post('/:id/notes', canUpdateReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ReferralNoteSchema } = await import('@signacare/shared');
    const dto = ReferralNoteSchema.parse(req.body);
    const row = await referralStateCommands.appendReferralNote({
      clinicId: req.clinicId,
      referralId: req.params.id,
      actorId: req.user!.id,
      note: dto.note,
    });
    res.status(201).json({ note: row });
  } catch (err) { next(err); }
});

// List notes + state transitions for a referral, newest first. Used by
// the queue expansion row to show the coordinator's private-clinic
// timeline (accept, decline, assign, note).
router.get('/:id/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('referral_state_transitions as rst')
      .leftJoin('staff as s', 's.id', 'rst.actor_id')
      .where({ 'rst.referral_id': req.params.id, 'rst.clinic_id': req.clinicId })
      .orderBy('rst.created_at', 'desc')
      .select(
        'rst.id',
        'rst.from_task_status',
        'rst.to_task_status',
        'rst.reason',
        'rst.created_at',
        's.given_name as actor_given_name',
        's.family_name as actor_family_name',
      );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// GET /my-offers — Must be before /:id to avoid route collision
router.get('/my-offers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { MyOffersFiltersSchema: Filters } = await import('@signacare/shared');
    const clinicId = req.clinicId;
    const staffId = req.user!.id;
    const filters = Filters.parse(req.query);
    const { referralRepository: repo } = await import('./referralRepository');
    const { rows, total } = await repo.listMyOffers(clinicId, staffId, filters);
    res.json({ items: rows, total });
  } catch (err) { next(err); }
});

router.get('/:id', (req, res, next) => referralController.getById(req, res, next));
// S1.2: Idempotency-Key on referral create.
router.post('/', canCreateReferral, idempotencyMiddleware(), (req, res, next) => referralController.create(req, res, next));
router.patch('/:id', canUpdateReferral, idempotencyMiddleware(), (req, res, next) => referralController.update(req, res, next));
// Update referral status by episode_id (used when accepting/rejecting from episode banner)
router.patch('/by-episode/:episodeId', canUpdateReferral, idempotencyMiddleware(), async (req, res, next) => {
  try {
    // Phase 0.7.5 c24 D8 (SD44) — column is `linked_episode_id`, not
    // `episode_id`. Prior code filtered on a non-existent column; the
    // WHERE silently matched zero rows, so every call returned
    // `{ ok: true }` without updating any referral. Status change from
    // episode banner was broken.
    const { UpdateReferralByEpisodeSchema } = await import('@signacare/shared');
    const { status } = UpdateReferralByEpisodeSchema.parse(req.body);

    const row = await referralStateCommands.updateReferralStatusByEpisode({
      clinicId: req.clinicId,
      episodeId: req.params.episodeId,
      status,
    });

    if (!row) {
      res.json({ ok: true });
      return;
    }

    res.json(
      mapReferralRowToResponse(
        row as Parameters<typeof mapReferralRowToResponse>[0],
        [],
      ),
    );
  } catch (err) { next(err); }
});

// Decision command by linked episode id. Used by episode banner actions so
// the UI can call the canonical decision command path (with confirmation,
// decline reasons, and strategy/state-machine logic) without first
// resolving referral id on the client.
router.post('/by-episode/:episodeId/decision', canUpdateReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = ReferralDecisionSchema.parse(req.body);
    const referral = await db('referrals')
      .where({ linked_episode_id: req.params.episodeId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first('id');

    if (!referral?.id) {
      throw new AppError('Referral not found for episode', 404, 'NOT_FOUND');
    }

    const updated = await referralService.decideReferral({
      clinicId: req.clinicId,
      userId: req.user!.id,
      referralId: String(referral.id),
      dto,
    });

    if (!updated) {
      throw new AppError('Referral not found for episode', 404, 'NOT_FOUND');
    }

    res.json(ReferralResponseSchema.parse(updated));
  } catch (err) { next(err); }
});
router.post('/:id/decision', canUpdateReferral, idempotencyMiddleware(), (req, res, next) =>
  referralController.decide(req, res, next),
);
router.post(
  '/:id/attachments',
  canUpdateReferral,
  idempotencyMiddleware(),
  uploadLimiter,
  multerUpload.single('file'),
  (req, res, next) => referralController.uploadAttachment(req, res, next),
);
router.get('/:id/ocr-preview', (req, res, next) =>
  referralController.getOcrPreview(req, res, next),
);
router.get('/:id/ocr-fields', (req, res, next) =>
  referralController.getOcrFields(req, res, next),
);
router.post('/:id/ocr-confirm', canUpdateReferral, idempotencyMiddleware(), (req, res, next) =>
  referralController.confirmOcrData(req, res, next),
);

// Allocation: assign team + clinicians to the care episode created on accept
const AllocationSchema = z.object({
  episodeId: z.string().uuid(),
  orgUnitId: z.string().uuid(),
  primaryClinicianId: z.string().uuid().optional(),
  consultantId: z.string().uuid().optional(),
  juniorMedicalId: z.string().uuid().optional(),
  clinicalSpecialistId: z.string().uuid().optional(),
  keyWorkerId: z.string().uuid().optional(),
});

router.post('/:id/allocate', canUpdateReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const dto = AllocationSchema.parse(req.body);
    const referral = await db('referrals')
      .where({ id: req.params.id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first();
    if (!referral) {
      throw new AppError('Referral not found', 404, 'NOT_FOUND');
    }

    // BUG-EPISODE-MDT-SAVE-RACE (S2) 2026-05-06 — L5 cycle-1 absorb
    // (option A): wrap this referral-allocate critical section in the
    // SAME `db.transaction` + `pg_advisory_xact_lock(hashtext(? || ':' || ?))`
    // pattern as `episodeRoutes.ts POST /:id/allocate`. Both handlers
    // write to the same `(clinic_id, org_unit_id)` slice of
    // `staff_role_assignments` + `patient_team_assignments`; without
    // both participating in the same lock domain, a referral-allocate
    // running concurrently with an episode-allocate could interleave
    // with the episode-allocate's deactivate-then-insert sequence and
    // re-open the duplicate-active-role-row race the BUG was filed to
    // close. Same lock key shape, same hashtext params, so the two
    // handlers serialize against each other. Lock auto-releases on
    // commit/rollback.
    //
    // INTENTIONAL SEMANTIC ASYMMETRY (L4 cycle-3 absorb option F1(a),
    // 2026-05-06 — operator-authorized): the two handlers write the
    // SAME table but encode DIFFERENT clinical workflows.
    //
    //   - episodeRoutes.ts POST /:id/allocate is the **MDT-management
    //     surface** for an existing care episode. It is REPLACE
    //     SEMANTICS: deactivate-all-existing-additionals THEN insert
    //     the submitted composition. The episode owner is the
    //     authoritative voice on "who is on this team right now".
    //
    //   - referralRoutes.ts POST /:id/allocate (this handler) is the
    //     **referral-acceptance surface**. It is ADDITIVE SEMANTICS:
    //     INSERT the referring clinicians named in the referral letter
    //     onto whatever team the episode owner has built. We do NOT
    //     deactivate prior MDT rows here — that would let a referral
    //     coordinator silently blow away the episode owner's MDT
    //     decisions, which is clinically wrong (the referral letter
    //     adds names; the episode owner curates the team).
    //
    // Cross-handler concurrent-save outcomes are therefore EXPECTED to
    // differ by writer order:
    //   - referral-then-episode: referral inserts R; episode runs
    //     replace-semantics → final = E only (R rows are deactivated
    //     with end_date populated per L4 cycle-1 absorb).
    //   - episode-then-referral: episode inserts E (replace); referral
    //     ADDS R on top → final = E ∪ R (both compositions present).
    // Both outcomes are clinically correct given the workflow each
    // handler models. The lock guarantees these are the ONLY reachable
    // outcomes — no chaotic mid-race state (e.g. size 3 rows from
    // partial deactivation interleaving with insertion). Tested at
    // `bugEpisodeMdtSaveRace.int.test.ts` cross-handler test case.
    //
    // BUG-REFERRAL-INTAKE-CLOSE-LIE-ABOUT-SUCCESS (S2): intake close now
    // runs INSIDE this transaction and uses the canonical
    // `linked_episode_id` column. If intake close fails, allocation rolls
    // back and the caller sees a non-200 response instead of a silent
    // "allocation succeeded but intake stayed open" lie.
    await db.transaction(async (trx) => {
      // Acquire advisory xact lock keyed by (clinic_id, org_unit_id) —
      // identical key shape to episodeRoutes.ts so same-team concurrent
      // saves across BOTH handlers serialize.
      await trx.raw(
        "SELECT pg_advisory_xact_lock(hashtext(? || ':' || ?))",
        [clinicId, dto.orgUnitId],
      );

      // Update episode with team and clinician assignments
      await trx('episodes')
        .where({ id: dto.episodeId, clinic_id: clinicId })
        .update({
          team_id: dto.orgUnitId,
          primary_clinician_id: dto.primaryClinicianId ?? null,
          updated_at: new Date(),
        });

      // Assign patient to team via patient_team_assignments. Baseline (R2b)
      // owns this table as first-class — the pre-R2 `hasTable` guard has
      // been removed.
      // L4 cycle-3 absorb F3(a) 2026-05-06: tighten this SELECT with
      // clinic_id + deleted_at filters per CLAUDE.md §1.3 + §1.4
      // (app-layer first-line-of-defence; mirror episodeRoutes.ts:191).
      // Pre-fix this SELECT lacked both — a cross-tenant episodeId
      // would silently skip the patient_team_assignments INSERT branch
      // (RLS belt closed it operationally) and a soft-deleted episodeId
      // would have written to a logically-deleted episode.
      const episode = await trx('episodes')
        .where({ id: dto.episodeId, clinic_id: clinicId })
        .whereNull('deleted_at')
        .first();
      if (episode?.patient_id) {
        const existing = await trx('patient_team_assignments')
          .where({ patient_id: episode.patient_id, org_unit_id: dto.orgUnitId })
          .first();
        if (!existing) {
          // patient_team_assignments has no `clinic_id` column — tenant
          // isolation comes from FK joins to patients + org_units (both
          // RLS-gated). See docs/audits/audit-20260418.md §4.
          await trx('patient_team_assignments').insert({
            id: trx.raw('gen_random_uuid()'),
            patient_id: episode.patient_id,
            org_unit_id: dto.orgUnitId,
            primary_clinician_id: dto.primaryClinicianId ?? null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }

      // Store additional clinician roles as staff role assignments if the table exists
      const today = todayLocal();
      const roleAssignments = [
        { staffId: dto.consultantId, roleLabel: 'Consultant Psychiatrist' },
        { staffId: dto.juniorMedicalId, roleLabel: 'Psychiatry Registrar' },
        { staffId: dto.clinicalSpecialistId, roleLabel: 'Senior Clinician' },
      ].filter(r => r.staffId);

      if (roleAssignments.length > 0) {
        for (const ra of roleAssignments) {
          const role = await trx('clinical_roles').where({ clinic_id: clinicId, name: ra.roleLabel }).first();
          if (role && ra.staffId) {
            const existing = await trx('staff_role_assignments')
              .where({
                clinic_id: clinicId,
                staff_id: ra.staffId,
                org_unit_id: dto.orgUnitId,
                clinical_role_id: role.id,
              })
              .orderBy('updated_at', 'desc')
              .first('id');

            if (existing?.id) {
              await trx('staff_role_assignments')
                .where({ id: existing.id, clinic_id: clinicId })
                .update({
                  is_active: true,
                  end_date: null,
                  updated_at: new Date(),
                });
            } else {
              await trx('staff_role_assignments').insert({
                id: trx.raw('gen_random_uuid()'),
                clinic_id: clinicId,
                staff_id: ra.staffId,
                org_unit_id: dto.orgUnitId,
                clinical_role_id: role.id,
                role_type: 'additional',
                start_date: today,
                end_date: null,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
              });
            }
          }
        }
      }

      if (referral.linked_episode_id && referral.linked_episode_id !== dto.episodeId) {
        const { episodeService: epSvc } = await import('../episode/episodeService');
        await epSvc.close(
          buildAuthContext(req),
          referral.linked_episode_id,
          {
            endDate: todayLocal(),
            closureReason: 'Referral accepted — allocated to care team',
            dischargeSummary: 'Referral intake closed after allocation to active care episode.',
          },
          trx,
        );
      }
    });

    res.json({ ok: true, episodeId: dto.episodeId });
  } catch (err) { next(err); }
});

// ── Solo & Team Module Routes ────────────────────────────────────────────

import {
  RespondToOfferSchema,
  ClarificationRequestSchema,
  ClarificationResponseSchema,
} from '@signacare/shared';
import { referralRepository } from './referralRepository';
import { acceptOffer, declineOffer, broadcastToClinicans } from './strategies/teamStrategy';
// POST /:id/broadcast — Manually broadcast to all/filtered clinicians
router.post('/:id/broadcast', requireRole('admin', 'receptionist', 'clinician'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const userId = req.user!.id;
    const referral = await referralRepository.findById(clinicId, req.params.id);
    if (!referral) { res.status(404).json({ error: 'Referral not found' }); return; }

    const { ReferralBroadcastSchema } = await import('@signacare/shared');
    const broadcastDto = ReferralBroadcastSchema.parse(req.body);

    await broadcastToClinicans(clinicId, userId, req.params.id, referral, {
      urgency: referral.urgency,
      fromService: referral.from_service,
      reason: referral.reason ?? '',
      distributionMode: broadcastDto.distributionMode,
      distributionSpeciality: broadcastDto.distributionSpeciality,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /:id/offers — List clinician offers for a referral
router.get('/:id/offers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const offers = await referralRepository.listOffersForReferral(req.clinicId, req.params.id);
    const items = offers.map(o => ({
      id: o.id,
      clinicId: o.clinic_id,
      referralId: o.referral_id,
      staffId: o.staff_id,
      staffName: `${o.staff_given_name} ${o.staff_family_name}`,
      staffSpecialisation: o.staff_specialisation,
      offeredAt: o.offered_at instanceof Date ? o.offered_at.toISOString() : String(o.offered_at),
      response: o.response,
      respondedAt: o.responded_at ? (o.responded_at instanceof Date ? o.responded_at.toISOString() : String(o.responded_at)) : null,
      declineReason: o.decline_reason,
    }));
    res.json({ items });
  } catch (err) { next(err); }
});

// POST /:id/offers/:offerId/respond — Clinician accepts/declines an offer
router.post('/:id/offers/:offerId/respond', canUpdateReferral, idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const userId = req.user!.id;
    const dto = RespondToOfferSchema.parse(req.body);

    if (dto.response === 'accepted') {
      await acceptOffer(clinicId, userId, req.params.id, req.params.offerId, dto.episodeType);
    } else {
      await declineOffer(clinicId, userId, req.params.id, req.params.offerId, dto.declineReason);
    }

    res.json({ ok: true, response: dto.response });
  } catch (err) { next(err); }
});

// POST /:id/clarification — Request clarification from referrer
router.post('/:id/clarification', requireRole('clinician', 'admin', 'receptionist'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const userId = req.user!.id;
    const dto = ClarificationRequestSchema.parse(req.body);
    await referralClarificationCommands.requestClarification({
      clinicId,
      userId,
      referralId: req.params.id,
      question: dto.question,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /:id/clarification-response — Front desk adds clarification info
router.patch('/:id/clarification-response', requireRole('admin', 'receptionist'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const userId = req.user!.id;
    const dto = ClarificationResponseSchema.parse(req.body);
    await referralClarificationCommands.applyClarificationResponse({
      clinicId,
      userId,
      referralId: req.params.id,
      notes: dto.notes,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /:id/feedback-log — Feedback audit trail
router.get('/:id/feedback-log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = await referralRepository.listFeedbackLog(req.clinicId, req.params.id);
    const items = logs.map(l => ({
      id: l.id,
      clinicId: l.clinic_id,
      referralId: l.referral_id,
      feedbackType: l.feedback_type,
      recipientEmail: l.recipient_email,
      sentAt: l.sent_at instanceof Date ? l.sent_at.toISOString() : String(l.sent_at),
      messageBody: l.message_body,
      sentByStaffId: l.sent_by_staff_id,
      sentByStaffName: l.sent_by_staff_name,
      deliveryStatus: l.delivery_status,
    }));
    res.json({ items });
  } catch (err) { next(err); }
});

export default router;
