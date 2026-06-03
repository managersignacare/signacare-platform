// apps/web/src/features/paediatrics/tabs/ImmunizationsTab.tsx
//
// Multi-specialty Phase 5 (revision) — content-only Immunizations view.
// Embedded as a sub-tab inside PaediatricsTab, which owns the unified
// Clinical Notes sub-tab. CVX-coded, FHIR R5 Immunization-aligned.
import AddIcon from '@mui/icons-material/Add'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  CreateImmunizationSchema,
  ImmunizationStatusEnum,
  ImmunizationSiteEnum,
  ImmunizationRouteEnum,
  type CreateImmunizationDTO,
  type ImmunizationResponse,
  type ImmunizationStatus,
  type ImmunizationSite,
  type ImmunizationRoute,
} from '@signacare/shared'
import { apiClient } from '../../../shared/services/apiClient'

import { immKeys } from '../queryKeys'

interface Props { patientId: string }

const STATUS_COLOR: Record<ImmunizationStatus, 'success' | 'error' | 'warning'> = {
  completed: 'success',
  'entered-in-error': 'error',
  'not-done': 'warning',
}

function useImmunizations(patientId: string) {
  return useQuery<{ items: ImmunizationResponse[] }>({
    queryKey: immKeys.list(patientId),
    queryFn: () =>
      apiClient.get<{ items: ImmunizationResponse[] }>(
        `paediatrics/patients/${patientId}/immunizations`,
      ),
    staleTime: 30_000,
    enabled: !!patientId,
  })
}

function useCreateImmunization(patientId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateImmunizationDTO) =>
      apiClient.post<ImmunizationResponse>(
        `paediatrics/patients/${patientId}/immunizations`,
        dto,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: immKeys.list(patientId) }),
  })
}

interface AddDialogProps { open: boolean; patientId: string; onClose: () => void }

function AddImmunizationDialog({ open, patientId, onClose }: AddDialogProps) {
  const [cvxCode, setCvxCode] = useState('')
  const [vaccineName, setVaccineName] = useState('')
  const [doseNumber, setDoseNumber] = useState('')
  const [administeredDate, setAdministeredDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lotNumber, setLotNumber] = useState('')
  const [site, setSite] = useState<ImmunizationSite | ''>('')
  const [route, setRoute] = useState<ImmunizationRoute | ''>('')
  const [status, setStatus] = useState<ImmunizationStatus>('completed')
  const [note, setNote] = useState('')

  const createMut = useCreateImmunization(patientId)

  const handleSubmit = async () => {
    const payload: CreateImmunizationDTO = CreateImmunizationSchema.parse({
      patientId,
      cvxCode: cvxCode.trim(),
      vaccineName: vaccineName.trim(),
      doseNumber: doseNumber ? parseInt(doseNumber, 10) : null,
      administeredDate,
      lotNumber: lotNumber.trim() || null,
      site: site || null,
      route: route || null,
      status,
      note: note.trim() || null,
    })
    await createMut.mutateAsync(payload)
    setCvxCode('')
    setVaccineName('')
    setDoseNumber('')
    setLotNumber('')
    setNote('')
    onClose()
  }

  const canSave = cvxCode.trim().length > 0 && vaccineName.trim().length > 0

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        Record Immunization
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 4, sm: 3 }}>
            <TextField label="CVX code" fullWidth size="small" value={cvxCode} onChange={(e) => setCvxCode(e.target.value)} placeholder="e.g. 20" />
          </Grid>
          <Grid size={{ xs: 8, sm: 6 }}>
            <TextField label="Vaccine name" fullWidth size="small" value={vaccineName} onChange={(e) => setVaccineName(e.target.value)} placeholder="e.g. DTaP" />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField label="Dose number" type="number" fullWidth size="small" value={doseNumber} onChange={(e) => setDoseNumber(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Administered date" type="date" fullWidth size="small" value={administeredDate}
              onChange={(e) => setAdministeredDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Lot number" fullWidth size="small" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select value={status} onChange={(e) => setStatus(e.target.value as ImmunizationStatus)} label="Status">
                {ImmunizationStatusEnum.options.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Site</InputLabel>
              <Select value={site} onChange={(e) => setSite(e.target.value as ImmunizationSite | '')} label="Site">
                <MenuItem value=""><em>Unspecified</em></MenuItem>
                {ImmunizationSiteEnum.options.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Route</InputLabel>
              <Select value={route} onChange={(e) => setRoute(e.target.value as ImmunizationRoute | '')} label="Route">
                <MenuItem value=""><em>Unspecified</em></MenuItem>
                {ImmunizationRouteEnum.options.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Note" fullWidth size="small" multiline rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={createMut.isPending || !canSave}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {createMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Record'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function ImmunizationsTab({ patientId }: Props) {
  const { data, isLoading } = useImmunizations(patientId)
  const [addOpen, setAddOpen] = useState(false)

  const items = data?.items ?? []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          CVX-coded vaccine records, FHIR R5 Immunization-aligned. Use the CDC CVX code for the
          vaccine, then capture dose number, lot, site and route.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, flexShrink: 0 }}>
          Record Immunization
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                {['Date', 'Vaccine', 'CVX', 'Dose', 'Site / Route', 'Lot', 'Status', 'Administered by'].map((h) => (
                  <TableCell key={h} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12, color: '#3D484B', backgroundColor: '#FAFAFA' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={8} align="center"><CircularProgress size={22} /></TableCell></TableRow>
              )}
              {!isLoading && items.length === 0 && (
                <TableRow><TableCell colSpan={8} align="center">
                  <Typography variant="body2" color="text.secondary">No immunizations recorded.</Typography>
                </TableCell></TableRow>
              )}
              {items.map((i) => (
                <TableRow key={i.id} hover>
                  <TableCell>{i.administeredDate}</TableCell>
                  <TableCell><Typography variant="body2" fontWeight={500}>{i.vaccineName}</Typography></TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{i.cvxCode}</TableCell>
                  <TableCell>{i.doseNumber ?? '—'}{i.seriesDoses ? `/${i.seriesDoses}` : ''}</TableCell>
                  <TableCell>
                    <Typography variant="caption">{i.site ?? '—'}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{i.route ?? ''}</Typography>
                  </TableCell>
                  <TableCell>{i.lotNumber ?? '—'}</TableCell>
                  <TableCell><Chip size="small" label={i.status} color={STATUS_COLOR[i.status]} /></TableCell>
                  <TableCell>{i.administeredByName ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

      <AddImmunizationDialog open={addOpen} patientId={patientId} onClose={() => setAddOpen(false)} />
    </Box>
  )
}

export default ImmunizationsTab
