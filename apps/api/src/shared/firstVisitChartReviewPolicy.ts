import type { AuthContext } from '@signacare/shared';
import { FIRST_VISIT_CHART_REVIEW_BYPASS_FLAG } from '@signacare/shared';
import { isFeatureEnabled } from './featureFlags';

/**
 * BUG-426 policy gate:
 * enforce first-visit chart-review attestation before signing a new
 * encounter note unless the emergency bypass flag is explicitly enabled.
 */
export async function shouldEnforceFirstVisitChartReview(
  auth: AuthContext,
): Promise<boolean> {
  const bypassEnabled = await isFeatureEnabled(
    FIRST_VISIT_CHART_REVIEW_BYPASS_FLAG,
    auth.clinicId,
    { staffId: auth.staffId },
  );
  return !bypassEnabled;
}
