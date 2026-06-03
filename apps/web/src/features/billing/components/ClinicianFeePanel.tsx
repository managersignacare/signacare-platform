import { useState } from 'react';
import {
  Box, Typography, Button, Table, TableHead, TableRow, TableCell, TableBody,
  TextField, MenuItem, Stack, Alert, CircularProgress, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { billingApi } from '../services/billingApi';
import { billingKeys } from '../queryKeys';
import type { ClinicianFeeResponse, FeeScheduleResponse } from '@signacare/shared';

interface StaffLookupClinicianRow {
  id: string;
  givenName: string;
  familyName: string;
  role?: string;
  specialisation?: string | null;
}

type StaffLookupResponse = StaffLookupClinicianRow[] | { data?: StaffLookupClinicianRow[] };

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ClinicianFeePanel() {
  const qc = useQueryClient();
  const [selectedStaff, setSelectedStaff] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState('');
  const [editFee, setEditFee] = useState('');
  const [uniformGap, setUniformGap] = useState('');

  const { data: staffList } = useQuery({
    queryKey: billingKeys.staffClinicians(),
    queryFn: async () => {
      const r = await apiClient.get<StaffLookupResponse>('staff/lookup');
      const list = Array.isArray(r) ? r : r?.data ?? [];
      return list.filter((s) => s.role === 'clinician');
    },
  });

  const { data: fees, isLoading } = useQuery({
    queryKey: billingKeys.clinicianFees(selectedStaff),
    queryFn: () => billingApi.listClinicianFees(selectedStaff),
    enabled: !!selectedStaff,
  });

  const { data: feeSchedules } = useQuery({
    queryKey: billingKeys.feeSchedules(),
    queryFn: () => billingApi.listFeeSchedules({ isActive: 'true' }),
  });

  const upsertMut = useMutation({
    mutationFn: () => billingApi.upsertClinicianFee(selectedStaff, editItem, {
      itemNumber: editItem,
      providerFeeCents: Math.round(parseFloat(editFee || '0') * 100),
      bulkBillEligible: false,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: billingKeys.clinicianFees(selectedStaff) });
      setEditOpen(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (itemNumber: string) => billingApi.removeClinicianFee(selectedStaff, itemNumber),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.clinicianFees(selectedStaff) }),
  });

  const uniformMut = useMutation({
    mutationFn: () => billingApi.applyUniformGap(selectedStaff, Math.round(parseFloat(uniformGap || '0') * 100)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: billingKeys.clinicianFees(selectedStaff) });
      setUniformGap('');
    },
  });

  const feeItems: ClinicianFeeResponse[] = fees?.items ?? [];
  const scheduleItems: FeeScheduleResponse[] = feeSchedules?.items ?? [];

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>Clinician Fee Configuration</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Set the provider fee (schedule fee + gap) for each clinician per MBS item. The gap is what the patient pays above the Medicare rebate.
      </Typography>

      <TextField select label="Select Clinician" size="small" fullWidth value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)} sx={{ mb: 3, maxWidth: 400 }}>
        <MenuItem value="">— Select Clinician —</MenuItem>
        {(staffList ?? []).map((s) => (
          <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}{s.specialisation ? ` — ${s.specialisation}` : ''}</MenuItem>
        ))}
      </TextField>

      {!selectedStaff && <Alert severity="info">Select a clinician to configure their fees.</Alert>}

      {selectedStaff && isLoading && <CircularProgress size={24} />}

      {selectedStaff && !isLoading && (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
            <TextField label="Uniform gap ($)" size="small" type="number" value={uniformGap} onChange={(e) => setUniformGap(e.target.value)} sx={{ width: 150 }} helperText="Add this gap to ALL items" />
            <Button variant="outlined" size="small" onClick={() => uniformMut.mutate()} disabled={!uniformGap || uniformMut.isPending}>
              Apply to All Items
            </Button>
            <Button variant="outlined" size="small" onClick={() => { setEditItem(''); setEditFee(''); setEditOpen(true); }}>
              Set Fee for Item
            </Button>
          </Stack>

          {feeItems.length === 0 ? (
            <Alert severity="info">No fee overrides set. This clinician will charge the MBS schedule fee (no gap). Use "Apply to All Items" to set a uniform gap.</Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="right">Schedule Fee</TableCell>
                  <TableCell align="right">Provider Fee</TableCell>
                  <TableCell align="right">Gap</TableCell>
                  <TableCell>Bulk Bill?</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {feeItems.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell><strong>{f.itemNumber}</strong></TableCell>
                    <TableCell align="right">{centsToDisplay(f.scheduleFeeCents)}</TableCell>
                    <TableCell align="right">{centsToDisplay(f.providerFeeCents)}</TableCell>
                    <TableCell align="right" sx={{ color: f.gapCents > 0 ? 'warning.main' : 'success.main' }}>
                      {centsToDisplay(f.gapCents)}
                    </TableCell>
                    <TableCell>{f.bulkBillEligible ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => { setEditItem(f.itemNumber); setEditFee((f.providerFeeCents / 100).toFixed(2)); setEditOpen(true); }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => deleteMut.mutate(f.itemNumber)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Set Provider Fee</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="MBS Item" size="small" value={editItem} onChange={(e) => setEditItem(e.target.value)}>
              {scheduleItems.map((s) => (
                <MenuItem key={s.itemNumber} value={s.itemNumber}>
                  {s.itemNumber} — {s.description} ({centsToDisplay(s.scheduleFeeCents)})
                </MenuItem>
              ))}
            </TextField>
            <TextField label="Provider Fee ($)" size="small" type="number" value={editFee} onChange={(e) => setEditFee(e.target.value)} helperText="Total fee the clinician charges (schedule fee + gap)" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!editItem || !editFee || upsertMut.isPending} onClick={() => upsertMut.mutate()}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
