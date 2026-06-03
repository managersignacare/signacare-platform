// apps/web/src/features/patients/components/registration/Step8Consent.tsx
import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import {
  Alert,
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  Typography,
} from '@mui/material';
import type { RegistrationWizardData } from '../../types/patientTypes';

interface ConsentItem {
  name: keyof Pick<
    RegistrationWizardData,
    | 'consentToTreatment'
    | 'consentForResearch'
    | 'consentToShareWithGp'
    | 'consentToShareWithCarer'
    | 'myHealthRecordOptOut'
  >;
  label: string;
  required?: boolean;
  isOptOut?: boolean;
}

const CONSENT_ITEMS: ConsentItem[] = [
  {
    name: 'consentToTreatment',
    label: 'Patient consents to assessment and treatment by clinicians.',
    required: true,
  },
  {
    name: 'consentForResearch',
    label: 'Patient consents to de-identified data being used for research purposes.',
  },
  {
    name: 'consentToShareWithGp',
    label: 'Patient consents to sharing information with their GP.',
  },
  {
    name: 'consentToShareWithCarer',
    label: 'Patient consents to sharing information with their carer / family.',
  },
  {
    name: 'myHealthRecordOptOut',
    label: 'Patient opts OUT of My Health Record upload.',
    isOptOut: true,
  },
];

export const Step8Consent: React.FC = () => {
  const {
    control,
    watch,
    formState: { errors },
  } = useFormContext<RegistrationWizardData>();

  const consentToTreatment = watch('consentToTreatment');

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Consent
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Record the patient&apos;s consent preferences. Consent to treatment is required to proceed.
      </Typography>

      {errors.consentToTreatment && (
        <Alert role="alert" severity="error" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
          Consent to treatment is required to register this patient.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {CONSENT_ITEMS.map((item) => (
          <React.Fragment key={item.name}>
            {item.isOptOut && <Divider sx={{ my: 1 }} />}
            <Controller
              name={item.name}
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={field.value}
                      onChange={field.onChange}
                      sx={{
                        color: item.isOptOut ? '#F0852C' : '#b8621a',
                        '&.Mui-checked': {
                          color: item.isOptOut ? '#F0852C' : '#b8621a',
                        },
                      }}
                    />
                  }
                  label={
                    <Typography fontFamily="Albert Sans, sans-serif" fontSize={14}>
                      {item.label}
                      {item.required && (
                        <Typography component="span" color="error" sx={{ ml: 0.5 }}>
                          *
                        </Typography>
                      )}
                      {item.isOptOut && (
                        <Typography
                          component="span"
                          fontSize={12}
                          color="#F0852C"
                          sx={{ ml: 1 }}
                        >
                          (Opt-out)
                        </Typography>
                      )}
                    </Typography>
                  }
                />
              )}
            />
          </React.Fragment>
        ))}
      </Box>

      {!consentToTreatment && (
        <Alert role="alert" severity="warning" sx={{ mt: 2, fontFamily: 'Albert Sans, sans-serif' }}>
          This patient record cannot be activated without consent to treatment.
        </Alert>
      )}
    </Box>
  );
};
