// apps/web/src/features/medications/components/clozapine/ClozapineAdministrationPanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L634-688; ~56 LOC)
// per the inner-tab structural split. Administration record table +
// 8-code AHPRA non-administration codes reference (A/F/R/V/L/N/W/S).
// The "Record Dose" button opens the parent's AdministrationDialog
// via the `onAddAdministration` callback.
//
// Imported by ClozapinePanel as the Administration sub-section.

import AddIcon from '@mui/icons-material/Add';
import { Alert, Box, Button, Chip, Grid, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ClozapineAdministrationResponse } from '@signacare/shared';
import { NON_ADMIN_CODES } from './clozapineConstants';

interface ClozapineAdministrationPanelProps {
  administrations: ClozapineAdministrationResponse[];
  regId: string | undefined;
  onAddAdministration: () => void;
}
export function ClozapineAdministrationPanel({ administrations, regId, onAddAdministration }: ClozapineAdministrationPanelProps) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>Administration Record</Typography>
        {regId && <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onAddAdministration}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, fontSize: 12, textTransform: 'none' }}>Record Dose</Button>}
      </Box>

      {/* Non-admin codes reference */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: '#FAFAFA' }}>
        <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>Reason for Not Administering (codes must be circled)</Typography>
        <Grid container spacing={1}>
          {NON_ADMIN_CODES.map(c => (
            <Grid key={c.code} size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" sx={{ fontSize: 10 }}>
                <Box component="span" sx={{ fontWeight: 700, bgcolor: '#E0E0E0', borderRadius: '50%', display: 'inline-flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center', mr: 0.5, fontSize: 10 }}>{c.code}</Box>
                {c.label}
              </Typography>
            </Grid>
          ))}
        </Grid>
      </Paper>

      {administrations.length === 0 ? <Alert severity="info" sx={{ fontSize: 11 }}>No administrations recorded yet.</Alert> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#F5F5F5' }}>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Time</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Dose</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Given</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Code</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Initials</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {administrations.map((a: ClozapineAdministrationResponse) => (
                <TableRow key={a.id} sx={{ bgcolor: !a.administered ? '#FFF3E0' : 'inherit' }}>
                  <TableCell sx={{ fontSize: 11 }}>{a.administrationDate ? new Date(a.administrationDate).toLocaleDateString('en-AU') : '—'}</TableCell>
                  <TableCell sx={{ fontSize: 11, fontWeight: 600 }}>{a.timeSlot === 'morning' ? '0800' : '2000'}{a.actualTime ? ` (${a.actualTime})` : ''}</TableCell>
                  <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>{a.doseMg} mg</TableCell>
                  <TableCell>{a.administered ? <Chip label="Yes" size="small" color="success" sx={{ fontSize: 9, height: 18 }} /> : <Chip label="No" size="small" color="warning" sx={{ fontSize: 9, height: 18 }} />}</TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{a.nonAdminCode ?? ''}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{a.administratorInitials ?? ''}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{a.notes ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
