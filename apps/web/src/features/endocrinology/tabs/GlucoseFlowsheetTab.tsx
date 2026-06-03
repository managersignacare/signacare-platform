// apps/web/src/features/endocrinology/tabs/GlucoseFlowsheetTab.tsx
//
// Multi-specialty Phase 4 — Endocrinology: Glucose Flowsheet tab.
//
// Specialty-gated (visible only when the clinic + clinician are both
// enrolled in endocrinology and the patient has an open endo episode).
// Three surfaces in one tab:
//   1. Time-In-Range summary cards (ATTD bands, mmol/L)
//   2. Add Reading dialog (value + unit + source + meal context)
//   3. Reading history table (most recent 200, filterable by source)
//
// A "Write Note" button in the header opens the standard AddNoteDialog
// pre-filled with an Endocrine review header so clinicians can record
// their reasoning alongside the data.
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  CreateGlucoseReadingSchema,
  GlucoseSourceEnum,
  GlucoseUnitEnum,
  GlucoseMealContextEnum,
  type CreateGlucoseReadingDTO,
  type GlucoseReadingResponse,
  type GlucoseSource,
  type GlucoseUnit,
  type GlucoseMealContext,
  type TimeInRangeSummary,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { SpecialtyMdtBanner } from '../../../shared/components/specialty/SpecialtyMdtBanner'
import { SpecialtyNotesPanel } from '../../../shared/components/specialty/SpecialtyNotesPanel'

interface Props { patientId: string }

import { glucoseKeys } from '../queryKeys'

// ── Hooks ─────────────────────────────────────────────────────────────────

function useGlucoseReadings(patientId: string) {
  return useQuery<{ items: GlucoseReadingResponse[] }>({
    queryKey: glucoseKeys.list(patientId),
    queryFn: () =>
      apiClient.get<{ items: GlucoseReadingResponse[] }>(
        `endocrinology/patients/${patientId}/glucose`,
        { limit: 200 },
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useTimeInRange(patientId: string) {
  return useQuery<TimeInRangeSummary>({
    queryKey: glucoseKeys.tir(patientId),
    queryFn: () =>
      apiClient.get<TimeInRangeSummary>(
        `endocrinology/patients/${patientId}/glucose/time-in-range`,
        { limit: 1000 },
      ),
    staleTime: 60_000,
    enabled: !!patientId,
  })
}

function useCreateGlucoseReading(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateGlucoseReadingDTO) =>
      apiClient.post<GlucoseReadingResponse>(
        `endocrinology/patients/${patientId}/glucose`,
        dto,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: glucoseKeys.list(patientId) })
      qc.invalidateQueries({ queryKey: glucoseKeys.tir(patientId) })
    },
  })
}

// ── Display constants ─────────────────────────────────────────────────────

const SOURCE_LABEL: Record<GlucoseSource, string> = {
  cgm: 'CGM',
  fingerstick: 'Fingerstick',
  lab: 'Lab',
  manual: 'Manual',
}

const MEAL_CONTEXT_LABEL: Record<GlucoseMealContext, string> = {
  fasting: 'Fasting',
  pre_meal: 'Pre-meal',
  post_meal_1h: 'Post-meal (1h)',
  post_meal_2h: 'Post-meal (2h)',
  bedtime: 'Bedtime',
  random: 'Random',
  overnight: 'Overnight',
}

// ── Add Reading dialog ────────────────────────────────────────────────────

interface AddDialogProps {
  open: boolean
  patientId: string
  onClose: () => void
}

function AddReadingDialog({ open, patientId, onClose }: AddDialogProps) {
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState<GlucoseUnit>('mmol/L')
  const [source, setSource] = useState<GlucoseSource>('fingerstick')
  const [mealContext, setMealContext] = useState<GlucoseMealContext | ''>('')
  const [measuredAt, setMeasuredAt] = useState<string>(() => new Date().toISOString().slice(0, 16))
  const [note, setNote] = useState('')

  const createMut = useCreateGlucoseReading(patientId)

  const handleSubmit = async () => {
    const numeric = parseFloat(value)
    if (!Number.isFinite(numeric)) return
    const payload: CreateGlucoseReadingDTO = CreateGlucoseReadingSchema.parse({
      patientId,
      value: numeric,
      unit,
      source,
      mealContext: mealContext || null,
      measuredAt: new Date(measuredAt).toISOString(),
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setValue('')
    setNote('')
    setMealContext('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        Add Glucose Reading
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 6, sm: 4 }}>
            <TextField label="Value" type="number" fullWidth size="small" value={value} onChange={(e) => setValue(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Unit</InputLabel>
              <Select value={unit} onChange={(e) => setUnit(e.target.value as GlucoseUnit)} label="Unit">
                {GlucoseUnitEnum.options.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Source</InputLabel>
              <Select value={source} onChange={(e) => setSource(e.target.value as GlucoseSource)} label="Source">
                {GlucoseSourceEnum.options.map((s) => <MenuItem key={s} value={s}>{SOURCE_LABEL[s]}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Meal context</InputLabel>
              <Select value={mealContext} onChange={(e) => setMealContext(e.target.value as GlucoseMealContext | '')} label="Meal context">
                <MenuItem value=""><em>Unspecified</em></MenuItem>
                {GlucoseMealContextEnum.options.map((m) => <MenuItem key={m} value={m}>{MEAL_CONTEXT_LABEL[m]}</MenuItem>)}
              </Select>
            </FormControl>
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
        <Button variant="contained" onClick={handleSubmit} disabled={createMut.isPending || !value.trim()}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Reading'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── TIR summary cards ─────────────────────────────────────────────────────

function TirCards({ tir }: { tir?: TimeInRangeSummary }) {
  const cards: Array<{ label: string; value: number; pct: number; color: string }> = tir
    ? [
        { label: 'Very Low (<3.0)', value: tir.veryLow, pct: tir.veryLowPct, color: '#D32F2F' },
        { label: 'Low (3.0–3.8)',   value: tir.low,      pct: tir.lowPct,    color: '#ED6C02' },
        { label: 'In Range (3.9–10)',  value: tir.inRange, pct: tir.inRangePct, color: '#2E7D32' },
        { label: 'High (10.1–13.9)',   value: tir.high,    pct: tir.highPct,    color: '#ED6C02' },
        { label: 'Very High (>13.9)',  value: tir.veryHigh, pct: tir.veryHighPct, color: '#D32F2F' },
      ]
    : []

  return (
    <Grid container spacing={2}>
      {!tir ? (
        <Grid size={{ xs: 12 }}>
          <Card variant="outlined"><CardContent><Typography variant="body2" color="text.secondary">Loading TIR…</Typography></CardContent></Card>
        </Grid>
      ) : (
        <>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <Card variant="outlined">
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">Mean glucose</Typography>
                <Typography variant="h5" fontWeight={700} sx={{ color: '#1976D2' }}>
                  {tir.meanGlucose !== null ? `${tir.meanGlucose}` : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">mmol/L · {tir.totalReadings} readings</Typography>
              </CardContent>
            </Card>
          </Grid>
          {cards.map((c) => (
            <Grid size={{ xs: 6, sm: 4, md: 2 }} key={c.label}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">{c.label}</Typography>
                  <Typography variant="h5" fontWeight={700} sx={{ color: c.color }}>
                    {c.pct.toFixed(1)}%
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{c.value} readings</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </>
      )}
    </Grid>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────

type GlucoseSubTab = 'flowsheet' | 'notes'

export function GlucoseFlowsheetTab({ patientId }: Props) {
  const { data: list, isLoading } = useGlucoseReadings(patientId)
  const { data: tir } = useTimeInRange(patientId)
  const [addOpen, setAddOpen] = useState(false)
  const [subTab, setSubTab] = useState<GlucoseSubTab>('flowsheet')

  const items = list?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">Endocrinology</Typography>
          <Typography variant="caption" color="text.secondary">
            Glucose flowsheet and clinical notes. Time-In-Range bands per ATTD 2019 consensus. Add
            fingerstick or CGM readings; lab results also flow in via the pathology integration.
          </Typography>
        </Box>
        {subTab === 'flowsheet' && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, flexShrink: 0 }}>
            Add Reading
          </Button>
        )}
      </Box>

      <SpecialtyMdtBanner patientId={patientId} specialty="endocrinology" specialtyLabel="Endocrinology" />

      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v as GlucoseSubTab)}
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}
      >
        <Tab label="Flowsheet" value="flowsheet" />
        <Tab label="Clinical Notes" value="notes" />
      </Tabs>

      {subTab === 'notes' && (
        <SpecialtyNotesPanel patientId={patientId} specialtyLabel="Endocrinology" />
      )}

      {subTab === 'flowsheet' && (
      <>
      <Box sx={{ mb: 2 }}>
        <TirCards tir={tir} />
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Measured', 'Value', 'Source', 'Meal context', 'Recorded by', 'Note'].map((h) => (
                <TableCell key={h} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12, color: '#3D484B', backgroundColor: '#FAFAFA' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={22} /></TableCell></TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary">No glucose readings recorded.</Typography>
                </TableCell>
              </TableRow>
            )}
            {items.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{new Date(r.measuredAt).toLocaleString('en-AU')}</TableCell>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{r.value} <Typography component="span" variant="caption" color="text.secondary">{r.unit}</Typography></Typography>
                </TableCell>
                <TableCell><Chip size="small" label={SOURCE_LABEL[r.source]} /></TableCell>
                <TableCell>{r.mealContext ? MEAL_CONTEXT_LABEL[r.mealContext] : '—'}</TableCell>
                <TableCell>{r.recordedByName ?? '—'}</TableCell>
                <TableCell sx={{ maxWidth: 300 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.note ?? ''}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      </>
      )}

      <AddReadingDialog open={addOpen} patientId={patientId} onClose={() => setAddOpen(false)} />
    </Box>
  )
}

export default GlucoseFlowsheetTab
