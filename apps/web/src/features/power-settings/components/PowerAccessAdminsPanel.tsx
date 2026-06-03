import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material'
import { apiClient } from '../../../shared/services/apiClient'
import { powerSettingsKeys } from '../queryKeys'
import { useAllClinics } from '../hooks/usePowerSettings'

interface StaffLite {
  id: string
  givenName: string
  familyName: string
  email: string
  role: string
  is_active?: boolean
}

interface AccessAdmins {
  nominatedAdmin: StaffLite | null
  delegatedAdmin: StaffLite | null
}

export function AccessAdminsPanel() {
  const { data: clinics } = useAllClinics()
  const [selectedClinicId, setSelectedClinicId] = React.useState<string>('')

  React.useEffect(() => {
    if (!selectedClinicId && clinics && clinics.length > 0) {
      setSelectedClinicId(clinics[0].id)
    }
  }, [clinics, selectedClinicId])

  if (!clinics || clinics.length === 0) {
    return <Alert severity="info">No clinics to configure. Onboard a clinic first.</Alert>
  }

  return (
    <Box>
      <Typography variant="h6" mb={1}>Access Administrators</Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Two staff per subscribing organisation are authorised to change access-control
        settings (module grants, role assignments, team assignments). All other admins
        can view but not change. Superadmin assigns these on request from the
        subscribing organisation.
      </Typography>
      <FormControl size="small" sx={{ minWidth: 320, mb: 3 }}>
        <InputLabel>Organisation</InputLabel>
        <Select
          label="Organisation"
          value={selectedClinicId}
          onChange={(e) => setSelectedClinicId(e.target.value)}
        >
          {clinics.map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {selectedClinicId && <AccessAdminsEditor clinicId={selectedClinicId} />}
    </Box>
  )
}

function AccessAdminsEditor({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: powerSettingsKeys.accessAdmins(clinicId),
    queryFn: () => apiClient.get<AccessAdmins>(`power-settings/clinics/${clinicId}/access-admins`),
    enabled: !!clinicId,
  })

  // L5-absorb-1: single canonical endpoint — no fallback. Server
  // returns active, non-operational staff of the target clinic. The
  // endpoint is superadmin-only; the page wrapper already gates to
  // superadmin so no client-side auth check needed here.
  const { data: staffList } = useQuery({
    queryKey: powerSettingsKeys.clinicStaff(clinicId),
    queryFn: () => apiClient.get<StaffLite[]>(`power-settings/clinics/${clinicId}/staff`),
  })

  const [nominatedId, setNominatedId] = React.useState<string>('')
  const [delegatedId, setDelegatedId] = React.useState<string>('')

  React.useEffect(() => {
    if (data) {
      setNominatedId(data.nominatedAdmin?.id ?? '')
      setDelegatedId(data.delegatedAdmin?.id ?? '')
    }
  }, [data])

  const saveMut = useMutation({
    mutationFn: (body: { nominatedAdminStaffId: string | null; delegatedAdminStaffId: string | null }) =>
      apiClient.put(`power-settings/clinics/${clinicId}/access-admins`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: powerSettingsKeys.accessAdmins(clinicId) })
    },
  })

  if (isLoading) return <CircularProgress size={20} />

  const isSame = nominatedId !== '' && delegatedId !== '' && nominatedId === delegatedId
  const canSave = !isSame && !saveMut.isPending

  return (
    <Box sx={{ maxWidth: 600 }}>
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Nominated Admin</InputLabel>
        <Select
          label="Nominated Admin"
          value={nominatedId}
          onChange={(e) => setNominatedId(e.target.value)}
        >
          <MenuItem value="">(none)</MenuItem>
          {(staffList ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.givenName} {s.familyName} ({s.email})
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Delegated Admin</InputLabel>
        <Select
          label="Delegated Admin"
          value={delegatedId}
          onChange={(e) => setDelegatedId(e.target.value)}
        >
          <MenuItem value="">(none)</MenuItem>
          {(staffList ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.givenName} {s.familyName} ({s.email})
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {isSame && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Nominated and Delegated must be different staff members.
        </Alert>
      )}
      {saveMut.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {String((saveMut.error as { response?: { data?: { error?: string } } })?.response?.data?.error
            ?? (saveMut.error as { message?: string })?.message
            ?? 'Failed to save')}
        </Alert>
      )}
      {saveMut.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>Saved. Audit row written.</Alert>
      )}
      <Button
        variant="contained"
        disabled={!canSave}
        onClick={() =>
          saveMut.mutate({
            nominatedAdminStaffId: nominatedId || null,
            delegatedAdminStaffId: delegatedId || null,
          })
        }
      >
        {saveMut.isPending ? 'Saving…' : 'Save'}
      </Button>
    </Box>
  )
}

