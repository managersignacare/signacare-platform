// apps/web/src/features/medications/components/LaiPanel.tsx
//
// BUG-524-D — extracted from MedicationsTab.tsx (was L701-1101) per
// the hybrid 2-tab split plan. Long-acting injectable (LAI) prescribing
// + revalidation surface — clinical-safety RELEVANT (LAI gap >90 days
// requires revalidation per local mental-health protocols; missing a
// scheduled depot dose risks decompensation in psychotic disorders).
//
// Imported by ActiveMedicationsTab as a sub-section inside the Active
// Medications tab.

import NoteAddIcon from '@mui/icons-material/NoteAdd';
import {
    Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, FormControl, FormControlLabel, Grid, InputLabel, MenuItem, Paper, Select, Switch,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { tryAsync, isErr } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { patientLaiKeys } from '../../patients/queryKeys';
import { AddNoteDialog } from '../../patients/components/notes/AddNoteDialog';
import { usePrintPrescription } from '../hooks/usePrescriber';
import { getIndicationDisplay } from './PrescribeDialog';
import type { MedicationRow } from '../types';


// Validation thresholds (days)
const LAI_GAP_THRESHOLD_DAYS = 90; // >3 months gap → revalidation required

interface LaiPanelProps { laiMeds: MedicationRow[]; patientId: string }
interface LaiScheduleListRow {
  id: string;
  drugName?: string | null;
  drug_name?: string | null;
}
interface LaiValidationRow {
  id: string;
  laiScheduleId?: string;
  lai_schedule_id?: string;
  validationDate?: string;
  validation_date?: string;
  validUntil?: string;
  valid_until?: string;
  validationType?: string;
  validation_type?: string;
  outcome: 'approved' | 'modified' | 'ceased';
  consentConfirmed?: boolean;
  consent_confirmed?: boolean;
  bloodTestsReviewed?: boolean;
  blood_tests_reviewed?: boolean;
  aimsReviewed?: boolean;
  aims_reviewed?: boolean;
  clinicalRationale?: string | null;
  clinical_rationale?: string | null;
  sideEffectsReviewed?: string | null;
  side_effects_reviewed?: string | null;
  notes?: string | null;
}
interface LaiValidationCreatePayload {
  laiScheduleId: string;
  patientId: string;
  validationDate: string;
  validationType: 'initial' | 'routine' | 'gap_restart';
  outcome: 'approved' | 'modified' | 'ceased';
  clinicalRationale?: string;
  sideEffectsReviewed?: string;
  consentConfirmed: boolean;
  bloodTestsReviewed: boolean;
  aimsReviewed: boolean;
  notes?: string;
}

function toList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const maybe = value as { data?: unknown };
    if (Array.isArray(maybe.data)) return maybe.data as T[];
  }
  return [];
}

function formatAusDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-AU');
}

export function LaiPanel({ laiMeds, patientId }: LaiPanelProps) {
  const [noteOpen, setNoteOpen] = React.useState(false);
  const qc = useQueryClient();
  const { isPrescriber } = usePrintPrescription(patientId);
  const [revalOpen, setRevalOpen] = React.useState(false);
  const [revalScheduleId, setRevalScheduleId] = React.useState('');
  const [revalType, setRevalType] = React.useState<'initial' | 'routine' | 'gap_restart'>('routine');
  const [revalOutcome, setRevalOutcome] = React.useState<'approved' | 'modified' | 'ceased'>('approved');
  const [revalRationale, setRevalRationale] = React.useState('');
  const [revalSideEffects, setRevalSideEffects] = React.useState('');
  const [revalConsent, setRevalConsent] = React.useState(false);
  const [revalBlood, setRevalBlood] = React.useState(false);
  const [revalAims, setRevalAims] = React.useState(false);
  const [revalNotes, setRevalNotes] = React.useState('');
  const todayIso = new Date().toISOString().split('T')[0];

  // BUG-610 closes the silent-fallback class on this clinical-safety
  // surface (sibling of BUG-441/445/548/608/611). The pre-fix
  // validations queryFn coerced a wrapped `{data:[...]}` response
  // into `[]` (accepted only raw arrays), and the schedules queryFn
  // coerced any non-array shape into `[]`. Both fallbacks fired
  // silently, with no `isError` surfacing — a clinician on a depot
  // patient after a network blip would see "No validation on record.
  // Initial validation required." for a patient who actually has
  // valid documentation, forcing redundant revalidation; or worse,
  // the revalidation prompt could be missed entirely (schedules
  // missing → no card-level validation status). Per BUG-530 SSoT
  // (CLAUDE.md §16.2), use tryAsync to surface failure explicitly via
  // React-Query's isError state and render the failure banner below.
  // Both queryFns are converted atomically (same file, same safety
  // surface) per `feedback_no_silent_out_of_scope.md`.
  const { data: laiSchedules = [], isError: schedulesError } = useQuery({
    queryKey: patientLaiKeys.schedules(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<unknown>(`lai/patients/${patientId}/lai-schedules`));
      if (isErr(r)) throw r.error;
      return toList<LaiScheduleListRow>(r.value);
    },
    enabled: !!patientId,
  });

  const { data: allValidations = [], isError: validationsError } = useQuery({
    queryKey: patientLaiKeys.validations(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<unknown>(`lai/patients/${patientId}/validations`));
      if (isErr(r)) throw r.error;
      // BUG-610: accept BOTH raw array AND wrapped {data:[...]} shapes;
      // pre-fix accepted only raw arrays, silently rejecting valid
      // wrapped responses → "No validation on record" → forced redundant
      // revalidation. Mirrors line 50 (schedules) coalescing.
      return toList<LaiValidationRow>(r.value);
    },
    enabled: !!patientId,
  });

  // BUG-614 — LAI revalidation save mutation now uses tryAsync per
  // BUG-530 SSoT (CLAUDE.md §16.2). Pre-fix the bare `apiClient.post`
  // had no onError surfacing — on rejection the button transitioned
  // back from "Saving..." with no error feedback. Clinician could
  // close the dialog believing the revalidation persisted when it did
  // not → next depot dose administered against an unsaved revalidation
  // = decompensation risk. Post-fix: tryAsync rethrows on error so
  // React-Query exposes `revalMut.isError` + `.error`; the dialog
  // renders an explicit `<Alert role="alert" severity="error">` and
  // STAYS OPEN on error (the dialog already only closes onSuccess, so
  // the retry workflow is preserved by design).
  const revalMut = useMutation({
    mutationFn: async (data: LaiValidationCreatePayload) => {
      const r = await tryAsync(() => apiClient.post('lai/validations', data));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientLaiKeys.validations(patientId) });
      qc.invalidateQueries({ queryKey: patientLaiKeys.schedules(patientId) });
      setRevalOpen(false);
      setRevalRationale(''); setRevalSideEffects(''); setRevalConsent(false);
      setRevalBlood(false); setRevalAims(false); setRevalNotes('');
    },
  });

  // Compute validation status per LAI schedule
  const getValidationStatus = (scheduleId: string, lastAdminStr: string | null) => {
    const validations = allValidations.filter((v) => (v.laiScheduleId ?? v.lai_schedule_id) === scheduleId);
    const latest = validations[0]; // already sorted desc
    const now = new Date();

    // Check gap: if lastAdmin > 90 days ago
    const lastAdmin = lastAdminStr ? new Date(lastAdminStr) : null;
    const daysSinceAdmin = lastAdmin ? Math.floor((now.getTime() - lastAdmin.getTime()) / 86400000) : null;
    const hasGap = daysSinceAdmin !== null && daysSinceAdmin > LAI_GAP_THRESHOLD_DAYS;

    // Check routine validity
    const validUntil = latest ? (latest.validUntil ?? latest.valid_until) : null;
    const isExpired = !validUntil || validUntil < todayIso;
    const latestValidationDate = latest ? (latest.validationDate ?? latest.validation_date ?? null) : null;

    // Determine required revalidation type
    let needsRevalidation = false;
    let reason = '';
    let severity: 'error' | 'warning' | 'success' = 'success';

    if (hasGap && (!validUntil || validUntil < todayIso)) {
      needsRevalidation = true;
      reason = `Administration gap: ${daysSinceAdmin} days since last dose (>90 days). Revalidation required before next dose.`;
      severity = 'error';
    } else if (isExpired) {
      needsRevalidation = true;
      const daysSinceValidation = latestValidationDate
        ? Math.floor((now.getTime() - new Date(latestValidationDate).getTime()) / 86400000)
        : null;
      const validUntilLabel = validUntil ? formatAusDate(validUntil) : 'unknown date';
      reason = latest
        ? `Routine revalidation overdue (last validated ${daysSinceValidation ?? 'unknown'} days ago, valid until ${validUntilLabel})`
        : 'No validation on record. Initial validation required.';
      severity = 'error';
    } else if (validUntil) {
      // Valid — check if nearing expiry (within 30 days)
      const daysUntilExpiry = Math.floor((new Date(validUntil).getTime() - now.getTime()) / 86400000);
      if (daysUntilExpiry <= 30) {
        reason = `Valid until ${new Date(validUntil).toLocaleDateString('en-AU')} (${daysUntilExpiry} days remaining)`;
        severity = 'warning';
      } else {
        reason = `Valid until ${new Date(validUntil).toLocaleDateString('en-AU')}`;
        severity = 'success';
      }
    } else {
      reason = 'Validation date unavailable';
      severity = 'warning';
    }

    return { needsRevalidation, reason, severity, latest, hasGap, daysSinceAdmin, validUntil };
  };

  const openRevalidation = (scheduleId: string, type: 'initial' | 'routine' | 'gap_restart') => {
    setRevalScheduleId(scheduleId);
    setRevalType(type);
    setRevalOutcome('approved');
    setRevalOpen(true);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600}>LAI Schedule & Administration</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="contained" startIcon={<NoteAddIcon />} onClick={() => setNoteOpen(true)}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, fontSize: 12, textTransform: 'none' }}>Add Note</Button>
        </Box>
      </Box>
      <AddNoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} patientId={patientId} noteType="lai" />

      {(schedulesError || validationsError) && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to load LAI {schedulesError && validationsError ? 'schedules and validations' : schedulesError ? 'schedules' : 'validations'}. The revalidation status display may be stale or empty — refresh to retry. Do not approve a depot dose based on this view while the error persists.
        </Alert>
      )}

      {/* Validation rules info */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: '#F5F9FA', borderLeft: '4px solid #1565C0' }}>
        <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>LAI Prescription Revalidation Rules</Typography>
        <Typography variant="caption" sx={{ fontSize: 10, display: 'block' }}>
          1. LAI prescription must be revalidated every <strong>6 months</strong> for ongoing administration.
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, display: 'block' }}>
          2. If there is a gap of more than <strong>3 months (90 days)</strong> between administrations, revalidation is required before the next dose.
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, display: 'block' }}>
          3. Revalidation includes review of clinical rationale, side effects, consent, blood tests, and AIMS assessment.
        </Typography>
      </Paper>

      {!laiMeds.length ? (
        <Alert severity="info">No LAI medications found. Prescribe an LAI via the Current Medications tab.</Alert>
      ) : (
        <Grid container spacing={2}>
          {laiMeds.map(m => {
            // Find matching LAI schedule
            const schedule = laiSchedules.find((s) =>
              (s.drugName ?? s.drug_name ?? '').toLowerCase().includes(m.medicationName?.toLowerCase()?.split(' ')[0] ?? '') ||
              (s.drugName ?? s.drug_name ?? '') === m.medicationName
            );
            const scheduleId = schedule?.id;
            const validStatus = scheduleId ? getValidationStatus(scheduleId, m.laiLastAdmin) : null;

            return (
              <Grid key={m.id} size={{ xs: 12, md: 6 }}>
                <Card variant="outlined" sx={{ borderColor: m.status === 'active' ? '#1565C0' : 'divider' }}>
                  <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="subtitle2" fontWeight={700}>{m.medicationName}</Typography>
                      <Chip label={m.status} size="small" color={m.status === 'active' ? 'success' : 'default'} sx={{ fontSize: 10 }} />
                    </Box>
                    {m.genericName && <Typography variant="caption" color="text.secondary" display="block">Generic: {m.genericName}</Typography>}

                    {/* Medication Chart Header */}
                    <Paper variant="outlined" sx={{ mt: 1, p: 1.5, bgcolor: '#E3F2FD', borderColor: '#1565C0' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" fontWeight={700} color="#1565C0">Medication Chart</Typography>
                        <Chip label={m.status === 'active' ? 'Active' : m.status} size="small"
                          color={m.status === 'active' ? 'success' : 'default'} sx={{ fontSize: 9, height: 18 }} />
                      </Box>
                      <Typography variant="body1" fontWeight={700} sx={{ mt: 0.5 }}>{m.dose}</Typography>
                      <Typography variant="body2" color="text.secondary">{m.frequency} — {m.route}</Typography>
                      {getIndicationDisplay(m) && <Typography variant="body2" sx={{ mt: 0.5, color: '#1565C0', fontStyle: 'italic' }}>Indication: {getIndicationDisplay(m)}</Typography>}
                      {m.pbsCode && <Typography variant="caption" color="text.secondary" display="block">PBS: {m.pbsCode}</Typography>}
                      {m.prescriber && <Typography variant="caption" color="text.secondary" display="block">Prescriber: {m.prescriber}</Typography>}
                      {m.prescribedAt && <Typography variant="caption" color="text.secondary" display="block">Prescribed: {new Date(m.prescribedAt).toLocaleDateString('en-AU')}</Typography>}
                    </Paper>

                    <Divider sx={{ my: 1 }} />
                    <Grid container spacing={1}>
                      <Grid size={{ xs: 4 }}>
                        <Typography variant="caption" color="text.secondary" display="block">Last Admin</Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {m.laiLastAdmin ? new Date(m.laiLastAdmin).toLocaleDateString('en-AU') : '—'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 4 }}>
                        <Typography variant="caption" color="text.secondary" display="block">Next Due</Typography>
                        <Typography variant="body2" fontWeight={600} sx={{ color: m.laiNextDue && new Date(m.laiNextDue) < new Date() ? '#D32F2F' : '#1565C0' }}>
                          {m.laiNextDue ? new Date(m.laiNextDue).toLocaleDateString('en-AU') : '—'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 4 }}>
                        <Typography variant="caption" color="text.secondary" display="block">Frequency</Typography>
                        <Typography variant="body2" fontWeight={500}>{m.laiFrequency || m.frequency}</Typography>
                      </Grid>
                    </Grid>
                    {m.prescriber && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Prescriber: {m.prescriber}</Typography>
                    )}

                    {/* ── Validation Status Banner ── */}
                    {validStatus && (
                      <Alert severity={validStatus.severity} sx={{ mt: 1.5, fontSize: 11, py: 0.5 }}
                        action={validStatus.needsRevalidation && isPrescriber && scheduleId ? (
                          <Button size="small" variant="contained" onClick={() => openRevalidation(scheduleId, validStatus.hasGap ? 'gap_restart' : validStatus.latest ? 'routine' : 'initial')}
                            sx={{ fontSize: 10, textTransform: 'none', bgcolor: validStatus.severity === 'error' ? '#C62828' : '#b8621a', '&:hover': { bgcolor: validStatus.severity === 'error' ? '#B71C1C' : '#d6741f' } }}>
                            Revalidate Now
                          </Button>
                        ) : undefined}>
                        {validStatus.reason}
                      </Alert>
                    )}

                    {/* ── Last Validation Details ── */}
                    {validStatus?.latest && (
                      <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, bgcolor: '#FAFAFA' }}>
                        <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 0.5 }}>Last Validation</Typography>
                        <Grid container spacing={1}>
                          <Grid size={{ xs: 4 }}>
                            <Typography variant="caption" color="text.secondary" display="block">Date</Typography>
                            <Typography variant="caption" fontWeight={600}>
                              {formatAusDate(validStatus.latest.validationDate ?? validStatus.latest.validation_date)}
                            </Typography>
                          </Grid>
                          <Grid size={{ xs: 4 }}>
                            <Typography variant="caption" color="text.secondary" display="block">Type</Typography>
                            <Chip label={(validStatus.latest.validationType ?? validStatus.latest.validation_type ?? '').replace('_', ' ')} size="small"
                              sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                          </Grid>
                          <Grid size={{ xs: 4 }}>
                            <Typography variant="caption" color="text.secondary" display="block">Outcome</Typography>
                            <Chip label={validStatus.latest.outcome} size="small"
                              color={validStatus.latest.outcome === 'approved' ? 'success' : validStatus.latest.outcome === 'ceased' ? 'error' : 'warning'}
                              sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                          </Grid>
                        </Grid>
                        <Grid container spacing={1} sx={{ mt: 0.5 }}>
                          <Grid size={{ xs: 4 }}>
                            <Typography variant="caption" color="text.secondary" display="block">Consent</Typography>
                            <Typography variant="caption" fontWeight={600} color={(validStatus.latest.consentConfirmed ?? validStatus.latest.consent_confirmed) ? '#2E7D32' : '#9E9E9E'}>
                              {(validStatus.latest.consentConfirmed ?? validStatus.latest.consent_confirmed) ? 'Confirmed' : 'Not recorded'}
                            </Typography>
                          </Grid>
                          <Grid size={{ xs: 4 }}>
                            <Typography variant="caption" color="text.secondary" display="block">Bloods Reviewed</Typography>
                            <Typography variant="caption" fontWeight={600} color={(validStatus.latest.bloodTestsReviewed ?? validStatus.latest.blood_tests_reviewed) ? '#2E7D32' : '#9E9E9E'}>
                              {(validStatus.latest.bloodTestsReviewed ?? validStatus.latest.blood_tests_reviewed) ? 'Yes' : 'No'}
                            </Typography>
                          </Grid>
                          <Grid size={{ xs: 4 }}>
                            <Typography variant="caption" color="text.secondary" display="block">AIMS Reviewed</Typography>
                            <Typography variant="caption" fontWeight={600} color={(validStatus.latest.aimsReviewed ?? validStatus.latest.aims_reviewed) ? '#2E7D32' : '#9E9E9E'}>
                              {(validStatus.latest.aimsReviewed ?? validStatus.latest.aims_reviewed) ? 'Yes' : 'No'}
                            </Typography>
                          </Grid>
                        </Grid>
                        {(validStatus.latest.clinicalRationale ?? validStatus.latest.clinical_rationale) && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            Rationale: {validStatus.latest.clinicalRationale ?? validStatus.latest.clinical_rationale}
                          </Typography>
                        )}
                        {(validStatus.latest.notes) && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Notes: {validStatus.latest.notes}
                          </Typography>
                        )}
                      </Paper>
                    )}

                    {/* No validation yet */}
                    {!validStatus?.latest && scheduleId && (
                      <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, bgcolor: '#FFF3E0' }}>
                        <Typography variant="caption" fontWeight={700} color="#E65100">No validation recorded</Typography>
                        <Typography variant="caption" display="block" sx={{ fontSize: 10 }}>
                          An initial validation is required for ongoing LAI administration. {isPrescriber ? 'Click Revalidate Now above.' : 'Ask the prescriber to validate.'}
                        </Typography>
                      </Paper>
                    )}

                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Validation History Table (all LAIs for this patient) */}
      {allValidations.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Validation History</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#F5F5F5' }}>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Outcome</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Valid Until</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Consent</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Bloods</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>AIMS</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {allValidations.map((v) => {
                  const validationDate = v.validationDate ?? v.validation_date ?? null;
                  const validUntil = v.validUntil ?? v.valid_until ?? null;
                  const isExpired = Boolean(validUntil && validUntil < todayIso);
                  return (
                  <TableRow key={v.id}>
                    <TableCell sx={{ fontSize: 11 }}>{formatAusDate(validationDate)}</TableCell>
                    <TableCell><Chip label={(v.validationType ?? v.validation_type ?? '').replace('_', ' ')} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} /></TableCell>
                    <TableCell><Chip label={v.outcome} size="small" color={v.outcome === 'approved' ? 'success' : v.outcome === 'ceased' ? 'error' : 'warning'} sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} /></TableCell>
                    <TableCell sx={{ fontSize: 11, color: isExpired ? '#C62828' : 'inherit' }}>
                      {formatAusDate(validUntil)}
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{(v.consentConfirmed ?? v.consent_confirmed) ? 'Yes' : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{(v.bloodTestsReviewed ?? v.blood_tests_reviewed) ? 'Yes' : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{(v.aimsReviewed ?? v.aims_reviewed) ? 'Yes' : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.notes ?? ''}</TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* ═══════════ REVALIDATION DIALOG ═══════════ */}
      <Dialog open={revalOpen} onClose={() => setRevalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#1565C0' }}>LAI Prescription Revalidation</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          {revalMut.isError && (
            <Alert role="alert" severity="error" sx={{ mb: 2 }}>
              Failed to save LAI revalidation: {(revalMut.error as Error)?.message ?? 'unknown error'}. The revalidation was NOT saved. Do not approve the next depot dose until this revalidation persists — administering depot against an unsaved revalidation risks decompensation. Please retry.
            </Alert>
          )}
          <Alert severity={revalType === 'gap_restart' ? 'error' : 'info'} sx={{ mb: 2, fontSize: 11 }}>
            {revalType === 'gap_restart'
              ? 'Administration gap detected (>90 days). Clinical review required before resuming LAI.'
              : revalType === 'initial'
              ? 'Initial validation required for ongoing LAI administration.'
              : 'Routine 6-monthly revalidation for ongoing LAI administration.'}
          </Alert>

          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Outcome</InputLabel>
                <Select value={revalOutcome} onChange={e => setRevalOutcome(e.target.value as 'approved' | 'modified' | 'ceased')} label="Outcome">
                  <MenuItem value="approved">Approved — Continue LAI</MenuItem>
                  <MenuItem value="modified">Modified — Continue with changes</MenuItem>
                  <MenuItem value="ceased">Ceased — Stop LAI</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Type: <strong>{revalType.replace('_', ' ')}</strong> | Valid for 6 months from today
              </Typography>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Clinical Rationale for Continuation" size="small" fullWidth multiline rows={2}
                value={revalRationale} onChange={e => setRevalRationale(e.target.value)}
                placeholder="e.g. Patient stable on current regime, good community functioning, compliance maintained" />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Side Effects Reviewed" size="small" fullWidth multiline rows={2}
                value={revalSideEffects} onChange={e => setRevalSideEffects(e.target.value)}
                placeholder="e.g. Weight gain monitored, metabolic panel within normal limits, no EPS noted" />
            </Grid>

            {/* Clinical Review Checklist */}
            <Grid size={{ xs: 12 }}>
              <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 1 }}>Clinical Review Checklist</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <FormControlLabel
                  control={<Switch size="small" checked={revalConsent} onChange={(_, v) => setRevalConsent(v)} />}
                  label={<Typography variant="body2" sx={{ fontSize: 12 }}>Patient/carer consent confirmed for ongoing treatment</Typography>} />
                <FormControlLabel
                  control={<Switch size="small" checked={revalBlood} onChange={(_, v) => setRevalBlood(v)} />}
                  label={<Typography variant="body2" sx={{ fontSize: 12 }}>Blood tests reviewed (FBC, metabolic panel, prolactin)</Typography>} />
                <FormControlLabel
                  control={<Switch size="small" checked={revalAims} onChange={(_, v) => setRevalAims(v)} />}
                  label={<Typography variant="body2" sx={{ fontSize: 12 }}>AIMS assessment reviewed (tardive dyskinesia screening)</Typography>} />
              </Box>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField label="Additional Notes" size="small" fullWidth multiline rows={2}
                value={revalNotes} onChange={e => setRevalNotes(e.target.value)} />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRevalOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={() => revalMut.mutate({
            laiScheduleId: revalScheduleId,
            patientId,
            validationDate: new Date().toISOString().split('T')[0],
            validationType: revalType,
            outcome: revalOutcome,
            clinicalRationale: revalRationale || undefined,
            sideEffectsReviewed: revalSideEffects || undefined,
            consentConfirmed: revalConsent,
            bloodTestsReviewed: revalBlood,
            aimsReviewed: revalAims,
            notes: revalNotes || undefined,
          })} disabled={revalMut.isPending}
            sx={{ bgcolor: '#1565C0', '&:hover': { bgcolor: '#0D47A1' }, textTransform: 'none' }}>
            {revalMut.isPending ? 'Saving...' : revalOutcome === 'ceased' ? 'Cease LAI' : 'Confirm Revalidation'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
