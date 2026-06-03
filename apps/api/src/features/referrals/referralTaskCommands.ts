import { referralRepository } from './referralRepository';

type BaseTaskTransitionInput = {
  clinicId: string;
  referralId: string;
  actorId: string;
  reason?: string;
};

export const referralTaskCommands = {
  async triageReferral(input: BaseTaskTransitionInput) {
    return referralRepository.transitionTaskStatus({
      clinicId: input.clinicId,
      referralId: input.referralId,
      from: ['requested'],
      to: 'received',
      actorId: input.actorId,
      reason: input.reason,
      patch: {
        coordinator_id: input.actorId,
        triaged_at: new Date(),
        triaged_by: input.actorId,
      },
    });
  },

  async assignReferral(
    input: BaseTaskTransitionInput & {
      assignedToStaffId: string;
    },
  ) {
    return referralRepository.transitionTaskStatus({
      clinicId: input.clinicId,
      referralId: input.referralId,
      from: ['requested', 'received', 'in_progress'],
      to: 'in_progress',
      actorId: input.actorId,
      reason: input.reason,
      patch: {
        assigned_to_staff_id: input.assignedToStaffId,
      },
    });
  },

  async acceptReferral(input: BaseTaskTransitionInput) {
    return referralRepository.transitionTaskStatus({
      clinicId: input.clinicId,
      referralId: input.referralId,
      from: ['requested', 'received', 'in_progress'],
      to: 'accepted',
      actorId: input.actorId,
      reason: input.reason,
      patch: {
        status: 'accepted',
        status_changed_at: new Date(),
      },
    });
  },

  async declineReferral(input: BaseTaskTransitionInput) {
    return referralRepository.transitionTaskStatus({
      clinicId: input.clinicId,
      referralId: input.referralId,
      from: ['requested', 'received', 'in_progress'],
      to: 'rejected',
      actorId: input.actorId,
      reason: input.reason,
      patch: {
        status: 'rejected',
        status_changed_at: new Date(),
        rejection_reason: input.reason ?? null,
      },
    });
  },
};
