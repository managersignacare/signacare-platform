// apps/web/src/features/paediatrics/tabs/PaediatricsTab.tsx
//
// Multi-specialty Phase 5 (revision) — single Paediatrics tab.
//
// The user asked for ONE specialty tab per specialty with everything
// else folded into sub-tabs. This wrapper hosts:
//   - SpecialtyMdtBanner at the top (paediatrics MDT for the
//     latest active paediatric episode)
//   - Sub-tabs:
//       • Growth Chart        (existing GrowthChartTab body)
//       • Milestones          (existing MilestonesTab body)
//       • Immunizations       (existing ImmunizationsTab body)
//       • Clinical Notes      (shared SpecialtyNotesPanel,
//                              chronological)
//
// The three child tab files still exist and continue to export their
// own components — they are mounted here as sub-tab content rather
// than as top-level patient tabs. All hooks, dialogs, validation,
// and registry-gating in the child tabs are unchanged.
import { Box, Tab, Tabs, Typography } from '@mui/material'
import ChildCareIcon from '@mui/icons-material/ChildCare'
import { useState } from 'react'
import { SpecialtyMdtBanner } from '../../../shared/components/specialty/SpecialtyMdtBanner'
import { SpecialtyNotesPanel } from '../../../shared/components/specialty/SpecialtyNotesPanel'
import { GrowthChartTab } from './GrowthChartTab'
import { ImmunizationsTab } from './ImmunizationsTab'
import { MilestonesTab } from './MilestonesTab'

interface Props { patientId: string }

type SubTab = 'growth' | 'milestones' | 'immunizations' | 'notes'

export function PaediatricsTab({ patientId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('growth')

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <ChildCareIcon sx={{ color: '#388E3C' }} />
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Paediatrics
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Growth, milestones, immunizations and notes for this patient. WHO 0–2y / CDC 2–20y
            growth references; CVX-coded vaccines; WHO five-domain milestones.
          </Typography>
        </Box>
      </Box>

      <SpecialtyMdtBanner patientId={patientId} specialty="paediatrics" specialtyLabel="Paediatrics" />

      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v as SubTab)}
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}
      >
        <Tab label="Growth Chart" value="growth" />
        <Tab label="Milestones" value="milestones" />
        <Tab label="Immunizations" value="immunizations" />
        <Tab label="Clinical Notes" value="notes" />
      </Tabs>

      {subTab === 'growth' && <GrowthChartTab patientId={patientId} />}
      {subTab === 'milestones' && <MilestonesTab patientId={patientId} />}
      {subTab === 'immunizations' && <ImmunizationsTab patientId={patientId} />}
      {subTab === 'notes' && <SpecialtyNotesPanel patientId={patientId} specialtyLabel="Paediatrics" />}
    </Box>
  )
}

export default PaediatricsTab
