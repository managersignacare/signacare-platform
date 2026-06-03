// apps/web/src/features/medications/components/clozapine/ClozapineTitrationPanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L532-587; ~57 LOC)
// per the inner-tab structural split. 14-day NIMC titration ramp-up
// table with inline "Prescribe" button on the active titration day
// (gated by `isPrescriber + isToday + regId`). The Prescribe button
// fires `titMut.mutate(...)` via the `onUpsertTitration` callback
// (parent owns the mutation state — error surface lives in parent's
// panel-top Alert per BUG-605/618).
//
// Imported by ClozapinePanel as the Titration sub-section.

import { Box, Button, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ClozapineRegistrationResponse, ClozapineTitrationDayResponse, ClozapineTitrationDayCreateDTO } from '@signacare/shared';
import { NIMC_TITRATION_SCHEDULE } from './clozapineConstants';

interface ClozapineTitrationPanelProps {
  activeReg: ClozapineRegistrationResponse | undefined;
  regId: string | undefined;
  daysSinceStart: number;
  titrationDays: ClozapineTitrationDayResponse[];
  isPrescriber: boolean;
  onUpsertTitration: (data: ClozapineTitrationDayCreateDTO) => void;
}
export function ClozapineTitrationPanel({
  activeReg, regId, daysSinceStart, titrationDays, isPrescriber, onUpsertTitration,
}: ClozapineTitrationPanelProps) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Suggested clozapine titration schedule (guide only). A rapid or slower schedule may be required — refer to treating psychiatrist.
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#263238' }}>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11, width: 50 }}>Day</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Date</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Morning (0800)</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Evening (2000)</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Total</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11, width: 40 }}>Blood</TableCell>
              <TableCell sx={{ color: '#fff', fontWeight: 700, fontSize: 11 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {NIMC_TITRATION_SCHEDULE.map(row => {
              const savedDay = titrationDays.find((d: ClozapineTitrationDayResponse) => d.dayNumber === row.day);
              const mDose = savedDay ? (savedDay.morningDoseMg ?? row.morning) : row.morning;
              const eDose = savedDay ? (savedDay.eveningDoseMg ?? row.evening) : row.evening;
              const total = (mDose || 0) + (eDose || 0);
              const titDate = activeReg ? new Date(new Date(activeReg.registrationDate).getTime() + (row.day - 1) * 86400000).toISOString().split('T')[0] : '';
              const isBloodDay = [7, 14].includes(row.day);
              const isPast = activeReg && daysSinceStart > row.day;
              const isToday = activeReg && daysSinceStart === row.day;
              return (
                <TableRow key={row.day} sx={{ bgcolor: isToday ? '#FFF8E1' : isPast ? '#F5F5F5' : 'inherit' }}>
                  <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>{row.day}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{titDate ? new Date(titDate).toLocaleDateString('en-AU') : '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>{mDose > 0 ? `${mDose} mg` : '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>{eDose > 0 ? `${eDose} mg` : '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12, fontWeight: 700, color: '#C62828' }}>{total} mg</TableCell>
                  <TableCell>{isBloodDay && <Box sx={{ width: 14, height: 14, bgcolor: '#C62828', borderRadius: 1 }} />}</TableCell>
                  <TableCell>
                    {savedDay ? <Chip label="Prescribed" size="small" color="success" sx={{ fontSize: 9, height: 18 }} /> :
                      isPrescriber && isToday && regId ? (
                        <Button size="small" variant="outlined" sx={{ fontSize: 10, textTransform: 'none', py: 0 }}
                          onClick={() => onUpsertTitration({ registrationId: regId, dayNumber: row.day, titrationDate: titDate, morningDoseMg: row.morning, eveningDoseMg: row.evening })}>
                          Prescribe
                        </Button>
                      ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        Beyond 200 mg/day: If well tolerated, increase slowly in increments of 25–50 mg.
      </Typography>
    </Box>
  );
}
