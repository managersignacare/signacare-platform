// apps/web/src/features/surgery/tabs/SurgeryTab.tsx
//
// Multi-specialty Phase 7 — single Surgery top-level tab.
//
// Matches the pattern the user settled on for every specialty:
//   - SpecialtyMdtBanner at the top
//   - Sub-tabs:
//       • Cases               (SurgicalCasesTab)
//       • Safety Checklist    (SafetyChecklistTab — WHO 3-phase wizard)
//       • Op Note             (OpNoteTab — blocks until checklist complete)
//       • PACU                (PacuTab — recovery flowsheet)
//       • Clinical Notes      (shared SpecialtyNotesPanel)
//
// Information Exchange lives as its own top-level tab sibling
// (surg-exchange) in PATIENT_TAB_GROUPS — not nested here.
import { Box, Tab, Tabs, Typography } from '@mui/material'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import { useState } from 'react'
import { SpecialtyMdtBanner } from '../../../shared/components/specialty/SpecialtyMdtBanner'
import { SpecialtyNotesPanel } from '../../../shared/components/specialty/SpecialtyNotesPanel'
import { OpNoteTab } from './OpNoteTab'
import { PacuTab } from './PacuTab'
import { SafetyChecklistTab } from './SafetyChecklistTab'
import { SurgicalCasesTab } from './SurgicalCasesTab'

interface Props { patientId: string }

type SubTab = 'cases' | 'checklist' | 'opnote' | 'pacu' | 'notes'

export function SurgeryTab({ patientId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('cases')

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <ContentCutIcon sx={{ color: '#455A64' }} />
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Surgery
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Surgical cases, WHO three-phase safety checklist, operative note and PACU recovery
            flowsheet. Op-note creation is blocked by the backend until all three checklist phases
            exist for the case — defence-in-depth on top of the UI wizard.
          </Typography>
        </Box>
      </Box>

      <SpecialtyMdtBanner
        patientId={patientId}
        specialty="surgery"
        specialtyLabel="Surgery"
      />

      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v as SubTab)}
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}
      >
        <Tab label="Cases" value="cases" />
        <Tab label="Safety Checklist" value="checklist" />
        <Tab label="Op Note" value="opnote" />
        <Tab label="PACU" value="pacu" />
        <Tab label="Clinical Notes" value="notes" />
      </Tabs>

      {subTab === 'cases' && <SurgicalCasesTab patientId={patientId} />}
      {subTab === 'checklist' && <SafetyChecklistTab patientId={patientId} />}
      {subTab === 'opnote' && <OpNoteTab patientId={patientId} />}
      {subTab === 'pacu' && <PacuTab patientId={patientId} />}
      {subTab === 'notes' && <SpecialtyNotesPanel patientId={patientId} specialtyLabel="Surgery" />}
    </Box>
  )
}

export default SurgeryTab
