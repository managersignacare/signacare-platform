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
import {
  SUPPORT_RELATIONSHIPS,
  INTERPRETER_LANGUAGES,
  PROVIDER_ROLES,
  type PatientProvider,
} from '../../types/patientTypes';
import { ProviderSearchAutocomplete } from '../ProviderSearchAutocomplete';
import { useNhsdStatus, type NhsdProvider } from '../../hooks/useProviderSearch';
import { Step3Funding } from './Step3Funding';
import type { EditPatientFormData } from './EditPatientWizard.types';

const nextId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

type StringFields = {
  [K in keyof EditPatientFormData]: EditPatientFormData[K] extends string ? K : never;
}[keyof EditPatientFormData];

interface FProps {
  name: StringFields;
  label: string;
  type?: string;
  placeholder?: string;
  helperText?: string;
  shrink?: boolean;
  maxLength?: number;
}

function F({ name, label, type, placeholder, helperText, shrink, maxLength }: FProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<EditPatientFormData>();
  const err = errors[name]?.message as string | undefined;
  return (
    <TextField
      {...register(name)}
      label={label}
      type={type}
      fullWidth
      size="small"
      placeholder={placeholder}
      helperText={helperText ?? err}
      error={Boolean(err)}
      slotProps={shrink ? { inputLabel: { shrink: true } } : undefined}
      inputProps={{ style: { fontFamily: 'Albert Sans, sans-serif' }, maxLength }}
    />
  );
}

const sx = { fontFamily: 'Albert Sans, sans-serif' };

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'genderqueer', label: 'Genderqueer' },
  { value: 'transgendermale', label: 'Transgender Male' },
  { value: 'transgenderfemale', label: 'Transgender Female' },
  { value: 'prefernottosay', label: 'Prefer not to say' },
  { value: 'other', label: 'Other' },
];

const ATSI_OPTIONS = [
  { value: 'aboriginal', label: 'Aboriginal' },
  { value: 'torresstrait', label: 'Torres Strait Islander' },
  { value: 'both', label: 'Both Aboriginal and Torres Strait Islander' },
  { value: 'neither', label: 'Neither' },
  { value: 'prefernottosay', label: 'Prefer not to say' },
];

function StepDemographics() {
  const { control, watch } = useFormContext<EditPatientFormData>();
  const interpreterRequired = watch('interpreterRequired');
  const interpreterLanguage = watch('interpreterLanguage');
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Demographics
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}><F name="givenName" label="Given Name *" maxLength={100} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}><F name="familyName" label="Family Name *" maxLength={100} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}><F name="preferredName" label="Preferred Name" maxLength={100} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}><F name="dateOfBirth" label="Date of Birth *" type="date" shrink helperText="YYYY-MM-DD" /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Controller
            name="gender"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth size="small">
                <InputLabel>Gender</InputLabel>
                <Select {...field} label="Gender">
                  <MenuItem value=""><em>Not specified</em></MenuItem>
                  {GENDER_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value} sx={sx}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}><F name="pronouns" label="Pronouns" placeholder="e.g. they/them" maxLength={50} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Controller
            name="atsiStatus"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth size="small">
                <InputLabel>Aboriginal / Torres Strait Islander Status</InputLabel>
                <Select {...field} label="Aboriginal / Torres Strait Islander Status">
                  <MenuItem value=""><em>Not specified</em></MenuItem>
                  {ATSI_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value} sx={sx}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Controller
            name="interpreterRequired"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={field.value}
                    onChange={field.onChange}
                    sx={{ color: '#b8621a', '&.Mui-checked': { color: '#b8621a' } }}
                  />
                }
                label={<Typography fontFamily="Albert Sans, sans-serif" fontSize={14}>Interpreter Required</Typography>}
              />
            )}
          />
          {interpreterRequired && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Controller
                  name="interpreterLanguage"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth size="small">
                      <InputLabel>Interpreter Language</InputLabel>
                      <Select {...field} label="Interpreter Language">
                        <MenuItem value=""><em>Select language</em></MenuItem>
                        {INTERPRETER_LANGUAGES.map((language) => (
                          <MenuItem key={language} value={language} sx={sx}>{language}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                />
              </Grid>
              {interpreterLanguage === 'Other' && (
                <Grid size={{ xs: 12, sm: 6 }}><F name="interpreterLanguage" label="Specify Language" /></Grid>
              )}
            </Grid>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}

function StepContactAddress() {
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Contact & Address
      </Typography>
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Contact
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}><F name="phoneMobile" label="Mobile Phone" placeholder="04XX XXX XXX" maxLength={30} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><F name="phoneHome" label="Home Phone" maxLength={30} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><F name="emailPrimary" label="Email" type="email" maxLength={255} /></Grid>
      </Grid>
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Address
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6 }}><F name="addressStreet" label="Street Address" maxLength={255} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><F name="addressSuburb" label="Suburb" maxLength={100} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><F name="addressState" label="State" maxLength={30} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><F name="addressPostcode" label="Postcode" maxLength={10} /></Grid>
      </Grid>
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Next of Kin
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}><F name="nokName" label="Name" maxLength={200} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><F name="nokRelationship" label="Relationship" maxLength={100} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><F name="nokPhone" label="Phone" maxLength={30} /></Grid>
      </Grid>
    </Box>
  );
}

function StepIdentifiers() {
  const { control } = useFormContext<EditPatientFormData>();
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Identifiers & Cards
      </Typography>
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Medicare
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}><F name="medicareNumber" label="Medicare Number" placeholder="XXXX XXXXX X" maxLength={30} /></Grid>
        <Grid size={{ xs: 6, sm: 2 }}><F name="medicareIrn" label="IRN" placeholder="1–9" maxLength={10} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><F name="medicareExpiry" label="Medicare Expiry" type="date" shrink /></Grid>
      </Grid>
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        DVA (Department of Veterans&apos; Affairs)
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}><F name="dvaNumber" label="DVA Number" maxLength={30} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Controller
            name="dvaCardType"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth size="small">
                <InputLabel>DVA Card Type</InputLabel>
                <Select {...field} label="DVA Card Type">
                  <MenuItem value=""><em>None</em></MenuItem>
                  <MenuItem value="gold" sx={sx}>Gold — All Conditions</MenuItem>
                  <MenuItem value="white" sx={sx}>White — Specific Conditions</MenuItem>
                  <MenuItem value="orange" sx={sx}>Orange — Pharmaceutical Only</MenuItem>
                </Select>
              </FormControl>
            )}
          />
        </Grid>
      </Grid>
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Other Identifiers
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}><F name="ihi" label="IHI Number" placeholder="Individual Healthcare Identifier" maxLength={30} /></Grid>
      </Grid>
    </Box>
  );
}

function StepSupportPersons() {
  const { register, control, watch } = useFormContext<EditPatientFormData>();
  const { fields, append, remove } = useFieldArray({ control, name: 'supportPersons' });

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Support Persons
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Add or update next of kin, carers, guardians, and other support persons.
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => {
          const consentLevel = watch(`supportPersons.${index}.consentLevel`);
          return (
            <Paper key={field.id} elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle2" fontFamily="Albert Sans, sans-serif">Support Person {index + 1}</Typography>
                <IconButton
                  size="small"
                  aria-label={`Remove support person ${index + 1}`}
                  onClick={() => remove(index)}
                  color="error"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Box>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register(`supportPersons.${index}.givenName`)}
                    label="Given Name"
                    fullWidth
                    size="small"
                    inputProps={{ style: sx, maxLength: 100 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register(`supportPersons.${index}.familyName`)}
                    label="Family Name"
                    fullWidth
                    size="small"
                    inputProps={{ style: sx, maxLength: 100 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Controller
                    name={`supportPersons.${index}.relationship`}
                    control={control}
                    render={({ field: formField }) => (
                      <FormControl fullWidth size="small">
                        <InputLabel>Relationship</InputLabel>
                        <Select {...formField} label="Relationship">
                          <MenuItem value=""><em>Not specified</em></MenuItem>
                          {SUPPORT_RELATIONSHIPS.map((relationship) => (
                            <MenuItem key={relationship} value={relationship} sx={sx}>{relationship}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register(`supportPersons.${index}.phoneMobile`)}
                    label="Mobile Phone"
                    fullWidth
                    size="small"
                    type="tel"
                    inputProps={{ style: sx, maxLength: 30 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register(`supportPersons.${index}.phoneHome`)}
                    label="Home Phone"
                    fullWidth
                    size="small"
                    type="tel"
                    inputProps={{ style: sx, maxLength: 30 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register(`supportPersons.${index}.email`)}
                    label="Email"
                    type="email"
                    fullWidth
                    size="small"
                    inputProps={{ style: sx, maxLength: 255 }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Controller
                    name={`supportPersons.${index}.consentLevel`}
                    control={control}
                    render={({ field: formField }) => (
                      <FormControl fullWidth size="small">
                        <InputLabel>Consent to Share Information</InputLabel>
                        <Select {...formField} label="Consent to Share Information">
                          <MenuItem value=""><em>Not specified</em></MenuItem>
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
                      inputProps={{ style: sx, maxLength: 2000 }}
                    />
                  </Grid>
                )}
                <Grid size={{ xs: 12 }}>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <Controller
                      name={`supportPersons.${index}.isEmergencyContact`}
                      control={control}
                      render={({ field: formField }) => (
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={formField.value}
                              onChange={formField.onChange}
                              size="small"
                              sx={{ color: '#b8621a', '&.Mui-checked': { color: '#b8621a' } }}
                            />
                          }
                          label={<Typography fontSize={12} fontFamily="Albert Sans, sans-serif">Emergency Contact</Typography>}
                        />
                      )}
                    />
                    <Controller
                      name={`supportPersons.${index}.isCarer`}
                      control={control}
                      render={({ field: formField }) => (
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={formField.value}
                              onChange={formField.onChange}
                              size="small"
                              sx={{ color: '#b8621a', '&.Mui-checked': { color: '#b8621a' } }}
                            />
                          }
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
        onClick={() => append({
          _id: nextId(),
          givenName: '',
          familyName: '',
          relationship: '',
          phoneMobile: '',
          phoneHome: '',
          email: '',
          isEmergencyContact: false,
          isCarer: false,
          hasConsent: false,
          consentLevel: '' as const,
          consentNotes: '',
        })}
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
}

function StepProviders() {
  const { register, control, setValue, watch } = useFormContext<EditPatientFormData>();
  const { fields, append, remove } = useFieldArray({ control, name: 'providers' });
  const { data: nhsdStatus } = useNhsdStatus();
  const nhsdConfigured = nhsdStatus?.configured ?? false;
  const patientPostcode = watch('addressPostcode');

  type ProviderField = keyof PatientProvider;
  type ProviderFieldPath = `providers.${number}.${ProviderField}`;

  const setProviderField = <K extends ProviderField>(
    index: number,
    field: K,
    value: PatientProvider[K],
  ) => {
    const path = `providers.${index}.${field}` as ProviderFieldPath;
    setValue(path, value);
  };

  const handleSelectProvider = (provider: NhsdProvider, index: number) => {
    if (provider.givenName) setProviderField(index, 'firstName', provider.givenName);
    if (provider.familyName) setProviderField(index, 'lastName', provider.familyName);
    if (!provider.givenName && !provider.familyName && provider.name) {
      const parts = provider.name.trim().split(/\s+/);
      setProviderField(index, 'firstName', parts[0] ?? '');
      setProviderField(index, 'lastName', parts.slice(1).join(' '));
    }
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
        Add the patient&apos;s GP and other treating providers.
        {nhsdConfigured && ' Search the national directory to auto-fill details.'}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {fields.map((field, index) => (
          <Paper key={field.id} elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
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
                onSelect={(provider) => handleSelectProvider(provider, index)}
                postcode={patientPostcode}
                label="Search NHSD directory to auto-fill..."
              />
            )}

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Controller
                  name={`providers.${index}.role`}
                  control={control}
                  render={({ field: formField }) => (
                    <FormControl fullWidth size="small">
                      <InputLabel>Role / Specialty</InputLabel>
                      <Select {...formField} label="Role / Specialty">
                        {PROVIDER_ROLES.map((role) => (
                          <MenuItem key={role} value={role}>{role}</MenuItem>
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
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 100 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  {...register(`providers.${index}.lastName`)}
                  label="Last Name *"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 100 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.practiceName`)}
                  label="Practice Name"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 200 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.providerNumber`)}
                  label="Provider Number"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 30 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.addressStreet`)}
                  label="Street Address"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 200 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField
                  {...register(`providers.${index}.addressSuburb`)}
                  label="Suburb"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 100 }}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 1.5 }}>
                <TextField
                  {...register(`providers.${index}.addressState`)}
                  label="State"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 20 }}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 1.5 }}>
                <TextField
                  {...register(`providers.${index}.addressPostcode`)}
                  label="Postcode"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 10 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.phone`)}
                  label="Phone"
                  fullWidth
                  size="small"
                  type="tel"
                  inputProps={{ style: sx, maxLength: 30 }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  {...register(`providers.${index}.email`)}
                  label="Email"
                  type="email"
                  fullWidth
                  size="small"
                  inputProps={{ style: sx, maxLength: 255 }}
                />
              </Grid>
            </Grid>
          </Paper>
        ))}
      </Box>

      <Button
        startIcon={<AddIcon />}
        onClick={() => append({
          id: nextId(),
          role: 'General Practitioner',
          firstName: '',
          lastName: '',
          practiceName: '',
          addressStreet: '',
          addressSuburb: '',
          addressState: '',
          addressPostcode: '',
          phone: '',
          email: '',
          providerNumber: '',
        })}
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
}

function StepConsent() {
  const { control } = useFormContext<EditPatientFormData>();
  const items: { name: keyof EditPatientFormData; label: string; required?: boolean }[] = [
    { name: 'consentToTreatment', label: 'Patient consents to assessment and treatment by clinicians.', required: true },
    { name: 'consentForResearch', label: 'Patient consents to de-identified data being used for research purposes.' },
    { name: 'consentToShareWithGp', label: 'Patient consents to sharing information with their GP.' },
    { name: 'consentToShareWithCarer', label: 'Patient consents to sharing information with their carer / family.' },
  ];
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Consent
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Update the patient&apos;s consent preferences.
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {items.map((item) => (
          <Controller
            key={String(item.name)}
            name={item.name}
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!field.value}
                    onChange={field.onChange}
                    sx={{ color: '#b8621a', '&.Mui-checked': { color: '#b8621a' } }}
                  />
                }
                label={(
                  <Typography fontFamily="Albert Sans, sans-serif" fontSize={14}>
                    {item.label}
                    {item.required && <Typography component="span" color="error" sx={{ ml: 0.5 }}>*</Typography>}
                  </Typography>
                )}
              />
            )}
          />
        ))}
      </Box>
    </Box>
  );
}

export const STEPS = [
  { label: 'Demographics' },
  { label: 'Contact & Address' },
  { label: 'Identifiers' },
  { label: 'Support Persons' },
  { label: 'Providers' },
  { label: 'Funding' },
  { label: 'Consent' },
];

export const STEP_COMPONENTS = [
  StepDemographics,
  StepContactAddress,
  StepIdentifiers,
  StepSupportPersons,
  StepProviders,
  Step3Funding,
  StepConsent,
];
