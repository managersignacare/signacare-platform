// apps/web/src/features/paediatrics/tabs/MilestonesTab.tsx
//
// Multi-specialty Phase 5 (revision) — content-only Milestones view.
// Embedded as a sub-tab inside PaediatricsTab, which owns the unified
// Clinical Notes sub-tab. WHO five-domain developmental framework.
import AddIcon from '@mui/icons-material/Add'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  CreateMilestoneSchema,
  MilestoneDomainEnum,
  MilestoneStatusEnum,
  type CreateMilestoneDTO,
  type MilestoneDomain,
  type MilestoneResponse,
  type MilestoneStatus,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'

import { milestoneKeys } from '../queryKeys'

interface Props { patientId: string }

const DOMAIN_LABEL: Record<MilestoneDomain, string> = {
  gross_motor: 'Gross motor',
  fine_motor: 'Fine motor',
  language: 'Language',
  cognitive: 'Cognitive',
  social_emotional: 'Social & emotional',
}

const STATUS_COLOR: Record<MilestoneStatus, 'success' | 'warning' | 'default' | 'error'> = {
  achieved: 'success',
  delayed: 'warning',
  not_assessed: 'default',
  regression: 'error',
}

function useMilestones(patientId: string) {
  return useQuery<{ items: MilestoneResponse[] }>({
    queryKey: milestoneKeys.list(patientId),
    queryFn: () =>
      apiClient.get<{ items: MilestoneResponse[] }>(
        `paediatrics/patients/${patientId}/milestones`,
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useCreateMilestone(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateMilestoneDTO) =>
      apiClient.post<MilestoneResponse>(
        `paediatrics/patients/${patientId}/milestones`,
        dto,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: milestoneKeys.list(patientId) }),
  })
}

interface AddDialogProps { open: boolean; patientId: string; onClose: () => void }

function AddMilestoneDialog({ open, patientId, onClose }: AddDialogProps) {
  const [domain, setDomain] = useState<MilestoneDomain>('gross_motor')
  const [milestone, setMilestone] = useState('')
  const [expectedAge, setExpectedAge] = useState('')
  const [achievedAt, setAchievedAt] = useState('')
  const [status, setStatus] = useState<MilestoneStatus>('not_assessed')
  const [note, setNote] = useState('')

  const createMut = useCreateMilestone(patientId)

  const handleSubmit = async () => {
    const payload: CreateMilestoneDTO = CreateMilestoneSchema.parse({
      patientId,
      domain,
      milestone: milestone.trim(),
      expectedAgeMonths: expectedAge ? parseInt(expectedAge, 10) : null,
      achievedAtMonths: achievedAt ? parseInt(achievedAt, 10) : null,
      status,
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setMilestone('')
    setExpectedAge('')
    setAchievedAt('')
    setNote('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        Record Milestone
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Domain</InputLabel>
              <Select value={domain} onChange={(e) => setDomain(e.target.value as MilestoneDomain)} label="Domain">
                {MilestoneDomainEnum.options.map((d) => (
                  <MenuItem key={d} value={d}>{DOMAIN_LABEL[d]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={status} onChange={(e) => setStatus(e.target.value as MilestoneStatus)} label="Status">
                {MilestoneStatusEnum.options.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Milestone" fullWidth size="small" value={milestone} onChange={(e) => setMilestone(e.target.value)}
              placeholder="e.g. Sits without support" />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Expected age (months)" type="number" fullWidth size="small" value={expectedAge} onChange={(e) => setExpectedAge(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Achieved at (months)" type="number" fullWidth size="small" value={achievedAt} onChange={(e) => setAchievedAt(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={createMut.isPending || milestone.trim().length === 0}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Record'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function MilestonesTab({ patientId }: Props) {
  const { data, isLoading } = useMilestones(patientId)
  const [addOpen, setAddOpen] = useState(false)

  const items = data?.items ?? []

  const grouped = useMemo(() => {
    const acc: Record<MilestoneDomain, MilestoneResponse[]> = {
      gross_motor: [],
      fine_motor: [],
      language: [],
      cognitive: [],
      social_emotional: [],
    }
    for (const m of items) acc[m.domain].push(m)
    return acc
  }, [items])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          WHO five-domain developmental framework. Track expected vs. achieved age per milestone
          across gross motor, fine motor, language, cognitive and social-emotional domains.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, flexShrink: 0 }}>
          Record Milestone
        </Button>
      </Box>

      {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!isLoading && items.length === 0 && (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No milestones recorded yet. Click "Record Milestone" to add one.
              </Typography>
            </Paper>
          )}
          {!isLoading && items.length > 0 && (
            <Grid container spacing={2}>
              {(MilestoneDomainEnum.options as MilestoneDomain[]).map((d) => {
                const list = grouped[d]
                if (list.length === 0) return null
                return (
                  <Grid size={{ xs: 12, md: 6 }} key={d}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="overline" sx={{ color: '#b8621a', fontSize: 11 }}>{DOMAIN_LABEL[d]}</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                          {list.map((m) => (
                            <Box key={m.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                              <Chip size="small" label={m.status} color={STATUS_COLOR[m.status]} sx={{ flexShrink: 0 }} />
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight={500}>{m.milestone}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Expected: {m.expectedAgeMonths != null ? `${m.expectedAgeMonths}m` : '—'}
                                  {' · '}
                                  Achieved: {m.achievedAtMonths != null ? `${m.achievedAtMonths}m` : '—'}
                                </Typography>
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                )
              })}
            </Grid>
          )}

      <AddMilestoneDialog open={addOpen} patientId={patientId} onClose={() => setAddOpen(false)} />
    </Box>
  )
}

export default MilestonesTab
