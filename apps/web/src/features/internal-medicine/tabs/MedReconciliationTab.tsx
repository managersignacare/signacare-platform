// apps/web/src/features/internal-medicine/tabs/MedReconciliationTab.tsx
//
// Multi-specialty Phase 3 — Internal Medicine: medication reconciliation tab.
//
// Two surfaces in one tab:
//
//   1. History list — every previously recorded reconciliation, with
//      its context (admission / discharge / etc), performer, and the
//      five disposition counts pre-computed at write time.
//
//   2. New reconciliation wizard — pulls the patient's active
//      medications via the existing GET /patients/:id/medications
//      endpoint, lets the clinician mark each one's disposition
//      (continued / ceased / modified / on-hold), add free-text "new"
//      medications, and submit a snapshot to
//      POST /internal-medicine/patients/:id/med-reconciliations.
//
// The snapshot is what's persisted, not a join into patient_medications
// at historic time points. That gives a legally replayable record even
// if the underlying medication rows are later edited.
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import HistoryIcon from '@mui/icons-material/History'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
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
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  CreateMedRecSchema,
  MedRecContextEnum,
  MedRecDispositionEnum,
  type CreateMedRecDTO,
  type MedRecContext,
  type MedRecDisposition,
  type MedRecResponse,
  type MedRecSnapshotItem,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { internalMedicineKeys } from '../queryKeys'

interface Props { patientId: string }

// ── Hooks ─────────────────────────────────────────────────────────────────

interface ActiveMedication {
  id: string
  drugLabel: string
  medicationName?: string
  dose: string
  frequency: string
  status: string
}

function useMedRecHistory(patientId: string) {
  return useQuery<{ items: MedRecResponse[] }>({
    queryKey: internalMedicineKeys.medRecList(patientId),
    queryFn: () =>
      apiClient.get<{ items: MedRecResponse[] }>(
        `internal-medicine/patients/${patientId}/med-reconciliations`,
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useActiveMedications(patientId: string, enabled: boolean) {
  return useQuery<ActiveMedication[]>({
    queryKey: internalMedicineKeys.medicationsActiveForMedRec(patientId),
    queryFn: async () => {
      const res = await apiClient.get<ActiveMedication[] | { items: ActiveMedication[] }>(
        `patients/${patientId}/medications`,
        { status: 'active' },
      )
      // The medications endpoint historically returns a bare array; tolerate both shapes.
      if (Array.isArray(res)) return res
      return res.items ?? []
    },
    enabled,
    staleTime: 10_000,
  })
}

function useCreateMedRec(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateMedRecDTO) =>
      apiClient.post<MedRecResponse>(
        `internal-medicine/patients/${patientId}/med-reconciliations`,
        dto,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: internalMedicineKeys.medRecList(patientId) }),
  })
}

// ── Display constants ─────────────────────────────────────────────────────

const CONTEXT_LABEL: Record<MedRecContext, string> = {
  admission: 'Admission',
  discharge: 'Discharge',
  transfer: 'Transfer',
  outpatient: 'Outpatient',
  'periodic-review': 'Periodic Review',
}

const DISPOSITION_LABEL: Record<MedRecDisposition, string> = {
  continued: 'Continued',
  ceased: 'Ceased',
  modified: 'Modified',
  new: 'New',
  'on-hold': 'On hold',
}

// ── Create dialog ─────────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean
  patientId: string
  onClose: () => void
}

interface DraftItem extends MedRecSnapshotItem {
  rowKey: string
}

function nextRowKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

function CreateMedRecDialog({ open, patientId, onClose }: CreateDialogProps) {
  const [context, setContext] = useState<MedRecContext>('admission')
  const [summaryNotes, setSummaryNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])

  const { data: activeMeds, isLoading: medsLoading } = useActiveMedications(patientId, open)
  const createMut = useCreateMedRec(patientId)

  // Seed the draft list from active medications when the dialog opens.
  useEffect(() => {
    if (!open) return
    if (!activeMeds) return
    setItems(
      activeMeds.map((m) => ({
        rowKey: nextRowKey(),
        medicationId: m.id,
        drugLabel: m.drugLabel ?? m.medicationName ?? 'Unknown',
        dose: m.dose,
        frequency: m.frequency,
        disposition: 'continued',
        notes: null,
      })),
    )
  }, [open, activeMeds])

  const handleClose = () => {
    setContext('admission')
    setSummaryNotes('')
    setItems([])
    onClose()
  }

  const updateItem = (rowKey: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it) => (it.rowKey === rowKey ? { ...it, ...patch } : it)))
  }

  const removeItem = (rowKey: string) => {
    setItems((prev) => prev.filter((it) => it.rowKey !== rowKey))
  }

  const addBlankItem = () => {
    setItems((prev) => [
      ...prev,
      {
        rowKey: nextRowKey(),
        medicationId: null,
        drugLabel: '',
        dose: '',
        frequency: '',
        disposition: 'new',
        notes: null,
      },
    ])
  }

  const handleSubmit = async () => {
    const snapshot: MedRecSnapshotItem[] = items
      .filter((it) => it.drugLabel.trim().length > 0)
      .map((it) => ({
        medicationId: it.medicationId ?? null,
        drugLabel: it.drugLabel.trim(),
        dose: it.dose?.trim() || null,
        frequency: it.frequency?.trim() || null,
        disposition: it.disposition,
        notes: it.notes?.trim() || null,
      }))

    const payload: CreateMedRecDTO = CreateMedRecSchema.parse({
      patientId,
      context,
      snapshot,
      summaryNotes: summaryNotes.trim() || null,
    })

    await createMut.mutateAsync(payload)
    handleClose()
  }

  const counts = useMemo(() => {
    const c = { continued: 0, ceased: 0, modified: 0, new: 0, onHold: 0 }
    for (const it of items) {
      if (it.drugLabel.trim().length === 0) continue
      switch (it.disposition) {
        case 'continued': c.continued++; break
        case 'ceased':    c.ceased++;    break
        case 'modified':  c.modified++;  break
        case 'new':       c.new++;       break
        case 'on-hold':   c.onHold++;    break
      }
    }
    return c
  }, [items])

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        New Medication Reconciliation
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Context</InputLabel>
              <Select value={context} onChange={(e) => setContext(e.target.value as MedRecContext)} label="Context">
                {MedRecContextEnum.options.map((c) => (
                  <MenuItem key={c} value={c}>{CONTEXT_LABEL[c]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 8 }}>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center', height: '100%' }}>
              <Chip size="small" color="success" label={`${counts.continued} continued`} />
              <Chip size="small" color="error"   label={`${counts.ceased} ceased`} />
              <Chip size="small" color="warning" label={`${counts.modified} modified`} />
              <Chip size="small" color="info"    label={`${counts.new} new`} />
              <Chip size="small"                 label={`${counts.onHold} on hold`} />
            </Box>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Typography variant="caption" color="text.secondary">
              Active medications are pre-populated. Mark each one with a disposition and add any new
              medications below. The snapshot is what's persisted — historic replay does not depend on
              future edits to the medication list.
            </Typography>
          </Grid>

          <Grid size={{ xs: 12 }}>
            {medsLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={22} />
              </Box>
            )}

            {!medsLoading && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {['Medication', 'Dose', 'Frequency', 'Disposition', 'Notes', ''].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 600, fontSize: 11 }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          <Typography variant="body2" color="text.secondary">
                            No active medications. Use "Add medication" below to record new entries.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {items.map((it) => (
                      <TableRow key={it.rowKey}>
                        <TableCell sx={{ minWidth: 220 }}>
                          <TextField
                            size="small"
                            fullWidth
                            value={it.drugLabel}
                            onChange={(e) => updateItem(it.rowKey, { drugLabel: e.target.value })}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 100 }}>
                          <TextField
                            size="small"
                            fullWidth
                            value={it.dose ?? ''}
                            onChange={(e) => updateItem(it.rowKey, { dose: e.target.value })}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 100 }}>
                          <TextField
                            size="small"
                            fullWidth
                            value={it.frequency ?? ''}
                            onChange={(e) => updateItem(it.rowKey, { frequency: e.target.value })}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 130 }}>
                          <FormControl fullWidth size="small">
                            <Select
                              value={it.disposition}
                              onChange={(e) => updateItem(it.rowKey, { disposition: e.target.value as MedRecDisposition })}
                            >
                              {MedRecDispositionEnum.options.map((d) => (
                                <MenuItem key={d} value={d}>{DISPOSITION_LABEL[d]}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell sx={{ minWidth: 200 }}>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="Optional"
                            value={it.notes ?? ''}
                            onChange={(e) => updateItem(it.rowKey, { notes: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => removeItem(it.rowKey)} aria-label="Remove row">
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Button startIcon={<AddIcon />} onClick={addBlankItem} size="small">
              Add medication
            </Button>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <TextField
              label="Summary notes"
              fullWidth
              size="small"
              multiline
              rows={3}
              value={summaryNotes}
              onChange={(e) => setSummaryNotes(e.target.value)}
              placeholder="Clinical reasoning, allergy reconciliation, follow-up plan…"
            />
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={createMut.isPending || items.filter((it) => it.drugLabel.trim().length > 0).length === 0}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Save Reconciliation'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Tab body ──────────────────────────────────────────────────────────────

export function MedReconciliationTab({ patientId }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data, isLoading, isError } = useMedRecHistory(patientId)
  const items = data?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Medication Reconciliation
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Snapshot-based med rec. Each entry captures the medication list at the moment of review
            so historic replay never depends on future edits.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PlaylistAddCheckIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          New Reconciliation
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Performed', 'Context', 'Performer', 'Continued', 'Ceased', 'Modified', 'New', 'On hold', 'Summary'].map((h) => (
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
                <TableCell colSpan={9} align="center">
                  <CircularProgress size={22} />
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography variant="body2" color="error">Failed to load reconciliations.</Typography>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, py: 2 }}>
                    <HistoryIcon sx={{ color: '#999' }} />
                    <Typography variant="body2" color="text.secondary">
                      No reconciliations recorded yet.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
            {items.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>{new Date(r.performedAt).toLocaleString('en-AU')}</TableCell>
                <TableCell>
                  <Chip size="small" label={CONTEXT_LABEL[r.context]} />
                </TableCell>
                <TableCell>{r.performedByName ?? '—'}</TableCell>
                <TableCell>
                  <Chip size="small" color="success" label={r.continuedCount} />
                </TableCell>
                <TableCell>
                  <Chip size="small" color="error" label={r.ceasedCount} />
                </TableCell>
                <TableCell>
                  <Chip size="small" color="warning" label={r.modifiedCount} />
                </TableCell>
                <TableCell>
                  <Chip size="small" color="info" label={r.newCount} />
                </TableCell>
                <TableCell>
                  <Chip size="small" label={r.onHoldCount} />
                </TableCell>
                <TableCell sx={{ maxWidth: 280 }}>
                  <Tooltip title={r.summaryNotes ?? ''}>
                    <Typography
                      variant="body2"
                      sx={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: 'text.secondary',
                      }}
                    >
                      {r.summaryNotes ?? '—'}
                    </Typography>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <CreateMedRecDialog open={dialogOpen} patientId={patientId} onClose={() => setDialogOpen(false)} />
    </Box>
  )
}

export default MedReconciliationTab
