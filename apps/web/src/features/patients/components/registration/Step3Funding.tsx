// apps/web/src/features/patients/components/registration/Step3Funding.tsx
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import {
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { FUNDING_TYPES, type RegistrationWizardData } from '../../types/patientTypes';

const nextId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

export const Step3Funding: React.FC = () => {
  const { control, register, watch, setValue } = useFormContext<RegistrationWizardData>();
  const { fields, append, remove } = useFieldArray({ control, name: 'fundingSources' });

  const fundingSources = watch('fundingSources');

  const handleSetPrimary = (index: number) => {
    fundingSources.forEach((_, i) => {
      setValue(`fundingSources.${i}.isPrimary`, i === index);
    });
  };

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Funding
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Add one or more funding sources. Mark one as the primary funding type.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => (
          <Paper
            key={field.id}
            elevation={0}
            sx={{ p: 2, border: '1px solid', borderColor: fundingSources?.[index]?.isPrimary ? 'primary.main' : 'divider', borderRadius: 2 }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2" fontFamily="Albert Sans, sans-serif">
                  Funding Source {index + 1}
                </Typography>
                {fundingSources?.[index]?.isPrimary ? (
                  <Chip label="Primary" size="small" color="primary" />
                ) : (
                  <Chip label="Set as Primary" size="small" variant="outlined" onClick={() => handleSetPrimary(index)} sx={{ cursor: 'pointer' }} />
                )}
              </Box>
              <IconButton size="small" aria-label={`Remove funding source ${index + 1}`} onClick={() => remove(index)} color="error">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Controller
                  name={`fundingSources.${index}.type`}
                  control={control}
                  render={({ field: f }) => (
                    <FormControl fullWidth size="small">
                      <InputLabel>Funding Type</InputLabel>
                      <Select {...f} label="Funding Type">
                        {FUNDING_TYPES.map((ft) => (
                          <MenuItem key={ft.value} value={ft.value}>{ft.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  {...register(`fundingSources.${index}.details`)}
                  label="Details / Member Number"
                  fullWidth
                  size="small"
                  placeholder="e.g. Policy number, claim number"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  {...register(`fundingSources.${index}.expiryDate`)}
                  label="Expiry Date"
                  type="date"
                  fullWidth
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
            </Grid>
          </Paper>
        ))}
      </Box>

      <Button
        startIcon={<AddIcon />}
        onClick={() =>
          append({ id: nextId(), type: '', details: '', expiryDate: '', isPrimary: fields.length === 0 })
        }
        variant="outlined"
        sx={{
          mt: 2,
          fontFamily: 'Albert Sans, sans-serif',
          borderColor: '#b8621a',
          color: '#b8621a',
          '&:hover': { borderColor: '#d6741f', bgcolor: '#FFF8F2' },
        }}
      >
        Add Funding Source
      </Button>
    </Box>
  );
};
