// apps/web/src/features/endocrinology/tabs/InsulinRegimenTab.tsx
//
// Multi-specialty Phase 4 — Endocrinology: Insulin Regimen tab.
//
// Versioned regimen state. Shows the current regimen at the top and a
// history table beneath it. The "New Version" button opens a dialog
// that captures basal + bolus + sliding-scale parameters; on save the
// server marks the previous current row as ended and inserts the new
// one in a single transaction.
//
// Note writing for endocrinology lives on the Glucose Flowsheet tab
// (Clinical Notes sub-tab) so all clinical notes for the specialty
// are in one place. This tab focuses purely on the regimen state.
import HistoryIcon from '@mui/icons-material/History'
import PostAddIcon from '@mui/icons-material/PostAdd'
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
  Divider,
  Grid,
  Paper,
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
  CreateInsulinRegimenSchema,
  type CreateInsulinRegimenDTO,
  type InsulinRegimenResponse,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'

import { insulinKeys } from '../queryKeys'

interface Props { patientId: string }

function useInsulinHistory(patientId: string) {
  return useQuery<{ items: InsulinRegimenResponse[] }>({
    queryKey: insulinKeys.history(patientId),
    queryFn: () =>
      apiClient.get<{ items: InsulinRegimenResponse[] }>(
        `endocrinology/patients/${patientId}/insulin-regimens`,
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useCurrentRegimen(patientId: string) {
  return useQuery<{ current: InsulinRegimenResponse | null }>({
    queryKey: insulinKeys.current(patientId),
    queryFn: () =>
      apiClient.get<{ current: InsulinRegimenResponse | null }>(
        `endocrinology/patients/${patientId}/insulin-regimens/current`,
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useCreateRegimen(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateInsulinRegimenDTO) =>
      apiClient.post<InsulinRegimenResponse>(
        `endocrinology/patients/${patientId}/insulin-regimens`,
        dto,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: insulinKeys.history(patientId) })
      qc.invalidateQueries({ queryKey: insulinKeys.current(patientId) })
    },
  })
}

// ── New Version dialog ────────────────────────────────────────────────────

function NewRegimenDialog({
  open, patientId, seed, onClose,
}: { open: boolean; patientId: string; seed?: InsulinRegimenResponse | null; onClose: () => void }) {
  const [basalDrug, setBasalDrug] = useState(seed?.basalDrug ?? '')
  const [basalDose, setBasalDose] = useState(seed?.basalDoseUnits != null ? String(seed.basalDoseUnits) : '')
  const [basalFreq, setBasalFreq] = useState(seed?.basalFrequency ?? 'daily')
  const [bolusDrug, setBolusDrug] = useState(seed?.bolusDrug ?? '')
  const [bf, setBf] = useState(seed?.bolusDoses?.breakfast != null ? String(seed.bolusDoses.breakfast) : '')
  const [lu, setLu] = useState(seed?.bolusDoses?.lunch != null ? String(seed.bolusDoses.lunch) : '')
  const [di, setDi] = useState(seed?.bolusDoses?.dinner != null ? String(seed.bolusDoses.dinner) : '')
  const [bt, setBt] = useState(seed?.bolusDoses?.bedtime != null ? String(seed.bolusDoses.bedtime) : '')
  const [cf, setCf] = useState(seed?.correctionFactor != null ? String(seed.correctionFactor) : '')
  const [cr, setCr] = useState(seed?.carbRatio != null ? String(seed.carbRatio) : '')
  const [tlow, setTlow] = useState(seed?.targetLow != null ? String(seed.targetLow) : '')
  const [thigh, setThigh] = useState(seed?.targetHigh != null ? String(seed.targetHigh) : '')
  const [note, setNote] = useState('')

  const createMut = useCreateRegimen(patientId)

  const numOrNull = (s: string): number | null => {
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }

  const handleSubmit = async () => {
    const payload: CreateInsulinRegimenDTO = CreateInsulinRegimenSchema.parse({
      patientId,
      basalDrug: basalDrug.trim() || null,
      basalDoseUnits: numOrNull(basalDose),
      basalFrequency: basalFreq.trim() || null,
      bolusDrug: bolusDrug.trim() || null,
      bolusDoses: {
        breakfast: numOrNull(bf),
        lunch: numOrNull(lu),
        dinner: numOrNull(di),
        bedtime: numOrNull(bt),
      },
      correctionFactor: numOrNull(cf),
      carbRatio: numOrNull(cr),
      targetLow: numOrNull(tlow),
      targetHigh: numOrNull(thigh),
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        New Insulin Regimen
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Saving creates a new version. Any current regimen is automatically marked as ended at the
          moment of save.
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <Typography variant="overline" sx={{ fontSize: 10 }}>Basal (long-acting)</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Drug" fullWidth size="small" value={basalDrug} onChange={(e) => setBasalDrug(e.target.value)} placeholder="e.g. glargine 100" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Dose (units)" type="number" fullWidth size="small" value={basalDose} onChange={(e) => setBasalDose(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Frequency" fullWidth size="small" value={basalFreq} onChange={(e) => setBasalFreq(e.target.value)} placeholder="daily / BD" />
          </Grid>

          <Grid size={{ xs: 12 }}><Divider sx={{ my: 1 }} /></Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="overline" sx={{ fontSize: 10 }}>Bolus (rapid-acting)</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Drug" fullWidth size="small" value={bolusDrug} onChange={(e) => setBolusDrug(e.target.value)} placeholder="e.g. aspart" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Breakfast (units)" type="number" fullWidth size="small" value={bf} onChange={(e) => setBf(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Lunch (units)" type="number" fullWidth size="small" value={lu} onChange={(e) => setLu(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Dinner (units)" type="number" fullWidth size="small" value={di} onChange={(e) => setDi(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Bedtime (units)" type="number" fullWidth size="small" value={bt} onChange={(e) => setBt(e.target.value)} />
          </Grid>

          <Grid size={{ xs: 12 }}><Divider sx={{ my: 1 }} /></Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="overline" sx={{ fontSize: 10 }}>Sliding scale</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Correction factor" type="number" fullWidth size="small" value={cf} onChange={(e) => setCf(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Carb ratio (g/U)" type="number" fullWidth size="small" value={cr} onChange={(e) => setCr(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Target low (mmol/L)" type="number" fullWidth size="small" value={tlow} onChange={(e) => setTlow(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Target high (mmol/L)" type="number" fullWidth size="small" value={thigh} onChange={(e) => setThigh(e.target.value)} />
          </Grid>

          <Grid size={{ xs: 12 }}><Divider sx={{ my: 1 }} /></Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={createMut.isPending}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Regimen'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Current regimen card ──────────────────────────────────────────────────

function CurrentRegimenCard({ current }: { current: InsulinRegimenResponse | null | undefined }) {
  if (!current) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="body2" color="text.secondary">No active insulin regimen on file.</Typography>
        </CardContent>
      </Card>
    )
  }
  const bd = current.bolusDoses ?? {}
  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Chip label="Current" size="small" color="primary" />
          <Typography variant="caption" color="text.secondary">
            Active since {new Date(current.validFrom).toLocaleDateString('en-AU')} · prescribed by {current.prescribedByName ?? '—'}
          </Typography>
        </Box>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary">Basal</Typography>
            <Typography variant="body2" fontWeight={600}>
              {current.basalDrug ?? '—'} {current.basalDoseUnits != null ? `${current.basalDoseUnits} U` : ''}
              {current.basalFrequency ? ` · ${current.basalFrequency}` : ''}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary">Bolus</Typography>
            <Typography variant="body2" fontWeight={600}>
              {current.bolusDrug ?? '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              B: {bd.breakfast ?? '—'} · L: {bd.lunch ?? '—'} · D: {bd.dinner ?? '—'}{bd.bedtime != null ? ` · BT: ${bd.bedtime}` : ''}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Correction</Typography>
            <Typography variant="body2">{current.correctionFactor ?? '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Carb ratio</Typography>
            <Typography variant="body2">{current.carbRatio ?? '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Target low</Typography>
            <Typography variant="body2">{current.targetLow ?? '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Target high</Typography>
            <Typography variant="body2">{current.targetHigh ?? '—'}</Typography>
          </Grid>
          {current.note && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" color="text.secondary">{current.note}</Typography>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────

export function InsulinRegimenTab({ patientId }: Props) {
  const { data: cur } = useCurrentRegimen(patientId)
  const { data: history, isLoading } = useInsulinHistory(patientId)
  const [newOpen, setNewOpen] = useState(false)

  const items = history?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">Insulin Regimen</Typography>
          <Typography variant="caption" color="text.secondary">
            Versioned regimen state. Saving a new version automatically ends the previous one and
            adds a corresponding row to the patient's current medications.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<PostAddIcon />} onClick={() => setNewOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, flexShrink: 0 }}>
          New Version
        </Button>
      </Box>

      <Box sx={{ mb: 2 }}>
        <CurrentRegimenCard current={cur?.current} />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <HistoryIcon sx={{ color: '#999', fontSize: 18 }} />
        <Typography variant="overline" sx={{ fontSize: 10 }}>Version history</Typography>
      </Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Valid from', 'Valid to', 'Basal', 'Bolus', 'Targets', 'Prescribed by'].map((h) => (
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
                  <Typography variant="body2" color="text.secondary">No regimen history yet.</Typography>
                </TableCell>
              </TableRow>
            )}
            {items.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{new Date(r.validFrom).toLocaleDateString('en-AU')}</TableCell>
                <TableCell>{r.validTo ? new Date(r.validTo).toLocaleDateString('en-AU') : <Chip label="current" size="small" color="primary" />}</TableCell>
                <TableCell>
                  <Typography variant="caption">{r.basalDrug ?? '—'} {r.basalDoseUnits != null ? `${r.basalDoseUnits} U` : ''}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{r.bolusDrug ?? '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{r.targetLow ?? '—'}–{r.targetHigh ?? '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption">{r.prescribedByName ?? '—'}</Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <NewRegimenDialog open={newOpen} patientId={patientId} seed={cur?.current ?? null} onClose={() => setNewOpen(false)} />
    </Box>
  )
}

export default InsulinRegimenTab
