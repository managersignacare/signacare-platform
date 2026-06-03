// apps/web/src/features/medications/components/CurrentMedsPanel.tsx
//
// BUG-524-F — extracted from MedicationsTab.tsx (was L118-266) per the
// hybrid 2-tab split plan. Current active medications list with
// per-medication actions: cease (with reason), taper (multi-step
// schedule), represcribe, print, and "add medication" (opens
// PrescribeDialog from this surface gated by the parent
// AllergyAckGate). Imported by ActiveMedicationsTab as the Current
// sub-section.

import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Cancel';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockIcon from '@mui/icons-material/Lock';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import SendIcon from '@mui/icons-material/Send';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import {
    Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
    Tooltip, Typography
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { ListExportBar } from '../../../shared/components/ui/ListExportBar';
import { patientMedicationsKeys } from '../../patients/queryKeys';
import { PrescribeDialog, getIndicationDisplay } from './PrescribeDialog';
import { TaperDialog } from './TaperDialog';
import { usePrintPrescription } from '../hooks/usePrescriber';
import { usePrescriptions, useCancelPrescription } from '../hooks/usePrescriptions';
import { medicationsPatientScopeKeys } from '../queryKeys';
import { MfaChallengeDialog } from '../../../shared/components/ui/MfaChallengeDialog';
import { getErxAwareErrorMessage } from '../services/erxErrorMessage';
import type { MedicationRow } from '../types';


interface CurrentMedsPanelProps { rows: MedicationRow[]; patientId: string }

export function CurrentMedsPanel({ rows, patientId }: CurrentMedsPanelProps) {
  const qc = useQueryClient();
  const { isPrescriber, printPrescription } = usePrintPrescription(patientId);
  const [prescribeOpen, setPrescribeOpen] = useState(false);
  const [ceaseId, setCeaseId] = useState<string | null>(null);
  const [taperId, setTaperId] = useState<string | null>(null);
  const [represcribeMed, setReprescribeMed] = useState<MedicationRow | null>(null);
  // BUG-553 — cancel-eScript dialog state. The dialog tracks the MEDICATION
  // id (not the prescription id) because the user clicks the icon on a
  // medication row; we resolve the active prescription via prescriptions[]
  // filter at submit time (no additional roundtrip — the list is already
  // loaded for the same patient).
  const [cancelMedId, setCancelMedId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [ceaseReason, setCeaseReason] = useState('');
  // BUG-P3 — step-up retry for S8 medications. The cease backend returns
  // 403 STEP_UP_REQUIRED when ceasing a Schedule 8 medication without
  // recent MFA / password challenge; we re-open MfaChallengeDialog and
  // retry on success.
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpRetry, setStepUpRetry] = useState<(() => Promise<void>) | null>(null);
  const ceaseMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`medications/${id}/cease`, {
      endDate: new Date().toISOString().slice(0, 10),
      reasonForCessation: ceaseReason.trim() || 'Ceased by clinician',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: patientMedicationsKeys.byPatient(patientId) }); setCeaseId(null); setCeaseReason(''); },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { code?: string; error?: string } }; message?: string };
      if (e?.response?.status === 403 && e?.response?.data?.code === 'STEP_UP_REQUIRED' && ceaseId) {
        const idForRetry = ceaseId;
        setStepUpRetry(() => () => new Promise<void>((resolve, reject) => {
          ceaseMut.mutate(idForRetry, {
            onSuccess: () => resolve(),
            onError: (e2) => reject(e2),
          });
        }));
        setStepUpOpen(true);
        return;
      }
      alert(`Failed to cease medication: ${e?.response?.data?.error ?? e?.message ?? 'Unknown'}`);
    },
  });

  const handleStepUpVerified = async () => {
    setStepUpOpen(false);
    if (!stepUpRetry) return;
    try {
      await stepUpRetry();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      alert(`Failed after verification: ${e?.response?.data?.error ?? e?.message ?? 'Unknown'}`);
    } finally {
      setStepUpRetry(null);
    }
  };

  const taperMed = rows.find(m => m.id === taperId);
  // BUG-553 — list active prescriptions for this patient so we can resolve
  // medication-id → prescription-id when cancelling an eScript. Active means
  // `status === 'active'` and `patient_medication_id` matches the medication
  // the user clicked.
  const { data: prescriptions = [] } = usePrescriptions(patientId);
  const cancelMut = useCancelPrescription(patientId);
  const cancelMed = rows.find(m => m.id === cancelMedId);
  const cancelTargetPrescription = cancelMedId
    ? prescriptions.find(
        (p) => p.patientMedicationId === cancelMedId && p.status === 'active',
      ) ?? null
    : null;

  const handleReissueToken = async (medicationId: string) => {
    try {
      await apiClient.post(`prescriptions/${medicationId}/deliver-token`, { sms: true });
      alert('Token reissued');
    } catch (error: unknown) {
      alert(getErxAwareErrorMessage(error, 'Reissue failed'));
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600} fontFamily="Albert Sans, sans-serif">Current Medications ({rows.length})</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <ListExportBar
            title="Current Medications"
            columns={['Medication', 'Dose', 'Frequency', 'Route', 'Status']}
            rows={rows.map(m => [m.medicationName, m.dose, m.frequency, m.route, m.status])}
            compact
          />
          {isPrescriber ? (
            <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setPrescribeOpen(true)} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Prescribe</Button>
          ) : (
            <Tooltip title="Prescriber number required. Contact admin to add your prescriber number in Staff Management.">
              <span><Button startIcon={<LockIcon />} variant="contained" size="small" disabled sx={{ bgcolor: '#ccc' }}>Prescribe</Button></span>
            </Tooltip>
          )}
        </Box>
      </Box>
      <PrescribeDialog open={prescribeOpen} onClose={() => setPrescribeOpen(false)} patientId={patientId} onPrintPrescription={printPrescription} />

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer role="region" aria-label="Data table">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                {['Medication', 'Dose', 'Frequency', 'Route', 'Prescribed', 'Flags', 'Status', 'Actions'].map(c => (
                  <TableCell key={c} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12 }}>{c}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows.length ? (
                <TableRow><TableCell colSpan={8} align="center" sx={{ py: 3 }}><Typography variant="body2" color="text.secondary">No active medications</Typography></TableCell></TableRow>
              ) : rows.map(m => (
                <TableRow key={m.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{m.medicationName}</Typography>
                    {m.genericName && <Typography variant="caption" color="text.secondary" display="block">{m.genericName}</Typography>}
                    {getIndicationDisplay(m) && <Typography variant="caption" sx={{ display: 'block', fontSize: 10, color: '#1565C0', fontStyle: 'italic' }}>For: {getIndicationDisplay(m)}</Typography>}
                  </TableCell>
                  <TableCell>{m.dose}</TableCell>
                  <TableCell>{m.frequency}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{m.route}</TableCell>
                  <TableCell>{m.prescribedAt ? new Date(m.prescribedAt).toLocaleDateString('en-AU') : new Date(m.createdAt).toLocaleDateString('en-AU')}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {m.isLai && <Chip label="LAI" size="small" sx={{ bgcolor: '#E3F2FD', color: '#1565C0', fontSize: 10, fontWeight: 700 }} />}
                      {m.isS8 && <Chip label="S8" size="small" sx={{ bgcolor: '#FFF3E0', color: '#E65100', fontSize: 10, fontWeight: 700 }} />}
                      {m.isClozapine && <Chip label="Cloz" size="small" sx={{ bgcolor: '#FCE4EC', color: '#C62828', fontSize: 10, fontWeight: 700 }} />}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip label={m.status} size="small" color={m.status === 'active' ? 'success' : m.status === 'tapering' ? 'warning' : 'default'} sx={{ textTransform: 'capitalize', fontSize: 11 }} />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {isPrescriber ? (
                        <>
                          <Tooltip title="Print Prescription"><IconButton size="small" aria-label="Print prescription" onClick={() => printPrescription(m)} sx={{ color: '#3D484B' }}><NoteAddIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                          <Tooltip title="Represcribe"><IconButton size="small" aria-label="Represcribe" onClick={() => setReprescribeMed(m)} sx={{ color: '#327C8D' }}><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                          <Tooltip title="Taper"><IconButton size="small" aria-label="Taper medication" onClick={() => setTaperId(m.id)} sx={{ color: '#b8621a' }}><TrendingDownIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                          <Tooltip title="Cease"><IconButton size="small" aria-label="Cease medication" onClick={() => setCeaseId(m.id)} sx={{ color: '#D32F2F' }}><StopCircleIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                          <Tooltip title="Cancel eScript"><IconButton size="small" aria-label="Cancel eScript" onClick={() => { setCancelMedId(m.id); setCancelReason(''); }} sx={{ color: '#9E9E9E' }}><CancelIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                          <Tooltip title="Reissue Token (SMS/Email)"><IconButton size="small" aria-label="Reissue eScript token" onClick={() => { void handleReissueToken(m.id); }} sx={{ color: '#327C8D' }}><SendIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                        </>
                      ) : (
                        <Tooltip title="Prescriber number required for these actions">
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <IconButton size="small" disabled aria-label="Represcribe (disabled)"><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton>
                            <IconButton size="small" disabled aria-label="Taper (disabled)"><TrendingDownIcon sx={{ fontSize: 16 }} /></IconButton>
                            <IconButton size="small" disabled aria-label="Cease (disabled)"><StopCircleIcon sx={{ fontSize: 16 }} /></IconButton>
                          </Box>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Cease Confirmation */}
      <Dialog aria-labelledby="dialog-title" open={!!ceaseId} onClose={() => setCeaseId(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, color: '#D32F2F' }}>Cease Medication</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Are you sure you want to cease <strong>{rows.find(m => m.id === ceaseId)?.medicationName}</strong>?</Typography>
          <TextField
            label="Reason for cessation"
            value={ceaseReason}
            onChange={(e) => setCeaseReason(e.target.value)}
            fullWidth
            multiline
            rows={2}
            placeholder="e.g., Side effects, clinical improvement, patient request"
            sx={{ mt: 2 }}
            size="small"
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            This will move it to Medication History immediately. The reason will be recorded for audit.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCeaseId(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => ceaseId && ceaseMut.mutate(ceaseId)}
            disabled={ceaseMut.isPending}>
            {ceaseMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Cease Medication'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* BUG-553 — Cancel eScript Dialog (with reason for AHPRA forensic chain) */}
      <Dialog
        aria-labelledby="cancel-erx-dialog-title"
        open={!!cancelMedId}
        onClose={() => setCancelMedId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="cancel-erx-dialog-title" sx={{ fontWeight: 700, color: '#D32F2F' }}>
          Cancel Electronic Prescription
        </DialogTitle>
        <DialogContent>
          {cancelTargetPrescription ? (
            <>
              <Typography variant="body2">
                Cancel the active electronic prescription for{' '}
                <strong>{cancelMed?.medicationName ?? 'this medication'}</strong>?
              </Typography>
              <TextField
                label="Reason for cancellation"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                fullWidth
                multiline
                rows={2}
                placeholder="e.g., Prescriber error, dose change, patient request"
                sx={{ mt: 2 }}
                size="small"
                inputProps={{ maxLength: 500 }}
                helperText={`${cancelReason.length} / 500 characters`}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                The reason will be recorded for the AHPRA / SafeScript audit chain. The system
                marks the prescription as cancelled in the patient record AND attempts to revoke
                the eScript token at the Dispensing Service Provider (NPDS / eRx REST). If the
                DSP-side revocation cannot complete, the cancellation succeeds locally and the
                pharmacy may still be able to dispense until a reconciliation cron catches up —
                the post-submit confirmation will tell you which outcome occurred.
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No active electronic prescription found for this medication. Use the Medication
              History view to inspect prior prescriptions.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelMedId(null)}>Close</Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              !cancelTargetPrescription ||
              cancelReason.trim().length === 0 ||
              cancelReason.length > 500 ||
              cancelMut.isPending
            }
            onClick={() => {
              if (!cancelTargetPrescription) return;
              cancelMut.mutate(
                {
                  id: cancelTargetPrescription.id,
                  expectedLockVersion: cancelTargetPrescription.lockVersion,
                  reasonForCancellation: cancelReason.trim(),
                },
                {
                  onSuccess: (data) => {
                    // BUG-553 cycle-2 (L4 CONCERN-1) — surface the DSP
                    // revocation outcome to the clinician. 'pending' means
                    // the eScript token is still LIVE at the pharmacy;
                    // clinician must follow up out-of-band (call pharmacy)
                    // until the reconciliation cron catches it.
                    if (data.dspRevocation === 'pending') {
                      alert(
                        'Prescription cancelled in patient record, but the eScript token revocation at the DSP could NOT complete. The pharmacy may still be able to dispense this script. Contact the patient and pharmacy directly. The system will retry DSP revocation in the background.',
                      );
                    } else if (data.dspRevocation === 'revoked') {
                      alert('Prescription cancelled and eScript token revoked at DSP. Pharmacy cannot dispense.');
                    }
                    setCancelMedId(null);
                    setCancelReason('');
                  },
                  onError: (err: unknown) => {
                    const e = err as { response?: { status?: number; data?: { error?: string; code?: string } }; message?: string };
                    // BUG-553 cycle-2 (L4 CONCERN-3) — on 409 OPTIMISTIC_LOCK_CONFLICT
                    // invalidate the prescriptions query so the next click
                    // reads a fresh lockVersion.
                    if (
                      e?.response?.status === 409 ||
                      e?.response?.data?.code === 'OPTIMISTIC_LOCK_CONFLICT'
                    ) {
                      medicationsPatientScopeKeys(patientId).forEach((key) =>
                        qc.invalidateQueries({ queryKey: key }),
                      );
                      alert(
                        'Another clinician edited this prescription. The list has been refreshed — please review and retry if you still want to cancel.',
                      );
                      setCancelMedId(null);
                      setCancelReason('');
                      return;
                    }
                    // BUG-P3 — on 403 STEP_UP_REQUIRED (S8 prescription cancel),
                    // open MfaChallengeDialog and retry on success.
                    if (
                      e?.response?.status === 403
                      && e?.response?.data?.code === 'STEP_UP_REQUIRED'
                      && cancelTargetPrescription
                    ) {
                      const target = cancelTargetPrescription;
                      const reason = cancelReason.trim();
                      setStepUpRetry(() => () => new Promise<void>((resolve, reject) => {
                        cancelMut.mutate(
                          {
                            id: target.id,
                            expectedLockVersion: target.lockVersion,
                            reasonForCancellation: reason,
                          },
                          { onSuccess: () => resolve(), onError: (e2) => reject(e2) },
                        );
                      }));
                      setStepUpOpen(true);
                      return;
                    }
                    alert(
                      `Failed to cancel prescription: ${getErxAwareErrorMessage(e, 'Unknown')}`,
                    );
                  },
                },
              );
            }}
          >
            {cancelMut.isPending ? (
              <CircularProgress role="progressbar" aria-label="Loading" size={16} />
            ) : (
              'Cancel Prescription'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Taper Dialog */}
      <TaperDialog open={!!taperId} onClose={() => setTaperId(null)} medication={taperMed ?? null} patientId={patientId} />

      {/* Represcribe Dialog */}
      <PrescribeDialog open={!!represcribeMed} onClose={() => setReprescribeMed(null)} patientId={patientId}
        defaultMedName={represcribeMed?.medicationName} defaultGeneric={represcribeMed?.genericName ?? undefined}
        defaultDose={represcribeMed?.dose} defaultRoute={represcribeMed?.route} defaultFrequency={represcribeMed?.frequency}
        defaultLai={represcribeMed?.isLai} defaultClozapine={represcribeMed?.isClozapine} defaultS8={represcribeMed?.isS8}
        onPrintPrescription={printPrescription} />

      {/* BUG-P3 — Step-up MFA dialog for S8 cease + cancel-eScript paths.
          Backend returns 403 STEP_UP_REQUIRED for S8 mutations without
          recent verify-mfa-challenge / verify-password-challenge. */}
      <MfaChallengeDialog
        open={stepUpOpen}
        onClose={() => { setStepUpOpen(false); setStepUpRetry(null); }}
        onVerified={handleStepUpVerified}
        title="Schedule 8 Re-authentication"
        description="Schedule 8 medication actions require fresh verification (PRES-7 / DH-4155 §3). Please confirm your identity to continue."
      />
    </Box>
  );
}
