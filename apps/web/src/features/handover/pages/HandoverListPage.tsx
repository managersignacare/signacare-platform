import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PersonIcon from '@mui/icons-material/Person';
import SaveIcon from '@mui/icons-material/Save';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
    Alert, Box, Button, Chip, CircularProgress, Grid, Paper,
    Tab, Tabs, TextField, Typography
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { llmAiJobsApi } from '../../../shared/services/llmAiJobsApi';
import { useAuthStore } from '../../../shared/store/authStore';
import { handoverKeys } from '../queryKeys';

type ShiftType = 'morning' | 'afternoon' | 'night';
type UnknownRecord = Record<string, unknown>

interface TeamAssignmentRow {
  primaryClinicianId?: string
  primary_clinician_id?: string
  patientId?: string
  patient_id?: string
}

interface CaseloadPatientRow {
  id: string
  patient_id?: string
  patientName?: string
  givenName?: string
  given_name?: string
  familyName?: string
  family_name?: string
  emr_number?: string
  emrNumber?: string
}

interface HandoverPatientUpdate {
  patientId?: string
  patientName?: string
  note?: string
}

interface HandoverRow {
  id?: string
  outgoingStaffId?: string
  outgoing_staff_id?: string
  shiftType?: string
  shift_type?: string
  shiftDate?: string
  shift_date?: string
  summaryManual?: string
  summary_manual?: string
  patientUpdates?: string | HandoverPatientUpdate[]
  patient_updates?: string | HandoverPatientUpdate[]
}

interface HandoverListResponse {
  data?: HandoverRow[]
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null
}

function readPatientUpdates(raw: HandoverRow['patientUpdates'] | HandoverRow['patient_updates']): HandoverPatientUpdate[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as HandoverPatientUpdate[]) : []
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? raw : []
}

function readHandoverRows(payload: HandoverListResponse | HandoverRow[]): HandoverRow[] {
  if (Array.isArray(payload)) return payload
  const rec = asRecord(payload)
  if (!rec || !Array.isArray(rec.data)) return []
  return rec.data as HandoverRow[]
}

function getShiftType(): ShiftType {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'morning';
  if (h >= 14 && h < 22) return 'afternoon';
  return 'night';
}

export default function HandoverListPage(): React.ReactElement {
  const user = useAuthStore(s => s.user);
  const [tab, setTab] = useState<'write' | 'incoming'>('write');
  const [shiftType, setShiftType] = useState<ShiftType>(getShiftType());
  const today = new Date().toISOString().slice(0, 10);

  // Get patients allocated to the logged-in clinician via team assignments
  const { data: caseloadData, isLoading: loadingCaseload } = useQuery({
    queryKey: handoverKeys.caseload(user?.id),
    queryFn: async () => {
      // Strategy: get patients where logged-in user is primary clinician on an open episode
      try {
        const assignments = await apiClient.get<{ assignments: TeamAssignmentRow[] }>('patients/team-assignments').then(r => r.assignments ?? []);
        const myAssigned = assignments.filter((a) =>
          (a.primaryClinicianId ?? a.primary_clinician_id) === user?.id
        );
        if (myAssigned.length > 0) {
          // Fetch patient details for assigned patients
          const patientIds = [...new Set(myAssigned
            .map((a) => a.patientId ?? a.patient_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0))];
          const patients = await apiClient.get<{ data: CaseloadPatientRow[] }>('patients', { limit: 200 }).then(r => r.data ?? []);
          return patients.filter((p) => patientIds.includes(p.id));
        }
      } catch { /* fall through */ }
      // Fallback: try dashboard caseload
      try {
        const r = await apiClient.get<{ data?: CaseloadPatientRow[] } | CaseloadPatientRow[]>('dashboard/caseload');
        const caseload = Array.isArray(r) ? r : (r.data ?? []);
        if (caseload.length > 0) return caseload;
      } catch { /* fall through */ }
      // Final fallback: all active patients (limited)
      const r = await apiClient.get<{ data?: CaseloadPatientRow[] } | CaseloadPatientRow[]>('patients', { limit: 50, status: 'active' });
      return Array.isArray(r) ? r : (r.data ?? []);
    },
    enabled: !!user?.id,
  });
  const myPatients: CaseloadPatientRow[] = caseloadData ?? [];

  // Get existing handover notes for today (my shift)
  const { data: existingNotes } = useQuery({
    queryKey: handoverKeys.notesToday(shiftType, today),
    queryFn: () => apiClient.get<HandoverListResponse>('shift-handovers', {
      shiftType, shiftDate: today, outgoingStaffId: user?.id,
    }).catch(() => ({ data: [] as HandoverRow[] })),
  });
  const todayNotes: HandoverRow[] = existingNotes ? readHandoverRows(existingNotes) : [];

  // Get incoming handover notes — all recent handovers (today + yesterday for cross-shift)
  const { data: incomingData } = useQuery({
    queryKey: handoverKeys.incoming(today, user?.id),
    queryFn: async () => {
      // Fetch today's and yesterday's handovers to cover cross-shift overlap
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const [todayNotes, yesterdayNotes] = await Promise.all([
        apiClient.get<HandoverListResponse>('shift-handovers', { shiftDate: today, limit: 50 }).catch(() => ({ data: [] as HandoverRow[] })),
        apiClient.get<HandoverListResponse>('shift-handovers', { shiftDate: yesterday, limit: 50 }).catch(() => ({ data: [] as HandoverRow[] })),
      ]);
      const all = [...readHandoverRows(todayNotes), ...readHandoverRows(yesterdayNotes)];
      // Deduplicate by id
      const seen = new Set<string>();
      return all.filter((n) => {
        const id = n.id;
        if (!id) return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },
    enabled: tab === 'incoming',
  });
  const incomingNotes: HandoverRow[] = (incomingData ?? [])
    .filter((n) => {
      // Exclude my own handovers (I wrote them, I don't need to read them back)
      if ((n.outgoingStaffId ?? n.outgoing_staff_id) === user?.id) return false;
      // Filter to show notes containing my patients
      if (!myPatients.length) return true;
      const notePatients = readPatientUpdates(n.patientUpdates ?? n.patient_updates);
      if (notePatients.length === 0 && (n.summaryManual ?? n.summary_manual)) return true; // general handover
      return notePatients.some((p) => myPatients.some((mp) => mp.id === p.patientId));
    });

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SwapHorizIcon sx={{ color: '#7B1FA2', fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">
              Shift Handover
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Write handover notes for your patients. Notes are saved to each patient's record.
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button variant="contained" size="small" onClick={() => setTab('write')}
            sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, textTransform: 'none', mr: 1 }}>
            + New Handover
          </Button>
          {(['morning', 'afternoon', 'night'] as const).map(s => (
            <Chip key={s} label={s} onClick={() => setShiftType(s)}
              sx={{ cursor: 'pointer', textTransform: 'capitalize', fontWeight: 600,
                bgcolor: shiftType === s ? '#7B1FA2' : '#eee', color: shiftType === s ? '#fff' : '#555' }} />
          ))}
        </Box>
      </Box>

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label="Write Handover" value="write" />
        <Tab label="Incoming Handover" value="incoming" />
      </Tabs>

      {tab === 'write' && (
        <WriteHandoverPanel
          patients={myPatients}
          shiftType={shiftType}
          shiftDate={today}
          userId={user?.id ?? ''}
          loading={loadingCaseload}
          existingNotes={todayNotes}
        />
      )}

      {tab === 'incoming' && (
        <IncomingHandoverPanel
          notes={incomingNotes}
          myPatients={myPatients}
        />
      )}
    </Box>
  );
}

// ── Write Handover: per-patient notes ────────────────────────────────────────
interface WriteHandoverPanelProps { patients: CaseloadPatientRow[]; shiftType: ShiftType; shiftDate: string; userId: string; loading: boolean; existingNotes: HandoverRow[]; }
function WriteHandoverPanel({ patients, shiftType, shiftDate, loading }: WriteHandoverPanelProps) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [freeformNote, setFreeformNote] = useState('');

  const updateNote = (patientId: string, text: string) => {
    setNotes(p => ({ ...p, [patientId]: text }));
    setSaved(false);
  };

  const saveFreeform = async () => {
    if (!freeformNote.trim()) return;
    setSaving(true);
    try {
      await apiClient.post('shift-handovers', {
        shiftType, shiftDate,
        summaryManual: freeformNote.trim(),
        patientUpdates: JSON.stringify([]),
        keyIssues: JSON.stringify([]),
        pendingActions: JSON.stringify([]),
        status: 'completed',
      });
      qc.invalidateQueries({ queryKey: handoverKeys.notesTodayAll() });
      qc.invalidateQueries({ queryKey: handoverKeys.shiftHandovers() });
      setSaved(true);
      setFreeformNote('');
    } catch { alert('Failed to save handover'); }
    setSaving(false);
  };

  const saveAll = async () => {
    setSaving(true);
    const patientUpdates = Object.entries(notes)
      .filter(([_, text]) => text.trim())
      .map(([patientId, text]) => ({
        patientId,
        patientName: patients.find(p => (p.patient_id ?? p.id) === patientId)?.patientName ??
          patients.find(p => (p.patient_id ?? p.id) === patientId)?.givenName ?? 'Patient',
        note: text.trim(),
      }));

    if (patientUpdates.length === 0) { setSaving(false); return; }

    try {
      await apiClient.post('shift-handovers', {
        shiftType,
        shiftDate,
        summaryManual: `Handover notes for ${patientUpdates.length} patient(s)`,
        patientUpdates: JSON.stringify(patientUpdates),
        keyIssues: JSON.stringify(patientUpdates.filter(p => p.note.length > 100).map(p => p.patientName)),
        pendingActions: JSON.stringify([]),
        status: 'completed',
      });
      qc.invalidateQueries({ queryKey: handoverKeys.notesTodayAll() });
      qc.invalidateQueries({ queryKey: handoverKeys.shiftHandovers() });
      setSaved(true);
    } catch {
      alert('Failed to save handover notes');
    }
    setSaving(false);
  };

  if (loading) return <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />;

  if (patients.length === 0) return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>No patients in your caseload. You can still write a general handover note below.</Alert>
      <TextField label="General Handover Note" fullWidth multiline rows={6} value={freeformNote} onChange={e => setFreeformNote(e.target.value)}
        placeholder="Enter general shift handover information — ward updates, staffing, incidents, pending actions..." />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, gap: 1 }}>
        {saved && <Typography variant="caption" color="success.main" sx={{ alignSelf: 'center' }}>Saved</Typography>}
        <Button variant="contained" size="small" disabled={saving || !freeformNote.trim()} onClick={saveFreeform}
          sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, textTransform: 'none' }}>
          {saving ? 'Saving...' : 'Save Handover'}
        </Button>
      </Box>
    </Box>
  );

  const filledCount = Object.values(notes).filter(n => n.trim()).length;

  const generateAiSummary = async () => {
    setAiLoading(true);
    const patientNotes = Object.entries(notes)
      .filter(([_, text]) => text.trim())
      .map(([pid, text]) => {
        const pt = patients.find(p => (p.patient_id ?? p.id) === pid);
        return `${pt?.patientName ?? pt?.givenName ?? 'Patient'}: ${text.trim()}`;
      })
      .join('\n\n');
    try {
      const result = await llmAiJobsApi.runClinicalAiJob({
        action: 'handover-summary',
        data: patientNotes,
        enhance: false,
      });
      setAiSummary(result);
    } catch {
      setAiSummary('AI summary unavailable. Check that Ollama is running.');
    }
    setAiLoading(false);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {patients.length} patient{patients.length > 1 ? 's' : ''} in your caseload | {filledCount} note{filledCount !== 1 ? 's' : ''} written
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={aiLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={14} /> : <AutoAwesomeIcon />}
            disabled={aiLoading || filledCount === 0} onClick={generateAiSummary}
            sx={{ textTransform: 'none', borderColor: '#7B1FA2', color: '#7B1FA2', fontSize: 12 }}>
            {aiLoading ? 'Generating...' : 'AI Summary'}
          </Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <SaveIcon />}
            disabled={saving || filledCount === 0} onClick={saveAll}
            sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, textTransform: 'none' }}>
            {saving ? 'Saving...' : `Save Handover (${filledCount})`}
          </Button>
        </Box>
      </Box>

      {saved && <Alert severity="success" sx={{ mb: 2, fontSize: 12 }}>Handover notes saved to each patient's record.</Alert>}

      {aiSummary && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderLeft: '4px solid #7B1FA2', bgcolor: '#F3E5F5' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AutoAwesomeIcon sx={{ fontSize: 16, color: '#7B1FA2' }} />
            <Typography variant="subtitle2" fontWeight={700} color="#7B1FA2">AI Shift Summary</Typography>
          </Box>
          <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#3D484B' }}>{aiSummary}</Typography>
        </Paper>
      )}

      <Grid container spacing={2}>
        {patients.map((p) => {
          const pid = p.patient_id ?? p.id;
          const name = p.patientName ?? `${p.givenName ?? p.given_name ?? ''} ${p.familyName ?? p.family_name ?? ''}`.trim() ?? 'Patient';
          const emr = p.emr_number ?? p.emrNumber ?? '';
          const noteText = notes[pid] ?? '';
          const hasNote = noteText.trim().length > 0;

          return (
            <Grid key={pid} size={{ xs: 12, md: 6 }}>
              <Paper variant="outlined" sx={{ p: 2, borderLeft: hasNote ? '4px solid #7B1FA2' : '4px solid #eee' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <PersonIcon sx={{ color: hasNote ? '#7B1FA2' : '#999', fontSize: 18 }} />
                  <Typography variant="body2" fontWeight={700} color="#3D484B">{name}</Typography>
                  {emr && <Chip label={emr} size="small" sx={{ fontSize: 9, height: 18 }} />}
                  {hasNote && <CheckCircleIcon sx={{ fontSize: 14, color: '#7B1FA2', ml: 'auto' }} />}
                </Box>
                <TextField
                  fullWidth multiline rows={3} size="small"
                  placeholder={`Handover notes for ${name}...\ne.g. Settled overnight, PRN lorazepam given at 0300, effective.`}
                  value={noteText}
                  onChange={e => updateNote(pid, e.target.value)}
                  sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
                />
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

// ── Incoming Handover: notes from previous shift for my patients ──────────────
interface IncomingHandoverPanelProps { notes: HandoverRow[]; myPatients: CaseloadPatientRow[] }
function IncomingHandoverPanel({ notes, myPatients }: IncomingHandoverPanelProps) {
  // Build a per-patient view of all incoming handover notes
  const perPatientNotes = React.useMemo(() => {
    const map = new Map<string, { patientName: string; notes: { shiftType: string; shiftDate: string; note: string; authorId: string }[] }>();

    for (const handover of notes) {
      const updates = readPatientUpdates(handover.patientUpdates ?? handover.patient_updates);

      const shiftType = handover.shiftType ?? handover.shift_type ?? 'shift';
      const shiftDate = handover.shiftDate ?? handover.shift_date ?? '';
      const authorId = handover.outgoingStaffId ?? handover.outgoing_staff_id ?? '';

      // Per-patient updates
      for (const pu of updates) {
        const pid = pu.patientId;
        if (!pid) continue;
        if (myPatients.length > 0 && !myPatients.some((mp) => mp.id === pid)) continue;
        if (!map.has(pid)) map.set(pid, { patientName: pu.patientName ?? 'Patient', notes: [] });
        map.get(pid)!.notes.push({ shiftType, shiftDate, note: pu.note ?? '', authorId });
      }

      // General handover (no patient-specific)
      if (updates.length === 0 && (handover.summaryManual ?? handover.summary_manual)) {
        const key = '_general';
        if (!map.has(key)) map.set(key, { patientName: 'General Handover', notes: [] });
        map.get(key)!.notes.push({ shiftType, shiftDate, note: handover.summaryManual ?? handover.summary_manual ?? '', authorId });
      }
    }
    return map;
  }, [notes, myPatients]);

  if (notes.length === 0 && perPatientNotes.size === 0) return (
    <Alert severity="info">No incoming handover notes for your patients from the previous shift.</Alert>
  );

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        Incoming handover notes for your {myPatients.length} allocated patient{myPatients.length !== 1 ? 's' : ''} — grouped by patient
      </Typography>

      {Array.from(perPatientNotes.entries()).map(([pid, { patientName, notes: pNotes }]) => (
        <Paper key={pid} variant="outlined" sx={{ p: 2, mb: 1.5, borderLeft: `4px solid ${pid === '_general' ? '#999' : '#7B1FA2'}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <PersonIcon sx={{ color: '#7B1FA2', fontSize: 18 }} />
            <Typography variant="subtitle2" fontWeight={700}>{patientName}</Typography>
            <Chip label={`${pNotes.length} note${pNotes.length !== 1 ? 's' : ''}`} size="small" sx={{ fontSize: 9, height: 18 }} />
          </Box>
          {pNotes.map((n, j) => (
            <Box key={j} sx={{ mb: 1, pl: 2, borderLeft: '2px solid #E0E0E0' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.3 }}>
                {n.shiftType} shift — {n.shiftDate ? new Date(n.shiftDate).toLocaleDateString('en-AU') : ''}
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{n.note}</Typography>
            </Box>
          ))}
        </Paper>
      ))}

      {/* Legacy format: show raw handover notes that don't parse into per-patient format */}
      {notes.filter((n) => {
        const updates = readPatientUpdates(n.patientUpdates ?? n.patient_updates);
        return updates.length === 0 && !(n.summaryManual ?? n.summary_manual);
      }).map((note, i: number) => (
        <Paper key={note.id ?? `legacy-${i}`} variant="outlined" sx={{ p: 2, mb: 1.5, borderLeft: '4px solid #999' }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {note.shiftType ?? note.shift_type ?? 'Shift'} Handover — {note.shiftDate ?? note.shift_date ?? ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">Raw handover record</Typography>
        </Paper>
      ))}
    </Box>
  );
}
