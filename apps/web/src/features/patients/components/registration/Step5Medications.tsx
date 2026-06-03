// apps/web/src/features/patients/components/registration/Step5Medications.tsx
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
    Box,
    Button,
    Grid,
    IconButton,
    Paper,
    TextField,
    Typography
} from '@mui/material';
import { useFieldArray, useFormContext } from 'react-hook-form';
import type { RegistrationWizardData } from '../../types/patientTypes';

export const Step5Medications: React.FC = () => {
  const { register, control } = useFormContext<RegistrationWizardData>();
  const { fields, append, remove } = useFieldArray({ control, name: 'medications' });

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Baseline Medications
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Record medications the patient is currently taking prior to registration.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => (
          <Paper
            key={field.id}
            elevation={0}
            sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" fontFamily="Albert Sans, sans-serif">
                Medication {index + 1}
              </Typography>
              <IconButton size="small" aria-label={`Remove medication ${index + 1}`} onClick={() => remove(index)} color="error">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>
            <Grid container spacing={2}>
              <Grid>
                <TextField
                  {...register(`medications.${index}.medicationName`)}
                  label="Medication Name *"
                  fullWidth size="small"
                />
              </Grid>
              <Grid>
                <TextField
                  {...register(`medications.${index}.dose`)}
                  label="Dose *"
                  fullWidth size="small"
                  placeholder="e.g. 10mg"
                />
              </Grid>
              <Grid>
                <TextField
                  {...register(`medications.${index}.frequency`)}
                  label="Frequency *"
                  fullWidth size="small"
                  placeholder="e.g. daily"
                />
              </Grid>
              <Grid>
                <TextField
                  {...register(`medications.${index}.prescriber`)}
                  label="Prescriber"
                  fullWidth size="small"
                />
              </Grid>
            </Grid>
          </Paper>
        ))}
      </Box>

      <Button
        startIcon={<AddIcon />}
        onClick={() =>
          append({ medicationName: '', dose: '', frequency: '', prescriber: '' })
        }
        variant="outlined"
        sx={{
          mt: 2,
          fontFamily: 'Albert Sans, sans-serif',
          borderColor: '#327C8D',
          color: '#327C8D',
          '&:hover': { borderColor: '#265f6d', bgcolor: '#EAF4F6' },
        }}
      >
        Add Medication
      </Button>
    </Box>
  );
};
