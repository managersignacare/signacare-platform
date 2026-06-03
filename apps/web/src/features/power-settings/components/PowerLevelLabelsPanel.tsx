import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { powerSettingsApi } from '../services/powerSettingsApi'
import { powerSettingsKeys } from '../queryKeys'
import { useAllClinics } from '../hooks/usePowerSettings'

const DEFAULT_LABELS = [
  'Organisation',
  'Division',
  'Service',
  'Program Area',
  'Team',
  'Sub-Team',
  'Level 7',
  'Level 8',
  'Level 9',
  'Level 10',
]

export function PowerLevelLabelsPanel() {
  const { data: clinics, isLoading: clinicsLoading } = useAllClinics()
  const qc = useQueryClient()
  const [selectedClinicId, setSelectedClinicId] = React.useState<string>('')
  const [labels, setLabels] = React.useState<string[]>(DEFAULT_LABELS)
  const [success, setSuccess] = React.useState(false)

  React.useEffect(() => {
    if (!selectedClinicId && clinics && clinics.length > 0) {
      setSelectedClinicId(clinics[0].id)
    }
  }, [clinics, selectedClinicId])

  const { data: savedLabels, isLoading: labelsLoading } = useQuery({
    queryKey: powerSettingsKeys.levelLabels(selectedClinicId),
    enabled: selectedClinicId.length > 0,
    queryFn: () => powerSettingsApi.getClinicLevelLabels(selectedClinicId),
  })

  React.useEffect(() => {
    if (!savedLabels) return
    const merged = [...DEFAULT_LABELS]
    for (const entry of savedLabels) {
      if (entry.level >= 1 && entry.level <= 10) {
        merged[entry.level - 1] = entry.label
      }
    }
    setLabels(merged)
  }, [savedLabels])

  const saveMut = useMutation({
    mutationFn: (payload: Array<{ level: number; label: string }>) =>
      powerSettingsApi.setClinicLevelLabels(selectedClinicId, payload),
    onSuccess: () => {
      setSuccess(true)
      qc.invalidateQueries({ queryKey: powerSettingsKeys.levelLabels(selectedClinicId) })
    },
  })

  const isLoading = clinicsLoading || labelsLoading
  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress role="progressbar" aria-label="Loading" />
      </Box>
    )
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" mb={1}>
          Organisation Level Labels
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Configure hierarchy labels per clinic. These labels are used in organisation trees and filters.
        </Typography>

        <TextField
          select
          label="Select Subscriber (Clinic)"
          fullWidth
          size="small"
          value={selectedClinicId}
          onChange={(e) => setSelectedClinicId(e.target.value)}
          sx={{ mb: 3 }}
        >
          {clinics?.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>

        <Grid container spacing={2}>
          {labels.map((label, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={`level-${index + 1}`}>
              <TextField
                label={`Level ${index + 1}`}
                fullWidth
                size="small"
                value={label}
                onChange={(e) => {
                  const next = [...labels]
                  next[index] = e.target.value
                  setLabels(next)
                  setSuccess(false)
                }}
              />
            </Grid>
          ))}
        </Grid>

        {success && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Level labels saved.
          </Alert>
        )}

        {saveMut.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {String((saveMut.error as { message?: string })?.message ?? 'Failed to save level labels')}
          </Alert>
        )}

        <Box mt={3} display="flex" justifyContent="flex-end">
          <Button
            variant="contained"
            disabled={saveMut.isPending || !selectedClinicId}
            startIcon={saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : undefined}
            onClick={() => {
              const payload = labels.map((value, index) => ({
                level: index + 1,
                label: value.trim().length > 0 ? value.trim() : `Level ${index + 1}`,
              }))
              saveMut.mutate(payload)
            }}
          >
            Save Labels
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}

