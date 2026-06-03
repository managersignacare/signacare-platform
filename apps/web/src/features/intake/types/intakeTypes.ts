import { z } from 'zod';
import {
  CreateReferralSchema,
  ReferralDecisionSchema,
  ReferralResponseSchema,
} from '@signacare/shared';

export type Referral = z.infer<typeof ReferralResponseSchema>;
export type CreateReferral = z.infer<typeof CreateReferralSchema>;
export type ReferralDecision = z.infer<typeof ReferralDecisionSchema>;
export interface ReferralWorkflowEvent {
  id: string;
  eventType: string;
  createdAt: string;
  createdByStaffName?: string;
  notes?: string;
}

export type ReferralFilters = {
  status?: string;
  statusIn?: string[];
  urgency?: string;
  patientId?: string;
  assignedToStaffId?: string;
  team?: string;
  period?: string;
};

export type SlaBadgeMeta = {
  label: string;
  color: 'success' | 'warning' | 'error';
  daysRemaining: number;
};

const urgencyDays: Record<string, number> = {
  emergency: 1,
  urgent: 2,
  routine: 5,
};

export const getReferralSlaMeta = (referral: Referral): SlaBadgeMeta => {
  const dueDate = referral.slaDueDate
    ? new Date(referral.slaDueDate)
    : new Date(
        new Date(referral.receivedAt ?? referral.referralDate).getTime() +
          (urgencyDays[referral.urgency] ?? 5) * 24 * 60 * 60 * 1000,
      );

  const diffMs = dueDate.getTime() - Date.now();
  const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

  if (daysRemaining < 0) {
    return {
      label: `Breached by ${Math.abs(daysRemaining)}d`,
      color: 'error',
      daysRemaining,
    };
  }

  if (daysRemaining <= 1) {
    return {
      label: `${daysRemaining}d remaining`,
      color: 'warning',
      daysRemaining,
    };
  }

  return {
    label: `${daysRemaining}d remaining`,
    color: 'success',
    daysRemaining,
  };
};
