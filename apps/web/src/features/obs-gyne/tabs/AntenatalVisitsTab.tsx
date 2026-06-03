// apps/web/src/features/obs-gyne/tabs/AntenatalVisitsTab.tsx
//
// Multi-specialty Phase 6 — Obs & Gyne: per-visit flowsheet.
//
// Pick a pregnancy from the dropdown (auto-selects the most recent
// ongoing one) and see its antenatal visits as a sortable table:
// visit #, date, gestational age, fundal height, fetal HR, BP and
// urine dipstick. "Add Visit" pops a compact form that posts to
// POST /obs-gyne/pregnancies/:id/visits.
import AddIcon from '@mui/icons-material/Add'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  CreateAntenatalVisitSchema,
  UrineDipstickEnum,
  type AntenatalVisitResponse,
  type CreateAntenatalVisitDTO,
  type PregnancyResponse,
  type UrineDipstick,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { obsGyneKeys } from '../queryKeys'

interface Props { patientId: string }

function usePregnancies(patientId: string) {
  return useQuery<{ items: PregnancyResponse[] }>({
    queryKey: obsGyneKeys.pregnancies(patientId),
    queryFn: () =>
      apiClient.get<{ items: PregnancyResponse[] }>(`obs-gyne/patients/${patientId}/pregnancies`),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useVisits(pregnancyId: string) {
  return useQuery<{ items: AntenatalVisitResponse[] }>({
    queryKey: obsGyneKeys.visits(pregnancyId),
    queryFn: () =>
      apiClient.get<{ items: AntenatalVisitResponse[] }>(`obs-gyne/pregnancies/${pregnancyId}/visits`),
    staleTime: 30_000,
    enabled: !!pregnancyId,
  })
}

function useCreateVisit(pregnancyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateAntenatalVisitDTO) =>
      apiClient.post<AntenatalVisitResponse>(`obs-gyne/pregnancies/${pregnancyId}/visits`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: obsGyneKeys.visits(pregnancyId) }),
  })
}

interface AddDialogProps {
  open: boolean
  pregnancyId: string
  nextVisitNumber: number
  onClose: () => void
}

function AddVisitDialog({ open, pregnancyId, nextVisitNumber, onClose }: AddDialogProps) {
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [gaWeeks, setGaWeeks] = useState('')
  const [gaDays, setGaDays] = useState('0')
  const [fundal, setFundal] = useState('')
  const [fhr, setFhr] = useState('')
  const [bpSys, setBpSys] = useState('')
  const [bpDia, setBpDia] = useState('')
  const [urineProtein, setUrineProtein] = useState<UrineDipstick | ''>('')
  const [urineGlucose, setUrineGlucose] = useState<UrineDipstick | ''>('')
  const [oedema, setOedema] = useState(false)
  const [note, setNote] = useState('')

  const createMut = useCreateVisit(pregnancyId)

  const handleSubmit = async () => {
    const payload: CreateAntenatalVisitDTO = CreateAntenatalVisitSchema.parse({
      pregnancyId,
      visitNumber: nextVisitNumber,
      visitDate,
      gaWeeks: parseInt(gaWeeks || '0', 10),
      gaDays: parseInt(gaDays || '0', 10),
      fundalHeightCm: fundal ? parseFloat(fundal) : null,
      fetalHeartRateBpm: fhr ? parseInt(fhr, 10) : null,
      bpSystolic: bpSys ? parseInt(bpSys, 10) : null,
      bpDiastolic: bpDia ? parseInt(bpDia, 10) : null,
      urineProtein: urineProtein || null,
      urineGlucose: urineGlucose || null,
      oedema,
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setFundal('')
    setFhr('')
    setBpSys('')
    setBpDia('')
    setNote('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        Antenatal Visit #{nextVisitNumber}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Visit date" type="date" fullWidth size="small" value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TextField label="GA weeks *" type="number" fullWidth size="small" value={gaWeeks}
              onChange={(e) => setGaWeeks(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TextField label="GA days" type="number" fullWidth size="small" value={gaDays}
              onChange={(e) => setGaDays(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Fundal height (cm)" type="number" fullWidth size="small" value={fundal}
              onChange={(e) => setFundal(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Fetal HR (bpm)" type="number" fullWidth size="small" value={fhr}
              onChange={(e) => setFhr(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="BP sys" type="number" fullWidth size="small" value={bpSys}
              onChange={(e) => setBpSys(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="BP dia" type="number" fullWidth size="small" value={bpDia}
              onChange={(e) => setBpDia(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Urine protein</InputLabel>
              <Select value={urineProtein} onChange={(e) => setUrineProtein(e.target.value as UrineDipstick | '')} label="Urine protein">
                <MenuItem value=""><em>—</em></MenuItem>
                {UrineDipstickEnum.options.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Urine glucose</InputLabel>
              <Select value={urineGlucose} onChange={(e) => setUrineGlucose(e.target.value as UrineDipstick | '')} label="Urine glucose">
                <MenuItem value=""><em>—</em></MenuItem>
                {UrineDipstickEnum.options.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControlLabel
              control={<Switch checked={oedema} onChange={(e) => setOedema(e.target.checked)} />}
              label="Oedema present"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2} value={note}
              onChange={(e) => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={createMut.isPending || !gaWeeks}
          sx={{ bgcolor: '#C2185B', '&:hover': { bgcolor: '#E91E63' } }}
        >
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Visit'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function AntenatalVisitsTab({ patientId }: Props) {
  const { data: pregData } = usePregnancies(patientId)
  const pregnancies = pregData?.items ?? []
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!selectedId && pregnancies.length > 0) {
      const ongoing = pregnancies.find((p) => p.status === 'ongoing')
      setSelectedId((ongoing ?? pregnancies[0]).id)
    }
  }, [pregnancies, selectedId])

  const { data: visitData, isLoading } = useVisits(selectedId)
  const visits = visitData?.items ?? []
  const [addOpen, setAddOpen] = useState(false)

  const nextVisitNumber = useMemo(
    () => (visits.length === 0 ? 1 : Math.max(...visits.map((v) => v.visitNumber)) + 1),
    [visits],
  )

  if (pregnancies.length === 0) {
    return (
      <Alert severity="info" variant="outlined">
        Add a pregnancy from the Pregnancies sub-tab before recording antenatal visits.
      </Alert>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>Pregnancy</InputLabel>
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} label="Pregnancy">
            {pregnancies.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                LMP {p.lmpDate} · EDD {p.eddDate} · {p.status}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
          disabled={!selectedId}
          sx={{ bgcolor: '#C2185B', '&:hover': { bgcolor: '#E91E63' } }}
        >
          Add Visit
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {['#', 'Date', 'GA', 'Fundal (cm)', 'Fetal HR', 'BP', 'Urine P / G', 'Oedema', 'Seen by'].map((h) => (
                <TableCell key={h} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12, color: '#3D484B', backgroundColor: '#FAFAFA' }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={9} align="center"><CircularProgress size={22} /></TableCell></TableRow>
            )}
            {!isLoading && visits.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography variant="body2" color="text.secondary">No antenatal visits recorded for this pregnancy.</Typography>
                </TableCell>
              </TableRow>
            )}
            {visits.map((v) => (
              <TableRow key={v.id} hover>
                <TableCell>{v.visitNumber}</TableCell>
                <TableCell>{v.visitDate}</TableCell>
                <TableCell>{v.gaWeeks}+{v.gaDays}</TableCell>
                <TableCell>{v.fundalHeightCm ?? '—'}</TableCell>
                <TableCell>{v.fetalHeartRateBpm ?? '—'}</TableCell>
                <TableCell>{v.bpSystolic && v.bpDiastolic ? `${v.bpSystolic}/${v.bpDiastolic}` : '—'}</TableCell>
                <TableCell>{v.urineProtein ?? '—'} / {v.urineGlucose ?? '—'}</TableCell>
                <TableCell>{v.oedema == null ? '—' : v.oedema ? 'Yes' : 'No'}</TableCell>
                <TableCell>{v.seenByName ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {selectedId && (
        <AddVisitDialog
          open={addOpen}
          pregnancyId={selectedId}
          nextVisitNumber={nextVisitNumber}
          onClose={() => setAddOpen(false)}
        />
      )}
    </Box>
  )
}

export default AntenatalVisitsTab
