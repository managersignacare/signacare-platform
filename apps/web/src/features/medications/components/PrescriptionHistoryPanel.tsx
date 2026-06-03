// apps/web/src/features/medications/components/PrescriptionHistoryPanel.tsx
//
// BUG-524-E — extracted from MedicationsTab.tsx (was L598-699) per the
// hybrid 2-tab split plan. Read-only prescription-history surface
// (grouped by medication, with period filter).
//
// BUG-524-E absorb-1 (clinical-safety BLOCK from L4 + L5 cycle 1):
// the original block carried a `Prescribe` button + PrescribeDialog
// mount. When this panel mounted inside MedicationsTab the parent's
// AllergyAckGate enforced allergy acknowledgement before
// PrescribeDialog could be reached. Post-extraction the panel mounts
// inside MedicationHistoryTab which deliberately omits AllergyAckGate
// (read-only past-medication context per locked design 2026-04-29) —
// a clinician deeplinking to ?tab=medication-history could click
// Prescribe → bypass allergy ack → AHPRA non-compliance. Per L4 cycle-1
// option (b): the Prescribe button + PrescribeDialog mount are REMOVED
// from this panel. Represcribe stays available on Active Medications
// (the prescribing surface where AllergyAckGate enforces), making the
// "read-only past-medication context" design true.
//
// Imported by MedicationHistoryTab as the Prescriptions sub-section.

import {
    Alert, Box, Chip, FormControl, InputLabel, MenuItem, Paper,
    Select, Table, TableBody, TableCell, TableRow, Typography
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { useMemo, useState } from 'react';
import { getIndicationDisplay } from './PrescribeDialog';
import type { MedicationRow } from '../types';

interface PrescriptionHistoryPanelProps { allMeds: MedicationRow[]; patientId: string }
type PeriodFilter = 'all' | '3m' | '6m' | '12m' | '24m';
const PERIOD_FILTERS: readonly PeriodFilter[] = ['all', '3m', '6m', '12m', '24m'];

function isPeriodFilter(value: string): value is PeriodFilter {
  return PERIOD_FILTERS.includes(value as PeriodFilter);
}

export function PrescriptionHistoryPanel({ allMeds }: PrescriptionHistoryPanelProps) {
  const [period, setPeriod] = useState<PeriodFilter>('all');

  const handlePeriodChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value;
    if (isPeriodFilter(value)) {
      setPeriod(value);
    }
  };

  const filtered = useMemo(() => {
    if (period === 'all') return allMeds;
    const months = { '3m': 3, '6m': 6, '12m': 12, '24m': 24 }[period];
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return allMeds.filter(m => {
      const d = m.prescribedAt ? new Date(m.prescribedAt) : new Date(m.createdAt);
      return d >= cutoff;
    });
  }, [allMeds, period]);

  // Group by medication name
  const grouped = useMemo(() => {
    const map = new Map<string, MedicationRow[]>();
    for (const m of filtered) {
      const key = (m.genericName || m.medicationName).toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries()).map(([_key, meds]) => ({
      name: meds[0].medicationName,
      genericName: meds[0].genericName,
      prescriptions: meds.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    }));
  }, [filtered]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} fontFamily="Albert Sans, sans-serif">
          Prescription History — {filtered.length} prescription(s)
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Period</InputLabel>
            <Select value={period} onChange={handlePeriodChange} label="Period">
              <MenuItem value="all">All Time</MenuItem>
              <MenuItem value="3m">Last 3 Months</MenuItem>
              <MenuItem value="6m">Last 6 Months</MenuItem>
              <MenuItem value="12m">Last 12 Months</MenuItem>
              <MenuItem value="24m">Last 24 Months</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 2, fontSize: 11, py: 0.5 }}>
        Read-only past-medication context. To prescribe, switch to the <strong>Active Medications</strong> tab where allergy acknowledgement enforces clinical-safety policy.
      </Alert>

      {!grouped.length ? (
        <Alert severity="info">No prescriptions found for the selected period.</Alert>
      ) : grouped.map((group) => (
        <Paper key={group.name} variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: '#FBF8F5', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>{group.name}</Typography>
              {group.genericName && <Typography variant="caption" color="text.secondary">({group.genericName})</Typography>}
              <Chip label={`${group.prescriptions.length} Rx`} size="small" sx={{ fontSize: 10, ml: 'auto', bgcolor: '#E3F2FD', color: '#1565C0' }} />
            </Box>
            {getIndicationDisplay(group.prescriptions[0]) && (
              <Typography variant="caption" sx={{ fontSize: 10, color: '#1565C0', fontStyle: 'italic' }}>Indication: {getIndicationDisplay(group.prescriptions[0])}</Typography>
            )}
          </Box>
          <Table size="small">
            <TableBody>
              {group.prescriptions.map(m => (
                <TableRow key={m.id} hover>
                  <TableCell sx={{ width: 100 }}>{m.dose}</TableCell>
                  <TableCell sx={{ width: 140 }}>{m.frequency}</TableCell>
                  <TableCell sx={{ width: 70, textTransform: 'capitalize' }}>{m.route}</TableCell>
                  <TableCell sx={{ width: 100 }}>{m.prescribedAt ? new Date(m.prescribedAt).toLocaleDateString('en-AU') : new Date(m.createdAt).toLocaleDateString('en-AU')}</TableCell>
                  <TableCell sx={{ width: 120 }}>{m.prescriber ?? '—'}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {m.isLai && <Chip label="LAI" size="small" sx={{ bgcolor: '#E3F2FD', color: '#1565C0', fontSize: 9, height: 16 }} />}
                      {m.isS8 && <Chip label="S8" size="small" sx={{ bgcolor: '#FFF3E0', color: '#E65100', fontSize: 9, height: 16 }} />}
                    </Box>
                  </TableCell>
                  <TableCell><Chip label={m.status} size="small" color={m.status === 'active' ? 'success' : m.status === 'tapering' ? 'warning' : 'default'} sx={{ fontSize: 10 }} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      ))}
    </Box>
  );
}
