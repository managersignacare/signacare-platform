// apps/web/src/features/settings/components/ClinicProfilePanel.tsx
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
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '../../../shared/services/apiClient'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clinicProfileKeys } from '../queryKeys'

const ClinicProfileSchema = z.object({
  name: z.string().min(1),
  abn: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  triageNumber: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressState: z.string().optional(),
  addressPostcode: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
})

type ClinicProfileForm = z.infer<typeof ClinicProfileSchema>

function useClinicProfile() {
  return useQuery({
    queryKey: clinicProfileKeys.all,
    queryFn: () =>
      apiClient.get<ClinicProfileForm>('clinics/me'),
  })
}

function useUpdateClinicProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ClinicProfileForm) =>
      apiClient.patch<void>('clinics/me', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: clinicProfileKeys.all }),
  })
}

export const ClinicProfilePanel: React.FC = () => {
  const { data, isLoading, isError } = useClinicProfile()
  const { mutateAsync: update, isPending } = useUpdateClinicProfile()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClinicProfileForm>({
    resolver: zodResolver(ClinicProfileSchema),
  })

  React.useEffect(() => {
    if (data) reset(data)
  }, [data, reset])

  const onSubmit = async (values: ClinicProfileForm) => {
    await update(values)
  }

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />
  if (isError) return <Alert role="alert" severity="error">Failed to load clinic profile.</Alert>

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <Typography variant="h6" mb={2}>
        Clinic Profile
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid>
          <TextField
            label="Clinic name"
            fullWidth
            size="small"
            error={!!errors.name}
            helperText={errors.name?.message}
            {...register('name')}
          />
        </Grid>
        <Grid>
          <TextField label="ABN" fullWidth size="small" {...register('abn')} />
        </Grid>
        <Grid>
          <TextField label="Phone" fullWidth size="small" {...register('phone')} />
        </Grid>
        <Grid>
          <TextField label="Triage / Crisis Number (Viva App)" fullWidth size="small" {...register('triageNumber')}
            helperText="Displayed in patient Viva app under Emergency Help" />
        </Grid>
        <Grid>
          <TextField
            label="Email"
            fullWidth
            size="small"
            error={!!errors.email}
            helperText={errors.email?.message}
            {...register('email')}
          />
        </Grid>
        <Grid>
          <TextField
            label="Street address"
            fullWidth
            size="small"
            {...register('addressStreet')}
          />
        </Grid>
        <Grid>
          <TextField
            label="Suburb"
            fullWidth
            size="small"
            {...register('addressSuburb')}
          />
        </Grid>
        <Grid>
          <TextField
            label="State"
            fullWidth
            size="small"
            {...register('addressState')}
          />
        </Grid>
        <Grid>
          <TextField
            label="Postcode"
            fullWidth
            size="small"
            {...register('addressPostcode')}
          />
        </Grid>
        <Grid>
          <TextField
            label="Website"
            fullWidth
            size="small"
            error={!!errors.website}
            helperText={errors.website?.message}
            {...register('website')}
          />
        </Grid>
      </Grid>
      <Box mt={3} display="flex" justifyContent="flex-end">
        <Button
          type="submit"
          variant="contained"
          disabled={isPending}
          startIcon={isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : undefined}
        >
          Save Profile
        </Button>
      </Box>
    </Box>
  )
}

