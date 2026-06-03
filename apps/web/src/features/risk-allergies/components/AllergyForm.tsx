// apps/web/src/features/risk-allergies/components/AllergyForm.tsx
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { useForm, Controller, type SubmitHandler, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCreateAllergy, useUpdateAllergy } from '../hooks/useAllergies';
import {
  CreateAllergySchema,
  UpdateAllergySchema,
  AllergenTypeEnum,
  AllergySeverityEnum,
  ALLERGEN_TYPE_LABELS,
  SEVERITY_CONFIG,
} from '../types/allergyTypes';
import type {
  CreateAllergyDTO,
  UpdateAllergyDTO,
  AllergyResponse,
} from '../types/allergyTypes';

interface Props {
  patientId: string;
  existing?: AllergyResponse;
  onSuccess: () => void;
  onCancel:  () => void;
}

export const AllergyForm: React.FC<Props> = ({
  patientId,
  existing,
  onSuccess,
  onCancel,
}) => {
  const isEdit = !!existing;
  const defaultRecordedDate = existing?.recordedAt ? existing.recordedAt.slice(0, 10) : '';

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateAllergyDTO>({
    resolver: (isEdit
      ? zodResolver(UpdateAllergySchema)
      : zodResolver(CreateAllergySchema)
    ) as Resolver<CreateAllergyDTO>,
    defaultValues: {
      patientId,
      allergen:     existing?.allergen     ?? '',
      allergenType: existing?.allergenType ?? 'drug',
      reaction:     existing?.reaction     ?? '',
      severity:     existing?.severity     ?? 'unknown',
      recordedAt:   defaultRecordedDate,
      status:       existing?.status       ?? 'active',
      notes:        existing?.notes        ?? '',
    },
  });

  const createMutation = useCreateAllergy();
  const updateMutation = useUpdateAllergy();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit: SubmitHandler<CreateAllergyDTO> = (dto) => {
    if (isEdit) {
      const updateDto: UpdateAllergyDTO = {
        allergen:     dto.allergen,
        allergenType: dto.allergenType,
        reaction:     dto.reaction,
        severity:     dto.severity,
        recordedAt:   dto.recordedAt,
        status:       dto.status,
        notes:        dto.notes,
      };
      updateMutation.mutate(
        { patientId, id: existing.id, dto: updateDto },
        { onSuccess },
      );
    } else {
      createMutation.mutate(dto, { onSuccess });
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Stack spacing={2.5}>

        <TextField
          {...register('allergen')}
          label="Allergen *"
          fullWidth
          error={!!errors.allergen}
          helperText={errors.allergen?.message ?? 'Drug name, food, substance, etc.'}
          autoFocus
        />

        <Controller
          name="allergenType"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth error={!!errors.allergenType}>
              <InputLabel>Allergen Type *</InputLabel>
              <Select {...field} label="Allergen Type *">
                {AllergenTypeEnum.options.map((t) => (
                  <MenuItem key={t} value={t}>
                    {ALLERGEN_TYPE_LABELS[t]}
                  </MenuItem>
                ))}
              </Select>
              {errors.allergenType && (
                <FormHelperText>{errors.allergenType.message}</FormHelperText>
              )}
            </FormControl>
          )}
        />

        <TextField
          {...register('reaction')}
          label="Reaction"
          fullWidth
          placeholder="e.g. Anaphylaxis, Urticaria, GI upset..."
          error={!!errors.reaction}
          helperText={errors.reaction?.message}
        />

        <Controller
          name="severity"
          control={control}
          render={({ field }) => (
            <FormControl fullWidth error={!!errors.severity}>
              <InputLabel>Severity *</InputLabel>
              <Select {...field} label="Severity *">
                {AllergySeverityEnum.options.map((s) => {
                  const cfg = SEVERITY_CONFIG[s];
                  return (
                    <MenuItem key={s} value={s}>
                      <Box
                        component="span"
                        display="inline-block"
                        width={10}
                        height={10}
                        borderRadius="50%"
                        bgcolor={cfg.colour}
                        mr={1}
                        flexShrink={0}
                      />
                      {cfg.label}
                    </MenuItem>
                  );
                })}
              </Select>
              {errors.severity && (
                <FormHelperText>{errors.severity.message}</FormHelperText>
              )}
            </FormControl>
          )}
        />

        <TextField
          {...register('recordedAt')}
          label="Recorded date"
          type="date"
          fullWidth
          InputLabelProps={{ shrink: true }}
          error={!!errors.recordedAt}
          helperText={errors.recordedAt?.message}
        />

        <TextField
          {...register('notes')}
          label="Notes"
          multiline
          rows={3}
          fullWidth
          placeholder="Additional clinical context..."
        />

        {(createMutation.isError || updateMutation.isError) && (
          <Alert role="alert" severity="error">Failed to save allergy. Please try again.</Alert>
        )}

        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button variant="outlined" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isPending}
            startIcon={isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : null}
          >
            {isEdit ? 'Update Allergy' : 'Add Allergy'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};
