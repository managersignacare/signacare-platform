// apps/web/src/features/medications/components/clozapine/ClozapineBloodPanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L590-631; ~43 LOC)
// per the inner-tab structural split. Blood-results history table
// with traffic-light row colouring (red ANC = STOP-clozapine
// fatality-prevention action). The "Record Blood Result" button opens
// the parent's BloodResultDialog via the `onAddBloodResult` callback.
//
// Imported by ClozapinePanel as the Blood Results sub-section.

import AddIcon from '@mui/icons-material/Add';
import { Alert, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ClozapineBloodResultResponse } from '@signacare/shared';
import { ancColor } from './clozapineConstants';

interface ClozapineBloodPanelProps {
  bloodResults: ClozapineBloodResultResponse[];
  regId: string | undefined;
  onAddBloodResult: () => void;
}
export function ClozapineBloodPanel({ bloodResults, regId, onAddBloodResult }: ClozapineBloodPanelProps) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>Blood Results History</Typography>
        {regId && <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onAddBloodResult}
          sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, fontSize: 12, textTransform: 'none' }}>Record Blood Result</Button>}
      </Box>
      {bloodResults.length === 0 ? <Alert severity="info" sx={{ fontSize: 11 }}>No blood results recorded yet.</Alert> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F5F5F5' }}>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>WBC (×10⁹/L)</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>ANC (×10⁹/L)</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Neut %</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Lab</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {bloodResults.map((br: ClozapineBloodResultResponse) => (
                <TableRow key={br.id} sx={{ bgcolor: br.ancStatus === 'red' ? '#FFEBEE' : br.ancStatus === 'amber' ? '#FFF3E0' : 'inherit' }}>
                  <TableCell sx={{ fontSize: 11 }}>{br.collectionDate ? new Date(br.collectionDate).toLocaleDateString('en-AU') : '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>{br.wbcValue ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>{br.ancValue ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{br.neutrophilsPct != null ? `${br.neutrophilsPct}%` : '—'}</TableCell>
                  <TableCell>
                    <Chip label={(br.ancStatus ?? 'unknown').toUpperCase()} size="small"
                      sx={{ bgcolor: ancColor(br.ancStatus) + '20', color: ancColor(br.ancStatus), fontWeight: 700, fontSize: 9, height: 18 }} />
                  </TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{br.labName ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{br.clinicalNotes ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
