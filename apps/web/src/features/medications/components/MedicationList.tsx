import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { Add, Stop } from '@mui/icons-material';
import { useMedications, useCeaseMedication } from '../hooks/useMedications';
import { medicationsPatientScopeKeys } from '../queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import MedicationForm from './MedicationForm';
import { MEDICATION_STATUS_COLOR, MEDICATION_STATUS_LABEL } from '../types/medicationTypes';
import type { MedicationResponse } from '@signacare/shared';

interface Props {
  patientId: string;
  episodeId?: string;
}

export default function MedicationList({ patientId, episodeId }: Props) {
  const { data: medications = [], isLoading } = useMedications(patientId, episodeId);
  const ceaseM = useCeaseMedication(patientId);
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [ceaseOpen, setCeaseOpen] = useState<MedicationResponse | null>(null);
  const [ceaseReason, setCeaseReason] = useState('');
  const [ceaseDate, setCeaseDate] = useState(new Date().toISOString().slice(0, 10));

  const active = medications.filter((m) => ['active', 'tapering', 'on_hold', 'suspended'].includes(m.status));

  const handleCease = () => {
    if (!ceaseOpen) return;
    // BUG-371b — REQUIRED expectedLockVersion per CLAUDE.md §1.6.
    // Read from the cached row's lockVersion. If the row was edited
    // concurrently after this dialog opened, the helper returns 409.
    ceaseM.mutate(
      {
        id: ceaseOpen.id,
        dto: {
          endDate: ceaseDate,
          reasonForCessation: ceaseReason,
          expectedLockVersion: ceaseOpen.lockVersion,
        },
      },
      {
        onSuccess: () => { setCeaseOpen(null); setCeaseReason(''); },
        // BUG-371b absorb-1 (L4 Rule 8 BLOCK): surface 409 conflicts
        // explicitly. Pre-absorb only `onSuccess` was wired — on a
        // concurrent-edit 409 the dialog stayed open with no feedback;
        // clinician believed nothing happened and re-clicked. Now: 409
        // alerts the user AND invalidates the patient-scope query so
        // the dialog's `ceaseOpen.lockVersion` refreshes when the user
        // closes + reopens the dialog; non-409 errors surface via
        // standard alert().
        onError: (err) => {
          const errCode = (err as { code?: string } | null)?.code;
          if (errCode === 'OPTIMISTIC_LOCK_CONFLICT') {
            alert('Another clinician edited this medication while you were ceasing it. Please refresh and review the current state before retrying.');
            // Invalidate cached medications so the next dialog open
            // reads the fresh lockVersion (per L4 absorb-2 — comment
            // claimed this; behaviour now matches).
            medicationsPatientScopeKeys(patientId).forEach((key) =>
              qc.invalidateQueries({ queryKey: key }),
            );
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            alert(`Failed to cease medication: ${msg}`);
          }
        },
      },
    );
  };

  if (isLoading) return <Typography sx={{ p: 2 }}>Loading medications…</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" fontWeight={600}>Current Medications</Typography>
        <Button
          size="small"
          variant="contained"
          startIcon={<Add />}
          sx={{ bgcolor: '#327C8D' }}
          onClick={() => setAddOpen(true)}
        >
          Add Medication
        </Button>
      </Box>

      {active.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>No active medications recorded.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F5F5F5' }}>
              {['Drug', 'Dose / Route / Freq', 'Indication', 'Start', 'Status', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 600 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {active.map((m) => (
              <TableRow key={m.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{m.genericName ?? m.drugLabel}</Typography>
                  {m.brandName && <Typography variant="caption" color="text.secondary">{m.brandName}</Typography>}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{m.dose} {m.doseUnit ?? ''}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {m.route} · {m.frequency}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{m.indication ?? '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{m.startDate ?? '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={MEDICATION_STATUS_LABEL[m.status as keyof typeof MEDICATION_STATUS_LABEL] ?? m.status}
                    sx={{
                      bgcolor: MEDICATION_STATUS_COLOR[m.status as keyof typeof MEDICATION_STATUS_COLOR] ?? '#9E9E9E',
                      color: '#fff',
                      fontSize: 11,
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip title="Cease medication">
                    <IconButton size="small" color="error" onClick={() => setCeaseOpen(m)}>
                      <Stop fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Medication Modal */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title">Add Medication</DialogTitle>
        <DialogContent>
          <MedicationForm
            patientId={patientId}
            episodeId={episodeId}
            onSuccess={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Cease Medication Modal */}
      <Dialog aria-labelledby="dialog-title" open={!!ceaseOpen} onClose={() => setCeaseOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Cease Medication</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography sx={{ mb: 2 }}>
            Ceasing: <strong>{ceaseOpen?.genericName ?? ceaseOpen?.drugLabel}</strong>
          </Typography>
          <TextField
            label="End Date"
            type="date"
            fullWidth
            value={ceaseDate}
            onChange={(e) => setCeaseDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Reason for Cessation"
            fullWidth
            required
            multiline
            rows={3}
            value={ceaseReason}
            onChange={(e) => setCeaseReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCeaseOpen(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!ceaseReason.trim() || ceaseM.isPending}
            onClick={handleCease}
          >
            Cease Medication
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
