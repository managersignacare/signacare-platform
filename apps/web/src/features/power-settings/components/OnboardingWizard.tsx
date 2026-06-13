import { useState } from 'react';
import {
  Box, Typography, Stepper, Step, StepLabel, Button, TextField,
  MenuItem, Stack, Alert, CircularProgress, Chip, Card, CardContent,
  FormControlLabel, Checkbox, Divider, Grid,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import type { ProvisionClinicDTO, ProvisionResult } from '@signacare/shared';
import { powerSettingsKeys } from '../queryKeys';

const STEPS = [
  'Clinic Details',
  'Admin User',
  'Branding',
  'Modules',
  'Reference Data',
  'Subscription',
  'Review & Provision',
];

const DEFAULT_MODULES = [
  'patients', 'episodes', 'clinical_notes', 'medications',
  'appointments', 'tasks', 'reports', 'referrals',
  'billing', 'correspondence', 'pathways',
];
const HPIO_PATTERN = /^800362\d{10}$/;

function normalizeHpio(value: string): string {
  return value.trim().replace(/[\s-]+/g, '');
}

type ClinicType = ProvisionClinicDTO['clinicType'];
type AdminRole = ProvisionClinicDTO['adminRole'];
type PlanType = ProvisionClinicDTO['planType'];

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback;
  const maybeErr = err as {
    message?: unknown;
    response?: { data?: { error?: unknown; message?: unknown } };
  };
  if (typeof maybeErr.response?.data?.error === 'string' && maybeErr.response.data.error.trim()) return maybeErr.response.data.error;
  if (typeof maybeErr.response?.data?.message === 'string' && maybeErr.response.data.message.trim()) return maybeErr.response.data.message;
  if (typeof maybeErr.message === 'string' && maybeErr.message.trim()) return maybeErr.message;
  return fallback;
}

const ALL_MODULES = [
  { key: 'patients', label: 'Patient Management' },
  { key: 'episodes', label: 'Episode Management' },
  { key: 'clinical_notes', label: 'Clinical Notes' },
  { key: 'medications', label: 'Medications & Prescriptions' },
  { key: 'appointments', label: 'Appointments & Scheduling' },
  { key: 'referrals', label: 'Referral Management' },
  { key: 'tasks', label: 'Task Management' },
  { key: 'billing', label: 'Billing' },
  { key: 'reports', label: 'Reports & Analytics' },
  { key: 'correspondence', label: 'Correspondence & Letters' },
  { key: 'pathology', label: 'Pathology & Investigations' },
  { key: 'bed_board', label: 'Bed Board / Inpatient' },
  { key: 'mha', label: 'Mental Health Act / Legal' },
  { key: 'lai', label: 'LAI Management' },
  { key: 'clozapine', label: 'Clozapine Monitoring' },
  { key: 'medical-scribe', label: 'Medical Scribe (Ambient)' },
  { key: 'ai-agent', label: 'AI Agent' },
  { key: 'agentic-ai-scribe', label: 'Medical Scribe Drafting' },
  { key: 'group_therapy', label: 'Group Therapy' },
  { key: 'escalations', label: 'Escalations' },
  { key: 'shift_handover', label: 'Shift Handover' },
  { key: 'outcome_measures', label: 'Outcome Measures' },
  { key: 'risk_assessment', label: 'Risk Assessment' },
  { key: 'pathways', label: 'Treatment Pathways' },
];

export function OnboardingWizard() {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [copiedTempPassword, setCopiedTempPassword] = useState(false);

  // Form state
  const [form, setForm] = useState<Partial<ProvisionClinicDTO>>({
    clinicName: '',
    clinicType: 'solo_practice',
    hpio: '',
    timeZone: 'Australia/Melbourne',
    adminGivenName: '',
    adminFamilyName: '',
    adminEmail: '',
    adminProfileTabVisible: true,
    adminRole: 'admin',
    sidebarTitle: '',
    sidebarSubtitle: 'Mental Health EMR',
    enabledModules: [...DEFAULT_MODULES],
    seedDisciplines: true,
    seedClinicalRoles: true,
    seedMbsItems: true,
    seedReferralSources: true,
    seedAlertTypes: true,
    planType: 'trial',
    seats: 5,
    trialDays: 30,
  });

  const update = (patch: Partial<ProvisionClinicDTO>) => setForm({ ...form, ...patch });

  const provisionMut = useMutation({
    mutationFn: (dto: ProvisionClinicDTO) =>
      apiClient.post<ProvisionResult>('provisioning/provision', dto),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: powerSettingsKeys.clinicsList() });
      setResult(data);
      setCopiedTempPassword(false);
    },
  });

  const toggleModule = (key: string) => {
    const mods = form.enabledModules ?? [];
    if (mods.includes(key)) {
      update({ enabledModules: mods.filter((m) => m !== key) });
    } else {
      update({ enabledModules: [...mods, key] });
    }
  };

  const normalizedHpio = normalizeHpio(form.hpio ?? '');
  const hasHpioInput = (form.hpio ?? '').trim().length > 0;
  const isHpioValid = HPIO_PATTERN.test(normalizedHpio);

  const canNext = (): boolean => {
    if (step === 0) return !!form.clinicName && !!form.clinicType && isHpioValid;
    if (step === 1) return !!form.adminGivenName && !!form.adminFamilyName && !!form.adminEmail;
    return true;
  };

  const handleProvision = () => {
    const dto: ProvisionClinicDTO = {
      clinicName: form.clinicName!,
      clinicType: form.clinicType as ClinicType,
      hpio: normalizedHpio,
      timeZone: form.timeZone ?? 'Australia/Melbourne',
      legalName: form.legalName,
      abn: form.abn,
      phone: form.phone,
      email: form.email,
      addressStreet: form.addressStreet,
      addressSuburb: form.addressSuburb,
      addressState: form.addressState,
      addressPostcode: form.addressPostcode,
      adminGivenName: form.adminGivenName!,
      adminFamilyName: form.adminFamilyName!,
      adminEmail: form.adminEmail!,
      adminPhone: form.adminPhone,
      adminProfileTabVisible: form.adminProfileTabVisible ?? true,
      adminRole: (form.adminRole as AdminRole) ?? 'admin',
      sidebarTitle: form.sidebarTitle || form.clinicName,
      sidebarSubtitle: form.sidebarSubtitle,
      enabledModules: form.enabledModules ?? DEFAULT_MODULES,
      enabledSpecialties: form.enabledSpecialties ?? ['mental_health'],
      seedDisciplines: form.seedDisciplines ?? true,
      seedClinicalRoles: form.seedClinicalRoles ?? true,
      seedMbsItems: form.seedMbsItems ?? true,
      seedReferralSources: form.seedReferralSources ?? true,
      seedAlertTypes: form.seedAlertTypes ?? true,
      planType: (form.planType as PlanType) ?? 'trial',
      seats: form.seats ?? 5,
      trialDays: form.trialDays,
      notes: form.notes,
    };
    provisionMut.mutate(dto);
  };

  if (result) {
    return (
      <Box>
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold">
            Clinic provisioned successfully
          </Typography>
        </Alert>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Typography><strong>Clinic:</strong> {result.clinicName}</Typography>
              <Typography><strong>Clinic ID:</strong> <code>{result.clinicId}</code></Typography>
              <Divider />
              <Typography><strong>Admin Email:</strong> {result.adminEmail}</Typography>
              <Alert severity="warning" sx={{ mt: 1 }}>
                <Typography variant="body2"><strong>Temporary Password:</strong> <code>{result.adminTemporaryPassword}</code></Typography>
                <Typography variant="caption" display="block">
                  Share this with the admin securely. They must change it on first login. This password is shown only on this success screen.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ mt: 1 }}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(result.adminTemporaryPassword)
                      .then(() => setCopiedTempPassword(true))
                      .catch(() => setCopiedTempPassword(false));
                  }}
                >
                  Copy Password
                </Button>
                {copiedTempPassword && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                    Temporary password copied.
                  </Typography>
                )}
              </Alert>
              <Divider />
              <Typography><strong>Modules Enabled:</strong> {result.modulesEnabled.length}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {result.modulesEnabled.map((m) => <Chip key={m} label={m} size="small" />)}
              </Box>
              <Divider />
              <Typography variant="subtitle2">Reference Data Seeded</Typography>
              <Typography variant="body2">Disciplines: {result.referenceDataSeeded.disciplines}</Typography>
              <Typography variant="body2">Clinical Roles: {result.referenceDataSeeded.clinicalRoles}</Typography>
              <Typography variant="body2">MBS Items: {result.referenceDataSeeded.mbsItems}</Typography>
              <Typography variant="body2">Referral Sources: {result.referenceDataSeeded.referralSources}</Typography>
              <Typography variant="body2">Alert Types: {result.referenceDataSeeded.alertTypes}</Typography>
            </Stack>
          </CardContent>
        </Card>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => { setResult(null); setStep(0); setForm({ ...form, clinicName: '', adminEmail: '', hpio: '' }); }}>
          Provision Another Clinic
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Onboard New Subscriber</Typography>
      <Stepper activeStep={step} sx={{ mb: 3 }} alternativeLabel>
        {STEPS.map((label) => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {provisionMut.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(provisionMut.error, 'Provisioning failed. Check the details and try again.')}
        </Alert>
      )}

      {/* Step 0: Clinic Details */}
      {step === 0 && (
        <Stack spacing={2}>
          <TextField label="Clinic Name *" fullWidth size="small" value={form.clinicName} onChange={(e) => update({ clinicName: e.target.value })} />
          <TextField select label="Clinic Type *" fullWidth size="small" value={form.clinicType} onChange={(e) => update({ clinicType: e.target.value as ClinicType })}>
            <MenuItem value="solo_practice">Solo Practice (Individual Practitioner)</MenuItem>
            <MenuItem value="group_practice">Group Practice (Multiple Clinicians)</MenuItem>
            <MenuItem value="hospital">Small Private Hospital</MenuItem>
          </TextField>
          <TextField
            label="HPI-O *"
            fullWidth
            size="small"
            value={form.hpio ?? ''}
            onChange={(e) => update({ hpio: e.target.value })}
            error={hasHpioInput && !isHpioValid}
            helperText={hasHpioInput && !isHpioValid
              ? 'Enter a valid HPI-O: 16 digits starting with 800362 (spaces/hyphens allowed)'
              : '16 digits starting with 800362 (spaces/hyphens allowed)'}
          />
          <TextField label="Legal Name" fullWidth size="small" value={form.legalName ?? ''} onChange={(e) => update({ legalName: e.target.value })} />
          <TextField label="ABN" fullWidth size="small" value={form.abn ?? ''} onChange={(e) => update({ abn: e.target.value })} />
          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}><TextField label="Phone" fullWidth size="small" value={form.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Email" fullWidth size="small" value={form.email ?? ''} onChange={(e) => update({ email: e.target.value })} /></Grid>
          </Grid>
          <TextField label="Address" fullWidth size="small" value={form.addressStreet ?? ''} onChange={(e) => update({ addressStreet: e.target.value })} />
          <Grid container spacing={2}>
            <Grid size={{ xs: 4 }}><TextField label="Suburb" fullWidth size="small" value={form.addressSuburb ?? ''} onChange={(e) => update({ addressSuburb: e.target.value })} /></Grid>
            <Grid size={{ xs: 4 }}><TextField label="State" fullWidth size="small" value={form.addressState ?? ''} onChange={(e) => update({ addressState: e.target.value })} /></Grid>
            <Grid size={{ xs: 4 }}><TextField label="Postcode" fullWidth size="small" value={form.addressPostcode ?? ''} onChange={(e) => update({ addressPostcode: e.target.value })} /></Grid>
          </Grid>
          <TextField select label="Time Zone" fullWidth size="small" value={form.timeZone} onChange={(e) => update({ timeZone: e.target.value })}>
            <MenuItem value="Australia/Melbourne">Australia/Melbourne (AEST)</MenuItem>
            <MenuItem value="Australia/Sydney">Australia/Sydney (AEST)</MenuItem>
            <MenuItem value="Australia/Brisbane">Australia/Brisbane (AEST, no DST)</MenuItem>
            <MenuItem value="Australia/Perth">Australia/Perth (AWST)</MenuItem>
            <MenuItem value="Australia/Adelaide">Australia/Adelaide (ACST)</MenuItem>
            <MenuItem value="Australia/Darwin">Australia/Darwin (ACST, no DST)</MenuItem>
            <MenuItem value="Australia/Hobart">Australia/Hobart (AEST)</MenuItem>
          </TextField>
        </Stack>
      )}

      {/* Step 1: Admin User */}
      {step === 1 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Create the first administrator account for this clinic. A temporary password will be generated.
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}><TextField label="Given Name *" fullWidth size="small" value={form.adminGivenName} onChange={(e) => update({ adminGivenName: e.target.value })} /></Grid>
            <Grid size={{ xs: 6 }}><TextField label="Family Name *" fullWidth size="small" value={form.adminFamilyName} onChange={(e) => update({ adminFamilyName: e.target.value })} /></Grid>
          </Grid>
          <TextField label="Email *" fullWidth size="small" type="email" value={form.adminEmail} onChange={(e) => update({ adminEmail: e.target.value })} />
          <TextField label="Phone" fullWidth size="small" value={form.adminPhone ?? ''} onChange={(e) => update({ adminPhone: e.target.value })} />
          <FormControlLabel
            control={
              <Checkbox
                checked={form.adminProfileTabVisible ?? true}
                onChange={(_, checked) => update({ adminProfileTabVisible: checked })}
              />
            }
            label="Allow this admin to view Settings -> My Profile"
          />
          <TextField
            label="Role"
            fullWidth
            size="small"
            value="Admin (fixed for onboarding contact)"
            InputProps={{ readOnly: true }}
            helperText="The onboarding contact is created as the admin for this clinic."
          />
        </Stack>
      )}

      {/* Step 2: Branding */}
      {step === 2 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Configure sidebar branding. This can be updated later in Power Settings.
          </Typography>
          <TextField label="Sidebar Title" fullWidth size="small" value={form.sidebarTitle ?? form.clinicName} onChange={(e) => update({ sidebarTitle: e.target.value })} helperText="Displayed in the navigation sidebar" />
          <TextField label="Sidebar Subtitle" fullWidth size="small" value={form.sidebarSubtitle} onChange={(e) => update({ sidebarSubtitle: e.target.value })} />
        </Stack>
      )}

      {/* Step 3: Modules */}
      {step === 3 && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Select which modules to enable. The referral module is auto-selected based on clinic type.
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
            <Button size="small" variant="outlined" onClick={() => update({ enabledModules: ALL_MODULES.map((m) => m.key) })}>Select All</Button>
            <Button size="small" variant="outlined" onClick={() => update({ enabledModules: [...DEFAULT_MODULES] })}>Reset to Defaults</Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {ALL_MODULES.map((m) => {
              const enabled = (form.enabledModules ?? []).includes(m.key);
              return (
                <Chip
                  key={m.key}
                  label={m.label}
                  color={enabled ? 'primary' : 'default'}
                  variant={enabled ? 'filled' : 'outlined'}
                  onClick={() => toggleModule(m.key)}
                  sx={{ cursor: 'pointer' }}
                />
              );
            })}
          </Box>
          {form.clinicType === 'solo_practice' && (
            <Alert severity="info" sx={{ mt: 1 }}>Solo Referral Management will be auto-enabled based on clinic type.</Alert>
          )}
          {(form.clinicType === 'group_practice' || form.clinicType === 'hospital') && (
            <Alert severity="info" sx={{ mt: 1 }}>Team Referral Management will be auto-enabled based on clinic type.</Alert>
          )}
        </Stack>
      )}

      {/* Step 4: Reference Data */}
      {step === 4 && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Seed default reference data. All can be customised later in Power Settings.
          </Typography>
          <FormControlLabel control={<Checkbox checked={form.seedDisciplines} onChange={(e) => update({ seedDisciplines: e.target.checked })} />} label="Professional Disciplines (17 standard disciplines)" />
          <FormControlLabel control={<Checkbox checked={form.seedClinicalRoles} onChange={(e) => update({ seedClinicalRoles: e.target.checked })} />} label="Clinical Roles (22 standard roles)" />
          <FormControlLabel control={<Checkbox checked={form.seedMbsItems} onChange={(e) => update({ seedMbsItems: e.target.checked })} />} label="MBS Fee Schedule (23 psychiatry items — verify fees against MBS Online)" />
          <FormControlLabel control={<Checkbox checked={form.seedReferralSources} onChange={(e) => update({ seedReferralSources: e.target.checked })} />} label="Referral Sources (19 internal + external sources)" />
          <FormControlLabel control={<Checkbox checked={form.seedAlertTypes} onChange={(e) => update({ seedAlertTypes: e.target.checked })} />} label="Alert Types (12 standard types)" />
        </Stack>
      )}

      {/* Step 5: Subscription */}
      {step === 5 && (
        <Stack spacing={2}>
          <TextField select label="Plan Type" fullWidth size="small" value={form.planType} onChange={(e) => update({ planType: e.target.value as PlanType })}>
            <MenuItem value="trial">Trial</MenuItem>
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="annual">Annual</MenuItem>
          </TextField>
          <TextField label="Licensed Seats" fullWidth size="small" type="number" value={form.seats} onChange={(e) => update({ seats: parseInt(e.target.value, 10) || 1 })} />
          {form.planType === 'trial' && (
            <TextField label="Trial Days" fullWidth size="small" type="number" value={form.trialDays} onChange={(e) => update({ trialDays: parseInt(e.target.value, 10) || 30 })} />
          )}
          <TextField label="Notes" fullWidth size="small" multiline rows={2} value={form.notes ?? ''} onChange={(e) => update({ notes: e.target.value })} />
        </Stack>
      )}

      {/* Step 6: Review */}
      {step === 6 && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="subtitle2">Clinic</Typography>
              <Typography variant="body2">{form.clinicName} ({form.clinicType?.replace(/_/g, ' ')})</Typography>
              {form.abn && <Typography variant="body2">ABN: {form.abn}</Typography>}
              <Divider />
              <Typography variant="subtitle2">Admin</Typography>
              <Typography variant="body2">{form.adminGivenName} {form.adminFamilyName} ({form.adminEmail})</Typography>
              <Divider />
              <Typography variant="subtitle2">Modules ({(form.enabledModules ?? []).length})</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {(form.enabledModules ?? []).map((m) => <Chip key={m} label={m} size="small" />)}
              </Box>
              <Divider />
              <Typography variant="subtitle2">Reference Data</Typography>
              <Typography variant="body2">
                {[
                  form.seedDisciplines && 'Disciplines',
                  form.seedClinicalRoles && 'Clinical Roles',
                  form.seedMbsItems && 'MBS Items',
                  form.seedReferralSources && 'Referral Sources',
                  form.seedAlertTypes && 'Alert Types',
                ].filter(Boolean).join(', ') || 'None'}
              </Typography>
              <Divider />
              <Typography variant="subtitle2">Subscription</Typography>
              <Typography variant="body2">{form.planType} — {form.seats} seat(s){form.planType === 'trial' ? ` (${form.trialDays} days)` : ''}</Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
        <Button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button variant="contained" disabled={!canNext()} onClick={() => setStep(step + 1)}>Next</Button>
        ) : (
          <Button
            variant="contained"
            color="success"
            disabled={provisionMut.isPending}
            startIcon={provisionMut.isPending ? <CircularProgress size={16} /> : undefined}
            onClick={handleProvision}
          >
            {provisionMut.isPending ? 'Provisioning...' : 'Provision Clinic'}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
