import { runScheduledTick } from './runScheduledTick';
import { stepCareService } from '../../features/treatment-pathways/stepCareService';
import type { AuthContext } from '@signacare/shared';

function systemAuth(): AuthContext {
  return {
    clinicId: 'system',
    staffId: 'system',
    role: 'superadmin',
    permissions: [],
  };
}

/**
 * Step-care automation scheduler
 * - evaluates active clinic_step_care_rules
 * - auto-assigns pathway intervention packs when thresholds match
 * - creates escalation tasks/signals when configured
 */
runScheduledTick({
  schedulerName: 'stepCareAutomation',
  // Every 20 minutes keeps interventions responsive without overloading.
  cronExpression: '*/20 * * * *',
  dbAccess: 'dbAdmin',
  tick: async (now) => stepCareService.runAutomationTick(systemAuth(), now),
  successMeta: (result) => ({
    rulesScanned: result.rulesScanned,
    patientsMatched: result.patientsMatched,
    assignmentsCreated: result.assignmentsCreated,
    escalationsCreated: result.escalationsCreated,
  }),
  zeroRow: {
    isZero: (result) =>
      result.rulesScanned > 0
      && result.patientsMatched === 0
      && result.assignmentsCreated === 0
      && result.escalationsCreated === 0,
    kind: 'STEPCARE_AUTOMATION_NO_MATCH',
    message: 'Step-care automation scanned active rules but found no matches',
  },
});
