// apps/web/src/features/patients/components/detail/tabs/MentalHealthInformationExchangeTab.tsx
//
// Nested "Information Exchange" wrapper for Mental Health.
//
// The three shared information-exchange surfaces (Referrals,
// Correspondence, Documents) used to sit as their own top-level
// "Information Exchange" tab group. Per the latest user request they
// are now nested under the Mental Health group, behind a single
// "Information Exchange" parent tab with three internal sub-tabs.
//
// Deeplinks to the individual tabs (?tab=referrals etc.) still resolve
// because the ids are kept in PATIENT_TABS / TAB_COMPONENTS — this
// wrapper is purely a presentation layer that reuses the existing tab
// components unchanged.
import ForumIcon from '@mui/icons-material/Forum'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { Box, Tab, Tabs, Typography } from '@mui/material'
import { useState } from 'react'
import { CorrespondenceTab } from './CorrespondenceTab'
import { DocumentsTab } from './DocumentsTab'
import { ReferralsTab } from './ReferralsTab'

interface Props { patientId: string }

type InnerTab = 'referrals' | 'correspondence' | 'documents'

export function MentalHealthInformationExchangeTab({ patientId }: Props) {
  const [inner, setInner] = useState<InnerTab>('referrals')

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <SwapHorizIcon sx={{ color: '#7B1FA2' }} />
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Information Exchange
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Mental health referrals, correspondence (messages + letters) and uploaded documents for
            this patient.
          </Typography>
        </Box>
      </Box>

      <Tabs
        value={inner}
        onChange={(_, v) => setInner(v as InnerTab)}
        sx={{
          mb: 2,
          '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 },
        }}
      >
        <Tab icon={<SwapHorizIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Referrals" value="referrals" />
        <Tab icon={<ForumIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Correspondence" value="correspondence" />
        <Tab icon={<FolderOpenIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Documents" value="documents" />
      </Tabs>

      {inner === 'referrals' && <ReferralsTab patientId={patientId} />}
      {inner === 'correspondence' && <CorrespondenceTab patientId={patientId} />}
      {inner === 'documents' && <DocumentsTab patientId={patientId} />}
    </Box>
  )
}

export default MentalHealthInformationExchangeTab
