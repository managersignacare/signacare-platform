// apps/web/src/features/medications/components/clozapine/ClozapineObservationsPanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L691-754; ~64 LOC)
// per the inner-tab structural split. NIMC observation protocol
// (TPR + lying/standing BP) + observations history table with
// postural-drop calculation + temp >38°C / pulse >100 bpm thresholds.
// The "Record Observation" button opens the parent's ObservationDialog
// via the `onAddObservation` callback.
//
// Imported by ClozapinePanel as the Observations sub-section.

import AddIcon from '@mui/icons-material/Add';
import { Alert, Box, Button, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ClozapineObservationResponse } from '@signacare/shared';

interface ClozapineObservationsPanelProps {
  observations: ClozapineObservationResponse[];
  regId: string | undefined;
  onAddObservation: () => void;
}
export function ClozapineObservationsPanel({ observations, regId, onAddObservation }: ClozapineObservationsPanelProps) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>Observation Protocol</Typography>
        {regId && <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onAddObservation}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265F6B' }, fontSize: 12, textTransform: 'none' }}>Record Observation</Button>}
      </Box>

      {/* Protocol reference */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: '#F5F9FA' }}>
        <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>Observation Protocol (NIMC)</Typography>
        <Typography variant="caption" sx={{ fontSize: 10, display: 'block' }}>
          <strong>First ever dose:</strong> Baseline temp, pulse, respiration (TPR), lying and standing BP. Repeat observations: every ½ hour for 2 hours, then every hour for 4 hours.
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, display: 'block' }}>
          <strong>Subsequent doses:</strong> Record at least twice daily — TPR and lying/standing BP ½ hour after dose. Continue for 28 days.
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, display: 'block', color: '#C62828', fontWeight: 600 }}>
          Patients must be kept under close supervision and vitals monitored for 6 hours following the first dose. Temperature &gt; 38°C: investigate for infection, neutropaenia, or NMS.
        </Typography>
      </Paper>

      {observations.length === 0 ? <Alert severity="info" sx={{ fontSize: 11 }}>No observations recorded yet.</Alert> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F5F5F5' }}>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Date/Time</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Temp °C</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Pulse</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>RR</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>BP Lying</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>BP Standing</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Postural Drop</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {observations.map((o: ClozapineObservationResponse) => {
                const sysL = o.bpSystolicLying;
                const sysS = o.bpSystolicStanding;
                const diaL = o.bpDiastolicLying;
                const diaS = o.bpDiastolicStanding;
                const posturalDrop = sysL != null && sysS != null ? sysL - sysS : null;
                const isAbnormal = o.outsideNormal;
                return (
                  <TableRow key={o.id} sx={{ bgcolor: isAbnormal ? '#FFEBEE' : 'inherit' }}>
                    <TableCell sx={{ fontSize: 10 }}>{o.observationDate ? new Date(o.observationDate).toLocaleDateString('en-AU') : '—'} {o.observationTime ?? ''}</TableCell>
                    <TableCell sx={{ fontSize: 11, fontWeight: 600, color: o.temperature != null && o.temperature > 38 ? '#C62828' : 'inherit' }}>{o.temperature ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11, fontWeight: 600, color: o.pulse != null && o.pulse > 100 ? '#E65100' : 'inherit' }}>{o.pulse ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{o.respirationRate ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{sysL && diaL ? `${sysL}/${diaL}` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{sysS && diaS ? `${sysS}/${diaS}` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11, fontWeight: 600, color: posturalDrop && posturalDrop > 20 ? '#C62828' : 'inherit' }}>{posturalDrop != null ? `${posturalDrop} mmHg` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{o.notes ?? ''}</TableCell>
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
