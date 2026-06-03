// apps/web/src/features/medications/components/clozapine/ClozapineAdversePanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L815-845; ~32 LOC)
// per the inner-tab structural split. Read-only display of the
// 12-row NIMC adverse effects reference (3 fatal: agranulocytosis,
// myocarditis/cardiomyopathy, severe CIGH). Zero coupling — no data
// fetched, no mutations, no state. Just renders the constant.
//
// Imported by ClozapinePanel as the Adverse Effects sub-section.

import { Alert, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { ADVERSE_EFFECTS } from './clozapineConstants';

export function ClozapineAdversePanel() {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Management of Common Adverse Effects (Suggested Guidelines)</Typography>
      <Alert severity="warning" sx={{ fontSize: 11, mb: 1.5 }}>
        All adverse effects must be reported to the TGA within 3 working days. This is not an exhaustive list.
      </Alert>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#C62828' }}>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Adverse Effect</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Time Course for Onset</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Recommended Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ADVERSE_EFFECTS.map(ae => (
              <TableRow key={ae.effect} sx={{ '&:nth-of-type(even)': { bgcolor: '#FAFAFA' } }}>
                <TableCell sx={{ fontSize: 11, fontWeight: 600 }}>{ae.effect}</TableCell>
                <TableCell sx={{ fontSize: 11 }}>{ae.onset}</TableCell>
                <TableCell sx={{ fontSize: 11 }}>{ae.action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        Modified from: Taylor D, Barnes T, Young A. The Maudsley Prescribing Guidelines in Psychiatry, 14th Edition. Wiley Blackwell 2021.
      </Typography>
    </Box>
  );
}
