import React, { Suspense, useState, useEffect } from 'react';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import BadgeIcon from '@mui/icons-material/Badge';
import { ErrorBoundary } from '../../../../shared/components/ui/ErrorBoundary';
import { useParams, useSearchParams } from 'react-router-dom';
import { useWorkspaceStore } from '../../../../shared/store/workspaceStore';
import { useAuthStore } from '../../../../shared/store/authStore';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePatient } from '../../hooks/usePatient';
import { usePatientFlags } from '../../hooks/usePatientFlags';
import { DutyRelationshipDialog } from './DutyRelationshipDialog';
import { patientDutyRelationshipApi } from '../../services/patientDutyRelationshipApi';
import {
  type AllergySummary,
  type ClinicalIntelligenceSummary,
  type EpisodeSummary,
  type LegalOrderSummary,
  type SmartSummaryPanelProps,
  readApiErrorMessage,
} from './patientDetailSummaryTypes';
import { getActiveAllergies } from './patientDetailBanner';

function useEpisodeData(patientId: string) {
  return useQuery({
    queryKey: episodesKeys.byPatient(patientId),
    queryFn: () => apiClient.get<{ data: EpisodeSummary[] }>(`episodes/patient/${patientId}`).then(r => r.data ?? []),
    enabled: !!patientId,
    staleTime: 30_000,
  });
}
import { FlagBadge } from '../flags/FlagBadge';
import { apiClient } from '../../../../shared/services/apiClient';
import {
  episodesKeys,
  patientsKeys,
  riskAllergiesKeys,
  legalOrdersKeys,
} from '../../queryKeys';
import { useModuleVisibility } from '../../../../shared/hooks/useModuleVisibility';
import { getAllowedDutyRelationshipTypes } from '@signacare/shared';
import { PATIENT_TABS, PATIENT_TAB_GROUPS, type PatientTabId, calculateAge } from '../../types/patientTypes';
import {
  canAccessPatientTab,
  canAccessPermission,
  firstAccessiblePatientTab,
} from '../../../../shared/utils/frontendAccessPolicy';
import { GENDER_LABELS, getInitials } from './patientDetailLayoutHelpers';
import { TAB_COMPONENTS } from './patientDetailTabRegistry';

type WorkbenchMode = 'focus' | 'balanced' | 'review';
type BannerRiskAlert = {
  id: string;
  title?: string | null;
  severity?: string | null;
  isActive?: boolean | null;
  showFlag?: boolean | null;
};

export const PatientDetailLayout: React.FC = () => {
  const { id: patientId = '' } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as PatientTabId) || 'summary';
  const [activeTab, setActiveTab] = useState<PatientTabId>(initialTab);
  const user = useAuthStore((s) => s.user);

  const { isTabVisible } = useModuleVisibility({ patientId });
  const canRenderPatientTab = (tabId: PatientTabId): boolean =>
    isTabVisible(tabId) && canAccessPatientTab(user, tabId);
  const fallbackTab = firstAccessiblePatientTab(user) as PatientTabId;
  const activeTabAllowed = canRenderPatientTab(activeTab);
  const openDocumentationAction = React.useCallback((action: 'note' | 'report') => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'documentation');
    next.set('docAction', action);
    setSearchParams(next, { replace: true });
    setActiveTab('documentation');
  }, [searchParams, setSearchParams]);

  const quickActions = [
    { label: 'Write Note', tab: 'documentation' as PatientTabId, permission: 'note:create' as const, docAction: 'note' as const },
    { label: 'Write Report', tab: 'documentation' as PatientTabId, permission: 'note:create' as const, docAction: 'report' as const },
    { label: 'New Medication', tab: 'medications' as PatientTabId, permission: 'medication:create' as const },
    { label: 'New Referral', tab: 'referrals' as PatientTabId, permission: 'referral:create' as const },
    { label: 'New Appointment', tab: 'appointments' as PatientTabId, permission: 'appointment:create' as const },
    { label: 'New Rating Scale', tab: 'assessments' as PatientTabId, permission: 'episode:update' as const },
  ].filter((action) => canRenderPatientTab(action.tab) && canAccessPermission(user, action.permission));

  const activateTab = React.useCallback((nextTab: PatientTabId) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    next.delete('docAction');
    setSearchParams(next, { replace: true });
    setActiveTab(nextTab);
  }, [searchParams, setSearchParams]);

  const { data: patient, isLoading, isError } = usePatient(patientId);
  const openTab = useWorkspaceStore(s => s.openTab);

  const { data: episodes } = useEpisodeData(patientId);

  const [quickMenuAnchor, setQuickMenuAnchor] = useState<null | HTMLElement>(null);
  const [dutyDialogOpen, setDutyDialogOpen] = useState(false);
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>('balanced');
  const [navigatorOpen, setNavigatorOpen] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const { data: flags } = usePatientFlags(patientId);
  const { data: legalOrders } = useQuery({
    // @catalogued: BUG-241 (Wave B-1) — no factory method for legal-orders banner sub-key
    queryKey: legalOrdersKeys.banner(patientId),
    queryFn: () =>
      apiClient
        .get<{ orders: LegalOrderSummary[] }>(`patients/${patientId}/legal-orders`)
        .then(r => r.orders ?? [])
        .catch((err) => { console.warn('PatientDetailLayout: query failed', err); return []; }),
    enabled: !!patientId, staleTime: 60_000,
  });
  const { data: allergies } = useQuery({
    queryKey: riskAllergiesKeys.allergies(patientId),
    queryFn: () =>
      apiClient
        .get<{ allergies?: AllergySummary[] } | AllergySummary[]>(`patients/${patientId}/allergies`)
        .then(r => (Array.isArray(r) ? r : (r.allergies ?? [])))
        .catch((err) => { console.warn('PatientDetailLayout: query failed', err); return []; }),
    enabled: !!patientId, staleTime: 60_000,
  });
  const { data: patientAlerts } = useQuery({
    queryKey: patientsKeys.alerts(patientId),
    queryFn: () =>
      apiClient
        .get<{ alerts?: BannerRiskAlert[] } | BannerRiskAlert[]>(`patients/${patientId}/alerts`)
        .then((r) => (Array.isArray(r) ? r : (r.alerts ?? [])))
        .catch((err) => { console.warn('PatientDetailLayout: query failed', err); return []; }),
    enabled: !!patientId,
    staleTime: 60_000,
  });
  const allowedDutyRelationshipTypes = getAllowedDutyRelationshipTypes(user?.role ?? null);
  const { data: dutyRelationships } = useQuery({
    queryKey: patientsKeys.dutyRelationshipsMe(patientId),
    queryFn: () => patientDutyRelationshipApi.listMine(patientId),
    enabled: !!patientId && allowedDutyRelationshipTypes.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (patient && patientId) {
      openTab({ id: patientId, name: `${patient.givenName} ${patient.familyName}`, emrNumber: patient.emrNumber ?? '' });
    }
  }, [patient, patientId, openTab]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab') as PatientTabId | null;
    if (requestedTab && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    if (workbenchMode === 'focus') {
      setNavigatorOpen(false);
      setSummaryOpen(false);
      return;
    }
    if (workbenchMode === 'review') {
      setNavigatorOpen(true);
      setSummaryOpen(true);
      return;
    }
    setNavigatorOpen(true);
  }, [workbenchMode]);

  const toggleWorkbenchMode = (nextMode: Exclude<WorkbenchMode, 'balanced'>) => {
    setWorkbenchMode((currentMode) => (currentMode === nextMode ? 'balanced' : nextMode));
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress role="progressbar" aria-label="Loading" sx={{ color: '#b8621a' }} />
      </Box>
    );
  }

  if (isError || !patient) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert role="alert" severity="error" sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
          Failed to load patient record.
        </Alert>
      </Box>
    );
  }

  const dob = patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString('en-AU') : '';
  const age = patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : null;
  const genderLabel = patient.gender ? (GENDER_LABELS[patient.gender] ?? patient.gender) : '';
  const TabComponent = TAB_COMPONENTS[activeTab];
  const activeEpisodes = (episodes ?? []).filter((e: EpisodeSummary) => e.status === 'open');
  const activeFlags = flags?.filter(f => f.status === 'active') ?? [];
  const activeAlertFlags = (patientAlerts ?? []).filter((a) => a.isActive && a.showFlag);
  const hasCritical = activeFlags.some(f => f.severity === 'critical')
    || activeAlertFlags.some(a => a.severity === 'critical');
  const highRisk = hasCritical
    || activeFlags.some(f => f.severity === 'high')
    || activeAlertFlags.some(a => a.severity === 'high');
  const medRisk = activeFlags.some(f => f.severity === 'medium')
    || activeAlertFlags.some(a => a.severity === 'medium');
  const lowRisk = activeFlags.some(f => f.severity === 'low')
    || activeAlertFlags.some(a => a.severity === 'low');
  const hasRiskFlag = activeFlags.length > 0 || activeAlertFlags.length > 0;
  const highRiskTitles = Array.from(new Set([
    ...activeFlags.filter(f => f.severity === 'critical' || f.severity === 'high').map(f => f.title),
    ...activeAlertFlags.filter(a => a.severity === 'critical' || a.severity === 'high').map(a => a.title ?? '').filter(Boolean),
  ]));
  const riskLevel = !hasRiskFlag ? 'Not Recorded' : highRisk ? 'HIGH' : medRisk ? 'MEDIUM' : lowRisk ? 'LOW' : 'UNKNOWN';
  const riskColor = !hasRiskFlag ? '#546E7A' : highRisk ? '#D32F2F' : medRisk ? '#E65100' : '#2E7D32';
  const activeLegalOrders = (legalOrders ?? []).filter(
    (o: LegalOrderSummary) => o.status === 'active' || o.status === 'current',
  );
  const allergyRows = allergies ?? [];
  const activeAllergies = getActiveAllergies(allergyRows);
  const quickWorkbenchTabs: PatientTabId[] = [
    'summary',
    'episodes',
    'documentation',
    'medications',
    'appointments',
    'correspondence',
    'documents',
    '91day-review',
    'pathways',
  ];
  const navWidth = navigatorOpen ? 220 : 44;
  const railWidth = summaryOpen ? (workbenchMode === 'review' ? 360 : 320) : 36;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: '#F8F9FA' }}>
      <Box component="header" sx={{ position: 'sticky', top: 0, zIndex: 100, bgcolor: '#fff', borderBottom: '1px solid #E0E0E0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {highRisk && (
          <Box sx={{ bgcolor: '#FFEBEE', px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid #EF9A9A' }}>
            <Typography variant="caption" sx={{ color: '#C62828', fontWeight: 700, fontSize: 11 }}>
              HIGH RISK — {highRiskTitles.length > 0 ? highRiskTitles.join(', ') : 'Active risk flags present'}
            </Typography>
          </Box>
        )}

        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 38, height: 38, bgcolor: '#3D484B', fontSize: 14, fontWeight: 700, fontFamily: 'Albert Sans, sans-serif' }}>
            {getInitials(patient.givenName, patient.familyName)}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 800, fontSize: 16, color: '#1A1A1A', fontFamily: 'Albert Sans, sans-serif', lineHeight: 1.2 }}>
                {patient.familyName}, {patient.givenName}
              </Typography>
              <Typography variant="caption" sx={{ color: '#666', fontSize: 12 }}>
                MRN: {patient.emrNumber ?? '—'} &middot; DOB: {dob || '—'}{age != null ? ` (${age}y)` : ''} &middot; {genderLabel}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <Chip label={`Risk: ${riskLevel}`} size="small" sx={{ fontWeight: 700, fontSize: 10, height: 22, bgcolor: `${riskColor}15`, color: riskColor, border: `1px solid ${riskColor}40` }} />
            {activeLegalOrders.length > 0 && (
              <Chip label={`MHA: ${activeLegalOrders[0]?.orderTypeName ?? activeLegalOrders[0]?.order_type_name ?? 'Active'}`} size="small"
                sx={{ fontWeight: 700, fontSize: 10, height: 22, bgcolor: '#E8EAF6', color: '#283593', border: '1px solid #9FA8DA' }} />
            )}
            {activeAllergies.length > 0 ? (
              <Chip label={`Allergies: ${activeAllergies.map((a: AllergySummary) => a.allergenName ?? a.allergen_name ?? a.allergen ?? a.name ?? '?').slice(0, 2).join(', ')}${activeAllergies.length > 2 ? ` +${activeAllergies.length - 2}` : ''}`}
                size="small" sx={{ fontWeight: 700, fontSize: 10, height: 22, bgcolor: '#FCE4EC', color: '#C62828', border: '1px solid #EF9A9A' }} />
            ) : allergyRows.length > 0 ? (
              <Chip label="Allergies: None Active" size="small" sx={{ fontWeight: 600, fontSize: 10, height: 22, bgcolor: '#ECEFF1', color: '#455A64', border: '1px solid #B0BEC5' }} />
            ) : (
              <Chip label="Allergies: Not Recorded" size="small" sx={{ fontWeight: 600, fontSize: 10, height: 22, bgcolor: '#ECEFF1', color: '#455A64', border: '1px solid #B0BEC5' }} />
            )}
            {(dutyRelationships ?? []).map((relationship) => (
              <Chip
                key={relationship.id}
                label={`${relationship.relationshipType === 'duty_prescriber' ? 'Duty Prescriber' : 'Duty Clinician'} until ${new Date(relationship.expiresAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`}
                size="small"
                sx={{
                  fontWeight: 700,
                  fontSize: 10,
                  height: 22,
                  bgcolor: '#FFF8E1',
                  color: '#8D6E00',
                  border: '1px solid #E6C34D',
                }}
              />
            ))}
          </Box>

          <Button size="small" variant="contained" startIcon={<span style={{ fontSize: 16, fontWeight: 700 }}>+</span>}
            onClick={e => setQuickMenuAnchor(e.currentTarget)}
            sx={{ bgcolor: '#2563EB', '&:hover': { bgcolor: '#1D4ED8' }, textTransform: 'none', fontSize: 12, fontWeight: 600, minWidth: 0, px: 1.5, py: 0.5 }}>
            New
          </Button>
          <Menu
            anchorEl={quickMenuAnchor}
            open={Boolean(quickMenuAnchor)}
            onClose={() => setQuickMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {quickActions.map((a) => (
              <MenuItem
                key={a.label}
                onClick={() => {
                  setQuickMenuAnchor(null);
                  if (a.docAction) {
                    openDocumentationAction(a.docAction);
                    return;
                  }
                  activateTab(a.tab);
                }}
                sx={{ fontSize: 13 }}
              >
                {a.label}
              </MenuItem>
            ))}
            {quickActions.length === 0 && (
              <MenuItem disabled sx={{ fontSize: 13 }}>
                No actions available for your role
              </MenuItem>
            )}
          </Menu>

          {allowedDutyRelationshipTypes.length > 0 && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<BadgeIcon sx={{ fontSize: 16 }} />}
              onClick={() => setDutyDialogOpen(true)}
              sx={{
                textTransform: 'none',
                fontSize: 12,
                fontWeight: 600,
                minWidth: 0,
                px: 1.5,
                py: 0.5,
              }}
            >
              Duty Access
            </Button>
          )}
          <BannerHotSpotButton patientId={patientId} />
          <BannerAdmissionFlagButton patientId={patientId} />
        </Box>

        <Box sx={{ px: 2, pb: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" sx={{ color: '#999', fontSize: 10, mr: 0.5 }}>EPISODES:</Typography>
          {activeEpisodes.map((ep: EpisodeSummary) => (
            <Chip key={ep.id} label={ep.title ?? ep.episodeType ?? 'Episode'} size="small"
              onClick={() => activateTab('episodes')}
              sx={{ fontSize: 10, height: 20, bgcolor: '#E8F5E9', color: '#2E7D32', fontWeight: 600, border: '1px solid #A5D6A7', cursor: 'pointer' }} />
          ))}
          {activeEpisodes.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>No active episodes</Typography>}
        </Box>

        <Box sx={{ px: 2, pb: 1.2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: '#6B7280', fontWeight: 700, letterSpacing: '0.06em' }}>
              WORKBENCH
            </Typography>
            <Chip
              size="small"
              label="Focus"
              color={workbenchMode === 'focus' ? 'primary' : 'default'}
              variant={workbenchMode === 'focus' ? 'filled' : 'outlined'}
              onClick={() => toggleWorkbenchMode('focus')}
            />
            <Chip
              size="small"
              label="Review"
              color={workbenchMode === 'review' ? 'primary' : 'default'}
              variant={workbenchMode === 'review' ? 'filled' : 'outlined'}
              onClick={() => toggleWorkbenchMode('review')}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {quickWorkbenchTabs.filter((tabId) => canRenderPatientTab(tabId)).map((tabId) => {
              const tab = PATIENT_TABS.find((t) => t.id === tabId);
              if (!tab) return null;
              return (
                <Chip
                  key={tabId}
                  size="small"
                  label={tab.label}
                  onClick={() => activateTab(tabId)}
                  sx={{
                    height: 22,
                    fontSize: 10,
                    border: activeTab === tabId ? '1px solid #2563EB' : '1px solid #D1D5DB',
                    bgcolor: activeTab === tabId ? '#EFF6FF' : '#fff',
                    color: activeTab === tabId ? '#1D4ED8' : '#374151',
                    fontWeight: activeTab === tabId ? 700 : 500,
                  }}
                />
              );
            })}
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Box
          sx={{
            width: { xs: 0, md: navWidth },
            flexShrink: 0,
            bgcolor: '#fff',
            borderRight: { xs: 'none', md: '1px solid #E8E8E8' },
            overflow: 'hidden',
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            transition: 'width 0.2s ease',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: navigatorOpen ? 'space-between' : 'center', px: 0.75, py: 0.75, borderBottom: '1px solid #F0F2F4' }}>
            {navigatorOpen && (
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#6B7280', letterSpacing: '0.06em' }}>
                FILE EXPLORER
              </Typography>
            )}
            <IconButton
              size="small"
              onClick={() => setNavigatorOpen((prev) => !prev)}
              aria-label={navigatorOpen ? 'Collapse file explorer' : 'Expand file explorer'}
              sx={{ width: 24, height: 24 }}
            >
              <Typography sx={{ fontSize: 11, color: '#6B7280' }}>{navigatorOpen ? '◀' : '▶'}</Typography>
            </IconButton>
          </Box>

          {navigatorOpen ? (
            <Box sx={{ overflowY: 'auto' }}>
              {PATIENT_TAB_GROUPS.map(group => {
                const visibleTabs = group.tabs.filter((tid) => canRenderPatientTab(tid as PatientTabId));
                if (visibleTabs.length === 0) return null;
                return (
                  <Box key={group.label} sx={{ mb: 0.5 }}>
                    <Typography variant="caption" sx={{ px: 1.5, pt: 1.5, pb: 0.5, display: 'block', color: '#9CA3AF', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {group.label}
                    </Typography>
                    {visibleTabs.map(tid => {
                      const tab = PATIENT_TABS.find(t => t.id === tid);
                      if (!tab) return null;
                      const isActive = activeTab === tid;
                      const activate = () => activateTab(tid);
                      return (
                        <Box
                          key={tid}
                          role="button"
                          tabIndex={0}
                          aria-current={isActive ? 'page' : undefined}
                          aria-label={`Open ${tab.label} tab`}
                          onClick={activate}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
                          sx={{ px: 1.5, py: 0.7, cursor: 'pointer', fontSize: 12, fontFamily: 'Albert Sans, sans-serif', fontWeight: isActive ? 700 : 500,
                            color: isActive ? '#1D4ED8' : '#374151', bgcolor: isActive ? '#EFF6FF' : 'transparent',
                            borderLeft: isActive ? '3px solid #2563EB' : '3px solid transparent',
                            '&:hover': { bgcolor: isActive ? '#EFF6FF' : '#F8FAFC' },
                            '&:focus-visible': { outline: '2px solid #2563EB', outlineOffset: -2 },
                            transition: 'all 0.1s' }}>
                          {tab.label}
                        </Box>
                      );
                    })}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 0.6, overflowY: 'auto' }}>
              {quickWorkbenchTabs.filter((tabId) => canRenderPatientTab(tabId)).map((tabId) => {
                const tab = PATIENT_TABS.find((t) => t.id === tabId);
                if (!tab) return null;
                const selected = activeTab === tabId;
                return (
                  <Tooltip key={tabId} title={tab.label} placement="right">
                    <Box
                      role="button"
                      tabIndex={0}
                      onClick={() => activateTab(tabId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          activateTab(tabId);
                        }
                      }}
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: 1,
                        border: selected ? '1px solid #2563EB' : '1px solid #D1D5DB',
                        bgcolor: selected ? '#EFF6FF' : '#fff',
                        color: selected ? '#1D4ED8' : '#4B5563',
                        fontSize: 10,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      {tab.label.slice(0, 2).toUpperCase()}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          )}
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          <Box sx={{ px: { xs: 1.5, sm: 2.5 }, py: { xs: 1.5, sm: 2 }, maxWidth: '100%' }}>
            {!activeTabAllowed ? (
              <Alert
                role="alert"
                severity="warning"
                action={(
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => activateTab(fallbackTab)}
                  >
                    Go to permitted tab
                  </Button>
                )}
              >
                You are not authorized to view this clinical surface.
              </Alert>
            ) : (
              <ErrorBoundary key={`${patientId}-${activeTab}`}>
                <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: '#2563EB' }} /></Box>}>
                  <TabComponent patientId={patientId} />
                </Suspense>
              </ErrorBoundary>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            display: { xs: 'none', lg: 'flex' },
            flexDirection: 'column',
            borderLeft: '1px solid #E8E8E8',
            width: railWidth,
            flexShrink: 0,
            bgcolor: '#fff',
            overflow: 'hidden',
            transition: 'width 0.2s ease',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: summaryOpen ? 'space-between' : 'center', alignItems: 'center', p: 0.75, borderBottom: '1px solid #f0f0f0' }}>
            {summaryOpen && (
              <Typography variant="caption" sx={{ color: '#6B7280', letterSpacing: '0.06em', fontWeight: 700 }}>
                CLINICAL INTELLIGENCE
              </Typography>
            )}
            <IconButton
              size="small"
              onClick={() => setSummaryOpen((prev) => !prev)}
              aria-label={summaryOpen ? 'Collapse intelligence rail' : 'Expand intelligence rail'}
              sx={{ width: 24, height: 24 }}
            >
              <Typography sx={{ fontSize: 11, color: '#6B7280' }}>{summaryOpen ? '▶' : '◀'}</Typography>
            </IconButton>
          </Box>
          {summaryOpen ? (
            <Box sx={{ overflowY: 'auto', flex: 1 }}>
              <ErrorBoundary key={patientId} fallback={<Box sx={{ p: 1.5 }}><Typography variant="caption" color="text.secondary">Summary unavailable</Typography></Box>}>
                <SmartSummaryPanel patientId={patientId} patient={patient} activeFlags={activeFlags} />
              </ErrorBoundary>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1 }}>
              <Typography sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, color: '#6B7280', letterSpacing: '0.12em' }}>
                INTEL
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      <DutyRelationshipDialog
        open={dutyDialogOpen}
        patientId={patientId}
        onClose={() => setDutyDialogOpen(false)}
      />
    </Box>
  );
};

// Smart Summary Panel — AI-powered contextual insights.
const SECTION_STYLE = { mb: 1.5 };
const SECTION_TITLE = { fontWeight: 700, color: '#3D484B', fontSize: 10, display: 'block', mb: 0.5 };
const ITEM_TEXT = { fontSize: 10, color: '#555', display: 'block', lineHeight: 1.5 };
const ALERT_DOT = (color: string) => ({ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0, mt: '3px' });

function SmartSummaryPanel({ patientId, patient, activeFlags }: SmartSummaryPanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: patientsKeys.clinicalIntelligenceSummary(patientId),
    queryFn: () => apiClient.get<ClinicalIntelligenceSummary>(`patients/${patientId}/clinical-intelligence-summary`),
    enabled: !!patientId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={18} sx={{ color: '#2563EB' }} />
      </Box>
    );
  }

  if (isError || !data) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Alert severity="warning" sx={{ fontSize: 11 }}>
          Clinical intelligence is unavailable right now.
        </Alert>
      </Box>
    );
  }

  const outcomeDirectionLabel = data.trends.outcomeDirection === 'worsening'
    ? 'Worsening'
    : data.trends.outcomeDirection === 'improving'
    ? 'Improving'
    : data.trends.outcomeDirection === 'stable'
    ? 'Stable'
    : 'Insufficient data';
  const outcomeColor = data.trends.outcomeDirection === 'worsening'
    ? '#C62828'
    : data.trends.outcomeDirection === 'improving'
    ? '#2E7D32'
    : data.trends.outcomeDirection === 'stable'
    ? '#1565C0'
    : '#546E7A';
  const nextReviewLabel = data.due.next91DayReviewDueDate
    ? new Date(data.due.next91DayReviewDueDate).toLocaleDateString('en-AU')
    : 'Not recorded';
  const missingSafetyFields: string[] = [];
  if (!patient.consentToTreatment) missingSafetyFields.push('consent');
  if (!patient.nokName) missingSafetyFields.push('next-of-kin');
  if (!patient.gpName) missingSafetyFields.push('GP');

  return (
    <Box sx={{ p: 1.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
        <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 8, color: '#2563EB' }}>AI</Typography>
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: '#999', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Clinical Intelligence</Typography>
      </Box>

      {data.meta.state !== 'ok' && (
        <Alert severity={data.meta.state === 'degraded' ? 'warning' : 'info'} sx={{ mb: 1.5, fontSize: 11 }}>
          Partial summary ({data.meta.state}) — unavailable: {data.meta.failedSources.join(', ')}
        </Alert>
      )}

      {/* ── 1. Active Alerts / Flags ── */}
      {activeFlags.length > 0 && (
        <Box sx={SECTION_STYLE}>
          <Typography variant="caption" sx={SECTION_TITLE}>Alerts ({activeFlags.length})</Typography>
          {activeFlags.slice(0, 4).map(f => (
            <Box key={f.id} sx={{ display: 'flex', gap: 0.5, mb: 0.3 }}>
              <Box sx={ALERT_DOT(f.severity === 'high' ? '#D32F2F' : f.severity === 'medium' ? '#E65100' : '#2E7D32')} />
              <Typography variant="caption" sx={ITEM_TEXT}>{f.title}</Typography>
            </Box>
          ))}
          {activeFlags.length > 4 && <Typography variant="caption" sx={{ ...ITEM_TEXT, color: '#999' }}>+{activeFlags.length - 4} more</Typography>}
        </Box>
      )}

      {/* ── 2. Current workload ── */}
      <Box sx={SECTION_STYLE}>
        <Typography variant="caption" sx={SECTION_TITLE}>Now</Typography>
        <Typography variant="caption" sx={ITEM_TEXT}>Active clinical flags: {data.now.activeFlags}</Typography>
        <Typography variant="caption" sx={ITEM_TEXT}>High-risk flags: {data.now.highRiskFlags}</Typography>
        <Typography variant="caption" sx={ITEM_TEXT}>Open tasks: {data.now.openTasks}</Typography>
        <Typography variant="caption" sx={{ ...ITEM_TEXT, color: data.now.overdueTasks > 0 ? '#C62828' : '#555' }}>
          Overdue tasks: {data.now.overdueTasks}
        </Typography>
        <Typography variant="caption" sx={{ ...ITEM_TEXT, color: data.now.dnaLast90Days > 0 ? '#E65100' : '#555' }}>
          DNA last 90d: {data.now.dnaLast90Days}
        </Typography>
      </Box>

      {/* ── 3. Due windows ── */}
      <Box sx={SECTION_STYLE}>
        <Typography variant="caption" sx={SECTION_TITLE}>Due</Typography>
        <Typography variant="caption" sx={ITEM_TEXT}>Appointments (next 7d): {data.due.upcomingAppointments7Days}</Typography>
        <Typography variant="caption" sx={{ ...ITEM_TEXT, color: data.due.overdueLaiAdministrations > 0 ? '#C62828' : '#555' }}>
          LAI overdue: {data.due.overdueLaiAdministrations}
        </Typography>
        <Typography variant="caption" sx={ITEM_TEXT}>LAI upcoming (7d): {data.due.upcomingLaiAdministrations7Days}</Typography>
        <Typography variant="caption" sx={{ ...ITEM_TEXT, color: data.due.overdueMhaReviews > 0 ? '#C62828' : '#555' }}>
          MHA overdue: {data.due.overdueMhaReviews}
        </Typography>
        <Typography variant="caption" sx={ITEM_TEXT}>MHA upcoming (30d): {data.due.upcomingMhaReviews30Days}</Typography>
        <Typography variant="caption" sx={{ ...ITEM_TEXT, color: data.due.overdue91DayReview ? '#C62828' : '#2E7D32' }}>
          91-day review: {data.due.overdue91DayReview ? 'Overdue' : `Next due ${nextReviewLabel}`}
        </Typography>
      </Box>

      {/* ── 4. Trends ── */}
      <Box sx={SECTION_STYLE}>
        <Typography variant="caption" sx={SECTION_TITLE}>Trends</Typography>
        <Typography variant="caption" sx={ITEM_TEXT}>
          Last signed note:{' '}
          {data.trends.daysSinceLastClinicalNote == null
            ? 'Not recorded'
            : data.trends.daysSinceLastClinicalNote === 0
            ? 'Today'
            : `${data.trends.daysSinceLastClinicalNote}d ago`}
        </Typography>
        <Typography variant="caption" sx={{ ...ITEM_TEXT, color: outcomeColor }}>
          Outcome trend: {outcomeDirectionLabel}
          {data.trends.lastOutcomeScore != null ? ` (${data.trends.lastOutcomeScore})` : ''}
          {data.trends.previousOutcomeScore != null ? ` vs ${data.trends.previousOutcomeScore}` : ''}
        </Typography>
        {data.trends.nextBirthdayInDays != null && data.trends.nextBirthdayInDays <= 30 && (
          <Typography variant="caption" sx={{ ...ITEM_TEXT, color: '#6A1B9A' }}>
            Birthday in {data.trends.nextBirthdayInDays} day{data.trends.nextBirthdayInDays === 1 ? '' : 's'}
          </Typography>
        )}
      </Box>

      {/* ── 5. Safety profile completeness ── */}
      {missingSafetyFields.length > 0 && (
        <Box sx={{ p: 0.75, bgcolor: '#FFF5F5', borderRadius: 1, border: '1px solid #FFCDD2', mb: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#C62828', fontSize: 9 }}>
            Missing safety profile: {missingSafetyFields.join(' · ')}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

interface BannerHotSpotButtonProps { patientId: string }
function BannerHotSpotButton({ patientId }: BannerHotSpotButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const qc = useQueryClient();

  const addMut = useMutation({
    mutationFn: () => apiClient.post(`patients/${patientId}/hotspot`, { reason: reason.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: patientsKeys.hotspotsInvalidate() }); setOpen(false); setReason(''); },
  });

  return (
    <>
      <Tooltip title="Add to Hot Spots">
        <IconButton
          size="small"
          aria-label="Add to Hot Spots"
          onClick={() => setOpen(true)}
          sx={{
            color: '#D32F2F',
            border: '1px solid',
            borderColor: '#D32F2F',
            borderRadius: 1,
            p: 0.5,
            '&:hover': { bgcolor: '#FFEBEE', borderColor: '#B71C1C' },
          }}
        >
          <WhatshotIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Dialog aria-labelledby="hotspot-dialog-title" open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="hotspot-dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>Add to Hot Spots</DialogTitle>
        <Divider />
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Adding this patient to hot spots indicates early warning signs or concerns requiring heightened monitoring.
          </Typography>
          <TextField
            autoFocus
            label="Reason for Hot Spot *"
            fullWidth
            multiline
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Describe the concerns or early warning signs..."
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => addMut.mutate()}
            disabled={!reason.trim() || addMut.isPending}
            sx={{ bgcolor: '#D32F2F', '&:hover': { bgcolor: '#B71C1C' } }}
          >
            {addMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Add to Hot Spots'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

interface BannerAdmissionFlagButtonProps { patientId: string }
function BannerAdmissionFlagButton({ patientId }: BannerAdmissionFlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState('medium');
  const [reason, setReason] = useState('');
  const [preferredWard, setPreferredWard] = useState('');
  const qc = useQueryClient();

  const flagMut = useMutation({
    mutationFn: () => apiClient.post(`patients/${patientId}/flag-for-admission`, {
      priority, reason: reason.trim() || undefined, preferredWard: preferredWard.trim() || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: patientsKeys.waitlistInvalidate() }); setOpen(false); setReason(''); },
    onError: (err: unknown) => alert(readApiErrorMessage(err, 'Failed')),
  });

  return (
    <>
      <Tooltip title="Flag for Planned Admission">
        <IconButton size="small" aria-label="Flag for admission" onClick={() => setOpen(true)}
          sx={{ color: '#C62828', border: '1px solid', borderColor: '#C62828', borderRadius: 1, p: 0.5, '&:hover': { bgcolor: '#FFEBEE' } }}>
          <LocalHospitalIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#C62828' }}>Flag for Planned Admission</DialogTitle>
        <Divider />
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This patient will be added to the Admission Waitlist as a planned admission (not from hotspot).
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl fullWidth size="small"><InputLabel>Priority</InputLabel>
              <Select value={priority} onChange={e => setPriority(e.target.value)} label="Priority">
                <MenuItem value="low">Low</MenuItem><MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem><MenuItem value="urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Reason for Admission *" fullWidth multiline rows={2} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Medication titration, risk escalation, deteriorating mental state" />
            <TextField label="Preferred Ward" fullWidth size="small" value={preferredWard} onChange={e => setPreferredWard(e.target.value)}
              placeholder="e.g. IPU, HDU, PARC" />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={() => flagMut.mutate()} disabled={!reason.trim() || flagMut.isPending}
            sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' } }}>
            {flagMut.isPending ? 'Flagging...' : 'Flag for Admission'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

interface BannerFlagsProps { patientId: string; onClickAlerts: () => void }
export function BannerFlags({ patientId, onClickAlerts }: BannerFlagsProps) {
  const { data: flags } = usePatientFlags(patientId);
  const active = flags?.filter(f => f.status === 'active') ?? [];
  if (!active.length) return null;
  // BUG-447-patient-detail-shell: keyboard-operable banner-flags click
  // target. role="button"+tabIndex={0}+onKeyDown lets a keyboard-only
  // clinician focus the banner and press Enter/Space to open the alerts
  // panel — same outcome as a mouse click.
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`View ${active.length} active patient alert${active.length === 1 ? '' : 's'}`}
      onClick={onClickAlerts}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClickAlerts(); } }}
      sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5, flexWrap: 'wrap', cursor: 'pointer', '&:focus-visible': { outline: '2px solid #2563EB', outlineOffset: 2 } }}
      title="Click or press Enter/Space to view alerts"
    >
      {active.slice(0, 5).map(f => <FlagBadge key={f.id} flag={f} compact />)}
      {active.length > 5 && <Chip label={`+${active.length - 5}`} size="small" sx={{ fontSize: 10, height: 18 }} />}
    </Box>
  );
}
