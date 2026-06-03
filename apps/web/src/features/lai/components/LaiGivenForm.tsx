import {
  Alert,
  Box,
  Button,
  Grid,
  MenuItem,
  TextField,
} from '@mui/material';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { useRecordLaiGiven } from '../hooks/useLaiSchedules';
import { INJECTION_SITES } from '../types/laiTypes';
import type { LaiGivenCreateDTO, LaiScheduleResponse } from '@signacare/shared';

interface Props {
  schedule: LaiScheduleResponse;
  patientId: string;
  onSuccess: () => void;
}

export default function LaiGivenForm({ schedule, patientId, onSuccess }: Props) {
  const recordG = useRecordLaiGiven(patientId, schedule.id);
  const { control, handleSubmit, formState: { errors } } = useForm<LaiGivenCreateDTO>({
    defaultValues: {
      laiScheduleId: schedule.id,
      patientId,
      outcome: 'given',
      givenDate: new Date().toISOString().slice(0, 10),
    },
  });

  const outcome = useWatch({ control, name: 'outcome' });

  const onSubmit = (data: LaiGivenCreateDTO) => {
    recordG.mutate(data, { onSuccess });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ pt: 1 }}>
      {recordG.isError && <Alert role="alert" severity="error" sx={{ mb: 2 }}>Failed to record administration.</Alert>}
      <Grid container spacing={2}>
        <Grid>
          <Controller
            name="outcome"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Outcome" select fullWidth>
                <MenuItem value="given">Given</MenuItem>
                <MenuItem value="partial">Partial</MenuItem>
                <MenuItem value="refused">Refused</MenuItem>
                <MenuItem value="deferred">Deferred</MenuItem>
              </TextField>
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="givenDate"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <TextField {...field} label="Date *" type="date" fullWidth InputLabelProps={{ shrink: true }} />
            )}
          />
        </Grid>

        {(outcome === 'given' || outcome === 'partial') && (
          <>
            <Grid>
              <Controller
                name="dosGivenMg"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Dose Given (mg)" fullWidth defaultValue={schedule.doseMg} />
                )}
              />
            </Grid>
            <Grid>
              <Controller
                name="injectionSite"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Injection Site" select fullWidth>
                    {INJECTION_SITES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </TextField>
                )}
              />
            </Grid>
            <Grid>
              <Controller
                name="batchNumber"
                control={control}
                render={({ field }) => <TextField {...field} label="Batch Number" fullWidth />}
              />
            </Grid>
            <Grid>
              <Controller
                name="expiryDate"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Batch Expiry" type="date" fullWidth InputLabelProps={{ shrink: true }} />
                )}
              />
            </Grid>
          </>
        )}

        {outcome === 'refused' && (
          <Grid>
            <Alert role="alert" severity="error" sx={{ mb: 1 }}>
              Refusal will raise a patient flag for clinical review.
            </Alert>
            <Controller
              name="refusalReason"
              control={control}
              rules={{ required: 'Refusal reason required' }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Reason for Refusal *"
                  fullWidth
                  multiline
                  rows={2}
                  error={!!errors.refusalReason}
                  helperText={errors.refusalReason?.message}
                />
              )}
            />
          </Grid>
        )}

        {outcome === 'deferred' && (
          <Grid>
            <Controller
              name="deferredToDate"
              control={control}
              rules={{ required: 'Deferred date required' }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Deferred To Date *"
                  type="date"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  error={!!errors.deferredToDate}
                />
              )}
            />
          </Grid>
        )}

        <Grid>
          <Controller
            name="notes"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Notes" fullWidth multiline rows={2} />
            )}
          />
        </Grid>
        <Grid size={12} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onSuccess}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={recordG.isPending}
            sx={{ bgcolor: outcome === 'refused' ? '#D32F2F' : '#327C8D' }}
          >
            {recordG.isPending ? 'Saving…' : 'Record'}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
