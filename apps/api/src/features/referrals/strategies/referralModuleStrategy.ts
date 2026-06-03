// apps/api/src/features/referrals/strategies/referralModuleStrategy.ts
import type { CreateReferralDTO, ReferralDecisionDTO } from '@signacare/shared';
import type { ReferralDbRow } from '../referralRepository';

/**
 * Strategy interface for module-specific referral workflows.
 * Implementations are selected based on the clinic's active referral module
 * (referral-solo or referral-team).
 */
export interface ReferralModuleStrategy {
  /**
   * Called after a referral is created. Sets the referral_mode and performs
   * module-specific setup (e.g., assigning to practitioner or distributing to clinicians).
   */
  onReferralCreated(ctx: {
    clinicId: string;
    userId: string;
    referralId: string;
    referral: ReferralDbRow;
    dto: CreateReferralDTO;
  }): Promise<void>;

  /**
   * Called when a referral decision is made. Handles module-specific logic
   * such as episode naming, appointment creation, and referrer feedback.
   */
  onDecision(ctx: {
    clinicId: string;
    userId: string;
    referralId: string;
    referral: ReferralDbRow;
    dto: ReferralDecisionDTO;
  }): Promise<void>;
}

/**
 * Determines which referral module is active for a clinic.
 * Returns null if neither module is enabled (standard workflow).
 */
export async function getActiveReferralModule(clinicId: string): Promise<'solo' | 'team' | null> {
  const { dbAdmin } = await import('../../../db/db');
  const rows = await dbAdmin('clinic_modules')
    .where({ clinic_id: clinicId, is_enabled: true })
    .whereIn('module_key', ['referral-solo', 'referral-team']);

  if (rows.find((r: { module_key: string }) => r.module_key === 'referral-solo')) return 'solo';
  if (rows.find((r: { module_key: string }) => r.module_key === 'referral-team')) return 'team';
  return null;
}

/**
 * Maps referral urgency to task priority.
 */
export function urgencyToTaskPriority(urgency: string): 'low' | 'medium' | 'high' | 'urgent' {
  switch (urgency) {
    case 'emergency': return 'urgent';
    case 'urgent': return 'high';
    case 'soon': return 'medium';
    default: return 'low';
  }
}

/**
 * Formats the care episode title: "care episode {LastName}-{YYYYMMDD}"
 */
export function formatCareEpisodeTitle(familyName: string, acceptanceDate: Date): string {
  const yyyy = acceptanceDate.getFullYear();
  const mm = String(acceptanceDate.getMonth() + 1).padStart(2, '0');
  const dd = String(acceptanceDate.getDate()).padStart(2, '0');
  return `care episode ${familyName}-${yyyy}${mm}${dd}`;
}
