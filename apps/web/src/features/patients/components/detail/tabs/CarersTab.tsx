/**
 * Carers & Family Tab
 */
import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControlLabel, Grid, Switch, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PeopleIcon from '@mui/icons-material/People';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { patientsKeys } from '../../../queryKeys';

interface Carer {
  id: string; carer_name: string; relationship: string; phone: string; email: string;
  is_primary: boolean; is_nominated_person: boolean; consent_to_share: boolean;
  carer_needs: string; carer_plan: string; status: string; carer_assessment_date: string;
}

interface CarerForm {
  carerName?: string;
  relationship?: string;
  phone?: string;
  email?: string;
  address?: string;
  isPrimary?: boolean;
  isNominatedPerson?: boolean;
  consentToShare?: boolean;
  carerNeeds?: string;
  carerPlan?: string;
}

interface CreateCarerRequest extends CarerForm {
  patientId: string;
}

interface CarersTabProps { patientId: string }
export default function CarersTab({ patientId }: CarersTabProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<CarerForm>({});

  const { data: carers, isLoading } = useQuery({
    queryKey: patientsKeys.carers(patientId),
    queryFn: () => apiClient.get<Carer[]>(`carers/patient/${patientId}`),
    enabled: !!patientId,
  });

  const saveMut = useMutation({
    mutationFn: (data: CreateCarerRequest) => apiClient.post('carers', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: patientsKeys.carers(patientId) }); setAddOpen(false); setForm({}); },
  });

  const activeCarers = (carers ?? []).filter(c => c.status === 'active');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PeopleIcon sx={{ color: '#327C8D' }} />
          <Typography variant="h6" fontWeight={600}>Carers & Family</Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none', fontSize: 12 }}>
          Add Carer
        </Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {!isLoading && activeCarers.length === 0 && (
        <Alert severity="info">No carers registered. Under the Mental Health Act, carer involvement in treatment planning is encouraged where appropriate.</Alert>
      )}

      <Grid container spacing={2}>
        {activeCarers.map(c => (
          <Grid key={c.id} size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={{ borderColor: c.is_primary ? '#327C8D' : 'divider' }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>{c.carer_name}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {c.is_primary && <Chip label="Primary" size="small" sx={{ fontSize: 9, bgcolor: '#327C8D', color: '#fff' }} />}
                    {c.is_nominated_person && <Chip label="Nominated Person" size="small" sx={{ fontSize: 9, bgcolor: '#1565C0', color: '#fff' }} />}
                    {c.consent_to_share && <Chip label="Consent to Share" size="small" color="success" sx={{ fontSize: 9 }} />}
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary">{c.relationship}</Typography>
                {c.phone && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                    <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="body2">{c.phone}</Typography>
                  </Box>
                )}
                {c.email && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                    <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="body2">{c.email}</Typography>
                  </Box>
                )}
                {c.carer_needs && (
                  <>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" fontWeight={600} color="#327C8D">Carer Needs</Typography>
                    <Typography variant="body2" sx={{ fontSize: 12 }}>{c.carer_needs}</Typography>
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Add Carer Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Add Carer / Family Member</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField label="Full Name *" fullWidth size="small" value={form.carerName ?? ''} onChange={e => setForm(p => ({ ...p, carerName: e.target.value }))} /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Relationship" fullWidth size="small" value={form.relationship ?? ''} onChange={e => setForm(p => ({ ...p, relationship: e.target.value }))} placeholder="e.g. Parent, Spouse, Sibling" /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Phone" fullWidth size="small" value={form.phone ?? ''} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Email" fullWidth size="small" value={form.email ?? ''} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Address" fullWidth size="small" multiline rows={2} value={form.address ?? ''} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></Grid>
            <Grid size={{ xs: 4 }}><FormControlLabel control={<Switch size="small" checked={form.isPrimary ?? false} onChange={(_, v) => setForm(p => ({ ...p, isPrimary: v }))} />} label={<Typography variant="body2">Primary Carer</Typography>} /></Grid>
            <Grid size={{ xs: 4 }}><FormControlLabel control={<Switch size="small" checked={form.isNominatedPerson ?? false} onChange={(_, v) => setForm(p => ({ ...p, isNominatedPerson: v }))} />} label={<Typography variant="body2">Nominated Person</Typography>} /></Grid>
            <Grid size={{ xs: 4 }}><FormControlLabel control={<Switch size="small" checked={form.consentToShare ?? false} onChange={(_, v) => setForm(p => ({ ...p, consentToShare: v }))} />} label={<Typography variant="body2">Consent to Share</Typography>} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Carer Needs Assessment" fullWidth size="small" multiline rows={2} value={form.carerNeeds ?? ''} onChange={e => setForm(p => ({ ...p, carerNeeds: e.target.value }))} placeholder="Carer support needs, respite requirements, information needs..." /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Carer Support Plan" fullWidth size="small" multiline rows={2} value={form.carerPlan ?? ''} onChange={e => setForm(p => ({ ...p, carerPlan: e.target.value }))} placeholder="Planned supports for the carer..." /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => saveMut.mutate({ patientId, ...form })}
            disabled={saveMut.isPending || !form.carerName}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {saveMut.isPending ? 'Saving...' : 'Add Carer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
