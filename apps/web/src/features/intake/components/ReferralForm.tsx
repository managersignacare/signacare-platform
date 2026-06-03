import React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  ListSubheader,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { CreateReferralSchema, type DistributionMode } from '@signacare/shared';
import { Controller, useForm, type Control, type FieldErrors } from 'react-hook-form';
import { useCreateReferral } from '../hooks/useCreateReferral';
import { useReferralModule } from '../hooks/useReferralModule';
import type { CreateReferral } from '../types/intakeTypes';
import { intakeKeys } from '../queryKeys';

interface Props {
  onSuccess?: () => void;
}

interface StaffLookupRow {
  id: string;
  role?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  specialisation?: string | null;
}

interface DisciplineRow {
  id?: string;
  name: string;
}

function normalizeApiArray<T>(value: T[] | { data?: T[] } | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

export const ReferralForm = ({ onSuccess }: Props) => {
  const { mutate, isPending, isError, error } = useCreateReferral();
  const { module: referralModule } = useReferralModule();
  const [distributionMode, setDistributionMode] = React.useState<DistributionMode>('all');

  // Fetch staff list for target clinician picker
  const { data: clinicianList } = useQuery<StaffLookupRow[]>({
    queryKey: intakeKeys.staffClinicians.all,
    queryFn: async () => {
      try {
        const r = await apiClient.get<StaffLookupRow[] | { data?: StaffLookupRow[] }>('staff/lookup');
        const list = normalizeApiArray<StaffLookupRow>(r);
        return list.filter((s) => s.role === 'clinician');
      } catch { return []; }
    },
    enabled: referralModule === 'team',
  });

  // Fetch disciplines for specialty filter
  const { data: disciplines } = useQuery<DisciplineRow[]>({
    queryKey: intakeKeys.disciplines.all,
    queryFn: async () => {
      try {
        const r = await apiClient.get<DisciplineRow[] | { data?: DisciplineRow[] }>('staff-settings/disciplines');
        return normalizeApiArray<DisciplineRow>(r);
      } catch { return []; }
    },
    enabled: referralModule === 'team',
  });

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateReferral>({
    resolver: zodResolver(CreateReferralSchema),
    defaultValues: {
      referralDate: new Date().toISOString().slice(0, 10),
      urgency: 'routine',
      source: '',
      fromProviderName: '',
      fromService: '',
      reason: '',
      notes: '',
      assignedToStaffId: '',
    },
  });

  const onSubmit = (values: CreateReferral) => {
    // Add distribution fields for team mode
    const payload = {
      ...values,
      ...(referralModule === 'team' ? {
        distributionMode,
        targetClinicianId: distributionMode === 'specific_clinician' ? values.targetClinicianId : undefined,
        distributionSpeciality: distributionMode === 'specialty' ? values.distributionSpeciality : undefined,
      } : {}),
    };
    mutate(payload, {
      onSuccess: () => {
        onSuccess?.();
      },
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <Stack spacing={2.5}>
        {isError ? (
          <Alert role="alert" severity="error">{error instanceof Error ? error.message : 'Failed to create referral.'}</Alert>
        ) : null}

        <Grid container spacing={2}>
          <Grid>
            <Controller
              name="referralDate"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Referral date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.referralDate)}
                  helperText={errors.referralDate?.message}
                />
              )}
            />
          </Grid>

          <Grid>
            <Controller
              name="urgency"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Urgency"
                  error={Boolean(errors.urgency)}
                  helperText={errors.urgency?.message}
                >
                  <MenuItem value="routine">Routine</MenuItem>
                  <MenuItem value="urgent">Urgent</MenuItem>
                  <MenuItem value="emergency">Emergency</MenuItem>
                </TextField>
              )}
            />
          </Grid>

          <Grid>
            <Controller
              name="source"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Referral Source"
                  error={Boolean(errors.source)}
                  helperText={errors.source?.message}
                >
                  <ListSubheader>Internal</ListSubheader>
                  <MenuItem value="Emergency Department">Emergency Department</MenuItem>
                  <MenuItem value="Inpatient Unit">Inpatient Unit</MenuItem>
                  <MenuItem value="Community Mental Health Team">Community Mental Health Team</MenuItem>
                  <MenuItem value="Consultation-Liaison">Consultation-Liaison</MenuItem>
                  <MenuItem value="Forensic Service">Forensic Service</MenuItem>
                  <ListSubheader>External</ListSubheader>
                  <MenuItem value="General Practitioner">General Practitioner</MenuItem>
                  <MenuItem value="Private Psychiatrist">Private Psychiatrist</MenuItem>
                  <MenuItem value="Private Psychologist">Private Psychologist</MenuItem>
                  <MenuItem value="Other Health Service">Other Health Service</MenuItem>
                  <MenuItem value="Police/Justice">Police/Justice</MenuItem>
                  <MenuItem value="Self-Referral">Self-Referral</MenuItem>
                  <MenuItem value="Family/Carer">Family/Carer</MenuItem>
                  <MenuItem value="NDIS Provider">NDIS Provider</MenuItem>
                  <MenuItem value="Accommodation Service">Accommodation Service</MenuItem>
                  <MenuItem value="Other">Other</MenuItem>
                </TextField>
              )}
            />
          </Grid>

          <Grid>
            <ReferrerAutocomplete control={control} errors={errors} />
          </Grid>

          <Grid>
            <Controller
              name="fromService"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Referring service"
                  error={Boolean(errors.fromService)}
                  helperText={errors.fromService?.message}
                />
              )}
            />
          </Grid>

          <Grid>
            <Controller
              name="reason"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Reason for referral"
                  multiline
                  minRows={3}
                  error={Boolean(errors.reason)}
                  helperText={errors.reason?.message}
                />
              )}
            />
          </Grid>

          <Grid>
            <Controller
              name="notes"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Intake notes"
                  multiline
                  minRows={3}
                  error={Boolean(errors.notes)}
                  helperText={errors.notes?.message}
                />
              )}
            />
          </Grid>
        </Grid>

        {referralModule === 'team' && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="text.secondary">
              Distribution
            </Typography>
            <FormControl>
              <RadioGroup
                value={distributionMode}
                onChange={(e) => setDistributionMode(e.target.value as DistributionMode)}
              >
                <FormControlLabel value="all" control={<Radio size="small" />} label="Forward to all clinicians" />
                <FormControlLabel value="specific_clinician" control={<Radio size="small" />} label="Forward to specific clinician" />
                <FormControlLabel value="specialty" control={<Radio size="small" />} label="Forward to specialty" />
              </RadioGroup>
            </FormControl>

            {distributionMode === 'specific_clinician' && (
              <Controller
                name="targetClinicianId"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Select clinician"
                    size="small"
                    sx={{ maxWidth: 400 }}
                  >
                    {(clinicianList ?? []).map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.givenName} {s.familyName}{s.specialisation ? ` — ${s.specialisation}` : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            )}

            {distributionMode === 'specialty' && (
              <Controller
                name="distributionSpeciality"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Select specialty"
                    size="small"
                    sx={{ maxWidth: 400 }}
                  >
                    {(disciplines ?? []).map((d) => (
                      <MenuItem key={d.id ?? d.name} value={d.name}>
                        {d.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            )}
          </>
        )}

        <Stack direction="row" justifyContent="flex-end">
          <Button
            type="submit"
            variant="contained"
            disabled={isPending}
            sx={{
              backgroundColor: '#327C8D',
              '&:hover': { backgroundColor: '#2a6977' },
            }}
          >
            Create referral
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};

// ── Referrer Autocomplete (staff + external providers) ──
function ReferrerAutocomplete({ control, errors }: { control: Control<CreateReferral>; errors: FieldErrors<CreateReferral> }) {
  const { data: staffList } = useQuery<StaffLookupRow[]>({
    queryKey: intakeKeys.staffLookup.all,
    queryFn: async () => {
      try {
        const r = await apiClient.get<StaffLookupRow[] | { data?: StaffLookupRow[] }>('staff/lookup');
        return normalizeApiArray<StaffLookupRow>(r);
      } catch { return []; }
    },
  });
  const options = (staffList ?? []).map((s) => `${s.givenName ?? ''} ${s.familyName ?? ''}`.trim()).filter(Boolean);
  return (
    <Controller name="fromProviderName" control={control}
      render={({ field }) => (
        <Autocomplete freeSolo options={options} value={field.value || ''} onChange={(_, v) => field.onChange(v ?? '')}
          onInputChange={(_, v) => field.onChange(v)}
          renderInput={(params) => <TextField {...params} label="Referrer name" error={Boolean(errors.fromProviderName)} helperText={errors.fromProviderName?.message} />}
        />
      )}
    />
  );
}
