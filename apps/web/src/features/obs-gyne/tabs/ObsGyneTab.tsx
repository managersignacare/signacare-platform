// apps/web/src/features/obs-gyne/tabs/ObsGyneTab.tsx
//
// Multi-specialty Phase 6 — single Obstetrics & Gynaecology top-level
// tab. Matches the pattern the user settled on for every specialty:
//   - SpecialtyMdtBanner at the top
//   - Sub-tabs:
//       • Pregnancies     (PregnancyDashboardTab)
//       • Antenatal Visits (AntenatalVisitsTab)
//       • Clinical Notes  (shared SpecialtyNotesPanel)
//
// Information Exchange lives as its own top-level tab sibling
// (obs-exchange) in PATIENT_TAB_GROUPS — not nested here — to match
// the placement the user picked for the other specialties.
import { Box, Tab, Tabs, Typography } from '@mui/material'
import PregnantWomanIcon from '@mui/icons-material/PregnantWoman'
import { useState } from 'react'
import { SpecialtyMdtBanner } from '../../../shared/components/specialty/SpecialtyMdtBanner'
import { SpecialtyNotesPanel } from '../../../shared/components/specialty/SpecialtyNotesPanel'
import { AntenatalVisitsTab } from './AntenatalVisitsTab'
import { PregnancyDashboardTab } from './PregnancyDashboardTab'

interface Props { patientId: string }

type SubTab = 'pregnancies' | 'visits' | 'notes'

export function ObsGyneTab({ patientId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('pregnancies')

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <PregnantWomanIcon sx={{ color: '#C2185B' }} />
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Obstetrics & Gynaecology
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Pregnancy dashboard, antenatal visit flowsheet and clinical notes. EDD auto-computes
            via Naegele's rule; per-visit fundal height / fetal HR / BP / urinalysis captured.
          </Typography>
        </Box>
      </Box>

      <SpecialtyMdtBanner
        patientId={patientId}
        specialty="obstetrics_gynaecology"
        specialtyLabel="Obstetrics & Gynaecology"
      />

      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v as SubTab)}
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}
      >
        <Tab label="Pregnancies" value="pregnancies" />
        <Tab label="Antenatal Visits" value="visits" />
        <Tab label="Clinical Notes" value="notes" />
      </Tabs>

      {subTab === 'pregnancies' && <PregnancyDashboardTab patientId={patientId} />}
      {subTab === 'visits' && <AntenatalVisitsTab patientId={patientId} />}
      {subTab === 'notes' && <SpecialtyNotesPanel patientId={patientId} specialtyLabel="Obstetrics & Gynaecology" />}
    </Box>
  )
}

export default ObsGyneTab
