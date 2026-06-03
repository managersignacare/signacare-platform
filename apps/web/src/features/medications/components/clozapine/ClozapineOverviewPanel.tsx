// apps/web/src/features/medications/components/clozapine/ClozapineOverviewPanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L458-529; ~73 LOC)
// per the inner-tab structural split. Renders the active clozapine
// medication cards + the blood-results traffic-light reference table
// + the >48h missed-dose restart warning. Reads-only — no mutations.
//
// Imported by ClozapinePanel as the Overview sub-section.

import { Alert, Box, Card, CardContent, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { getIndicationDisplay } from '../PrescribeDialog';
import type { MedicationRow } from '../../types';
import { ANC_THRESHOLDS } from './clozapineConstants';

interface ClozapineOverviewPanelProps {
  clozMeds: MedicationRow[];
}
export function ClozapineOverviewPanel({ clozMeds }: ClozapineOverviewPanelProps) {
  return (
    <Box>
      {/* Active medications */}
      {clozMeds.map(m => (
        <Card key={m.id} variant="outlined" sx={{ mb: 1.5, borderColor: m.status === 'active' ? '#C62828' : 'divider' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>{m.medicationName}</Typography>
                <Chip label="Clozapine" size="small" sx={{ bgcolor: '#FCE4EC', color: '#C62828', fontSize: 10, fontWeight: 700 }} />
              </Box>
              <Chip label={m.status} size="small" color={m.status === 'active' ? 'success' : 'default'} sx={{ fontSize: 10 }} />
            </Box>

            {/* Medication Chart Header */}
            <Paper variant="outlined" sx={{ mt: 1, p: 1.5, bgcolor: '#FFEBEE', borderColor: '#C62828' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" fontWeight={700} color="#C62828">Medication Chart</Typography>
                <Chip label={m.status === 'active' ? 'Active' : m.status} size="small"
                  color={m.status === 'active' ? 'success' : 'default'} sx={{ fontSize: 9, height: 18 }} />
              </Box>
              <Typography variant="body1" fontWeight={700} sx={{ mt: 0.5 }}>{m.dose}</Typography>
              <Typography variant="body2" color="text.secondary">{m.frequency} — {m.route}</Typography>
              {getIndicationDisplay(m) && <Typography variant="body2" sx={{ mt: 0.5, color: '#C62828', fontStyle: 'italic' }}>Indication: {getIndicationDisplay(m)}</Typography>}
              {m.pbsCode && <Typography variant="caption" color="text.secondary" display="block">PBS: {m.pbsCode}</Typography>}
              {m.prescriber && <Typography variant="caption" color="text.secondary" display="block">Prescriber: {m.prescriber}</Typography>}
              {m.prescribedAt && <Typography variant="caption" color="text.secondary" display="block">Prescribed: {new Date(m.prescribedAt).toLocaleDateString('en-AU')}</Typography>}
            </Paper>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontStyle: 'italic' }}>
              Prescriptions are managed in the Current Medications tab.
            </Typography>
          </CardContent>
        </Card>
      ))}

      {/* Blood results traffic light */}
      <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 2, mb: 1 }}>Blood Results Monitoring System</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#263238' }}>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Range</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Criteria</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Recommended Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow sx={{ bgcolor: ANC_THRESHOLDS.green.bg }}>
              <TableCell sx={{ fontWeight: 700, color: ANC_THRESHOLDS.green.color, fontSize: 11 }}>Green</TableCell>
              <TableCell sx={{ fontSize: 11 }}>WBC &gt; 3.5 &times; 10&#8313;/L AND Neutrophils &gt; 2.0 &times; 10&#8313;/L</TableCell>
              <TableCell sx={{ fontSize: 11 }}>{ANC_THRESHOLDS.green.action}</TableCell>
            </TableRow>
            <TableRow sx={{ bgcolor: ANC_THRESHOLDS.amber.bg }}>
              <TableCell sx={{ fontWeight: 700, color: ANC_THRESHOLDS.amber.color, fontSize: 11 }}>Amber</TableCell>
              <TableCell sx={{ fontSize: 11 }}>WBC 3.0–3.5 &times; 10&#8313;/L OR Neutrophils 1.5–2.0 &times; 10&#8313;/L</TableCell>
              <TableCell sx={{ fontSize: 11 }}>{ANC_THRESHOLDS.amber.action}</TableCell>
            </TableRow>
            <TableRow sx={{ bgcolor: ANC_THRESHOLDS.red.bg }}>
              <TableCell sx={{ fontWeight: 700, color: ANC_THRESHOLDS.red.color, fontSize: 11 }}>Red</TableCell>
              <TableCell sx={{ fontSize: 11 }}>WBC &lt; 3.0 &times; 10&#8313;/L OR Neutrophils &lt; 1.5 &times; 10&#8313;/L</TableCell>
              <TableCell sx={{ fontSize: 11 }}>{ANC_THRESHOLDS.red.action}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      {/* Restart warning */}
      <Alert severity="warning" sx={{ fontSize: 11, mb: 2 }}>
        <strong>Dose missed &gt; 48 hours:</strong> Obtain psychiatric review prior to recommencing. Recommence at 12.5 mg once or twice daily. For blood monitoring frequency, refer to Blood Monitoring section.
      </Alert>
    </Box>
  );
}
