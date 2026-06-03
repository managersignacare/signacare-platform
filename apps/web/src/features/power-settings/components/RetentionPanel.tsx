// apps/web/src/features/power-settings/components/RetentionPanel.tsx
//
// BUG-374a — Data Retention configuration panel for Power Settings.
//
// Policy locked 2026-04-26 (project_data_retention_policy.md):
//   - 25-year minimum floor (UI input enforces min=25; server re-validates).
//   - data_retention_years setter superadmin-only (Q3b).
//   - retention_purge_enabled toggle superadmin-only (Q3b).
//
// fix-registry anchor: R-FIX-BUG-374A-UI-MIN-25.

import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { powerSettingsApi, type RetentionState } from '../services/powerSettingsApi'
import { powerSettingsKeys } from '../queryKeys'

interface RetentionPanelProps {
  clinicId: string
  isSuperadmin: boolean
}

interface RetentionApiError {
  code?: string
  message?: string
  response?: {
    data?: {
      code?: string
      message?: string
    }
  }
}

function asRetentionApiError(err: unknown): RetentionApiError {
  return typeof err === 'object' && err !== null ? (err as RetentionApiError) : {}
}

function getRetentionErrorCode(err: unknown): string | undefined {
  const parsed = asRetentionApiError(err)
  return parsed.response?.data?.code ?? parsed.code
}

function getRetentionErrorMessage(err: unknown, fallback: string): string {
  const parsed = asRetentionApiError(err)
  return parsed.response?.data?.message ?? parsed.message ?? fallback
}

export function RetentionPanel({ clinicId, isSuperadmin }: RetentionPanelProps) {
  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: powerSettingsKeys.retention(clinicId),
    queryFn: () => powerSettingsApi.getRetention(),
  })

  const [yearsInput, setYearsInput] = useState<string>('')
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false)
  const [purgeConfirmText, setPurgeConfirmText] = useState('')
  const [purgeReason, setPurgeReason] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  )

  const setYearsMut = useMutation({
    mutationFn: (years: number) => powerSettingsApi.setRetentionYears(years),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: powerSettingsKeys.retention(clinicId) })
      setFeedback({ kind: 'success', message: 'Retention period updated.' })
      setYearsInput('')
    },
    onError: (err: unknown) => {
      const code = getRetentionErrorCode(err)
      const msg = getRetentionErrorMessage(err, 'Failed to update retention period')
      if (code === 'RETENTION_BELOW_FLOOR') {
        setFeedback({
          kind: 'error',
          message: `Retention period must be at least ${data?.floorYears ?? 25} years (policy floor).`,
        })
      } else if (code === 'FORBIDDEN') {
        setFeedback({ kind: 'error', message: 'Only platform superadmins can change retention.' })
      } else {
        setFeedback({ kind: 'error', message: msg })
      }
    },
  })

  const setPurgeMut = useMutation({
    mutationFn: ({ enabled, reason }: { enabled: boolean; reason: string }) =>
      powerSettingsApi.setRetentionPurgeEnabled(enabled, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: powerSettingsKeys.retention(clinicId) })
      setFeedback({
        kind: 'success',
        message: 'Retention purge flag updated. The next opportunity to act on this is the annual scheduler tick (1st January 04:00 AEST).',
      })
      setPurgeConfirmOpen(false)
      setPurgeConfirmText('')
      setPurgeReason('')
    },
    onError: (err: unknown) => {
      const code = getRetentionErrorCode(err)
      const msg = getRetentionErrorMessage(err, 'Failed to toggle purge flag')
      if (code === 'FORBIDDEN') {
        setFeedback({
          kind: 'error',
          message: 'Only platform superadmins can enable retention purge.',
        })
      } else {
        setFeedback({ kind: 'error', message: msg })
      }
    },
  })

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress role="progressbar" aria-label="Loading retention settings" />
      </Box>
    )
  }

  if (isError) {
    return (
      <Alert severity="error" role="alert">
        Failed to load retention settings: {getRetentionErrorMessage(error, 'unknown error')}
      </Alert>
    )
  }

  if (!data) return null
  const state = data as RetentionState

  const handleSaveYears = () => {
    const n = parseInt(yearsInput, 10)
    if (!Number.isInteger(n)) {
      setFeedback({ kind: 'error', message: 'Enter a whole number.' })
      return
    }
    if (n < state.floorYears) {
      setFeedback({
        kind: 'error',
        message: `Retention period must be at least ${state.floorYears} years (policy floor).`,
      })
      return
    }
    setYearsMut.mutate(n)
  }

  const handlePurgeToggleClick = () => {
    if (!isSuperadmin) return
    if (state.retentionPurgeEnabled) {
      // Disabling — no confirmation dialog needed for safety rollback
      setPurgeMut.mutate({ enabled: false, reason: 'rollback' })
    } else {
      // Enabling — open confirmation dialog
      setPurgeConfirmOpen(true)
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Data Retention
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        <strong>Policy:</strong> Patient and clinical records are retained for a minimum of{' '}
        <strong>{state.floorYears} years</strong>. Each subscribing organisation can configure a
        longer period, but cannot go below the floor. Purge runs ANNUALLY (1st January 04:00 AEST)
        in dry-run mode by default; production purge requires triple-lock arming below.
      </Alert>

      <Alert severity="warning" sx={{ mb: 3 }}>
        <strong>Anonymisation scope:</strong> patient identity wipe only (names, DOB, contact
        details, identifiers). <strong>Free-text in clinical notes is preserved as clinical
        record</strong> — narrative content (e.g. progress notes, SOAP entries) remains intact for
        aggregate clinical/research value. Free-text mentions of patient identity within notes lose
        their anchor when the patient row is wiped, but may persist in the narrative. This is the
        deliberate Q-C policy locked 2026-04-26 per AHPRA / Privacy Act 1988 / Health Records Act
        2001 (Vic).
      </Alert>

      {feedback && (
        <Alert
          severity={feedback.kind}
          role="alert"
          sx={{ mb: 2 }}
          onClose={() => setFeedback(null)}
        >
          {feedback.message}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Retention period (years)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Current setting: <strong>{state.dataRetentionYears} years</strong>
          {state.dataRetentionYears === state.floorYears
            ? ` (matches policy floor)`
            : ` (above floor of ${state.floorYears})`}
        </Typography>
        {isSuperadmin ? (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              type="number"
              label="New retention period"
              value={yearsInput}
              onChange={(e) => setYearsInput(e.target.value)}
              slotProps={{
                htmlInput: {
                  min: state.floorYears,
                  max: state.ceilingYears,
                  step: 1,
                  'aria-label': 'Retention period in years',
                },
              }}
              helperText={`Minimum ${state.floorYears}, maximum ${state.ceilingYears}`}
              size="small"
            />
            <Button
              variant="contained"
              onClick={handleSaveYears}
              disabled={setYearsMut.isPending || !yearsInput}
            >
              {setYearsMut.isPending ? 'Saving...' : 'Update'}
            </Button>
          </Box>
        ) : (
          <Alert severity="info">
            Only platform superadmins can change the retention period.
          </Alert>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Retention purge enablement
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          When OFF (default), the retention scheduler runs in dry-run mode only — it logs what
          would be purged without modifying any record. When ON, the scheduler permanently
          anonymises patient PHI for records past the retention period. <strong>This is
          irreversible.</strong>
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={state.retentionPurgeEnabled}
              onChange={handlePurgeToggleClick}
              disabled={!isSuperadmin || setPurgeMut.isPending}
              inputProps={{ 'aria-label': 'Retention purge enabled' }}
            />
          }
          label={
            state.retentionPurgeEnabled
              ? `ENABLED${state.retentionPurgeEnabledAt ? ` (since ${new Date(state.retentionPurgeEnabledAt).toLocaleDateString('en-AU')})` : ''}`
              : 'DISABLED (dry-run only)'
          }
        />
        {!isSuperadmin && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Only platform superadmins can enable retention purge.
          </Alert>
        )}
      </Paper>

      {/* BUG-374b Part 2 — Q-F triple-lock 3rd gate: manager approval. */}
      <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Manager approval (Q-F triple-lock 3rd gate)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Production purge ALSO requires manager approval by a different admin/superadmin than the
          one who enabled `retention_purge_enabled` (segregation of duties). Approval expires 30
          days after grant; cron skips clinics with expired approval.
        </Typography>
        <ManagerApprovalSection
          state={state}
          clinicId={clinicId}
          onChanged={() => qc.invalidateQueries({ queryKey: powerSettingsKeys.retention(clinicId) })}
        />
      </Paper>

      <Dialog
        aria-labelledby="purge-confirm-dialog-title"
        open={purgeConfirmOpen}
        onClose={() => setPurgeConfirmOpen(false)}
      >
        <DialogTitle id="purge-confirm-dialog-title" sx={{ fontWeight: 700 }}>
          Confirm retention purge enablement
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            <strong>This is irreversible.</strong> Once enabled (and after manager approval is
            recorded by a different staff member), the <strong>annual</strong> retention
            scheduler — which runs on 1st January 04:00 AEST — will permanently anonymise patient
            PHI (name, DOB, contact details, identifiers) for patients whose records have exceeded
            the {state.dataRetentionYears}-year retention period. Audit log entries will be
            preserved.
          </DialogContentText>
          <DialogContentText sx={{ mb: 2 }}>
            To confirm, type <strong>CONFIRM</strong> in the box below and provide a reason for
            audit purposes.
          </DialogContentText>
          <TextField
            label="Type CONFIRM"
            value={purgeConfirmText}
            onChange={(e) => setPurgeConfirmText(e.target.value)}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />
          <TextField
            label="Reason (audit log)"
            value={purgeReason}
            onChange={(e) => setPurgeReason(e.target.value)}
            fullWidth
            multiline
            rows={2}
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPurgeConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              purgeConfirmText !== 'CONFIRM'
              || purgeReason.trim().length < 1
              || setPurgeMut.isPending
            }
            onClick={() => setPurgeMut.mutate({ enabled: true, reason: purgeReason.trim() })}
          >
            {setPurgeMut.isPending ? 'Enabling...' : 'Enable retention purge'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// BUG-374b Part 2 — manager approval sub-component (Q-F gate #3).
// Displays current approval status + approve/revoke controls.
function ManagerApprovalSection({
  state,
  clinicId,
  onChanged,
}: {
  state: RetentionState
  clinicId: string
  onChanged: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  )

  const approveMut = useMutation({
    mutationFn: () => powerSettingsApi.approveRetentionPurge(reason.trim()),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Manager approval recorded. Cron will purge eligible records on the next annual tick.' })
      setReason('')
      void qc.invalidateQueries({ queryKey: powerSettingsKeys.retention(clinicId) })
      onChanged()
    },
    onError: (err: unknown) => {
      const code = getRetentionErrorCode(err)
      const msg = getRetentionErrorMessage(err, 'Approval failed')
      if (code === 'SEGREGATION_OF_DUTIES_VIOLATION') {
        setFeedback({ kind: 'error', message: 'You cannot approve your own enable action. A different admin must approve.' })
      } else if (code === 'PURGE_NOT_ENABLED') {
        setFeedback({ kind: 'error', message: 'Retention purge is not enabled. A superadmin must enable it first.' })
      } else if (code === 'FORBIDDEN') {
        setFeedback({ kind: 'error', message: 'Only admins or superadmins can approve.' })
      } else {
        setFeedback({ kind: 'error', message: msg })
      }
    },
  })

  const revokeMut = useMutation({
    mutationFn: () => powerSettingsApi.revokeRetentionPurgeApproval(reason.trim() || 'manual revocation'),
    onSuccess: () => {
      setFeedback({ kind: 'success', message: 'Manager approval revoked.' })
      setReason('')
      void qc.invalidateQueries({ queryKey: powerSettingsKeys.retention(clinicId) })
      onChanged()
    },
    onError: (err: unknown) => {
      const msg = getRetentionErrorMessage(err, 'Revocation failed')
      setFeedback({ kind: 'error', message: msg })
    },
  })

  // L5 absorb-1 — consume server-computed `managerApprovalActive` +
  // `managerApprovalRemainingDays`. Re-deriving these in the browser was
  // the BUG-416 anti-pattern shape (and could disagree with the cron's
  // server-side evaluation by hours due to clock drift). The server is
  // the source of truth.
  const approvedAt = state.retentionPurgeManagerApprovedAt
    ? new Date(state.retentionPurgeManagerApprovedAt)
    : null
  const isActive = state.managerApprovalActive
  const remainingDays = state.managerApprovalRemainingDays
  const ttlDays = state.managerApprovalTtlDays

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        {isActive ? (
          <Alert severity="success">
            Manager approval ACTIVE since {approvedAt!.toLocaleDateString('en-AU')}
            {remainingDays !== null && ` (${remainingDays} day(s) remaining of ${ttlDays}-day TTL)`}
          </Alert>
        ) : approvedAt ? (
          <Alert severity="warning">
            Manager approval EXPIRED or invalid. Cron will skip this clinic until re-approved.
          </Alert>
        ) : (
          <Alert severity="info">
            No active manager approval. Cron will skip this clinic.
          </Alert>
        )}
      </Box>

      {feedback && (
        <Alert
          severity={feedback.kind}
          role="alert"
          sx={{ mb: 2 }}
          onClose={() => setFeedback(null)}
        >
          {feedback.message}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          label="Reason (audit log)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          fullWidth
          multiline
          rows={2}
          size="small"
          slotProps={{ htmlInput: { maxLength: 500 } }}
          helperText="Required. Captured in the audit_log entry for forensic review."
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        <Button
          variant="contained"
          color="success"
          disabled={reason.trim().length === 0 || approveMut.isPending || !state.retentionPurgeEnabled}
          onClick={() => approveMut.mutate()}
        >
          {approveMut.isPending ? 'Approving...' : 'Grant manager approval'}
        </Button>
        {isActive && (
          <Button
            variant="outlined"
            color="warning"
            disabled={revokeMut.isPending}
            onClick={() => revokeMut.mutate()}
          >
            {revokeMut.isPending ? 'Revoking...' : 'Revoke approval'}
          </Button>
        )}
      </Box>
    </Box>
  )
}
