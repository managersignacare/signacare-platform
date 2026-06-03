// apps/web/src/features/surgery/tabs/SurgicalCasesTab.tsx
//
// Multi-specialty Phase 7 — Surgery: case list and create dialog.
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
import { useState } from 'react'
import {
  CreateSurgicalCaseSchema,
  SurgicalUrgencyEnum,
  ConsentStatusEnum,
  type CreateSurgicalCaseDTO,
  type SurgicalCaseResponse,
  type SurgicalUrgency,
  type ConsentStatus,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'

import { surgicalCaseKeys } from '../queryKeys'
export { surgicalCaseKeys }

interface Props { patientId: string }

const URGENCY_COLOR: Record<SurgicalUrgency, 'default' | 'warning' | 'error'> = {
  elective: 'default',
  urgent: 'warning',
  emergency: 'error',
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

function useCreateCase(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateSurgicalCaseDTO) =>
      apiClient.post<SurgicalCaseResponse>(`surgery/patients/${patientId}/cases`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: surgicalCaseKeys.list(patientId) }),
  })
}

function AddCaseDialog({ open, patientId, onClose }: { open: boolean; patientId: string; onClose: () => void }) {
  const [procedureCode, setProcedureCode] = useState('')
  const [procedureDisplay, setProcedureDisplay] = useState('')
  const [plannedDate, setPlannedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [urgency, setUrgency] = useState<SurgicalUrgency>('elective')
  const [asaClass, setAsaClass] = useState('2')
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>('pending')
  const [note, setNote] = useState('')

  const createMut = useCreateCase(patientId)

  const handleSubmit = async () => {
    const payload: CreateSurgicalCaseDTO = CreateSurgicalCaseSchema.parse({
      patientId,
      procedureCode: procedureCode.trim(),
      procedureDisplay: procedureDisplay.trim(),
      plannedDate,
      urgency,
      asaClass: parseInt(asaClass, 10),
      consentStatus,
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setProcedureCode('')
    setProcedureDisplay('')
    setNote('')
    onClose()
  }

  const canSave = procedureCode.trim() && procedureDisplay.trim() && plannedDate

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        New Surgical Case
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Procedure code *" fullWidth size="small"
              value={procedureCode} onChange={(e) => setProcedureCode(e.target.value)} placeholder="e.g. 44970" />
          </Grid>
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Procedure *" fullWidth size="small"
              value={procedureDisplay} onChange={(e) => setProcedureDisplay(e.target.value)}
              placeholder="e.g. Laparoscopic appendicectomy" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Planned date" type="date" fullWidth size="small"
              value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Urgency</InputLabel>
              <Select value={urgency} onChange={(e) => setUrgency(e.target.value as SurgicalUrgency)} label="Urgency">
                {SurgicalUrgencyEnum.options.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>ASA class</InputLabel>
              <Select value={asaClass} onChange={(e) => setAsaClass(e.target.value)} label="ASA class">
                {['1', '2', '3', '4', '5', '6'].map((n) => <MenuItem key={n} value={n}>ASA {n}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Consent</InputLabel>
              <Select value={consentStatus} onChange={(e) => setConsentStatus(e.target.value as ConsentStatus)} label="Consent">
                {ConsentStatusEnum.options.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2}
              value={note} onChange={(e) => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!canSave || createMut.isPending} onClick={handleSubmit}
          sx={{ bgcolor: '#455A64', '&:hover': { bgcolor: '#607D8B' } }}>
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Create Case'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function SurgicalCasesTab({ patientId }: Props) {
  const { data, isLoading } = useCases(patientId)
  const [addOpen, setAddOpen] = useState(false)

  const items = data?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          One row per surgical case. Procedure, urgency, ASA physical status and consent captured up
          front; checklist / op note / PACU records attach via their own sub-tabs.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#455A64', '&:hover': { bgcolor: '#607D8B' }, flexShrink: 0 }}>
          New Case
        </Button>
      </Box>

      {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>}
      {!isLoading && items.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">No surgical cases yet.</Typography>
        </Paper>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {items.map((c) => (
          <Card key={c.id} variant="outlined">
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{c.procedureDisplay}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {c.procedureCode} · Planned {c.plannedDate} · ASA {c.asaClass}
                    {c.primarySurgeonName ? ` · Surgeon: ${c.primarySurgeonName}` : ''}
                  </Typography>
                  {c.note && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      {c.note}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <Chip size="small" label={c.urgency} color={URGENCY_COLOR[c.urgency]} />
                  <Chip size="small" label={c.status} />
                  <Chip size="small" label={`consent: ${c.consentStatus}`} variant="outlined" />
                </Box>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      <AddCaseDialog open={addOpen} patientId={patientId} onClose={() => setAddOpen(false)} />
    </Box>
  )
}

export default SurgicalCasesTab
