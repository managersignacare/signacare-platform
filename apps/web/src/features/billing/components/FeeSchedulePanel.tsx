import { useState } from 'react';
import {
  Box, Typography, Button, Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  MenuItem, Alert, CircularProgress, Chip, Stack,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../services/billingApi';
import { billingKeys } from '../queryKeys';
import type { FeeScheduleResponse, FeeScheduleCreateDTO } from '@signacare/shared';

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type EditableFeeSchedule = Partial<FeeScheduleCreateDTO> & { id?: string };
type FeeScheduleCategoryValue = NonNullable<FeeScheduleCreateDTO['category']>;
type FeeScheduleModalityValue = NonNullable<FeeScheduleCreateDTO['modality']>;

const FEE_SCHEDULE_CATEGORIES = [
  'psychiatry_initial',
  'psychiatry_subsequent',
  'telehealth_phone',
  'telehealth_video',
  'group_therapy',
  'ect',
  'case_conference',
  'other',
] as const satisfies ReadonlyArray<FeeScheduleCategoryValue>;

const FEE_SCHEDULE_MODALITIES = [
  'in_rooms',
  'phone',
  'video',
  'group',
] as const satisfies ReadonlyArray<FeeScheduleModalityValue>;

function toEditableFeeSchedule(item: FeeScheduleResponse): EditableFeeSchedule {
  const category = FEE_SCHEDULE_CATEGORIES.includes(item.category as FeeScheduleCategoryValue)
    ? (item.category as FeeScheduleCategoryValue)
    : 'other';
  const modality = item.modality && FEE_SCHEDULE_MODALITIES.includes(item.modality as FeeScheduleModalityValue)
    ? (item.modality as FeeScheduleModalityValue)
    : undefined;
  return {
    id: item.id,
    itemNumber: item.itemNumber,
    description: item.description,
    scheduleFeeCents: item.scheduleFeeCents,
    category,
    modality,
    minDurationMins: item.minDurationMins ?? undefined,
    maxDurationMins: item.maxDurationMins ?? undefined,
    isInitial: item.isInitial,
    isActive: item.isActive,
    source: item.source === 'mbs' || item.source === 'dva' || item.source === 'ndis' || item.source === 'custom' ? item.source : 'custom',
    sortOrder: item.sortOrder,
  };
}

export function FeeSchedulePanel() {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<EditableFeeSchedule>({});

  const { data, isLoading } = useQuery({
    queryKey: billingKeys.feeSchedules(),
    queryFn: () => billingApi.listFeeSchedules(),
  });

  const seedMut = useMutation({
    mutationFn: () => billingApi.seedMbsItems(),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.feeSchedules() }),
  });

  const saveMut = useMutation({
    mutationFn: async (item: EditableFeeSchedule) => {
      if (item.id) {
        return billingApi.updateFeeSchedule(item.id, item);
      }
      return billingApi.createFeeSchedule(item as FeeScheduleCreateDTO);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: billingKeys.feeSchedules() });
      setEditOpen(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => billingApi.deactivateFeeSchedule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.feeSchedules() }),
  });

  const items: FeeScheduleResponse[] = data?.items ?? [];

  if (isLoading) return <CircularProgress size={24} />;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">MBS Fee Schedule</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage MBS items and schedule fees for this organisation. Fees should be verified against MBS Online.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
            {seedMut.isPending ? 'Importing...' : 'Import Default Psychiatry Items'}
          </Button>
          <Button variant="contained" size="small" onClick={() => { setEditing({}); setEditOpen(true); }}>
            Add Item
          </Button>
        </Stack>
      </Stack>

      {seedMut.isSuccess && <Alert severity="success" sx={{ mb: 2 }}>Imported {seedMut.data?.inserted ?? 0} MBS items.</Alert>}

      {items.length === 0 ? (
        <Alert severity="info">No fee schedule items configured. Click "Import Default Psychiatry Items" to get started.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Category</TableCell>
              <TableCell>Modality</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell align="right">Schedule Fee</TableCell>
              <TableCell>Active</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} sx={{ opacity: item.isActive ? 1 : 0.5 }}>
                <TableCell><strong>{item.itemNumber}</strong></TableCell>
                <TableCell sx={{ maxWidth: 300 }}>{item.description}</TableCell>
                <TableCell><Chip label={item.category.replace(/_/g, ' ')} size="small" /></TableCell>
                <TableCell>{item.modality ?? '-'}</TableCell>
                <TableCell>{item.minDurationMins != null ? `${item.minDurationMins}${item.maxDurationMins ? `-${item.maxDurationMins}` : '+'} min` : '-'}</TableCell>
                <TableCell align="right">{centsToDisplay(item.scheduleFeeCents)}</TableCell>
                <TableCell>{item.isActive ? 'Yes' : 'No'}</TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => { setEditing(toEditableFeeSchedule(item)); setEditOpen(true); }}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => deleteMut.mutate(item.id)} disabled={!item.isActive}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing.id ? 'Edit Fee Schedule Item' : 'Add Fee Schedule Item'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Item Number" size="small" value={editing.itemNumber ?? ''} onChange={(e) => setEditing({ ...editing, itemNumber: e.target.value })} />
            <TextField label="Description" size="small" multiline rows={2} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <TextField label="Schedule Fee ($)" size="small" type="number" value={editing.scheduleFeeCents != null ? (editing.scheduleFeeCents / 100).toFixed(2) : ''} onChange={(e) => setEditing({ ...editing, scheduleFeeCents: Math.round(parseFloat(e.target.value || '0') * 100) })} helperText="MBS schedule fee in dollars" />
            <TextField select label="Category" size="small" value={editing.category ?? ''} onChange={(e) => setEditing({ ...editing, category: e.target.value as FeeScheduleCreateDTO['category'] })}>
              <MenuItem value="psychiatry_initial">Psychiatry Initial</MenuItem>
              <MenuItem value="psychiatry_subsequent">Psychiatry Subsequent</MenuItem>
              <MenuItem value="telehealth_phone">Telehealth Phone</MenuItem>
              <MenuItem value="telehealth_video">Telehealth Video</MenuItem>
              <MenuItem value="group_therapy">Group Therapy</MenuItem>
              <MenuItem value="ect">ECT</MenuItem>
              <MenuItem value="case_conference">Case Conference</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </TextField>
            <TextField select label="Modality" size="small" value={editing.modality ?? ''} onChange={(e) => setEditing({ ...editing, modality: e.target.value ? (e.target.value as FeeScheduleModalityValue) : undefined })}>
              <MenuItem value="">None</MenuItem>
              <MenuItem value="in_rooms">In Rooms</MenuItem>
              <MenuItem value="phone">Phone</MenuItem>
              <MenuItem value="video">Video</MenuItem>
              <MenuItem value="group">Group</MenuItem>
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField label="Min Duration (min)" size="small" type="number" value={editing.minDurationMins ?? ''} onChange={(e) => setEditing({ ...editing, minDurationMins: parseInt(e.target.value || '0', 10) })} />
              <TextField label="Max Duration (min)" size="small" type="number" value={editing.maxDurationMins ?? ''} onChange={(e) => setEditing({ ...editing, maxDurationMins: e.target.value ? parseInt(e.target.value, 10) : undefined })} helperText="Leave empty for no upper limit" />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={saveMut.isPending || !editing.itemNumber || !editing.description} onClick={() => saveMut.mutate(editing)}>
            {saveMut.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
