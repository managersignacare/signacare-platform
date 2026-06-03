// apps/web/src/features/settings/components/ThresholdsPanel.tsx
import React from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  TextField,
  Typography,
  Alert,
} from '@mui/material'
import { useForm, Controller } from 'react-hook-form'
import { useThresholds, useBulkSetThresholds } from '../hooks/useSettings'

const THRESHOLD_LABELS: Record<string, string> = {
  referralunattendeddays: 'Referral unattended (days)',
  referralurgentunattendeddays: 'Urgent referral unattended (days)',
  referralemergencyunattendedhours: 'Emergency referral unattended (hours)',
  patientmissedappointmentstrigger: 'Missed appointments before trigger',
  laioverduedays: 'LAI overdue threshold (days)',
  clozapinebloodoverduedays: 'Clozapine blood overdue (days)',
  mhaexpirywarningdays: 'MH Act expiry warning (days)',
  aimsoverduedays: 'AIMS overdue threshold (days)',
  taskoverduehours: 'Task overdue (hours)',
  invoiceoverduedays: 'Invoice overdue (days)',
  appointmentreminderweekdays: 'Appointment reminder — weeks before (days)',
  appointmentreminderdays: 'Appointment reminder — days before',
  appointmentreminderhours: 'Appointment reminder — hours before',
}

export const ThresholdsPanel: React.FC = () => {
  const { data: thresholds, isLoading, isError } = useThresholds()
  const { mutateAsync: bulkSet, isPending } = useBulkSetThresholds()

  const { control, handleSubmit, reset } = useForm<Record<string, number>>()

  React.useEffect(() => {
    if (thresholds) reset(thresholds)
  }, [thresholds, reset])

  const onSubmit = async (values: Record<string, number>) => {
    await bulkSet(values)
  }

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />
  if (isError) return <Alert role="alert" severity="error">Failed to load thresholds.</Alert>

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <Typography variant="h6" mb={2}>
        Clinical Alert Thresholds
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        {Object.entries(THRESHOLD_LABELS).map(([key, label]) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={key}>
            <Controller
              name={key}
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label={label}
                  type="number"
                  size="small"
                  fullWidth
                  inputProps={{ min: 0, step: 1 }}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              )}
            />
          </Grid>
        ))}
      </Grid>
      <Box mt={3} display="flex" justifyContent="flex-end">
        <Button
          type="submit"
          variant="contained"
          disabled={isPending}
          startIcon={isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : undefined}
        >
          Save Thresholds
        </Button>
      </Box>
    </Box>
  )
}

