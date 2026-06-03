// apps/web/src/features/patients/components/registration/PatientRegistrationWizard.tsx
import React, { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCreatePatient } from '../../hooks/useCreatePatient';
import { useCheckDuplicatePatients } from '../../hooks/useCheckDuplicatePatients';
import { apiClient, SignacareApiError } from '../../../../shared/services/apiClient';
import type { CreatePatientDTO } from '@signacare/shared';
import { WIZARD_DEFAULT_DATA, type RegistrationWizardData } from '../../types/patientTypes';
import { Step1Demographics } from './Step1Demographics';
import { Step2Identifiers } from './Step2Identifiers';
import { Step3Funding } from './Step3Funding';
import { Step6SupportPersons } from './Step6SupportPersons';
import { Step7Providers } from './Step7Providers';
import { StepAttachments } from './StepAttachments';
import { Step8Consent } from './Step8Consent';
import { DuplicatePatientModal } from '../duplicateDetection/DuplicatePatientModal';
import type { DuplicatePatientDisplay } from '../../types/duplicateTypes';
import { patientsKeys } from '../../queryKeys';

const STEPS = [
  { label: 'Demographics',    schema: z.object({ givenName: z.string().min(1, 'Required'), familyName: z.string().min(1, 'Required'), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'), interpreterRequired: z.boolean() }) },
  { label: 'Identifiers',     schema: z.object({}) },
  { label: 'Funding',         schema: z.object({}) },
  { label: 'Support Persons', schema: z.object({}) },
  { label: 'Providers',       schema: z.object({}) },
  { label: 'Attachments',    schema: z.object({}) },
  { label: 'Consent',         schema: z.object({ consentToTreatment: z.boolean().refine((v) => v === true, 'Consent to treatment is required') }) },
];

const STEP_COMPONENTS = [
  Step1Demographics,
  Step2Identifiers,
  Step3Funding,
  Step6SupportPersons,
  Step7Providers,
  StepAttachments,
  Step8Consent,
];

interface PatientRegistrationWizardProps {
  open: boolean;
  onClose: () => void;
}

export const PatientRegistrationWizard: React.FC<PatientRegistrationWizardProps> = ({
  open,
  onClose,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [duplicates, setDuplicates] = useState<DuplicatePatientDisplay[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const methods = useForm<RegistrationWizardData>({
    defaultValues: WIZARD_DEFAULT_DATA,
    mode: 'onTouched',
  });

  const createPatient = useCreatePatient();
  const checkDuplicates = useCheckDuplicatePatients();

  const StepComponent = STEP_COMPONENTS[activeStep];
  const isLastStep = activeStep === STEPS.length - 1;

  const createErrorMessage = (() => {
    const err = createPatient.error;
    if (!err) return 'Failed to register patient. Please try again.';
    if (err instanceof SignacareApiError) {
      if (err.code === 'DUPLICATE_PATIENT') {
        return 'Potential duplicate patient detected. Please review existing records before creating a new one.';
      }
      if (err.code === 'VALIDATION_ERROR') {
        const details = err.details as unknown;
        if (Array.isArray(details) && details.length > 0) {
          const first = details[0] as { field?: unknown; message?: unknown };
          if (typeof first.message === 'string' && first.message.length > 0) {
            if (typeof first.field === 'string' && first.field.length > 0) {
              return `${first.field}: ${first.message}`;
            }
            return first.message;
          }
        }
        return err.message || 'Patient details failed validation. Please review required fields.';
      }
      if (err.code === 'INTERNAL_ERROR') {
        return `Internal server error (HTTP ${err.status}, code ${err.code}). Check API logs for the exact root cause.`;
      }
      return err.message || 'Failed to register patient. Please try again.';
    }
    if (err instanceof Error && err.message) return err.message;
    return 'Failed to register patient. Please try again.';
  })();

  const handleNext = async () => {
    const stepSchema = STEPS[activeStep].schema;
    const values = methods.getValues();
    const result = stepSchema.safeParse(values);

    if (!result.success) {
      result.error.errors.forEach((err) => {
        const path = err.path.join('.') as keyof RegistrationWizardData;
        methods.setError(path, { message: err.message });
      });
      return;
    }

    // Pre-flight duplicate-patient check after Step 1 (Demographics)
    // commits — surfaces probable/strong/definite candidates BEFORE the
    // clinician fills steps 2-7. Per BUG-447-FOLLOWUP-WIZARD-PREFLIGHT-
    // DUPLICATE-CHECK: backend service-layer guard (patientService.create
    // throws 409 on definite/strong) is the structural defence; this
    // pre-flight is the UX layer that lets the clinician pick the
    // existing record (or knowingly continue) without filling 8 steps
    // first.
    if (activeStep === 0 && !showDuplicates) {
      try {
        const response = await checkDuplicates.mutateAsync({
          givenName: values.givenName,
          familyName: values.familyName,
          dateOfBirth: values.dateOfBirth,
          medicareNumber: values.medicareNumber || null,
          ihiNumber: values.ihiNumber || null,
          dvaNumber: values.dvaNumber || null,
          phoneMobile: values.phoneMobile || null,
          addressLine1: values.addressStreet || null,
          postcode: values.addressPostcode || null,
        });
        if (response.candidates.length > 0) {
          setDuplicates(response.candidates.map((c) => c.patient));
          setShowDuplicates(true);
          return;
        }
      } catch (err) {
        // Network or 4xx failure on pre-flight: log + advance anyway.
        // The backend create will still block on definite/strong
        // matches at submission time (HTTP 409), so the structural
        // safety net is intact even if pre-flight is unavailable.
        if (import.meta.env.DEV) {
          console.warn('[PatientWizard] Duplicate pre-flight check failed; advancing without warning:', (err as Error)?.message);
        }
      }
    }

    if (isLastStep) {
      await handleSubmit();
    } else {
      setActiveStep((s) => s + 1);
    }
  };

  const handleSubmit = async () => {
    const values = methods.getValues();
    try {
      const dto: CreatePatientDTO = {
        givenName: values.givenName,
        familyName: values.familyName,
        dateOfBirth: values.dateOfBirth,
      };
      // Demographics
      if (values.preferredName) dto.preferredName = values.preferredName;
      if (values.gender) dto.gender = values.gender;
      if (values.pronouns) dto.pronouns = values.pronouns;
      // Audit Tier 9.3 (HIGH-A1) — typed access (all 23 `as any` casts
      // removed). RegistrationWizardData now declares every optional
      // field the wizard reads, so the DTO build compiles under strict
      // TypeScript with no escape hatch.
      if (values.atsiStatus) dto.atsiStatus = values.atsiStatus;
      if (values.indigenousStatus && !dto.atsiStatus) dto.atsiStatus = values.indigenousStatus;
      if (values.interpreterRequired) dto.interpreterRequired = values.interpreterRequired;
      if (values.interpreterLanguage) dto.interpreterLanguage = values.interpreterLanguage;
      // Contact
      if (values.phoneMobile) dto.phoneMobile = values.phoneMobile;
      if (values.phoneHome) dto.phoneHome = values.phoneHome;
      if (values.emailPrimary) dto.emailPrimary = values.emailPrimary;
      // Address
      if (values.addressStreet) dto.addressStreet = values.addressStreet;
      if (values.addressSuburb) dto.addressSuburb = values.addressSuburb;
      if (values.addressState) dto.addressState = values.addressState;
      if (values.addressPostcode) dto.addressPostcode = values.addressPostcode;
      // Identifiers
      if (values.medicareNumber) dto.medicareNumber = values.medicareNumber;
      if (values.medicareReference) dto.medicareIrn = values.medicareReference;
      if (values.medicareExpiry) dto.medicareExpiry = values.medicareExpiry;
      if (values.ihiNumber) dto.ihi = values.ihiNumber;
      if (values.dvaNumber) dto.dvaNumber = values.dvaNumber;
      if (values.dvaCardType) dto.dvaCardType = values.dvaCardType;
      // GP details
      if (values.gpName) dto.gpName = values.gpName;
      if (values.gpPractice) dto.gpPractice = values.gpPractice;
      if (values.gpPhone) dto.gpPhone = values.gpPhone;
      if (values.gpEmail) dto.gpEmail = values.gpEmail;
      if (values.gpProviderNumber) dto.gpProviderNumber = values.gpProviderNumber;
      // Next of kin
      if (values.nokName) dto.nokName = values.nokName;
      if (values.nokRelationship) dto.nokRelationship = values.nokRelationship;
      if (values.nokPhone) dto.nokPhone = values.nokPhone;
      // Consent
      if (values.consentToTreatment !== undefined) dto.consentToTreatment = values.consentToTreatment;
      if (values.consentForResearch !== undefined) dto.consentForResearch = values.consentForResearch;
      if (values.consentToShareWithGp !== undefined) dto.consentToShareWithGp = values.consentToShareWithGp;
      if (values.consentToShareWithCarer !== undefined) dto.consentToShareWithCarer = values.consentToShareWithCarer;
      // Funding — map primary funding source to flat fields
      const primaryFunding = values.fundingSources?.find(f => f.isPrimary) ?? values.fundingSources?.[0];
      if (primaryFunding?.type) {
        dto.healthFundName = primaryFunding.type;
        if (primaryFunding.details) dto.healthFundNumber = primaryFunding.details;
      }

      const patient = await createPatient.mutateAsync(dto);
      const patientId = patient.id;

      // Save support persons (contacts)
      const supportPersons = values.supportPersons ?? [];
      for (const sp of supportPersons) {
        const givenName = sp.givenName?.trim() ?? '';
        const familyName = sp.familyName?.trim() ?? '';
        if (!givenName || !familyName) continue;
        const consentLevel = sp.consentLevel || undefined;
        await apiClient.post(`patients/${patientId}/contacts`, {
          contactType: 'support_person',
          givenName,
          familyName,
          relationship: sp.relationship ?? '',
          phoneMobile: sp.phoneMobile ?? '',
          phoneHome: sp.phoneHome ?? '',
          email: sp.email ?? '',
          isEmergencyContact: sp.isEmergencyContact ?? false,
          isCarer: sp.isCarer ?? false,
          hasConsent: Boolean(consentLevel),
          consentLevel,
          consentNotes: sp.consentNotes ?? '',
        }).catch((err) => { console.error('[PatientWizard] Contact save failed:', err?.response?.data?.error ?? err?.message); });
      }

      // Save providers (GP, specialists) + copy GP to patient record
      const providers = values.providers ?? [];
      const gpProvider = providers.find(p => (p.role || 'General Practitioner').toLowerCase().includes('general practitioner'));
      if (gpProvider && (gpProvider.firstName || gpProvider.lastName)) {
        const gpName = [gpProvider.firstName, gpProvider.lastName].filter(Boolean).join(' ');
        try {
          await apiClient.patch(`patients/${patientId}`, {
            gpName,
            gpPractice: gpProvider.practiceName ?? null,
            gpPhone: gpProvider.phone ?? null,
            gpEmail: gpProvider.email ?? null,
            gpProviderNumber: gpProvider.providerNumber ?? null,
            gpAddressStreet: gpProvider.addressStreet ?? null,
            gpAddressSuburb: gpProvider.addressSuburb ?? null,
            gpAddressState: gpProvider.addressState ?? null,
            gpAddressPostcode: gpProvider.addressPostcode ?? null,
          });
        } catch (err: unknown) {
          console.error('[PatientWizard] GP sync to patient failed:', err instanceof Error ? err.message : String(err));
        }
      }
      for (const prov of providers) {
        if (!prov.firstName && !prov.lastName) continue;
        const fullName = [prov.firstName, prov.lastName].filter(Boolean).join(' ');
        const address = [prov.addressStreet, prov.addressSuburb, prov.addressState, prov.addressPostcode].filter(Boolean).join(', ');
        await apiClient.post(`patients/${patientId}/providers`, {
          providerType: prov.role || 'General Practitioner',
          providerName: fullName,
          providerPractice: prov.practiceName ?? '',
          providerPhone: prov.phone ?? '',
          providerEmail: prov.email ?? '',
          providerNumber: prov.providerNumber ?? '',
          providerAddress: address || null,
          isPrimary: false,
        }).catch((err) => { console.error('[PatientWizard] Provider save failed:', err?.response?.data?.error ?? err?.message); });
      }

      // Invalidate patient list so newly registered patient appears
      void queryClient.invalidateQueries({ queryKey: patientsKeys.all });
      void queryClient.invalidateQueries({ queryKey: patientsKeys.contactsAlt(patientId) });
      void queryClient.invalidateQueries({ queryKey: patientsKeys.providers(patientId) });

      onClose();
      navigate(`/patients/${patientId}`);
    } catch (err) {
      if (import.meta.env.DEV) console.error('[PatientWizard] Registration failed:', (err as Error)?.message);
    }
  };

  const handleBack = () => setActiveStep((s) => Math.max(0, s - 1));

  const handleClose = () => {
    methods.reset();
    setActiveStep(0);
    onClose();
  };

  return (
    <>
      <Dialog aria-labelledby="dialog-title"
        open={open}
        onClose={handleClose}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3, fontFamily: 'Albert Sans, sans-serif' } }}
      >
        <DialogTitle
          id="dialog-title"
          sx={{
            fontFamily: 'Albert Sans, sans-serif',
            fontWeight: 700,
            fontSize: 20,
            color: '#3D484B',
            pb: 1,
          }}
        >
          Register New Patient
        </DialogTitle>
        <Divider />

        <Box sx={{ px: 3, pt: 3 }}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {STEPS.map((step, idx) => (
              <Step key={step.label} completed={idx < activeStep}>
                <StepLabel
                  StepIconProps={{
                    sx: {
                      '&.Mui-active': { color: '#b8621a' },
                      '&.Mui-completed': { color: '#327C8D' },
                    },
                  }}
                >
                  <Typography fontSize={11} fontFamily="Albert Sans, sans-serif">
                    {step.label}
                  </Typography>
                </StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>

        <DialogContent sx={{ pt: 3, pb: 2, minHeight: 400 }}>
          <FormProvider {...methods}>
            {createPatient.isError && (
              <Alert role="alert" severity="error" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
                {createErrorMessage}
              </Alert>
            )}
            <StepComponent />
          </FormProvider>
        </DialogContent>

        <Divider />
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
          }}
        >
          <Button
            onClick={handleClose}
            variant="text"
            sx={{ fontFamily: 'Albert Sans, sans-serif', color: 'text.secondary' }}
          >
            Cancel
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {activeStep > 0 && (
              <Button
                onClick={handleBack}
                variant="outlined"
                sx={{
                  fontFamily: 'Albert Sans, sans-serif',
                  borderColor: '#3D484B',
                  color: '#3D484B',
                }}
              >
                Back
              </Button>
            )}
            <Button
              onClick={() => void handleNext()}
              variant="contained"
              disabled={createPatient.isPending || checkDuplicates.isPending}
              sx={{
                fontFamily: 'Albert Sans, sans-serif',
                bgcolor: '#b8621a',
                '&:hover': { bgcolor: '#d6741f' },
                minWidth: 120,
              }}
            >
              {createPatient.isPending || checkDuplicates.isPending ? (
                <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} />
              ) : isLastStep ? (
                'Register Patient'
              ) : (
                'Next'
              )}
            </Button>
          </Box>
        </Box>
      </Dialog>

      <DuplicatePatientModal
        open={showDuplicates}
        duplicates={duplicates}
        onContinue={() => {
          // Clinician acknowledged the warning and chose to continue
          // registering a new patient. Advance from Step 1 (Demographics
          // — where the pre-flight check fired) to the next step rather
          // than submitting immediately; the wizard's normal flow takes
          // over from here. The backend service-layer guard at
          // patientService.create() is still the final structural
          // defence — definite/strong matches blocked with HTTP 409.
          setShowDuplicates(false);
          setActiveStep((s) => s + 1);
        }}
        onClose={() => setShowDuplicates(false)}
      />
    </>
  );
};
