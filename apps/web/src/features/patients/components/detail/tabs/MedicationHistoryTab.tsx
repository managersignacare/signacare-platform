// apps/web/src/features/patients/components/detail/tabs/MedicationHistoryTab.tsx
//
// BUG-524-E — NEW top-level patient-detail tab per the hybrid 2-tab split
// plan (user-locked design 2026-04-29: Active Medications + Medication
// History). Read-only past-medication context with internal sub-tabs:
// History (ceased medications + AI summary) / Prescriptions (grouped by
// med with period filter, no represcribe button per L4 absorb-1) /
// Reconciliation (re-exported from internal-medicine). NO Allergy +
// Interaction headers (read-only past context; allergies don't apply
// retrospectively). NO AllergyAckGate — and crucially, NO write
// affordances either, so there is no clinical-safety regression class
// where a clinician could deeplink here and prescribe without allergy
// acknowledgement (per L4 cycle-1 BLOCK + absorb-1 fix). Represcribe-
// from-history → switch to Active Medications tab where AllergyAckGate
// enforces.

import { Alert, Box, Tab, Tabs, CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { tryAsync, isErr } from '@signacare/shared';
import { apiClient } from '../../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../../shared/store/authStore';
import { patientMedicationsKeys } from '../../../queryKeys';
import { MedHistoryPanel } from '../../../../medications/components/MedHistoryPanel';
import { MedicationTimelinePanel } from '../../../../medications/components/MedicationTimelinePanel';
import { PrescriptionHistoryPanel } from '../../../../medications/components/PrescriptionHistoryPanel';
import { MedReconciliationTab as ReconciliationPanel } from '../../../../internal-medicine/tabs/MedReconciliationTab';
import type { MedicationRow } from '../../../../medications/types';

type HistorySubTab = 'history' | 'timeline' | 'prescriptions' | 'reconcile';

interface MedicationHistoryTabProps { patientId: string }
type MedicationsPayload = MedicationRow[] | { data?: MedicationRow[] };

export const MedicationHistoryTab: React.FC<MedicationHistoryTabProps> = ({ patientId }) => {
  const clinicId = useAuthStore(s => s.user?.clinicId ?? '');
  const [subTab, setSubTab] = useState<HistorySubTab>('history');

  // Reuses the same patientMedicationsKeys.byPatient query as ActiveMedicationsTab
  // — React-Query dedupes the request automatically (single network hit
  // when both tabs are mounted; cache shared via the key).
  // BUG-524-E absorb-1 (L3+L5 cycle 1 BLOCK on Standard 2): per BUG-530
  // SSoT (CLAUDE.md §16.2), use tryAsync to surface fetch failure
  // explicitly via isError state instead of silently collapsing into
  // an empty list (the BUG-441/445/548 lie-about-success class).
  const { data, isLoading, isError } = useQuery({
    queryKey: patientMedicationsKeys.byPatient(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<MedicationsPayload>(`medications/patients/${patientId}/medications`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : Array.isArray(r.value?.data) ? r.value.data : [];
    },
    enabled: !!clinicId && !!patientId,
  });

  const allMeds: MedicationRow[] = Array.isArray(data) ? data : [];
  const ceased = allMeds.filter(m => m.status === 'ceased' || m.status === 'suspended' || m.status === 'on_hold');

  return (
    <Box>
      <Tabs aria-label="Navigation tabs" value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}>
        <Tab label={`Medication History (${ceased.length})`} value="history" />
        <Tab label={`Medication Timeline (${allMeds.length})`} value="timeline" />
        <Tab label={`Prescription History (${allMeds.length})`} value="prescriptions" />
        <Tab label="Reconciliation" value="reconcile" />
      </Tabs>

      {isError && <Alert role="alert" severity="error" sx={{ mb: 2 }}>Failed to load medication history. Switch to the Medications tab to retry, or refresh the page.</Alert>}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress role="progressbar" aria-label="Loading" size={28} sx={{ color: '#b8621a' }} />
        </Box>
      ) : (
        <>
          {subTab === 'history' && <MedHistoryPanel rows={ceased} allMeds={allMeds} patientId={patientId} />}
          {subTab === 'timeline' && <MedicationTimelinePanel allMeds={allMeds} />}
          {subTab === 'prescriptions' && <PrescriptionHistoryPanel allMeds={allMeds} patientId={patientId} />}
          {subTab === 'reconcile' && <ReconciliationPanel patientId={patientId} />}
        </>
      )}
    </Box>
  );
};
