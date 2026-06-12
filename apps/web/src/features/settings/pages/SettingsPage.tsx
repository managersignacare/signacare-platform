// apps/web/src/features/settings/pages/SettingsPage.tsx
import React from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel,
  MenuItem, Paper, Select, Step, StepLabel, Stepper, Tab, Tabs, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import LockIcon from '@mui/icons-material/Lock'
import SecurityIcon from '@mui/icons-material/Security'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
// ClinicProfilePanel moved to Org Settings
import { EditStaffCredentialsDialog } from '../../staff-settings/components/EditStaffCredentialsDialog'
import { SidebarCustomisationPanel } from '../components/SettingsNavPanels'
import { AsyncAiJobsSettingsPanel } from '../components/AsyncAiJobsSettingsPanel'
// ThresholdsPanel moved to Org Settings; IntegrationStatusPanel, CmiPanel,
// AiTrainingModule, WorkflowBuilder, Clinical Policies, Access Control,
// Audit Log, and Backup Settings live in Power Settings.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/services/apiClient'
import {
  mfaKeys,
  outlookKeys,
  licenseKeys,
  llmModelfilesKeys,
  llmTrainingStatsKeys,
  staffSettingsClinicalPoliciesKeys,
  staffSettingsAiContextKeys,
} from '../queryKeys'
import { useAuthStore } from '../../../shared/store/authStore'
import { sharedModuleVisibilityKeys } from '../../../shared/queryKeys'
import { useStaffSignature } from '../../../shared/components/ui/DigitalSignature'
import SignatureCanvas from 'react-signature-canvas'
import { useSearchParams } from 'react-router-dom'
import {
  readSettingsTabId,
  type SettingsTabId,
} from '../../../shared/navigation/settingsNavigation'

import PaletteIcon from '@mui/icons-material/Palette'
import { useThemeStore, THEME_OPTIONS, type ThemeId, THEME_PALETTES } from '../../../shared/theme/ThemeProvider'
import {
  readErrorMessage,
  readPolicyParameters,
  type AiContextCreateDto,
  type AiContextFilesResponse,
  type AiContextImportResponse,
  type BackupConfigResponse,
  type BackupLocationDraft,
  type BackupLocationType,
  type BackupRunResponse,
  type ClinicalPolicyMutationDto,
  type ClinicalPoliciesResponse,
  type ClinicalPolicyRow,
  type LicenseStatusResponse,
  type SendEmailResponse,
} from './settingsPageSupport'

interface SettingsProfileVisibilityResponse {
  settingsProfileTabVisible?: boolean;
}

// The legacy AccessControlPanel that lived here wrote rows with
// module keys like 'patients', 'episodes', 'medications' and
// access_level values like 'view' / 'admin'. None of those are in
// the canonical MODULE_KEYS set the moduleAccessMiddleware
// enforces, so the rows it produced were silently ignored at
// request time. The panel has been removed and the "Access
// Control" tab in Power Settings now mounts the shared
// ModuleAccessMatrix component — a single source of truth hitting
// the typo-proof canonical keys.
// See apps/web/src/features/staff-settings/components/ModuleAccessMatrix.tsx
// and apps/api/src/shared/moduleKeys.ts for the authoritative list.
export { ModuleAccessMatrix as AccessControlPanel } from '../../staff-settings/components/ModuleAccessMatrix'

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: profileVisibility } = useQuery<SettingsProfileVisibilityResponse>({
    queryKey: sharedModuleVisibilityKeys.myProfile(),
    queryFn: () => apiClient.get<SettingsProfileVisibilityResponse>('staff/me'),
    staleTime: 60_000,
  })
  const canViewMyProfileTab = profileVisibility?.settingsProfileTabVisible === true
  const requestedTab = readSettingsTabId(searchParams.get('tab'), 'my-profile')
  const tab: SettingsTabId =
    !canViewMyProfileTab && requestedTab === 'my-profile'
      ? 'security'
      : requestedTab

  React.useEffect(() => {
    const currentTab = searchParams.get('tab')
    const expectedTab = tab === 'my-profile' ? null : tab

    if (currentTab === expectedTab) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    if (expectedTab) {
      nextSearchParams.set('tab', expectedTab)
    } else {
      nextSearchParams.delete('tab')
    }

    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams, tab])

  const handleTabChange = (_event: React.SyntheticEvent, nextTab: SettingsTabId) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    if (nextTab === 'my-profile') {
      nextSearchParams.delete('tab')
    } else {
      nextSearchParams.set('tab', nextTab)
    }
    setSearchParams(nextSearchParams)
  }

  return (
    <Box p={3}>
      <Typography variant="h5" mb={2}>Settings</Typography>
      <Tabs aria-label="Navigation tabs" value={tab} onChange={handleTabChange} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
        {canViewMyProfileTab && <Tab label="My Profile" value="my-profile" />}
        <Tab label="Account Security" value="security" />
        <Tab label="Appearance" value="appearance" />
        <Tab label="Digital Signature" value="signature" />
        <Tab label="Sidebar Customisation" value="sidebar" />
        <Tab label="Async AI Jobs" value="async-ai-jobs" />
      </Tabs>
      <Divider sx={{ mb: 3 }} />
      {!canViewMyProfileTab && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Your profile subtab is disabled for this account. Ask a clinic admin to enable it if needed.
        </Alert>
      )}
      {tab === 'my-profile' && canViewMyProfileTab && <EditStaffCredentialsDialog open inline onClose={() => {}} />}
      {tab === 'security' && <MfaSecurityPanel />}
      {tab === 'appearance' && <AppearancePanel />}
      {tab === 'signature' && <SignatureSetupPanel />}
      {tab === 'sidebar' && <SidebarCustomisationPanel />}
      {tab === 'async-ai-jobs' && <AsyncAiJobsSettingsPanel patientId={searchParams.get('patientId')} />}
    </Box>
  )
}

// ============ Appearance Panel (Theme Selector) ============

function AppearancePanel() {
  const { themeId, setTheme } = useThemeStore()

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 700 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <PaletteIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Box>
            <Typography variant="h6" fontWeight={600}>Theme</Typography>
            <Typography variant="body2" color="text.secondary">Choose a visual theme for the application</Typography>
          </Box>
        </Box>

        <Grid container spacing={2}>
          {THEME_OPTIONS.map(opt => {
            const isSelected = themeId === opt.id
            const p = THEME_PALETTES[opt.id as ThemeId]
            const colors = { sidebar: p.sidebar, accent: p.accent, bg: p.background }

            return (
              <Grid key={opt.id} size={{ xs: 12, sm: 4 }}>
                <Card
                  variant="outlined"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${opt.name} theme${isSelected ? ' (selected)' : ''}`}
                  onClick={() => setTheme(opt.id as ThemeId)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTheme(opt.id as ThemeId); } }}
                  sx={{
                    cursor: 'pointer',
                    borderColor: isSelected ? 'primary.main' : 'divider',
                    borderWidth: isSelected ? 2 : 1,
                    transition: 'all 0.2s',
                    '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)', boxShadow: 3 },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                  }}
                >
                  {/* Theme Preview */}
                  <Box sx={{ display: 'flex', height: 80, borderRadius: '7px 7px 0 0', overflow: 'hidden' }}>
                    <Box sx={{ width: 40, bgcolor: colors.sidebar }} />
                    <Box sx={{ flex: 1, bgcolor: colors.bg, p: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Box sx={{ height: 8, width: '60%', bgcolor: colors.accent, borderRadius: 1, opacity: 0.8 }} />
                      <Box sx={{ height: 6, width: '80%', bgcolor: colors.sidebar, borderRadius: 1, opacity: 0.15 }} />
                      <Box sx={{ height: 6, width: '45%', bgcolor: colors.sidebar, borderRadius: 1, opacity: 0.1 }} />
                      <Box sx={{ display: 'flex', gap: 0.5, mt: 'auto' }}>
                        <Box sx={{ height: 12, width: 24, bgcolor: colors.accent, borderRadius: 0.5 }} />
                        <Box sx={{ height: 12, width: 24, bgcolor: colors.sidebar, borderRadius: 0.5, opacity: 0.2 }} />
                      </Box>
                    </Box>
                  </Box>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle2" fontWeight={600}>{opt.name}</Typography>
                      {isSelected && <CheckCircleIcon sx={{ color: 'primary.main', fontSize: 16 }} />}
                    </Box>
                    <Typography variant="caption" color="text.secondary">{opt.description}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            )
          })}
        </Grid>
      </Paper>
    </Box>
  )
}

// ============ MFA / Account Security Panel ============

function MfaSecurityPanel() {
  const [step, setStep] = React.useState<'status' | 'setup' | 'verify' | 'done'>('status')
  const [secret, setSecret] = React.useState('')
  const [qrUrl, setQrUrl] = React.useState('')
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([])
  const [code, setCode] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [showRecovery, setShowRecovery] = React.useState(false)

  const { data: mfaStatus, refetch } = useQuery({
    queryKey: mfaKeys.all,
    queryFn: () => apiClient.get<{ enabled: boolean; configured: boolean }>('auth/mfa/status').catch(() => ({ enabled: false, configured: false })),
  })

  const startSetup = async () => {
    setLoading(true); setError('')
    try {
      const resp = await apiClient.post<{ secret: string; qrDataUrl: string; recoveryCodes: string[] }>('auth/mfa/setup', {})
      setSecret(resp.secret)
      setQrUrl(resp.qrDataUrl)
      setRecoveryCodes(resp.recoveryCodes)
      setStep('setup')
    } catch (err: unknown) {
      setError(readErrorMessage(err, 'Failed to start MFA setup'))
    } finally {
      setLoading(false)
    }
  }

  const confirmSetup = async () => {
    if (code.length !== 6) return
    setLoading(true); setError('')
    try {
      await apiClient.post('auth/mfa/confirm', { token: code })
      setStep('done')
      refetch()
    } catch (err: unknown) {
      setError(readErrorMessage(err, 'Invalid code. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  const disableMfa = async () => {
    setLoading(true)
    try {
      await apiClient.post('auth/mfa/disable', {})
      setStep('status')
      setSecret(''); setQrUrl(''); setRecoveryCodes([]); setCode('')
      refetch()
    } catch (err: unknown) {
      setError(readErrorMessage(err, 'Failed to disable MFA'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 600 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <SecurityIcon sx={{ color: '#327C8D', fontSize: 28 }} />
          <Box>
            <Typography variant="h6" fontWeight={600}>Two-Factor Authentication</Typography>
            <Typography variant="body2" color="text.secondary">
              Protect your account with an authenticator app (Microsoft Authenticator, Google Authenticator, Authy)
            </Typography>
          </Box>
        </Box>

        {error && <Alert role="alert" severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Status View */}
        {step === 'status' && (
          <Box>
            <Card variant="outlined" sx={{ mb: 2, borderColor: mfaStatus?.enabled ? '#2E7D32' : '#b8621a' }}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2, '&:last-child': { pb: 2 } }}>
                {mfaStatus?.enabled ? (
                  <>
                    <CheckCircleIcon sx={{ color: '#2E7D32', fontSize: 32 }} />
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600} color="#2E7D32">MFA is Enabled</Typography>
                      <Typography variant="body2" color="text.secondary">Your account is protected with two-factor authentication.</Typography>
                    </Box>
                  </>
                ) : (
                  <>
                    <LockIcon sx={{ color: '#b8621a', fontSize: 32 }} />
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600} color="#b8621a">MFA is Not Enabled</Typography>
                      <Typography variant="body2" color="text.secondary">We strongly recommend enabling MFA for clinical systems.</Typography>
                    </Box>
                  </>
                )}
              </CardContent>
            </Card>

            {mfaStatus?.enabled ? (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="outlined" color="error" onClick={disableMfa} disabled={loading} sx={{ textTransform: 'none' }}>
                  Disable MFA
                </Button>
                <Button variant="outlined" onClick={startSetup} disabled={loading} sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
                  Reconfigure
                </Button>
              </Box>
            ) : (
              <Button variant="contained" startIcon={<PhoneAndroidIcon />} onClick={startSetup} disabled={loading}
                sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
                {loading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Set Up Authenticator App'}
              </Button>
            )}
          </Box>
        )}

        {/* Setup — QR Code */}
        {step === 'setup' && (
          <Box>
            <Stepper activeStep={0} sx={{ mb: 3 }}>
              <Step><StepLabel>Scan QR Code</StepLabel></Step>
              <Step><StepLabel>Verify Code</StepLabel></Step>
              <Step><StepLabel>Save Recovery Codes</StepLabel></Step>
            </Stepper>

            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Step 1: Scan with your authenticator app</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Open <strong>Microsoft Authenticator</strong>, <strong>Google Authenticator</strong>, or <strong>Authy</strong> and scan the QR code below.
            </Typography>

            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Box component="img" src={qrUrl} alt="MFA QR Code" sx={{ width: 200, height: 200, border: '1px solid #ddd', borderRadius: 2 }} />
            </Box>

            <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
              Can't scan? Enter this key manually: <strong style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>{secret}</strong>
            </Alert>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="contained" onClick={() => setStep('verify')}
                sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
                Next — Verify Code
              </Button>
            </Box>
          </Box>
        )}

        {/* Verify — Enter code */}
        {step === 'verify' && (
          <Box>
            <Stepper activeStep={1} sx={{ mb: 3 }}>
              <Step completed><StepLabel>Scan QR Code</StepLabel></Step>
              <Step><StepLabel>Verify Code</StepLabel></Step>
              <Step><StepLabel>Save Recovery Codes</StepLabel></Step>
            </Stepper>

            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Step 2: Enter the 6-digit code from your app</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This confirms your authenticator is set up correctly.
            </Typography>

            <TextField
              label="6-digit code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              fullWidth
              autoFocus
              inputProps={{ maxLength: 6, inputMode: 'numeric', style: { fontSize: '1.5rem', letterSpacing: '0.5rem', textAlign: 'center', fontFamily: 'monospace' } }}
              sx={{ mb: 2, maxWidth: 300 }}
            />

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button onClick={() => setStep('setup')} sx={{ color: 'text.secondary', textTransform: 'none' }}>Back</Button>
              <Button variant="contained" onClick={confirmSetup} disabled={code.length !== 6 || loading}
                sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
                {loading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Verify & Enable MFA'}
              </Button>
            </Box>
          </Box>
        )}

        {/* Done — Recovery Codes */}
        {step === 'done' && (
          <Box>
            <Stepper activeStep={2} sx={{ mb: 3 }}>
              <Step completed><StepLabel>Scan QR Code</StepLabel></Step>
              <Step completed><StepLabel>Verify Code</StepLabel></Step>
              <Step><StepLabel>Save Recovery Codes</StepLabel></Step>
            </Stepper>

            <Alert severity="success" sx={{ mb: 2 }}>
              <strong>MFA enabled successfully!</strong> Your account is now protected with two-factor authentication.
            </Alert>

            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Step 3: Save your recovery codes</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Store these codes securely. If you lose access to your authenticator app, you can use a recovery code to sign in.
              <strong> Each code can only be used once.</strong>
            </Typography>

            <Paper sx={{ p: 2, bgcolor: '#FBF8F5', mb: 2 }}>
              <Grid container spacing={1}>
                {recoveryCodes.map((rc, i) => (
                  <Grid key={i} size={{ xs: 6, sm: 3 }}>
                    <Typography variant="body2" fontFamily="monospace" fontWeight={600} sx={{ textAlign: 'center', py: 0.5 }}>
                      {rc}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            </Paper>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="outlined" onClick={() => {
                navigator.clipboard.writeText(recoveryCodes.join('\n'))
                setShowRecovery(true)
                setTimeout(() => setShowRecovery(false), 2000)
              }} sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}>
                {showRecovery ? 'Copied!' : 'Copy Codes'}
              </Button>
              <Button variant="contained" onClick={() => setStep('status')}
                sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
                Done
              </Button>
            </Box>
          </Box>
        )}
      </Paper>

      {/* Supported Apps */}
      <Paper variant="outlined" sx={{ p: 3, mt: 2, maxWidth: 600 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Supported Authenticator Apps</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {[
            { name: 'Microsoft Authenticator', platform: 'iOS / Android', color: '#0078D4' },
            { name: 'Google Authenticator', platform: 'iOS / Android', color: '#4285F4' },
            { name: 'Authy', platform: 'iOS / Android / Desktop', color: '#EC1C24' },
            { name: '1Password', platform: 'All platforms', color: '#1A8CFF' },
          ].map(app => (
            <Card key={app.name} variant="outlined" sx={{ minWidth: 140, flex: 1 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                <Typography variant="body2" fontWeight={600} sx={{ color: app.color }}>{app.name}</Typography>
                <Typography variant="caption" color="text.secondary">{app.platform}</Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Any TOTP-compatible authenticator app will work. The QR code follows the standard otpauth:// URI format.
        </Typography>
      </Paper>

      {/* Outlook Integration */}
      <OutlookIntegrationPanel />
    </Box>
  )
}

// ============ Outlook Integration Panel ============

// ============ Backup Panel ============

export function BackupPanel() {
  const [config, setConfig] = React.useState<BackupConfigResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [running, setRunning] = React.useState(false)
  const [newLoc, setNewLoc] = React.useState<BackupLocationDraft>({ name: '', path: '', type: 'local' })
  const [addOpen, setAddOpen] = React.useState(false)

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const resp = await apiClient.get<BackupConfigResponse>('backup/config')
      setConfig(resp)
    } catch { setConfig(null) }
    finally { setLoading(false) }
  }

  React.useEffect(() => { fetchConfig() }, [])

  const handleRun = async (locationId?: string) => {
    setRunning(true)
    try {
      const resp = await apiClient.post<BackupRunResponse>('backup/run', locationId ? { locationId } : {})
      const summary = (resp.results ?? [])
        .map((result) => `${result.location ?? 'Unknown'}: ${result.success ? `${result.filename ?? 'backup.sql'} (${result.size ?? 'n/a'})` : `FAILED — ${result.error ?? 'Unknown error'}`}`)
        .join('\n')
      alert(`Backup complete:\n${summary}`)
      fetchConfig()
    } catch (err: unknown) {
      alert(`Backup failed: ${readErrorMessage(err, 'Unknown error')}`)
    } finally { setRunning(false) }
  }

  const handleAddLocation = async () => {
    if (!newLoc.name || !newLoc.path) return
    try {
      await apiClient.post('backup/locations', newLoc)
      setNewLoc({ name: '', path: '', type: 'local' })
      setAddOpen(false)
      fetchConfig()
    } catch (err: unknown) { alert(`Failed: ${readErrorMessage(err, 'Unknown error')}`) }
  }

  const handleRemoveLocation = async (id: string) => {
    if (!confirm('Remove this backup location?')) return
    try {
      await apiClient.delete(`backup/locations/${id}`)
      fetchConfig()
    } catch { /* ignore */ }
  }

  const handleUpdateSchedule = async (updates: Record<string, unknown>) => {
    try {
      await apiClient.put('backup/config', { schedule: { ...config?.schedule, ...updates } })
      fetchConfig()
    } catch { /* ignore */ }
  }

  if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress role="progressbar" aria-label="Loading" /></Box>

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>Database Backup</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure automatic database backups with multiple storage locations and retention policies.
      </Typography>

      {/* Schedule Settings */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>Backup Schedule</Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, sm: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Frequency</InputLabel>
              <Select value={config?.schedule?.frequency ?? 'daily'} onChange={e => handleUpdateSchedule({ frequency: e.target.value })} label="Frequency">
                <MenuItem value="hourly">Hourly</MenuItem>
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField label="Time (24h)" size="small" fullWidth type="time"
              value={config?.schedule?.time ?? '02:00'}
              onChange={e => handleUpdateSchedule({ time: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField label="Retention (days)" size="small" fullWidth type="number"
              value={config?.schedule?.retentionDays ?? 30}
              onChange={e => handleUpdateSchedule({ retentionDays: parseInt(e.target.value, 10) || 30 })} />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <Chip label={config?.schedule?.enabled ? 'Scheduler Active' : 'Scheduler Disabled'}
              color={config?.schedule?.enabled ? 'success' : 'default'} sx={{ fontWeight: 600 }} />
          </Grid>
        </Grid>
      </Paper>

      {/* Backup Locations */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={600}>Backup Locations</Typography>
          <Button size="small" variant="outlined" onClick={() => setAddOpen(true)}
            sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
            Add Location
          </Button>
        </Box>

        {(config?.locations ?? []).length === 0 && (
          <Alert role="alert" severity="warning">No backup locations configured. Add at least one location.</Alert>
        )}

        {(config?.locations ?? []).map((loc) => (
          <Card key={loc.id} variant="outlined" sx={{ mb: 1 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="subtitle2" fontWeight={600}>{loc.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 11 }}>{loc.path}</Typography>
                <Chip label={loc.type} size="small" sx={{ fontSize: 9, mt: 0.5 }} />
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="contained" onClick={() => handleRun(loc.id)} disabled={running}
                  sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none', fontSize: 11 }}>
                  {running ? <CircularProgress role="progressbar" aria-label="Loading" size={14} sx={{ color: '#fff' }} /> : 'Backup Now'}
                </Button>
                <Button size="small" variant="text" color="error" onClick={() => handleRemoveLocation(loc.id)}
                  sx={{ textTransform: 'none', fontSize: 11 }}>Remove</Button>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Paper>

      {/* Last Backup & History */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Backup History</Typography>
        {config?.lastBackup && (
          <Alert severity="success" sx={{ mb: 2, fontSize: 12 }}>
            Last backup: {config.lastBackup.timestamp ? new Date(config.lastBackup.timestamp).toLocaleString('en-AU') : 'Unknown time'} — {config.lastBackup.filename ?? 'backup.sql'} ({config.lastBackup.size ?? 'n/a'}) to {config.lastBackup.location ?? 'unknown location'}
          </Alert>
        )}
        {(!config?.history || config.history.length === 0) ? (
          <Typography variant="body2" color="text.secondary">No backup history yet. Run a backup to get started.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Date</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Filename</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Size</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {config.history.slice(0, 10).map((h) => (
                <TableRow key={h.id}>
                  <TableCell sx={{ fontSize: 12 }}>{h.timestamp ? new Date(h.timestamp).toLocaleString('en-AU') : 'Unknown time'}</TableCell>
                  <TableCell sx={{ fontSize: 11, fontFamily: 'monospace' }}>{h.filename}</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{h.size}</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{h.location}</TableCell>
                  <TableCell><Chip label={h.success ? 'OK' : 'Failed'} size="small" color={h.success ? 'success' : 'error'} sx={{ fontSize: 9 }} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* Manual Backup All */}
      <Button variant="contained" onClick={() => handleRun()} disabled={running}
        sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
        {running ? <><CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff', mr: 1 }} /> Running Backup...</> : 'Run Backup to All Locations'}
      </Button>

      {/* Add Location Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Add Backup Location</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField label="Location Name" fullWidth size="small" value={newLoc.name}
                onChange={e => setNewLoc(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. NAS Backup, S3 Bucket, External Drive" />
            </Grid>
            <Grid size={{ xs: 8 }}>
              <TextField label="Path / URL" fullWidth size="small" value={newLoc.path}
                onChange={e => setNewLoc(p => ({ ...p, path: e.target.value }))}
                placeholder="e.g. /mnt/backup/signacare, s3://bucket-name/backups" />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={newLoc.type} onChange={e => setNewLoc(p => ({ ...p, type: e.target.value as BackupLocationType }))} label="Type">
                  <MenuItem value="local">Local / NAS</MenuItem>
                  <MenuItem value="s3">AWS S3</MenuItem>
                  <MenuItem value="azure">Azure Blob</MenuItem>
                  <MenuItem value="gcs">Google Cloud</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddLocation} disabled={!newLoc.name || !newLoc.path}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Add Location</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function OutlookIntegrationPanel() {
  const [connecting, setConnecting] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [setupError, setSetupError] = React.useState('')

  const { data: status, refetch } = useQuery({
    queryKey: outlookKeys.all,
    queryFn: () => apiClient.get<{ connected: boolean; email: string | null; configured?: boolean }>('integrations/outlook/status').catch(() => ({ connected: false, email: null, configured: false })),
  })

  const handleConnect = async () => {
    setSetupError('')
    if (status && !status.configured) {
      setSetupError('not-configured')
      return
    }
    setConnecting(true)
    try {
      const resp = await apiClient.get<{ url: string }>('integrations/outlook/auth-url')
      window.location.href = resp.url
    } catch (err: unknown) {
      setSetupError(readErrorMessage(err, 'Failed to connect'))
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await apiClient.delete('integrations/outlook/disconnect')
      refetch()
    } catch (err: unknown) {
      alert(`Failed to disconnect: ${readErrorMessage(err, 'Unknown error')}`)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 2, maxWidth: 600 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box component="img" src="https://img.icons8.com/color/28/microsoft-outlook-2019.png" alt="" sx={{ width: 28, height: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight={600}>Microsoft Outlook</Typography>
          <Typography variant="body2" color="text.secondary">
            Connect your Outlook account to send clinical letters, sync appointments, and receive referrals.
          </Typography>
        </Box>
      </Box>

      <Card variant="outlined" sx={{ mb: 2, borderColor: status?.connected ? '#2E7D32' : '#ddd' }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2, '&:last-child': { pb: 2 } }}>
          {status?.connected ? (
            <>
              <CheckCircleIcon sx={{ color: '#2E7D32', fontSize: 28 }} />
              <Box>
                <Typography variant="subtitle2" fontWeight={600} color="#2E7D32">Connected</Typography>
                <Typography variant="body2" color="text.secondary">{status.email}</Typography>
              </Box>
            </>
          ) : (
            <>
              <LockIcon sx={{ color: '#999', fontSize: 28 }} />
              <Box>
                <Typography variant="subtitle2" fontWeight={600} color="text.secondary">Not Connected</Typography>
                <Typography variant="body2" color="text.secondary">Connect to enable email and calendar integration.</Typography>
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      {status?.connected ? (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" color="error" onClick={handleDisconnect} disabled={disconnecting} sx={{ textTransform: 'none' }}>
            {disconnecting ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Disconnect'}
          </Button>
          <Button variant="outlined" onClick={handleConnect} disabled={connecting} sx={{ textTransform: 'none', borderColor: '#0078D4', color: '#0078D4' }}>
            Reconnect
          </Button>
        </Box>
      ) : (
        <Button variant="contained" onClick={handleConnect} disabled={connecting}
          sx={{ bgcolor: '#0078D4', '&:hover': { bgcolor: '#106EBE' }, textTransform: 'none' }}>
          {connecting ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Connect Microsoft Outlook'}
        </Button>
      )}

      {/* Setup guide when not configured */}
      {setupError === 'not-configured' && (
        <Alert severity="info" sx={{ mt: 2, fontSize: 12 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>Office 365 Setup Required</Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Your administrator needs to register an Azure AD application and set the following environment variables on the server:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            <li><code>O365_CLIENT_ID</code> — Application (client) ID</li>
            <li><code>O365_TENANT_ID</code> — Directory (tenant) ID</li>
            <li><code>O365_CLIENT_SECRET</code> — Client secret value</li>
            <li><code>O365_REDIRECT_URI</code> — <code>http://localhost:4000/api/v1/integrations/outlook/auth-callback</code></li>
          </Box>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Register at <strong>Azure Portal → App Registrations → New Registration</strong>.
            Required API permissions: Calendars.ReadWrite, Mail.Send, Mail.Read, OnlineMeetings.ReadWrite, offline_access.
          </Typography>
        </Alert>
      )}
      {setupError && setupError !== 'not-configured' && (
        <Alert role="alert" severity="error" sx={{ mt: 2, fontSize: 12 }}>{setupError}</Alert>
      )}

      {/* O365 Feature Capabilities */}
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Office 365 Capabilities</Typography>
      <Grid container spacing={1}>
        {[
          { name: 'Outlook Email', desc: 'Send clinical letters and referrals' },
          { name: 'Calendar Sync', desc: 'Two-way appointment synchronisation' },
          { name: 'Teams Meetings', desc: 'Generate Teams links for telehealth' },
          { name: 'SharePoint', desc: 'Upload documents to shared library' },
        ].map(f => (
          <Grid key={f.name} size={{ xs: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" fontWeight={600}>{f.name}</Typography>
                <Typography variant="caption" color="text.secondary">{f.desc}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        Permissions: Calendar, Email, Teams, SharePoint, OneDrive. OAuth 2.0 via Microsoft identity platform.
      </Typography>
    </Paper>
  )
}

// ============ License Panel ============

export function LicensePanel() {
  const { data, isLoading } = useQuery({
    queryKey: licenseKeys.all,
    queryFn: async () => {
      try {
        return await apiClient.get<LicenseStatusResponse>('license/status')
      } catch { return null }
    },
  })

  const lic = data?.license

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>License Information</Typography>
      <Divider sx={{ mb: 2 }} />

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {!isLoading && lic?.valid && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <Alert severity="success" icon={<CheckCircleIcon />}>
              License is <strong>active</strong> — {lic.daysRemaining} days remaining
              {lic.gracePeriod && ' (grace period)'}
            </Alert>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Edition</Typography>
            <Typography variant="body1" fontWeight={600}>{lic.edition || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Max Users</Typography>
            <Typography variant="body1" fontWeight={600}>{lic.maxUsers || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Organisation</Typography>
            <Typography variant="body1" fontWeight={600}>{lic.organisationName || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary">Expires</Typography>
            <Typography variant="body1" fontWeight={600}>{lic.expiryDate || '—'}</Typography>
          </Grid>
        </Grid>
      )}

      {!isLoading && !lic?.valid && (
        <Alert role="alert" severity="warning">
          {lic?.error || 'No license activated. Contact Signacare support for a license key.'}
        </Alert>
      )}

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="text.secondary">
        Signacare v1.0 — Mental Health Electronic Medical Record{' | '}
        Support: support@signacare.net
      </Typography>
    </Paper>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Email & Print Settings
// ══════════════════════════════════════════════════════════════════════════════
export function EmailPrintPanel() {
  const [smtpForm, setSmtpForm] = React.useState({
    host: '', port: '587', user: '', pass: '', from: '', useTls: true,
  });
  const [testResult, setTestResult] = React.useState('');
  const [testing, setTesting] = React.useState(false);

  const testEmail = async () => {
    setTesting(true); setTestResult('');
    try {
      const resp = await apiClient.post<SendEmailResponse>('messages/send-email', {
        to: smtpForm.from || smtpForm.user,
        subject: 'Signacare EMR — Test Email',
        body: 'This is a test email from Signacare EMR to verify your email configuration is working correctly.',
      });
      setTestResult(`Email sent via ${resp.method ?? 'configured provider'}. Check your inbox.`);
    } catch (err: unknown) {
      setTestResult(`Failed: ${readErrorMessage(err, 'Unknown error')}`);
    }
    setTesting(false);
  };

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 2 }}>Email & Print Settings</Typography>

      {/* Email Configuration */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Email Configuration</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Letters and correspondence are sent via email. Connect Microsoft 365 (recommended) or configure SMTP.
          </Typography>

          {/* Outlook / O365 */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2, borderLeft: '4px solid #0078D4' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="body2" fontWeight={700}>Microsoft 365 / Outlook</Typography>
                <Typography variant="caption" color="text.secondary">
                  Connect your organisation's email via Office 365. Go to Integrations tab to connect.
                </Typography>
              </Box>
              <Chip label="Recommended" size="small" sx={{ bgcolor: '#E3F2FD', color: '#0078D4', fontWeight: 600, fontSize: 10 }} />
            </Box>
          </Paper>

          {/* SMTP Fallback */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>SMTP (Alternative)</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Configure SMTP if not using Microsoft 365. These settings are stored in the server environment.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="SMTP Host" size="small" fullWidth value={smtpForm.host}
                  onChange={e => setSmtpForm(p => ({ ...p, host: e.target.value }))} placeholder="smtp.gmail.com" />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField label="Port" size="small" fullWidth value={smtpForm.port}
                  onChange={e => setSmtpForm(p => ({ ...p, port: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField label="Username / Email" size="small" fullWidth value={smtpForm.user}
                  onChange={e => setSmtpForm(p => ({ ...p, user: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Password / App Password" size="small" fullWidth type="password" value={smtpForm.pass}
                  onChange={e => setSmtpForm(p => ({ ...p, pass: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="From Address" size="small" fullWidth value={smtpForm.from}
                  onChange={e => setSmtpForm(p => ({ ...p, from: e.target.value }))} placeholder="clinic@example.com" />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button variant="outlined" size="small" onClick={testEmail} disabled={testing}
                    sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
                    {testing ? 'Testing...' : 'Send Test Email'}
                  </Button>
                </Box>
              </Grid>
            </Grid>
            {testResult && (
              <Alert severity={testResult.startsWith('Failed') ? 'error' : 'success'} sx={{ mt: 1.5, fontSize: 11 }}>
                {testResult}
              </Alert>
            )}
            <Alert severity="info" sx={{ mt: 1.5, fontSize: 11 }}>
              SMTP settings are configured in the server environment (.env file):
              SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
            </Alert>
          </Paper>
        </CardContent>
      </Card>

      {/* Print Configuration */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Print Settings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configure default print settings for letters and clinical documents.
          </Typography>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Default Printer</Typography>
                <Typography variant="caption" color="text.secondary">
                  Letters use your browser's default printer. To change the default printer:
                </Typography>
                <Box sx={{ mt: 1, pl: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    macOS: System Preferences → Printers & Scanners → Set Default
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Chrome: Settings → Privacy → Site Settings → Printing
                  </Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Letterhead</Typography>
                <Typography variant="caption" color="text.secondary">
                  Letters automatically include your organisation's details from the Clinic Profile tab.
                  Update your clinic name, address, phone, and email there.
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    For custom letterhead paper, set your printer to skip the top 40mm (header area).
                  </Typography>
                </Box>
              </Grid>
              <Grid size={12}>
                <Button variant="outlined" size="small" onClick={() => {
                  const w = window.open('', '_blank');
                  if (w) {
                    w.document.write('<html><head><title>Print Test</title><style>body{font-family:Georgia,serif;font-size:12pt;margin:40px 60px;}</style></head><body><h2>Print Test — Signacare EMR</h2><p>If you can read this, your printer is configured correctly.</p><p>Date: ' + new Date().toLocaleDateString('en-AU') + '</p></body></html>');
                    w.document.close(); w.focus(); w.print();
                  }
                }} sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
                  Print Test Page
                </Button>
              </Grid>
            </Grid>
          </Paper>
        </CardContent>
      </Card>
    </Box>
  )
}

// ============ Digital Signature Setup ============

function SignatureSetupPanel() {
  const { signature, isLoading, save, isSaving } = useStaffSignature()
  const user = useAuthStore(s => s.user)
  const sigRef = React.useRef<SignatureCanvas>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [editing, setEditing] = React.useState(false)
  const [mode, setMode] = React.useState<'type' | 'draw' | 'upload'>('type')
  const [typedName, setTypedName] = React.useState('')
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
  const [localPreview, setLocalPreview] = React.useState<string | null>(null)

  // Generate a typed signature as a canvas data URL
  const generateTypedSignature = (name: string): string => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 100
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 400, 100)
    ctx.font = 'italic 36px "Brush Script MT", "Segoe Script", "Apple Chancery", cursive'
    ctx.fillStyle = '#3D484B'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, 10, 50)
    return canvas.toDataURL('image/png')
  }

  const doSave = (dataUrl: string) => {
    if (!dataUrl || dataUrl.length < 100) { setSaveStatus('error'); return }
    setLocalPreview(dataUrl)
    setSaveStatus('idle')
    save(dataUrl, {
      onSuccess: () => { setEditing(false); setSaveStatus('success'); setTimeout(() => setSaveStatus('idle'), 3000) },
      onError: () => { setLocalPreview(null); setSaveStatus('error') },
    })
  }

  const handleTypedSave = () => {
    const name = typedName.trim() || `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim()
    if (!name) return
    doSave(generateTypedSignature(name))
  }

  const handleDrawSave = () => {
    if (!sigRef.current) return
    // Always use getCanvas() — getTrimmedCanvas() and isEmpty() are unreliable
    // in react-signature-canvas when CSS width !== canvas attribute width.
    const rawCanvas = sigRef.current.getCanvas()
    const dataUrl = rawCanvas.toDataURL('image/png')
    doSave(dataUrl)
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setSaveStatus('error'); return }
    if (file.size > 500_000) { setSaveStatus('error'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      doSave(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const displaySignature = localPreview ?? signature

  if (isLoading) return <CircularProgress size={24} />

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" mb={1}>
        Digital Signature
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Your saved signature will be used when signing clinical documents, discharge summaries, and vetting tasks.
      </Typography>

      {/* Current signature display */}
      {displaySignature && !editing && (
        <Card variant="outlined" sx={{ maxWidth: 500, mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary" mb={1}>Current Signature</Typography>
            <Box sx={{ border: '1px solid #E0E0E0', borderRadius: 1, p: 2, bgcolor: '#fff', textAlign: 'center' }}>
              <img src={displaySignature} alt="Your saved signature" style={{ maxWidth: '100%', maxHeight: 120 }} />
            </Box>
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button variant="outlined" size="small" onClick={() => { setEditing(true); setLocalPreview(null); setTypedName('') }}
                sx={{ borderColor: '#327C8D', color: '#327C8D' }}>
                Change Signature
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Signature editor */}
      {(editing || !displaySignature) && (
        <Card variant="outlined" sx={{ maxWidth: 500, mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary" mb={1.5}>
              {displaySignature ? 'Update Signature' : 'Set Up Your Signature'}
            </Typography>

            {/* Mode tabs */}
            <Box sx={{ display: 'flex', gap: 0.5, mb: 2 }}>
              {(['type', 'draw', 'upload'] as const).map(m => (
                <Button key={m} size="small" variant={mode === m ? 'contained' : 'outlined'}
                  onClick={() => setMode(m)}
                  sx={mode === m
                    ? { bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'capitalize', fontSize: 12 }
                    : { borderColor: '#ccc', color: '#666', textTransform: 'capitalize', fontSize: 12 }
                  }>
                  {m === 'type' ? 'Type Name' : m === 'draw' ? 'Draw' : 'Upload Image'}
                </Button>
              ))}
            </Box>

            {/* Type mode */}
            {mode === 'type' && (
              <Box>
                <TextField size="small" fullWidth label="Your name" value={typedName}
                  onChange={e => setTypedName(e.target.value)}
                  placeholder={`${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim()}
                  sx={{ mb: 1 }} />
                {/* Preview */}
                <Box sx={{ border: '1px dashed #ddd', borderRadius: 1, p: 2, mb: 1, bgcolor: '#fafafa', minHeight: 60, display: 'flex', alignItems: 'center' }}>
                  <Typography sx={{ fontFamily: '"Brush Script MT", "Segoe Script", "Apple Chancery", cursive', fontSize: 32, fontStyle: 'italic', color: '#3D484B' }}>
                    {typedName.trim() || `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim() || 'Your Name'}
                  </Typography>
                </Box>
                <Button variant="contained" size="small" onClick={handleTypedSave} disabled={isSaving}
                  sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
                  {isSaving ? 'Saving...' : 'Save Signature'}
                </Button>
              </Box>
            )}

            {/* Draw mode */}
            {mode === 'draw' && (
              <Box>
                <Box sx={{ border: '2px solid #ddd', borderRadius: 1, bgcolor: '#fff', mb: 1 }}>
                  <SignatureCanvas ref={sigRef} penColor="#3D484B"
                    canvasProps={{ width: 436, height: 150, style: { width: '100%', height: 150 } }} />
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" onClick={() => sigRef.current?.clear()} sx={{ color: 'text.secondary' }}>Clear</Button>
                  <Box sx={{ flex: 1 }} />
                  <Button variant="contained" size="small" onClick={handleDrawSave} disabled={isSaving}
                    sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
                    {isSaving ? 'Saving...' : 'Save Signature'}
                  </Button>
                </Box>
              </Box>
            )}

            {/* Upload mode */}
            {mode === 'upload' && (
              <Box>
                <Typography variant="body2" color="text.secondary" mb={1}>
                  Upload a PNG or JPG image of your signature (max 500KB, transparent background recommended).
                </Typography>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={handleUpload}
                  style={{ display: 'none' }} />
                <Button variant="outlined" size="small" onClick={() => fileInputRef.current?.click()} disabled={isSaving}
                  sx={{ borderColor: '#327C8D', color: '#327C8D' }}>
                  {isSaving ? 'Saving...' : 'Choose File'}
                </Button>
              </Box>
            )}

            {editing && (
              <Button size="small" onClick={() => setEditing(false)} sx={{ mt: 1, color: 'text.secondary' }}>Cancel</Button>
            )}
          </CardContent>
        </Card>
      )}

      {saveStatus === 'success' && <Alert severity="success" sx={{ maxWidth: 500, mb: 2 }}>Signature saved successfully.</Alert>}
      {saveStatus === 'error' && <Alert severity="error" sx={{ maxWidth: 500, mb: 2 }}>Failed to save signature. Please draw or type your signature and try again.</Alert>}

      <Alert severity="info" sx={{ maxWidth: 500 }}>
        Your signature is stored securely and will be embedded into signed clinical documents, letters, and reports.
      </Alert>
    </Box>
  )
}

// ============ Clinical Policies Panel ============

const DEFAULT_POLICIES = [
  { name: 'Consultant Psychiatrist Review', ruleType: 'review_interval', category: 'review', parameters: { role: 'Consultant Psychiatrist', intervalDays: 90, alertDaysBefore: 14 }, description: 'Every patient should be seen by a consultant psychiatrist at least every 3 months', llmContext: 'Psychiatric review is a mandatory clinical governance requirement. The consultant should review diagnosis, medication efficacy, side effects, risk assessment, and treatment plan. Document in ward round or consultant review note.' },
  { name: 'Lithium Levels', ruleType: 'pathology_interval', category: 'pathology', parameters: { testType: 'Lithium Level', intervalDays: 180, alertDaysBefore: 14 }, description: 'Lithium levels to be checked every 6 months', llmContext: 'Therapeutic range 0.6-0.8 mmol/L (maintenance). Check renal function (U&E, eGFR) and thyroid function simultaneously. Toxicity risk >1.0 mmol/L.' },
  { name: 'Metabolic Monitoring (Antipsychotics)', ruleType: 'pathology_interval', category: 'pathology', parameters: { testType: 'Metabolic Panel', intervalDays: 90, medications: ['olanzapine', 'clozapine', 'quetiapine', 'risperidone'], alertDaysBefore: 14 }, description: 'Metabolic monitoring for patients on antipsychotics every 3 months', llmContext: 'Include fasting glucose, HbA1c, lipid profile, weight, waist circumference, BMI. Olanzapine and clozapine carry highest metabolic risk. Refer to Maudsley Guidelines for monitoring schedule.' },
  { name: 'Clozapine Blood Test', ruleType: 'pathology_interval', category: 'medication', parameters: { testType: 'Clozapine Level', intervalDays: 28, alertDaysBefore: 7 }, description: 'Clozapine blood test every 4 weeks', llmContext: 'FBC with differential (WBC, ANC, neutrophils). Green range: WBC >3.5, ANC >2.0. Amber: WBC 3.0-3.5 or ANC 1.5-2.0. Red: WBC <3.0 or ANC <1.5 — STOP immediately.' },
  { name: 'Care Plan Review', ruleType: 'review_interval', category: 'review', parameters: { role: 'any', intervalDays: 91, alertDaysBefore: 14 }, description: '91-day care plan review for all active episodes', llmContext: 'Comprehensive review of treatment goals, medication plan, psychological interventions, social supports, risk assessment, and community linkages. Document in 91-day review template.' },
  { name: 'Annual Physical Health Check', ruleType: 'pathology_interval', category: 'physical_health', parameters: { testType: 'Annual Physical Exam', intervalDays: 365, alertDaysBefore: 30 }, description: 'Annual comprehensive physical health assessment for all mental health consumers', llmContext: 'Include cardiovascular risk, metabolic screen, dental review, vision/hearing, sexual health, cancer screening age-appropriate, vaccination status, falls risk (elderly).' },
  { name: 'LAI Revalidation', ruleType: 'medication_monitoring', category: 'medication', parameters: { medicationPattern: 'lai', intervalDays: 180, alertDaysBefore: 30 }, description: 'LAI prescription revalidation every 6 months', llmContext: 'Revalidation includes review of clinical rationale for continuation, side effects (especially TD/AIMS), patient consent, blood tests, and consideration of dose reduction or cessation trial.' },
];

const POLICY_CATEGORIES = [
  { value: 'review', label: 'Clinical Review' },
  { value: 'pathology', label: 'Pathology / Investigation' },
  { value: 'medication', label: 'Medication Monitoring' },
  { value: 'physical_health', label: 'Physical Health' },
  { value: 'legal', label: 'Legal / MHA' },
  { value: 'social', label: 'Social / Community' },
];

const RULE_TYPES = [
  { value: 'review_interval', label: 'Review Interval — seen by X every Y days' },
  { value: 'pathology_interval', label: 'Pathology Interval — test X every Y days' },
  { value: 'medication_monitoring', label: 'Medication Monitoring — if on X, monitor Y' },
  { value: 'custom', label: 'Custom — free-text policy for LLM reference only' },
];

export function ClinicalPoliciesPanel() {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null) // null = add mode, string = edit mode
  const [newName, setNewName] = React.useState('')
  const [newDesc, setNewDesc] = React.useState('')
  const [newType, setNewType] = React.useState('review_interval')
  const [newCategory, setNewCategory] = React.useState('review')
  const [newInterval, setNewInterval] = React.useState('90')
  const [newAlertBefore, setNewAlertBefore] = React.useState('14')
  const [newLlmContext, setNewLlmContext] = React.useState('')

  const { data: policies, isLoading } = useQuery({
    queryKey: staffSettingsClinicalPoliciesKeys.all,
    queryFn: () => apiClient.get<ClinicalPoliciesResponse>('staff-settings/clinical-policies').then(r => r.policies ?? []),
  })

  const createMut = useMutation({
    mutationFn: (dto: ClinicalPolicyMutationDto) => apiClient.post('staff-settings/clinical-policies', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: staffSettingsClinicalPoliciesKeys.all }); closeDialog(); },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...dto }: { id: string } & ClinicalPolicyMutationDto) => apiClient.patch(`staff-settings/clinical-policies/${id}`, dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: staffSettingsClinicalPoliciesKeys.all }); closeDialog(); },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.patch(`staff-settings/clinical-policies/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsClinicalPoliciesKeys.all }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`staff-settings/clinical-policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsClinicalPoliciesKeys.all }),
  })

  const closeDialog = () => { setAddOpen(false); setEditId(null); setNewName(''); setNewDesc(''); setNewLlmContext(''); setNewType('review_interval'); setNewCategory('review'); setNewInterval('90'); setNewAlertBefore('14'); }

  const openEdit = (p: ClinicalPolicyRow) => {
    const params = readPolicyParameters(p.parameters);
    setEditId(p.id);
    setNewName(p.name ?? '');
    setNewDesc(p.description ?? '');
    setNewType(p.rule_type ?? p.ruleType ?? 'review_interval');
    setNewCategory(p.category ?? 'review');
    setNewInterval(String(params.intervalDays ?? 90));
    setNewAlertBefore(String(params.alertDaysBefore ?? 14));
    setNewLlmContext(p.llm_context ?? p.llmContext ?? '');
    setAddOpen(true);
  }

  const seedDefaults = () => {
    for (const p of DEFAULT_POLICIES) {
      createMut.mutate({ name: p.name, description: p.description, ruleType: p.ruleType, parameters: p.parameters, llmContext: p.llmContext, category: p.category })
    }
  }

  const categoryColor: Record<string, string> = { review: '#2563EB', pathology: '#7B1FA2', medication: '#C62828', physical_health: '#327C8D', legal: '#E65100', social: '#2E7D32' };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>Clinical Policies</Typography>
          <Typography variant="body2" color="text.secondary">
            Define clinical rules that generate alerts and provide context to the AI. Policies are automatically included in LLM prompts.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {(policies ?? []).length === 0 && (
            <Button size="small" variant="outlined" onClick={seedDefaults} sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
              Load Defaults
            </Button>
          )}
          <Button size="small" variant="contained" onClick={() => { setEditId(null); setAddOpen(true); }} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            Add Policy
          </Button>
        </Box>
      </Box>

      {isLoading && <CircularProgress size={24} />}

      {(policies ?? []).map((p: ClinicalPolicyRow) => {
        const params = readPolicyParameters(p.parameters);
        const cat = p.category ?? p.rule_type?.split('_')[0] ?? 'review';
        const isActive = p.isActive ?? p.is_active;
        return (
          <Paper key={p.id} variant="outlined" sx={{ p: 2, mb: 1, borderLeft: `3px solid ${isActive ? (categoryColor[cat] ?? '#2563EB') : '#ccc'}`, opacity: isActive ? 1 : 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle2" fontWeight={600}>{p.name}</Typography>
                  <Chip label={POLICY_CATEGORIES.find(c => c.value === cat)?.label ?? cat} size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: (categoryColor[cat] ?? '#999') + '15', color: categoryColor[cat] ?? '#999' }} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{p.description}</Typography>
                <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <Chip label={(p.rule_type ?? p.ruleType)} size="small" sx={{ fontSize: 9, height: 18 }} />
                  {params.intervalDays && <Chip label={`Every ${params.intervalDays}d`} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />}
                  {params.alertDaysBefore && <Chip label={`Alert ${params.alertDaysBefore}d before`} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />}
                  {params.testType && <Chip label={params.testType} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />}
                  {params.role && <Chip label={params.role} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />}
                </Box>
                {(p.llm_context ?? p.llmContext) && (
                  <Paper variant="outlined" sx={{ mt: 1, p: 1, bgcolor: '#F3E5F5', borderColor: '#CE93D8' }}>
                    <Typography variant="caption" fontWeight={600} color="#7B1FA2" sx={{ fontSize: 9 }}>AI CONTEXT</Typography>
                    <Typography variant="caption" sx={{ display: 'block', fontSize: 10, mt: 0.3 }}>{p.llm_context ?? p.llmContext}</Typography>
                  </Paper>
                )}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, ml: 1 }}>
                <Button size="small" onClick={() => openEdit(p)}
                  sx={{ color: '#327C8D', fontSize: 11, textTransform: 'none' }}>Edit</Button>
                <Button size="small" onClick={() => toggleMut.mutate({ id: p.id, isActive: !isActive })}
                  sx={{ color: isActive ? '#D32F2F' : '#2E7D32', fontSize: 11, textTransform: 'none' }}>
                  {isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button size="small" onClick={() => { if (confirm(`Delete policy "${p.name}"?`)) deleteMut.mutate(p.id); }}
                  sx={{ color: '#999', fontSize: 11, textTransform: 'none' }}>Delete</Button>
              </Box>
            </Box>
          </Paper>
        )
      })}

      {/* Add / Edit Policy Dialog */}
      <Dialog open={addOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editId ? 'Edit Clinical Policy' : 'Add Clinical Policy'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField label="Policy Name" fullWidth size="small" value={newName} onChange={e => setNewName(e.target.value)} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Description (displayed to clinicians)" fullWidth size="small" multiline rows={2} value={newDesc} onChange={e => setNewDesc(e.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>Rule Type</InputLabel>
                <Select value={newType} onChange={e => setNewType(e.target.value)} label="Rule Type">
                  {RULE_TYPES.map(rt => <MenuItem key={rt.value} value={rt.value}>{rt.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>Category</InputLabel>
                <Select value={newCategory} onChange={e => setNewCategory(e.target.value)} label="Category">
                  {POLICY_CATEGORIES.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            {newType !== 'custom' && (
              <>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="Interval (days)" type="number" fullWidth size="small" value={newInterval} onChange={e => setNewInterval(e.target.value)} /></Grid>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="Alert Before (days)" type="number" fullWidth size="small" value={newAlertBefore} onChange={e => setNewAlertBefore(e.target.value)} /></Grid>
              </>
            )}
            <Grid size={{ xs: 12 }}>
              <TextField label="AI Context (what should the LLM know about this policy?)" fullWidth size="small" multiline rows={3} value={newLlmContext} onChange={e => setNewLlmContext(e.target.value)}
                placeholder="e.g. Therapeutic range, monitoring parameters, escalation criteria, clinical rationale..." />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" disabled={!newName.trim() || (editId ? updateMut.isPending : createMut.isPending)} onClick={() => {
            const payload = {
              name: newName.trim(), description: newDesc.trim() || undefined, ruleType: newType, category: newCategory,
              parameters: newType !== 'custom' ? { intervalDays: parseInt(newInterval, 10) || 90, alertDaysBefore: parseInt(newAlertBefore, 10) || 14 } : {},
              llmContext: newLlmContext.trim() || undefined,
            };
            if (editId) { updateMut.mutate({ id: editId, ...payload }); } else { createMut.mutate(payload); }
          }} sx={{ bgcolor: '#2563EB' }}>{editId ? 'Update Policy' : 'Save Policy'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ============ AI Training Context Panel ============

const CONTEXT_CATEGORIES = [
  { value: 'clinical_guidelines', label: 'Clinical Guidelines' },
  { value: 'local_protocols', label: 'Local Protocols' },
  { value: 'formulary', label: 'Formulary / Drug Info' },
  { value: 'service_directory', label: 'Service Directory' },
  { value: 'templates', label: 'Templates' },
  { value: 'policies', label: 'Policies' },
  { value: 'training_examples', label: 'Training Examples' },
  { value: 'general', label: 'General' },
];

export function AiTrainingContextPanel() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState('');
  const [newDesc, setNewDesc] = React.useState('');
  const [newCategory, setNewCategory] = React.useState('general');
  const [newContent, setNewContent] = React.useState('');
  const [newPriority, setNewPriority] = React.useState('50');
  const [importOpen, setImportOpen] = React.useState(false);
  const [importJson, setImportJson] = React.useState('');

  const { data: files, isLoading } = useQuery({
    queryKey: staffSettingsAiContextKeys.all,
    queryFn: () => apiClient.get<AiContextFilesResponse>('staff-settings/ai-context').then(r => r.files ?? []),
  });

  const createMut = useMutation({
    mutationFn: (dto: AiContextCreateDto) => apiClient.post('staff-settings/ai-context', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: staffSettingsAiContextKeys.all }); setAddOpen(false); setNewTitle(''); setNewContent(''); setNewDesc(''); },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.patch(`staff-settings/ai-context/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsAiContextKeys.all }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`staff-settings/ai-context/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffSettingsAiContextKeys.all }),
  });

  const importMut = useMutation({
    mutationFn: (data: unknown) => apiClient.post<AiContextImportResponse>('staff-settings/ai-context/import', data),
    onSuccess: (r: AiContextImportResponse) => {
      qc.invalidateQueries({ queryKey: staffSettingsAiContextKeys.all });
      qc.invalidateQueries({ queryKey: staffSettingsClinicalPoliciesKeys.all });
      qc.invalidateQueries({ queryKey: llmModelfilesKeys.all });
      qc.invalidateQueries({ queryKey: llmTrainingStatsKeys.all });
      setImportOpen(false);
      alert(`Imported ${r.imported ?? 0} items`);
    },
  });

  const handleExport = async () => {
    try {
      const data = await apiClient.get<Record<string, unknown>>('staff-settings/ai-context/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `ai-context-export-${new Date().toISOString().split('T')[0]}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
  };

  const totalTokens = (files ?? []).filter((f) => f.is_active && f.include_in_rag).reduce((sum: number, f) => sum + (f.token_estimate ?? 0), 0);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>AI Training Context</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage knowledge files that provide context to the AI. These files are automatically included in LLM prompts.
            Export this bundle before migrating to a new install — import it at the new location to preserve context, policies, high-quality feedback examples, and model overrides.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={() => setImportOpen(true)} sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
            Import
          </Button>
          <Button size="small" variant="outlined" onClick={handleExport} sx={{ textTransform: 'none', borderColor: '#7B1FA2', color: '#7B1FA2' }}>
            Export Bundle
          </Button>
          <Button size="small" variant="contained" onClick={() => setAddOpen(true)} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            Add Context File
          </Button>
        </Box>
      </Box>

      {/* Token budget indicator */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: '#F5F9FA', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="caption" fontWeight={600}>RAG Context Budget</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {(files ?? []).filter((f) => f.is_active && f.include_in_rag).length} active files | ~{totalTokens.toLocaleString()} tokens
          </Typography>
        </Box>
        <Chip label={totalTokens > 8000 ? 'High — may impact response quality' : totalTokens > 4000 ? 'Moderate' : 'Good'}
          size="small" sx={{ fontSize: 10, bgcolor: totalTokens > 8000 ? '#FFEBEE' : totalTokens > 4000 ? '#FFF3E0' : '#E8F5E9',
            color: totalTokens > 8000 ? '#C62828' : totalTokens > 4000 ? '#E65100' : '#2E7D32', fontWeight: 600 }} />
      </Paper>

      {isLoading && <CircularProgress size={24} />}

      {(files ?? []).map((f) => (
        <Paper key={f.id} variant="outlined" sx={{ p: 2, mb: 1, borderLeft: `3px solid ${f.is_active ? '#7B1FA2' : '#ccc'}`, opacity: f.is_active ? 1 : 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="subtitle2" fontWeight={600}>{f.title}</Typography>
                <Chip label={CONTEXT_CATEGORIES.find(c => c.value === f.category)?.label ?? f.category} size="small" sx={{ fontSize: 9, height: 18 }} />
                {f.include_in_rag && <Chip label="RAG" size="small" sx={{ fontSize: 8, height: 16, bgcolor: '#F3E5F5', color: '#7B1FA2', fontWeight: 700 }} />}
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>~{(f.token_estimate ?? 0).toLocaleString()} tokens</Typography>
              </Box>
              {f.description && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{f.description}</Typography>}
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontSize: 10, color: '#555', maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {(f.content ?? '').slice(0, 200)}{(f.content ?? '').length > 200 ? '...' : ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, ml: 1 }}>
              <Button size="small" onClick={() => toggleMut.mutate({ id: f.id, isActive: !f.is_active })}
                sx={{ color: f.is_active ? '#D32F2F' : '#2E7D32', fontSize: 11, textTransform: 'none' }}>
                {f.is_active ? 'Disable' : 'Enable'}
              </Button>
              <Button size="small" onClick={() => { if (confirm(`Delete "${f.title}"?`)) deleteMut.mutate(f.id); }}
                sx={{ color: '#999', fontSize: 11, textTransform: 'none' }}>Delete</Button>
            </Box>
          </Box>
        </Paper>
      ))}

      {(files ?? []).length === 0 && !isLoading && (
        <Alert severity="info">No AI context files yet. Add clinical guidelines, local protocols, or service directories to improve AI output quality.</Alert>
      )}

      {/* Add Context Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add AI Context File</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 8 }}><TextField label="Title" fullWidth size="small" value={newTitle} onChange={e => setNewTitle(e.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small"><InputLabel>Category</InputLabel>
                <Select value={newCategory} onChange={e => setNewCategory(e.target.value)} label="Category">
                  {CONTEXT_CATEGORIES.map(c => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12 }}><TextField label="Description (optional)" fullWidth size="small" value={newDesc} onChange={e => setNewDesc(e.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><TextField label="Priority (0=highest, 100=lowest)" type="number" fullWidth size="small" value={newPriority} onChange={e => setNewPriority(e.target.value)} /></Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Content" fullWidth multiline rows={12} value={newContent} onChange={e => setNewContent(e.target.value)}
                placeholder="Paste clinical guidelines, local protocols, formulary information, service directories, or any domain knowledge the AI should reference when generating clinical content..."
                helperText={`~${Math.ceil((newContent.length || 0) / 4).toLocaleString()} tokens`} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!newTitle.trim() || !newContent.trim()} onClick={() => createMut.mutate({
            title: newTitle.trim(), description: newDesc.trim() || undefined, category: newCategory,
            content: newContent.trim(), priority: parseInt(newPriority, 10) || 50,
          })} sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>Save Context File</Button>
        </DialogActions>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Import AI Context Bundle</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Paste the exported JSON bundle from another Signacare install. This imports context files, clinical policies, training examples, and LLM model overrides.
          </Typography>
          <TextField label="JSON Bundle" fullWidth multiline rows={10} value={importJson} onChange={e => setImportJson(e.target.value)}
            placeholder='{"contextFiles":[...],"clinicalPolicies":[...],"trainingExamples":[...],"modelfiles":[...]}' />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setImportOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!importJson.trim()} onClick={() => {
            try { importMut.mutate(JSON.parse(importJson)); } catch { alert('Invalid JSON'); }
          }} sx={{ bgcolor: '#327C8D' }}>Import</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SettingsPage
