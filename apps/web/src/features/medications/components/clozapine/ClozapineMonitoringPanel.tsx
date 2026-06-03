// apps/web/src/features/medications/components/clozapine/ClozapineMonitoringPanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L757-812; ~57 LOC)
// per the inner-tab structural split. NIMC monitoring investigations
// grid (25 rows × 5 checkpoints) with click-to-cycle status (none →
// normal → abnormal → pending → none). Each cell click fires
// `monMut.mutate(...)` via the `onUpsertMonitoringCheck` callback
// (parent owns the mutation; error surface lives in parent's
// panel-top Alert per BUG-605/618).
//
// Imported by ClozapinePanel as the Monitoring sub-section.

import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ClozapineMonitoringCheckResponse, ClozapineMonitoringCheckCreateDTO } from '@signacare/shared';
import { MONITORING_INVESTIGATIONS } from './clozapineConstants';

interface ClozapineMonitoringPanelProps {
  monitoringChecks: ClozapineMonitoringCheckResponse[];
  regId: string | undefined;
  onUpsertMonitoringCheck: (data: ClozapineMonitoringCheckCreateDTO) => void;
}
export function ClozapineMonitoringPanel({ monitoringChecks, regId, onUpsertMonitoringCheck }: ClozapineMonitoringPanelProps) {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Clozapine Monitoring Investigations (Suggested Guidelines)</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Click a checkbox to record a result. Shaded cells indicate the test is required at that checkpoint.
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#263238' }}>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 10, minWidth: 160 }}>Investigation</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 10 }} align="center">Baseline</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 10 }} align="center">Day 7</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 10 }} align="center">Day 14</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 10 }} align="center">Day 21</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 10 }} align="center">Day 28</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 10 }}>After 28 days</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {MONITORING_INVESTIGATIONS.map(inv => {
              const checks = monitoringChecks.filter((c: ClozapineMonitoringCheckResponse) => c.investigation === inv.name);
              return (
                <TableRow key={inv.name} sx={{ '&:nth-of-type(even)': { bgcolor: '#FAFAFA' } }}>
                  <TableCell sx={{ fontSize: 10, fontWeight: 600 }}>{inv.name}</TableCell>
                  {['baseline', 'day7', 'day14', 'day21', 'day28'].map(cp => {
                    const check = checks.find((c: ClozapineMonitoringCheckResponse) => c.checkPoint === cp);
                    const status = check?.resultStatus;
                    return (
                      <TableCell key={cp} align="center" sx={{ cursor: regId ? 'pointer' : 'default', bgcolor: status === 'normal' ? '#E8F5E9' : status === 'abnormal' ? '#FFEBEE' : status === 'pending' ? '#FFF8E1' : 'inherit' }}
                        onClick={() => {
                          if (!regId) return;
                          const next = !status ? 'normal' : status === 'normal' ? 'abnormal' : status === 'abnormal' ? 'pending' : undefined;
                          if (next) onUpsertMonitoringCheck({ registrationId: regId, investigation: inv.name, checkPoint: cp as ClozapineMonitoringCheckCreateDTO['checkPoint'], checkDate: new Date().toISOString().split('T')[0], resultStatus: next });
                        }}>
                        {status === 'normal' ? <Typography sx={{ color: '#2E7D32', fontWeight: 700, fontSize: 11 }}>N</Typography> :
                         status === 'abnormal' ? <Typography sx={{ color: '#C62828', fontWeight: 700, fontSize: 11 }}>A</Typography> :
                         status === 'pending' ? <Typography sx={{ color: '#E65100', fontWeight: 700, fontSize: 11 }}>P</Typography> :
                         <Box sx={{ width: 14, height: 14, border: '1px solid #ccc', borderRadius: 1, mx: 'auto' }} />}
                      </TableCell>
                    );
                  })}
                  <TableCell sx={{ fontSize: 9, color: 'text.secondary' }}>{inv.after28}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 12, height: 12, bgcolor: '#E8F5E9', border: '1px solid #ccc' }} /><Typography variant="caption" sx={{ fontSize: 10 }}>Normal (N)</Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 12, height: 12, bgcolor: '#FFEBEE', border: '1px solid #ccc' }} /><Typography variant="caption" sx={{ fontSize: 10 }}>Abnormal (A)</Typography></Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 12, height: 12, bgcolor: '#FFF8E1', border: '1px solid #ccc' }} /><Typography variant="caption" sx={{ fontSize: 10 }}>Pending (P)</Typography></Box>
      </Box>
    </Box>
  );
}
