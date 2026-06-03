// apps/web/src/features/patients/components/registration/Step1Demographics.tsx
import { Controller, useFormContext } from 'react-hook-form';
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { INTERPRETER_LANGUAGES, type RegistrationWizardData } from '../../types/patientTypes';

const GENDER_OPTIONS = [
  { value: 'male',              label: 'Male' },
  { value: 'female',            label: 'Female' },
  { value: 'nonbinary',         label: 'Non-binary' },
  { value: 'genderqueer',       label: 'Genderqueer' },
  { value: 'transgendermale',   label: 'Transgender Male' },
  { value: 'transgenderfemale', label: 'Transgender Female' },
  { value: 'prefernottosay',    label: 'Prefer not to say' },
  { value: 'other',             label: 'Other' },
];

const ATSI_OPTIONS = [
  { value: 'aboriginal',    label: 'Aboriginal' },
  { value: 'torresstrait',  label: 'Torres Strait Islander' },
  { value: 'both',          label: 'Both Aboriginal and Torres Strait Islander' },
  { value: 'neither',       label: 'Neither' },
  { value: 'prefernottosay', label: 'Prefer not to say' },
];

const sx = { fontFamily: 'Albert Sans, sans-serif' };

function getAustralianPhoneWarning(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, '');
  const digits = normalized.startsWith('+') ? `+${normalized.slice(1).replace(/\D/g, '')}` : normalized.replace(/\D/g, '');
  const isMobile = /^(\+?61|0)4\d{8}$/.test(digits);
  const isLandline = /^(\+?61|0)[2378]\d{8}$/.test(digits);
  return isMobile || isLandline
    ? null
    : 'Warning: this does not look like a standard Australian phone number.';
}

export const Step1Demographics: React.FC = () => {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<RegistrationWizardData>();

  const interpreterRequired = watch('interpreterRequired');
  const interpreterLanguage = watch('interpreterLanguage');
  const phoneMobile = watch('phoneMobile');
  const phoneHome = watch('phoneHome');
  const phoneMobileWarning = getAustralianPhoneWarning(phoneMobile);
  const phoneHomeWarning = getAustralianPhoneWarning(phoneHome);

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Demographics
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <TextField
            {...register('givenName')}
            label="Given Name *"
            fullWidth
            size="small"
            // WCAG SC 1.3.5 — Identify Input Purpose
            autoComplete="given-name"
            error={Boolean(errors.givenName)}
            helperText={errors.givenName?.message}
            inputProps={{ style: sx, maxLength: 100 }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <TextField
            {...register('familyName')}
            label="Family Name *"
            fullWidth
            size="small"
            autoComplete="family-name"
            error={Boolean(errors.familyName)}
            helperText={errors.familyName?.message}
            inputProps={{ style: sx, maxLength: 100 }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <TextField
            {...register('preferredName')}
            label="Preferred Name"
            fullWidth
            size="small"
            autoComplete="nickname"
            inputProps={{ style: sx, maxLength: 100 }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <TextField
            {...register('dateOfBirth')}
            label="Date of Birth *"
            type="date"
            fullWidth
            size="small"
            autoComplete="bday"
            error={Boolean(errors.dateOfBirth)}
            helperText={errors.dateOfBirth?.message ?? 'DD-MM-YYYY'}
            slotProps={{ inputLabel: { shrink: true } }}
            inputProps={{ style: sx }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <Controller
            name="gender"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth size="small">
                <InputLabel>Gender</InputLabel>
                <Select {...field} label="Gender" sx={{ minWidth: 200 }}>
                  {GENDER_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value} sx={sx}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
                {errors.gender && (
                  <FormHelperText error>{errors.gender.message}</FormHelperText>
                )}
              </FormControl>
            )}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <TextField
            {...register('pronouns')}
            label="Pronouns"
            fullWidth
            size="small"
            placeholder="e.g. they/them"
            inputProps={{ style: sx, maxLength: 50 }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <Controller
            name="atsiStatus"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth size="small">
                <InputLabel>Aboriginal / Torres Strait Islander Status</InputLabel>
                <Select {...field} label="Aboriginal / Torres Strait Islander Status" sx={{ minWidth: 320 }}>
                  {ATSI_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value} sx={sx}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...register('phoneMobile')}
            label="Primary Phone"
            fullWidth
            size="small"
            placeholder="04XX XXX XXX"
            // WCAG SC 1.3.5 — Identify Input Purpose (tel is the canonical token)
            autoComplete="tel"
            type="tel"
            helperText={phoneMobileWarning ?? ' '}
            slotProps={{ formHelperText: { sx: { color: phoneMobileWarning ? 'warning.main' : 'text.disabled' } } }}
            inputProps={{ style: sx, maxLength: 30 }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...register('phoneHome')}
            label="Home Phone"
            fullWidth
            size="small"
            autoComplete="tel"
            type="tel"
            helperText={phoneHomeWarning ?? ' '}
            slotProps={{ formHelperText: { sx: { color: phoneHomeWarning ? 'warning.main' : 'text.disabled' } } }}
            inputProps={{ style: sx, maxLength: 30 }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...register('localUrNumber')}
            label="Local UR Number"
            fullWidth
            size="small"
            inputProps={{ style: sx, maxLength: 50 }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...register('statewideUrNumber')}
            label="Statewide UR Number"
            fullWidth
            size="small"
            inputProps={{ style: sx, maxLength: 50 }}
          />
        </Grid>

        {/* Interpreter */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
                  label={
                    <Typography fontFamily="Albert Sans, sans-serif" fontSize={14}>
                      Interpreter Required
                    </Typography>
                  }
                />
              )}
            />
            {interpreterRequired && (
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Controller
                    name="interpreterLanguage"
                    control={control}
                    render={({ field }) => (
                      <FormControl fullWidth size="small">
                        <InputLabel>Interpreter Language</InputLabel>
                        <Select {...field} label="Interpreter Language">
                          {INTERPRETER_LANGUAGES.map((lang) => (
                            <MenuItem key={lang} value={lang} sx={sx}>
                              {lang}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>
                {interpreterLanguage === 'Other' && (
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      {...register('interpreterLanguageOther')}
                      label="Specify Language"
                      fullWidth
                      size="small"
                      placeholder="Enter language"
                      inputProps={{ style: sx }}
                    />
                  </Grid>
                )}
              </Grid>
            )}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};
