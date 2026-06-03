import type { AuthContext } from '@signacare/shared';
import { RECENT_RISK_ASSESSMENT_BYPASS_FLAG } from '@signacare/shared';
import { isFeatureEnabled } from './featureFlags';

/**
 * BUG-427 policy gate:
 * enforce a recent risk assessment before signing the first
 * psychiatric encounter note for new patients, unless the emergency
 * bypass flag is explicitly enabled.
 */
export async function shouldEnforceRecentRiskAssessment(
  auth: AuthContext,
): Promise<boolean> {
  const bypassEnabled = await isFeatureEnabled(
    RECENT_RISK_ASSESSMENT_BYPASS_FLAG,
    auth.clinicId,
    { staffId: auth.staffId },
  );
  return !bypassEnabled;
}
