import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { ReferralDecisionSchema } from '@signacare/shared';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { useReferralDecision } from '../hooks/useReferralDecision';
import type { ReferralDecision } from '../types/intakeTypes';

interface Props {
  open: boolean;
  referralId: string;
  onClose: () => void;
}

export const ReferralDecisionModal = ({ open, referralId, onClose }: Props) => {
  const { mutate, isPending, isError, error } = useReferralDecision();

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<ReferralDecision>({
    resolver: zodResolver(ReferralDecisionSchema) as Resolver<ReferralDecision>,
    defaultValues: {
      decision: '' as ReferralDecision['decision'],
      patientId: '',
      createEpisode: true,
      episodeType: 'community',
      redirectTo: '',
      confirmDecision: false,
    },
  });

  const decision = watch('decision');

  const onSubmit = (values: ReferralDecision) => {
    mutate(
      { id: referralId, dto: values },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle id="dialog-title">Referral decision</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5} component="form" id="referral-decision-form" onSubmit={handleSubmit(onSubmit)}>
          {isError ? (
            <Alert role="alert" severity="error">{error instanceof Error ? error.message : 'Failed to save decision.'}</Alert>
          ) : null}

          <Controller
            name="decision"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Decision"
                error={Boolean(errors.decision)}
                helperText={errors.decision?.message}
              >
                <MenuItem value="" disabled>
                  <em>Select a decision</em>
                </MenuItem>
                <MenuItem value="accepted">Accept</MenuItem>
                <MenuItem value="declined">Decline</MenuItem>
                <MenuItem value="rejected">Reject (Legacy)</MenuItem>
                <MenuItem value="redirected">Redirect</MenuItem>
                <MenuItem value="info_requested">Request info</MenuItem>
              </TextField>
            )}
          />

          <Controller
            name="notes"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Decision notes"
                multiline
                minRows={3}
                error={Boolean(errors.notes)}
                helperText={errors.notes?.message}
              />
            )}
          />

          {(decision === 'declined' || decision === 'rejected') && (
            <Controller
              name="declineReason"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Decline reason"
                  error={Boolean(errors.declineReason)}
                  helperText={errors.declineReason?.message}
                />
              )}
            />
          )}

          {(decision === 'accepted' || decision === 'declined' || decision === 'rejected') && (
            <Controller
              name="confirmDecision"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Checkbox checked={Boolean(field.value)} onChange={(_, checked) => field.onChange(checked)} />}
                  label="I confirm this decision is intentional"
                />
              )}
            />
          )}

          {decision === 'redirected' ? (
            <Controller
              name="redirectTo"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Redirect to"
                  error={Boolean(errors.redirectTo)}
                  helperText={errors.redirectTo?.message}
                />
              )}
            />
          ) : (
            <Grid container spacing={2}>
              <Grid>
                <Controller
                  name="patientId"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Link to existing patient ID"
                      error={Boolean(errors.patientId)}
                      helperText={errors.patientId?.message || 'Leave blank if creating a new patient.'}
                    />
                  )}
                />
              </Grid>

              <Grid>
                <Controller
                  name="createEpisode"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Checkbox checked={Boolean(field.value)} onChange={(_, checked) => field.onChange(checked)} />}
                      label="Create episode on acceptance"
                    />
                  )}
                />
              </Grid>

              <Grid>
                <Controller
                  name="episodeType"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Episode type"
                      error={Boolean(errors.episodeType)}
                      helperText={errors.episodeType?.message}
                    >
                      <MenuItem value="community">Community</MenuItem>
                      <MenuItem value="inpatient">Inpatient</MenuItem>
                      <MenuItem value="outpatient">Outpatient</MenuItem>
                      <MenuItem value="triage">Triage</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
            </Grid>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          form="referral-decision-form"
          variant="contained"
          disabled={isPending}
          sx={{
            backgroundColor: '#327C8D',
            '&:hover': { backgroundColor: '#2a6977' },
          }}
        >
          Save decision
        </Button>
      </DialogActions>
    </Dialog>
  );
};
