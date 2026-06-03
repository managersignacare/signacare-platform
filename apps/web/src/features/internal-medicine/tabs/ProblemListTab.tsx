// apps/web/src/features/internal-medicine/tabs/ProblemListTab.tsx
//
// Multi-specialty Phase 3 — Internal Medicine: problem list tab.
//
// The problem list is a CORE patient surface (registered as
// specialty: 'core' in MODULE_REGISTRY) — every clinician sees it
// regardless of their specialty enrolment. An oncologist must see
// the patient's diabetes; a psychiatrist must see the cancer.
//
// Backed by GET/POST/PATCH /api/v1/internal-medicine/patients/:id/problems.
// Soft delete via DELETE /api/v1/internal-medicine/problems/:id.
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
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
  FormControlLabel,
  Grid,
  IconButton,
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
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  CreateProblemSchema,
  ClinicalStatusEnum,
  ProblemSeverityEnum,
  ProblemCodeSystemEnum,
  type ProblemListEntry,
  type CreateProblemDTO,
  type ClinicalStatus,
  type ProblemSeverity,
  type ProblemCodeSystem,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { internalMedicineKeys } from '../queryKeys'

interface Props { patientId: string }

// ── Hooks ─────────────────────────────────────────────────────────────────

function useProblemList(patientId: string, activeOnly: boolean) {
  return useQuery<{ items: ProblemListEntry[] }>({
    queryKey: internalMedicineKeys.problemListFiltered(patientId, { activeOnly }),
    queryFn: () =>
      apiClient.get<{ items: ProblemListEntry[] }>(
        `internal-medicine/patients/${patientId}/problems`,
        activeOnly ? { clinicalStatus: 'active' } : {},
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useCreateProblem(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateProblemDTO) =>
      apiClient.post<ProblemListEntry>(
        `internal-medicine/patients/${patientId}/problems`,
        dto,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: internalMedicineKeys.problemList(patientId) }),
  })
}

function useUpdateProblem(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateProblemDTO> }) =>
      apiClient.patch<ProblemListEntry>(`internal-medicine/problems/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: internalMedicineKeys.problemList(patientId) }),
  })
}

function useDeleteProblem(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`internal-medicine/problems/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: internalMedicineKeys.problemList(patientId) }),
  })
}

// ── Status / severity colour mapping ──────────────────────────────────────

const STATUS_COLOR: Record<ClinicalStatus, 'success' | 'info' | 'warning' | 'default'> = {
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

// ── Add / Edit dialog ─────────────────────────────────────────────────────

interface DialogProps {
  open: boolean
  patientId: string
  initial?: ProblemListEntry | null
  onClose: () => void
}

function ProblemDialog({ open, patientId, initial, onClose }: DialogProps) {
  const isEdit = !!initial
  const [code, setCode] = useState(initial?.code ?? '')
  const [display, setDisplay] = useState(initial?.display ?? '')
  const [codeSystem, setCodeSystem] = useState<ProblemCodeSystem>(initial?.codeSystem ?? 'snomed')
  const [clinicalStatus, setClinicalStatus] = useState<ClinicalStatus>(initial?.clinicalStatus ?? 'active')
  const [severity, setSeverity] = useState<ProblemSeverity | ''>(initial?.severity ?? '')
  const [isChronic, setIsChronic] = useState<boolean>(initial?.isChronic ?? false)
  const [onsetDate, setOnsetDate] = useState<string>(initial?.onsetDate ?? '')
  const [note, setNote] = useState<string>(initial?.note ?? '')

  const createMut = useCreateProblem(patientId)
  const updateMut = useUpdateProblem(patientId)
  const isPending = createMut.isPending || updateMut.isPending

  const handleSubmit = async () => {
    const payload: CreateProblemDTO = CreateProblemSchema.parse({
      patientId,
      code: code.trim(),
      display: display.trim(),
      codeSystem,
      clinicalStatus,
      severity: severity || null,
      isChronic,
      onsetDate: onsetDate || null,
      note: note.trim() || null,
    })
    if (isEdit && initial) {
      await updateMut.mutateAsync({ id: initial.id, patch: payload })
    } else {
      await createMut.mutateAsync(payload)
    }
    onClose()
  }

  const canSave = code.trim().length > 0 && display.trim().length > 0

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        {isEdit ? 'Edit Problem' : 'Add Problem'}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Code system</InputLabel>
              <Select value={codeSystem} onChange={e => setCodeSystem(e.target.value as ProblemCodeSystem)} label="Code system">
                {ProblemCodeSystemEnum.options.map(c => <MenuItem key={c} value={c}>{c.toUpperCase()}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Code" fullWidth size="small" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. E11.9 or 44054006" />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Display" fullWidth size="small" value={display} onChange={e => setDisplay(e.target.value)}
              placeholder="e.g. Type 2 diabetes mellitus without complications" />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={clinicalStatus} onChange={e => setClinicalStatus(e.target.value as ClinicalStatus)} label="Status">
                {ClinicalStatusEnum.options.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Severity</InputLabel>
              <Select value={severity} onChange={e => setSeverity(e.target.value as ProblemSeverity | '')} label="Severity">
                <MenuItem value=""><em>Unspecified</em></MenuItem>
                {ProblemSeverityEnum.options.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Onset date" type="date" fullWidth size="small" value={onsetDate}
              onChange={e => setOnsetDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              control={<Switch checked={isChronic} onChange={e => setIsChronic(e.target.checked)} />}
              label="Chronic problem (always shown at top of list)"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={3} value={note} onChange={e => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSave || isPending}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : isEdit ? 'Save' : 'Add Problem'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Tab body ──────────────────────────────────────────────────────────────

export function ProblemListTab({ patientId }: Props) {
  const [activeOnly, setActiveOnly] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProblemListEntry | null>(null)

  const { data, isLoading, isError } = useProblemList(patientId, activeOnly)
  const deleteMut = useDeleteProblem(patientId)

  const items = data?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">Problem List</Typography>
          <Typography variant="caption" color="text.secondary">
            FHIR Condition-aligned. Visible to every clinician on this chart regardless of specialty.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <FormControlLabel
            control={<Switch checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />}
            label="Active only"
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditing(null); setDialogOpen(true) }}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            Add Problem
          </Button>
        </Box>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Problem', 'Code', 'Status', 'Severity', 'Onset', 'Recorded by', ''].map(h => (
                <TableCell key={h} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12, color: '#3D484B', backgroundColor: '#FAFAFA' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={22} /></TableCell></TableRow>
            )}
            {isError && (
              <TableRow><TableCell colSpan={7} align="center">
                <Typography variant="body2" color="error">Failed to load problem list.</Typography>
              </TableCell></TableRow>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <TableRow><TableCell colSpan={7} align="center">
                <Typography variant="body2" color="text.secondary">No problems recorded.</Typography>
              </TableCell></TableRow>
            )}
            {items.map(p => (
              <TableRow key={p.id} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {p.isChronic && <Chip label="chronic" size="small" color="primary" sx={{ height: 18, fontSize: 10 }} />}
                    <Typography variant="body2" fontWeight={500}>{p.display}</Typography>
                  </Box>
                  {p.note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{p.note}</Typography>}
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{p.codeSystem.toUpperCase()}: {p.code}</TableCell>
                <TableCell><Chip label={p.clinicalStatus} size="small" color={STATUS_COLOR[p.clinicalStatus]} /></TableCell>
                <TableCell>
                  {p.severity ? <Chip label={p.severity} size="small" color={SEVERITY_COLOR[p.severity]} /> : <Typography variant="caption" color="text.secondary">—</Typography>}
                </TableCell>
                <TableCell>{p.onsetDate ?? '—'}</TableCell>
                <TableCell>
                  <Typography variant="caption">{p.recordedByName ?? '—'}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {new Date(p.recordedDate).toLocaleDateString('en-AU')}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Tooltip title="Edit"><IconButton size="small" onClick={() => { setEditing(p); setDialogOpen(true) }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Remove"><IconButton size="small" onClick={() => deleteMut.mutate(p.id)} disabled={deleteMut.isPending}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <ProblemDialog
        open={dialogOpen}
        patientId={patientId}
        initial={editing}
        onClose={() => { setDialogOpen(false); setEditing(null) }}
      />
    </Box>
  )
}

export default ProblemListTab
