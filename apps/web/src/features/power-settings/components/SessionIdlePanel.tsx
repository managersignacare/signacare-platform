// apps/web/src/features/power-settings/components/SessionIdlePanel.tsx
//
// BUG-P2 — Per-clinic session-idle-timeout configuration (PRES-6 DH-3869).
//
// AHPRA prescribing-compliance mandate: clinical terminals must idle
// out within 15 minutes. Server default is now 15 (was 30 pre-fix).
// Clinics may TIGHTEN below 15 (e.g. high-acuity ward → 5 min) but
// never loosen above. A per-clinic value applies on NEXT login —
// already-active sessions retain whatever timeout was in effect when
// they signed in.
//
// fix-registry anchor: R-FIX-BUG-P2-UI-PANEL.

import { useState, useEffect } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { powerSettingsApi, type SessionIdleState } from '../services/powerSettingsApi'
import { powerSettingsKeys } from '../queryKeys'

interface SessionIdlePanelProps {
  clinicId: string
  isSuperadmin: boolean
}

export function SessionIdlePanel({ clinicId, isSuperadmin }: SessionIdlePanelProps) {
  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: powerSettingsKeys.sessionIdle(clinicId),
    queryFn: () => powerSettingsApi.getSessionIdle(),
  })

  const [minutesInput, setMinutesInput] = useState<string>('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  )

  // Initialise input field with current clinic value (or empty for "use default")
  useEffect(() => {
    if (data) {
      setMinutesInput(
        data.clinicSessionIdleMinutes !== null
          ? String(data.clinicSessionIdleMinutes)
          : '',
      )
    }
  }, [data])

  const setMut = useMutation({
    mutationFn: (minutes: number | null) => powerSettingsApi.setSessionIdle(minutes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: powerSettingsKeys.sessionIdle(clinicId) })
      setFeedback({
        kind: 'success',
        message:
          'Session idle timeout updated. The new value applies on next login — already-active sessions retain their existing timeout.',
      })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { code?: string; error?: string } }; message?: string }
      const code = e?.response?.data?.code
      const msg = e?.response?.data?.error ?? e?.message ?? 'Failed to update session idle timeout'
      if (code === 'PRES6_BOUND_VIOLATION') {
        setFeedback({
          kind: 'error',
          message: `Value must be between ${data?.pres6FloorMinutes ?? 5} and ${data?.pres6CeilingMinutes ?? 15} minutes (PRES-6 DH-3869).`,
        })
      } else if (code === 'FORBIDDEN') {
        setFeedback({ kind: 'error', message: 'Only platform superadmins can change session idle timeout.' })
      } else {
        setFeedback({ kind: 'error', message: msg })
      }
    },
  })

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <CircularProgress role="progressbar" aria-label="Loading" size={20} />
        <Typography variant="body2">Loading session idle configuration…</Typography>
      </Box>
    )
  }

  if (isError) {
    return (
      <Alert severity="error">
        Failed to load session idle configuration: {(error as Error)?.message ?? 'unknown error'}
      </Alert>
    )
  }

  const state = data as SessionIdleState
  const effectiveMinutes = state.clinicSessionIdleMinutes ?? state.serverDefaultMinutes

  const handleSubmit = () => {
    const trimmed = minutesInput.trim()
    if (trimmed === '') {
      // Empty input → clear override (use server default)
      setMut.mutate(null)
      return
    }
    const parsed = parseInt(trimmed, 10)
    if (Number.isNaN(parsed)) {
      setFeedback({ kind: 'error', message: 'Please enter a whole number of minutes (or leave empty to use the default).' })
      return
    }
    setMut.mutate(parsed)
  }

  const handleClear = () => {
    setMinutesInput('')
    setMut.mutate(null)
  }

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        Session Idle Timeout (PRES-6 DH-3869)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Inactive clinical terminals are signed out after this many minutes. AHPRA mandates ≤ 15 min
        for prescribing-capable systems; clinics may tighten further (minimum 5 min) for high-acuity
        wards. Changes apply on the user's NEXT login.
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          Currently: <strong>{effectiveMinutes} minutes</strong>
          {state.clinicSessionIdleMinutes === null && (
            <span> (server default — no clinic override set)</span>
          )}
          {state.clinicSessionIdleMinutes !== null && <span> (clinic override)</span>}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
          Allowed range: {state.pres6FloorMinutes}–{state.pres6CeilingMinutes} minutes (PRES-6
          ceiling: {state.pres6CeilingMinutes}). Server default: {state.serverDefaultMinutes}.
        </Typography>
      </Alert>

      {feedback && (
        <Alert severity={feedback.kind} sx={{ mb: 2 }} onClose={() => setFeedback(null)}>
          {feedback.message}
        </Alert>
      )}

      {isSuperadmin ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <TextField
            label="Clinic override (minutes)"
            type="number"
            inputProps={{
              min: state.pres6FloorMinutes,
              max: state.pres6CeilingMinutes,
              step: 1,
            }}
            value={minutesInput}
            onChange={(e) => setMinutesInput(e.target.value)}
            placeholder={`(${state.pres6FloorMinutes}–${state.pres6CeilingMinutes}; empty → use server default)`}
            size="small"
            sx={{ minWidth: 280 }}
            disabled={setMut.isPending}
          />
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={setMut.isPending}
          >
            {setMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Save'}
          </Button>
          {state.clinicSessionIdleMinutes !== null && (
            <Button variant="outlined" onClick={handleClear} disabled={setMut.isPending}>
              Clear override (use {state.serverDefaultMinutes}-min default)
            </Button>
          )}
        </Box>
      ) : (
        <Alert severity="warning" variant="outlined">
          Only platform superadmins can change this setting.
        </Alert>
      )}
    </Paper>
  )
}
