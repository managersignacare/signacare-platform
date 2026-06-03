// apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx
//
// Referral Out (outbound referrals).
//
// This surface is intentionally separated from Mental Health Intake:
// - Intake (/referrals) owns all inbound referral processing.
// - Referral Out (/referrals/queue) owns outbound referrals only.
import AddIcon from '@mui/icons-material/Add'
import AssignmentIcon from '@mui/icons-material/Assignment'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CommentIcon from '@mui/icons-material/Comment'
import DoNotDisturbIcon from '@mui/icons-material/DoNotDisturb'
import GavelIcon from '@mui/icons-material/Gavel'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
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
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ALL_SPECIALTIES, SPECIALTY_DISPLAY, type SpecialtyType } from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { referralKeys, referralsCrossFeatureKeys } from '../queryKeys'
import { CreateReferralOutDialog } from './CreateReferralOutDialog'

// ── Types ──────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string
  referralNumber: string
  referralDate: string
  urgency: string
  status: string
  reason: string
  patientId: string | null
  patientGivenName?: string | null
  patientFamilyName?: string | null
  targetSpecialty: SpecialtyType | null
  serviceRequestStatus: string | null
  taskStatus: string | null
  coordinatorId: string | null
  coordinatorName: string | null
  triagedAt: string | null
}

interface StaffLookupRow {
  id: string
  givenName: string
  familyName: string
  email: string
  role: string
}

// ── Hooks ──────────────────────────────────────────────────────────────────

function useCoordinatorQueue(filters: {
  specialty?: SpecialtyType
  taskStatus?: string
  direction?: 'intake' | 'outbound'
  mineOnly?: boolean
  page?: number
  pageSize?: number
}) {
  return useQuery({
    queryKey: referralKeys.coordinatorQueueList(filters as Record<string, unknown>),
    queryFn: () =>
      apiClient.get<{ items: QueueItem[]; total: number }>('referrals/queue', filters as Record<string, unknown>),
    staleTime: 10_000,
  })
}

function useTriage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.post<QueueItem>(`referrals/${id}/triage`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.coordinatorQueueAll }),
  })
}

function useAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, assignedToStaffId, reason }: { id: string; assignedToStaffId: string; reason?: string }) =>
      apiClient.post<QueueItem>(`referrals/${id}/assign`, { assignedToStaffId, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referralKeys.coordinatorQueueAll })
      qc.invalidateQueries({ queryKey: referralKeys.all })
    },
  })
}

function useAccept() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.post<QueueItem>(`referrals/${id}/accept`, { confirmDecision: true, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referralKeys.coordinatorQueueAll })
      qc.invalidateQueries({ queryKey: referralKeys.all })
    },
  })
}

function useDecline() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post<QueueItem>(`referrals/${id}/decline`, {
        confirmDecision: true,
        reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referralKeys.coordinatorQueueAll })
      qc.invalidateQueries({ queryKey: referralKeys.all })
    },
  })
}

function useAddNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      apiClient.post(`referrals/${id}/notes`, { note }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: referralKeys.notes(vars.id) })
    },
  })
}

interface ReferralNoteRow {
  id: string
  fromTaskStatus: string | null
  toTaskStatus: string
  reason: string | null
  createdAt: string
  actorGivenName: string | null
  actorFamilyName: string | null
}

function useReferralNotes(referralId: string | null) {
  return useQuery({
    queryKey: referralKeys.notes(referralId),
    queryFn: () => apiClient.get<{ items: ReferralNoteRow[] }>(`referrals/${referralId}/notes`),
    enabled: !!referralId,
    staleTime: 10_000,
  })
}

function useStaffLookup() {
  return useQuery({
    queryKey: referralsCrossFeatureKeys.staffLookup(),
    queryFn: () => apiClient.get<StaffLookupRow[]>('staff/lookup'),
    staleTime: 60_000,
  })
}

const TASK_STATUS_OPTIONS = [
  { value: '', label: 'All stages' },
  { value: 'requested', label: 'Requested (awaiting triage)' },
  { value: 'received', label: 'Received (triaged)' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'in_progress', label: 'In progress (assigned)' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Declined' },
]

const URGENCY_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  emergency: 'error',
  urgent: 'warning',
  soon: 'info',
  routine: 'default',
}

const TASK_STATUS_COLOR: Record<string, 'warning' | 'info' | 'primary' | 'success' | 'error' | 'default'> = {
  requested: 'warning',
  received: 'info',
  accepted: 'success',
  in_progress: 'primary',
  completed: 'success',
  rejected: 'error',
}

// ── Decline Dialog ─────────────────────────────────────────────────────────

function DeclineDialog({
  referralId,
  onClose,
}: {
  referralId: string | null
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const { mutateAsync, isPending } = useDecline()
  const handleSubmit = async () => {
    if (!referralId || !reason.trim()) return
    await mutateAsync({ id: referralId, reason: reason.trim() })
    setReason('')
    onClose()
  }
  return (
    <Dialog open={!!referralId} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Decline Referral</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          label="Reason *"
          fullWidth
          size="small"
          multiline
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          sx={{ mt: 1 }}
          placeholder="e.g. Outside service scope — referring back to GP"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" disabled={!reason.trim() || isPending} onClick={handleSubmit}>
          {isPending ? <CircularProgress size={18} /> : 'Decline'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Note Dialog ────────────────────────────────────────────────────────────

function NoteDialog({ referralId, onClose }: { referralId: string | null; onClose: () => void }) {
  const [note, setNote] = useState('')
  const { mutateAsync, isPending } = useAddNote()
  const handleSubmit = async () => {
    if (!referralId || !note.trim()) return
    await mutateAsync({ id: referralId, note: note.trim() })
    setNote('')
    onClose()
  }
  return (
    <Dialog open={!!referralId} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Note</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          label="Note *"
          fullWidth
          size="small"
          multiline
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!note.trim() || isPending} onClick={handleSubmit}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Add Note'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Notes timeline (expanded row) ─────────────────────────────────────────

function NotesTimeline({ referralId }: { referralId: string }) {
  const { data, isLoading } = useReferralNotes(referralId)
  const items = data?.items ?? []
  if (isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}><CircularProgress size={16} /></Box>
  }
  if (items.length === 0) {
    return <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>No notes or state changes yet.</Alert>
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {items.map((n) => {
        const isNote = n.fromTaskStatus === n.toTaskStatus
        const actor = [n.actorGivenName, n.actorFamilyName].filter(Boolean).join(' ') || 'System'
        return (
          <Paper key={n.id} variant="outlined" sx={{ p: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                {isNote ? (
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#327C8D' }}>
                    Note
                  </Typography>
                ) : (
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#b8621a' }}>
                    {n.fromTaskStatus ?? '—'} → {n.toTaskStatus}
                  </Typography>
                )}
                {n.reason && (
                  <Typography variant="body2" sx={{ mt: 0.25 }}>
                    {n.reason}
                  </Typography>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {actor} · {new Date(n.createdAt).toLocaleString('en-AU')}
              </Typography>
            </Box>
          </Paper>
        )
      })}
    </Box>
  )
}

// ── Assign Dialog ──────────────────────────────────────────────────────────

interface AssignDialogProps {
  open: boolean
  referralId: string | null
  onClose: () => void
}

function AssignDialog({ open, referralId, onClose }: AssignDialogProps) {
  const [assignedToStaffId, setAssignedToStaffId] = useState('')
  const [reason, setReason] = useState('')
  const { data: staff } = useStaffLookup()
  const { mutateAsync, isPending } = useAssign()

  const handleSubmit = async () => {
    if (!referralId || !assignedToStaffId) return
    await mutateAsync({ id: referralId, assignedToStaffId, reason: reason.trim() || undefined })
    setAssignedToStaffId('')
    setReason('')
    onClose()
  }

  const clinicians = useMemo(() => (staff ?? []).filter((s) => s.role === 'clinician' || s.role === 'admin'), [staff])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign Referral</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Clinician</InputLabel>
              <Select value={assignedToStaffId} onChange={(e) => setAssignedToStaffId(e.target.value)} label="Clinician">
                {clinicians.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.familyName}, {c.givenName} — {c.role}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Reason (optional)"
              fullWidth
              size="small"
              multiline
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this clinician for this referral?"
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={isPending || !assignedToStaffId}>
          {isPending ? <CircularProgress size={18} /> : 'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ReferralCoordinatorQueue(): React.ReactElement {
  const navigate = useNavigate()
  const [specialty, setSpecialty] = useState<SpecialtyType | ''>('')
  const [taskStatus, setTaskStatus] = useState<string>('')
  const [mineOnly, setMineOnly] = useState(false)
  const [assignTarget, setAssignTarget] = useState<string | null>(null)
  const [declineTarget, setDeclineTarget] = useState<string | null>(null)
  const [noteTarget, setNoteTarget] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filters = useMemo(
    () => ({
      specialty: specialty || undefined,
      taskStatus: taskStatus || undefined,
      direction: 'outbound' as const,
      mineOnly: mineOnly || undefined,
      pageSize: 100,
    }),
    [specialty, taskStatus, mineOnly],
  )

  const { data, isLoading } = useCoordinatorQueue(filters)
  const { mutateAsync: triageAsync, isPending: isTriaging } = useTriage()
  const { mutateAsync: acceptAsync, isPending: isAccepting } = useAccept()

  const items = data?.items ?? []

  const handleTriage = async (id: string) => {
    await triageAsync({ id })
  }

  const handleAccept = async (id: string) => {
    await acceptAsync({ id })
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AssignmentIcon sx={{ color: '#b8621a' }} />
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Referral Out
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          Add Referral Out
        </Button>
      </Box>

      {/* Filter bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Specialty</InputLabel>
              <Select
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value as SpecialtyType | '')}
                label="Specialty"
              >
                <MenuItem value="">All specialties</MenuItem>
                {ALL_SPECIALTIES.map((code) => (
                  <MenuItem key={code} value={code}>
                    {SPECIALTY_DISPLAY[code]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Task stage</InputLabel>
              <Select value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)} label="Task stage">
                {TASK_STATUS_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControlLabel
              control={<Switch checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />}
              label="Only referrals I've claimed"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Queue table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 32, backgroundColor: '#FAFAFA' }} />
              {['Referral #', 'Patient', 'Date', 'Specialty', 'Urgency', 'Task', 'Coordinator', 'Actions'].map((h) => (
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
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography variant="body2" color="text.secondary">
                    Queue is empty for the selected filters.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {items.map((r) => {
              const terminal = r.taskStatus === 'completed' || r.taskStatus === 'rejected'
              const isExpanded = expandedId === r.id
              return (
                <React.Fragment key={r.id}>
                  <TableRow hover>
                    <TableCell sx={{ width: 32 }}>
                      <IconButton size="small" onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                        {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                      </IconButton>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.referralNumber}</TableCell>
                    <TableCell>
                      {r.patientFamilyName && r.patientGivenName
                        ? `${r.patientFamilyName}, ${r.patientGivenName}`
                        : '—'}
                    </TableCell>
                    <TableCell>{r.referralDate}</TableCell>
                    <TableCell>
                      {r.targetSpecialty ? SPECIALTY_DISPLAY[r.targetSpecialty] : '—'}
                    </TableCell>
                    <TableCell>
                      <Chip label={r.urgency} size="small" color={URGENCY_COLOR[r.urgency] ?? 'default'} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={r.taskStatus ?? '—'}
                        size="small"
                        color={r.taskStatus ? TASK_STATUS_COLOR[r.taskStatus] ?? 'default' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{r.coordinatorName ?? '—'}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {r.taskStatus === 'requested' && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<GavelIcon />}
                            disabled={isTriaging}
                            onClick={() => handleTriage(r.id)}
                          >
                            Triage
                          </Button>
                        )}
                        {!terminal && r.taskStatus !== 'accepted' && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            startIcon={<CheckCircleOutlineIcon />}
                            disabled={isAccepting}
                            onClick={() => handleAccept(r.id)}
                          >
                            Accept
                          </Button>
                        )}
                        {!terminal && (
                          <Button size="small" variant="outlined" onClick={() => setAssignTarget(r.id)}>
                            Forward
                          </Button>
                        )}
                        {!terminal && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<DoNotDisturbIcon />}
                            onClick={() => setDeclineTarget(r.id)}
                          >
                            Decline
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<CommentIcon />}
                          onClick={() => setNoteTarget(r.id)}
                        >
                          Note
                        </Button>
                        <Button size="small" onClick={() => navigate(`/referrals/${r.id}`)}>
                          Open
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={9} sx={{ p: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                      <Collapse in={isExpanded} unmountOnExit>
                        <Box sx={{ p: 2, bgcolor: '#FAFAFA' }}>
                          <Typography variant="overline" sx={{ fontSize: 10, color: '#327C8D', letterSpacing: 1 }}>
                            Reason
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 2 }}>{r.reason || '—'}</Typography>
                          <Typography variant="overline" sx={{ fontSize: 10, color: '#327C8D', letterSpacing: 1 }}>
                            Timeline
                          </Typography>
                          <Box sx={{ mt: 0.5 }}>
                            <NotesTimeline referralId={r.id} />
                          </Box>
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <CreateReferralOutDialog open={createOpen} onClose={() => setCreateOpen(false)} initialSpecialty={specialty} />
      <AssignDialog open={!!assignTarget} referralId={assignTarget} onClose={() => setAssignTarget(null)} />
      <DeclineDialog referralId={declineTarget} onClose={() => setDeclineTarget(null)} />
      <NoteDialog referralId={noteTarget} onClose={() => setNoteTarget(null)} />
    </Box>
  )
}
