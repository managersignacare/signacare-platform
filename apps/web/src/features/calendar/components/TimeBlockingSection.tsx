import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type {
  AvailabilityBlock,
  AvailabilityBlockCreateDTO,
  AvailabilityBlockUpdateDTO,
  AvailabilityColour,
  Recurrence,
} from '@signacare/shared';
import {
  useCreateBlock,
  useDeleteBlock,
  useUpdateBlock,
} from '../hooks/useCalendarBlocks';

interface TimeBlockingSectionProps {
  blocks: AvailabilityBlock[];
}

type DraftState = {
  colour: AvailabilityColour;
  recurrence: Recurrence;
  dayOfWeek: string;
  specificDate: string;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveUntil: string;
  label: string;
  notes: string;
};

const DAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
] as const;

function buildInitialDraft(): DraftState {
  return {
    colour: 'green',
    recurrence: 'weekly',
    dayOfWeek: '1',
    specificDate: '',
    startTime: '09:00',
    endTime: '10:00',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveUntil: '',
    label: '',
    notes: '',
  };
}

function recurrenceLabel(recurrence: Recurrence): string {
  switch (recurrence) {
    case 'fortnightly':
      return 'Fortnightly';
    case 'none':
      return 'Specific date';
    default:
      return 'Weekly';
  }
}

function colourLabel(colour: AvailabilityColour): string {
  switch (colour) {
    case 'green':
      return 'Free to book';
    case 'yellow':
      return 'Tentative';
    default:
      return 'Busy';
  }
}

function humanRuleSummary(block: AvailabilityBlock): string {
  if (block.recurrence === 'none') {
    return `${block.specificDate ?? 'Specific date'} · ${block.startTime.slice(0, 5)}-${block.endTime.slice(0, 5)}`;
  }

  const day = DAY_OPTIONS.find((option) => Number(option.value) === block.dayOfWeek)?.label ?? 'Unknown day';
  const cadence = block.recurrence === 'fortnightly' ? 'Fortnightly' : 'Weekly';
  return `${cadence} · ${day} · ${block.startTime.slice(0, 5)}-${block.endTime.slice(0, 5)}`;
}

function toCreateDto(draft: DraftState): AvailabilityBlockCreateDTO {
  return {
    colour: draft.colour,
    recurrence: draft.recurrence,
    dayOfWeek: draft.recurrence === 'none' ? null : Number(draft.dayOfWeek),
    specificDate: draft.recurrence === 'none' ? draft.specificDate : null,
    startTime: draft.startTime,
    endTime: draft.endTime,
    effectiveFrom: draft.effectiveFrom,
    effectiveUntil: draft.effectiveUntil || null,
    label: draft.label.trim() || null,
    notes: draft.notes.trim() || null,
  };
}

function toUpdateDto(draft: DraftState): AvailabilityBlockUpdateDTO {
  return toCreateDto(draft);
}

export function TimeBlockingSection({
  blocks,
}: TimeBlockingSectionProps): React.ReactElement {
  const createBlock = useCreateBlock();
  const updateBlock = useUpdateBlock();
  const deleteBlock = useDeleteBlock();

  const [draft, setDraft] = useState<DraftState>(buildInitialDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const sortedBlocks = useMemo(
    () =>
      [...blocks].sort((left, right) => {
        if (left.recurrence !== right.recurrence) {
          return left.recurrence.localeCompare(right.recurrence);
        }
        if ((left.dayOfWeek ?? 99) !== (right.dayOfWeek ?? 99)) {
          return (left.dayOfWeek ?? 99) - (right.dayOfWeek ?? 99);
        }
        if ((left.specificDate ?? '') !== (right.specificDate ?? '')) {
          return (left.specificDate ?? '').localeCompare(right.specificDate ?? '');
        }
        return left.startTime.localeCompare(right.startTime);
      }),
    [blocks],
  );

  useEffect(() => {
    if (!editingId) return;
    const active = blocks.find((block) => block.id === editingId);
    if (!active) {
      setEditingId(null);
      setDraft(buildInitialDraft());
    }
  }, [blocks, editingId]);

  const setField = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const reset = () => {
    setEditingId(null);
    setDraft(buildInitialDraft());
    setError('');
  };

  const handleEdit = (block: AvailabilityBlock) => {
    setEditingId(block.id);
    setError('');
    setDraft({
      colour: block.colour,
      recurrence: block.recurrence,
      dayOfWeek: block.dayOfWeek === null ? '1' : String(block.dayOfWeek),
      specificDate: block.specificDate ?? '',
      startTime: block.startTime.slice(0, 5),
      endTime: block.endTime.slice(0, 5),
      effectiveFrom: block.effectiveFrom,
      effectiveUntil: block.effectiveUntil ?? '',
      label: block.label ?? '',
      notes: block.notes ?? '',
    });
  };

  const handleSave = async () => {
    setError('');
    try {
      if (editingId) {
        await updateBlock.mutateAsync({ id: editingId, patch: toUpdateDto(draft) });
      } else {
        await createBlock.mutateAsync(toCreateDto(draft));
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save time block');
    }
  };

  const handleDelete = async (id: string) => {
    setError('');
    try {
      await deleteBlock.mutateAsync(id);
      if (editingId === id) {
        reset();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete time block');
    }
  };

  const saving =
    createBlock.isPending || updateBlock.isPending || deleteBlock.isPending;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Time Blocking
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Define recurring free, tentative, and busy slots for your booking week. Green slots signal where team members can place appointments.
          </Typography>
        </Box>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <Chip size="small" label="Green = free to book" sx={{ bgcolor: '#E8F5E9', color: '#2E7D32' }} />
          <Chip size="small" label="Yellow = tentative / confirm first" sx={{ bgcolor: '#FFF8E1', color: '#8A5A00' }} />
          <Chip size="small" label="Red = busy / do not book" sx={{ bgcolor: '#FFEBEE', color: '#C62828' }} />
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={draft.colour}
                label="Status"
                onChange={(event) => setField('colour', event.target.value as AvailabilityColour)}
              >
                <MenuItem value="green">Free to book</MenuItem>
                <MenuItem value="yellow">Tentative</MenuItem>
                <MenuItem value="red">Busy</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Recurrence</InputLabel>
              <Select
                value={draft.recurrence}
                label="Recurrence"
                onChange={(event) => setField('recurrence', event.target.value as Recurrence)}
              >
                <MenuItem value="weekly">Weekly template</MenuItem>
                <MenuItem value="fortnightly">Fortnightly template</MenuItem>
                <MenuItem value="none">Specific date only</MenuItem>
              </Select>
            </FormControl>
            {draft.recurrence === 'none' ? (
              <TextField
                size="small"
                label="Specific date"
                type="date"
                value={draft.specificDate}
                onChange={(event) => setField('specificDate', event.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            ) : (
              <FormControl size="small" sx={{ minWidth: 170 }}>
                <InputLabel>Day</InputLabel>
                <Select
                  value={draft.dayOfWeek}
                  label="Day"
                  onChange={(event) => setField('dayOfWeek', event.target.value)}
                >
                  {DAY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField
              size="small"
              label="Start time"
              type="time"
              value={draft.startTime}
              onChange={(event) => setField('startTime', event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label="End time"
              type="time"
              value={draft.endTime}
              onChange={(event) => setField('endTime', event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label="Effective from"
              type="date"
              value={draft.effectiveFrom}
              onChange={(event) => setField('effectiveFrom', event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label="Effective until"
              type="date"
              value={draft.effectiveUntil}
              onChange={(event) => setField('effectiveUntil', event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>

          <TextField
            size="small"
            label="Time block name"
            value={draft.label}
            onChange={(event) => setField('label', event.target.value)}
            placeholder="e.g. Green booking window, ward review, leave"
          />
          <TextField
            size="small"
            label="Booking notes"
            value={draft.notes}
            onChange={(event) => setField('notes', event.target.value)}
            placeholder="Tell admin or colleagues how this slot should be used"
            multiline
            minRows={2}
          />

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={saving}
              onClick={() => void handleSave()}
              sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#a05418' } }}
            >
              {editingId ? 'Update Time Block' : 'Add Time Block'}
            </Button>
            <Button variant="outlined" disabled={saving} onClick={reset}>
              {editingId ? 'Cancel Edit' : 'Reset'}
            </Button>
          </Stack>
        </Stack>

        <Divider />

        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            Active Time-Blocking Rules
          </Typography>
          {sortedBlocks.length === 0 ? (
            <Alert severity="info">No time-blocking rules yet. Add your recurring free, tentative, or busy windows above.</Alert>
          ) : (
            <List disablePadding>
              {sortedBlocks.map((block) => (
                <ListItem
                  key={block.id}
                  disableGutters
                  secondaryAction={
                    <Stack direction="row" spacing={0.5}>
                      <IconButton edge="end" aria-label="Edit time block" onClick={() => handleEdit(block)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <IconButton edge="end" aria-label="Delete time block" onClick={() => void handleDelete(block.id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  }
                  sx={{ pr: 9, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <ListItemText
                    secondaryTypographyProps={{ component: 'div' }}
                    primary={
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                        <Typography fontWeight={700}>
                          {block.label?.trim() || colourLabel(block.colour)}
                        </Typography>
                        <Chip
                          size="small"
                          label={colourLabel(block.colour)}
                          sx={{
                            bgcolor:
                              block.colour === 'green'
                                ? '#E8F5E9'
                                : block.colour === 'yellow'
                                  ? '#FFF8E1'
                                  : '#FFEBEE',
                            color:
                              block.colour === 'green'
                                ? '#2E7D32'
                                : block.colour === 'yellow'
                                  ? '#8A5A00'
                                  : '#C62828',
                          }}
                        />
                        <Chip size="small" label={recurrenceLabel(block.recurrence)} variant="outlined" />
                      </Stack>
                    }
                    secondary={
                      <Box sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {humanRuleSummary(block)}
                        </Typography>
                        {block.notes?.trim() ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {block.notes}
                          </Typography>
                        ) : null}
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
