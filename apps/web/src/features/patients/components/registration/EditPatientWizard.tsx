// apps/web/src/features/patients/components/registration/EditPatientWizard.tsx
import React, { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
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
import { useQueryClient } from '@tanstack/react-query';
import type { PatientResponse, UpdatePatientDTO } from '@signacare/shared';
import { useUpdatePatient } from '../../hooks/useUpdatePatient';
import { FUNDING_TYPES } from '../../types/patientTypes';
import type { PatientProvider } from '../../types/patientTypes';
import { apiClient } from '../../../../services/apiClient';
import { patientsKeys } from '../../queryKeys';
import { SignacareApiError } from '../../../../shared/services/apiClient';
import { STEPS, STEP_COMPONENTS } from './EditPatientWizardSteps';
import type {
  ContactRecord,
  EditPatientFormData,
  ProviderRecord,
  SupportPerson,
} from './EditPatientWizard.types';

const nextId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

interface EditPatientWizardProps {
  open: boolean;
  onClose: () => void;
  patient: PatientResponse & Record<string, unknown>;
  patientId: string;
}

export const EditPatientWizard: React.FC<EditPatientWizardProps> = ({ open, onClose, patient, patientId }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const update = useUpdatePatient(patientId);
  const queryClient = useQueryClient();
  const p = patient as Partial<EditPatientFormData> & PatientResponse;

  const methods = useForm<EditPatientFormData>({
    defaultValues: {
      givenName:            p.givenName             ?? '',
      familyName:           p.familyName            ?? '',
      preferredName:        p.preferredName         ?? '',
      dateOfBirth:          p.dateOfBirth           ?? '',
      gender:               p.gender                ?? '',
      pronouns:             p.pronouns              ?? '',
      atsiStatus:           p.atsiStatus            ?? '',
      interpreterRequired:  p.interpreterRequired   ?? false,
      interpreterLanguage:  p.interpreterLanguage   ?? '',
      phoneMobile:          p.phoneMobile           ?? '',
      phoneHome:            p.phoneHome             ?? '',
      emailPrimary:         p.emailPrimary          ?? '',
      addressStreet:        p.addressStreet         ?? '',
      addressSuburb:        p.addressSuburb         ?? '',
      addressState:         p.addressState          ?? '',
      addressPostcode:      p.addressPostcode       ?? '',
      medicareNumber:       p.medicareNumber        ?? '',
      medicareIrn:          p.medicareIrn           ?? '',
      medicareExpiry:       p.medicareExpiry        ?? '',
      ihi:                  p.ihi                   ?? '',
      dvaNumber:            p.dvaNumber             ?? '',
      dvaCardType:          p.dvaCardType           ?? '',
      supportPersons:       [],
      providers:            p.gpName
                              ? [{
                                  id: crypto.randomUUID(),
                                  role: 'General Practitioner',
                                  firstName: p.gpName.split(/\s+/)[0] ?? '',
                                  lastName: p.gpName.split(/\s+/).slice(1).join(' '),
                                  practiceName: p.gpPractice ?? '',
                                  addressStreet: p.gpAddressStreet ?? '',
                                  addressSuburb: p.gpAddressSuburb ?? '',
                                  addressState: p.gpAddressState ?? '',
                                  addressPostcode: p.gpAddressPostcode ?? '',
                                  phone: p.gpPhone ?? '',
                                  email: p.gpEmail ?? '',
                                  providerNumber: p.gpProviderNumber ?? '',
                                }]
                              : [],
      gpName:               p.gpName               ?? '',
      gpPractice:           p.gpPractice            ?? '',
      gpProviderNumber:     p.gpProviderNumber      ?? '',
      gpPhone:              p.gpPhone               ?? '',
      gpEmail:              p.gpEmail               ?? '',
      gpFax:                p.gpFax                 ?? '',
      gpAddressStreet:      p.gpAddressStreet       ?? '',
      gpAddressSuburb:      p.gpAddressSuburb       ?? '',
      gpAddressState:       p.gpAddressState        ?? '',
      gpAddressPostcode:    p.gpAddressPostcode     ?? '',
      nokName:              p.nokName               ?? '',
      nokRelationship:      p.nokRelationship       ?? '',
      nokPhone:             p.nokPhone              ?? '',
      healthFundName:       p.healthFundName        ?? '',
      healthFundNumber:     p.healthFundNumber      ?? '',
      fundingSources:       p.healthFundName
                              ? [{ id: crypto.randomUUID(), type: 'private', details: p.healthFundNumber ?? '', expiryDate: '', isPrimary: true }]
                              : [],
      consentToTreatment:   p.consentToTreatment    ?? false,
      consentForResearch:   p.consentForResearch    ?? false,
      consentToShareWithGp: p.consentToShareWithGp  ?? false,
      consentToShareWithCarer: p.consentToShareWithCarer ?? false,
    },
  });

  // Load existing support persons
  useEffect(() => {
    if (!open) return;
    setContactsLoading(true);
    Promise.all([
      apiClient.get<{ contacts: ContactRecord[] }>(`patients/${patientId}/contacts`),
      apiClient.get<{ providers: ProviderRecord[] }>(`patients/${patientId}/providers`),
    ])
      .then(([contactsData, providersData]) => {
        const contacts: SupportPerson[] = (contactsData.contacts ?? []).map((c) => ({
          _id: nextId(),
          _existingId: c.id,
          givenName: c.givenName ?? '',
          familyName: c.familyName ?? '',
          relationship: c.relationship ?? '',
          phoneMobile: c.phoneMobile ?? '',
          phoneHome: c.phoneHome ?? '',
          email: c.email ?? '',
          isEmergencyContact: c.isEmergencyContact ?? false,
          isCarer: c.isCarer ?? false,
          hasConsent: c.hasConsent ?? false,
          consentLevel: c.hasConsent ? (c.consentLevel ?? 'full') : '',
          consentNotes: c.consentNotes ?? '',
        }));
        methods.setValue('supportPersons', contacts);

        const providers: PatientProvider[] = (providersData.providers ?? []).map((r) => {
          const name = (r.providerName ?? '').trim();
          const [firstName = '', ...last] = name ? name.split(/\s+/) : [];
          const addressParts = (r.providerAddress ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
          return {
            id: r.id ?? nextId(),
            role: r.providerType || (r.isPrimary ? 'General Practitioner' : 'Other'),
            firstName,
            lastName: last.join(' '),
            practiceName: r.providerPractice ?? '',
            addressStreet: addressParts[0] ?? '',
            addressSuburb: addressParts[1] ?? '',
            addressState: addressParts[2] ?? '',
            addressPostcode: addressParts[3] ?? '',
            phone: r.providerPhone ?? '',
            email: r.providerEmail ?? '',
            providerNumber: r.providerNumber ?? '',
          };
        });
        if (providers.length > 0) {
          methods.setValue('providers', providers);
        }
      })
      .catch((err) => { console.warn('EditPatientWizard: contacts/providers fetch failed', err); })
      .finally(() => setContactsLoading(false));
  }, [open, patientId]);

  const isLastStep = activeStep === STEPS.length - 1;
  const StepComponent = STEP_COMPONENTS[activeStep];

  const handleNext = () => {
    if (isLastStep) void handleSave();
    else setActiveStep(s => s + 1);
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      const values = methods.getValues();

      // 1. Patch patient fields
      const dto: UpdatePatientDTO = Object.fromEntries(
        Object.entries(values)
          .filter(([k]) => k !== 'supportPersons' && k !== 'fundingSources' && k !== 'providers')
          .map(([k, v]) => [k, v === '' ? undefined : v])
      ) as UpdatePatientDTO & { healthFundName?: string; healthFundNumber?: string };

      const normalizedProviders = values.providers
        .map((provider) => ({
          role: provider.role.trim(),
          firstName: provider.firstName.trim(),
          lastName: provider.lastName.trim(),
          practiceName: provider.practiceName.trim(),
          addressStreet: provider.addressStreet.trim(),
          addressSuburb: provider.addressSuburb.trim(),
          addressState: provider.addressState.trim(),
          addressPostcode: provider.addressPostcode.trim(),
          phone: provider.phone.trim(),
          email: provider.email.trim(),
          providerNumber: provider.providerNumber.trim(),
        }))
        .filter((provider) => (
          provider.firstName.length > 0
          || provider.lastName.length > 0
          || provider.practiceName.length > 0
          || provider.addressStreet.length > 0
          || provider.addressSuburb.length > 0
          || provider.addressState.length > 0
          || provider.addressPostcode.length > 0
          || provider.phone.length > 0
          || provider.email.length > 0
          || provider.providerNumber.length > 0
        ));

      const gpProvider = normalizedProviders.find((provider) => {
        const role = provider.role.toLowerCase();
        return role.includes('general practitioner') || role === 'gp';
      }) ?? normalizedProviders[0];
      if (gpProvider && (gpProvider.firstName || gpProvider.lastName)) {
        dto.gpName = [gpProvider.firstName, gpProvider.lastName].filter(Boolean).join(' ');
        dto.gpPractice = gpProvider.practiceName || undefined;
        dto.gpPhone = gpProvider.phone || undefined;
        dto.gpEmail = gpProvider.email || undefined;
        dto.gpProviderNumber = gpProvider.providerNumber || undefined;
        dto.gpAddressStreet = gpProvider.addressStreet || undefined;
        dto.gpAddressSuburb = gpProvider.addressSuburb || undefined;
        dto.gpAddressState = gpProvider.addressState || undefined;
        dto.gpAddressPostcode = gpProvider.addressPostcode || undefined;
      }
      // Map primary funding source to flat fields
      const primaryFunding = values.fundingSources?.find(f => f.isPrimary) ?? values.fundingSources?.[0];
      if (primaryFunding) {
        const label = FUNDING_TYPES.find(ft => ft.value === primaryFunding.type)?.label ?? primaryFunding.type;
        dto.healthFundName = label;
        dto.healthFundNumber = primaryFunding.details || undefined;
      }
      await update.mutateAsync(dto);

      // 2. Sync support persons via apiClient (uses cookies + CSRF automatically)
      const existing = await apiClient.get<{ contacts: ContactRecord[] }>(`patients/${patientId}/contacts`);
      await Promise.all(
        (existing.contacts ?? []).map((c) =>
          apiClient.delete(`patients/contacts/${c.id}`)
        )
      );
      await Promise.all(
        values.supportPersons
          .map((sp) => ({
            givenName: sp.givenName.trim(),
            familyName: sp.familyName.trim(),
            relationship: sp.relationship.trim(),
            phoneMobile: sp.phoneMobile.trim(),
            phoneHome: sp.phoneHome.trim(),
            email: sp.email.trim(),
            isEmergencyContact: sp.isEmergencyContact,
            isCarer: sp.isCarer,
            hasConsent: Boolean(sp.consentLevel),
            consentLevel: sp.consentLevel || undefined,
            consentNotes: sp.consentNotes.trim(),
          }))
          .filter((sp) => {
            const hasText =
              sp.givenName.length > 0 ||
              sp.familyName.length > 0 ||
              sp.relationship.length > 0 ||
              sp.phoneMobile.length > 0 ||
              sp.phoneHome.length > 0 ||
              sp.email.length > 0 ||
              sp.consentNotes.length > 0;
            return hasText || sp.isEmergencyContact || sp.isCarer || sp.hasConsent;
          })
          .map((sp, index) => {
            if (!sp.givenName || !sp.familyName) {
              throw new Error(`Support Person ${index + 1}: Given Name and Family Name are required.`);
            }
            return apiClient.post(`patients/${patientId}/contacts`, {
              contactType: 'support_person',
              givenName: sp.givenName,
              familyName: sp.familyName,
              relationship: sp.relationship || undefined,
              phoneMobile: sp.phoneMobile || undefined,
              phoneHome: sp.phoneHome || undefined,
              email: sp.email || undefined,
              isEmergencyContact: sp.isEmergencyContact,
              isCarer: sp.isCarer,
              hasConsent: sp.hasConsent,
              consentLevel: sp.consentLevel,
              consentNotes: sp.consentNotes || undefined,
            });
          })
      );

      // 3. Sync providers (registration/edit parity: both support multi-provider)
      const existingProviders = await apiClient.get<{ providers: Array<{ id: string }> }>(`patients/${patientId}/providers`);
      await Promise.all(
        (existingProviders.providers ?? []).map((provider) =>
          apiClient.delete(`patients/providers/${provider.id}`)
        )
      );
      await Promise.all(
        normalizedProviders.map((provider, index) => {
          if (!provider.firstName || !provider.lastName) {
            throw new Error(`Provider ${index + 1}: First Name and Last Name are required.`);
          }
          const providerName = [provider.firstName, provider.lastName].filter(Boolean).join(' ');
          return apiClient.post(`patients/${patientId}/providers`, {
            providerType: provider.role || 'General Practitioner',
            providerName,
            providerPractice: provider.practiceName || undefined,
            providerPhone: provider.phone || undefined,
            providerEmail: provider.email || undefined,
            providerNumber: provider.providerNumber || undefined,
            providerAddress: [provider.addressStreet, provider.addressSuburb, provider.addressState, provider.addressPostcode]
              .filter(Boolean)
              .join(', ') || undefined,
            isPrimary: index === 0,
          });
        }),
      );

      void queryClient.invalidateQueries({ queryKey: patientsKeys.contactsAlt(patientId) });
      void queryClient.invalidateQueries({ queryKey: patientsKeys.providers(patientId) });
      void queryClient.invalidateQueries({ queryKey: patientsKeys.detail(patientId) });
      onClose();
    } catch (err: unknown) {
      if (err instanceof SignacareApiError && err.code === 'VALIDATION_ERROR') {
        const details = err.details as unknown;
        if (Array.isArray(details) && details.length > 0) {
          const first = details[0] as { field?: unknown; message?: unknown };
          if (typeof first.message === 'string' && first.message.length > 0) {
            if (typeof first.field === 'string' && first.field.length > 0) {
              setSaveError(`${first.field}: ${first.message}`);
              return;
            }
            setSaveError(first.message);
            return;
          }
        }
        if (details && typeof details === 'object') {
          const obj = details as Record<string, unknown>;
          const field = typeof obj.field === 'string' ? obj.field : null;
          const maxLength = typeof obj.maxLength === 'number' ? obj.maxLength : null;
          if (field && maxLength) {
            setSaveError(`Field "${field}" exceeds maximum length (${maxLength} characters).`);
            return;
          }
        }
      }
      setSaveError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    }
  };

  const handleClose = () => {
    methods.reset();
    setActiveStep(0);
    setSaveError(null);
    onClose();
  };

  const isSaving = update.isPending;

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={handleClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3, fontFamily: 'Albert Sans, sans-serif' } }}>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, fontSize: 20, color: '#3D484B', pb: 1 }}>
        Edit Patient Details
      </DialogTitle>
      <Divider />

      <Box sx={{ px: 3, pt: 3 }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {STEPS.map((step, idx) => (
            <Step key={step.label} completed={idx < activeStep}>
              <StepLabel
                StepIconProps={{ sx: { '&.Mui-active': { color: '#b8621a' }, '&.Mui-completed': { color: '#327C8D' } } }}
                onClick={() => setActiveStep(idx)}
                sx={{ cursor: 'pointer' }}
              >
                <Typography fontSize={11} fontFamily="Albert Sans, sans-serif">{step.label}</Typography>
              </StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <DialogContent sx={{ pt: 3, pb: 2, minHeight: 380 }}>
        <FormProvider {...methods}>
          {saveError && (
            <Alert
              severity={saveError.includes('uplicate') || saveError.includes('already exists') ? 'warning' : 'error'}
              sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}
              onClose={() => setSaveError(null)}
            >
              {saveError.includes('uplicate') || saveError.includes('already exists')
                ? 'A patient with similar details already exists. Please check the patient list before creating a new record.'
                : saveError}
            </Alert>
          )}
          {activeStep === 3 && contactsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
              <CircularProgress role="progressbar" aria-label="Loading" sx={{ color: '#b8621a' }} />
            </Box>
          ) : (
            <StepComponent />
          )}
        </FormProvider>
      </DialogContent>

      <Divider />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 3, py: 2 }}>
        <Button onClick={handleClose} variant="text" sx={{ fontFamily: 'Albert Sans, sans-serif', color: 'text.secondary' }}>
          Cancel
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {activeStep > 0 && (
            <Button
              onClick={() => setActiveStep(s => s - 1)}
              variant="outlined"
              sx={{ fontFamily: 'Albert Sans, sans-serif', borderColor: '#3D484B', color: '#3D484B' }}
            >
              Back
            </Button>
          )}
          <Button
            onClick={handleNext}
            variant="contained"
            disabled={isSaving}
            sx={{ fontFamily: 'Albert Sans, sans-serif', bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, minWidth: 120 }}
          >
            {isSaving ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : isLastStep ? 'Save Changes' : 'Next'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};
