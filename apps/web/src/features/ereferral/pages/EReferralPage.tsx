import { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem, Paper, Select,
  Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs,
  TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SendIcon from '@mui/icons-material/Send';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { ListExportBar } from '../../../shared/components/ui/ListExportBar';
import { ereferralKeys } from '../queryKeys';

const URGENCY_COLORS: Record<string, string> = { emergency: '#D32F2F', urgent: '#E65100', semi_urgent: '#b8621a', routine: '#327C8D' };

interface EReferralContent {
  referredToService?: string;
  referredToClinician?: string;
}

interface EReferralRow {
  id: string;
  givenName?: string;
  familyName?: string;
  emrNumber?: string;
  referred_to_service?: string;
  referred_to_clinician?: string;
  referredToService?: string;
  referredToClinician?: string;
  urgency?: string;
  priority?: string;
  status?: string;
  reason?: string;
  createdAt?: string;
  created_at?: string;
  content?: string | EReferralContent | null;
}

interface EReferralFormState {
  urgency: string;
  patientId?: string;
  referredToService?: string;
  referredToClinician?: string;
  referredToEmail?: string;
  reason?: string;
  clinicalSummary?: string;
  diagnosis?: string;
  riskSummary?: string;
}

function parseEReferralContent(content: EReferralRow['content']): EReferralContent {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content) as EReferralContent;
    } catch {
      return {};
    }
  }
  if (content && typeof content === 'object') return content;
  return {};
}

function getReferralRecipient(row: EReferralRow): string {
  const content = parseEReferralContent(row.content);
  return row.referred_to_service
    ?? row.referredToService
    ?? content.referredToService
    ?? row.referred_to_clinician
    ?? row.referredToClinician
    ?? content.referredToClinician
    ?? '—';
}

function getReferralUrgency(row: EReferralRow): string {
  return row.urgency ?? row.priority ?? 'routine';
}

function formatReferralDate(row: EReferralRow): string {
  const raw = row.createdAt ?? row.created_at;
  if (!raw) return '';
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-AU');
}

export default function EReferralPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'outbound' | 'inbound'>('outbound');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<EReferralFormState>({ urgency: 'routine' });

  const { data: referrals = [], isLoading } = useQuery({
    queryKey: ereferralKeys.list(tab),
    queryFn: () => apiClient.get<EReferralRow[]>(`ereferrals?direction=${tab}`),
  });

  const createMut = useMutation({
    mutationFn: (data: EReferralFormState) => apiClient.post('ereferrals', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ereferralKeys.all }); setAddOpen(false); setForm({ urgency: 'routine' }); },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`ereferrals/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ereferralKeys.all }),
  });

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SwapHorizIcon sx={{ color: '#327C8D', fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">E-Referrals</Typography>
            <Typography variant="body2" color="text.secondary">Electronic referral management</Typography>
          </Box>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
          New Referral
        </Button>
      </Box>

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}>
        <Tab label="Outbound Referrals" value="outbound" />
        <Tab label="Inbound Referrals" value="inbound" />
      </Tabs>

      {isLoading ? <CircularProgress role="progressbar" aria-label="Loading" /> : (
        <>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
          <ListExportBar compact title="E-Referrals" subtitle={`${referrals.length} referrals`}
            columns={['Patient', 'UR', 'Referred To', 'Urgency', 'Status', 'Date']}
            rows={referrals.map((r: EReferralRow) => [
              `${r.givenName ?? ''} ${r.familyName ?? ''}`, r.emrNumber ?? '',
              getReferralRecipient(r), getReferralUrgency(r), r.status ?? '',
              formatReferralDate(r),
            ])} />
        </Box>
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                <TableCell sx={{ fontWeight: 600 }}>Patient</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>UR</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{tab === 'outbound' ? 'Referred To' : 'Referred From'}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Urgency</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Reason</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {referrals.length === 0 && (
                <TableRow><TableCell colSpan={8}><Alert severity="info">No {tab} referrals.</Alert></TableCell></TableRow>
              )}
              {referrals.map((r: EReferralRow) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontWeight: 500 }}>{r.givenName} {r.familyName}</TableCell>
                  <TableCell>{r.emrNumber}</TableCell>
                  <TableCell>{getReferralRecipient(r)}</TableCell>
                  <TableCell><Chip label={getReferralUrgency(r)} size="small" sx={{ fontSize: 10, bgcolor: URGENCY_COLORS[getReferralUrgency(r)] ?? '#999', color: '#fff' }} /></TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</TableCell>
                  <TableCell><Chip label={r.status ?? 'pending'} size="small" color={r.status === 'accepted' ? 'success' : r.status === 'declined' ? 'error' : 'default'} sx={{ fontSize: 10 }} /></TableCell>
                  <TableCell>{formatReferralDate(r)}</TableCell>
                  <TableCell>
                    {r.status === 'pending' && (
                      <Button size="small" variant="outlined" startIcon={<SendIcon />} onClick={() => updateStatus.mutate({ id: r.id, status: 'sent' })}
                        sx={{ fontSize: 10, textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>Send</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        </>
      )}

      {/* New Referral Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>New E-Referral</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField label="Patient ID" fullWidth size="small" value={form.patientId ?? ''} onChange={e => setForm(p => ({ ...p, patientId: e.target.value }))} placeholder="Enter patient UUID or search" /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Referred To Service" fullWidth size="small" value={form.referredToService ?? ''} onChange={e => setForm(p => ({ ...p, referredToService: e.target.value }))} /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Clinician Name" fullWidth size="small" value={form.referredToClinician ?? ''} onChange={e => setForm(p => ({ ...p, referredToClinician: e.target.value }))} /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Email" fullWidth size="small" value={form.referredToEmail ?? ''} onChange={e => setForm(p => ({ ...p, referredToEmail: e.target.value }))} /></Grid>
            <Grid size={{ xs: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>Urgency</InputLabel>
                <Select value={form.urgency} onChange={e => setForm(p => ({ ...p, urgency: e.target.value }))} label="Urgency">
                  {['emergency', 'urgent', 'semi_urgent', 'routine'].map(u => <MenuItem key={u} value={u} sx={{ textTransform: 'capitalize' }}>{u.replace('_', ' ')}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12 }}><TextField label="Reason for Referral" fullWidth multiline rows={3} size="small" value={form.reason ?? ''} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Clinical Summary" fullWidth multiline rows={3} size="small" value={form.clinicalSummary ?? ''} onChange={e => setForm(p => ({ ...p, clinicalSummary: e.target.value }))} /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Diagnosis" fullWidth size="small" value={form.diagnosis ?? ''} onChange={e => setForm(p => ({ ...p, diagnosis: e.target.value }))} /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Risk Summary" fullWidth size="small" value={form.riskSummary ?? ''} onChange={e => setForm(p => ({ ...p, riskSummary: e.target.value }))} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => createMut.mutate(form)} disabled={createMut.isPending || !form.reason}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {createMut.isPending ? 'Creating...' : 'Create Referral'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
