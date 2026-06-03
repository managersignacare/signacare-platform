// apps/web/src/features/settings/components/ErxConfigPanel.tsx
//
// BUG-339 — per-clinic eRx identity configuration: HPI-O, NPDS
// Conformance ID, ETP1 Site ID. Admin-only tab on OrgSettingsPage.
//
// Load: GET /clinics/me — returns the existing values (null when unset).
// Save: PATCH /clinics/me with the three fields + any edits.
// Verify HPI-O: POST /hi-service/verify-hpio — live lookup via NASH mTLS
//   (BUG-297). In stub mode (no NASH cert), response contains
//   error: '…unverified'; the panel surfaces a warning banner but
//   permits save.
//
// Once ops backfills all 7 clinics, STRICT_NPDS_CONFORMANCE and
// STRICT_ERX_HPIO flip server-side. Pair with BUG-334 NOT NULL
// migration on clinics.hpio.
import React from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClinicUpdateSchema,
  type ClinicUpdateDTO,
  type HpioVerifyResponse,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'
import { clinicProfileKeys, erxConfigKeys } from '../queryKeys'
import { hiServiceApi } from '../services/hiServiceApi'

interface ClinicResponse {
  id: string
  hpio: string | null
  npdsConformanceId: string | null
  erxEtp1SiteId: string | null
}

type ErxForm = Pick<ClinicUpdateDTO, 'hpio' | 'npdsConformanceId' | 'erxEtp1SiteId'>

function useClinicErxConfig() {
  return useQuery({
    queryKey: erxConfigKeys.all,
    queryFn: () => apiClient.get<ClinicResponse>('clinics/me'),
  })
}

function useUpdateClinicErxConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ErxForm) => apiClient.patch<ClinicResponse>('clinics/me', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: erxConfigKeys.all })
      qc.invalidateQueries({ queryKey: clinicProfileKeys.all })
    },
  })
}

export const ErxConfigPanel: React.FC = () => {
  const { data, isLoading, isError } = useClinicErxConfig()
  const { mutateAsync: update, isPending: isSaving, error: saveError } = useUpdateClinicErxConfig()
  const [verifyResult, setVerifyResult] = React.useState<HpioVerifyResponse | null>(null)
  const [verifyError, setVerifyError] = React.useState<string | null>(null)
  const [isVerifying, setIsVerifying] = React.useState(false)
  const [saveSuccess, setSaveSuccess] = React.useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ErxForm>({
    resolver: zodResolver(
      ClinicUpdateSchema.pick({
        hpio: true,
        npdsConformanceId: true,
        erxEtp1SiteId: true,
      }),
    ),
  })

  React.useEffect(() => {
    if (data) {
      reset({
        hpio: data.hpio ?? undefined,
        npdsConformanceId: data.npdsConformanceId,
        erxEtp1SiteId: data.erxEtp1SiteId,
      })
    }
  }, [data, reset])

  const hpioValue = watch('hpio')

  const handleVerifyHpio = async () => {
    if (!hpioValue) {
      setVerifyError('Enter HPI-O before verifying')
      setVerifyResult(null)
      return
    }
    setIsVerifying(true)
    setVerifyError(null)
    setVerifyResult(null)
    try {
      const result = await hiServiceApi.verifyHpio(hpioValue)
      setVerifyResult(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed'
      setVerifyError(msg)
    } finally {
      setIsVerifying(false)
    }
  }

  const onSubmit = async (values: ErxForm) => {
    setSaveSuccess(false)
    await update({
      hpio: values.hpio?.trim() || undefined,
      npdsConformanceId: values.npdsConformanceId ?? null,
      erxEtp1SiteId: values.erxEtp1SiteId ?? null,
    })
    setSaveSuccess(true)
  }

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />
  if (isError) return <Alert role="alert" severity="error">Failed to load clinic eRx configuration.</Alert>

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <Typography variant="h6" mb={0.5}>eRx Configuration</Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Healthcare Provider Identifier - Organisation (HPI-O), NPDS Conformance ID, and
        eRx ETP1 Site ID are required to submit electronic prescriptions. HPI-O can be
        verified live against the HI Service.
      </Typography>
      <Divider sx={{ mb: 3 }} />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <TextField
            label="HPI-O (Healthcare Provider Identifier - Organisation)"
            fullWidth
            size="small"
            placeholder="16-digit identifier starting with 800362"
            error={!!errors.hpio}
            helperText={
              errors.hpio?.message ??
              'Format: 800362 + 10 digits with valid Luhn checksum.'
            }
            {...register('hpio')}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Button
            variant="outlined"
            fullWidth
            onClick={handleVerifyHpio}
            disabled={isVerifying || !hpioValue}
            startIcon={isVerifying ? <CircularProgress size={14} /> : undefined}
          >
            {isVerifying ? 'Verifying…' : 'Verify HPI-O'}
          </Button>
        </Grid>

        {verifyResult && verifyResult.found && !verifyResult.error && (
          <Grid size={{ xs: 12 }}>
            <Alert
              severity="success"
              icon={<CheckCircleIcon fontSize="inherit" />}
              role="status"
            >
              Verified: {verifyResult.name ?? 'organisation'}
              {verifyResult.organisationType ? ` (${verifyResult.organisationType})` : ''}
            </Alert>
          </Grid>
        )}
        {verifyResult && verifyResult.found && verifyResult.error && (
          <Grid size={{ xs: 12 }}>
            <Alert
              severity="warning"
              icon={<WarningAmberIcon fontSize="inherit" />}
              role="status"
            >
              Format valid but unverified: {verifyResult.error}
            </Alert>
          </Grid>
        )}
        {verifyResult && !verifyResult.found && (
          <Grid size={{ xs: 12 }}>
            <Alert severity="error" role="alert">
              Not found: {verifyResult.error ?? 'HI Service returned no match'}
            </Alert>
          </Grid>
        )}
        {verifyError && (
          <Grid size={{ xs: 12 }}>
            <Alert severity="error" role="alert">{verifyError}</Alert>
          </Grid>
        )}

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="NPDS Conformance ID"
            fullWidth
            size="small"
            placeholder="Issued by the NPDS conformance programme"
            error={!!errors.npdsConformanceId}
            helperText={errors.npdsConformanceId?.message}
            {...register('npdsConformanceId')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="eRx ETP1 Site ID"
            fullWidth
            size="small"
            placeholder="Site identifier for eRx ETP1 Adapter"
            error={!!errors.erxEtp1SiteId}
            helperText={errors.erxEtp1SiteId?.message}
            {...register('erxEtp1SiteId')}
          />
        </Grid>
      </Grid>

      {saveError && (
        <Alert severity="error" role="alert" sx={{ mt: 2 }}>
          {saveError instanceof Error ? saveError.message : 'Failed to save'}
        </Alert>
      )}
      {saveSuccess && (
        <Alert severity="success" role="status" sx={{ mt: 2 }}>
          eRx configuration saved.
        </Alert>
      )}

      <Box mt={3} display="flex" justifyContent="flex-end">
        <Button
          type="submit"
          variant="contained"
          disabled={isSaving}
          startIcon={isSaving ? <CircularProgress size={14} /> : undefined}
        >
          {isSaving ? 'Saving…' : 'Save Configuration'}
        </Button>
      </Box>
    </Box>
  )
}
