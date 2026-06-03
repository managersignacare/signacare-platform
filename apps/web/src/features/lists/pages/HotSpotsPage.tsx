import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { FlagForAdmissionDialog } from './AdmissionWaitlistPage';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Select, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../../shared/services/apiClient';
import { unstyledButtonSx } from '../../../shared/styles/unstyledButton';
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi';
import { admissionWaitlistKeys, hotspotsKeys, listsCrossFeatureKeys } from '../queryKeys';

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const r: { id: string; name: string }[] = [];
  function w(l: OrgUnit[], d: number) { for (const n of l) { r.push({ id: n.id, name: n.name }); if (n.children?.length) w(n.children, d + 1); } }
  w(nodes, 0); return r;
}

interface HotSpot { id: string; patientId: string; patientName: string; emrNumber: string; reason: string; status: string; addedByName: string; teamName: string; clinicianName: string; createdAt: string; resolvedAt: string | null; resolutionNotes: string | null }

export default function HotSpotsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: tree } = useOrgTree();
  const flatUnits = useMemo(() => tree ? flattenUnits(tree) : [], [tree]);
  const { data: staffList } = useQuery({ queryKey: listsCrossFeatureKeys.staffLookup(), queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string }[]>('staff/lookup'), staleTime: 5 * 60 * 1000 });

  const [showResolved, setShowResolved] = useState(false);
  const [teamFilter, setTeamFilter] = useState('');
  const [clinicianFilter, setClinicianFilter] = useState('');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [flagAdmitHotspot, setFlagAdmitHotspot] = useState<{ patientId: string; hotspotId: string } | null>(null);

  const activeHotSpotsParams: Record<string, string> = {
    status: 'active',
    ...(teamFilter ? { team: teamFilter } : {}),
  };
  const resolvedHotSpotsParams: Record<string, string> = { status: 'resolved' };
  const { data, isLoading } = useQuery({
    queryKey: hotspotsKeys.active(teamFilter),
    queryFn: () => apiClient.get<{ hotspots: HotSpot[]; total: number }>('patients/hotspots', activeHotSpotsParams),
  });
  const { data: resolvedData } = useQuery({
    queryKey: hotspotsKeys.resolved(),
    queryFn: () => apiClient.get<{ hotspots: HotSpot[] }>('patients/hotspots', resolvedHotSpotsParams).then(r => r.hotspots),
    enabled: showResolved,
  });

  const resolveMut = useMutation({
    mutationFn: () => apiClient.patch(`patients/hotspots/${resolveId}`, { status: 'resolved', resolutionNotes: resolveNotes.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: hotspotsKeys.all }); setResolveId(null); setResolveNotes(''); },
  });

  const active = useMemo(() => {
    let items = data?.hotspots ?? [];
    if (clinicianFilter) items = items.filter(h => h.clinicianName.includes(clinicianFilter));
    return items;
  }, [data, clinicianFilter]);

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress role="progressbar" aria-label="Loading" /></Box>;

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      {/* Header with count */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <WarningAmberIcon sx={{ color: '#D32F2F', fontSize: 28 }} />
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>Hot Spots</Typography>
          <Chip label={`${active.length} active`} color="error" size="small" sx={{ fontWeight: 600 }} />
        </Box>
        <Button size="small" onClick={() => setShowResolved(!showResolved)} sx={{ color: 'text.secondary' }}>
          {showResolved ? 'Hide' : 'Show'} Resolved
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Patients with early warning signs or concerns requiring heightened monitoring</Typography>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Team / Unit</InputLabel>
          <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} label="Team / Unit" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Teams</MenuItem>
            {flatUnits.map(u => <MenuItem key={u.id} value={u.name}>{u.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Clinician</InputLabel>
          <Select value={clinicianFilter} onChange={e => setClinicianFilter(e.target.value)} label="Clinician" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Clinicians</MenuItem>
            {(staffList ?? []).map(s => <MenuItem key={s.id} value={`${s.givenName} ${s.familyName}`}>{s.givenName} {s.familyName}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      {/* Active Hot Spots */}
      {!active.length ? (
        <Alert severity="info">No active hot spots{teamFilter ? ` for ${teamFilter}` : ''}.</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {active.map(h => (
            <Card key={h.id} variant="outlined" sx={{ borderLeft: '4px solid #D32F2F', boxShadow: '0 2px 8px rgba(211,47,47,0.1)' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box
                  component="button"
                  type="button"
                  aria-label={`Open patient ${h.patientName ?? 'patient'}${h.emrNumber ? ` (${h.emrNumber})` : ''}`}
                  onClick={() => navigate(`/patients/${h.patientId}`)}
                  sx={{ flex: 1, ...unstyledButtonSx, '&:focus-visible': { outline: '2px solid #D32F2F', outlineOffset: 2, borderRadius: 1 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body1" fontWeight={600} sx={{ color: '#b8621a', '&:hover': { textDecoration: 'underline' } }}>{h.patientName}</Typography>
                    <Typography variant="caption" color="text.secondary">{h.emrNumber}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, mb: 0.5 }}>
                    {h.teamName && <Chip label={h.teamName} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
                    {h.clinicianName && <Typography variant="caption" color="text.secondary">Clinician: {h.clinicianName}</Typography>}
                  </Box>
                  <Typography variant="body2">{h.reason}</Typography>
                  <Typography variant="caption" color="text.secondary">Added {new Date(h.createdAt).toLocaleDateString('en-AU')} by {h.addedByName}</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title="Flag for Admission"><IconButton sx={{ color: '#C62828' }} onClick={() => setFlagAdmitHotspot({ patientId: h.patientId, hotspotId: h.id })}><LocalHospitalIcon /></IconButton></Tooltip>
                  <Tooltip title="Resolve"><IconButton color="success" onClick={() => setResolveId(h.id)}><CheckCircleIcon /></IconButton></Tooltip>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Resolved */}
      {showResolved && resolvedData?.length ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Resolved</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, opacity: 0.6 }}>
            {resolvedData.map(h => (
              <Card key={h.id} variant="outlined"><CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Typography variant="body2" fontWeight={500}>{h.patientName} — {h.reason}</Typography>
                <Typography variant="caption" color="text.secondary">Resolved {h.resolvedAt ? new Date(h.resolvedAt).toLocaleDateString('en-AU') : ''}{h.resolutionNotes && ` — ${h.resolutionNotes}`}</Typography>
              </CardContent></Card>
            ))}
          </Box>
        </Box>
      ) : null}

      <Dialog aria-labelledby="dialog-title" open={!!resolveId} onClose={() => setResolveId(null)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Resolve Hot Spot</DialogTitle>
        <DialogContent><TextField autoFocus label="Resolution Notes" fullWidth multiline rows={3} value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} sx={{ mt: 1 }} /></DialogContent>
        <DialogActions><Button onClick={() => setResolveId(null)}>Cancel</Button><Button variant="contained" color="success" onClick={() => resolveMut.mutate()}>Resolve</Button></DialogActions>
      </Dialog>

      {/* Flag for Admission dialog — from hotspot */}
      {flagAdmitHotspot && (
        <FlagForAdmissionDialog
          open
          patientId={flagAdmitHotspot.patientId}
          hotspotId={flagAdmitHotspot.hotspotId}
          onClose={() => setFlagAdmitHotspot(null)}
          onSaved={() => { setFlagAdmitHotspot(null); qc.invalidateQueries({ queryKey: admissionWaitlistKeys.all }); }}
        />
      )}
    </Box>
  );
}
