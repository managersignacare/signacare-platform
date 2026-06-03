// apps/web/src/features/medications/components/TaperDialog.tsx
//
// BUG-524-F — extracted from MedicationsTab.tsx (was L268-365) per the
// hybrid 2-tab split plan. Multi-step taper-schedule dialog used by
// CurrentMedsPanel for medications that require a tapered cessation
// (SSRI / SNRI / benzodiazepine / antipsychotic discontinuation
// syndrome prevention).

import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, IconButton, Paper, Step, StepLabel, Stepper, TextField, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { patientMedicationsKeys } from '../../patients/queryKeys';
import type { MedicationRow } from '../types';


interface TaperDialogProps { open: boolean; onClose: () => void; medication: MedicationRow | null; patientId: string }

interface ErrorWithMessage {
  message?: string;
}

function getErrorMessage(error: unknown): string {
  const maybe = error as ErrorWithMessage;
  return maybe.message ?? 'Unknown error';
}

export function TaperDialog({ open, onClose, medication, patientId }: TaperDialogProps) {
  const qc = useQueryClient();
  const [stages, setStages] = useState([{ dose: '', durationWeeks: 2 }]);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (medication) setStages([{ dose: medication.dose, durationWeeks: 2 }, { dose: '', durationWeeks: 2 }]);
  }, [medication]);

  const addStage = () => setStages(prev => [...prev, { dose: '', durationWeeks: 2 }]);
  const removeStage = (idx: number) => setStages(prev => prev.filter((_, i) => i !== idx));
  const updateStage = (idx: number, field: 'dose' | 'durationWeeks', value: string | number) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleSave = async () => {
    if (!medication) return;
    setSaving(true);
    try {
      await apiClient.patch(`medications/${medication.id}`, {
        status: 'tapering',
        taperSchedule: stages.filter(s => s.dose.trim()),
      });
      qc.invalidateQueries({ queryKey: patientMedicationsKeys.byPatient(patientId) });
      onClose();
    } catch (error: unknown) {
      alert(`Failed to save taper: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!medication) return null;
  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TrendingDownIcon sx={{ color: '#b8621a' }} />
          Taper: {medication.medicationName}
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Current dose: <strong>{medication.dose}</strong> — {medication.frequency}
        </Typography>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Tapering Stages</Typography>
        <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
          Define dose reduction stages. The medication stays in "Current" as "Tapering" until fully ceased.
        </Alert>

        {stages.map((stage, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
            <Chip label={`Stage ${idx + 1}`} size="small" sx={{ bgcolor: '#FFF3E0', color: '#E65100', fontWeight: 600, fontSize: 10, minWidth: 60 }} />
            <TextField label="Dose" size="small" value={stage.dose} onChange={e => updateStage(idx, 'dose', e.target.value)}
              placeholder={idx === 0 ? medication.dose : 'e.g. 5mg'} sx={{ flex: 1 }} />
            <TextField label="Weeks" size="small" type="number" value={stage.durationWeeks}
              onChange={e => updateStage(idx, 'durationWeeks', Number(e.target.value))}
              sx={{ width: 80 }} inputProps={{ min: 1 }} />
            {stages.length > 1 && (
              <IconButton size="small" aria-label={`Remove taper stage ${idx + 1}`} onClick={() => removeStage(idx)} color="error"><StopCircleIcon sx={{ fontSize: 16 }} /></IconButton>
            )}
          </Paper>
        ))}

        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={addStage} sx={{ fontSize: 12, color: '#327C8D' }}>Add Stage</Button>
        </Box>

        <Paper sx={{ mt: 2, p: 1.5, bgcolor: '#FBF8F5' }}>
          <Typography variant="caption" fontWeight={600}>Timeline Preview</Typography>
          <Stepper activeStep={0} alternativeLabel sx={{ mt: 1 }}>
            {stages.filter(s => s.dose.trim()).map((s, i) => (
              <Step key={i}><StepLabel><Typography variant="caption" sx={{ fontSize: 10 }}>{s.dose} ({s.durationWeeks}w)</Typography></StepLabel></Step>
            ))}
            <Step><StepLabel><Typography variant="caption" sx={{ fontSize: 10, color: '#D32F2F', fontWeight: 600 }}>Cease</Typography></StepLabel></Step>
          </Stepper>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, textAlign: 'center' }}>
            Total: {stages.reduce((a, s) => a + s.durationWeeks, 0)} weeks
          </Typography>
        </Paper>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !stages.some(s => s.dose.trim())}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Start Taper'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

