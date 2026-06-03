// apps/web/src/features/obs-gyne/tabs/PregnancyDashboardTab.tsx
//
// Multi-specialty Phase 6 — Obstetrics & Gynaecology: pregnancy
// dashboard. Lists the patient's pregnancies (most recent first)
// with EDD auto-computed via Naegele's rule when the user omits
// it, and a GTPAL summary line. A "New Pregnancy" dialog handles
// creation with client-side EDD preview.
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
  CreatePregnancySchema,
  PregnancyStatusEnum,
  computeEddFromLmp,
  type CreatePregnancyDTO,
  type PregnancyResponse,
  type PregnancyStatus,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'

interface Props { patientId: string }

const pregnancyKeys = {
  list: (patientId: string) => ['obs-gyne', 'pregnancies', patientId] as const,
}

const STATUS_COLOR: Record<PregnancyStatus, 'success' | 'info' | 'warning' | 'error'> = {
  ongoing: 'info',
  delivered: 'success',
  miscarried: 'warning',
  terminated: 'error',
}

function usePregnancies(patientId: string) {
  return useQuery<{ items: PregnancyResponse[] }>({
    queryKey: pregnancyKeys.list(patientId),
    queryFn: () =>
      apiClient.get<{ items: PregnancyResponse[] }>(`obs-gyne/patients/${patientId}/pregnancies`),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useCreatePregnancy(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreatePregnancyDTO) =>
      apiClient.post<PregnancyResponse>(`obs-gyne/patients/${patientId}/pregnancies`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: pregnancyKeys.list(patientId) }),
  })
}

interface AddDialogProps { open: boolean; patientId: string; onClose: () => void }

function AddPregnancyDialog({ open, patientId, onClose }: AddDialogProps) {
  const [lmpDate, setLmpDate] = useState('')
  const [gravida, setGravida] = useState('1')
  const [term, setTerm] = useState('0')
  const [preterm, setPreterm] = useState('0')
  const [abortions, setAbortions] = useState('0')
  const [living, setLiving] = useState('0')
  const [status, setStatus] = useState<PregnancyStatus>('ongoing')
  const [note, setNote] = useState('')

  const createMut = useCreatePregnancy(patientId)

  const previewEdd = useMemo(() => (lmpDate ? computeEddFromLmp(lmpDate) : '—'), [lmpDate])

  const handleSubmit = async () => {
    if (!lmpDate) return
    const payload: CreatePregnancyDTO = CreatePregnancySchema.parse({
      patientId,
      lmpDate,
      gtpal: {
        gravida: parseInt(gravida, 10),
        term: parseInt(term, 10),
        preterm: parseInt(preterm, 10),
        abortions: parseInt(abortions, 10),
        living: parseInt(living, 10),
      },
      status,
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setLmpDate('')
    setNote('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        New Pregnancy
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="LMP date *"
              type="date"
              fullWidth
              size="small"
              value={lmpDate}
              onChange={(e) => setLmpDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="EDD (Naegele)"
              fullWidth
              size="small"
              value={previewEdd}
              slotProps={{ input: { readOnly: true }, inputLabel: { shrink: true } }}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="overline" sx={{ fontSize: 10, color: '#C2185B', letterSpacing: 1 }}>
              GTPAL
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 2.4 }}>
            <TextField label="Gravida" type="number" fullWidth size="small" value={gravida} onChange={(e) => setGravida(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 2.4 }}>
            <TextField label="Term" type="number" fullWidth size="small" value={term} onChange={(e) => setTerm(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 2.4 }}>
            <TextField label="Preterm" type="number" fullWidth size="small" value={preterm} onChange={(e) => setPreterm(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 2.4 }}>
            <TextField label="Abortions" type="number" fullWidth size="small" value={abortions} onChange={(e) => setAbortions(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 2.4 }}>
            <TextField label="Living" type="number" fullWidth size="small" value={living} onChange={(e) => setLiving(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={status} onChange={(e) => setStatus(e.target.value as PregnancyStatus)} label="Status">
                {PregnancyStatusEnum.options.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={createMut.isPending || !lmpDate}
          sx={{ bgcolor: '#C2185B', '&:hover': { bgcolor: '#E91E63' } }}
        >
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Pregnancy'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function PregnancyDashboardTab({ patientId }: Props) {
  const { data, isLoading } = usePregnancies(patientId)
  const [addOpen, setAddOpen] = useState(false)

  const items = data?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          One row per gestation. EDD is auto-computed via Naegele's rule from LMP when not provided;
          antenatal visits live in their own sub-tab and link to the selected pregnancy.
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#C2185B', '&:hover': { bgcolor: '#E91E63' }, flexShrink: 0 }}
        >
          New Pregnancy
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
            No pregnancies recorded yet.
          </Typography>
        </Paper>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {items.map((p) => (
          <Card key={p.id} variant="outlined">
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    LMP {p.lmpDate}
                    {' · '}
                    EDD {p.eddDate}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    G{p.gtpal.gravida} T{p.gtpal.term} P{p.gtpal.preterm} A{p.gtpal.abortions} L{p.gtpal.living}
                  </Typography>
                  {p.note && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      {p.note}
                    </Typography>
                  )}
                </Box>
                <Chip size="small" label={p.status} color={STATUS_COLOR[p.status]} />
              </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      <AddPregnancyDialog open={addOpen} patientId={patientId} onClose={() => setAddOpen(false)} />
    </Box>
  )
}

export default PregnancyDashboardTab
