// apps/web/src/shared/components/specialty/SpecialtyInformationExchangeTab.tsx
//
// Per-specialty Information Exchange wrapper — mirrors the Mental
// Health nested pattern (apps/web/src/features/patients/components/
// detail/tabs/MentalHealthInformationExchangeTab.tsx) so every
// specialty gets the same full-featured UX:
//
//   Information Exchange (parent tab)
//     ├── Referrals     (full ReferralsTab)
//     ├── Correspondence (full CorrespondenceTab — Messages, Threads, Letters)
//     └── Documents     (full DocumentsTab)
//
// The nested sub-tabs reuse the existing shared tab components as-is
// so there's a single source of truth for referral / correspondence /
// document CRUD across mental-health and non-mental-health specialties.
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ForumIcon from '@mui/icons-material/Forum'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { Box, Tab, Tabs, Typography } from '@mui/material'
import { useState } from 'react'
import { CorrespondenceTab } from '../../../features/patients/components/detail/tabs/CorrespondenceTab'
import { DocumentsTab } from '../../../features/patients/components/detail/tabs/DocumentsTab'
import { ReferralsTab } from '../../../features/patients/components/detail/tabs/ReferralsTab'

interface Props {
  patientId: string
  specialtyLabel: string
}

type InnerTab = 'referrals' | 'correspondence' | 'documents'

export function SpecialtyInformationExchangeTab({ patientId, specialtyLabel }: Props) {
  const [inner, setInner] = useState<InnerTab>('referrals')

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <SwapHorizIcon sx={{ color: '#b8621a' }} />
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Information Exchange
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {specialtyLabel} referrals, correspondence (messages + letters) and uploaded documents
            for this patient.
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

export default SpecialtyInformationExchangeTab
