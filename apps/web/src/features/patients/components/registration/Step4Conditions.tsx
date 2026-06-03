// apps/web/src/features/patients/components/registration/Step4Conditions.tsx
import { Controller, useFormContext } from 'react-hook-form';
import {
  Box,
  Checkbox,
  FormControlLabel,
  Grid,
  Typography,
} from '@mui/material';
import { HEALTH_CONDITIONS_LIST, type RegistrationWizardData } from '../../types/patientTypes';

export const Step4Conditions: React.FC = () => {
  const { control } = useFormContext<RegistrationWizardData>();

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Health Conditions
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Select all conditions that apply. This list can be updated at any time.
      </Typography>

      <Controller
        name="healthConditions"
        control={control}
        render={({ field }) => (
          <Grid container spacing={0.5}>
            {HEALTH_CONDITIONS_LIST.map((condition) => {
              const checked = field.value.includes(condition);
              return (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={condition}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={checked}
                        size="small"
                        onChange={(e) => {
                          if (e.target.checked) {
                            field.onChange([...field.value, condition]);
                          } else {
                            field.onChange(field.value.filter((c) => c !== condition));
                          }
                        }}
                        sx={{ color: '#327C8D', '&.Mui-checked': { color: '#327C8D' } }}
                      />
                    }
                    label={
                      <Typography fontSize={13} fontFamily="Albert Sans, sans-serif">
                        {condition}
                      </Typography>
                    }
                  />
                </Grid>
              );
            })}
          </Grid>
        )}
      />
    </Box>
  );
};
