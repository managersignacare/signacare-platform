import React from 'react'
import { Alert, Box, CircularProgress, Divider, Tab, Tabs, Typography } from '@mui/material'
import { OrgTreePanel } from '../components/OrgTreePanel'
import { ProgramsPanel } from '../components/ProgramsPanel'
import { ScribeConsentPanel } from '../components/ScribeConsentPanel'
import { ClinicProfilePanel } from '../../settings/components/ClinicProfilePanel'
import { ErxConfigPanel } from '../../settings/components/ErxConfigPanel'
import { ThresholdsPanel } from '../../settings/components/ThresholdsPanel'
import WorkflowBuilderSettingsPanel from '../../settings/components/WorkflowBuilderPanel'
import { useAuthStore } from '../../../shared/store/authStore'

// Lazy-load heavy admin panels — each opens only when its tab is clicked.
// The 4 panels below are defined in SettingsPage.tsx (one large module);
// React.lazy pulls the chunk on first use, then React.Suspense shows
// nothing while it streams (sub-second on a warm cache).
const AuditPage = React.lazy(() => import('../../audit/pages/AuditPage'))
const ClinicalPoliciesPanel = React.lazy(() =>
  import('../../settings/pages/SettingsPage').then(m => ({ default: m.ClinicalPoliciesPanel })))
const AccessControlPanel = React.lazy(() =>
  import('../../staff-settings/components/ModuleAccessMatrix').then(m => ({ default: m.ModuleAccessMatrix })))
const BackupPanel = React.lazy(() =>
  import('../../settings/pages/SettingsPage').then(m => ({ default: m.BackupPanel })))
const LicensePanel = React.lazy(() =>
  import('../../settings/pages/SettingsPage').then(m => ({ default: m.LicensePanel })))

const TabFallback: React.FC = () => (
  <Box
    sx={{
      py: 6,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'text.secondary',
    }}
  >
    <CircularProgress size={28} />
  </Box>
)

type TabId = 'hierarchy' | 'programs' | 'profile' | 'erx' | 'thresholds' | 'scribe-consent' | 'policies' | 'workflows' | 'audit' | 'access' | 'backup' | 'license'

export const OrgSettingsPage: React.FC = () => {
  const [tab, setTab] = React.useState<TabId>('hierarchy')
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  if (!isAdmin) {
    return (
      <Box p={3}>
        <Alert role="alert" severity="error">
          Access denied. Only administrators can access Organisation Settings.
        </Alert>
      </Box>
    )
  }

  return (
    <Box p={3}>
      <Typography variant="h5" mb={0.5}>Organisation Settings</Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Configure the organisational hierarchy, clinic profile, policies, and access control.
        Organisation level labels are managed in Power Settings.
      </Typography>
      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v: TabId) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
        <Tab label="Org Hierarchy" value="hierarchy" />
        <Tab label="Programs" value="programs" />
        <Tab label="Clinic Profile" value="profile" />
        {isAdmin && <Tab label="eRx Setup" value="erx" />}
        <Tab label="Alert Thresholds" value="thresholds" />
        {isAdmin && <Tab label="Scribe Consent" value="scribe-consent" />}
        <Tab label="Clinical Policies" value="policies" />
        {isAdmin && <Tab label="Workflow Builder" value="workflows" />}
        {isAdmin && <Tab label="Audit Log" value="audit" />}
        {isAdmin && <Tab label="Access Control" value="access" />}
        {isAdmin && <Tab label="Backup" value="backup" />}
        {isAdmin && <Tab label="License" value="license" />}
      </Tabs>
      <Divider sx={{ mb: 3 }} />
      {tab === 'hierarchy' && <OrgTreePanel />}
      {tab === 'programs' && <ProgramsPanel />}
      {tab === 'profile' && <ClinicProfilePanel />}
      {tab === 'erx' && isAdmin && <ErxConfigPanel />}
      {tab === 'thresholds' && <ThresholdsPanel />}
      {tab === 'scribe-consent' && isAdmin && <ScribeConsentPanel />}
      {tab === 'policies' && <React.Suspense fallback={<TabFallback />}><ClinicalPoliciesPanel /></React.Suspense>}
      {tab === 'workflows' && isAdmin && <WorkflowBuilderSettingsPanel />}
      {tab === 'audit' && isAdmin && <React.Suspense fallback={<TabFallback />}><AuditPage /></React.Suspense>}
      {tab === 'access' && isAdmin && <React.Suspense fallback={<TabFallback />}><AccessControlPanel variant="tab" /></React.Suspense>}
      {tab === 'backup' && isAdmin && <React.Suspense fallback={<TabFallback />}><BackupPanel /></React.Suspense>}
      {tab === 'license' && isAdmin && <React.Suspense fallback={<TabFallback />}><LicensePanel /></React.Suspense>}
    </Box>
  )
}

export default OrgSettingsPage
