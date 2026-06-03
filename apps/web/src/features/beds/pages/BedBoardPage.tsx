import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import HotelIcon from '@mui/icons-material/Hotel';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SettingsIcon from '@mui/icons-material/Settings';
import {
    Alert, Avatar, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem,
    Paper, Select, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { bedsKeys } from '../queryKeys';

type BedStatus =
  | 'available'
  | 'occupied'
  | 'maintenance'
  | 'closed'
  | 'on_leave'
  | 'onLeave'
  | 'discharged'
  | 'discharge_pending'
  | 'dischargePending'
  | string

interface BedBoardRow {
  id: string
  status: BedStatus
  patientId?: string
  patient_id?: string
  patientGivenName?: string
  patient_given_name?: string
  patientFamilyName?: string
  patient_family_name?: string
  bedLabel?: string
  bedNumber?: string
  bed_label?: string
  bed_number?: string
  emrNumber?: string
  ward?: string
}

type WardBedsMap = Record<string, BedBoardRow[]>

interface BedBoardResponse {
  wards?: WardBedsMap
  totalBeds?: number
  occupied?: number
}

interface PatientSearchRow {
  id: string
  familyName?: string
  givenName?: string
  emrNumber?: string
}

type BedsListResponse = BedBoardRow[] | { data?: BedBoardRow[]; beds?: BedBoardRow[] }
type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null
}

function readErrorMessage(err: unknown, fallback: string): string {
  const rec = asRecord(err)
  if (!rec) return fallback
  const response = asRecord(rec.response)
  const data = asRecord(response?.data)
  if (typeof data?.error === 'string' && data.error.trim().length > 0) return data.error
  if (typeof rec.message === 'string' && rec.message.trim().length > 0) return rec.message
  return fallback
}

function readPatientSearchRows(payload: unknown): PatientSearchRow[] {
  if (Array.isArray(payload)) return payload as PatientSearchRow[]
  const rec = asRecord(payload)
  if (!rec || !Array.isArray(rec.data)) return []
  return rec.data as PatientSearchRow[]
}

// Lazy-load DnD kanban — if it crashes, error boundary catches it
const LazyKanbanBoard = React.lazy(() => import('../components/KanbanBoard'));

// Error boundary — catches DnD crashes and shows fallback
class KanbanErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

// Click-to-move fallback kanban (used when DnD crashes)
function ClickToMoveKanban({ allBeds, columns, columnColors, onDischarge, onLeave, onAdmit }: { allBeds: BedBoardRow[]; columns: readonly string[]; columnColors: Record<string, string>; onDischarge: (id: string) => void; onLeave: (id: string) => void; onAdmit: (bed: BedBoardRow) => void }) {
  const getColumnBeds = (col: string) => {
    switch (col) {
      case 'Admitted': return allBeds.filter((b) => b.status === 'occupied' && (b.patientId ?? b.patient_id));
      case 'On Leave': return allBeds.filter((b) => b.status === 'on_leave' || b.status === 'onLeave');
      case 'Discharged': return allBeds.filter((b) => b.status === 'discharged');
      case 'Pre-Admission': return allBeds.filter((b) => b.status === 'available');
      case 'Under Review': return allBeds.filter((b) => b.status === 'maintenance' || b.status === 'closed');
      case 'Discharge Planning': return allBeds.filter((b) => b.status === 'discharge_pending' || b.status === 'dischargePending');
      default: return [];
    }
  };
  return (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
      {columns.map(col => {
        const beds = getColumnBeds(col);
        const color = columnColors[col] ?? '#666';
        return (
          <Paper key={col} variant="outlined" sx={{ minWidth: 260, flex: '0 0 260px', borderRadius: 2, overflow: 'hidden', bgcolor: '#F8F9FA' }}>
            <Box sx={{ p: 1.5, bgcolor: '#fff', borderBottom: `3px solid ${color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: 13, color }}>{col}</Typography>
              <Avatar sx={{ width: 24, height: 24, fontSize: 11, fontWeight: 700, bgcolor: color }}>{beds.length}</Avatar>
            </Box>
            <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 120 }}>
              {beds.map((b, i: number) => {
                const name = [(b.patientGivenName ?? b.patient_given_name ?? ''), (b.patientFamilyName ?? b.patient_family_name ?? '')].filter(Boolean).join(' ') || 'Available';
                return (
                  <Card key={b.id ?? i} variant="outlined" sx={{ borderLeft: `4px solid ${color}`, '&:hover': { boxShadow: 2 } }}>
                    <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
                      <Typography variant="body2" fontWeight={700} sx={{ fontSize: 12 }}>{name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>Bed {b.bedLabel ?? b.bedNumber ?? b.bed_label ?? b.bed_number} · {b.ward}</Typography>
                      {col === 'Admitted' && b.id && <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}><Button size="small" onClick={() => onLeave(b.id)} sx={{ fontSize: 9, textTransform: 'none', color: '#E65100' }}>Leave</Button><Button size="small" onClick={() => { if (confirm('Discharge?')) onDischarge(b.id); }} sx={{ fontSize: 9, textTransform: 'none', color: '#D32F2F' }}>D/C</Button></Box>}
                      {col === 'Pre-Admission' && <Button size="small" onClick={() => onAdmit(b)} sx={{ fontSize: 9, textTransform: 'none', color: '#327C8D', mt: 0.5 }}>Admit</Button>}
                    </CardContent>
                  </Card>
                );
              })}
              {beds.length === 0 && <Box sx={{ p: 2, textAlign: 'center', border: '1px dashed #E0E0E0', borderRadius: 1 }}><Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>No patients</Typography></Box>}
            </Box>
          </Paper>
        );
      })}
    </Box>
  );
}

const STATUS_COLORS: Record<string, string> = {
  available: '#2E7D32', occupied: '#b8621a', maintenance: '#999', closed: '#D32F2F',
};

const BED_TYPES = ['Standard', 'HDU', 'Seclusion', 'ICU', 'Single', 'Shared'];

export default function BedBoardPage() {
  const qc = useQueryClient();
  const [boardView, setBoardView] = useState<'grid' | 'kanban'>('grid');
  const [admitOpen, setAdmitOpen] = useState(false);
  const [selectedBed, setSelectedBed] = useState<BedBoardRow | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: bedsKeys.all,
    queryFn: () => apiClient.get<BedBoardResponse>('beds/board'),
  });

  const dischargeMut = useMutation({
    mutationFn: (bedId: string) => apiClient.post(`beds/${bedId}/discharge`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: bedsKeys.all }),
  });
  const leaveMut = useMutation({
    mutationFn: (bedId: string) => apiClient.post(`beds/${bedId}/leave`, { notes: 'Moved via bedboard kanban' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: bedsKeys.all }),
    onError: (err: unknown) => alert(`Failed to record leave: ${readErrorMessage(err, 'Unknown')}`),
  });
  const KANBAN_COLUMNS = ['Pre-Admission', 'Admitted', 'Under Review', 'Discharge Planning', 'On Leave', 'Discharged'] as const;
  const COLUMN_COLORS: Record<string, string> = {
    'Pre-Admission': '#7B1FA2', 'Admitted': '#b8621a', 'Under Review': '#999',
    'Discharge Planning': '#1565C0', 'On Leave': '#E65100', 'Discharged': '#2E7D32',
  };

  const wards = data?.wards ?? {};
  const allBeds = Object.entries(wards).flatMap(([ward, beds]) => (Array.isArray(beds) ? beds : []).map((b) => ({ ...b, ward })));
  const totalBeds = data?.totalBeds ?? 0;
  const occupied = data?.occupied ?? 0;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HotelIcon sx={{ color: '#327C8D', fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Ward Board</Typography>
            <Typography variant="body2" color="text.secondary">Inpatient bed management, patient flow, and leave tracking</Typography>
          </Box>
        </Box>
        <Button startIcon={<SettingsIcon />} variant="outlined" size="small" onClick={() => setConfigOpen(true)}
          sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}>
          Configure Beds
        </Button>
      </Box>

      {/* Summary bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, display: 'flex', gap: 3 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Total Beds</Typography>
          <Typography variant="h5" fontWeight={700}>{totalBeds}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Occupied</Typography>
          <Typography variant="h5" fontWeight={700} color="#b8621a">{occupied}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Available</Typography>
          <Typography variant="h5" fontWeight={700} color="#2E7D32">{totalBeds - occupied}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Occupancy</Typography>
          <Typography variant="h5" fontWeight={700}>{totalBeds > 0 ? Math.round((occupied / totalBeds) * 100) : 0}%</Typography>
        </Box>
      </Paper>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" />}

      {/* View Toggle */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 2 }}>
        <Chip label="Grid View" size="small" variant={boardView === 'grid' ? 'filled' : 'outlined'}
          onClick={() => setBoardView('grid')} sx={{ cursor: 'pointer', ...(boardView === 'grid' ? { bgcolor: '#2563EB', color: '#fff' } : {}) }} />
        <Chip label="Kanban Flow" size="small" variant={boardView === 'kanban' ? 'filled' : 'outlined'}
          onClick={() => setBoardView('kanban')} sx={{ cursor: 'pointer', ...(boardView === 'kanban' ? { bgcolor: '#2563EB', color: '#fff' } : {}) }} />
      </Box>

      {/* Kanban View — DnD with error boundary fallback to click-to-move */}
      {boardView === 'kanban' && (
        <KanbanErrorBoundary fallback={<ClickToMoveKanban allBeds={allBeds} columns={KANBAN_COLUMNS} columnColors={COLUMN_COLORS} onDischarge={(id: string) => dischargeMut.mutate(id)} onLeave={(id: string) => leaveMut.mutate(id)} onAdmit={(bed: BedBoardRow) => { setSelectedBed(bed); setAdmitOpen(true); }} />}>
          <React.Suspense fallback={<CircularProgress size={24} />}>
            <LazyKanbanBoard
              allBeds={allBeds}
              columns={KANBAN_COLUMNS}
              columnColors={COLUMN_COLORS}
              onDischarge={(id: string) => dischargeMut.mutate(id)}
              onLeave={(id: string) => leaveMut.mutate(id)}
              onAdmit={(bed: BedBoardRow) => { setSelectedBed(bed); setAdmitOpen(true); }}
            />
          </React.Suspense>
        </KanbanErrorBoundary>
      )}

      {/* Grid View */}
      {boardView === 'grid' && Object.entries(wards).map(([ward, beds]) => {
        const bedArr = Array.isArray(beds) ? beds : [];
        return (
        <Box key={ward} sx={{ mb: 3 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5, color: '#3D484B' }}>
            {ward} ({bedArr.filter((b) => b.status === 'occupied').length}/{bedArr.length})
          </Typography>
          <Grid container spacing={1.5}>
            {bedArr.map((bed) => (
              <Grid key={bed.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                <Card variant="outlined" sx={{
                  borderColor: STATUS_COLORS[bed.status] ?? '#ddd',
                  borderWidth: 2,
                  cursor: bed.status === 'occupied' ? 'pointer' : 'default',
                  '&:hover': { boxShadow: 2 },
                  bgcolor: bed.status === 'available' ? '#E8F5E9' : bed.status === 'occupied' ? '#FFF3E0' : '#F5F5F5',
                }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                    <Typography variant="h6" fontWeight={700} color={STATUS_COLORS[bed.status]}>
                      {bed.bedLabel ?? bed.bed_label ?? bed.bedNumber ?? bed.bed_number}
                    </Typography>
                    <Chip label={bed.status} size="small" sx={{ fontSize: 9, bgcolor: STATUS_COLORS[bed.status], color: '#fff', mb: 0.5 }} />
                    {bed.status === 'occupied' && (bed.patientGivenName ?? bed.patient_given_name) && (
                      <Box sx={{ mt: 0.5 }}>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: 11 }}>
                          {bed.patientGivenName ?? bed.patient_given_name} {bed.patientFamilyName ?? bed.patient_family_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">{bed.emrNumber}</Typography>
                        <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          <Button size="small" variant="text" color="error" onClick={() => dischargeMut.mutate(bed.id)}
                            sx={{ fontSize: 9, textTransform: 'none', minWidth: 0, px: 0.5 }}>
                            <ExitToAppIcon sx={{ fontSize: 12, mr: 0.25 }} /> D/C
                          </Button>
                        </Box>
                      </Box>
                    )}
                    {bed.status === 'available' && (
                      <Button size="small" variant="text" onClick={() => { setSelectedBed(bed); setAdmitOpen(true); }}
                        sx={{ fontSize: 9, textTransform: 'none', color: '#327C8D', mt: 0.5 }}>
                        <PersonAddIcon sx={{ fontSize: 12, mr: 0.25 }} /> Admit
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
        );
      })}

      {Object.keys(wards).length === 0 && !isLoading && (
        <Alert severity="info" action={<Button size="small" onClick={() => setConfigOpen(true)} sx={{ color: '#327C8D' }}>Configure Now</Button>}>
          No beds configured. Click Configure Beds to add wards and beds.
        </Alert>
      )}

      {/* ── Bed Configuration Dialog ── */}
      {configOpen && <BedConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: bedsKeys.all })} />}

      {/* ── Admit Patient Dialog ── */}
      <Dialog aria-labelledby="dialog-title" open={admitOpen} onClose={() => setAdmitOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Admit Patient to {selectedBed?.bed_label ?? selectedBed?.bedLabel ?? 'Bed'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Patient Search" size="small" fullWidth placeholder="Search by name or EMR number..."
              id="admit-patient-search"
              onChange={async (e) => {
                const search = e.target.value;
                if (search.length < 2) return;
                try {
                  const res = await apiClient.get<PatientSearchRow[] | { data?: PatientSearchRow[] }>(`patients?search=${encodeURIComponent(search)}&limit=10`);
                  const rows = readPatientSearchRows(res);
                  const el = document.getElementById('admit-patient-results');
                  if (el) {
                    while (el.firstChild) el.removeChild(el.firstChild); // safe clear
                    rows.forEach((p) => {
                      const opt = document.createElement('option');
                      opt.value = p.id;
                      opt.textContent = `${p.familyName}, ${p.givenName} (${p.emrNumber})`;
                      el.appendChild(opt);
                    });
                  }
                } catch (err) {
                  // BUG-520 — fail loud on patient-search error.
                  // Pre-fix this swallowed any error and left whatever
                  // stale results were in the dropdown — clinicians
                  // could be admitting patients to wrong bed because
                  // the search "succeeded" with stale data. Now: clear
                  // results + insert an explicit error option so the
                  // operator sees the failure.
                  const msg = err instanceof Error ? err.message : String(err);
                  console.error('BUG-520: patient-search failed', { err, search });
                  const el = document.getElementById('admit-patient-results');
                  if (el) {
                    while (el.firstChild) el.removeChild(el.firstChild);
                    const opt = document.createElement('option');
                    opt.disabled = true;
                    opt.textContent = `Search failed: ${msg} — please retry`;
                    el.appendChild(opt);
                  }
                }
              }}
            />
            <select id="admit-patient-results" style={{ padding: 8, fontSize: 14 }} size={5}>
              <option disabled>Search for a patient above</option>
            </select>
            <TextField label="Notes" size="small" fullWidth multiline rows={2} id="admit-notes" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdmitOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={async () => {
            const sel = document.getElementById('admit-patient-results') as HTMLSelectElement;
            const patientId = sel?.value;
            const notes = (document.getElementById('admit-notes') as HTMLInputElement)?.value;
            if (!patientId || !selectedBed?.id) return;
            try {
              await apiClient.post(`beds/${selectedBed.id}/admit`, { patientId, notes });
              qc.invalidateQueries({ queryKey: bedsKeys.all });
              setAdmitOpen(false);
            } catch (err: unknown) {
              alert(`Admit failed: ${readErrorMessage(err, 'Unknown error')}`);
            }
          }} sx={{ bgcolor: '#327C8D' }}>
            Admit Patient
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Bed Configuration Dialog
// ════════════════════════════════════════════════════════════════════════════

interface BedConfigDialogProps { open: boolean; onClose: () => void; onSaved: () => void }
function BedConfigDialog({ open, onClose, onSaved }: BedConfigDialogProps) {
  const [ward, setWard] = useState('IPU');
  const [bedNumber, setBedNumber] = useState('');
  const [bedType, setBedType] = useState('Standard');
  const [bulkCount, setBulkCount] = useState(1);
  const [bulkPrefix, setBulkPrefix] = useState('');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: allBeds, refetch } = useQuery({
    queryKey: bedsKeys.list(),
    queryFn: () => apiClient.get<BedsListResponse>('beds').then(r => Array.isArray(r) ? r : (r?.data ?? r?.beds ?? [])).catch((err) => { console.warn('BedBoardPage: query failed', err); return []; }),
    enabled: open,
  });

  const handleAddSingle = async () => {
    if (!bedNumber.trim()) { setError('Bed number is required'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      await apiClient.post('beds', { ward, bed_number: bedNumber.trim(), bed_type: bedType.toLowerCase() });
      setSuccess(`Bed ${bedNumber} added to ${ward}`);
      setBedNumber('');
      refetch();
      onSaved();
    } catch (e: unknown) {
      setError(readErrorMessage(e, 'Failed to add bed'));
    } finally { setSaving(false); }
  };

  const handleAddBulk = async () => {
    if (bulkCount < 1 || bulkCount > 50) { setError('Count must be 1-50'); return; }
    const prefix = bulkPrefix.trim() || ward;
    setSaving(true); setError(''); setSuccess('');
    try {
      const beds = Array.from({ length: bulkCount }, (_, i) => ({
        ward,
        bed_number: `${prefix}-${String(i + 1).padStart(2, '0')}`,
        bed_type: bedType.toLowerCase(),
      }));
      await apiClient.post('beds/bulk', { beds });
      setSuccess(`${bulkCount} beds added to ${ward} (${prefix}-01 to ${prefix}-${String(bulkCount).padStart(2, '0')})`);
      refetch();
      onSaved();
    } catch (e: unknown) {
      setError(readErrorMessage(e, 'Failed to add beds'));
    } finally { setSaving(false); }
  };

  const handleDelete = async (bedId: string) => {
    try {
      await apiClient.delete(`beds/${bedId}`);
      refetch();
      onSaved();
    } catch (e: unknown) {
      setError(readErrorMessage(e, 'Failed to delete'));
    }
  };

  const handleToggleMaintenance = async (bed: BedBoardRow) => {
    const newStatus = bed.status === 'maintenance' ? 'available' : 'maintenance';
    try {
      await apiClient.patch(`beds/${bed.id}`, { status: newStatus });
      refetch();
      onSaved();
    } catch (e: unknown) {
      setError(readErrorMessage(e, 'Failed to update'));
    }
  };

  const bedsByWard: Record<string, BedBoardRow[]> = {};
  for (const b of (allBeds ?? [])) {
    const w = b.ward ?? 'Unknown';
    if (!bedsByWard[w]) bedsByWard[w] = [];
    bedsByWard[w].push(b);
  }

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, color: '#3D484B' }}>
        <SettingsIcon sx={{ color: '#327C8D' }} />
        Bed Configuration
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 2 }}>
        {/* Add Beds Section */}
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>Add Beds</Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
            <Button size="small" variant={mode === 'single' ? 'contained' : 'outlined'} onClick={() => setMode('single')}
              sx={{ textTransform: 'none', fontSize: 12, ...(mode === 'single' ? { bgcolor: '#327C8D' } : { borderColor: '#327C8D', color: '#327C8D' }) }}>
              Single Bed
            </Button>
            <Button size="small" variant={mode === 'bulk' ? 'contained' : 'outlined'} onClick={() => setMode('bulk')}
              sx={{ textTransform: 'none', fontSize: 12, ...(mode === 'bulk' ? { bgcolor: '#327C8D' } : { borderColor: '#327C8D', color: '#327C8D' }) }}>
              Bulk Add
            </Button>
          </Box>

          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Ward</InputLabel>
                <Select value={ward} onChange={e => setWard(e.target.value)} label="Ward">
                  {['IPU', 'CCU', 'HDU', 'PARC', 'Seclusion'].map(w => <MenuItem key={w} value={w}>{w}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Bed Type</InputLabel>
                <Select value={bedType} onChange={e => setBedType(e.target.value)} label="Bed Type">
                  {BED_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            {mode === 'single' ? (
              <>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField label="Bed Number *" size="small" fullWidth value={bedNumber} onChange={e => setBedNumber(e.target.value)}
                    placeholder="e.g. IPU-01" />
                </Grid>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <Button fullWidth variant="contained" startIcon={<AddIcon />} onClick={handleAddSingle} disabled={saving}
                    sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, height: 40, textTransform: 'none' }}>
                    Add Bed
                  </Button>
                </Grid>
              </>
            ) : (
              <>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField label="Prefix" size="small" fullWidth value={bulkPrefix} onChange={e => setBulkPrefix(e.target.value)}
                    placeholder={ward} />
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField label="Count" size="small" fullWidth type="number" value={bulkCount}
                    onChange={e => setBulkCount(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
                    slotProps={{ htmlInput: { min: 1, max: 50 } }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 2 }}>
                  <Button fullWidth variant="contained" startIcon={<AddIcon />} onClick={handleAddBulk} disabled={saving}
                    sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, height: 40, textTransform: 'none' }}>
                    Add {bulkCount}
                  </Button>
                </Grid>
              </>
            )}
          </Grid>

          {error && <Alert role="alert" severity="error" sx={{ mt: 1, fontSize: 12 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mt: 1, fontSize: 12 }}>{success}</Alert>}
        </Paper>

        {/* Current Beds */}
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Current Beds ({(allBeds ?? []).length})
        </Typography>
        {Object.entries(bedsByWard).map(([wardName, beds]) => (
          <Box key={wardName} sx={{ mb: 2 }}>
            <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ textTransform: 'uppercase', fontSize: 11 }}>
              {wardName} ({beds.length} beds)
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
              {beds.sort((a, b) => (a.bed_number ?? '').localeCompare(b.bed_number ?? '')).map((bed) => (
                <Chip
                  key={bed.id}
                  label={bed.bed_number}
                  size="small"
                  onDelete={() => bed.status !== 'occupied' ? handleDelete(bed.id) : undefined}
                  deleteIcon={bed.status === 'occupied' ? undefined : <DeleteIcon sx={{ fontSize: 14 }} />}
                  onClick={() => handleToggleMaintenance(bed)}
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    bgcolor: bed.status === 'occupied' ? '#FFF3E0' : bed.status === 'maintenance' ? '#F5F5F5' : '#E8F5E9',
                    color: STATUS_COLORS[bed.status] ?? '#666',
                    border: `1px solid ${STATUS_COLORS[bed.status] ?? '#ddd'}`,
                    '& .MuiChip-deleteIcon': { color: '#D32F2F' },
                  }}
                />
              ))}
            </Box>
          </Box>
        ))}
        {(allBeds ?? []).length === 0 && (
          <Alert severity="info" sx={{ fontSize: 12 }}>No beds configured yet. Use the form above to add beds.</Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Click a bed to toggle maintenance. Click X to delete (only available/maintenance beds can be deleted).
        </Typography>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="contained" sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
