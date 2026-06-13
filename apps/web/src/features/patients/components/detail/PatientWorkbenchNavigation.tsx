import React from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  DEFAULT_HIDDEN_PATIENT_TABS,
  PATIENT_TABS,
  PATIENT_TAB_GROUPS,
  type PatientTabId,
} from '../../types/patientTypes';

type WorkbenchMode = 'focus' | 'balanced' | 'review';

export const WORKBENCH_HIDDEN_KEY = 'patient-workbench-hidden-tabs';

const DEFAULT_HIDDEN_WORKBENCH_TABS = new Set<string>(DEFAULT_HIDDEN_PATIENT_TABS);
const QUICK_WORKBENCH_TABS: readonly PatientTabId[] = [
  'summary',
  'documentation',
  'medications',
  'appointments',
  'overview',
  'correspondence',
  'documents',
  '91day-review',
  'pathways',
];

interface WorkbenchCustomisationDialogProps {
  groups: Array<{ label: string; tabs: PatientTabId[] }>;
  hiddenTabs: Set<string>;
  onClose: () => void;
  onReset: () => void;
  onToggle: (tabId: PatientTabId) => void;
  open: boolean;
}

interface UsePatientWorkbenchNavigationOptions {
  activeTab: PatientTabId;
  activateTab: (tabId: PatientTabId) => void;
  canRenderPatientTab: (tabId: PatientTabId) => boolean;
}

interface WorkbenchContextMenuState {
  mouseX: number;
  mouseY: number;
  tabId: PatientTabId;
  tabLabel: string;
}

function WorkbenchCustomisationDialog({
  groups,
  hiddenTabs,
  onClose,
  onReset,
  onToggle,
  open,
}: WorkbenchCustomisationDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Customise Workbench</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Toggle workbench navigation items on or off. You can also right-click a workbench item to hide it quickly.
        </Typography>
        {groups.map((group) => (
          <Box key={group.label} sx={{ mb: 2 }}>
            <Typography
              variant="caption"
              sx={{ display: 'block', mb: 0.75, color: '#6B7280', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              {group.label}
            </Typography>
            {group.tabs.map((tabId) => {
              const tab = PATIENT_TABS.find((candidate) => candidate.id === tabId);
              if (!tab) {
                return null;
              }

              return (
                <Box
                  key={tabId}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.4, px: 0.75, borderRadius: 1, '&:hover': { bgcolor: '#F8FAFC' } }}
                >
                  <Typography variant="body2">{tab.label}</Typography>
                  <Switch
                    checked={!hiddenTabs.has(tabId)}
                    inputProps={{ 'aria-label': `Toggle ${tab.label} workbench visibility` }}
                    onChange={() => onToggle(tabId)}
                    size="small"
                  />
                </Box>
              );
            })}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onReset}>Reset defaults</Button>
        <Button onClick={onClose} variant="contained">Done</Button>
      </DialogActions>
    </Dialog>
  );
}

function loadHiddenWorkbenchTabs(): Set<string> {
  try {
    const saved = localStorage.getItem(WORKBENCH_HIDDEN_KEY);
    if (!saved) {
      return new Set(DEFAULT_HIDDEN_WORKBENCH_TABS);
    }

    const parsed = JSON.parse(saved) as string[];
    return new Set(parsed);
  } catch {
    return new Set(DEFAULT_HIDDEN_WORKBENCH_TABS);
  }
}

function saveHiddenWorkbenchTabs(hiddenTabs: Set<string>): void {
  localStorage.setItem(WORKBENCH_HIDDEN_KEY, JSON.stringify([...hiddenTabs]));
}

export function usePatientWorkbenchNavigation({
  activeTab,
  activateTab,
  canRenderPatientTab,
}: UsePatientWorkbenchNavigationOptions) {
  const [navigatorOpen, setNavigatorOpen] = React.useState(true);
  const [workbenchCustomizeOpen, setWorkbenchCustomizeOpen] = React.useState(false);
  const [hiddenWorkbenchTabs, setHiddenWorkbenchTabs] = React.useState<Set<string>>(loadHiddenWorkbenchTabs);
  const [workbenchContextMenu, setWorkbenchContextMenu] = React.useState<WorkbenchContextMenuState | null>(null);

  React.useEffect(() => {
    saveHiddenWorkbenchTabs(hiddenWorkbenchTabs);
  }, [hiddenWorkbenchTabs]);

  const findFirstVisibleWorkbenchTab = React.useCallback((hiddenTabs: Set<string>): PatientTabId | null => {
    const orderedTabs = PATIENT_TAB_GROUPS.flatMap((group) => group.tabs);
    return orderedTabs.find((tabId) => canRenderPatientTab(tabId) && !hiddenTabs.has(tabId)) ?? null;
  }, [canRenderPatientTab]);

  const toggleWorkbenchTabVisibility = React.useCallback((tabId: PatientTabId) => {
    setHiddenWorkbenchTabs((currentHiddenTabs) => {
      const nextHiddenTabs = new Set(currentHiddenTabs);
      if (nextHiddenTabs.has(tabId)) {
        nextHiddenTabs.delete(tabId);
      } else {
        nextHiddenTabs.add(tabId);
      }

      if (activeTab === tabId && nextHiddenTabs.has(tabId)) {
        const nextVisibleTab = findFirstVisibleWorkbenchTab(nextHiddenTabs);
        if (nextVisibleTab && nextVisibleTab !== tabId) {
          activateTab(nextVisibleTab);
        }
      }

      return nextHiddenTabs;
    });
  }, [activateTab, activeTab, findFirstVisibleWorkbenchTab]);

  const resetWorkbenchTabs = React.useCallback(() => {
    const nextHiddenTabs = new Set(DEFAULT_HIDDEN_WORKBENCH_TABS);
    setHiddenWorkbenchTabs(nextHiddenTabs);

    if (nextHiddenTabs.has(activeTab)) {
      const nextVisibleTab = findFirstVisibleWorkbenchTab(nextHiddenTabs);
      if (nextVisibleTab && nextVisibleTab !== activeTab) {
        activateTab(nextVisibleTab);
      }
    }
  }, [activateTab, activeTab, findFirstVisibleWorkbenchTab]);

  const filteredQuickWorkbenchTabs = React.useMemo(
    () => QUICK_WORKBENCH_TABS.filter((tabId) => canRenderPatientTab(tabId) && !hiddenWorkbenchTabs.has(tabId)),
    [canRenderPatientTab, hiddenWorkbenchTabs],
  );

  const accessibleWorkbenchGroups = React.useMemo(
    () => PATIENT_TAB_GROUPS
      .map((group) => ({
        label: group.label,
        tabs: group.tabs.filter((tabId) => canRenderPatientTab(tabId)) as PatientTabId[],
      }))
      .filter((group) => group.tabs.length > 0),
    [canRenderPatientTab],
  );

  const visibleWorkbenchGroups = React.useMemo(
    () => accessibleWorkbenchGroups
      .map((group) => ({
        ...group,
        tabs: group.tabs.filter((tabId) => !hiddenWorkbenchTabs.has(tabId)),
      }))
      .filter((group) => group.tabs.length > 0),
    [accessibleWorkbenchGroups, hiddenWorkbenchTabs],
  );

  const openWorkbenchContextMenu = React.useCallback((event: React.MouseEvent, tabId: PatientTabId, tabLabel: string) => {
    event.preventDefault();
    setWorkbenchContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      tabId,
      tabLabel,
    });
  }, []);

  return {
    accessibleWorkbenchGroups,
    filteredQuickWorkbenchTabs,
    hiddenWorkbenchTabs,
    navigatorOpen,
    openWorkbenchContextMenu,
    resetWorkbenchTabs,
    setNavigatorOpen,
    setWorkbenchContextMenu,
    setWorkbenchCustomizeOpen,
    toggleWorkbenchTabVisibility,
    visibleWorkbenchGroups,
    workbenchContextMenu,
    workbenchCustomizeOpen,
  };
}

interface WorkbenchHeaderControlsProps {
  activeTab: PatientTabId;
  filteredQuickWorkbenchTabs: readonly PatientTabId[];
  onActivateTab: (tabId: PatientTabId) => void;
  onOpenWorkbenchContextMenu: (event: React.MouseEvent, tabId: PatientTabId, tabLabel: string) => void;
  onOpenCustomize: () => void;
  onToggleWorkbenchMode: (nextMode: Exclude<WorkbenchMode, 'balanced'>) => void;
  workbenchMode: WorkbenchMode;
}

export function WorkbenchHeaderControls({
  activeTab,
  filteredQuickWorkbenchTabs,
  onActivateTab,
  onOpenWorkbenchContextMenu,
  onOpenCustomize,
  onToggleWorkbenchMode,
  workbenchMode,
}: WorkbenchHeaderControlsProps) {
  return (
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
          onClick={() => onToggleWorkbenchMode('focus')}
        />
        <Chip
          size="small"
          label="Review"
          color={workbenchMode === 'review' ? 'primary' : 'default'}
          variant={workbenchMode === 'review' ? 'filled' : 'outlined'}
          onClick={() => onToggleWorkbenchMode('review')}
        />
        <Button size="small" variant="text" onClick={onOpenCustomize}>
          Customise
        </Button>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        {filteredQuickWorkbenchTabs.map((tabId) => {
          const tab = PATIENT_TABS.find((candidate) => candidate.id === tabId);
          if (!tab) {
            return null;
          }

          return (
            <Chip
              key={tabId}
              size="small"
              label={tab.label}
              onClick={() => onActivateTab(tabId)}
              onContextMenu={(event) => onOpenWorkbenchContextMenu(event, tabId, tab.label)}
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
  );
}

interface WorkbenchNavigatorPanelProps {
  activeTab: PatientTabId;
  filteredQuickWorkbenchTabs: readonly PatientTabId[];
  navigatorOpen: boolean;
  onActivateTab: (tabId: PatientTabId) => void;
  onOpenWorkbenchContextMenu: (event: React.MouseEvent, tabId: PatientTabId, tabLabel: string) => void;
  onToggleNavigatorOpen: () => void;
  visibleWorkbenchGroups: Array<{ label: string; tabs: PatientTabId[] }>;
}

export function WorkbenchNavigatorPanel({
  activeTab,
  filteredQuickWorkbenchTabs,
  navigatorOpen,
  onActivateTab,
  onOpenWorkbenchContextMenu,
  onToggleNavigatorOpen,
  visibleWorkbenchGroups,
}: WorkbenchNavigatorPanelProps) {
  const navWidth = navigatorOpen ? 220 : 44;

  return (
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
          onClick={onToggleNavigatorOpen}
          aria-label={navigatorOpen ? 'Collapse file explorer' : 'Expand file explorer'}
          sx={{ width: 24, height: 24 }}
        >
          <Typography sx={{ fontSize: 11, color: '#6B7280' }}>{navigatorOpen ? '◀' : '▶'}</Typography>
        </IconButton>
      </Box>

      {navigatorOpen ? (
        <Box sx={{ overflowY: 'auto' }}>
          {visibleWorkbenchGroups.map((group) => (
            <Box key={group.label} sx={{ mb: 0.5 }}>
              <Typography variant="caption" sx={{ px: 1.5, pt: 1.5, pb: 0.5, display: 'block', color: '#9CA3AF', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {group.label}
              </Typography>
              {group.tabs.map((tabId) => {
                const tab = PATIENT_TABS.find((candidate) => candidate.id === tabId);
                if (!tab) {
                  return null;
                }

                const isActive = activeTab === tabId;
                const activate = () => onActivateTab(tabId);

                return (
                  <Box
                    key={tabId}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={`Open ${tab.label} tab`}
                    onClick={activate}
                    onContextMenu={(event) => onOpenWorkbenchContextMenu(event, tabId, tab.label)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        activate();
                      }
                    }}
                    sx={{
                      px: 1.5,
                      py: 0.7,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'Albert Sans, sans-serif',
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? '#1D4ED8' : '#374151',
                      bgcolor: isActive ? '#EFF6FF' : 'transparent',
                      borderLeft: isActive ? '3px solid #2563EB' : '3px solid transparent',
                      '&:hover': { bgcolor: isActive ? '#EFF6FF' : '#F8FAFC' },
                      '&:focus-visible': { outline: '2px solid #2563EB', outlineOffset: -2 },
                      transition: 'all 0.1s',
                    }}
                  >
                    {tab.label}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 0.6, overflowY: 'auto' }}>
          {filteredQuickWorkbenchTabs.map((tabId) => {
            const tab = PATIENT_TABS.find((candidate) => candidate.id === tabId);
            if (!tab) {
              return null;
            }

            const selected = activeTab === tabId;

            return (
              <Tooltip key={tabId} title={tab.label} placement="right">
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => onActivateTab(tabId)}
                  onContextMenu={(event) => onOpenWorkbenchContextMenu(event, tabId, tab.label)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onActivateTab(tabId);
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
  );
}

interface WorkbenchNavigationOverlaysProps {
  accessibleWorkbenchGroups: Array<{ label: string; tabs: PatientTabId[] }>;
  hiddenWorkbenchTabs: Set<string>;
  onCloseContextMenu: () => void;
  onCloseCustomize: () => void;
  onOpenCustomize: () => void;
  onResetWorkbenchTabs: () => void;
  onToggleWorkbenchTabVisibility: (tabId: PatientTabId) => void;
  workbenchContextMenu: WorkbenchContextMenuState | null;
  workbenchCustomizeOpen: boolean;
}

export function WorkbenchNavigationOverlays({
  accessibleWorkbenchGroups,
  hiddenWorkbenchTabs,
  onCloseContextMenu,
  onCloseCustomize,
  onOpenCustomize,
  onResetWorkbenchTabs,
  onToggleWorkbenchTabVisibility,
  workbenchContextMenu,
  workbenchCustomizeOpen,
}: WorkbenchNavigationOverlaysProps) {
  return (
    <>
      <Menu
        open={Boolean(workbenchContextMenu)}
        onClose={onCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          workbenchContextMenu
            ? { top: workbenchContextMenu.mouseY, left: workbenchContextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem
          onClick={() => {
            if (workbenchContextMenu) {
              onToggleWorkbenchTabVisibility(workbenchContextMenu.tabId);
            }
            onCloseContextMenu();
          }}
        >
          Hide {workbenchContextMenu?.tabLabel ?? 'item'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onCloseContextMenu();
            onOpenCustomize();
          }}
        >
          Customise workbench
        </MenuItem>
      </Menu>
      <WorkbenchCustomisationDialog
        open={workbenchCustomizeOpen}
        groups={accessibleWorkbenchGroups}
        hiddenTabs={hiddenWorkbenchTabs}
        onClose={onCloseCustomize}
        onReset={onResetWorkbenchTabs}
        onToggle={onToggleWorkbenchTabVisibility}
      />
    </>
  );
}
