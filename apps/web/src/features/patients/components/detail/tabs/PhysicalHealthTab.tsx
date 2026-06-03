import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import {
  Box, Button, CircularProgress, Grid, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { physicalHealthKeys } from '../../../queryKeys';

// ── Main Component ────────────────────────────────────────────────────────────
//
// The Physical Health tab is now a focused tracking surface only. Latest
// investigations (previously auto-pulled from Pathology) and clinical
// notes (previously stored as note_type='physical_health') were removed
// to avoid duplicating data that already lives in:
//   - the Pathology tab (in the always-visible Snapshot group), and
//   - the specialty tabs' Clinical Notes sub-tabs (SpecialtyNotesPanel).
//
// Vitals + metabolic parameters are captured here via PhysicalHealthTracking,
// which writes to the nursing_assessments table with assessment_type =
// 'physical_tracking'. That data is the one canonical longitudinal record
// of weight / BP / BMI / waist / fasting glucose; the other tabs link to it
// rather than copying it.

interface PhysicalHealthTabProps { patientId: string }
export function PhysicalHealthTab({ patientId }: PhysicalHealthTabProps) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <MonitorHeartIcon sx={{ color: '#327C8D' }} />
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">Physical Health</Typography>
          <Typography variant="caption" color="text.secondary">
            Vitals &amp; metabolic tracking parameters. Investigations live in the Pathology tab;
            clinical notes live in the relevant specialty tab's Clinical Notes sub-tab.
          </Typography>
        </Box>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/*  TRACKING PARAMETERS — vitals + metabolic monitoring only.             */}
      {/*  Latest Investigations and Clinical Notes were intentionally removed:  */}
      {/*    - investigations are reachable via the Pathology tab in Snapshot    */}
      {/*    - clinical notes are written from the specialty tabs' Clinical      */}
      {/*      Notes sub-tabs (per the SpecialtyNotesPanel pattern).             */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderColor: '#327C8D', borderWidth: 2, borderRadius: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#327C8D', mb: 2 }}>
          Vitals &amp; Metabolic Monitoring
        </Typography>
        <PhysicalHealthTracking patientId={patientId} />
      </Paper>
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Physical Health Tracking — Weight, BP, BMI (exported for use in tab)
// ══════════════════════════════════════════════════════════════════════════════
interface PhysicalHealthTrackingProps { patientId: string }
interface PhysicalTrackingValues {
  date?: string;
  weight?: string;
  height?: string;
  bmi?: string;
  bpSystolic?: string;
  bpDiastolic?: string;
  heartRate?: string;
  waistCircumference?: string;
  bloodGlucose?: string;
  notes?: string;
}

interface PhysicalTrackingRow {
  id?: string;
  assessmentDatetime?: string;
  assessmentData?: PhysicalTrackingValues | null;
  scores?: PhysicalTrackingValues | null;
}

interface NursingAssessmentsResponse {
  data?: PhysicalTrackingRow[];
}

export function PhysicalHealthTracking({ patientId }: PhysicalHealthTrackingProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    weight: '', height: '', bpSystolic: '', bpDiastolic: '', heartRate: '',
    waistCircumference: '', bloodGlucose: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const bmi = form.weight && form.height
    ? (parseFloat(form.weight) / Math.pow(parseFloat(form.height) / 100, 2)).toFixed(1)
    : '';
  const bmiColor = bmi ? (parseFloat(bmi) >= 30 ? '#D32F2F' : parseFloat(bmi) >= 25 ? '#b8621a' : '#2E7D32') : '#999';

  const { data, isLoading } = useQuery({
    queryKey: physicalHealthKeys.tracking(patientId),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | PhysicalTrackingRow[]>('nursing-assessments', { patientId, assessmentType: 'physical_tracking', limit: 30 })
        .catch(() => ({ data: [] })),
  });
  const readings: PhysicalTrackingRow[] = Array.isArray(data) ? data : data?.data ?? [];

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.post('nursing-assessments', {
        patientId, assessmentType: 'physical_tracking',
        scores: { ...form, bmi }, totalScore: parseFloat(bmi) || 0,
      });
      // @catalogued: BUG-241 (Wave B-1) — no trackingRoot helper on physicalHealthKeys; broad invalidate
      qc.invalidateQueries({ queryKey: physicalHealthKeys.trackingAll() });
      setForm(f => ({ ...f, weight: '', bpSystolic: '', bpDiastolic: '', heartRate: '', bloodGlucose: '', notes: '' }));
    } catch { /* */ }
    setSaving(false);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 2 }}>
        Physical Health Tracking
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="Date" type="date" size="small" fullWidth value={form.date}
              onChange={e => setForm(p => ({ ...p, date: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 1.5 }}>
            <TextField label="Weight (kg)" size="small" fullWidth type="number" value={form.weight}
              onChange={e => setForm(p => ({ ...p, weight: e.target.value }))} />
          </Grid>
          <Grid size={{ xs: 6, sm: 1.5 }}>
            <TextField label="Height (cm)" size="small" fullWidth type="number" value={form.height}
              onChange={e => setForm(p => ({ ...p, height: e.target.value }))} />
          </Grid>
          <Grid size={{ xs: 6, sm: 1 }}>
            <Box sx={{ textAlign: 'center', pt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">BMI</Typography>
              <Typography variant="h6" fontWeight={800} sx={{ color: bmiColor, lineHeight: 1 }}>{bmi || '—'}</Typography>
            </Box>
          </Grid>
          <Grid size={{ xs: 4, sm: 1.5 }}>
            <TextField label="BP Sys" size="small" fullWidth value={form.bpSystolic}
              onChange={e => setForm(p => ({ ...p, bpSystolic: e.target.value }))} placeholder="120" />
          </Grid>
          <Grid size={{ xs: 4, sm: 1.5 }}>
            <TextField label="BP Dia" size="small" fullWidth value={form.bpDiastolic}
              onChange={e => setForm(p => ({ ...p, bpDiastolic: e.target.value }))} placeholder="80" />
          </Grid>
          <Grid size={{ xs: 4, sm: 1.5 }}>
            <TextField label="HR" size="small" fullWidth value={form.heartRate}
              onChange={e => setForm(p => ({ ...p, heartRate: e.target.value }))} placeholder="72" />
          </Grid>
          <Grid size={{ xs: 6, sm: 1.5 }}>
            <TextField label="Waist (cm)" size="small" fullWidth value={form.waistCircumference}
              onChange={e => setForm(p => ({ ...p, waistCircumference: e.target.value }))} />
          </Grid>
          <Grid size={{ xs: 6, sm: 1.5 }}>
            <TextField label="BGL (mmol)" size="small" fullWidth value={form.bloodGlucose}
              onChange={e => setForm(p => ({ ...p, bloodGlucose: e.target.value }))} />
          </Grid>
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Notes" size="small" fullWidth value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </Grid>
          <Grid size={{ xs: 12, sm: 1 }} sx={{ display: 'flex', alignItems: 'center' }}>
            <Button variant="contained" onClick={handleSave} disabled={saving}
              sx={{ bgcolor: '#327C8D', textTransform: 'none', fontSize: 11 }}>{saving ? '...' : 'Save'}</Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Tracking History */}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {readings.length > 0 && (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                {['Date', 'Weight', 'BMI', 'BP', 'HR', 'Waist', 'BGL', 'Notes'].map(h => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {readings.map((r, i: number) => {
                const ad = r.assessmentData && Object.keys(r.assessmentData).length > 0 ? r.assessmentData : null;
                const d = ad ?? r.scores ?? {};
                const b = d.bmi ? parseFloat(d.bmi) : null;
                return (
                  <TableRow key={r.id ?? i}>
                    <TableCell sx={{ fontSize: 10 }}>{d.date ?? (r.assessmentDatetime ? new Date(r.assessmentDatetime).toLocaleDateString('en-AU') : '—')}</TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 600 }}>{d.weight ? `${d.weight} kg` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10, fontWeight: 700, color: b ? (b >= 30 ? '#D32F2F' : b >= 25 ? '#b8621a' : '#2E7D32') : '#999' }}>
                      {d.bmi ?? '—'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{d.bpSystolic ? `${d.bpSystolic}/${d.bpDiastolic}` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{d.heartRate ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{d.waistCircumference ? `${d.waistCircumference} cm` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{d.bloodGlucose ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.notes ?? ''}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export default PhysicalHealthTab;
