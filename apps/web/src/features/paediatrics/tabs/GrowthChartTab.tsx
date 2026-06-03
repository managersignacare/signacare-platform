// apps/web/src/features/paediatrics/tabs/GrowthChartTab.tsx
//
// Multi-specialty Phase 5 (revision) — content-only Growth Chart view.
//
// This component is now embedded inside the consolidated PaediatricsTab
// (which provides the parent sub-tab navigation, MDT banner, and the
// unified Clinical Notes sub-tab). It used to render its own internal
// sub-tabs, but those were removed when the user asked for a single
// top-level specialty tab per specialty with everything as sub-tabs.
//
// What stays here: the Add Reading button, the readings table, the
// type → unit defaulting in the dialog. The Clinical Notes panel was
// removed because the parent owns it.
import AddIcon from '@mui/icons-material/Add'
import {
  Box,
  Button,
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
import { useState } from 'react'
import {
  CreateGrowthMeasurementSchema,
  GrowthMeasurementTypeEnum,
  type CreateGrowthMeasurementDTO,
  type GrowthMeasurementResponse,
  type GrowthMeasurementType,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'

import { growthKeys } from '../queryKeys'

interface Props { patientId: string }

const TYPE_LABEL: Record<GrowthMeasurementType, string> = {
  weight_kg: 'Weight',
  height_cm: 'Height',
  head_circumference_cm: 'Head circumference',
  bmi: 'BMI',
}

const TYPE_DEFAULT_UNIT: Record<GrowthMeasurementType, string> = {
  weight_kg: 'kg',
  height_cm: 'cm',
  head_circumference_cm: 'cm',
  bmi: 'kg/m²',
}

function useGrowthMeasurements(patientId: string) {
  return useQuery<{ items: GrowthMeasurementResponse[] }>({
    queryKey: growthKeys.list(patientId),
    queryFn: () =>
      apiClient.get<{ items: GrowthMeasurementResponse[] }>(
        `paediatrics/patients/${patientId}/growth`,
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useCreateGrowthMeasurement(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateGrowthMeasurementDTO) =>
      apiClient.post<GrowthMeasurementResponse>(
        `paediatrics/patients/${patientId}/growth`,
        dto,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: growthKeys.list(patientId) }),
  })
}

interface AddDialogProps { open: boolean; patientId: string; onClose: () => void }

function AddMeasurementDialog({ open, patientId, onClose }: AddDialogProps) {
  const [measurementType, setMeasurementType] = useState<GrowthMeasurementType>('weight_kg')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState(TYPE_DEFAULT_UNIT.weight_kg)
  const [ageDays, setAgeDays] = useState('')
  const [measuredAt, setMeasuredAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [note, setNote] = useState('')

  const createMut = useCreateGrowthMeasurement(patientId)

  const handleTypeChange = (t: GrowthMeasurementType) => {
    setMeasurementType(t)
    setUnit(TYPE_DEFAULT_UNIT[t])
  }

  const handleSubmit = async () => {
    const numericValue = parseFloat(value)
    const numericAge = parseInt(ageDays, 10)
    if (!Number.isFinite(numericValue) || !Number.isFinite(numericAge)) return
    const payload: CreateGrowthMeasurementDTO = CreateGrowthMeasurementSchema.parse({
      patientId,
      measurementType,
      value: numericValue,
      unit,
      ageAtMeasurementDays: numericAge,
      measuredAt: new Date(measuredAt).toISOString(),
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setValue('')
    setNote('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        Add Growth Measurement
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select value={measurementType} onChange={(e) => handleTypeChange(e.target.value as GrowthMeasurementType)} label="Type">
                {GrowthMeasurementTypeEnum.options.map((t) => (
                  <MenuItem key={t} value={t}>{TYPE_LABEL[t]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 8, sm: 4 }}>
            <TextField label="Value" type="number" fullWidth size="small" value={value} onChange={(e) => setValue(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 4, sm: 2 }}>
            <TextField label="Unit" fullWidth size="small" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Age at measurement (days)" type="number" fullWidth size="small" value={ageDays} onChange={(e) => setAgeDays(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Measured at" type="datetime-local" fullWidth size="small" value={measuredAt}
              onChange={(e) => setMeasuredAt(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={createMut.isPending || !value || !ageDays}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Measurement'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function GrowthChartTab({ patientId }: Props) {
  const { data, isLoading } = useGrowthMeasurements(patientId)
  const [addOpen, setAddOpen] = useState(false)

  const items = data?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          FHIR Observation-aligned per-encounter growth records. WHO 0–2y and CDC 2–20y reference
          tables drive the percentile column when populated by the server.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, flexShrink: 0 }}>
          Add Measurement
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                {['Measured', 'Type', 'Value', 'Age (days)', 'Percentile', 'Recorded by'].map((h) => (
                  <TableCell key={h} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12, color: '#3D484B', backgroundColor: '#FAFAFA' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={22} /></TableCell></TableRow>
              )}
              {!isLoading && items.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary">No growth measurements recorded.</Typography>
                </TableCell></TableRow>
              )}
              {items.map((m) => (
                <TableRow key={m.id} hover>
                  <TableCell>{new Date(m.measuredAt).toLocaleDateString('en-AU')}</TableCell>
                  <TableCell><Chip size="small" label={TYPE_LABEL[m.measurementType]} /></TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{m.value} <Typography component="span" variant="caption" color="text.secondary">{m.unit}</Typography></Typography>
                  </TableCell>
                  <TableCell>{m.ageAtMeasurementDays}</TableCell>
                  <TableCell>{m.percentile != null ? `${m.percentile}%` : '—'}</TableCell>
                  <TableCell>{m.recordedByName ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

      <AddMeasurementDialog open={addOpen} patientId={patientId} onClose={() => setAddOpen(false)} />
    </Box>
  )
}

export default GrowthChartTab
