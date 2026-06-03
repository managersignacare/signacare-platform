import AddIcon from '@mui/icons-material/Add';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid,
    InputLabel, MenuItem, Paper, Select, Switch, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { useOrgTree } from '../../../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../../../org-settings/services/orgSettingsApi';
import {
  episodesKeys,
} from '../../../queryKeys';
import {
  AllocationDialog,
  EpisodeCard,
  EpisodeDetailView,
} from './EpisodesSections';

interface Episode {
  id: string; episodeNumber?: string; title: string; episodeType?: string; status: string;
  startDate: string; endDate?: string; team?: string;
}


function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const result: { id: string; name: string }[] = [];
  function walk(list: OrgUnit[], depth: number) {
    for (const n of list) {
      result.push({ id: n.id, name: '\u00A0'.repeat(depth * 2) + n.name });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(nodes, 0);
  return result;
}

function buildUnitNameMap(tree: OrgUnit[]): Map<string, string> {
  const m = new Map<string, string>();
  function walk(nodes: OrgUnit[]) { for (const n of nodes) { m.set(n.id, n.name); if (n.children) walk(n.children); } }
  walk(tree);
  return m;
}

const FALLBACK_EPISODE_TYPES = [
  { value: 'triage', label: 'Triage' }, { value: 'intake', label: 'Intake' },
  { value: 'acis', label: 'ACIS Episode' }, { value: 'mst', label: 'MST Episode' },
  { value: 'cct', label: 'CCT Episode' }, { value: 'parc', label: 'PARC Episode' },
  { value: 'ccu', label: 'CCU Episode' }, { value: 'ipu', label: 'IPU Episode' },
  { value: 'community', label: 'Community' }, { value: 'inpatient', label: 'Inpatient' },
  { value: 'residential', label: 'Residential' }, { value: 'consultation', label: 'Consultation-Liaison' },
  { value: 'other', label: 'Other' },
];

function useEpisodeTypes() {
  const { data } = useQuery({
    queryKey: episodesKeys.types(),
    queryFn: () => apiClient.get<{ types: { id: string; name: string; isActive: boolean }[] }>('staff-settings/episode-types').then(r => r.types),
    staleTime: 5 * 60 * 1000,
  });
  if (data?.length) return data.filter(t => t.isActive).map(t => ({ value: t.name.toLowerCase().replace(/\s+/g, '_'), label: t.name }));
  return FALLBACK_EPISODE_TYPES;
}

interface EpisodesTabProps { patientId: string }
export function EpisodesTab({ patientId }: EpisodesTabProps) {
  const qc = useQueryClient();
  const { data: tree } = useOrgTree();
  const flatUnits = React.useMemo(() => tree ? flattenUnits(tree) : [], [tree]);
  const unitNameMap = React.useMemo(() => tree ? buildUnitNameMap(tree) : new Map(), [tree]);
  const EPISODE_TYPES = useEpisodeTypes();

  const { data, isLoading } = useQuery({
    queryKey: episodesKeys.byPatient(patientId),
    queryFn: () => apiClient.get<{ data: Episode[] }>(`episodes/patient/${patientId}`).then(r => r.data),
    enabled: !!patientId,
  });

  const createMut = useMutation({ mutationFn: (dto: Record<string, unknown>) => apiClient.post('episodes', dto), onSuccess: () => qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) }) });
  const updateMut = useMutation({ mutationFn: ({ id, dto }: { id: string; dto: Record<string, unknown> }) => apiClient.put(`episodes/${id}`, dto), onSuccess: () => qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) }) });
  const closeMut = useMutation({ mutationFn: ({ id }: { id: string }) => apiClient.post(`episodes/${id}/close`, { endDate: new Date().toISOString().split('T')[0], closureReason: 'Closed by clinician' }), onSuccess: () => qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) }) });

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [allocDialogOpen, setAllocDialogOpen] = useState(false);
  const [allocEpisode, setAllocEpisode] = useState<Episode | null>(null);
  const [detailEpisode, setDetailEpisode] = useState<Episode | null>(null);

  // Edit form state
  const [title, setTitle] = useState('');
  const [episodeType, setEpisodeType] = useState('community');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [closeToggle, setCloseToggle] = useState(false);

  const generateTitle = (type: string, date: string) => {
    const typeLabel = EPISODE_TYPES.find(t => t.value === type)?.label ?? type;
    const dateStr = date ? date.replace(/-/g, '') : new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${typeLabel} ${dateStr}`;
  };

  const openAdd = () => {
    const today = new Date().toISOString().split('T')[0];
    const defaultType = 'community';
    setEditingEpisode(null); setEpisodeType(defaultType);
    setStartDate(today); setEndDate(''); setLocation(''); setCloseToggle(false);
    setTitle(generateTitle(defaultType, today));
    setEditDialogOpen(true);
  };
  const openEdit = (ep: Episode) => {
    setEditingEpisode(ep); setTitle(ep.title || ''); setEpisodeType(ep.episodeType || 'community');
    setStartDate(ep.startDate || ''); setEndDate(ep.endDate || ''); setLocation(ep.team || '');
    setCloseToggle(ep.status === 'closed');
    setEditDialogOpen(true);
  };
  const openAlloc = (ep: Episode) => {
    setAllocEpisode(ep);
    setAllocDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !startDate) return;
    if (closeToggle && editingEpisode && editingEpisode.status !== 'closed') {
      await closeMut.mutateAsync({ id: editingEpisode.id });
      setEditDialogOpen(false); return;
    }
    const dto: Record<string, unknown> = { patientId, title: title.trim(), episodeType, startDate, endDate: endDate || undefined };
    if (editingEpisode) {
      if (!closeToggle && (editingEpisode.status === 'closed' || editingEpisode.status === 'onhold' || editingEpisode.status === 'on_hold')) { dto.status = 'open'; dto.endDate = undefined; }
      await updateMut.mutateAsync({ id: editingEpisode.id, dto });
    } else { await createMut.mutateAsync(dto); }
    setEditDialogOpen(false);
  };

  const isPending = createMut.isPending || updateMut.isPending || closeMut.isPending;
  const normalizeEpisodeStatus = (status: string | undefined) => (status ?? '').toLowerCase().trim();
  const activeEpisodes = data?.filter(ep => normalizeEpisodeStatus(ep.status) === 'open' && ep.episodeType !== 'triage') ?? [];
  const triageEpisodes = data?.filter(ep => ep.episodeType === 'triage') ?? [];
  const nonActiveEpisodes = data?.filter(ep => ep.episodeType !== 'triage' && normalizeEpisodeStatus(ep.status) !== 'open') ?? [];
  // Patient is inactive if all non-triage episodes are closed
  const isPatientInactive = activeEpisodes.length === 0 && (data?.length ?? 0) > 0;

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  return (
    <Box>
      {/* Main view or detail view */}
      {detailEpisode ? (
        <EpisodeDetailView episode={detailEpisode} patientId={patientId} unitNameMap={unitNameMap}
          onBack={() => setDetailEpisode(null)} onEdit={() => openEdit(detailEpisode)} onAllocate={() => openAlloc(detailEpisode)} />
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Episodes of Care</Typography>
              {isPatientInactive && <Chip label="Patient Inactive" size="small" color="default" sx={{ fontSize: 10, height: 20, fontWeight: 600 }} />}
            </Box>
            <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={openAdd}
              sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Add Episode</Button>
          </Box>

          {/* Triage Episodes */}
          {triageEpisodes.length > 0 && (
            <>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: 'text.secondary', fontStyle: 'italic' }}>Triage</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2, opacity: 0.8 }}>
                {triageEpisodes.map(ep => <EpisodeCard key={ep.id} ep={ep} unitNameMap={unitNameMap}
                  onClick={() => setDetailEpisode(ep)} onEdit={() => openEdit(ep)} onAllocate={() => openAlloc(ep)} />)}
              </Box>
            </>
          )}

          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: '#3D484B' }}>Active Episodes</Typography>
          {activeEpisodes.length === 0 ? <Alert severity="info" sx={{ mb: 3 }}>No active episodes.</Alert> : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
              {activeEpisodes.map(ep => <EpisodeCard key={ep.id} ep={ep} unitNameMap={unitNameMap}
                onClick={() => setDetailEpisode(ep)} onEdit={() => openEdit(ep)} onAllocate={() => openAlloc(ep)} />)}
            </Box>
          )}
          {nonActiveEpisodes.length > 0 && (
            <Paper
              variant="outlined"
              sx={{
                mt: 3,
                p: 1.5,
                borderColor: '#e4c7aa',
                bgcolor: '#fff7ef',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#8f4e18' }}>
                  Closed & Non-Active Episodes
                </Typography>
                <Chip
                  label={`${nonActiveEpisodes.length}`}
                  size="small"
                  sx={{ height: 20, fontSize: 11, bgcolor: '#f1dac3', color: '#6d3b14', fontWeight: 700 }}
                />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {nonActiveEpisodes.map(ep => <EpisodeCard key={ep.id} ep={ep} unitNameMap={unitNameMap}
                  tone="inactive" onClick={() => setDetailEpisode(ep)} onEdit={() => openEdit(ep)} onAllocate={() => openAlloc(ep)} />)}
              </Box>
            </Paper>
          )}
        </>
      )}

      {/* Edit Dialog — always rendered */}
      <Dialog aria-labelledby="dialog-title" open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>{editingEpisode ? 'Edit Episode' : 'Add Episode'}</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField label="Episode Name / Title *" fullWidth size="small" value={title} onChange={e => setTitle(e.target.value)}
              helperText="Auto-generated from type + date. You can edit manually." /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><FormControl fullWidth size="small"><InputLabel id="episode-type-label">Episode Type</InputLabel><Select labelId="episode-type-label" id="episode-type-select" value={episodeType} onChange={e => { setEpisodeType(e.target.value); if (!editingEpisode) setTitle(generateTitle(e.target.value, startDate)); }} label="Episode Type" inputProps={{ 'aria-label': 'Episode Type' }}>{EPISODE_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}</Select></FormControl></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><FormControl fullWidth size="small"><InputLabel id="episode-location-label">Location (Team / Unit)</InputLabel><Select labelId="episode-location-label" id="episode-location-select" value={location} onChange={e => setLocation(e.target.value)} label="Location (Team / Unit)" inputProps={{ 'aria-label': 'Location (Team / Unit)' }}><MenuItem value="">— None —</MenuItem>{flatUnits.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}</Select></FormControl></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Start Date *" type="date" fullWidth size="small" value={startDate}
              onChange={e => { setStartDate(e.target.value); if (!editingEpisode) setTitle(generateTitle(episodeType, e.target.value)); }}
              slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="End Date (optional)" type="date" fullWidth size="small" value={endDate} onChange={e => setEndDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            {editingEpisode && (
              <Grid size={{ xs: 12 }}>
                <Divider sx={{ my: 1 }} />
                <FormControlLabel
                  control={<Switch checked={closeToggle} onChange={(_, v) => setCloseToggle(v)} sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#D32F2F' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#D32F2F' } }} />}
                  label={<Typography variant="body2" fontWeight={500} color={closeToggle ? 'error' : 'text.primary'}>{closeToggle ? "Episode will be CLOSED (today's date as closing date)" : 'Episode is OPEN'}</Typography>} />
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEditDialogOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={isPending || !title.trim() || !startDate}
            sx={{ bgcolor: closeToggle ? '#D32F2F' : '#b8621a', '&:hover': { bgcolor: closeToggle ? '#B71C1C' : '#d6741f' } }}>
            {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : closeToggle && editingEpisode?.status !== 'closed' ? 'Close Episode' : editingEpisode ? 'Save Changes' : 'Create Episode'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Allocation Dialog — always rendered */}
      {allocDialogOpen && allocEpisode && (
        <AllocationDialog episode={allocEpisode} patientId={patientId} flatUnits={flatUnits} onClose={() => { setAllocDialogOpen(false); setAllocEpisode(null); }} />
      )}
    </Box>
  );
}

export default EpisodesTab;
