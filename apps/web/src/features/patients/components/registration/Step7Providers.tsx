// apps/web/src/features/patients/components/registration/Step7Providers.tsx
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import {
  Box,
  Button,
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
import { PROVIDER_ROLES, type RegistrationWizardData } from '../../types/patientTypes';
import { ProviderSearchAutocomplete } from '../ProviderSearchAutocomplete';
import { useNhsdStatus, type NhsdProvider } from '../../hooks/useProviderSearch';

const nextId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

export const Step7Providers: React.FC = () => {
  const { register, control, setValue, watch } = useFormContext<RegistrationWizardData>();
  const { fields, append, remove } = useFieldArray({ control, name: 'providers' });
  const { data: nhsdStatus } = useNhsdStatus();
  const nhsdConfigured = nhsdStatus?.configured ?? false;
  type ProviderField = keyof RegistrationWizardData['providers'][number];
  type ProviderFieldPath = `providers.${number}.${ProviderField}`;

  // Use patient postcode for proximity search if available
  const patientPostcode = watch('addressPostcode');

  const setProviderField = <K extends ProviderField>(
    index: number,
    field: K,
    value: RegistrationWizardData['providers'][number][K],
  ) => {
    const path = `providers.${index}.${field}` as ProviderFieldPath;
    setValue(path, value);
  };

  const handleSelectProvider = (provider: NhsdProvider, index: number) => {
    if (provider.givenName) setProviderField(index, 'firstName', provider.givenName);
    if (provider.familyName) setProviderField(index, 'lastName', provider.familyName);
    if (provider.practiceName) setProviderField(index, 'practiceName', provider.practiceName);
    if (provider.providerNumber) setProviderField(index, 'providerNumber', provider.providerNumber);
    if (provider.phone) setProviderField(index, 'phone', provider.phone);
    if (provider.email) setProviderField(index, 'email', provider.email);
    if (provider.address.street) setProviderField(index, 'addressStreet', provider.address.street);
    if (provider.address.suburb) setProviderField(index, 'addressSuburb', provider.address.suburb);
    if (provider.address.state) setProviderField(index, 'addressState', provider.address.state);
    if (provider.address.postcode) setProviderField(index, 'addressPostcode', provider.address.postcode);
  };

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Health Providers
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Add the patient&apos;s GP, specialists, and other treating providers.
        {nhsdConfigured && ' Search the national directory to auto-fill details.'}
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => (
          <Paper
            key={field.id}
            elevation={0}
            sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" fontFamily="Albert Sans, sans-serif">
                Provider {index + 1}
              </Typography>
              <IconButton size="small" aria-label={`Remove provider ${index + 1}`} onClick={() => remove(index)} color="error">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>

            {nhsdConfigured && (
              <ProviderSearchAutocomplete
                onSelect={(p) => handleSelectProvider(p, index)}
                postcode={patientPostcode}
                label="Search NHSD directory to auto-fill..."
              />
            )}

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Controller
                  name={`providers.${index}.role`}
                  control={control}
                  render={({ field: f }) => (
                    <FormControl fullWidth size="small">
                      <InputLabel>Role / Specialty</InputLabel>
                      <Select {...f} label="Role / Specialty">
                        {PROVIDER_ROLES.map((r) => (
                          <MenuItem key={r} value={r}>{r}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  {...register(`providers.${index}.firstName`)}
                  label="First Name *"
                  fullWidth size="small"
                  inputProps={{ maxLength: 100 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  {...register(`providers.${index}.lastName`)}
                  label="Last Name *"
                  fullWidth size="small"
                  inputProps={{ maxLength: 100 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.practiceName`)}
                  label="Practice Name"
                  fullWidth size="small"
                  inputProps={{ maxLength: 200 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.providerNumber`)}
                  label="Provider Number"
                  fullWidth size="small"
                  inputProps={{ maxLength: 30 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.addressStreet`)}
                  label="Street Address"
                  fullWidth size="small"
                  inputProps={{ maxLength: 200 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField
                  {...register(`providers.${index}.addressSuburb`)}
                  label="Suburb"
                  fullWidth size="small"
                  inputProps={{ maxLength: 100 }}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 1.5 }}>
                <TextField
                  {...register(`providers.${index}.addressState`)}
                  label="State"
                  fullWidth size="small"
                  inputProps={{ maxLength: 20 }}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 1.5 }}>
                <TextField
                  {...register(`providers.${index}.addressPostcode`)}
                  label="Postcode"
                  fullWidth size="small"
                  inputProps={{ maxLength: 10 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.phone`)}
                  label="Phone"
                  fullWidth size="small"
                  type="tel"
                  inputProps={{ maxLength: 30 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.email`)}
                  label="Email"
                  type="email"
                  fullWidth size="small"
                  inputProps={{ maxLength: 255 }}
                />
              </Grid>
            </Grid>
          </Paper>
        ))}
      </Box>

      <Button
        startIcon={<AddIcon />}
        onClick={() =>
          append({
            id: nextId(), role: 'General Practitioner', firstName: '', lastName: '',
            practiceName: '', addressStreet: '', addressSuburb: '', addressState: '',
            addressPostcode: '', phone: '', email: '', providerNumber: '',
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
        Add Provider
      </Button>
    </Box>
  );
};
