// apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx
//
// "Active Medications" tab (the user-facing label per BUG-524 hybrid
// 2-tab design — module id `medications` kept stable for deeplink
// compatibility). Composer for the active-medication prescribing
// surface: AllergyAckGate-wrapped + AllergyPanel + InteractionPanel
// headers + 6 sub-section panels (Current / Insulin / LAI / MAR /
// Clozapine / Side Effects) imported from feature-folder modules.
// Past-medication context lives at the sibling MedicationHistoryTab
// per the locked design (Active vs History split).

import { Alert, Box, CircularProgress, Tab, Tabs } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { tryAsync, isErr } from '@signacare/shared';
import { apiClient } from '../../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../../shared/store/authStore';
import { patientMedicationsKeys } from '../../../queryKeys';
import { InsulinRegimenTab as InsulinRegimenPanel } from '../../../../endocrinology/tabs/InsulinRegimenTab';
import { useModuleVisibility } from '../../../../../shared/hooks/useModuleVisibility';
import { AllergyAckGate } from '../../../../risk-allergies/components/AllergyAckGate';
import { AllergyPanel } from '../../../../risk-allergies/components/AllergyPanel';
import { InteractionPanel } from '../../../../medications/components/InteractionPanel';
import { ClozapinePanel } from '../../../../medications/components/ClozapinePanel';
import { LaiPanel } from '../../../../medications/components/LaiPanel';
import { MarChartPanel } from '../../../../medications/components/MarChartPanel';
import { CurrentMedsPanel } from '../../../../medications/components/CurrentMedsPanel';
import { SideEffectsPanel } from '../../../../medications/components/SideEffectsPanel';
import { usePrescriberStatus } from '../../../../medications/hooks/usePrescriber';
import type { MedicationRow } from '../../../../medications/types';

type MedSubTab = 'current' | 'insulin' | 'lai' | 'clozapine' | 'mar' | 'side-effects';

type MedicationApiRow = MedicationRow & {
  is_lai?: boolean;
  is_clozapine?: boolean;
};

// ============ Main Component ============

export const MedicationsTab: React.FC<{ patientId: string }> = ({ patientId }) => {
  const clinicId = useAuthStore(s => s.user?.clinicId ?? '');
  const [subTab, setSubTab] = useState<MedSubTab>('current');
  // Insulin regimen is an endocrinology surface — only render the
  // sub-tab when the visibility intersection (clinic ∩ staff ∩ patient
  // episodes) actually contains endocrinology, so non-endo clinicians
  // don't see it. The module registry entry stays put so this
  // predicate continues to resolve correctly.
  const { isTabVisible } = useModuleVisibility({ patientId });
  const showInsulin = isTabVisible('insulin');

  // BUG-547: surface a non-blocking warning Alert when the prescriber-
  // status check fails. Pre-fix the hook silently returned false on
  // transient failure (fail-CLOSED, safe but invisible) so a clinician
  // who just renewed their prescriber number could be told "you're not
  // a prescriber" indefinitely with no diagnostic. The fail-CLOSED
  // posture is preserved (the Prescribe affordance stays hidden) but
  // the warning explains why.
  const { isError: prescriberStatusError } = usePrescriberStatus();

  // BUG-524-F closes BUG-548 atomically: the pre-existing
  // try/catch-return-empty silent fallback collapsed `failed`
  // into `empty` on a clinical-safety surface (clinician seeing "no
  // medications" on a transient API failure could prescribe without
  // knowing existing meds). Per BUG-530 SSoT (CLAUDE.md §16.2), use
  // tryAsync to surface fetch failure explicitly via React-Query's
  // `isError` state and the `<Alert severity="error">` failure banner
  // already wired below.
  const { data, isLoading, isError } = useQuery({
    queryKey: patientMedicationsKeys.byPatient(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<MedicationApiRow[] | { data?: MedicationApiRow[] }>(`medications/patients/${patientId}/medications`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : Array.isArray(r.value?.data) ? r.value.data : [];
    },
    enabled: !!clinicId && !!patientId,
  });

  const allMeds: MedicationApiRow[] = Array.isArray(data) ? data : [];
  const active = allMeds.filter(m => m.status === 'active' || m.status === 'tapering');
  const laiMeds = allMeds.filter(m => m.isLai || m.is_lai);
  const clozMeds = allMeds.filter(m => m.isClozapine || m.is_clozapine);

  return (
    <AllergyAckGate patientId={patientId}>
    <Box>
      <AllergyPanel patientId={patientId} />
      <InteractionPanel activeMeds={active} />
      <Tabs aria-label="Navigation tabs" value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}>
        <Tab label={`Current Medications (${active.length})`} value="current" />
        {showInsulin && <Tab label="Insulin Regimen" value="insulin" />}
        <Tab label={`LAI (${laiMeds.length})`} value="lai" />
        <Tab label={`Clozapine (${clozMeds.length})`} value="clozapine" />
        <Tab label="MAR Chart" value="mar" />
        <Tab label="Side Effects" value="side-effects" />
      </Tabs>

      {isError && <Alert role="alert" severity="error" sx={{ mb: 2 }}>Failed to load medications.</Alert>}

      {prescriberStatusError && (
        <Alert role="alert" severity="warning" sx={{ mb: 2 }}>
          Failed to load your prescriber status. The Prescribe affordance is hidden until the connection is restored — refresh to retry. If you have just registered or renewed your prescriber number, the change will appear once the connection is restored.
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress role="progressbar" aria-label="Loading" size={28} sx={{ color: '#b8621a' }} /></Box>
      ) : (
        <>
          {subTab === 'current' && <CurrentMedsPanel rows={active} patientId={patientId} />}
          {subTab === 'insulin' && showInsulin && <InsulinRegimenPanel patientId={patientId} />}
          {subTab === 'lai' && <LaiPanel laiMeds={laiMeds} patientId={patientId} />}
          {subTab === 'clozapine' && <ClozapinePanel clozMeds={clozMeds} patientId={patientId} />}
          {subTab === 'mar' && <MarChartPanel patientId={patientId} />}
          {subTab === 'side-effects' && <SideEffectsPanel patientId={patientId} />}
        </>
      )}
    </Box>
    </AllergyAckGate>
  );
};
