import React, { Suspense, useState, useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthGuard } from './shared/components/guards/AuthGuard';
import { RouteAccessGuard } from './shared/components/guards/RouteAccessGuard';
import {
  SETTINGS_ASYNC_AI_JOBS_PATH,
  SETTINGS_DASHBOARD_OPTIONS_PATH,
} from './shared/navigation/settingsNavigation';
import { AppShell } from './shared/components/ui/AppShell';
import { LoadingOverlay } from './shared/components/ui/LoadingOverlay';
import { ErrorBoundary } from './shared/components/ui/ErrorBoundary';

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Announces route changes to screen readers via an aria-live region.
 * Derives a human-readable page name from the current path.
 */
function RouteAnnouncer(): React.ReactElement {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    // Prefer document.title if set, otherwise derive from the first path segment
    const segment = location.pathname.split('/').filter(Boolean)[0] || '';
    const derived = segment
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const title = document.title && document.title !== 'Signacare'
      ? document.title
      : derived || 'Dashboard';
    setAnnouncement(`Navigated to ${title}`);
  }, [location.pathname]);

  return (
    <div aria-live="polite" aria-atomic="true" role="status" style={visuallyHiddenStyle}>
      {announcement}
    </div>
  );
}

const DraftsPage         = React.lazy(() => import('./features/drafts/pages/DraftsPage'));
const LoginPage          = React.lazy(() => import('./features/auth/pages/LoginPage'));
const MfaPage            = React.lazy(() => import('./features/auth/pages/MfaPage'));
const ChangePasswordPage = React.lazy(() => import('./features/auth/pages/ChangePasswordPage'));
const DashboardPage      = React.lazy(() => import('./features/dashboard/pages/DashboardPage'));
const MyWorkCockpitPage = React.lazy(() => import('./features/dashboard/pages/MyWorkCockpitPage'));
const TeamCommandBoardPage = React.lazy(() => import('./features/dashboard/pages/TeamCommandBoardPage'));
const ManagerCommandBoardPage = React.lazy(() => import('./features/dashboard/pages/ManagerCommandBoardPage'));
const PatientCommandBoardPage = React.lazy(() => import('./features/dashboard/pages/PatientCommandBoardPage'));
const PatientsPage       = React.lazy(() => import('./features/patients/pages/PatientsPage'));
const PatientDetailPage  = React.lazy(() => import('./features/patients/pages/PatientDetailPage'));
const EpisodeDetailPage  = React.lazy(() => import('./features/episodes/pages/EpisodeDetailPage'));
const CalendarPage       = React.lazy(() => import('./features/calendar/pages/CalendarPage'));
const ReferralsPage      = React.lazy(() => import('./features/referrals/pages/ReferralsPage'));
const ReferralCoordinatorQueue = React.lazy(() => import('./features/referrals/pages/ReferralCoordinatorQueue'));
const ReferralDetailPage = React.lazy(() => import('./features/referrals/pages/ReferralDetailPage'));
const MyOffersPage       = React.lazy(() => import('./features/intake/pages/MyOffersPage'));
const ClinicalNotesPage  = React.lazy(() => import('./features/clinical-notes/pages/ClinicalNotesPage'));
const TemplatesPage      = React.lazy(() => import('./features/templates/pages/TemplatesPage'));
const TemplateDetailPage = React.lazy(() => import('./features/templates/pages/TemplateDetailPage'));
const EscalationsPage    = React.lazy(() => import('./features/escalations/pages/EscalationsPage'));
const RiskPage           = React.lazy(() => import('./features/risk/pages/RiskPage'));
const MedicationsPage    = React.lazy(() => import('./features/medications/pages/MedicationsPage'));
const LaiPage            = React.lazy(() => import('./features/lai/pages/LaiPage'));
const ClozapinePage      = React.lazy(() => import('./features/clozapine/pages/ClozapinePage'));
const PathologyPage      = React.lazy(() => import('./features/pathology/pages/PathologyPage'));
const BillingPage        = React.lazy(() => import('./features/billing/pages/BillingPage'));
const TasksPage          = React.lazy(() => import('./features/tasks/pages/TasksPage'));
const MessagesPage       = React.lazy(() => import('./features/messages/pages/MessagesPage'));
const CorrespondencePage = React.lazy(() => import('./features/correspondence/pages/CorrespondencePage'));
const ClinicalReviewPage = React.lazy(() => import('./features/clinical-review/pages/ClinicalReviewPage'));
const ReportsPage        = React.lazy(() => import('./features/reports/pages/ReportsPage'));
const ComplianceDashboardPage = React.lazy(() => import('./features/reports/pages/ComplianceDashboardPage'));
const SettingsPage       = React.lazy(() => import('./features/settings/pages/SettingsPage'));
const VoicePage          = React.lazy(() => import('./features/voice/pages/VoicePage'));
const PowerSettingsPage  = React.lazy(() => import('./features/power-settings/pages/PowerSettingsPage'));
const OrgSettingsPage    = React.lazy(() => import('./features/org-settings/pages/OrgSettingsPage'));
const StaffAssignPage    = React.lazy(() => import('./features/staff-settings/pages/StaffAssignmentsPage'));
const ClinicalListPage   = React.lazy(() => import('./features/lists/pages/ClinicalListPage'));
const AuditPage          = React.lazy(() => import('./features/audit/pages/AuditPage'));
const SubscriptionPage   = React.lazy(() => import('./features/subscription/pages/SubscriptionPage'));
const HotSpotsPage       = React.lazy(() => import('./features/lists/pages/HotSpotsPage'));
const AdmissionWaitlistPage = React.lazy(() => import('./features/lists/pages/AdmissionWaitlistPage'));
const AiAgentPage        = React.lazy(() => import('./features/ai-agent/pages/AiAgentPage'));
const AgenticScribePage  = React.lazy(() => import('./features/agentic-scribe/pages/AgenticScribePage'));
const ExportsPage        = React.lazy(() => import('./features/exports/pages/ExportsPage'));
const GroupTherapyPage   = React.lazy(() => import('./features/group-therapy/pages/GroupTherapyPage'));
const BedBoardPage       = React.lazy(() => import('./features/beds/pages/BedBoardPage'));
// EReferralPage removed — merged into patient detail Referrals tab
const PathwaysPage       = React.lazy(() => import('./features/treatment-pathways/pages/PathwaysPage'));
const HandoverListPage   = React.lazy(() => import('./features/handover/pages/HandoverListPage'));
const ReceptionistPage   = React.lazy(() => import('./features/receptionist/pages/ReceptionistPage'));
const NursingPage        = React.lazy(() => import('./features/nursing/pages/NursingPage'));
const CaseManagementPage = React.lazy(() => import('./features/case-management/pages/CaseManagementPage'));
const ResourcesPage      = React.lazy(() => import('./features/case-management/pages/ResourcesPage'));
const PsychiatristPage   = React.lazy(() => import('./features/psychiatrist/pages/PsychiatristPage'));
const ManagerDashboardPage = React.lazy(() => import('./features/manager/pages/ManagerDashboardPage'));
const MobileScribePage    = React.lazy(() => import('./features/mobile/pages/MobileScribePage'));

function PublicLayout(): React.ReactElement {
  return (
    <ErrorBoundary>
      <RouteAnnouncer />
      <Suspense fallback={<LoadingOverlay fullScreen />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );
}

function ProtectedLayout(): React.ReactElement {
  return (
    <ErrorBoundary>
      <AuthGuard>
        <AppShell>
          <RouteAnnouncer />
          <Suspense fallback={<LoadingOverlay />}>
            <Outlet />
          </Suspense>
        </AppShell>
      </AuthGuard>
    </ErrorBoundary>
  );
}

/**
 * Minimal layout for mobile-first routes under /m/*. Still requires
 * authentication (AuthGuard) but skips the AppShell sidebar + top bar
 * — those are designed for desktop clinician use and render poorly at
 * 360px wide. Used by S7.3 MobileScribePage.
 */
function MobileLayout(): React.ReactElement {
  return (
    <ErrorBoundary>
      <AuthGuard>
        <RouteAnnouncer />
        <Suspense fallback={<LoadingOverlay fullScreen />}>
          <Outlet />
        </Suspense>
      </AuthGuard>
    </ErrorBoundary>
  );
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/mfa',   element: <MfaPage /> },
      { path: '/change-password', element: <ChangePasswordPage /> },
    ],
  },
  {
    element: <ProtectedLayout />,
    children: [
      { path: '/',               element: <Navigate to="/dashboard" replace /> },
      { path: '/dashboard',      element: <DashboardPage /> },
      { path: '/dashboards',     element: <Navigate to={SETTINGS_DASHBOARD_OPTIONS_PATH} replace /> },
      { path: '/dashboards/my-work', element: <MyWorkCockpitPage /> },
      { path: '/dashboards/team-command', element: <TeamCommandBoardPage /> },
      { path: '/dashboards/manager-command', element: <ManagerCommandBoardPage /> },
      { path: '/dashboards/patient-command', element: <PatientCommandBoardPage /> },
      { path: '/patients',       element: <PatientsPage /> },
      { path: '/patients/:id',   element: <PatientDetailPage /> },
      { path: '/episodes/:id',   element: <EpisodeDetailPage /> },
      { path: '/appointments',   element: <Navigate to="/calendar" replace /> },
      { path: '/calendar',       element: <CalendarPage /> },
      { path: '/referrals',      element: <ReferralsPage /> },
      { path: '/referrals/queue', element: <ReferralCoordinatorQueue /> },
      { path: '/referrals/my-offers', element: <MyOffersPage /> },
      { path: '/referrals/:id',  element: <ReferralDetailPage /> },
      {
        path: '/clinical-notes',
        element: (
          <RouteAccessGuard routePath="/clinical-notes">
            <ClinicalNotesPage />
          </RouteAccessGuard>
        ),
      },
      { path: '/templates',      element: <TemplatesPage /> },
      { path: '/templates/:id',  element: <TemplateDetailPage /> },
      { path: '/escalations',    element: <EscalationsPage /> },
      { path: '/risk',           element: <RiskPage /> },
      { path: '/medications',    element: <MedicationsPage /> },
      { path: '/lai',            element: <LaiPage /> },
      { path: '/clozapine',      element: <ClozapinePage /> },
      { path: '/pathology',      element: <PathologyPage /> },
      { path: '/billing',        element: <BillingPage /> },
      { path: '/tasks',          element: <TasksPage /> },
      { path: '/messages',       element: <MessagesPage /> },
      { path: '/correspondence', element: <CorrespondencePage /> },
      { path: '/clinical-review',element: <ClinicalReviewPage /> },
      {
        path: '/reports',
        element: (
          <RouteAccessGuard routePath="/reports">
            <ReportsPage />
          </RouteAccessGuard>
        ),
      },
      {
        path: '/reports/compliance',
        element: (
          <RouteAccessGuard routePath="/reports/compliance">
            <ComplianceDashboardPage />
          </RouteAccessGuard>
        ),
      },
      { path: '/settings',       element: <SettingsPage /> },
      { path: '/settings/async-ai-jobs', element: <Navigate to={SETTINGS_ASYNC_AI_JOBS_PATH} replace /> },
      { path: '/settings/dashboard-options', element: <Navigate to={SETTINGS_DASHBOARD_OPTIONS_PATH} replace /> },
      {
        path: '/power-settings',
        element: (
          <RouteAccessGuard routePath="/power-settings">
            <PowerSettingsPage />
          </RouteAccessGuard>
        ),
      },
      {
        path: '/org-settings',
        element: (
          <RouteAccessGuard routePath="/org-settings">
            <OrgSettingsPage />
          </RouteAccessGuard>
        ),
      },
      {
        path: '/staff-assignments',
        element: (
          <RouteAccessGuard routePath="/staff-assignments">
            <StaffAssignPage />
          </RouteAccessGuard>
        ),
      },
      { path: '/voice',          element: <VoicePage /> },
      {
        path: '/audit',
        element: (
          <RouteAccessGuard routePath="/audit">
            <AuditPage />
          </RouteAccessGuard>
        ),
      },
      { path: '/subscription',   element: <SubscriptionPage /> },
      { path: '/ai-agent',       element: <AiAgentPage /> },
      {
        path: '/agentic-scribe',
        element: (
          <RouteAccessGuard routePath="/agentic-scribe">
            <AgenticScribePage />
          </RouteAccessGuard>
        ),
      },
      { path: '/drafts',          element: <DraftsPage /> },
      { path: '/exports',        element: <ExportsPage /> },
      { path: '/list/lai',        element: <ClinicalListPage listKey="lai" /> },
      { path: '/list/mha',        element: <ClinicalListPage listKey="mha" /> },
      { path: '/list/clozapine',  element: <ClinicalListPage listKey="clozapine" /> },
      { path: '/list/referrals',  element: <ClinicalListPage listKey="referrals" /> },
      { path: '/list/acis',       element: <ClinicalListPage listKey="acis" /> },
      { path: '/list/parc',       element: <ClinicalListPage listKey="parc" /> },
      { path: '/list/ccu',        element: <ClinicalListPage listKey="ccu" /> },
      { path: '/list/ipu',        element: <ClinicalListPage listKey="ipu" /> },
      { path: '/list/op',         element: <ClinicalListPage listKey="op" /> },
      { path: '/list/group',      element: <ClinicalListPage listKey="group" /> },
      { path: '/list/cloz-support', element: <ClinicalListPage listKey="cloz-support" /> },
      { path: '/list/91day',      element: <ClinicalListPage listKey="91day" /> },
      { path: '/list/hotspots',   element: <HotSpotsPage /> },
      { path: '/list/admission-waitlist', element: <AdmissionWaitlistPage /> },
      { path: '/group-therapy',   element: <GroupTherapyPage /> },
      { path: '/bed-board',       element: <BedBoardPage /> },
      // E-Referrals route removed — merged into patient Referrals tab
      {
        path: '/pathways',
        element: (
          <RouteAccessGuard routePath="/pathways">
            <PathwaysPage />
          </RouteAccessGuard>
        ),
      },
      { path: '/handover',        element: <HandoverListPage /> },
      { path: '/receptionist',    element: <ReceptionistPage /> },
      { path: '/nursing',         element: <NursingPage /> },
      { path: '/case-management', element: <CaseManagementPage /> },
      { path: '/community-resources', element: <ResourcesPage /> },
      { path: '/psychiatrist',    element: <PsychiatristPage /> },
      {
        path: '/manager-dashboard',
        element: (
          <RouteAccessGuard routePath="/manager-dashboard">
            <ManagerDashboardPage />
          </RouteAccessGuard>
        ),
      },
    ],
  },
  {
    // S7.3 — Mobile-first routes. Minimal layout (no sidebar / top bar)
    // so a phone can launch straight into the scribe without navigating
    // the desktop shell. Still protected by AuthGuard.
    element: <MobileLayout />,
    children: [
      { path: '/m/scribe',               element: <MobileScribePage /> },
      { path: '/m/scribe/:patientId',    element: <MobileScribePage /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
