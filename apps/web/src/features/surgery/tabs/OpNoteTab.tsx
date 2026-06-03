// apps/web/src/features/surgery/tabs/OpNoteTab.tsx
//
// Multi-specialty Phase 7 — Operative note editor.
//
// One op note per case. Create is blocked by the backend until all
// three WHO checklist phases exist; the UI surfaces the resulting
// 409/CHECKLIST_INCOMPLETE error inline so the surgeon knows where
// the block is coming from.
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
import { useEffect, useState } from 'react'
import {
  CreateOpNoteSchema,
  type CreateOpNoteDTO,
  type OpNoteResponse,
  type SurgicalCaseResponse,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { surgicalCaseKeys } from './SurgicalCasesTab'

interface Props { patientId: string }

interface ErrorWithResponse {
  response?: {
    data?: {
      code?: string
      error?: string
    }
  }
  message?: string
}

function getErrorCode(error: unknown): string | undefined {
  const maybe = error as ErrorWithResponse
  return maybe.response?.data?.code
}

function getErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as ErrorWithResponse
  return maybe.response?.data?.error ?? maybe.message ?? fallback
}

const opNoteKeys = {
  get: (caseId: string) => ['surgery', 'op-note', caseId] as const,
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

function useOpNote(caseId: string) {
  return useQuery<{ note: OpNoteResponse | null }>({
    queryKey: opNoteKeys.get(caseId),
    queryFn: () => apiClient.get<{ note: OpNoteResponse | null }>(`surgery/cases/${caseId}/op-note`),
    enabled: !!caseId,
    staleTime: 30_000,
  })
}

function useCreateOpNote(caseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateOpNoteDTO) =>
      apiClient.post<OpNoteResponse>(`surgery/cases/${caseId}/op-note`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: opNoteKeys.get(caseId) }),
  })
}

export function OpNoteTab({ patientId }: Props) {
  const { data: caseData } = useCases(patientId)
  const cases = caseData?.items ?? []
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!selectedId && cases.length > 0) setSelectedId(cases[0].id)
  }, [cases, selectedId])

  const { data: noteData, isLoading } = useOpNote(selectedId)
  const existing = noteData?.note ?? null

  const [indication, setIndication] = useState('')
  const [findings, setFindings] = useState('')
  const [procedureText, setProcedureText] = useState('')
  const [complications, setComplications] = useState('')
  const [ebl, setEbl] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (existing) {
      setIndication(existing.indication)
      setFindings(existing.findings)
      setProcedureText(existing.procedureText)
      setComplications(existing.complications ?? '')
      setEbl(existing.estimatedBloodLossMl != null ? String(existing.estimatedBloodLossMl) : '')
    } else {
      setIndication('')
      setFindings('')
      setProcedureText('')
      setComplications('')
      setEbl('')
    }
    setSubmitError(null)
  }, [selectedId, existing])

  const createMut = useCreateOpNote(selectedId)

  const handleSubmit = async () => {
    setSubmitError(null)
    try {
      const payload: CreateOpNoteDTO = CreateOpNoteSchema.parse({
        caseId: selectedId,
        indication: indication.trim(),
        findings: findings.trim(),
        procedureText: procedureText.trim(),
        complications: complications.trim() || null,
        estimatedBloodLossMl: ebl ? parseInt(ebl, 10) : null,
      })
      await createMut.mutateAsync(payload)
    } catch (error: unknown) {
      const code = getErrorCode(error)
      const msg = getErrorMessage(error, 'Failed to save op note')
      if (code === 'CHECKLIST_INCOMPLETE') {
        setSubmitError(
          'All three WHO checklist phases (Sign In / Time Out / Sign Out) must be completed before the op note can be saved.',
        )
      } else {
        setSubmitError(msg)
      }
    }
  }

  if (cases.length === 0) {
    return (
      <Alert severity="info" variant="outlined">
        Add a surgical case in the Cases sub-tab before writing an op note.
      </Alert>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
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
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
      )}

      {!isLoading && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {existing && (
            <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>
              Op note closed {new Date(existing.closedAt).toLocaleString('en-AU')}
              {existing.closedByName ? ` by ${existing.closedByName}` : ''}. Read-only.
            </Alert>
          )}
          {submitError && (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField label="Indication *" fullWidth size="small" multiline rows={2}
                value={indication} onChange={(e) => setIndication(e.target.value)}
                slotProps={{ input: { readOnly: !!existing } }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Findings *" fullWidth size="small" multiline rows={3}
                value={findings} onChange={(e) => setFindings(e.target.value)}
                slotProps={{ input: { readOnly: !!existing } }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Procedure *" fullWidth size="small" multiline rows={6}
                value={procedureText} onChange={(e) => setProcedureText(e.target.value)}
                slotProps={{ input: { readOnly: !!existing } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField label="Complications" fullWidth size="small" multiline rows={2}
                value={complications} onChange={(e) => setComplications(e.target.value)}
                slotProps={{ input: { readOnly: !!existing } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Estimated blood loss (ml)" type="number" fullWidth size="small"
                value={ebl} onChange={(e) => setEbl(e.target.value)}
                slotProps={{ input: { readOnly: !!existing } }} />
            </Grid>
          </Grid>
          {!existing && (
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="contained" disabled={createMut.isPending}
                onClick={handleSubmit}
                sx={{ bgcolor: '#455A64', '&:hover': { bgcolor: '#607D8B' } }}>
                {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Close Op Note'}
              </Button>
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            The backend refuses op-note creation until all three WHO checklist phases exist for this
            case — the rule is enforced at the repository, not just in this UI.
          </Typography>
        </Paper>
      )}
    </Box>
  )
}

export default OpNoteTab
