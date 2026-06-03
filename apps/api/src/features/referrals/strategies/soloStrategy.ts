// apps/api/src/features/referrals/strategies/soloStrategy.ts
import type { ReferralModuleStrategy } from './referralModuleStrategy';
import { formatCareEpisodeTitle, urgencyToTaskPriority } from './referralModuleStrategy';
import { referralRepository } from '../referralRepository';
import { episodeService } from '../../episode/episodeService';
import { createTaskInternal } from '../../tasks/taskService';
import logger from '../../../utils/logger';
import type { AuthContext } from '@signacare/shared';

/**
 * Solo Referral Management strategy.
 * Single practitioner accept/reject workflow.
 * Referral is assigned to the solo practitioner on creation.
 */
export const soloStrategy: ReferralModuleStrategy = {
  async onReferralCreated(ctx) {
    const { clinicId, userId, referralId, dto } = ctx;

    // Set mode and assign to the specified practitioner (or the user who created it)
    const assignedTo = dto.assignedToStaffId ?? userId;
    await referralRepository.updateReferral(clinicId, referralId, {
      referral_mode: 'solo',
      assigned_to_staff_id: assignedTo,
      created_by_staff_id: userId,
    });

    // Create a task for the practitioner to review
    try {
      await createTaskInternal(clinicId, userId, {
        assignedToId: assignedTo,
        patientId: dto.patientId,
        title: `Review referral ${ctx.referral.referral_number}`,
        description: `New referral from ${dto.fromProviderName ?? dto.fromService}. Reason: ${dto.reason}`,
        priority: urgencyToTaskPriority(dto.urgency),
        dueDate: dto.slaDueDate,
      });
    } catch (err) {
      logger.warn({ err, clinicId, referralId }, 'Failed to create review task for solo referral');
    }

    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId,
      eventType: 'received',
      performedByStaffId: userId,
      notes: 'Referral assigned to solo practitioner',
    });
  },

  async onDecision(ctx) {
    const { clinicId, userId, referralId, referral, dto } = ctx;

    if (dto.decision === 'accepted' && referral.patient_id) {
      // Look up accepting clinician's family name
      const { db: dbConn } = await import('../../../db/db');
      const staffRow = await dbConn('staff')
        .where({ id: userId, clinic_id: clinicId })
        .select('family_name')
        .first();
      const familyName = staffRow?.family_name ?? 'Unknown';

      // Create care episode with naming convention: "care episode {LastName}-{YYYYMMDD}"
      const today = new Date();
      const episodeTitle = formatCareEpisodeTitle(familyName, today);
      const todayStr = today.toISOString().split('T')[0];

      try {
        const careEpisode = await episodeService.create(buildInternalAuthContext(clinicId, userId), {
          patientId: referral.patient_id,
          title: episodeTitle,
          episodeType: dto.episodeType ?? 'community',
          startDate: todayStr,
        });

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
            logger.warn({ err, clinicId, referralId }, 'Failed to close referral intake episode on solo acceptance');
          }
        }

        // Link episode to referral. Phase 0.7.5 c24 C3 — episode_id → linked_episode_id.
        // `accepted_at` column doesn't exist; status='accepted' + status_changed_at
        // carry the semantics.
        await referralRepository.updateReferral(clinicId, referralId, {
          linked_episode_id: careEpisode.id,
          accepted_by_staff_id: userId,
          status: 'accepted',
          status_changed_at: today,
        });

        await referralRepository.insertWorkflowEvent({
          clinicId,
          referralId,
          eventType: 'episode_opened',
          performedByStaffId: userId,
          notes: `Care episode "${episodeTitle}" created`,
          outcome: 'accepted',
        });

        // Auto-create initial appointment (non-blocking)
        try {
          const { appointmentService } = await import('../../appointments/appointmentService');

          // Schedule 3 business days out at 9:00 AM
          const appointmentDate = getNextBusinessDay(today, 3);
          appointmentDate.setHours(9, 0, 0, 0);
          const endTime = new Date(appointmentDate.getTime() + 60 * 60 * 1000); // 1 hour

          if (appointmentService && typeof appointmentService.createInternal === 'function') {
            await appointmentService.createInternal(clinicId, userId, {
              patientId: referral.patient_id,
              clinicianId: userId,
              episodeId: careEpisode.id,
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
          logger.warn({ err, clinicId, referralId }, 'Failed to auto-create appointment — manual scheduling required');
        }

        // Send feedback to referrer (non-blocking but awaited)
        try {
          const { referralFeedbackService } = await import('../referralFeedbackService');
          await referralFeedbackService.sendAcceptanceFeedback(
            buildInternalAuthContext(clinicId, userId),
            referralId,
          );
        } catch (err) {
          logger.warn({ err, clinicId, referralId }, 'Failed to send acceptance feedback to referrer');
        }
      } catch (err) {
        logger.error({ err, clinicId, referralId }, 'Failed to create care episode on solo acceptance');
        throw err;
      }
    } else if (dto.decision === 'rejected') {
      await referralRepository.updateReferral(clinicId, referralId, {
        status: 'rejected',
        status_changed_at: new Date(),
        rejection_reason: dto.rejectionReason ?? null,
      });

      // Send rejection feedback to referrer
      try {
        const { referralFeedbackService } = await import('../referralFeedbackService');
        await referralFeedbackService.sendRejectionFeedback(
          buildInternalAuthContext(clinicId, userId),
          referralId,
          dto.rejectionReason ?? 'No reason provided',
        );
      } catch (err) {
        logger.warn({ err, clinicId, referralId }, 'Failed to send rejection feedback to referrer');
      }
    }
  },
};

function buildInternalAuthContext(clinicId: string, staffId: string): AuthContext {
  return {
    clinicId,
    staffId,
    role: 'clinician',
    permissions: [],
  };
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
