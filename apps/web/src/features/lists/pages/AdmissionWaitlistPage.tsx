import { useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem,
  Paper, Select, TextField, Typography,
} from '@mui/material';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../../shared/services/apiClient';
import { unstyledButtonSx } from '../../../shared/styles/unstyledButton';
import { admissionWaitlistKeys, listsCrossFeatureKeys } from '../queryKeys';

const PRIORITY_COLORS: Record<string, string> = { urgent: '#C62828', high: '#E65100', medium: '#b8621a', low: '#2E7D32' };

interface AdmissionWaitlistEntry {
  id: string;
  patientId?: string | null;
  patient_id?: string | null;
  patientGivenName?: string | null;
  patient_given_name?: string | null;
  patientFamilyName?: string | null;
  patient_family_name?: string | null;
  emrNumber?: string | null;
  emr_number?: string | null;
  priority?: string | null;
  source?: string | null;
  reason?: string | null;
  clinicalNotes?: string | null;
  clinical_notes?: string | null;
  preferredWard?: string | null;
  preferred_ward?: string | null;
  targetAdmissionDate?: string | null;
  target_admission_date?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  flaggedByName?: string | null;
  flagged_by_name?: string | null;
}

interface PatientSearchResult {
  id: string;
  givenName?: string | null;
  given_name?: string | null;
  familyName?: string | null;
  family_name?: string | null;
  emrNumber?: string | null;
  emr_number?: string | null;
}

interface CommunityResource {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  website?: string;
}

interface CommunityResourcesResponse {
  resources?: CommunityResource[];
  data?: CommunityResource[];
}

function getApiErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error == null) return 'Failed to flag for admission';
  const err = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return err.response?.data?.error ?? err.message ?? 'Failed to flag for admission';
}

export default function AdmissionWaitlistPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: admissionWaitlistKeys.list(),
    queryFn: () => apiClient.get<{ waitlist: AdmissionWaitlistEntry[] }>('patients/admission-waitlist').then(r => r.waitlist ?? []),
  });
  const { data: communityResourcesData, isLoading: resourcesLoading } = useQuery({
    queryKey: [...admissionWaitlistKeys.list(), 'community-resources'],
    queryFn: () => apiClient.get<CommunityResource[] | CommunityResourcesResponse>('community-resources'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`patients/admission-waitlist/${id}/remove`, { removalReason: removeReason || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: admissionWaitlistKeys.all }); setRemoveId(null); setRemoveReason(''); },
  });

  const admitMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`patients/admission-waitlist/${id}/admit`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: admissionWaitlistKeys.all }),
  });

  const waitlist = data ?? [];
  const communityResources: CommunityResource[] = Array.isArray(communityResourcesData)
    ? communityResourcesData
    : communityResourcesData?.resources ?? communityResourcesData?.data ?? [];

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <LocalHospitalIcon sx={{ color: '#C62828', fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Admission Waitlist</Typography>
            <Typography variant="body2" color="text.secondary">Patients flagged for potential admission — from hotspots or planned</Typography>
          </Box>
        </Box>
        <Button variant="contained" size="small" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none' }}>
          + Flag for Admission
        </Button>
      </Box>

      {isLoading && <CircularProgress size={24} />}

      {!isLoading && waitlist.length === 0 && (
        <Alert severity="info">No patients on the admission waitlist. Flag a patient from a hotspot or use the button above for planned admissions.</Alert>
      )}

      {waitlist.map((entry) => {
        const name = `${entry.patientGivenName ?? entry.patient_given_name ?? ''} ${entry.patientFamilyName ?? entry.patient_family_name ?? ''}`.trim();
        const emr = entry.emrNumber ?? entry.emr_number ?? '';
        const pri = entry.priority ?? 'medium';
        const src = entry.source ?? 'planned';
        const targetAdmissionDate = entry.targetAdmissionDate ?? entry.target_admission_date;
        const createdAt = entry.createdAt ?? entry.created_at;
        return (
          <Paper key={entry.id} variant="outlined" sx={{ p: 2, mb: 1.5, borderLeft: `4px solid ${PRIORITY_COLORS[pri] ?? '#999'}` }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box
                component="button"
                type="button"
                aria-label={`Open patient ${name || 'patient'}${emr ? ` (${emr})` : ''}`}
                onClick={() => entry.patientId && navigate(`/patients/${entry.patientId ?? entry.patient_id}`)}
                sx={{ flex: 1, ...unstyledButtonSx, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2, borderRadius: 1 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>{name || 'Patient'}</Typography>
                  <Chip label={emr} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                  <Chip label={pri.toUpperCase()} size="small" sx={{ fontSize: 9, height: 18, fontWeight: 700, bgcolor: PRIORITY_COLORS[pri] + '15', color: PRIORITY_COLORS[pri] }} />
                  <Chip label={src === 'hotspot' ? 'From Hotspot' : 'Planned'} size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: src === 'hotspot' ? '#FFEBEE' : '#E3F2FD', color: src === 'hotspot' ? '#C62828' : '#1565C0' }} />
                </Box>
                {entry.reason && <Typography variant="caption" color="text.secondary" display="block">{entry.reason}</Typography>}
                {entry.clinicalNotes ?? entry.clinical_notes ? <Typography variant="caption" color="text.secondary" display="block" sx={{ fontStyle: 'italic' }}>{entry.clinicalNotes ?? entry.clinical_notes}</Typography> : null}
                <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                  {(entry.preferredWard ?? entry.preferred_ward) && <Typography variant="caption" color="text.secondary">Ward: {entry.preferredWard ?? entry.preferred_ward}</Typography>}
                  {targetAdmissionDate && <Typography variant="caption" color="text.secondary">Target: {new Date(targetAdmissionDate).toLocaleDateString('en-AU')}</Typography>}
                  <Typography variant="caption" color="text.secondary">Flagged: {createdAt ? new Date(createdAt).toLocaleDateString('en-AU') : '—'}</Typography>
                  {(entry.flaggedByName ?? entry.flagged_by_name) && <Typography variant="caption" color="text.secondary">By: {entry.flaggedByName ?? entry.flagged_by_name}</Typography>}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" variant="contained" onClick={() => { if (confirm('Mark as admitted?')) admitMut.mutate(entry.id); }}
                  sx={{ bgcolor: '#2E7D32', '&:hover': { bgcolor: '#1B5E20' }, fontSize: 10, textTransform: 'none' }}>Admit</Button>
                <Button size="small" variant="outlined" onClick={() => setRemoveId(entry.id)}
                  sx={{ borderColor: '#D32F2F', color: '#D32F2F', fontSize: 10, textTransform: 'none' }}>Remove</Button>
              </Box>
            </Box>
          </Paper>
        );
      })}

      <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} color="#3D484B">Admission Session Resources</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Community services and supports relevant to admissions, discharge planning, and crisis pathways.
        </Typography>
        {resourcesLoading ? (
          <CircularProgress size={18} />
        ) : communityResources.length === 0 ? (
          <Alert severity="info" sx={{ py: 0.5 }}>
            No community resources configured yet.
          </Alert>
        ) : (
          <Grid container spacing={1}>
            {communityResources.slice(0, 10).map((resource, index) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={resource.id ?? `${resource.name ?? 'resource'}-${index}`}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    borderColor: '#E6E8EB',
                    height: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 1,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>
                      {resource.name ?? 'Community Resource'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {resource.category ?? 'General'}
                    </Typography>
                  </Box>
                  {resource.website ? (
                    <Button
                      size="small"
                      href={resource.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                      sx={{ textTransform: 'none', minWidth: 'auto', px: 1 }}
                    >
                      Link
                    </Button>
                  ) : null}
                </Paper>
              </Grid>
            ))}
          </Grid>
        )}
      </Paper>

      {/* Add to waitlist dialog */}
      <FlagForAdmissionDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: admissionWaitlistKeys.all }); }} />

      {/* Remove confirmation */}
      <Dialog open={!!removeId} onClose={() => setRemoveId(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Remove from Waitlist</DialogTitle>
        <DialogContent>
          <TextField label="Reason for removal" fullWidth size="small" multiline rows={2} value={removeReason} onChange={e => setRemoveReason(e.target.value)}
            placeholder="e.g. Condition improved, patient declined, admitted elsewhere" sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveId(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => removeId && removeMut.mutate(removeId)} disabled={removeMut.isPending}>
            {removeMut.isPending ? 'Removing...' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ── Flag for Admission Dialog (also used from HotSpotsPage) ─────────────────

export function FlagForAdmissionDialog({ open, onClose, onSaved, patientId: presetPatientId, hotspotId }: {
  open: boolean; onClose: () => void; onSaved: () => void; patientId?: string; hotspotId?: string;
}) {
  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [patientSearch, setPatientSearch] = useState('');
  const [priority, setPriority] = useState('medium');
  const [reason, setReason] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [preferredWard, setPreferredWard] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: patientResults } = useQuery({
    queryKey: listsCrossFeatureKeys.patientsSearch(patientSearch),
    queryFn: () => apiClient.get<{ data: PatientSearchResult[] }>('patients', { search: patientSearch, limit: 10 }).then(r => r.data ?? []),
    enabled: patientSearch.length >= 2 && !presetPatientId,
  });

  const handleSave = async () => {
    const pid = presetPatientId ?? patientId;
    if (!pid) { setError('Please select a patient'); return; }
    setSaving(true); setError('');
    try {
      await apiClient.post(`patients/${pid}/flag-for-admission`, {
        hotspotId: hotspotId ?? undefined,
        reason: reason || undefined,
        priority,
        preferredWard: preferredWard || undefined,
        targetAdmissionDate: targetDate || undefined,
        clinicalNotes: clinicalNotes || undefined,
      });
      onSaved();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, color: '#C62828' }}>Flag for Admission</DialogTitle>
      <Divider />
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {hotspotId && <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>Flagging from hotspot — this will appear as "From Hotspot" on the admission waitlist.</Alert>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {!presetPatientId && (
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                options={patientResults ?? []}
                getOptionLabel={(opt: string | PatientSearchResult) => {
                  if (typeof opt === 'string') return opt;
                  const familyName = opt.familyName ?? opt.family_name ?? '';
                  const givenName = opt.givenName ?? opt.given_name ?? '';
                  const emrNumber = opt.emrNumber ?? opt.emr_number ?? '';
                  return `${familyName}, ${givenName} (${emrNumber})`;
                }}
                onInputChange={(_, v) => setPatientSearch(v)}
                onChange={(_, v) => { if (v && typeof v !== 'string') setPatientId(v.id); }}
                renderInput={(params) => <TextField {...params} size="small" label="Patient *" placeholder="Search by name or MRN" />}
                freeSolo size="small"
              />
            </Grid>
          )}
          <Grid size={{ xs: 6 }}>
            <FormControl fullWidth size="small"><InputLabel>Priority</InputLabel>
              <Select value={priority} onChange={e => setPriority(e.target.value)} label="Priority">
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField label="Target Admission Date" size="small" fullWidth type="date" value={targetDate}
              onChange={e => setTargetDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Reason for Admission" size="small" fullWidth value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Deteriorating mental state, risk escalation, medication titration" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Preferred Ward" size="small" fullWidth value={preferredWard} onChange={e => setPreferredWard(e.target.value)}
              placeholder="e.g. IPU, HDU, PARC" />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Clinical Notes" size="small" fullWidth multiline rows={3} value={clinicalNotes} onChange={e => setClinicalNotes(e.target.value)}
              placeholder="Additional clinical context..." />
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}
          sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none' }}>
          {saving ? 'Saving...' : 'Flag for Admission'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
