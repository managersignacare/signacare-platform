// apps/web/src/features/surgery/tabs/PacuTab.tsx
//
// Multi-specialty Phase 7 — PACU recovery flowsheet.
//
// A case can have multiple PACU entries as the patient progresses
// through recovery. Each row captures vitals, Aldrete score and
// whether discharge criteria were met. Aldrete ≥ 9 is the typical
// discharge threshold — surfaced as a soft hint in the UI.
import AddIcon from '@mui/icons-material/Add'
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { useEffect, useState } from 'react'
import {
  CreatePacuRecordSchema,
  type CreatePacuRecordDTO,
  type PacuRecordResponse,
  type SurgicalCaseResponse,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { surgicalCaseKeys } from './SurgicalCasesTab'

interface Props { patientId: string }

const pacuKeys = {
  list: (caseId: string) => ['surgery', 'pacu', caseId] as const,
}

function useCases(patientId: string) {
  return useQuery<{ items: SurgicalCaseResponse[] }>({
    queryKey: surgicalCaseKeys.list(patientId),
    queryFn: () =>
      apiClient.get<{ items: SurgicalCaseResponse[] }>(`surgery/patients/${patientId}/cases`),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function usePacu(caseId: string) {
  return useQuery<{ items: PacuRecordResponse[] }>({
    queryKey: pacuKeys.list(caseId),
    queryFn: () =>
      apiClient.get<{ items: PacuRecordResponse[] }>(`surgery/cases/${caseId}/pacu`),
    staleTime: 30_000,
    enabled: !!caseId,
  })
}

function useCreatePacu(caseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreatePacuRecordDTO) =>
      apiClient.post<PacuRecordResponse>(`surgery/cases/${caseId}/pacu`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: pacuKeys.list(caseId) }),
  })
}

function AddPacuDialog({ caseId, open, onClose }: { caseId: string; open: boolean; onClose: () => void }) {
  const [hr, setHr] = useState('')
  const [bpSys, setBpSys] = useState('')
  const [bpDia, setBpDia] = useState('')
  const [spo2, setSpo2] = useState('')
  const [temperature, setTemperature] = useState('')
  const [respiratoryRate, setRespiratoryRate] = useState('')
  const [aldrete, setAldrete] = useState('10')
  const [discharge, setDischarge] = useState(false)
  const [note, setNote] = useState('')

  const createMut = useCreatePacu(caseId)

  const handleSubmit = async () => {
    const payload: CreatePacuRecordDTO = CreatePacuRecordSchema.parse({
      caseId,
      vitals: {
        hr: hr ? parseInt(hr, 10) : null,
        bpSystolic: bpSys ? parseInt(bpSys, 10) : null,
        bpDiastolic: bpDia ? parseInt(bpDia, 10) : null,
        spo2: spo2 ? parseInt(spo2, 10) : null,
        temperatureC: temperature ? parseFloat(temperature) : null,
        respiratoryRate: respiratoryRate ? parseInt(respiratoryRate, 10) : null,
      },
      aldreteScore: parseInt(aldrete, 10),
      dischargeCriteriaMet: discharge,
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setHr('')
    setBpSys('')
    setBpDia('')
    setSpo2('')
    setTemperature('')
    setRespiratoryRate('')
    setNote('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        PACU Recovery Entry
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="HR" type="number" fullWidth size="small" value={hr} onChange={(e) => setHr(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="BP sys" type="number" fullWidth size="small" value={bpSys} onChange={(e) => setBpSys(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="BP dia" type="number" fullWidth size="small" value={bpDia} onChange={(e) => setBpDia(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="SpO₂ %" type="number" fullWidth size="small" value={spo2} onChange={(e) => setSpo2(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="Temp °C" type="number" fullWidth size="small" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="RR" type="number" fullWidth size="small" value={respiratoryRate} onChange={(e) => setRespiratoryRate(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Aldrete score</InputLabel>
              <Select value={aldrete} label="Aldrete score" onChange={(e) => setAldrete(e.target.value)}>
                {Array.from({ length: 11 }, (_, n) => String(n)).map((v) => (
                  <MenuItem key={v} value={v}>{v}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControlLabel
              control={<Switch checked={discharge} onChange={(e) => setDischarge(e.target.checked)} />}
              label="Discharge criteria met"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2}
              value={note} onChange={(e) => setNote(e.target.value)} />
          </Grid>
          {parseInt(aldrete, 10) < 9 && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="warning" variant="outlined">
                Aldrete score &lt; 9 — patient typically not ready for PACU discharge.
              </Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={createMut.isPending}
          onClick={handleSubmit}
          sx={{ bgcolor: '#455A64', '&:hover': { bgcolor: '#607D8B' } }}>
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Entry'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

interface VitalsShape {
  hr?: number | null
  bpSystolic?: number | null
  bpDiastolic?: number | null
  spo2?: number | null
  temperatureC?: number | null
  respiratoryRate?: number | null
}

export function PacuTab({ patientId }: Props) {
  const { data: caseData } = useCases(patientId)
  const cases = caseData?.items ?? []
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!selectedId && cases.length > 0) setSelectedId(cases[0].id)
  }, [cases, selectedId])

  const { data: pacuData, isLoading } = usePacu(selectedId)
  const entries = pacuData?.items ?? []
  const [addOpen, setAddOpen] = useState(false)

  if (cases.length === 0) {
    return (
      <Alert severity="info" variant="outlined">
        Add a surgical case in the Cases sub-tab before recording PACU entries.
      </Alert>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 320 }}>
          <InputLabel>Case</InputLabel>
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} label="Case">
            {cases.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.procedureDisplay} · {c.plannedDate}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          disabled={!selectedId}
          sx={{ bgcolor: '#455A64', '&:hover': { bgcolor: '#607D8B' } }}>
          New Entry
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Time', 'HR', 'BP', 'SpO₂', 'Temp', 'RR', 'Aldrete', 'Discharge?'].map((h) => (
                <TableCell key={h} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12, color: '#3D484B', backgroundColor: '#FAFAFA' }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={22} /></TableCell></TableRow>
            )}
            {!isLoading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography variant="body2" color="text.secondary">No PACU entries recorded for this case.</Typography>
                </TableCell>
              </TableRow>
            )}
            {entries.map((e) => {
              const v = (e.vitals ?? {}) as VitalsShape
              return (
                <TableRow key={e.id} hover>
                  <TableCell>{new Date(e.createdAt).toLocaleTimeString('en-AU')}</TableCell>
                  <TableCell>{v.hr ?? '—'}</TableCell>
                  <TableCell>{v.bpSystolic && v.bpDiastolic ? `${v.bpSystolic}/${v.bpDiastolic}` : '—'}</TableCell>
                  <TableCell>{v.spo2 ?? '—'}</TableCell>
                  <TableCell>{v.temperatureC ?? '—'}</TableCell>
                  <TableCell>{v.respiratoryRate ?? '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={e.aldreteScore}
                      color={e.aldreteScore >= 9 ? 'success' : 'warning'} />
                  </TableCell>
                  <TableCell>{e.dischargeCriteriaMet ? 'Yes' : 'No'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {selectedId && <AddPacuDialog caseId={selectedId} open={addOpen} onClose={() => setAddOpen(false)} />}
    </Box>
  )
}

export default PacuTab
