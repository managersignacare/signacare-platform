// apps/web/src/features/internal-medicine/tabs/ChronicDiseaseRegisterTab.tsx
//
// Multi-specialty Phase 3 — Internal Medicine: Chronic Disease Register.
//
// Two sub-tabs:
//   1. Register — read-only view of is_chronic problems with status counts
//   2. Clinical Notes — list of recent clinical notes + "Write Note"
//
// Adds and edits to chronic problems still happen in the core Problem
// List tab so the underlying data flow stays single-source.
import LocalHospitalIcon from '@mui/icons-material/LocalHospital'
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { ProblemListEntry, ClinicalStatus, ProblemSeverity } from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { SpecialtyMdtBanner } from '../../../shared/components/specialty/SpecialtyMdtBanner'
import { SpecialtyNotesPanel } from '../../../shared/components/specialty/SpecialtyNotesPanel'
import { internalMedicineKeys } from '../queryKeys'

interface Props { patientId: string }

const STATUS_COLOR: Record<ClinicalStatus, 'warning' | 'info' | 'success' | 'default'> = {
  active: 'warning',
  recurrence: 'warning',
  relapse: 'warning',
  inactive: 'default',
  remission: 'info',
  resolved: 'success',
}

const SEVERITY_COLOR: Record<ProblemSeverity, 'info' | 'warning' | 'error'> = {
  mild: 'info',
  moderate: 'warning',
  severe: 'error',
}

function useChronicProblems(patientId: string) {
  return useQuery<{ items: ProblemListEntry[] }>({
    queryKey: internalMedicineKeys.problemListChronic(patientId),
    queryFn: () =>
      apiClient.get<{ items: ProblemListEntry[] }>(
        `internal-medicine/patients/${patientId}/problems`,
        { isChronic: true },
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function isActiveStatus(s: ClinicalStatus): boolean {
  return s === 'active' || s === 'recurrence' || s === 'relapse'
}

type SubTab = 'register' | 'notes'

export function ChronicDiseaseRegisterTab({ patientId }: Props) {
  const { data, isLoading, isError } = useChronicProblems(patientId)
  const items = data?.items ?? []
  const [subTab, setSubTab] = useState<SubTab>('register')

  const counts = useMemo(() => {
    let active = 0
    let remission = 0
    let resolved = 0
    let inactive = 0
    for (const p of items) {
      if (isActiveStatus(p.clinicalStatus)) active++
      else if (p.clinicalStatus === 'remission') remission++
      else if (p.clinicalStatus === 'resolved') resolved++
      else inactive++
    }
    return { active, remission, resolved, inactive }
  }, [items])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <LocalHospitalIcon sx={{ color: '#b8621a' }} />
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Internal Medicine
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Chronic disease register and clinical notes. Add or edit chronic problems from the
            Problem List tab — the register reflects the same data in real time.
          </Typography>
        </Box>
      </Box>

      <SpecialtyMdtBanner patientId={patientId} specialty="general_medicine" specialtyLabel="Internal Medicine" />

      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v as SubTab)}
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}
      >
        <Tab label="Chronic Disease Register" value="register" />
        <Tab label="Clinical Notes" value="notes" />
      </Tabs>

      {subTab === 'notes' && (
        <SpecialtyNotesPanel patientId={patientId} specialtyLabel="Internal Medicine" />
      )}

      {subTab === 'register' && (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">Active chronic</Typography>
                  <Typography variant="h5" fontWeight={700} sx={{ color: '#ED6C02' }}>{counts.active}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">In remission</Typography>
                  <Typography variant="h5" fontWeight={700} sx={{ color: '#0288D1' }}>{counts.remission}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">Resolved</Typography>
                  <Typography variant="h5" fontWeight={700} sx={{ color: '#2E7D32' }}>{counts.resolved}</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">Inactive</Typography>
                  <Typography variant="h5" fontWeight={700} color="text.secondary">{counts.inactive}</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Divider sx={{ mb: 2 }} />

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Condition', 'Code', 'Status', 'Severity', 'Onset', 'Recorded'].map((h) => (
                    <TableCell
                      key={h}
                      sx={{
                        fontFamily: 'Albert Sans, sans-serif',
                        fontWeight: 600,
                        fontSize: 12,
                        color: '#3D484B',
                        backgroundColor: '#FAFAFA',
                      }}
                    >
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} align="center"><CircularProgress size={22} /></TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography variant="body2" color="error">Failed to load chronic disease register.</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography variant="body2" color="text.secondary">
                        No chronic problems recorded. Mark a problem as chronic from the Problem List tab.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {items.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{p.display}</Typography>
                      {p.note && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {p.note}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                      {p.codeSystem.toUpperCase()}: {p.code}
                    </TableCell>
                    <TableCell>
                      <Chip label={p.clinicalStatus} size="small" color={STATUS_COLOR[p.clinicalStatus]} />
                    </TableCell>
                    <TableCell>
                      {p.severity ? (
                        <Chip label={p.severity} size="small" color={SEVERITY_COLOR[p.severity]} />
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>{p.onsetDate ?? '—'}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{p.recordedByName ?? '—'}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {new Date(p.recordedDate).toLocaleDateString('en-AU')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  )
}

export default ChronicDiseaseRegisterTab
