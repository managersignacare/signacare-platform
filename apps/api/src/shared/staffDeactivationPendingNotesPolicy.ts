import type { AuthContext } from '@signacare/shared';
import { STAFF_DEACTIVATION_PENDING_NOTES_BYPASS_FLAG } from '@signacare/shared';
import { isFeatureEnabled } from './featureFlags';

/**
 * BUG-428 policy gate:
 * block staff deactivation when unsigned draft clinical notes remain,
 * unless the emergency bypass flag is explicitly enabled.
 */
export async function shouldEnforceStaffDeactivationPendingNotes(
  auth: AuthContext,
): Promise<boolean> {
  const bypassEnabled = await isFeatureEnabled(
    STAFF_DEACTIVATION_PENDING_NOTES_BYPASS_FLAG,
    auth.clinicId,
    { staffId: auth.staffId },
  );
  return !bypassEnabled;
}
