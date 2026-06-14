import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/services/apiClient'
import { powerSettingsKeys } from '../queryKeys'
import { RoleTypeEnum, SubscriberBrandingUpdateSchema } from '@signacare/shared'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  AlertColor,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '../../../shared/store/authStore'
import {
  useAllBranding,
  useAllClinics,
  useUpsertBranding,
} from '../hooks/usePowerSettings'
import type { SubscriberBranding } from '../services/powerSettingsApi'
import { LookupListPanel } from '../../staff-settings/components/LookupListPanel'
import { ReferralSourcesPanel } from '../../staff-settings/components/ReferralSourcesPanel'
import { RetentionPanel } from '../components/RetentionPanel'
import { SessionIdlePanel } from '../components/SessionIdlePanel'
import { templateApi } from '../../templates/services/templateApi'
import { templateKeys } from '../../templates/queryKeys'
import {
  useDisciplines,
  useCreateDiscipline,
  useUpdateDiscipline,
  useDeleteDiscipline,
  useClinicalRoles,
  useCreateClinicalRole,
  useUpdateClinicalRole,
  useDeleteClinicalRole,
  useInvestigationTypes,
  useCreateInvestigationType,
  useUpdateInvestigationType,
  useDeleteInvestigationType,
} from '../../staff-settings/hooks/useStaffSettings'
import { IntegrationStatusPanel } from '../../settings/components/IntegrationStatusPanel'
import { CmiPanel } from '../../settings/components/CmiPanel'
import { EmailPrintPanel, AiTrainingContextPanel } from '../../settings/pages/SettingsPage'
import AiTrainingModulePanel from '../../settings/components/AiTrainingModule'
import WorkflowBuilderSettingsPanel from '../../settings/components/WorkflowBuilderPanel'
import { FeeSchedulePanel as FeeSchedulePanelLazy } from '../../billing/components/FeeSchedulePanel'
import { ClinicianFeePanel as ClinicianFeePanelLazy } from '../../billing/components/ClinicianFeePanel'
import { OnboardingWizard } from '../components/OnboardingWizard'
import { PowerLevelLabelsPanel } from '../components/PowerLevelLabelsPanel'
import { AccessAdminsPanel } from '../components/PowerAccessAdminsPanel'
import { PowerAiRuntimePanel } from '../components/PowerAiRuntimePanel'
import { ClinicalNoteTemplatesPanel } from '../components/ClinicalNoteTemplatesPanel'
import { ALL_MODULES } from './powerSettingsPageSupport'
import { ModuleAccessMatrix as AccessControlPanel } from '../../staff-settings/components/ModuleAccessMatrix'
import AuditPage from '../../audit/pages/AuditPage'
import type {
  LookupUpdatePayload,
  AlertTypeRow,
  LegalOrderTypeRow,
  AppointmentModeRow,
  TemplateCategoryRow,
  EpisodeTypeRow,
  ClinicOption,
} from './powerSettingsPageSupport'
import { BackupPanel, ClinicalPoliciesPanel } from '../../settings/pages/SettingsPage'

const DEFAULT_DISABLED_MODULE_KEYS = new Set<string>([
  'agentic-ai-scribe',
])

const BrandingFormSchema = SubscriberBrandingUpdateSchema

type BrandingForm = z.infer<typeof BrandingFormSchema>
type TabId = 'onboarding' | 'branding' | 'level-labels' | 'disciplines' | 'roles' | 'role-types' | 'system-roles' | 'referral-sources' | 'investigation-types' | 'alert-types' | 'legal-order-types' | 'appointment-modes' | 'template-categories' | 'clinical-note-templates' | 'episode-types' | 'clinical-policies' | 'workflow-builder' | 'access-control' | 'audit-log' | 'backup-settings' | 'integrations' | 'email-print' | 'cmi' | 'ai-context' | 'ai-training' | 'ai-runtime' | 'subscriptions' | 'specialties' | 'fee-schedules' | 'clinician-fees' | 'access-admins' | 'retention' | 'session-idle'

export const PowerSettingsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = React.useState<TabId>('branding')

  if (user?.role !== 'superadmin') {
    return (
      <Box p={3}>
        <Alert role="alert" severity="error">
          Access denied. Only the Platform Owner can access Power Settings.
        </Alert>
      </Box>
    )
  }

  return (
    <Box p={3}>
      <Typography variant="h5" mb={0.5}>
        Power Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Platform-level configuration. Manage branding, role catalogues, clinical policies, workflow builder, access control, audit log, and backup settings. Reference data seeded during clinic onboarding stays editable here through the catalogue tabs such as Professional Disciplines, Clinical Roles, Referral Sources, Investigation Types, Alert Types, Appointment Modes, Template Categories, and Episode Types.
      </Typography>
      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v: TabId) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
        <Tab label="Onboard Clinic" value="onboarding" />
        <Tab label="Branding" value="branding" />
        <Tab label="Org Level Labels" value="level-labels" />
        <Tab label="Professional Disciplines" value="disciplines" />
        <Tab label="Clinical Roles" value="roles" />
        <Tab label="Role Types" value="role-types" />
        <Tab label="System Roles" value="system-roles" />
        <Tab label="Referral Sources" value="referral-sources" />
        <Tab label="Investigation Types" value="investigation-types" />
        <Tab label="Alert Types" value="alert-types" />
        <Tab label="Legal Order Types" value="legal-order-types" />
        <Tab label="Appointment Modes" value="appointment-modes" />
        <Tab label="Template Categories" value="template-categories" />
        <Tab label="Clinical Note Templates" value="clinical-note-templates" />
        <Tab label="Episode Types" value="episode-types" />
        <Tab label="Clinical Policies" value="clinical-policies" />
        <Tab label="Workflow Builder" value="workflow-builder" />
        <Tab label="Access Control" value="access-control" />
        <Tab label="Audit Log" value="audit-log" />
        <Tab label="Backup Settings" value="backup-settings" />
        <Tab label="Integrations" value="integrations" />
        <Tab label="Email & Print" value="email-print" />
        <Tab label="CMI Reporting" value="cmi" />
        <Tab label="AI Training Context" value="ai-context" />
        <Tab label="AI Training Module" value="ai-training" />
        <Tab label="AI Runtime" value="ai-runtime" />
        <Tab label="Fee Schedules" value="fee-schedules" />
        <Tab label="Clinician Fees" value="clinician-fees" />
        <Tab label="Subscriptions" value="subscriptions" />
        <Tab label="Clinical Specialties" value="specialties" />
        <Tab label="Access Administrators" value="access-admins" />
        <Tab label="Data Retention" value="retention" />
        <Tab label="Session Idle Timeout" value="session-idle" />
      </Tabs>
      <Divider sx={{ mb: 3 }} />
      {tab === 'onboarding' && <OnboardingWizard />}
      {tab === 'branding' && <BrandingPanel />}
      {tab === 'level-labels' && <PowerLevelLabelsPanel />}
      {tab === 'disciplines' && <DisciplinesPanel />}
      {tab === 'roles' && <ClinicalRolesPanel />}
      {tab === 'role-types' && <RoleTypesPanel />}
      {tab === 'system-roles' && <SystemRolesPanel />}
      {tab === 'referral-sources' && <ReferralSourcesPanel />}
      {tab === 'investigation-types' && <InvestigationTypesPanel />}
      {tab === 'alert-types' && <AlertTypesPanel />}
      {tab === 'legal-order-types' && <LegalOrderTypesPanel />}
      {tab === 'appointment-modes' && <AppointmentModesPanel />}
      {tab === 'template-categories' && <TemplateCategoriesPanel />}
      {tab === 'clinical-note-templates' && <ClinicalNoteTemplatesPanel />}
      {tab === 'episode-types' && <EpisodeTypesPanel />}
      {tab === 'clinical-policies' && <ClinicalPoliciesPanel />}
      {tab === 'workflow-builder' && <WorkflowBuilderSettingsPanel />}
      {tab === 'access-control' && <AccessControlPanel variant="tab" />}
      {tab === 'audit-log' && <AuditPage />}
      {tab === 'backup-settings' && <BackupPanel />}
      {tab === 'integrations' && <IntegrationStatusPanel />}
      {tab === 'email-print' && <EmailPrintPanel />}
      {tab === 'cmi' && <CmiPanel />}
      {tab === 'ai-context' && <AiTrainingContextPanel />}
      {tab === 'ai-training' && <AiTrainingModulePanel />}
      {tab === 'ai-runtime' && <PowerAiRuntimePanel />}
      {tab === 'fee-schedules' && <FeeSchedulePanelLazy />}
      {tab === 'clinician-fees' && <ClinicianFeePanelLazy />}
      {tab === 'subscriptions' && <SubscriptionModulePanel />}
      {tab === 'specialties' && <ClinicalSpecialtyPanel />}
      {tab === 'access-admins' && <AccessAdminsPanel />}
      {tab === 'retention' && (
        <RetentionPanel clinicId={user.clinicId} isSuperadmin={user.role === 'superadmin'} />
      )}
      {tab === 'session-idle' && (
        <SessionIdlePanel clinicId={user.clinicId} isSuperadmin={user.role === 'superadmin'} />
      )}
    </Box>
  )
}

// --- Branding Panel (extracted) ---
function BrandingPanel() {
  const user = useAuthStore((s) => s.user)
  const { data: clinics, isLoading: clinicsLoading } = useAllClinics()
  const { data: allBranding, isLoading: brandingLoading } = useAllBranding()
  const { mutateAsync: upsert, isPending } = useUpsertBranding()
  const [selectedClinicId, setSelectedClinicId] = React.useState('')
  const [success, setSuccess] = React.useState(false)
  const [uploadNotice, setUploadNotice] = React.useState<string | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [isUploadingLogo, setIsUploadingLogo] = React.useState(false)

  const { register, handleSubmit, reset, setValue, clearErrors, getValues, watch, formState: { errors } } = useForm<BrandingForm>({
    resolver: zodResolver(BrandingFormSchema),
  })

  React.useEffect(() => {
    if (!selectedClinicId || !allBranding) { reset({ sidebarTitle: '', sidebarSubtitle: '', logoUrl: '' }); return }
    const existing = allBranding.find((b: SubscriberBranding) => b.clinicId === selectedClinicId)
    reset(existing ? { sidebarTitle: existing.sidebarTitle, sidebarSubtitle: existing.sidebarSubtitle, logoUrl: existing.logoUrl } : { sidebarTitle: '', sidebarSubtitle: '', logoUrl: '' })
    setUploadNotice(null)
    setUploadError(null)
    setSuccess(false)
  }, [selectedClinicId, allBranding, reset])

  React.useEffect(() => { if (clinics?.length && !selectedClinicId) setSelectedClinicId(clinics[0].id) }, [clinics, selectedClinicId])

  const onSubmit = async (values: BrandingForm) => {
    setSuccess(false)
    setUploadNotice(null)
    setUploadError(null)
    await upsert({ clinicId: selectedClinicId, data: values })
    setSuccess(true)
  }
  const isLoading = clinicsLoading || brandingLoading
  const logoPreviewUrl = watch('logoUrl')
  const uploadNoticeSeverity: AlertColor = isUploadingLogo ? 'info' : 'success'

  if (isLoading) return <Box display="flex" justifyContent="center" py={6}><CircularProgress role="progressbar" aria-label="Loading" /></Box>

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" mb={2}>Subscriber Sidebar Branding</Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Set a custom title, subtitle, and logo for each subscriber&apos;s sidebar navigation.
        </Typography>
        <TextField select label="Select Subscriber (Clinic)" fullWidth size="small" value={selectedClinicId} onChange={(e) => setSelectedClinicId(e.target.value)} sx={{ mb: 3 }}>
          {clinics?.map((c) => (<MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>))}
        </TextField>
        {selectedClinicId && user?.clinicId && selectedClinicId !== user.clinicId && (
          <Alert severity="info" sx={{ mb: 2 }}>
            You are editing branding for another clinic. The sidebar in this session shows your current login clinic branding.
          </Alert>
        )}
        {selectedClinicId && (
          <Box component="form" onSubmit={handleSubmit(onSubmit)}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField label="Sidebar Title" fullWidth size="small" placeholder="e.g. ClinicName" error={!!errors.sidebarTitle} helperText={errors.sidebarTitle?.message || 'Main text at top of sidebar'} {...register('sidebarTitle')} />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField label="Sidebar Subtitle" fullWidth size="small" placeholder="e.g. Mental Health EMR" error={!!errors.sidebarSubtitle} helperText={errors.sidebarSubtitle?.message || 'Secondary text below title'} {...register('sidebarSubtitle')} />
              </Grid>
              <Grid size={{ xs: 12, md: 8 }}>
                <TextField label="Logo URL" fullWidth size="small" placeholder="https://example.com/logo.png or /uploads/logos/your-logo.png" error={!!errors.logoUrl} helperText={errors.logoUrl?.message || 'Logo image URL (absolute URL) or local upload path (/uploads/...).'} {...register('logoUrl')} />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Button
                  variant="outlined"
                  component="label"
                  fullWidth
                  disabled={isUploadingLogo || isPending}
                  startIcon={isUploadingLogo ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : undefined}
                  sx={{ height: 40, textTransform: 'none', borderColor: '#b8621a', color: '#b8621a' }}
                >
                  {isUploadingLogo ? 'Uploading Logo...' : 'Upload Logo File'}
                  <input type="file" hidden accept=".png,.jpg,.jpeg,.svg,.webp" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!selectedClinicId) {
                      setUploadError('Select a clinic before uploading a logo.')
                      return;
                    }
                    setUploadError(null)
                    setUploadNotice(`Uploading "${file.name}"...`)
                    setSuccess(false)
                    setIsUploadingLogo(true)
                    const formData = new FormData();
                    formData.append('logo', file);
                    try {
                      const resp = await apiClient.instance.post('power-settings/branding/logo', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                      });
                      const logoUrl = resp.data?.url ?? resp.data?.data?.url;
                      if (!logoUrl || typeof logoUrl !== 'string') {
                        setUploadError('Upload succeeded but no logo URL was returned.')
                        return;
                      }
                      setValue('logoUrl', logoUrl, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                      clearErrors('logoUrl')
                      setUploadNotice(`Logo uploaded. Saving branding for clinic...`)
                      const nextValues = { ...getValues(), logoUrl }
                      await upsert({ clinicId: selectedClinicId, data: nextValues })
                      setSuccess(true)
                      setUploadNotice(`Logo "${file.name}" uploaded and branding saved successfully.`)
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : 'Unknown error'
                      setUploadError(`Logo upload/save failed: ${msg}`)
                    } finally {
                      setIsUploadingLogo(false)
                    }
                  }} />
                </Button>
              </Grid>
              {logoPreviewUrl && (
                <Grid size={{ xs: 12 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Current logo preview
                  </Typography>
                  <Box
                    component="img"
                    src={logoPreviewUrl}
                    alt="Branding logo preview"
                    sx={{ maxHeight: 64, maxWidth: 220, objectFit: 'contain', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5, bgcolor: '#fff' }}
                    onError={() => setUploadError('Logo URL is set but the image could not be loaded. Please verify file upload and URL accessibility.')}
                  />
                </Grid>
              )}
            </Grid>
            {uploadNotice && <Alert severity={uploadNoticeSeverity} sx={{ mt: 2 }}>{uploadNotice}</Alert>}
            {uploadError && <Alert severity="error" sx={{ mt: 2 }}>{uploadError}</Alert>}
            {success && <Alert severity="success" sx={{ mt: 2 }}>Branding saved successfully.</Alert>}
            <Box mt={3} display="flex" justifyContent="flex-end">
              <Button type="submit" variant="contained" disabled={isPending || isUploadingLogo || !selectedClinicId} startIcon={isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : undefined}>Save Branding</Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

// --- Disciplines Panel ---
function DisciplinesPanel() {
  const { data, isLoading } = useDisciplines()
  const { mutateAsync: create } = useCreateDiscipline()
  const { mutateAsync: update } = useUpdateDiscipline()
  const { mutateAsync: remove } = useDeleteDiscipline()

  return (
    <LookupListPanel
      title="Professional Disciplines"
      description="Manage professional disciplines (e.g. Psychology, Medical, Nursing, Social Work, Pharmacy, Dietitian, Exercise Physiology). These appear as dropdown options when configuring staff profiles."
      items={data}
      isLoading={isLoading}
      onCreate={async (name) => { await create({ name }) }}
      onUpdate={async (id, data) => { await update({ id, data }) }}
      onDelete={async (id) => { await remove(id) }}
    />
  )
}

// --- Clinical Roles Panel ---
function ClinicalRolesPanel() {
  const { data, isLoading } = useClinicalRoles()
  const { mutateAsync: create } = useCreateClinicalRole()
  const { mutateAsync: update } = useUpdateClinicalRole()
  const { mutateAsync: remove } = useDeleteClinicalRole()

  return (
    <LookupListPanel
      title="Clinical Roles"
      description="Manage clinical roles (e.g. Key Clinician, Psychiatrist, Psychiatry Registrar, Manager, Director, Lead Consultant). These are assigned to staff per team."
      items={data}
      isLoading={isLoading}
      onCreate={async (name) => { await create({ name }) }}
      onUpdate={async (id, data) => { await update({ id, data }) }}
      onDelete={async (id) => { await remove(id) }}
    />
  )
}

// --- Investigation Types Panel ---
function InvestigationTypesPanel() {
  const { data, isLoading } = useInvestigationTypes()
  const { mutateAsync: create } = useCreateInvestigationType()
  const { mutateAsync: update } = useUpdateInvestigationType()
  const { mutateAsync: remove } = useDeleteInvestigationType()

  return (
    <LookupListPanel
      title="Investigation Types"
      description="Manage pathology and investigation types (e.g. FBC, LFT, CT Head, ECG). These appear as dropdown options when uploading pathology reports."
      items={data}
      isLoading={isLoading}
      onCreate={async (name) => { await create({ name }) }}
      onUpdate={async (id, data) => { await update({ id, data }) }}
      onDelete={async (id) => { await remove(id) }}
    />
  )
}

// --- Alert Types Panel ---
function AlertTypesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: powerSettingsKeys.staffSettingsAlertTypes(),
    queryFn: () => apiClient.get<{ types: AlertTypeRow[] }>('staff-settings/alert-types').then(r => r.types),
  })
  const qc = useQueryClient()
  const createMut = useMutation({ mutationFn: (d: { name: string }) => apiClient.post('staff-settings/alert-types', { ...d, severity: 'medium', color: '#F0852C' }), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsAlertTypes() }) })
  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: LookupUpdatePayload }) =>
      apiClient.patch(`staff-settings/alert-types/${id}`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsAlertTypes() }),
  })
  const deleteMut = useMutation({ mutationFn: (id: string) => apiClient.delete(`staff-settings/alert-types/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsAlertTypes() }) })

  return (
    <LookupListPanel
      title="Alert Types"
      description="Manage alert types with severity levels and management plan templates. These appear as dropdown options when adding patient alerts (e.g. Aggression Risk, Suicide Risk, Home Visit Alert)."
      items={data?.map((t: AlertTypeRow) => ({ id: t.id, name: `${t.name} (${t.severity})`, isActive: t.isActive ?? true, sortOrder: t.sortOrder ?? 0 })) ?? []}
      isLoading={isLoading}
      onCreate={async (name) => { await createMut.mutateAsync({ name }) }}
      onUpdate={async (id, d) => { await updateMut.mutateAsync({ id, data: d }) }}
      onDelete={async (id) => { await deleteMut.mutateAsync(id) }}
    />
  )
}

// --- Legal Order Types Panel ---
function LegalOrderTypesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: powerSettingsKeys.staffSettingsLegalOrderTypes(),
    queryFn: () => apiClient.get<{ types: LegalOrderTypeRow[] }>('staff-settings/legal-order-types').then(r => r.types),
  })
  const qc = useQueryClient()
  const createMut = useMutation({ mutationFn: (d: { name: string }) => apiClient.post('staff-settings/legal-order-types', { ...d, category: 'other' }), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsLegalOrderTypes() }) })
  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: LookupUpdatePayload }) =>
      apiClient.patch(`staff-settings/legal-order-types/${id}`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsLegalOrderTypes() }),
  })
  const deleteMut = useMutation({ mutationFn: (id: string) => apiClient.delete(`staff-settings/legal-order-types/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsLegalOrderTypes() }) })

  return (
    <LookupListPanel
      title="Legal Order Types"
      description="Manage legal order types for the Legal tab. Includes MH Act orders, forensic orders, guardianship, and other statutory instruments."
      items={data?.map((t: LegalOrderTypeRow) => ({ id: t.id, name: `${t.name} [${t.category}]`, isActive: t.isActive ?? true, sortOrder: t.sortOrder ?? 0 })) ?? []}
      isLoading={isLoading}
      onCreate={async (name) => { await createMut.mutateAsync({ name }) }}
      onUpdate={async (id, d) => { await updateMut.mutateAsync({ id, data: d }) }}
      onDelete={async (id) => { await deleteMut.mutateAsync(id) }}
    />
  )
}

// --- Appointment Modes Panel ---
function AppointmentModesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: powerSettingsKeys.staffSettingsAppointmentModes(),
    queryFn: () => apiClient.get<{ modes: AppointmentModeRow[] }>('staff-settings/appointment-modes').then(r => r.modes),
  })
  const qc = useQueryClient()
  const createMut = useMutation({ mutationFn: (d: { name: string }) => apiClient.post('staff-settings/appointment-modes', d), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsAppointmentModes() }) })
  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: LookupUpdatePayload }) =>
      apiClient.patch(`staff-settings/appointment-modes/${id}`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsAppointmentModes() }),
  })
  const deleteMut = useMutation({ mutationFn: (id: string) => apiClient.delete(`staff-settings/appointment-modes/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.staffSettingsAppointmentModes() }) })
  return (
    <LookupListPanel title="Appointment Modes" description="Manage appointment delivery modes (e.g. In Person, Telehealth, Home Visit). These appear as options when creating appointments."
      items={data?.map((t: AppointmentModeRow) => ({ id: t.id, name: t.name, isActive: t.isActive ?? true, sortOrder: t.sortOrder ?? 0 })) ?? []}
      isLoading={isLoading} onCreate={async (name) => { await createMut.mutateAsync({ name }) }}
      onUpdate={async (id, d) => { await updateMut.mutateAsync({ id, data: d }) }}
      onDelete={async (id) => { await deleteMut.mutateAsync(id) }} />
  )
}

// --- Template Categories Panel ---
function TemplateCategoriesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: templateKeys.categories(),
    queryFn: () => templateApi.listCategories() as Promise<TemplateCategoryRow[]>,
  })
  const qc = useQueryClient()
  const createMut = useMutation({
    mutationFn: (d: { name: string }) => templateApi.createCategory(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.all }),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: { name?: string; isActive?: boolean } }) =>
      templateApi.updateCategory(id, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.all }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => templateApi.deleteCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.all }),
  })
  return (
    <LookupListPanel title="Template Categories" description="Manage categories for clinical templates (e.g. Clinical Notes, Rating Scales, Assessments, Letters)."
      items={data?.map((t: TemplateCategoryRow) => ({ id: t.id, name: t.name, isActive: t.isActive ?? true, sortOrder: t.sortOrder ?? 0 })) ?? []}
      isLoading={isLoading} onCreate={async (name) => { await createMut.mutateAsync({ name }) }}
      onUpdate={async (id, d) => { await updateMut.mutateAsync({ id, data: d }) }} onDelete={async (id) => { await deleteMut.mutateAsync(id) }} />
  )
}

// --- Episode Types Panel ---
function EpisodeTypesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: powerSettingsKeys.episodeTypes(),
    queryFn: () => apiClient.get<{ types: EpisodeTypeRow[] }>('staff-settings/episode-types').then(r => r.types),
  })
  const qc = useQueryClient()
  const createMut = useMutation({ mutationFn: (d: { name: string }) => apiClient.post('staff-settings/episode-types', d), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.episodeTypes() }) })
  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: { id: string; data: LookupUpdatePayload }) =>
      apiClient.patch(`staff-settings/episode-types/${id}`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.episodeTypes() }),
  })
  const deleteMut = useMutation({ mutationFn: (id: string) => apiClient.delete(`staff-settings/episode-types/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: powerSettingsKeys.episodeTypes() }) })
  return (
    <LookupListPanel title="Episode Types" description="Manage episode types used when creating episodes (e.g. ACIS Episode, CCT Episode, IPU Episode). Editable by admin/superadmin."
      items={data?.map((t: EpisodeTypeRow) => ({ id: t.id, name: t.name, isActive: t.isActive ?? true, sortOrder: t.sortOrder ?? 0 })) ?? []}
      isLoading={isLoading} onCreate={async (name) => { await createMut.mutateAsync({ name }) }}
      onUpdate={async (id, d) => { await updateMut.mutateAsync({ id, data: d }) }}
      onDelete={async (id) => { await deleteMut.mutateAsync(id) }} />
  )
}

// ── Role Types Panel (used in staff role assignment dropdowns) ──
function RoleTypesPanel() {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>Role Types</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Role assignment types are canonical and enforced platform-wide to preserve safe assignment semantics across all clinics.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          {RoleTypeEnum.options.map((roleType) => (
            <Chip
              key={roleType}
              label={roleType.replace('_', ' ')}
              size="small"
              sx={{ textTransform: 'capitalize' }}
            />
          ))}
        </Box>
        <Alert severity="info" sx={{ fontSize: 12 }}>
          This catalogue is intentionally not editable in Power Settings. Assignment labels must stay aligned with API and audit rules.
        </Alert>
      </CardContent>
    </Card>
  )
}

// ── System Roles Panel ──
function SystemRolesPanel() {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>System Roles</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          System roles control login permissions and access levels. Their security keys are fixed platform-wide for safety, so they cannot be renamed or deleted per clinic. Clinic-seeded onboarding catalogues such as disciplines, clinical roles, referral sources, and investigation types remain editable in the surrounding Power Settings tabs.
        </Typography>
        {[
          { role: 'superadmin', desc: 'Full platform access. Can manage all clinics, staff, settings, and billing. Intended for platform administrators.' },
          { role: 'admin', desc: 'Clinic-level admin. Can manage staff, settings, reports, and all clinical data within their clinic.' },
          { role: 'manager', desc: 'Team manager. Dashboard access with KPIs, caseload reports, DNA rates, staff leave, and workload alerts.' },
          { role: 'clinician', desc: 'Clinical staff. Full access to patients, notes, assessments, and clinical workflows, but no prescribing privileges.' },
          { role: 'prescriber_consultant', desc: 'Senior prescriber role. Includes clinician and manager privileges, prescribing privileges, and consultant approval authority for ECT/TMS workflows.' },
          { role: 'prescriber_registrar', desc: 'Psychiatry registrar prescriber role. Includes clinician and prescribing privileges. Can complete ECT/TMS forms, pending prescriber consultant approval.' },
          { role: 'prescriber_hmo', desc: 'Hospital Medical Officer prescriber role. Includes clinician and prescribing privileges. Can complete ECT/TMS forms, pending prescriber consultant approval.' },
          { role: 'prescriber_nurse_practitioner', desc: 'Nurse practitioner prescriber role. Includes clinician and prescribing privileges with PBS/HPI-I credential requirements.' },
          { role: 'receptionist', desc: 'Front desk. Patient check-in, appointments, phone triage, waitlist, and SMS reminders.' },
          { role: 'referral_coordinator', desc: 'Referral operations staff. Intake triage, referral assignment, and inter-service coordination workflows.' },
          { role: 'readonly', desc: 'Read-only access. Can view patient records but cannot create or modify data.' },
        ].map(r => (
          <Box key={r.role} sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, py: 1.5, borderBottom: '1px solid #eee' }}>
            <Box sx={{ minWidth: 120 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ textTransform: 'capitalize' }}>
                    {r.role.replace(/_/g, ' ')}
                  </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>{r.desc}</Typography>
          </Box>
        ))}
        <Alert severity="info" sx={{ mt: 2, fontSize: 11 }}>
          To assign a system role to a staff member, go to Staff Management and use the onboarding dialog or edit their profile.
          Clinical roles (e.g. Case Manager, Psychiatrist) are separate and managed in the "Clinical Roles" tab.
        </Alert>
      </CardContent>
    </Card>
  )
}

// ── Subscription Module Panel ────────────────────────────────────────────────
// Manages which modules are active for each subscriber/clinic.

function SubscriptionModulePanel() {
  const qc = useQueryClient()
  const { data: clinics } = useAllClinics()
  const [selectedClinic, setSelectedClinic] = React.useState('')
  const [feedback, setFeedback] = React.useState<{ severity: AlertColor; message: string } | null>(null)

  const { data: modules, isLoading, isError, error } = useQuery({
    queryKey: powerSettingsKeys.subscriptionModules(selectedClinic),
    queryFn: () =>
      apiClient
        .get<{ modules: Record<string, boolean> }>(`power-settings/subscriptions/${selectedClinic}/modules`)
        .then((r) => r.modules ?? {}),
    enabled: !!selectedClinic,
  })

  const toggleMut = useMutation({
    mutationFn: ({ moduleKey, enabled }: { moduleKey: string; enabled: boolean }) =>
      apiClient.put(`power-settings/subscriptions/${selectedClinic}/modules/${moduleKey}`, { enabled }),
    onSuccess: (_data, variables) => {
      setFeedback({
        severity: 'success',
        message: `${variables.moduleKey} ${variables.enabled ? 'enabled' : 'disabled'} successfully.`,
      })
      qc.invalidateQueries({ queryKey: powerSettingsKeys.subscriptionModules(selectedClinic) })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to update subscription module.'
      setFeedback({ severity: 'error', message })
    },
  })

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Subscription Module Selection</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Activate or deactivate modules for each subscriber. Deactivated modules will be hidden from the subscriber's interface.
      </Typography>

      <Box sx={{ mb: 3, maxWidth: 400 }}>
        <TextField
          select label="Select Subscriber" fullWidth size="small"
          value={selectedClinic} onChange={e => { setSelectedClinic(e.target.value); setFeedback(null) }}>
          <MenuItem value="">— Select —</MenuItem>
          {(clinics ?? []).map((c: ClinicOption) => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </TextField>
      </Box>

      {feedback && (
        <Alert severity={feedback.severity} sx={{ mb: 2 }} onClose={() => setFeedback(null)}>
          {feedback.message}
        </Alert>
      )}

      {!selectedClinic && <Alert severity="info">Select a subscriber to manage their module access.</Alert>}

      {selectedClinic && isLoading && <CircularProgress size={24} />}

      {selectedClinic && isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load module settings: {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      )}

      {selectedClinic && !isLoading && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Click a module card to toggle it on/off. Green = active, grey = deactivated.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="outlined" onClick={() => {
                ALL_MODULES.forEach(mod => toggleMut.mutate({ moduleKey: mod.key, enabled: true }))
              }} sx={{ textTransform: 'none', fontSize: 11 }}>Enable All</Button>
              <Button size="small" variant="outlined" color="error" onClick={() => {
                if (confirm('Deactivate all modules for this subscriber?'))
                  ALL_MODULES.forEach(mod => toggleMut.mutate({ moduleKey: mod.key, enabled: false }))
              }} sx={{ textTransform: 'none', fontSize: 11 }}>Disable All</Button>
            </Box>
          </Box>
          <Grid container spacing={1.5}>
            {ALL_MODULES.map(mod => {
              const moduleMap = (modules as Record<string, boolean>) ?? {}
              const hasExplicitValue = Object.prototype.hasOwnProperty.call(moduleMap, mod.key)
              const enabled = hasExplicitValue
                ? moduleMap[mod.key] !== false
                : !DEFAULT_DISABLED_MODULE_KEYS.has(mod.key)
              return (
                <Grid key={mod.key} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined"
                    role="button"
                    tabIndex={0}
                    aria-pressed={enabled}
                    aria-label={`${mod.label} module — ${enabled ? 'enabled, click to disable' : 'disabled, click to enable'}`}
                    onClick={() => toggleMut.mutate({ moduleKey: mod.key, enabled: !enabled })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMut.mutate({ moduleKey: mod.key, enabled: !enabled }); } }}
                    sx={{
                      borderColor: enabled ? '#2E7D32' : '#E0E0E0',
                      borderWidth: enabled ? 2 : 1,
                      opacity: enabled ? 1 : 0.6,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      '&:hover': { boxShadow: 2, borderColor: enabled ? '#1B5E20' : '#b8621a' },
                      '&:focus-visible': { outline: '2px solid #2E7D32', outlineOffset: 2 },
                    }}>
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="subtitle2" fontWeight={600} sx={{ fontSize: 12, color: enabled ? '#1B5E20' : '#999' }}>{mod.label}</Typography>
                        <Box sx={{
                          width: 14, height: 14, borderRadius: '50%',
                          bgcolor: enabled ? '#2E7D32' : '#E0E0E0',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {enabled && <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#fff' }} />}
                        </Box>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{mod.description}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              )
            })}
          </Grid>
        </>
      )}
    </Box>
  )
}

// ── Clinical Specialty Panel ────────────────────────────────────────────────
//
// Per-clinic toggle for the seven multi-specialty modules (mental_health,
// general_medicine, endocrinology, paediatrics, obstetrics_gynaecology,
// surgery, oncology). Writes to clinic.enabled_specialties via
// PUT /power-settings/specialties/:clinicId/:specialtyCode. The frontend
// ModuleContext picks up the change on the next /staff/me fetch.
//
// Naming conventions: apiClient calls use relative paths (no /api/v1/
// prefix and no leading slash), per the naming-conventions guard rules
// 1+2.

const ALL_CLINICAL_SPECIALTIES: Array<{ code: string; label: string; description: string }> = [
  { code: 'mental_health',          label: 'Mental Health',             description: 'LAI, clozapine, MH Act, 91-day review, ECT, TMS, psychology pathways' },
  { code: 'general_medicine',       label: 'Internal Medicine',         description: 'Chronic disease register, problem list, medication reconciliation' },
  { code: 'endocrinology',          label: 'Endocrinology',             description: 'Glucose flowsheet (TIR), insulin regimen, HbA1c trends' },
  { code: 'paediatrics',            label: 'Paediatrics',               description: 'Growth charts (WHO/CDC), CVX immunizations, developmental milestones' },
  { code: 'obstetrics_gynaecology', label: 'Obstetrics & Gynaecology',  description: 'LMP/EDD, GTPAL, antenatal visits, fundal height, CTG' },
  { code: 'surgery',                label: 'Surgery',                   description: 'WHO surgical safety checklist, ASA, op note, PACU' },
  { code: 'oncology',               label: 'Oncology',                  description: 'mCODE-aligned: TNM staging, ECOG, treatment plans, chemo cycles' },
]

function ClinicalSpecialtyPanel() {
  const qc = useQueryClient()
  const [selectedClinic, setSelectedClinic] = useState('')
  const { data: clinics } = useQuery({
    queryKey: powerSettingsKeys.clinicsList(),
    queryFn: () => apiClient.get<Array<{ id: string; name: string }>>('clinics'),
    staleTime: 60_000,
  })

  const { data: enabled, isLoading } = useQuery({
    queryKey: powerSettingsKeys.clinicSpecialties(selectedClinic),
    queryFn: () =>
      apiClient
        .get<{ enabledSpecialties: string[] }>(`power-settings/specialties/${selectedClinic}`)
        .then((r) => r.enabledSpecialties ?? [])
        .catch((err) => { console.warn('PowerSettingsPage: query failed', err); return []; }),
    enabled: !!selectedClinic,
  })

  const toggleMut = useMutation({
    mutationFn: ({ specialtyCode, enabled: on }: { specialtyCode: string; enabled: boolean }) =>
      apiClient.put(`power-settings/specialties/${selectedClinic}/${specialtyCode}`, { enabled: on }),
    onSuccess: () => {
      // Invalidate both the power-settings-local cache and the
      // staff/me cache that ModuleContext reads so the module
      // visibility intersection refreshes across the app without
      // a page reload (CLAUDE.md §4.1 — matching invalidation keys).
      qc.invalidateQueries({ queryKey: powerSettingsKeys.clinicSpecialties(selectedClinic) })
      qc.invalidateQueries({ queryKey: powerSettingsKeys.staffProfileMe() })
    },
  })

  const enabledSet = new Set<string>(enabled ?? [])

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>Clinical Specialty Modules</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Toggle which clinical specialties are enabled for this subscriber. Disabled specialties
        hide their patient-detail tabs and sidebar entries from every clinician via the
        ModuleContext visibility intersection — clinic ∩ staff ∩ patient episodes.
      </Typography>

      <FormControl size="small" sx={{ minWidth: 320, mb: 2 }}>
        <InputLabel>Subscriber</InputLabel>
        <Select value={selectedClinic} label="Subscriber" onChange={(e) => setSelectedClinic(e.target.value)}>
          <MenuItem value=""><em>— Select —</em></MenuItem>
          {(clinics ?? []).map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {!selectedClinic && <Alert severity="info">Select a subscriber to manage their clinical specialties.</Alert>}

      {selectedClinic && isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}

      {selectedClinic && !isLoading && (
        <Grid container spacing={2}>
          {ALL_CLINICAL_SPECIALTIES.map((s) => {
            const isOn = enabledSet.has(s.code)
            return (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={s.code}>
                <Paper
                  variant="outlined"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isOn}
                  aria-label={`${s.label} specialty — ${isOn ? 'enabled, click to disable' : 'disabled, click to enable'}`}
                  onClick={() => toggleMut.mutate({ specialtyCode: s.code, enabled: !isOn })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMut.mutate({ specialtyCode: s.code, enabled: !isOn }); } }}
                  sx={{
                    p: 2,
                    cursor: 'pointer',
                    borderColor: isOn ? '#327C8D' : 'divider',
                    bgcolor: isOn ? '#E8F5F2' : 'background.paper',
                    transition: 'all 0.15s',
                    '&:hover': { borderColor: isOn ? '#265F6B' : '#999' },
                    '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body1" fontWeight={700}>{s.label}</Typography>
                    {/* Switch is visually-only — Paper's aria-pressed is the canonical state surface for AT;
                        tabIndex=-1 + aria-hidden removes the inner widget from tab order + screen-reader. */}
                    <Switch checked={isOn} size="small" inputProps={{ tabIndex: -1, 'aria-hidden': true, readOnly: true }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                </Paper>
              </Grid>
            )
          })}
        </Grid>
      )}
    </Box>
  )
}

export default PowerSettingsPage
