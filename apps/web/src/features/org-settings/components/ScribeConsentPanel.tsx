// Audit Tier 4.3 + 5.3 + 5.13 — Scribe settings panel (admin/superadmin).
//
// Consolidates the three per-clinic AI configuration dials:
//   - Scribe consent mode (Tier 4.3) — patient e-signature vs.
//     clinician attestation.
//   - AI Chat classifier mode (Tier 5.3) — regex/keyword fast path
//     vs. local LLM accurate path.
//   - Scribe audio retention (Tier 5.13) — immediate_delete vs. a
//     retention window for clinician re-listening.

import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import { apiClient } from '../../../shared/services/apiClient'

type ScribeConsentMode = 'patient_esignature' | 'clinician_attestation'
type AiChatClassifierMode = 'regex_keyword' | 'local_llm'
type ScribeAudioRetention = 'immediate_delete' | '24h' | '7d' | '30d' | '90d'
type EmailSenderMode = 'staff_delegated' | 'clinic_mailbox'

interface ClinicSettingsResponse {
  clinicId: string
  scribeConsentMode: ScribeConsentMode
  aiChatClassifierMode?: AiChatClassifierMode
  scribeAudioRetention?: ScribeAudioRetention
  scribeAudioRetentionAdr?: string | null
  scribeAudioRetentionClinicalReview?: string | null
  scribeAudioRetentionApprovedByStaffId?: string | null
  scribeAudioRetentionApprovedAt?: string | null
  emailSenderMode?: EmailSenderMode
  clinicSenderEmail?: string | null
  clinicSenderName?: string | null
  createdAt?: string
  updatedAt?: string
}

export const clinicSettingsKeys = {
  all: ['clinic-settings'] as const,
  current: () => ['clinic-settings', 'current'] as const,
}

export const ScribeConsentPanel: React.FC = () => {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery<ClinicSettingsResponse>({
    queryKey: clinicSettingsKeys.current(),
    queryFn: () => apiClient.get<ClinicSettingsResponse>('clinic-settings'),
  })

  const [mode, setMode] = React.useState<ScribeConsentMode>('clinician_attestation')
  const [classifier, setClassifier] = React.useState<AiChatClassifierMode>('regex_keyword')
  const [retention, setRetention] = React.useState<ScribeAudioRetention>('immediate_delete')
  const [retentionAdr, setRetentionAdr] = React.useState('')
  const [retentionClinicalReview, setRetentionClinicalReview] = React.useState('')
  const [senderMode, setSenderMode] = React.useState<EmailSenderMode>('staff_delegated')
  const [senderEmail, setSenderEmail] = React.useState('')
  const [senderName, setSenderName] = React.useState('')

  React.useEffect(() => {
    if (data?.scribeConsentMode) setMode(data.scribeConsentMode)
    if (data?.aiChatClassifierMode) setClassifier(data.aiChatClassifierMode)
    if (data?.scribeAudioRetention) setRetention(data.scribeAudioRetention)
    setRetentionAdr(data?.scribeAudioRetentionAdr ?? '')
    setRetentionClinicalReview(data?.scribeAudioRetentionClinicalReview ?? '')
    setSenderMode(data?.emailSenderMode ?? 'staff_delegated')
    setSenderEmail(data?.clinicSenderEmail ?? '')
    setSenderName(data?.clinicSenderName ?? '')
  }, [
    data?.scribeConsentMode,
    data?.aiChatClassifierMode,
    data?.scribeAudioRetention,
    data?.scribeAudioRetentionAdr,
    data?.scribeAudioRetentionClinicalReview,
    data?.emailSenderMode,
    data?.clinicSenderEmail,
    data?.clinicSenderName,
  ])

  const saveMut = useMutation({
    mutationFn: (patch: Partial<Pick<ClinicSettingsResponse,
      'scribeConsentMode' | 'aiChatClassifierMode' | 'scribeAudioRetention' | 'scribeAudioRetentionAdr' | 'scribeAudioRetentionClinicalReview' | 'emailSenderMode' | 'clinicSenderEmail' | 'clinicSenderName'>>) =>
      apiClient.patch<ClinicSettingsResponse>('clinic-settings', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: clinicSettingsKeys.current() }),
  })

  const normalizedSenderEmail = senderEmail.trim()
  const normalizedSenderName = senderName.trim()
  const normalizedRetentionAdr = retentionAdr.trim()
  const normalizedRetentionClinicalReview = retentionClinicalReview.trim()
  const senderConfigInvalid = senderMode === 'clinic_mailbox' && normalizedSenderEmail.length === 0
  const retentionOverrideProofRequired = retention !== 'immediate_delete'
  const retentionOverrideProofMissing =
    retentionOverrideProofRequired
    && (normalizedRetentionAdr.length < 6 || normalizedRetentionClinicalReview.length < 10)

  const anyDirty =
    mode !== data?.scribeConsentMode ||
    classifier !== (data?.aiChatClassifierMode ?? 'regex_keyword') ||
    retention !== (data?.scribeAudioRetention ?? 'immediate_delete') ||
    normalizedRetentionAdr !== (data?.scribeAudioRetentionAdr ?? '') ||
    normalizedRetentionClinicalReview !== (data?.scribeAudioRetentionClinicalReview ?? '') ||
    senderMode !== (data?.emailSenderMode ?? 'staff_delegated') ||
    normalizedSenderEmail !== (data?.clinicSenderEmail ?? '') ||
    normalizedSenderName !== (data?.clinicSenderName ?? '')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 720 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          Scribe Recording Consent
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Sara captures consent before every ambient recording session. Choose how your clinic
          collects that consent.
        </Typography>

        {isLoading && <CircularProgress size={24} />}
        {error != null && (
          <Alert role="alert" severity="error" sx={{ mb: 2 }}>
            Failed to load current setting. Try refreshing the page.
          </Alert>
        )}

        {!isLoading && (
          <FormControl component="fieldset" sx={{ width: '100%' }}>
            <RadioGroup
              value={mode}
              onChange={(e) => setMode(e.target.value as ScribeConsentMode)}
            >
              <Paper variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                <FormControlLabel
                  value="clinician_attestation"
                  control={<Radio />}
                  label={<Typography fontWeight={600}>Clinician attestation (default)</Typography>}
                />
                <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                  The clinician types the patient&rsquo;s name and ticks a checkbox to attest that
                  verbal consent was obtained.
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <FormControlLabel
                  value="patient_esignature"
                  control={<Radio />}
                  label={<Typography fontWeight={600}>Patient e-signature</Typography>}
                />
                <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                  The patient signs directly on the device screen. Produces a tamper-evident PNG
                  stored alongside the session.
                </Typography>
              </Paper>
            </RadioGroup>
          </FormControl>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          AI Chat Classifier Mode
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Audit Tier 5.3 — the classifier inspects every AI Chat prompt for prescribing / dosing
          / controlled-drug requests before the prompt reaches the model. Choose the mode that
          best fits your latency vs. accuracy tolerance.
        </Typography>

        {!isLoading && (
          <FormControl component="fieldset" sx={{ width: '100%' }}>
            <RadioGroup
              value={classifier}
              onChange={(e) => setClassifier(e.target.value as AiChatClassifierMode)}
            >
              <Paper variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                <FormControlLabel
                  value="regex_keyword"
                  control={<Radio />}
                  label={<Typography fontWeight={600}>Regex/keyword (fast default)</Typography>}
                />
                <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                  Deterministic pattern matching. 10&ndash;50ms latency. Catches the canonical
                  prescribing verbs, dosage regimens, and AU controlled-drug names. Preferred for
                  production.
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <FormControlLabel
                  value="local_llm"
                  control={<Radio />}
                  label={<Typography fontWeight={600}>Local LLM classifier</Typography>}
                />
                <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                  Single-turn Ollama call. 200&ndash;800ms latency but higher accuracy on
                  natural-language prompts. Falls back to regex if Ollama is unreachable.
                </Typography>
              </Paper>
            </RadioGroup>
          </FormControl>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          Scribe Audio Retention
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Audit Tier 5.13 — how long scribe audio is kept after the transcript is produced.
          The default is <strong>immediate delete</strong>, matching the strongest AU privacy
          posture. Longer retention windows are blocked unless this clinic records ADR evidence
          and clinical safety review evidence.
        </Typography>

        {!isLoading && (
          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel>Retention window</InputLabel>
            <Select
              label="Retention window"
              value={retention}
              onChange={(e) => setRetention(e.target.value as ScribeAudioRetention)}
            >
              <MenuItem value="immediate_delete">Delete immediately (default)</MenuItem>
              <MenuItem value="24h">Retain 24 hours</MenuItem>
              <MenuItem value="7d">Retain 7 days</MenuItem>
              <MenuItem value="30d">Retain 30 days</MenuItem>
              <MenuItem value="90d">Retain 90 days</MenuItem>
            </Select>
            <FormHelperText>
              Non-immediate retention is an exception path. The database rejects it without
              documented ADR and clinical safety review proof.
            </FormHelperText>
          </FormControl>
        )}
        {!isLoading && retentionOverrideProofRequired && (
          <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              label="ADR / governance reference"
              placeholder="ADR-0042 or docs/adr/audio-retention.md"
              value={retentionAdr}
              onChange={(e) => setRetentionAdr(e.target.value)}
              size="small"
              required
              error={normalizedRetentionAdr.length > 0 && normalizedRetentionAdr.length < 6}
              helperText="Required before retained recording windows can be enabled."
            />
            <TextField
              label="Clinical safety review evidence"
              placeholder="Clinical Safety Review CSR-2026-06 approved retained audio window"
              value={retentionClinicalReview}
              onChange={(e) => setRetentionClinicalReview(e.target.value)}
              size="small"
              required
              error={normalizedRetentionClinicalReview.length > 0 && normalizedRetentionClinicalReview.length < 10}
              helperText="Required. Include review identifier or approved governance note."
            />
          </Box>
        )}
        {!isLoading && retentionOverrideProofMissing && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Audio retention beyond immediate-delete cannot be saved until ADR and clinical
            safety review evidence are provided.
          </Alert>
        )}
        {!isLoading && data?.scribeAudioRetentionApprovedAt && retention !== 'immediate_delete' && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Retention exception approved on {new Date(data.scribeAudioRetentionApprovedAt).toLocaleString('en-AU')}.
          </Alert>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          Clinic Email Sender Profile
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Configure how outbound email identifies your clinic. Staff delegated mode sends from
          the signed-in staff member&rsquo;s connected account. Clinic mailbox mode uses a shared
          clinic sender identity for patient-facing correspondence.
        </Typography>

        <FormControl component="fieldset" sx={{ width: '100%' }}>
          <RadioGroup
            value={senderMode}
            onChange={(e) => setSenderMode(e.target.value as EmailSenderMode)}
          >
            <Paper variant="outlined" sx={{ p: 2, mb: 1.5 }}>
              <FormControlLabel
                value="staff_delegated"
                control={<Radio />}
                label={<Typography fontWeight={600}>Staff delegated sender (default)</Typography>}
              />
              <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                Sends from the clinician&rsquo;s connected Outlook account with per-user Sent Items.
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <FormControlLabel
                value="clinic_mailbox"
                control={<Radio />}
                label={<Typography fontWeight={600}>Clinic mailbox sender</Typography>}
              />
              <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                Uses a shared clinic sender identity for consistent branding and reply handling.
              </Typography>
            </Paper>
          </RadioGroup>
        </FormControl>

        <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <TextField
            label="Clinic sender email"
            placeholder="no-reply@clinic.example"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            size="small"
            type="email"
            required={senderMode === 'clinic_mailbox'}
            error={senderConfigInvalid}
            helperText={
              senderMode === 'clinic_mailbox'
                ? 'Required when Clinic mailbox sender is enabled.'
                : 'Optional. Stored for future use when switching to clinic mailbox.'
            }
          />
          <TextField
            label="Clinic sender display name"
            placeholder="Soham Health Clinic"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            size="small"
            helperText="Optional display name for SMTP sender headers."
          />
        </Box>
        {senderConfigInvalid && (
          <FormHelperText error sx={{ mt: 1 }}>
            Clinic mailbox mode requires a valid sender email.
          </FormHelperText>
        )}
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Button
          variant="contained"
          disabled={saveMut.isPending || !anyDirty || senderConfigInvalid || retentionOverrideProofMissing}
          onClick={() => saveMut.mutate({
            scribeConsentMode: mode,
            aiChatClassifierMode: classifier,
            scribeAudioRetention: retention,
            scribeAudioRetentionAdr: retentionOverrideProofRequired ? normalizedRetentionAdr : null,
            scribeAudioRetentionClinicalReview: retentionOverrideProofRequired ? normalizedRetentionClinicalReview : null,
            emailSenderMode: senderMode,
            clinicSenderEmail: normalizedSenderEmail.length > 0 ? normalizedSenderEmail : null,
            clinicSenderName: normalizedSenderName.length > 0 ? normalizedSenderName : null,
          })}
        >
          {saveMut.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saveMut.isSuccess && <Alert severity="success" sx={{ py: 0 }}>Saved</Alert>}
        {saveMut.isError && (
          <Alert role="alert" severity="error" sx={{ py: 0 }}>
            Could not save. Check your permissions and try again.
          </Alert>
        )}
      </Box>
    </Box>
  )
}
