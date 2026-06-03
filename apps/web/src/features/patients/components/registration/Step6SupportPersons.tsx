// apps/web/src/features/patients/components/registration/Step6SupportPersons.tsx
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
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
import { SUPPORT_RELATIONSHIPS, type RegistrationWizardData } from '../../types/patientTypes';

const nextId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

export const Step6SupportPersons: React.FC = () => {
  const { register, control, watch } = useFormContext<RegistrationWizardData>();
  const { fields, append, remove } = useFieldArray({ control, name: 'supportPersons' });

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Support Persons
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Add next of kin, carers, guardians, and other support persons.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => {
          const consentLevel = watch(`supportPersons.${index}.consentLevel`);
          return (
            <Paper
              key={field.id}
              elevation={0}
              sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle2" fontFamily="Albert Sans, sans-serif">
                  Support Person {index + 1}
                </Typography>
                <IconButton size="small" aria-label={`Remove support person ${index + 1}`} onClick={() => remove(index)} color="error">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Box>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register(`supportPersons.${index}.givenName`)}
                    label="Given Name *"
                    fullWidth size="small"
                    inputProps={{ maxLength: 100 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register(`supportPersons.${index}.familyName`)}
                    label="Family Name *"
                    fullWidth size="small"
                    inputProps={{ maxLength: 100 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Controller
                    name={`supportPersons.${index}.relationship`}
                    control={control}
                    render={({ field: f }) => (
                      <FormControl fullWidth size="small">
                        <InputLabel>Relationship *</InputLabel>
                        <Select {...f} label="Relationship *">
                          {SUPPORT_RELATIONSHIPS.map((r) => (
                            <MenuItem key={r} value={r}>{r}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    {...register(`supportPersons.${index}.phoneMobile`)}
                    label="Mobile Phone"
                    fullWidth size="small"
                    type="tel"
                    inputProps={{ maxLength: 30 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    {...register(`supportPersons.${index}.phoneHome`)}
                    label="Home Phone"
                    fullWidth size="small"
                    type="tel"
                    inputProps={{ maxLength: 30 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    {...register(`supportPersons.${index}.email`)}
                    label="Email"
                    type="email"
                    fullWidth size="small"
                    inputProps={{ maxLength: 255 }}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <Controller
                    name={`supportPersons.${index}.consentLevel`}
                    control={control}
                    render={({ field: f }) => (
                      <FormControl fullWidth size="small">
                        <InputLabel>Consent to Share Information</InputLabel>
                        <Select {...f} label="Consent to Share Information">
                          <MenuItem value="">Not specified</MenuItem>
                          <MenuItem value="emergency_only">Emergency Only</MenuItem>
                          <MenuItem value="partial">Partial Consent</MenuItem>
                          <MenuItem value="full">Full Consent</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>

                {consentLevel === 'partial' && (
                  <Grid size={{ xs: 12 }}>
                    <TextField
                      {...register(`supportPersons.${index}.consentNotes`)}
                      label="Partial Consent Details"
                      fullWidth
                      size="small"
                      multiline
                      rows={2}
                      placeholder="Specify what information can be shared"
                      inputProps={{ maxLength: 2000 }}
                    />
                  </Grid>
                )}

                <Grid size={{ xs: 12 }}>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Controller
                      name={`supportPersons.${index}.isEmergencyContact`}
                      control={control}
                      render={({ field: f }) => (
                        <FormControlLabel
                          control={<Checkbox checked={f.value} onChange={f.onChange} size="small" sx={{ color: '#b8621a', '&.Mui-checked': { color: '#b8621a' } }} />}
                          label={<Typography fontSize={12} fontFamily="Albert Sans, sans-serif">Emergency Contact</Typography>}
                        />
                      )}
                    />
                    <Controller
                      name={`supportPersons.${index}.isCarer`}
                      control={control}
                      render={({ field: f }) => (
                        <FormControlLabel
                          control={<Checkbox checked={f.value} onChange={f.onChange} size="small" sx={{ color: '#b8621a', '&.Mui-checked': { color: '#b8621a' } }} />}
                          label={<Typography fontSize={12} fontFamily="Albert Sans, sans-serif">Carer</Typography>}
                        />
                      )}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Paper>
          );
        })}
      </Box>

      <Button
        startIcon={<AddIcon />}
        onClick={() =>
          append({
            id: nextId(),
            givenName: '',
            familyName: '',
            relationship: '',
            phoneMobile: '',
            phoneHome: '',
            email: '',
            consentLevel: '',
            consentNotes: '',
            isEmergencyContact: false,
            isCarer: false,
          })
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
        Add Support Person
      </Button>
    </Box>
  );
};
