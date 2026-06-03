// apps/web/src/features/medications/components/MarChartPanel.tsx
//
// BUG-524-D — extracted from MedicationsTab.tsx (was L1103-1459) per
// the hybrid 2-tab split plan. Medication Administration Record (MAR)
// chart — clinical-safety RELEVANT (administration record is the
// AHPRA-required audit trail; missing dose / refused dose / withheld
// dose all need documented codes per local policy).
//
// Imported by ActiveMedicationsTab as a sub-section inside the Active
// Medications tab.

import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControl, MenuItem, Paper, Select, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { tryAsync, isErr } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { patientMedicationsKeys, inpatientKeys } from '../../patients/queryKeys';

interface MedicationRecord {
  id: string;
  status?: string;
  medicationName?: string;
  medication_name?: string;
  drugLabel?: string;
  drug_label?: string;
  dose?: string;
  doseAmount?: string;
  route?: string;
  frequency?: string;
  dosageFrequency?: string;
}

interface AdministrationRecord {
  id?: string;
  patient_medication_id?: string;
  patientMedicationId?: string;
  scheduled_time?: string;
  scheduledTime?: string;
  administered_time?: string;
  administeredTime?: string;
  status?: string;
  administration_context?: string;
  administrationContext?: string;
  notes?: string;
  prn_reason?: string;
}

interface AdministrationResponse {
  data?: AdministrationRecord[];
}

interface MarRow {
  medId: string;
  name: string;
  dose: string;
  route: string;
  freq: string;
  isPrn: boolean;
  scheduledTimes: string[];
}

interface AdministrationCreatePayload {
  patientId: string;
  patientMedicationId: string;
  scheduledTime: string;
  administeredTime: string;
  status: string;
  doseGiven: string;
  route: string;
  administrationContext: string;
  notes?: string;
  prnReason?: string;
}

interface ClinicalAiResponse {
  result?: string;
}

function getScheduledTimes(frequency: string): string[] {
  const f = (frequency ?? '').toLowerCase();
  if (f.includes('nocte') || f.includes('night')) return ['22:00'];
  if (f.includes('mane') || f.includes('morning') || f.includes('daily') || f.includes('od')) return ['08:00'];
  if (f.includes('bd') || f.includes('twice')) return ['08:00', '20:00'];
  if (f.includes('tds') || f.includes('three')) return ['08:00', '14:00', '22:00'];
  if (f.includes('qid') || f.includes('four')) return ['06:00', '12:00', '18:00', '22:00'];
  if (f.includes('prn')) return []; // PRN has no scheduled times
  if (f.includes('weekly') || f.includes('fortnightly')) return ['08:00'];
  return ['08:00']; // default to morning
}

const ADMIN_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  given:     { label: 'Given',     color: '#2E7D32', bg: '#E8F5E9', icon: '✓' },
  refused:   { label: 'Refused',   color: '#D32F2F', bg: '#FDECEA', icon: '✗' },
  withheld:  { label: 'Withheld',  color: '#b8621a', bg: '#FFF3E0', icon: '—' },
  'not-due': { label: 'Not Due',   color: '#999',    bg: '#F5F5F5', icon: '·' },
};

const ADMIN_CONTEXT: Record<string, { label: string; color: string }> = {
  supervised:        { label: 'Supervised',         color: '#327C8D' },
  self_administered: { label: 'Self Administered',  color: '#3D484B' },
  inpatient:         { label: 'Inpatient',          color: '#b8621a' },
  community:         { label: 'Community',          color: '#2E7D32' },
  // These come from patient mobile app only (read-only display)
  supervised_family: { label: 'Family Supervised (via app)', color: '#7B1FA2' },
  patient_app:       { label: 'Patient App',        color: '#1565C0' },
};

interface MarChartPanelProps { patientId: string }
export function MarChartPanel({ patientId }: MarChartPanelProps) {
  const qc = useQueryClient();
  const [adminDialog, setAdminDialog] = useState<{ medId: string; medName: string; time: string; dose: string; route: string } | null>(null);
  const [adminStatus, setAdminStatus] = useState('given');
  const [adminContext, setAdminContext] = useState('supervised');
  const [adminNotes, setAdminNotes] = useState('');
  const [adminTime, setAdminTime] = useState(new Date().toTimeString().slice(0, 5));
  const [prnReason, setPrnReason] = useState('');
  const [marView, setMarView] = useState<'today' | 'longitudinal'>('today');
  const [period, setPeriod] = useState('7');
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Fetch active medications (auto-populate MAR from prescriptions).
  //
  // BUG-612 closes the active-meds rail of the MAR safety surface
  // (sibling of BUG-608 which closed the administrations rail). The
  // parent ActiveMedicationsTab already destructures `isError` on the
  // SAME query key (`patientMedicationsKeys.byPatient(patientId)`) and
  // surfaces the failure (BUG-548 closure shape, MedicationsTab.tsx:82),
  // and React-Query de-dups by key so production-mount failures are
  // covered. But standalone mounts (testing, dashboard widgets, future
  // re-parenting) re-open the harm class — `medsData` undefined →
  // `activeMeds = []` → "No active medications" friendly empty-state UI
  // instead of a failure banner. Per BUG-530 SSoT (CLAUDE.md §16.2),
  // the panel is now internally fail-loud regardless of mount context.
  const { data: medsData, isLoading: medsLoading, isError: medsError } = useQuery<MedicationRecord[]>({
    queryKey: patientMedicationsKeys.byPatient(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<MedicationRecord[] | { data?: MedicationRecord[] }>(`medications/patients/${patientId}/medications`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : Array.isArray(r.value?.data) ? r.value.data : [];
    },
    enabled: !!patientId,
  });

  // Fetch administrations for selected period.
  //
  // BUG-608 closes the silent-catch lie-about-success class on this
  // clinical-safety surface (sibling of BUG-441/445/548). The pre-fix
  // queryFn caught the rejection and returned an empty-data envelope,
  // collapsing fetch failure into "no doses recorded today" — a nurse
  // on the MAR after a network blip would see green "not-due" cells
  // when the actual dose status is unknown, with double-dosing or
  // missed-dosing harm class. Per BUG-530 SSoT (CLAUDE.md §16.2), use
  // tryAsync to surface failure explicitly via React-Query's isError
  // state and render the failure banner below.
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - parseInt(period, 10) * 86400000).toISOString().slice(0, 10);
  const { data: adminsData, isError: adminsError } = useQuery<AdministrationRecord[] | AdministrationResponse>({
    queryKey: inpatientKeys.marAdministrationsByDate(patientId, marView === 'today' ? today : fromDate),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<AdministrationRecord[] | AdministrationResponse>('medication-administrations', {
        patientId, date: marView === 'today' ? today : undefined,
        from: marView === 'longitudinal' ? fromDate : undefined,
        to: today, limit: 500,
      }));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    enabled: !!patientId,
  });
  const administrations: AdministrationRecord[] = Array.isArray(adminsData)
    ? adminsData
    : (adminsData?.data ?? []);

  const activeMeds = (medsData ?? []).filter((m) => m.status === 'active' || m.status === 'tapering');
  const timeSlots = ['06:00', '08:00', '10:00', '12:00', '14:00', '18:00', '20:00', '22:00'];

  // AI adherence summary
  const generateAiSummary = async () => {
    setAiLoading(true);
    const refused = administrations.filter(a => a.status === 'refused').length;
    const withheld = administrations.filter(a => a.status === 'withheld').length;
    const given = administrations.filter(a => a.status === 'given').length;
    const total = refused + withheld + given;
    const summary = `Medication adherence: ${given}/${total} doses given (${total > 0 ? Math.round(given/total*100) : 0}%). ` +
      `${refused} refused, ${withheld} withheld.`;
    try {
      const resp = await apiClient.instance.post<ClinicalAiResponse>('llm/clinical-ai', {
        action: 'medication-adherence',
        data: JSON.stringify({ given, refused, withheld, total, medications: activeMeds.map((m) => m.medicationName ?? m.drug_label).join(', ') }),
      }, { timeout: 60_000 });
      setAiSummary(resp.data?.result ?? summary);
    } catch {
      // (intentional silent — BUG-609) deterministic local computation above
      // already produced a complete numeric summary (given/refused/withheld
      // counts + adherence percentage). The LLM call is a presentational
      // enhancement; on LLM-service failure we fall back to the local string
      // because the underlying data is correct and observable to the nurse.
      setAiSummary(summary);
    }
    setAiLoading(false);
  };

  // Build MAR grid: each active med with its scheduled times
  const marRows: MarRow[] = activeMeds.map((med) => {
    const name = med.medicationName ?? med.medication_name ?? med.drugLabel ?? med.drug_label ?? 'Medication';
    const dose = String(med.dose ?? med.doseAmount ?? '');
    const route = med.route ?? 'Oral';
    const freq = med.frequency ?? med.dosageFrequency ?? '';
    const isPrn = (freq ?? '').toLowerCase().includes('prn');
    const scheduledTimes = isPrn ? [] : getScheduledTimes(freq);
    const medId = med.id;

    return { medId, name, dose, route, freq, isPrn, scheduledTimes };
  });

  // BUG-615 — MAR administration record save mutation now uses
  // tryAsync per BUG-530 SSoT (CLAUDE.md §16.2). Pre-fix the bare
  // `apiClient.post('medication-administrations', d)` had no onError
  // surfacing — on rejection the button transitioned back from
  // "Saving..." with no error feedback. Nurse could believe the
  // administration recorded when it did not → patient gets duplicate
  // dose at next time slot OR audit trail incomplete (AHPRA-required
  // medication chart audit-trail integrity violation). Same harm
  // class as BUG-614 closes on the LAI WRITE rail. Post-fix:
  // tryAsync rethrows on error so React-Query exposes
  // `adminMut.isError` + `.error`; the dialog renders an explicit
  // `<Alert role="alert" severity="error">` and STAYS OPEN on error
  // (the dialog already only closes onSuccess via
  // `setAdminDialog(null)`, so the retry workflow is preserved by
  // design — symmetric with the BUG-614 closure shape).
  const adminMut = useMutation({
    mutationFn: async (d: AdministrationCreatePayload) => {
      const r = await tryAsync(() => apiClient.post('medication-administrations', d));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inpatientKeys.marAdministrationsAll() });
      setAdminDialog(null);
      setAdminNotes('');
      setPrnReason('');
    },
  });

  const handleAdmin = () => {
    if (!adminDialog) return;
    adminMut.mutate({
      patientId,
      patientMedicationId: adminDialog.medId,
      scheduledTime: `${today}T${adminDialog.time}:00`,
      administeredTime: `${today}T${adminTime}:00`,
      status: adminStatus,
      doseGiven: adminDialog.dose,
      route: adminDialog.route,
      administrationContext: adminContext,
      notes: adminNotes || undefined,
      prnReason: prnReason || undefined,
    });
  };

  if (medsLoading) return <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress role="progressbar" aria-label="Loading" size={24} /></Box>;

  return (
    <Box>
      {/* Controls bar */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Chip label="Today" size="small" onClick={() => setMarView('today')}
            sx={{ cursor: 'pointer', fontWeight: 600, fontSize: 11, bgcolor: marView === 'today' ? '#327C8D' : '#eee', color: marView === 'today' ? '#fff' : '#555' }} />
          <Chip label="Longitudinal" size="small" onClick={() => setMarView('longitudinal')}
            sx={{ cursor: 'pointer', fontWeight: 600, fontSize: 11, bgcolor: marView === 'longitudinal' ? '#327C8D' : '#eee', color: marView === 'longitudinal' ? '#fff' : '#555' }} />
        </Box>
        {marView === 'longitudinal' && (
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <Select value={period} onChange={e => setPeriod(e.target.value)} sx={{ fontSize: 11, height: 28 }}>
              <MenuItem value="7">7 days</MenuItem>
              <MenuItem value="14">14 days</MenuItem>
              <MenuItem value="30">30 days</MenuItem>
              <MenuItem value="90">90 days</MenuItem>
            </Select>
          </FormControl>
        )}
        <Box sx={{ flex: 1 }} />
        {Object.entries(ADMIN_STATUS_CONFIG).filter(([k]) => k !== 'not-due').map(([key, cfg]) => (
          <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cfg.color }} />
            <Typography variant="caption" sx={{ fontSize: 9 }}>{cfg.label}</Typography>
          </Box>
        ))}
        <Button size="small" onClick={generateAiSummary} disabled={aiLoading}
          sx={{ fontSize: 10, textTransform: 'none', color: '#327C8D' }}>
          {aiLoading ? 'Generating...' : 'AI Summary'}
        </Button>
      </Box>

      {/* AI adherence summary */}
      {aiSummary && (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderLeft: '3px solid #327C8D', bgcolor: '#F5F9FA' }}>
          <Typography variant="body2" sx={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{aiSummary}</Typography>
        </Paper>
      )}

      {(medsError || adminsError) && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to load MAR {medsError && adminsError ? 'medications and administrations' : medsError ? 'medications' : 'administrations'}. The MAR display may be incomplete — refresh to retry. Do not rely on this view for dose decisions while the error persists.
        </Alert>
      )}

      {activeMeds.length === 0 ? (
        <Alert severity="info">No active medications. Prescribe medications to populate the MAR chart.</Alert>
      ) : (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, minWidth: 150 }}>Medication</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, minWidth: 60 }}>Dose</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, minWidth: 50 }}>Route</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11, minWidth: 80 }}>Frequency</TableCell>
                {timeSlots.map(t => (
                  <TableCell key={t} align="center" sx={{ fontWeight: 700, fontSize: 9, px: 0.25, minWidth: 40 }}>{t}</TableCell>
                ))}
                <TableCell align="center" sx={{ fontWeight: 700, fontSize: 9, minWidth: 40 }}>PRN</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {marRows.map((row: MarRow, i: number) => (
                <TableRow key={row.medId ?? i} sx={{ '&:hover': { bgcolor: '#faf8f5' } }}>
                  <TableCell sx={{ fontSize: 11, fontWeight: 600 }}>{row.name}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{row.dose}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{row.route}</TableCell>
                  <TableCell sx={{ fontSize: 10, color: 'text.secondary' }}>{row.freq}</TableCell>
                  {timeSlots.map(t => {
                    const isScheduled = row.scheduledTimes.includes(t);
                    const admin = administrations.find((a) =>
                      (a.patient_medication_id === row.medId || a.patientMedicationId === row.medId) &&
                      (a.scheduled_time ?? a.scheduledTime ?? '').includes(t)
                    );
                    const status = admin?.status ?? (isScheduled ? 'not-due' : null);
                    const cfg = status ? ADMIN_STATUS_CONFIG[status] ?? ADMIN_STATUS_CONFIG['not-due'] : null;
                    const ctx = admin?.administration_context ?? admin?.administrationContext;

                    if (!isScheduled && !admin) {
                      return <TableCell key={t} align="center" sx={{ px: 0.25 }}><Box sx={{ width: 20, height: 20 }} /></TableCell>;
                    }

                    // BUG-447-medications: split into decorative (already-recorded) +
                    // interactive (schedulable) branches. The interactive branch carries
                    // role="button" + tabIndex={0} + onKeyDown so keyboard-only nurses
                    // can record administration via Enter/Space. WCAG 2.1.1.
                    const cellSx = {
                      width: 22, height: 22, borderRadius: '50%', mx: 'auto',
                      bgcolor: cfg?.bg ?? '#eee', border: `2px solid ${cfg?.color ?? '#ccc'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, color: cfg?.color ?? '#999',
                    };
                    const fireAdminDialog = () => setAdminDialog({ medId: row.medId, medName: row.name, time: t, dose: row.dose, route: row.route });
                    return (
                      <TableCell key={t} align="center" sx={{ px: 0.25 }}>
                        <Tooltip title={admin ? `${cfg?.label} ${ctx ? `(${ADMIN_CONTEXT[ctx]?.label ?? ctx})` : ''}` : 'Click to record'}>
                          {admin ? (
                            <Box aria-label={`Recorded ${cfg?.label}${ctx ? ` (${ADMIN_CONTEXT[ctx]?.label ?? ctx})` : ''} for ${row.name} at ${t}`} sx={{ ...cellSx, cursor: 'default' }}>
                              {cfg?.icon ?? ''}
                            </Box>
                          ) : (
                            <Box
                              role="button"
                              tabIndex={0}
                              aria-label={`Record administration for ${row.name} ${row.dose} at ${t}`}
                              onClick={fireAdminDialog}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fireAdminDialog(); } }}
                              sx={{ ...cellSx, cursor: 'pointer', '&:hover': { transform: 'scale(1.2)', boxShadow: 1 }, '&:focus-visible': { outline: `2px solid ${cfg?.color ?? '#327C8D'}`, outlineOffset: 2 } }}
                            >
                              {cfg?.icon ?? ''}
                            </Box>
                          )}
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                  {/* PRN column */}
                  <TableCell align="center" sx={{ px: 0.25 }}>
                    {row.isPrn && (
                      <Button size="small" onClick={() => setAdminDialog({ medId: row.medId, medName: row.name, time: new Date().toTimeString().slice(0, 5), dose: row.dose, route: row.route })}
                        sx={{ fontSize: 9, minWidth: 30, color: '#b8621a', fontWeight: 700, p: 0.25 }}>
                        PRN
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Longitudinal Daily Report */}
      {marView === 'longitudinal' && administrations.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Daily Administration Report — Last {period} Days</Typography>
          <TableContainer role="region" aria-label="Data table">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                  {['Date', 'Medication', 'Time', 'Status', 'Context', 'Notes'].map(h => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {administrations
                  .sort((a, b) => (b.administered_time ?? b.scheduledTime ?? '').localeCompare(a.administered_time ?? a.scheduledTime ?? ''))
                  .map((a, i: number) => {
                    const dt = a.administered_time ?? a.administeredTime ?? a.scheduled_time ?? a.scheduledTime ?? '';
                    const d = dt ? new Date(dt) : null;
                    const status = a.status ?? 'given';
                    const cfg = ADMIN_STATUS_CONFIG[status] ?? ADMIN_STATUS_CONFIG.given;
                    const ctx = a.administration_context ?? a.administrationContext ?? '';
                    const med = activeMeds.find((m) => m.id === (a.patient_medication_id ?? a.patientMedicationId));
                    return (
                      <TableRow key={a.id ?? i}>
                        <TableCell sx={{ fontSize: 10 }}>{d ? d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—'}</TableCell>
                        <TableCell sx={{ fontSize: 10, fontWeight: 600 }}>{med?.medicationName ?? med?.drug_label ?? '—'}</TableCell>
                        <TableCell sx={{ fontSize: 10 }}>{d ? d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                        <TableCell><Chip label={cfg.label} size="small" sx={{ fontSize: 8, height: 16, bgcolor: cfg.bg, color: cfg.color }} /></TableCell>
                        <TableCell sx={{ fontSize: 10 }}>{ADMIN_CONTEXT[ctx]?.label ?? ctx ?? '—'}</TableCell>
                        <TableCell sx={{ fontSize: 10, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.notes ?? a.prn_reason ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Administration Dialog */}
      {adminDialog && (
        <Dialog open onClose={() => setAdminDialog(null)} maxWidth="xs" fullWidth>
          <DialogTitle id="dialog-title" sx={{ fontWeight: 700, fontSize: 14, pb: 0 }}>Record Administration</DialogTitle>
          <DialogContent sx={{ pt: '8px !important' }}>
            {adminMut.isError && (
              <Alert role="alert" severity="error" sx={{ mb: 1.5 }}>
                Failed to save administration: {(adminMut.error as Error)?.message ?? 'unknown error'}. The administration was NOT recorded. Do not give the next dose until this record persists — administering against an unrecorded dose risks double-dosing or leaving the AHPRA-required medication chart audit trail incomplete. Please retry.
              </Alert>
            )}
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{adminDialog.medName}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              {adminDialog.dose} | {adminDialog.route} | Scheduled: {adminDialog.time}
            </Typography>

            <TextField label="Actual Administration Time" type="time" size="small" fullWidth value={adminTime}
              onChange={e => setAdminTime(e.target.value)} sx={{ mb: 2 }}
              slotProps={{ inputLabel: { shrink: true } }} />

            <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>Status</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mb: 2 }}>
              {Object.entries(ADMIN_STATUS_CONFIG).filter(([k]) => k !== 'not-due').map(([key, cfg]) => (
                <Chip key={key} label={cfg.label} size="small" onClick={() => setAdminStatus(key)}
                  sx={{ cursor: 'pointer', fontWeight: 600, fontSize: 11,
                    bgcolor: adminStatus === key ? cfg.color : '#eee',
                    color: adminStatus === key ? '#fff' : '#555' }} />
              ))}
            </Box>

            <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>Administration Context</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
              {/* Only show staff-selectable options. Family/patient app options come from mobile app */}
              {[['supervised', 'Supervised'], ['self_administered', 'Self Administered'], ['inpatient', 'Inpatient'], ['community', 'Community']].map(([key, label]) => (
                <Chip key={key} label={label} size="small" onClick={() => setAdminContext(key)}
                  sx={{ cursor: 'pointer', fontSize: 10,
                    bgcolor: adminContext === key ? (ADMIN_CONTEXT[key]?.color ?? '#327C8D') : '#eee',
                    color: adminContext === key ? '#fff' : '#555' }} />
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontSize: 9 }}>
              Family Supervised and Patient Self-Report options are recorded via the patient mobile app.
            </Typography>

            {prnReason !== undefined && (
              <TextField label="PRN Reason (if applicable)" size="small" fullWidth value={prnReason}
                onChange={e => setPrnReason(e.target.value)} sx={{ mb: 1.5 }} />
            )}
            <TextField label="Notes" size="small" fullWidth multiline rows={2} value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAdminDialog(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
            <Button variant="contained" onClick={handleAdmin} disabled={adminMut.isPending}
              sx={{ bgcolor: ADMIN_STATUS_CONFIG[adminStatus]?.color ?? '#327C8D', textTransform: 'none' }}>
              {adminMut.isPending ? 'Saving...' : `Record as ${ADMIN_STATUS_CONFIG[adminStatus]?.label ?? 'Given'}`}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
