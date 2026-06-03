import { runScheduledTick } from './runScheduledTick';
import { digitalPhenotypingService } from '../../features/treatment-pathways/digitalPhenotypingService';
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
 * Digital phenotyping scheduler
 * - computes daily risk/adherence snapshots from wearable + tracking data
 * - upserts patient_digital_phenotypes per (clinic, patient, day)
 */
runScheduledTick({
  schedulerName: 'digitalPhenotyping',
  // Hourly refresh keeps research/step-care signals current.
  cronExpression: '5 * * * *',
  dbAccess: 'dbAdmin',
  tick: async (now) => digitalPhenotypingService.recomputeDailyPhenotypes(systemAuth(), now),
  successMeta: (result) => ({
    patientsComputed: result.patientsComputed,
    rowsUpserted: result.rowsUpserted,
  }),
});
