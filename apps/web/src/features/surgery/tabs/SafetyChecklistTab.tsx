// apps/web/src/features/surgery/tabs/SafetyChecklistTab.tsx
//
// Multi-specialty Phase 7 — WHO Surgical Safety Checklist wizard.
//
// Three phases — sign_in / time_out / sign_out — each with a fixed
// set of WHO default prompts. The user ticks items, adds optional
// notes, and hits "Submit phase". Once all three phases are saved
// the op-note endpoint becomes available (the backend enforces the
// same guard as a defence-in-depth measure).
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  type ChecklistItem,
  type ChecklistPhase,
  type CreateSafetyChecklistDTO,
  type SafetyChecklistResponse,
  type SurgicalCaseResponse,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { surgicalCaseKeys } from './SurgicalCasesTab'

interface Props { patientId: string }

// WHO Surgical Safety Checklist default prompts per phase.
const DEFAULT_PROMPTS: Record<ChecklistPhase, string[]> = {
  sign_in: [
    'Patient has confirmed identity, site, procedure and consent',
    'Site marked / not applicable',
    'Anaesthesia safety check completed',
    'Pulse oximeter on patient and functioning',
    'Known allergies',
    'Difficult airway / aspiration risk reviewed',
    'Risk of > 500 ml blood loss (7 ml/kg in children) reviewed',
  ],
  time_out: [
    'All team members have introduced themselves by name and role',
    'Surgeon, anaesthesia professional and nurse verbally confirm patient, site and procedure',
    'Anticipated critical events reviewed by surgeon',
    'Anaesthesia review: patient-specific concerns',
    'Nursing team: sterility indicator results, equipment issues',
    'Antibiotic prophylaxis given within the last 60 minutes',
    'Essential imaging displayed',
  ],
  sign_out: [
    'Nurse verbally confirms with the team the name of the procedure recorded',
    'Instrument, sponge and needle counts are correct',
    'Specimen labelled (including patient name)',
    'Equipment problems to be addressed',
    'Key concerns for recovery and management of this patient reviewed',
  ],
}

const PHASE_LABEL: Record<ChecklistPhase, string> = {
  sign_in: 'Sign In (before induction of anaesthesia)',
  time_out: 'Time Out (before skin incision)',
  sign_out: 'Sign Out (before patient leaves the OR)',
}

const checklistKeys = {
  list: (caseId: string) => ['surgery', 'checklists', caseId] as const,
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

function useChecklists(caseId: string) {
  return useQuery<{ items: SafetyChecklistResponse[] }>({
    queryKey: checklistKeys.list(caseId),
    queryFn: () =>
      apiClient.get<{ items: SafetyChecklistResponse[] }>(`surgery/cases/${caseId}/checklists`),
    staleTime: 30_000,
    enabled: !!caseId,
  })
}

function useCreateChecklist(caseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateSafetyChecklistDTO) =>
      apiClient.post<SafetyChecklistResponse>(`surgery/cases/${caseId}/checklists`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: checklistKeys.list(caseId) }),
  })
}

interface PhasePanelProps {
  caseId: string
  phase: ChecklistPhase
  existing?: SafetyChecklistResponse
}

function PhasePanel({ caseId, phase, existing }: PhasePanelProps) {
  const [items, setItems] = useState<ChecklistItem[]>(() =>
    existing
      ? existing.items
      : DEFAULT_PROMPTS[phase].map((p) => ({ prompt: p, completed: false, note: null })),
  )

  useEffect(() => {
    if (existing) setItems(existing.items)
  }, [existing])

  const createMut = useCreateChecklist(caseId)

  const allTicked = items.every((i) => i.completed)

  const toggle = (idx: number) => {
    setItems((prev) => prev.map((i, n) => (n === idx ? { ...i, completed: !i.completed } : i)))
  }

  const handleSubmit = async () => {
    const payload: CreateSafetyChecklistDTO = {
      caseId,
      phase,
      items,
    }
    await createMut.mutateAsync(payload)
  }

  const readOnly = !!existing

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {existing && <CheckCircleIcon sx={{ color: '#2E7D32', fontSize: 20 }} />}
        <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
          {PHASE_LABEL[phase]}
        </Typography>
      </Box>
      <Stack spacing={1}>
        {items.map((it, idx) => (
          <FormControlLabel
            key={idx}
            control={<Checkbox checked={it.completed} disabled={readOnly} onChange={() => toggle(idx)} />}
            label={<Typography variant="body2">{it.prompt}</Typography>}
          />
        ))}
      </Stack>
      {!readOnly && (
        <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button
            variant="contained"
            disabled={!allTicked || createMut.isPending}
            onClick={handleSubmit}
            sx={{ bgcolor: '#455A64', '&:hover': { bgcolor: '#607D8B' } }}
          >
            {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : `Submit ${phase}`}
          </Button>
        </Box>
      )}
      {readOnly && existing && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Completed {new Date(existing.completedAt).toLocaleString('en-AU')}
          {existing.completedByName ? ` by ${existing.completedByName}` : ''}
        </Typography>
      )}
    </Paper>
  )
}

export function SafetyChecklistTab({ patientId }: Props) {
  const { data: caseData } = useCases(patientId)
  const cases = caseData?.items ?? []
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!selectedId && cases.length > 0) setSelectedId(cases[0].id)
  }, [cases, selectedId])

  const { data: checklistData, isLoading } = useChecklists(selectedId)
  const existing = checklistData?.items ?? []

  const byPhase = useMemo(() => {
    const map: Partial<Record<ChecklistPhase, SafetyChecklistResponse>> = {}
    for (const c of existing) map[c.phase] = c
    return map
  }, [existing])

  if (cases.length === 0) {
    return (
      <Alert severity="info" variant="outlined">
        Add a surgical case in the Cases sub-tab before starting a WHO checklist.
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
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
      )}

      {!isLoading && selectedId && (
        <>
          <PhasePanel caseId={selectedId} phase="sign_in" existing={byPhase.sign_in} />
          <PhasePanel caseId={selectedId} phase="time_out" existing={byPhase.time_out} />
          <PhasePanel caseId={selectedId} phase="sign_out" existing={byPhase.sign_out} />
        </>
      )}

      <TextField sx={{ display: 'none' }} />
    </Box>
  )
}

export default SafetyChecklistTab
