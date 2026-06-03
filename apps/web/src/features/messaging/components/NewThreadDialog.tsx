// features/messaging/components/NewThreadDialog.tsx
import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, CircularProgress, Alert, Autocomplete, Chip,
  Grid,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { useCreateThread } from '../hooks/useMessages';
import { messagingCrossFeatureKeys } from '../queryKeys';
import {
  CreateThreadSchema,
  type CreateThreadDTO,
  type MessageThreadResponse,
} from '../types/messagingTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (thread: MessageThreadResponse) => void;
  /** Pre-fill patientId when opened from a patient context */
  patientId?: string;
}

/** Staff search autocomplete for message recipients */
interface StaffListRow {
  id: string;
  givenName?: string;
  given_name?: string;
  familyName?: string;
  family_name?: string;
  role?: string;
}

interface StaffListEnvelope {
  data?: StaffListRow[];
  staff?: StaffListRow[];
}

interface RecipientOption {
  id: string;
  label: string;
}

interface StaffRecipientPickerProps { value: string[]; onChange: (ids: string[]) => void; error?: boolean; helperText?: string; }
function StaffRecipientPicker({ value, onChange, error, helperText }: StaffRecipientPickerProps) {
  const [input, setInput] = useState('');
  const { data: staffList = [] } = useQuery({
    queryKey: messagingCrossFeatureKeys.staffSearch(input),
    queryFn: () =>
      apiClient.get<StaffListRow[] | StaffListEnvelope>('staff').then((r) =>
        Array.isArray(r) ? r : r.data ?? r.staff ?? []
      ),
    enabled: true,
    staleTime: 60_000,
  });
  const options: RecipientOption[] = staffList.map((s) => ({
    id: s.id,
    label: `${s.givenName ?? s.given_name ?? ''} ${s.familyName ?? s.family_name ?? ''} (${s.role ?? 'staff'})`.trim(),
  }));
  const selected = options.filter((o) => value.includes(o.id));

  return (
    <Autocomplete<RecipientOption, true, false, false>
      multiple
      options={options}
      getOptionLabel={(o) => o.label}
      value={selected}
      onChange={(_e, val) => onChange(val.map((v) => v.id))}
      inputValue={input}
      onInputChange={(_e, v) => setInput(v)}
      renderTags={(tags, getTagProps) =>
        tags.map((t, i) => <Chip {...getTagProps({ index: i })} key={t.id} label={t.label} size="small" />)
      }
      renderInput={(params) => (
        <TextField {...params} label="Recipients" placeholder="Search staff..." error={error} helperText={helperText ?? 'Search and select staff members'} />
      )}
    />
  );
}

export const NewThreadDialog: React.FC<Props> = ({
  open,
  onClose,
  onCreated,
  patientId,
}) => {
  const createMutation = useCreateThread();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateThreadDTO>({
    resolver: zodResolver(CreateThreadSchema),
    defaultValues: {
      subject: '',
      patientId: patientId ?? undefined,
      recipientIds: [],
      body: '',
    },
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = (data: CreateThreadDTO) => {
    createMutation.mutate(data, {
      onSuccess: (thread) => {
        reset();
        onCreated(thread);
      },
    });
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title">New Message</DialogTitle>

      <DialogContent dividers>
        {createMutation.isError && (
          <Alert role="alert" severity="error" sx={{ mb: 2 }}>
            Failed to create thread. Please try again.
          </Alert>
        )}

        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid>
            <Controller
              name="subject"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Subject"
                  fullWidth
                  required
                  error={!!errors.subject}
                  helperText={errors.subject?.message}
                />
              )}
            />
          </Grid>

          {/* Staff recipients — searches staff directory */}
          <Grid>
            <Controller
              name="recipientIds"
              control={control}
              render={({ field }) => (
                <StaffRecipientPicker
                  value={field.value ?? []}
                  onChange={field.onChange}
                  error={!!errors.recipientIds}
                  helperText={errors.recipientIds?.message}
                />
              )}
            />
          </Grid>

          <Grid>
            <Controller
              name="body"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Message"
                  fullWidth
                  required
                  multiline
                  minRows={4}
                  error={!!errors.body}
                  helperText={errors.body?.message}
                />
              )}
            />
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="outlined" onClick={handleClose} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit(onSubmit)}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} color="inherit" /> : 'Send'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
