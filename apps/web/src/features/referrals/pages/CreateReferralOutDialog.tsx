import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ALL_SPECIALTIES, OUTBOUND_REFERRAL_SOURCE, SPECIALTY_DISPLAY, type SpecialtyType } from '@signacare/shared'
import React, { useMemo, useState } from 'react'
import { correspondenceKeys } from '../../correspondence/queryKeys'
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings'
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi'
import { apiClient } from '../../../shared/services/apiClient'
import { useAuthStore } from '../../../shared/store/authStore'
import { referralKeys, referralOutKeys, referralsCrossFeatureKeys } from '../queryKeys'
import { buildReferralOutLetterDraft, type ReferralOutTargetType } from './referralOutSupport'

interface SearchPatientRow {
  id: string
  givenName: string
  familyName: string
  emrNumber: string
  dateOfBirth: string
}

interface SelectedPatientOption extends SearchPatientRow {
  label: string
}

interface PatientDiagnosisRow {
  name: string
  episodeType?: string
  episodeStatus?: string
}

interface PatientMedicationRow {
  medicationName?: string | null
  drugName?: string | null
  dose?: string | null
  frequency?: string | null
  status?: string | null
}

interface PatientProviderRow {
  id: string
  providerType: string | null
  providerName: string | null
  providerPractice: string | null
  providerPhone: string | null
  providerEmail: string | null
}

interface ReferralSourceRow {
  id: string
  name: string
  category: string
}

interface CreatedLetterRow {
  id: string
  recipientEmail?: string | null
}

interface ErrorWithMessage {
  response?: {
    data?: {
      error?: string
    }
  }
  message?: string
}

function getErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as ErrorWithMessage
  return maybe.response?.data?.error ?? maybe.message ?? fallback
}

function usePatientSearch(search: string) {
  return useQuery({
    queryKey: referralsCrossFeatureKeys.patientsSearch(search),
    queryFn: () =>
      apiClient.get<{ data: SearchPatientRow[] }>(
        'patients',
        { search, limit: 10 },
      ),
    enabled: search.length >= 2,
    staleTime: 10_000,
  })
}

function usePatientDiagnoses(patientId: string | null) {
  return useQuery({
    queryKey: referralOutKeys.diagnoses(patientId),
    queryFn: () =>
      apiClient
        .get<{ data: PatientDiagnosisRow[] }>(`patients/${patientId}/diagnoses`)
        .then((result) => result.data ?? []),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

function usePatientMedications(patientId: string | null) {
  return useQuery({
    queryKey: referralOutKeys.medications(patientId),
    queryFn: () =>
      apiClient
        .get<PatientMedicationRow[] | { data?: PatientMedicationRow[] }>(
          `medications/patients/${patientId}/medications`,
          { status: 'active' },
        )
        .then((payload) => {
          if (Array.isArray(payload)) return payload
          return payload.data ?? []
        }),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

function usePatientProviders(patientId: string | null) {
  return useQuery({
    queryKey: referralOutKeys.providers(patientId),
    queryFn: () =>
      apiClient
        .get<{ providers: PatientProviderRow[] }>(`patients/${patientId}/providers`)
        .then((payload) => payload.providers ?? []),
    enabled: !!patientId,
    staleTime: 30_000,
  })
}

function useReferralSources() {
  return useQuery({
    queryKey: referralsCrossFeatureKeys.referralSources(),
    queryFn: () =>
      apiClient
        .get<{ sources: ReferralSourceRow[] }>('staff-settings/referral-sources')
        .then((payload) => payload.sources ?? []),
    staleTime: 60_000,
  })
}

function useCreateReferral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: {
      patientId: string
      targetSpecialty: SpecialtyType
      urgency: string
      reason: string
      fromService: string
      fromProviderName?: string
      fromProviderEmail?: string
      fromProviderPhone?: string
      referringOrg?: string
      clinicalSummary?: string
      currentMedications?: string
    }) =>
      apiClient.post('referrals', {
        direction: 'outbound',
        patientId: dto.patientId,
        referralDate: new Date().toISOString().slice(0, 10),
        source: OUTBOUND_REFERRAL_SOURCE,
        fromService: dto.fromService,
        fromProviderName: dto.fromProviderName ?? dto.fromService,
        fromProviderEmail: dto.fromProviderEmail,
        fromProviderPhone: dto.fromProviderPhone,
        referringOrg: dto.referringOrg,
        targetSpecialty: dto.targetSpecialty,
        urgency: dto.urgency,
        reason: dto.reason,
        clinicalSummary: dto.clinicalSummary,
        currentMedications: dto.currentMedications,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referralKeys.coordinatorQueueAll })
      qc.invalidateQueries({ queryKey: referralKeys.all })
    },
  })
}

function useCreateLetterDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: {
      patientId: string
      recipientName: string
      recipientEmail?: string
      subject: string
      body: string
      letterType: string
    }) =>
      apiClient.post<CreatedLetterRow>('correspondence/letters', {
        patientId: dto.patientId,
        recipientName: dto.recipientName,
        recipientEmail: dto.recipientEmail,
        letterType: dto.letterType,
        subject: dto.subject,
        body: dto.body,
        status: 'draft',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correspondenceKeys.all })
    },
  })
}

function useCreatePatientProvider(patientId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: {
      providerType: string
      providerName: string
      providerPractice?: string
      providerEmail?: string
      providerPhone?: string
    }) =>
      apiClient.post<{ provider: PatientProviderRow }>(`patients/${patientId}/providers`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referralOutKeys.providers(patientId) })
    },
  })
}

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const result: { id: string; name: string }[] = []
  function walk(items: OrgUnit[], depth: number) {
    for (const unit of items) {
      result.push({ id: unit.id, name: `${'\u00a0'.repeat(depth * 2)}${unit.name}`.trim() })
      if (unit.children?.length) walk(unit.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return result
}

const URGENCY_OPTIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'soon', label: 'Soon (2 weeks)' },
  { value: 'urgent', label: 'Urgent (72h)' },
  { value: 'emergency', label: 'Emergency' },
]

const REFERRAL_OUT_SPECIALTIES = ALL_SPECIALTIES

export interface CreateReferralOutDialogProps {
  open: boolean
  onClose: () => void
  initialSpecialty?: SpecialtyType | ''
}

export function CreateReferralOutDialog({ open, onClose, initialSpecialty }: CreateReferralOutDialogProps) {
  const role = useAuthStore((s) => (s.user?.role ?? '').trim().toLowerCase())
  const { data: tree } = useOrgTree()
  const flatUnits = useMemo(() => flattenUnits(tree ?? []), [tree])
  const { data: referralSources } = useReferralSources()
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientOption | null>(null)
  const [targetSpecialty, setTargetSpecialty] = useState<SpecialtyType | ''>(
    initialSpecialty || 'mental_health',
  )
  const [targetType, setTargetType] = useState<ReferralOutTargetType>('internal_team')
  const [teamTargetId, setTeamTargetId] = useState('')
  const [existingTargetId, setExistingTargetId] = useState('')
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderService, setNewProviderService] = useState('')
  const [newProviderEmail, setNewProviderEmail] = useState('')
  const [newProviderPhone, setNewProviderPhone] = useState('')
  const [newProviderType, setNewProviderType] = useState('specialist')
  const [urgency, setUrgency] = useState('routine')
  const [reason, setReason] = useState('')
  const [letterBody, setLetterBody] = useState('')
  const [letterEdited, setLetterEdited] = useState(false)

  const { data: patientResults } = usePatientSearch(patientSearch)
  const selectedPatientId = selectedPatient?.id ?? null
  const { data: diagnosisRows } = usePatientDiagnoses(selectedPatientId)
  const { data: medicationRows } = usePatientMedications(selectedPatientId)
  const { data: providerRows } = usePatientProviders(selectedPatientId)
  const createMut = useCreateReferral()
  const createLetterMut = useCreateLetterDraft()
  const createPatientProviderMut = useCreatePatientProvider(selectedPatientId)

  const patientOptions = useMemo(
    () =>
      (patientResults?.data ?? []).map((p) => ({
        ...p,
        label: `${p.familyName}, ${p.givenName} — ${p.emrNumber ?? ''}`,
      })),
    [patientResults],
  )

  const internalTargets = useMemo(
    () => flatUnits.map((unit) => ({ id: unit.id, label: unit.name, type: 'internal' as const })),
    [flatUnits],
  )

  const providerTargets = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; email: string; phone: string; type: 'provider' | 'source' }>()
    for (const provider of providerRows ?? []) {
      const name = provider.providerName?.trim() || 'Unnamed provider'
      const practice = provider.providerPractice?.trim()
      const label = practice ? `${name} — ${practice}` : name
      byId.set(`provider:${provider.id}`, {
        id: `provider:${provider.id}`,
        label,
        email: provider.providerEmail ?? '',
        phone: provider.providerPhone ?? '',
        type: 'provider',
      })
    }
    for (const source of referralSources ?? []) {
      const normalized = source.name.trim()
      if (!normalized) continue
      const key = `source:${source.id}`
      byId.set(key, {
        id: key,
        label: `${normalized} (${source.category})`,
        email: '',
        phone: '',
        type: 'source',
      })
    }
    return [...byId.values()]
  }, [providerRows, referralSources])

  const selectedInternalTarget = useMemo(
    () => internalTargets.find((target) => target.id === teamTargetId) ?? null,
    [internalTargets, teamTargetId],
  )
  const selectedExistingTarget = useMemo(
    () => providerTargets.find((target) => target.id === existingTargetId) ?? null,
    [existingTargetId, providerTargets],
  )

  const resolvedDestination = useMemo(() => {
    if (targetType === 'internal_team') {
      return {
        name: selectedInternalTarget?.label ?? '',
        email: '',
        phone: '',
        referringOrg: selectedInternalTarget?.label ?? '',
      }
    }
    if (targetType === 'existing_provider') {
      return {
        name: selectedExistingTarget?.label ?? '',
        email: selectedExistingTarget?.email ?? '',
        phone: selectedExistingTarget?.phone ?? '',
        referringOrg: selectedExistingTarget?.label ?? '',
      }
    }
    const preferredName = newProviderName.trim()
    const service = newProviderService.trim()
    const destination = preferredName || service
    return {
      name: destination,
      email: newProviderEmail.trim(),
      phone: newProviderPhone.trim(),
      referringOrg: service || preferredName,
    }
  }, [
    newProviderEmail,
    newProviderName,
    newProviderPhone,
    newProviderService,
    selectedExistingTarget,
    selectedInternalTarget,
    targetType,
  ])

  const diagnosisSummary = useMemo(
    () => (diagnosisRows ?? []).map((row) => row.name).filter((name) => !!name),
    [diagnosisRows],
  )
  const medicationSummary = useMemo(
    () =>
      (medicationRows ?? [])
        .filter((row) => (row.status ?? '').toLowerCase() !== 'ceased_discontinued')
        .map((row) => {
          const name = row.medicationName ?? row.drugName ?? 'Medication'
          const dose = row.dose ? ` ${row.dose}` : ''
          const freq = row.frequency ? ` (${row.frequency})` : ''
          return `${name}${dose}${freq}`.trim()
        }),
    [medicationRows],
  )

  const canSubmit = !!selectedPatient && !!targetSpecialty && reason.trim().length > 0 && resolvedDestination.name.length > 0
  const canPersistDraft = role === 'clinician' || role === 'admin' || role === 'superadmin'

  const generateLetter = () => {
    if (!selectedPatient || !resolvedDestination.name || !reason.trim()) return
    const draft = buildReferralOutLetterDraft({
      patientDisplayName: `${selectedPatient.givenName} ${selectedPatient.familyName}`,
      patientUrNumber: selectedPatient.emrNumber,
      patientDateOfBirth: selectedPatient.dateOfBirth,
      targetRecipient: resolvedDestination.name,
      targetType,
      reason: reason.trim(),
      diagnosisSummary,
      medicationSummary,
    })
    setLetterBody(draft)
    setLetterEdited(false)
  }

  React.useEffect(() => {
    if (letterEdited) return
    if (!selectedPatient || !resolvedDestination.name || !reason.trim()) return
    generateLetter()
    // Intentionally include summary dependencies so draft updates until user edits.
  }, [selectedPatient, resolvedDestination.name, reason, targetType, diagnosisSummary, medicationSummary, letterEdited])

  const handleSubmit = async (sendMode: 'save' | 'email' | 'print') => {
    if (!canSubmit || !selectedPatient || !targetSpecialty) return
    try {
      let postCreateNotice: string | null = null
      if (targetType === 'new_provider' && newProviderName.trim() && selectedPatientId) {
        await createPatientProviderMut.mutateAsync({
          providerType: newProviderType,
          providerName: newProviderName.trim(),
          providerPractice: newProviderService.trim() || undefined,
          providerEmail: newProviderEmail.trim() || undefined,
          providerPhone: newProviderPhone.trim() || undefined,
        })
      }

      await createMut.mutateAsync({
        patientId: selectedPatient.id,
        targetSpecialty: targetSpecialty as SpecialtyType,
        urgency,
        reason: reason.trim(),
        fromService: resolvedDestination.name,
        fromProviderName: resolvedDestination.name,
        fromProviderEmail: resolvedDestination.email || undefined,
        fromProviderPhone: resolvedDestination.phone || undefined,
        referringOrg: resolvedDestination.referringOrg || undefined,
        clinicalSummary: letterBody.trim() || undefined,
        currentMedications: medicationSummary.join('; ') || undefined,
      })

      let createdLetter: CreatedLetterRow | null = null
      if (letterBody.trim().length > 0 && canPersistDraft) {
        try {
          createdLetter = await createLetterMut.mutateAsync({
            patientId: selectedPatient.id,
            recipientName: resolvedDestination.name,
            recipientEmail: resolvedDestination.email || undefined,
            subject: `Referral Out — ${selectedPatient.givenName} ${selectedPatient.familyName}`,
            body: letterBody.trim(),
            letterType: 'referral_out',
          })
        } catch {
          postCreateNotice = 'Referral was created, but draft letter could not be persisted. You can still email/print this draft now.'
        }
      }

      if (!canPersistDraft) {
        postCreateNotice = 'Referral saved. Draft letter could not be persisted from this role; copy/email/print from this dialog.'
      }

      if (sendMode === 'email') {
        const subject = `Referral Out — ${selectedPatient.givenName} ${selectedPatient.familyName}`
        const body = encodeURIComponent(letterBody.trim())
        const recipient = encodeURIComponent(resolvedDestination.email || '')
        window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${body}`
      }

      if (sendMode === 'print') {
        if (createdLetter?.id) {
          window.open(`/api/v1/correspondence/letters/${createdLetter.id}/pdf?sign=false`, '_blank', 'noopener,noreferrer')
        } else {
          const printWindow = window.open('', '_blank', 'noopener,noreferrer')
          if (printWindow) {
            const escaped = letterBody
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
            printWindow.document.write(`<pre style="font-family: monospace; white-space: pre-wrap;">${escaped}</pre>`)
            printWindow.document.close()
            printWindow.focus()
            printWindow.print()
          }
        }
      }

      setSelectedPatient(null)
      setPatientSearch('')
      setTargetSpecialty('mental_health')
      setUrgency('routine')
      setTargetType('internal_team')
      setTeamTargetId('')
      setExistingTargetId('')
      setNewProviderName('')
      setNewProviderService('')
      setNewProviderEmail('')
      setNewProviderPhone('')
      setNewProviderType('specialist')
      setReason('')
      setLetterBody('')
      setLetterEdited(false)
      if (postCreateNotice) {
        alert(postCreateNotice)
      }
      onClose()
    } catch (error: unknown) {
      alert(`Failed to create referral: ${getErrorMessage(error, 'Unknown')}`)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        New Referral Out
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <Autocomplete
              options={patientOptions}
              value={selectedPatient}
              onChange={(_, v) => setSelectedPatient(v)}
              onInputChange={(_, v) => setPatientSearch(v)}
              getOptionLabel={(o) => o.label}
              renderInput={(params) => (
                <TextField {...params} label="Patient *" size="small" placeholder="Type 2+ characters to search" />
              )}
              size="small"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Target specialty *</InputLabel>
              <Select
                value={targetSpecialty}
                label="Target specialty *"
                onChange={(e) => setTargetSpecialty(e.target.value as SpecialtyType | '')}
              >
                {REFERRAL_OUT_SPECIALTIES.map((code) => (
                  <MenuItem key={code} value={code}>
                    {SPECIALTY_DISPLAY[code]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Referral destination type *</InputLabel>
              <Select
                value={targetType}
                label="Referral destination type *"
                onChange={(event) => setTargetType(event.target.value as ReferralOutTargetType)}
              >
                <MenuItem value="internal_team">Internal Team / Program</MenuItem>
                <MenuItem value="existing_provider">Existing Provider / Health Service</MenuItem>
                <MenuItem value="new_provider">Add New Provider / Health Service</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {targetType === 'internal_team' && (
            <Grid size={{ xs: 12 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Internal destination *</InputLabel>
                <Select
                  value={teamTargetId}
                  label="Internal destination *"
                  onChange={(event) => setTeamTargetId(event.target.value)}
                >
                  {internalTargets.map((target) => (
                    <MenuItem key={target.id} value={target.id}>
                      {target.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          {targetType === 'existing_provider' && (
            <Grid size={{ xs: 12 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Existing provider / service *</InputLabel>
                <Select
                  value={existingTargetId}
                  label="Existing provider / service *"
                  onChange={(event) => setExistingTargetId(event.target.value)}
                >
                  {providerTargets.map((target) => (
                    <MenuItem key={target.id} value={target.id}>
                      {target.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          {targetType === 'new_provider' && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Provider / service name *"
                  fullWidth
                  size="small"
                  value={newProviderName}
                  onChange={(event) => setNewProviderName(event.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Practice / organisation"
                  fullWidth
                  size="small"
                  value={newProviderService}
                  onChange={(event) => setNewProviderService(event.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Email"
                  fullWidth
                  size="small"
                  value={newProviderEmail}
                  onChange={(event) => setNewProviderEmail(event.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Phone"
                  fullWidth
                  size="small"
                  value={newProviderPhone}
                  onChange={(event) => setNewProviderPhone(event.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Provider type</InputLabel>
                  <Select value={newProviderType} label="Provider type" onChange={(event) => setNewProviderType(event.target.value)}>
                    <MenuItem value="specialist">Specialist</MenuItem>
                    <MenuItem value="gp">GP</MenuItem>
                    <MenuItem value="allied_health">Allied Health</MenuItem>
                    <MenuItem value="health_service">Health Service</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Urgency</InputLabel>
              <Select value={urgency} label="Urgency" onChange={(e) => setUrgency(e.target.value)}>
                {URGENCY_OPTIONS.map((u) => (
                  <MenuItem key={u.value} value={u.value}>
                    {u.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Reason *"
              fullWidth
              size="small"
              multiline
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Referral Letter Draft (editable)
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={generateLetter}
                disabled={!selectedPatient || !resolvedDestination.name || !reason.trim()}
                sx={{ textTransform: 'none' }}
              >
                Generate Draft
              </Button>
            </Box>
            <TextField
              label="Referral letter"
              fullWidth
              size="small"
              multiline
              rows={10}
              value={letterBody}
              onChange={(event) => {
                setLetterBody(event.target.value)
                setLetterEdited(true)
              }}
              placeholder="Generate draft letter from patient summary and referral reason, then edit as needed."
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="outlined"
          disabled={!canSubmit || createMut.isPending || createLetterMut.isPending}
          onClick={() => handleSubmit('email')}
          startIcon={<EmailOutlinedIcon />}
          sx={{ textTransform: 'none' }}
        >
          Create + Email
        </Button>
        <Button
          variant="outlined"
          disabled={!canSubmit || createMut.isPending || createLetterMut.isPending}
          onClick={() => handleSubmit('print')}
          startIcon={<PrintOutlinedIcon />}
          sx={{ textTransform: 'none' }}
        >
          Create + Print
        </Button>
        <Button
          variant="contained"
          disabled={!canSubmit || createMut.isPending || createLetterMut.isPending}
          onClick={() => handleSubmit('save')}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          {createMut.isPending || createLetterMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Create Referral'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
