// apps/api/src/features/referrals/strategies/teamStrategy.ts
import type { ReferralModuleStrategy } from './referralModuleStrategy';
import { formatCareEpisodeTitle, urgencyToTaskPriority } from './referralModuleStrategy';
import { referralRepository, type ReferralDbRow } from '../referralRepository';
import { episodeService } from '../../episode/episodeService';
import { createTaskInternal } from '../../tasks/taskService';
import { createThread } from '../../messaging/messageService';
import { db } from '../../../db/db';
import { AppError } from '../../../shared/errors';
import logger from '../../../utils/logger';
import type { AuthContext } from '@signacare/shared';

/**
 * Team Referral Management strategy.
 * Multi-clinician distribution with first-to-accept, reminders, and auto-close.
 */
export const teamStrategy: ReferralModuleStrategy = {
  async onReferralCreated(ctx) {
    const { clinicId, userId, referralId, dto } = ctx;

    const patch: Partial<ReferralDbRow> = {
      referral_mode: 'team',
      created_by_staff_id: userId,
      distribution_mode: dto.distributionMode ?? null,
      distribution_speciality: dto.distributionSpeciality ?? null,
    };

    if (dto.targetClinicianId) {
      // Named referral — forward to specific clinician
      patch.target_clinician_id = dto.targetClinicianId;
      patch.status = 'pending_clinician_review';
      patch.status_changed_at = new Date();

      await referralRepository.updateReferral(clinicId, referralId, patch);

      // Create a single offer for the target clinician
      await referralRepository.createOffersBatch([{
        clinic_id: clinicId,
        referral_id: referralId,
        staff_id: dto.targetClinicianId,
        response: 'pending',
      }]);

      // Notify the target clinician
      await notifyClinicianOfOffer(clinicId, userId, referralId, dto.targetClinicianId, ctx.referral, dto);

      await referralRepository.insertWorkflowEvent({
        clinicId,
        referralId,
        eventType: 'received',
        performedByStaffId: userId,
        notes: `Referral forwarded to specific clinician`,
      });
    } else {
      // No target — broadcast immediately
      await referralRepository.updateReferral(clinicId, referralId, patch);
      await broadcastToClinicans(clinicId, userId, referralId, ctx.referral, dto);
    }
  },

  async onDecision(ctx) {
    // In team mode, decisions come through the offer response flow (acceptOffer/declineOffer),
    // not through the standard decision endpoint. This is a fallback for backward compatibility.
    const { clinicId, userId, referralId, referral, dto } = ctx;

    if (dto.decision === 'accepted' && referral.patient_id) {
      await performAcceptance(clinicId, userId, referralId, referral, dto.episodeType);
    } else if (dto.decision === 'rejected') {
      await referralRepository.updateReferral(clinicId, referralId, {
        status: 'rejected',
        status_changed_at: new Date(),
        rejection_reason: dto.rejectionReason ?? null,
      });

      try {
        const { referralFeedbackService } = await import('../referralFeedbackService');
        await referralFeedbackService.sendRejectionFeedback(
          buildInternalAuthContext(clinicId, userId),
          referralId,
          dto.rejectionReason ?? 'No reason provided',
        );
      } catch (err) {
        logger.warn({ err, clinicId, referralId }, 'Failed to send rejection feedback');
      }
    }
  },
};

// ── Distribution ──────────────────────────────────────────────────────────

/**
 * Broadcast a referral to clinicians based on distribution mode.
 */
export async function broadcastToClinicans(
  clinicId: string,
  userId: string,
  referralId: string,
  referral: ReferralDbRow,
  dto: { distributionMode?: string; distributionSpeciality?: string; urgency: string; fromProviderName?: string; fromService: string; reason: string; slaDueDate?: string; patientId?: string },
): Promise<void> {
  // Query eligible clinicians
  const staffQuery = db('staff')
    .where({ clinic_id: clinicId, is_active: true })
    .where('role', 'clinician')
    .whereNull('deleted_at')
    .select('id', 'given_name', 'family_name', 'specialisation');

  if (dto.distributionMode === 'specialty' && dto.distributionSpeciality) {
    staffQuery.where('specialisation', dto.distributionSpeciality);
  }

  const clinicians = await staffQuery;

  if (clinicians.length === 0) {
    logger.warn({ clinicId, referralId }, 'No eligible clinicians found for broadcast');
    return;
  }

  // Create offer rows
  const offerRows = clinicians.map((s: { id: string }) => ({
    clinic_id: clinicId,
    referral_id: referralId,
    staff_id: s.id,
    response: 'pending',
  }));

  await referralRepository.createOffersBatch(offerRows);

  // Update referral with broadcast info
  const now = new Date();
  const autoCloseAt = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days
  await referralRepository.updateReferral(clinicId, referralId, {
    status: 'pending_broadcast',
    status_changed_at: now,
    broadcast_at: now,
    auto_close_at: autoCloseAt,
  });

  // Notify each clinician (task + message + SSE)
  for (const clinician of clinicians) {
    try {
      await notifyClinicianOfOffer(clinicId, userId, referralId, clinician.id, referral, dto);
    } catch (err) {
      logger.warn({ err, clinicId, referralId, staffId: clinician.id }, 'Failed to notify clinician');
    }
  }

  await referralRepository.insertWorkflowEvent({
    clinicId,
    referralId,
    eventType: 'broadcast',
    performedByStaffId: userId,
    notes: `Referral broadcast to ${clinicians.length} clinician(s)`,
  });
}

/**
 * Redistribute a referral after a targeted clinician declines.
 */
export async function redistributeReferral(
  clinicId: string,
  userId: string,
  referralId: string,
  referral: ReferralDbRow,
): Promise<void> {
  // Get clinicians who haven't been offered yet
  const existingOffers = await referralRepository.listOffersForReferral(clinicId, referralId);
  const offeredStaffIds = new Set(existingOffers.map(o => o.staff_id));

  const allClinicians = await db('staff')
    .where({ clinic_id: clinicId, is_active: true, role: 'clinician' })
    .whereNull('deleted_at')
    .select('id', 'given_name', 'family_name', 'specialisation');

  const newClinicians = allClinicians.filter((s: { id: string }) => !offeredStaffIds.has(s.id));

  if (newClinicians.length === 0) {
    logger.warn({ clinicId, referralId }, 'No new clinicians available for redistribution');
    return;
  }

  const offerRows = newClinicians.map((s: { id: string }) => ({
    clinic_id: clinicId,
    referral_id: referralId,
    staff_id: s.id,
    response: 'pending',
  }));

  await referralRepository.createOffersBatch(offerRows);

  const now = new Date();
  const autoCloseAt = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  await referralRepository.updateReferral(clinicId, referralId, {
    status: 'pending_broadcast',
    status_changed_at: now,
    broadcast_at: now,
    auto_close_at: autoCloseAt,
    reminder_sent_at: null,
    final_reminder_sent_at: null,
  });

  for (const clinician of newClinicians) {
    try {
      await notifyClinicianOfOffer(clinicId, userId, referralId, clinician.id, referral, {
        urgency: referral.urgency,
        fromService: referral.from_service,
        reason: referral.reason ?? '',
      });
    } catch (err) {
      logger.warn({ err, clinicId, referralId, staffId: clinician.id }, 'Failed to notify clinician during redistribution');
    }
  }

  await referralRepository.insertWorkflowEvent({
    clinicId,
    referralId,
    eventType: 'broadcast',
    performedByStaffId: userId,
    notes: `Referral redistributed to ${newClinicians.length} additional clinician(s)`,
  });
}

// ── Race-safe offer acceptance ────────────────────────────────────────────

/**
 * Accept a referral offer (team mode). Uses FOR UPDATE locking to prevent
 * race conditions when multiple clinicians accept simultaneously.
 */
export async function acceptOffer(
  clinicId: string,
  userId: string,
  referralId: string,
  offerId: string,
  episodeType?: string,
): Promise<void> {
  await db.transaction(async (trx) => {
    // 1. Lock the referral row
    const referral = await referralRepository.findReferralForUpdate(clinicId, referralId, trx);
    if (!referral) throw new AppError('Referral not found', 404, 'NOT_FOUND');

    // 2. Check if already decided
    const terminalStates = new Set(['accepted', 'rejected', 'closed_no_response', 'appointment_booked']);
    if (terminalStates.has(referral.status)) {
      throw new AppError(
        'This referral has already been decided. Another clinician may have accepted it.',
        409,
        'REFERRAL_ALREADY_DECIDED',
      );
    }

    // 3. Lock and validate the offer
    const offer = await referralRepository.findOfferForUpdate(offerId, userId, trx);
    if (!offer) throw new AppError('Offer not found', 404, 'NOT_FOUND');
    if (offer.response !== 'pending') {
      throw new AppError('This offer is no longer available', 409, 'INVALID_STATE_TRANSITION');
    }

    // 4. Accept the offer
    await referralRepository.updateOffer(offerId, {
      response: 'accepted',
      responded_at: new Date(),
    }, trx);

    // 5. Expire all other pending offers
    await referralRepository.expirePendingOffers(referralId, offerId, trx);

    // 6. Perform acceptance (episode + appointment + feedback)
    const staffRow = await trx('staff')
      .where({ id: userId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .select('family_name')
      .first();
    const familyName = staffRow?.family_name ?? 'Unknown';

    const today = new Date();
    const episodeTitle = formatCareEpisodeTitle(familyName, today);
    const todayStr = today.toISOString().split('T')[0];

    let episodeId = referral.linked_episode_id;

    if (referral.patient_id) {
      const careEpisode = await episodeService.create(buildInternalAuthContext(clinicId, userId), {
        patientId: referral.patient_id,
        title: episodeTitle,
        episodeType: episodeType ?? 'community',
        startDate: todayStr,
      });
      episodeId = careEpisode.id;

      if (referral.linked_episode_id && referral.linked_episode_id !== careEpisode.id) {
        try {
          await episodeService.close(
            buildInternalAuthContext(clinicId, userId),
            referral.linked_episode_id,
            {
              endDate: todayStr,
              closureReason: 'Referral accepted — moved to ongoing care episode',
              dischargeSummary: `Referral accepted and ongoing care episode ${careEpisode.id} opened; intake episode closed automatically.`,
            },
            trx,
          );
        } catch (err) {
          logger.warn({ err, clinicId, referralId }, 'Failed to close referral intake episode on team offer acceptance');
        }
      }
    }

    // 7. Update referral
    await trx('referrals')
      .where({ id: referralId, clinic_id: clinicId })
      .update({
        // Phase 0.7.5 c24 C3 (SD13) — column renames. `accepted_at` dropped
        // (no DB column); status='accepted' + status_changed_at carry
        // the semantics. `episode_id` → `linked_episode_id`,
        // `assigned_to_id` → `assigned_to_staff_id`.
        status: 'accepted',
        accepted_by_staff_id: userId,
        assigned_to_staff_id: userId,
        linked_episode_id: episodeId,
        status_changed_at: today,
        updated_at: today,
      });

    // 8. Log workflow events
    await trx('referral_workflow_events').insert({
      clinic_id: clinicId,
      referral_id: referralId,
      event_type: 'offer_accepted',
      performed_by_staff_id: userId,
      notes: `Accepted by ${familyName}. Episode: "${episodeTitle}"`,
      outcome: 'accepted',
      event_at: today,
    });
  });

  // Post-transaction: appointment + feedback (non-transactional, non-blocking)
  const referral = await referralRepository.findById(clinicId, referralId);
  if (!referral) return;

  // Auto-create appointment
  if (referral.patient_id && referral.linked_episode_id) {
    try {
      const { appointmentService } = await import('../../appointments/appointmentService');
      const today = new Date();
      const appointmentDate = getNextBusinessDay(today, 3);
      appointmentDate.setHours(9, 0, 0, 0);
      const endTime = new Date(appointmentDate.getTime() + 60 * 60 * 1000);

      if (appointmentService && typeof appointmentService.createInternal === 'function') {
        await appointmentService.createInternal(clinicId, userId, {
          patientId: referral.patient_id,
          clinicianId: userId,
          episodeId: referral.linked_episode_id,
          startTime: appointmentDate.toISOString(),
          endTime: endTime.toISOString(),
          type: 'initial',
          notes: `Initial appointment from referral ${referral.referral_number}`,
        });

        await referralRepository.updateReferral(clinicId, referralId, {
          status: 'appointment_booked',
          status_changed_at: new Date(),
        });

        await referralRepository.insertWorkflowEvent({
          clinicId,
          referralId,
          eventType: 'appointment_booked',
          performedByStaffId: userId,
          notes: 'Initial appointment auto-created',
        });
      }
    } catch (err) {
      logger.warn({ err, clinicId, referralId }, 'Failed to auto-create appointment');
    }
  }

  // Send referrer feedback
  try {
    const { referralFeedbackService } = await import('../referralFeedbackService');
    await referralFeedbackService.sendAcceptanceFeedback(
      buildInternalAuthContext(clinicId, userId),
      referralId,
    );
  } catch (err) {
    logger.warn({ err, clinicId, referralId }, 'Failed to send acceptance feedback');
  }
}

/**
 * Decline a referral offer. If this was the targeted clinician,
 * redistributes to all clinicians.
 */
export async function declineOffer(
  clinicId: string,
  userId: string,
  referralId: string,
  offerId: string,
  declineReason?: string,
): Promise<void> {
  const referral = await referralRepository.findById(clinicId, referralId);
  if (!referral) throw new AppError('Referral not found', 404, 'NOT_FOUND');

  await referralRepository.updateOffer(offerId, {
    response: 'declined',
    responded_at: new Date(),
    decline_reason: declineReason ?? null,
  });

  await referralRepository.insertWorkflowEvent({
    clinicId,
    referralId,
    eventType: 'offer_declined',
    performedByStaffId: userId,
    notes: declineReason ?? 'Declined without reason',
  });

  // If this was the targeted clinician (pending_clinician_review), redistribute
  if (referral.status === 'pending_clinician_review') {
    await redistributeReferral(clinicId, userId, referralId, referral);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function notifyClinicianOfOffer(
  clinicId: string,
  senderId: string,
  referralId: string,
  staffId: string,
  referral: ReferralDbRow,
  dto: { urgency: string; fromProviderName?: string; fromService?: string; reason: string; slaDueDate?: string; patientId?: string },
): Promise<void> {
  // 1. Create task
  try {
    await createTaskInternal(clinicId, senderId, {
      assignedToId: staffId,
      patientId: dto.patientId ?? referral.patient_id ?? undefined,
      title: `Review referral ${referral.referral_number}`,
      description: `Referral from ${dto.fromProviderName ?? dto.fromService ?? referral.from_service}. Reason: ${dto.reason ?? referral.reason ?? 'N/A'}`,
      priority: urgencyToTaskPriority(dto.urgency ?? referral.urgency),
      dueDate: dto.slaDueDate,
    });
  } catch (err) {
    logger.warn({ err, clinicId, referralId, staffId }, 'Failed to create referral review task');
  }

  // 2. Create internal message
  try {
    const threadPatientName = referral.patient_id
      ? await getPatientName(clinicId, referral.patient_id)
      : 'Unknown patient';

    await createThread(
      buildInternalAuthContext(clinicId, senderId),
      {
        subject: `Referral ${referral.referral_number} for ${threadPatientName} — awaiting your review`,
        patientId: referral.patient_id ?? undefined,
        participantIds: [staffId],
        recipientIds: [],
      },
    );

    // The thread creation sends the initial message context
  } catch (err) {
    logger.warn({ err, clinicId, referralId, staffId }, 'Failed to create referral message thread');
  }

  // 3. Durable notification + live SSE push through the Phase 10A
  //    service. One call writes the bell row AND publishes the live
  //    event — connected clinicians react instantly, disconnected
  //    ones see the row on their next login.
  try {
    const { emitClinicalSignal } = await import('../../events/clinicalSignalEmitter');
    const urgency = (dto.urgency ?? referral.urgency) as string;
    const severity: 'info' | 'warning' | 'critical' =
      urgency === 'emergency' ? 'critical'
      : urgency === 'urgent' ? 'warning'
      : 'info';
    await emitClinicalSignal({
      source: 'referrals',
      signalKey: 'referral-offer',
      clinicId,
      userId: staffId,
      severity,
      category: 'referral',
      title: `New referral offered — ${referral.referral_number}`,
      body: `Awaiting your review`,
      actionUrl: `/referrals/${referralId}`,
      payload: {
        referral_id: referralId,
        referral_number: referral.referral_number,
        urgency,
      },
      dedupeKey: `referral-offer:${referralId}:${staffId}`,
      sseEventType: 'referral-offer',
    });
  } catch (err) {
    logger.warn({ err, staffId }, 'Failed to emit referral-offer notification');
  }
}

async function getPatientName(clinicId: string, patientId: string): Promise<string> {
  const patient = await db('patients')
    .where({ id: patientId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .select('given_name', 'family_name')
    .first();
  if (!patient) return 'Unknown';
  return `${patient.given_name ?? ''} ${patient.family_name ?? ''}`.trim() || 'Unknown';
}

function getNextBusinessDay(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

/**
 * Perform the acceptance workflow (used by both offer acceptance and direct decision).
 */
async function performAcceptance(
  clinicId: string,
  userId: string,
  referralId: string,
  referral: ReferralDbRow,
  episodeType?: string,
): Promise<void> {
  const staffRow = await db('staff')
    .where({ id: userId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .select('family_name')
    .first();
  const familyName = staffRow?.family_name ?? 'Unknown';

  const today = new Date();
  const episodeTitle = formatCareEpisodeTitle(familyName, today);
  const todayStr = today.toISOString().split('T')[0];

  let episodeId = referral.linked_episode_id;

  if (referral.patient_id) {
    const careEpisode = await episodeService.create(buildInternalAuthContext(clinicId, userId), {
      patientId: referral.patient_id,
      title: episodeTitle,
      episodeType: episodeType ?? 'community',
      startDate: todayStr,
    });
    episodeId = careEpisode.id;

    if (referral.linked_episode_id && referral.linked_episode_id !== careEpisode.id) {
      try {
        await episodeService.close(
          buildInternalAuthContext(clinicId, userId),
          referral.linked_episode_id,
          {
            endDate: todayStr,
            closureReason: 'Referral accepted — moved to ongoing care episode',
            dischargeSummary: `Referral accepted and ongoing care episode ${careEpisode.id} opened; intake episode closed automatically.`,
          },
        );
      } catch (err) {
        logger.warn({ err, clinicId, referralId }, 'Failed to close referral intake episode on team acceptance fallback');
      }
    }
  }

  // Phase 0.7.5 c24 C3 (SD13) — column renames. `accepted_at` dropped
  // (no DB column); status='accepted' + status_changed_at carry semantics.
  await referralRepository.updateReferral(clinicId, referralId, {
    status: 'accepted',
    accepted_by_staff_id: userId,
    assigned_to_staff_id: userId,
    linked_episode_id: episodeId,
    status_changed_at: today,
  });

  await referralRepository.insertWorkflowEvent({
    clinicId,
    referralId,
    eventType: 'decision',
    performedByStaffId: userId,
    notes: `Accepted. Episode: "${episodeTitle}"`,
    outcome: 'accepted',
  });

  // Send referrer feedback
  try {
    const { referralFeedbackService } = await import('../referralFeedbackService');
    await referralFeedbackService.sendAcceptanceFeedback(
      buildInternalAuthContext(clinicId, userId),
      referralId,
    );
  } catch (err) {
    logger.warn({ err, clinicId, referralId }, 'Failed to send acceptance feedback');
  }
}

function buildInternalAuthContext(clinicId: string, staffId: string): AuthContext {
  return {
    clinicId,
    staffId,
    role: 'clinician',
    permissions: [],
  };
}
