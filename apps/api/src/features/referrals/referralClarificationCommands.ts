import { AppError } from '../../shared/errors';
import auditLogService from '../../utils/audit';
import { referralFeedbackService } from './referralFeedbackService';
import { referralRepository } from './referralRepository';
import type { AuthContext } from '@signacare/shared';

export const referralClarificationCommands = {
  async requestClarification(params: {
    clinicId: string;
    userId: string;
    referralId: string;
    question: string;
  }): Promise<void> {
    const { clinicId, userId, referralId, question } = params;
    const existing = await referralRepository.findById(clinicId, referralId);
    if (!existing) {
      throw new AppError('Referral not found', 404, 'NOT_FOUND');
    }

    await referralFeedbackService.sendClarificationRequest(
      buildInternalAuthContext(clinicId, userId),
      referralId,
      question,
    );

    const updated = await referralRepository.updateReferral(clinicId, referralId, {
      status: 'info_requested',
      status_changed_at: new Date(),
    });
    if (!updated) {
      throw new AppError('Referral not found', 404, 'NOT_FOUND');
    }

    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId,
      eventType: 'clarification_requested',
      performedByStaffId: userId,
      notes: question,
    });

    await auditLogService.logUpdate({
      clinicId,
      userId,
      tableName: 'referrals',
      recordId: referralId,
      oldData: existing,
      newData: updated,
    });
  },

  async applyClarificationResponse(params: {
    clinicId: string;
    userId: string;
    referralId: string;
    notes: string;
  }): Promise<void> {
    const { clinicId, userId, referralId, notes } = params;
    const existing = await referralRepository.findById(clinicId, referralId);
    if (!existing) {
      throw new AppError('Referral not found', 404, 'NOT_FOUND');
    }

    const updated = await referralRepository.updateReferral(clinicId, referralId, {
      clarification_notes: notes,
      status: 'under_review',
      status_changed_at: new Date(),
    });
    if (!updated) {
      throw new AppError('Referral not found', 404, 'NOT_FOUND');
    }

    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId,
      eventType: 'clarification_received',
      performedByStaffId: userId,
      notes: 'Clarification received and added to referral',
    });

    await auditLogService.logUpdate({
      clinicId,
      userId,
      tableName: 'referrals',
      recordId: referralId,
      oldData: existing,
      newData: updated,
    });
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
