import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { apiClient } from '../../../shared/services/apiClient'
import {
  staffKeys,
} from '../queryKeys'
import { useDisciplines } from '../hooks/useStaffSettings'
import {
  readStaffApiError,
  type StaffCreateResponse,
} from '../pages/staffAssignmentsPageSupport'
import {
  isPrescriberSystemRole,
  STAFF_PROVIDER_TYPES,
  STAFF_SYSTEM_ROLES,
  type StaffProviderNumber,
} from './staffFormModel'


interface StaffOnboardDialogProps {
  open: boolean
  clinicId?: string
  isSuperadmin: boolean
  onClose: () => void
}

export function StaffOnboardDialog({ open, clinicId, isSuperadmin, onClose }: StaffOnboardDialogProps) {
  const qc = useQueryClient()
  const [givenName, setGivenName] = React.useState('')
  const [familyName, setFamilyName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [discipline, setDiscipline] = React.useState('')
  const [role, setRole] = React.useState('clinician')
  const [settingsProfileTabVisible, setSettingsProfileTabVisible] = React.useState(false)
  const [ahpraNumber, setAhpraNumber] = React.useState('')
  const [ahpraExpiry, setAhpraExpiry] = React.useState('')
  const [isPrescriber, setIsPrescriber] = React.useState(false)
  const [prescriberNumber, setPrescriberNumber] = React.useState('')
  const [providerNumbers, setProviderNumbers] = React.useState<StaffProviderNumber[]>([])
  const [phiProvider, setPhiProvider] = React.useState('')
  const [phiNumber, setPhiNumber] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const { data: disciplineOptions } = useDisciplines(isSuperadmin ? clinicId : undefined)
  const roleGrantsPrescribing = isPrescriberSystemRole(role)

  React.useEffect(() => {
    setIsPrescriber(roleGrantsPrescribing)
    if (!roleGrantsPrescribing) {
      setPrescriberNumber('')
    }
  }, [roleGrantsPrescribing])

  const addProviderNumber = () => {
    setProviderNumbers(prev => [...prev, { number: '', location: '', type: 'Medicare' }])
  }
  const updateProviderNumber = (idx: number, field: keyof StaffProviderNumber, value: string) => {
    setProviderNumbers(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }
  const removeProviderNumber = (idx: number) => {
    setProviderNumbers(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    if (!givenName.trim() || !familyName.trim() || !email.trim() || !discipline.trim()) return
    if (isSuperadmin && !clinicId) {
      alert('Select a clinic scope before onboarding staff.')
      return
    }
    setSaving(true)
    try {
      const newStaff = await apiClient.post<StaffCreateResponse>('staff', {
        clinicId: isSuperadmin ? clinicId : undefined,
        givenName: givenName.trim(),
        familyName: familyName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        discipline,
        role,
        settingsProfileTabVisible,
        ahpraNumber: ahpraNumber.trim() || undefined,
        ahpraExpiry: ahpraExpiry || undefined,
        isPrescriber,
        prescriberNumber: prescriberNumber.trim() || undefined,
        providerNumbers: providerNumbers.filter(p => p.number.trim()),
        phiProvider: phiProvider.trim() || undefined,
        phiNumber: phiNumber.trim() || undefined,
      })
      qc.invalidateQueries({ queryKey: staffKeys.all })

      const tempPw = newStaff.temporaryPassword ?? newStaff.data?.temporaryPassword
      if (tempPw) {
        alert(`Staff created successfully.\n\nTemporary login password (share with staff member):\n\n${tempPw}\n\nThey will be asked to change it on first login.`)
      }

      onClose()
      setGivenName(''); setFamilyName(''); setEmail(''); setPhone('')
      setDiscipline(''); setRole('clinician'); setAhpraNumber(''); setAhpraExpiry('')
      setSettingsProfileTabVisible(false)
      setIsPrescriber(false); setPrescriberNumber(''); setProviderNumbers([])
      setPhiProvider(''); setPhiNumber('')
    } catch (err: unknown) {
      alert(`Failed to save: ${readStaffApiError(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>Staff Onboarding</DialogTitle>
      <Divider />
      <DialogContent>
        {isSuperadmin && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Staff account will be created for clinic: <code>{clinicId ?? 'not selected'}</code>
          </Alert>
        )}
        {(disciplineOptions ?? []).length === 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No active professional disciplines found for this clinic. Add disciplines in Staff Settings before onboarding staff.
          </Alert>
        )}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}><Typography variant="subtitle2" fontWeight={600} color="#327C8D">Personal Details</Typography></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Given Name *" fullWidth size="small" value={givenName} onChange={e => setGivenName(e.target.value)} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Family Name *" fullWidth size="small" value={familyName} onChange={e => setFamilyName(e.target.value)} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small"><InputLabel>Discipline *</InputLabel>
              <Select value={discipline} onChange={e => setDiscipline(e.target.value)} label="Discipline *">
                {(disciplineOptions ?? []).map((disciplineOption) => (
                  <MenuItem key={disciplineOption.id} value={disciplineOption.id}>{disciplineOption.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Email *" fullWidth size="small" type="email" value={email} onChange={e => setEmail(e.target.value)} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField label="Phone" fullWidth size="small" value={phone} onChange={e => setPhone(e.target.value)} placeholder="04xx xxx xxx" /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small"><InputLabel>System Role</InputLabel>
              <Select value={role} onChange={e => setRole(e.target.value)} label="System Role">
                {STAFF_SYSTEM_ROLES.map((systemRole) => (
                  <MenuItem key={systemRole} value={systemRole} sx={{ textTransform: 'capitalize' }}>
                    {systemRole.replace(/_/g, ' ')}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={settingsProfileTabVisible}
                  onChange={(_, checked) => setSettingsProfileTabVisible(checked)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Allow Settings -&gt; My Profile for this staff member</Typography>}
            />
          </Grid>

          <Grid size={{ xs: 12 }}><Divider><Typography variant="caption">AHPRA Registration</Typography></Divider></Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="AHPRA Number" fullWidth size="small" value={ahpraNumber} onChange={e => setAhpraNumber(e.target.value)}
              placeholder="e.g. MED0001234567" helperText="Australian Health Practitioner Regulation Agency" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="AHPRA Expiry" type="date" fullWidth size="small" value={ahpraExpiry}
              onChange={e => setAhpraExpiry(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>

          <Grid size={{ xs: 12 }}><Divider><Typography variant="caption">Prescriber Details</Typography></Divider></Grid>
          <Grid size={{ xs: 12 }}>
            <Alert severity={roleGrantsPrescribing ? 'info' : 'warning'}>
              Prescribing privileges now come from the selected system role. Only prescriber consultant, registrar, HMO, and nurse practitioner roles can prescribe.
            </Alert>
          </Grid>
          {roleGrantsPrescribing && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="PBS Prescriber Number" fullWidth size="small" value={prescriberNumber}
                onChange={e => setPrescriberNumber(e.target.value)} placeholder="e.g. 1234567A"
                helperText="Required for PBS prescriptions" />
            </Grid>
          )}

          <Grid size={{ xs: 12 }}>
            <Divider><Typography variant="caption">Provider Numbers</Typography></Divider>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Medicare/DVA provider numbers are location-specific. Add one for each practice location.
            </Typography>
          </Grid>
          {providerNumbers.map((pn, idx) => (
            <React.Fragment key={idx}>
              <Grid size={{ xs: 12, sm: 3 }}>
                <FormControl fullWidth size="small"><InputLabel>Type</InputLabel>
                  <Select value={pn.type} onChange={e => updateProviderNumber(idx, 'type', e.target.value)} label="Type">
                    {STAFF_PROVIDER_TYPES.map((providerType) => (
                      <MenuItem key={providerType} value={providerType}>{providerType}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Provider Number" fullWidth size="small" value={pn.number}
                  onChange={e => updateProviderNumber(idx, 'number', e.target.value)} placeholder="e.g. 1234567A" />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Location" fullWidth size="small" value={pn.location}
                  onChange={e => updateProviderNumber(idx, 'location', e.target.value)} placeholder="e.g. Main Clinic, Satellite" />
              </Grid>
              <Grid size={{ xs: 12, sm: 1 }} sx={{ display: 'flex', alignItems: 'center' }}>
                <IconButton size="small" onClick={() => removeProviderNumber(idx)} color="error"><DeleteIcon fontSize="small" /></IconButton>
              </Grid>
            </React.Fragment>
          ))}
          <Grid size={{ xs: 12 }}>
            <Button size="small" startIcon={<AddIcon />} onClick={addProviderNumber}
              sx={{ fontSize: 12, color: '#327C8D' }}>Add Provider Number</Button>
          </Grid>

          <Grid size={{ xs: 12 }}><Divider><Typography variant="caption">Private Health Insurance</Typography></Divider></Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="PHI Provider" fullWidth size="small" value={phiProvider}
              onChange={e => setPhiProvider(e.target.value)} placeholder="e.g. Medibank, BUPA, HCF" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="PHI Provider Number" fullWidth size="small" value={phiNumber}
              onChange={e => setPhiNumber(e.target.value)} placeholder="PHI-specific provider ID" />
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}
          disabled={!givenName.trim() || !familyName.trim() || !email.trim() || !discipline.trim() || saving}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Onboard Staff'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
