import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import MenuIcon from '@mui/icons-material/Menu';
import PeopleIcon from '@mui/icons-material/People';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
    Box,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Switch,
    Tooltip,
    Typography
} from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
// NoteAltIcon removed — no longer used
import CloseIcon from '@mui/icons-material/Close';
import DescriptionIcon from '@mui/icons-material/Description';
import GavelIcon from '@mui/icons-material/Gavel';
import MedicationIcon from '@mui/icons-material/Medication';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import PsychologyIcon from '@mui/icons-material/Psychology';
import TuneIcon from '@mui/icons-material/Tune';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
// BiotechIcon removed — no longer used
import AssignmentIcon from '@mui/icons-material/Assignment';
import ReceiptIcon from '@mui/icons-material/Receipt';
// ChatBubbleOutlineIcon, MailOutlineIcon, AccountTreeIcon, GroupsIcon removed — Settings moved to bottom link
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DraftsIcon from '@mui/icons-material/Drafts';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
// GroupsIcon removed
import LogoutIcon from '@mui/icons-material/Logout';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SchoolIcon from '@mui/icons-material/School';
import SettingsIcon from '@mui/icons-material/Settings';
import { useQuery } from '@tanstack/react-query';
import { useLogout } from '../../../features/auth/hooks/useLogout';
import { useModuleVisibility } from '../../hooks/useModuleVisibility';
import { apiClient } from '../../services/apiClient';
import { useAuthStore } from '../../store/authStore';
import { useBrandingStore } from '../../store/brandingStore';
import { useUiStore } from '../../store/uiStore';
import { useSidebarColors } from '../../theme/ThemeProvider';
import { canAccessRoute } from '../../utils/frontendAccessPolicy';

const SIDEBAR_HIDDEN_KEY = 'sidebar_hidden';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactElement;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_PATH_TO_MODULE_KEY: Record<string, string> = {
  pathways: 'pathways',
  'agentic-scribe': 'agentic-ai-scribe',
};

const DEFAULT_DISABLED_MODULE_KEYS = new Set<string>([
  'agentic-ai-scribe',
]);

const BASE_NAV_GROUPS: NavGroup[] = [
  {
    group: '',
    items: [
      { label: 'Dashboard', path: 'dashboard', icon: <DashboardIcon /> },
      { label: 'Patients', path: 'patients', icon: <PeopleIcon /> },
      { label: 'Tasks', path: 'tasks', icon: <AssignmentIcon /> },
      { label: 'Drafts', path: 'drafts', icon: <DraftsIcon /> },
      { label: 'AI Assistant', path: 'ai-agent', icon: <PsychologyIcon /> },
      { label: 'Agentic Scribe', path: 'agentic-scribe', icon: <AutoAwesomeIcon /> },
    ],
  },
  {
    group: 'Clinical Lists',
    items: [
      { label: 'Mental Health Intake', path: 'referrals', icon: <SwapHorizIcon /> },
      { label: 'Referral Out', path: 'referrals/queue', icon: <AssignmentIcon /> },
      { label: 'LAI', path: 'list/lai', icon: <VaccinesIcon /> },
      { label: 'MH Act', path: 'list/mha', icon: <GavelIcon /> },
      // USER-B.1 (A-5-USER): Group Therapy list — feature already exists
      // at apps/web/src/features/group-therapy/ but had no nav entry.
      { label: 'Group Therapy', path: 'group-therapy', icon: <PeopleIcon /> },
      { label: 'Clozapine', path: 'list/clozapine', icon: <MonitorHeartIcon /> },
      { label: '91-Day Review', path: 'list/91day', icon: <CalendarMonthIcon /> },
      { label: 'Hot Spots', path: 'list/hotspots', icon: <WarningAmberIcon /> },
      { label: 'Admission Waitlist', path: 'list/admission-waitlist', icon: <LocalHospitalIcon /> },
      { label: 'Pathways', path: 'pathways', icon: <TuneIcon /> },
      { label: 'Handover', path: 'handover', icon: <SwapHorizIcon /> },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { label: 'Appointments', path: 'appointments', icon: <CalendarMonthIcon /> },
      { label: 'My Calendar', path: 'calendar', icon: <CalendarMonthIcon /> },
      { label: 'Bed Board', path: 'bed-board', icon: <MedicationIcon /> },
      { label: 'Reception', path: 'receptionist', icon: <PersonAddIcon /> },
    ],
  },
  {
    group: 'Admin',
    items: [
      { label: 'Reports', path: 'reports', icon: <AssessmentIcon /> },
      { label: 'Templates', path: 'templates', icon: <DescriptionIcon /> },
      { label: 'Billing', path: 'billing', icon: <ReceiptIcon /> },
      { label: 'Exports', path: 'exports', icon: <FileDownloadIcon /> },
      { label: 'Resources', path: 'community-resources', icon: <FolderSpecialIcon /> },
    ],
  },
];

function buildNavGroups(role: string): NavGroup[] {
  const isSuperadmin = role === 'superadmin';
  const isAdmin = role === 'admin' || isSuperadmin;
  // Phase 0.5.B — role classification mirrors packages/shared/permissions.ts
  // (hasClinicalAccess). Imported inline to avoid a circular dep bump.
  const isOperationalOnly = role === 'receptionist' || role === 'readonly';

  // Phase 0.5.B — superadmin is a cross-clinic settings operator; they
  // cannot view clinical information. Hide Dashboard / Patients / Tasks
  // / Drafts / AI Assistant / Clinical Lists / Workspace. Show only
  // Settings + Platform groups.
  //
  // Operational-only roles (receptionist / readonly) similarly cannot
  // see Clinical Lists; their Dashboard / Workspace entries remain for
  // the operational queues (reception, bed board).
  if (isSuperadmin) {
    return [
      {
        group: 'Settings',
        items: [
          { label: 'Settings', path: 'settings', icon: <SettingsIcon /> },
          { label: 'Org Settings', path: 'org-settings', icon: <AdminPanelSettingsIcon /> },
          { label: 'Staff Assignments', path: 'staff-assignments', icon: <PersonAddIcon /> },
        ],
      },
      {
        group: 'Platform',
        items: [
          { label: 'Power Settings', path: 'power-settings', icon: <AdminPanelSettingsIcon /> },
          { label: 'Subscription', path: 'subscription', icon: <ReceiptIcon /> },
        ],
      },
    ];
  }

  // All role-specific views are now merged into the Dashboard via role switcher.
  // Sidebar only shows structural navigation.
  let groups = [...BASE_NAV_GROUPS];

  // Phase 0.5.B — operational-only: strip the "Clinical Lists" group.
  // Receptionists keep Dashboard / Patients (for the demographic-only
  // patient list) / Workspace (bed board, reception queue). Clinical
  // lists (LAI, MHA, clozapine, etc.) contain PHI and are hidden.
  if (isOperationalOnly) {
    groups = groups.filter((g) => g.group !== 'Clinical Lists');
  }

  // Settings baseline is available to every authenticated clinic role.
  // Admin-only entry points remain explicitly listed in this group and
  // are still hard-gated by route policy (frontendAccessPolicy + API).
  const settingsItems: NavItem[] = [
    { label: 'Settings', path: 'settings', icon: <SettingsIcon /> },
  ];

  if (isAdmin) {
    settingsItems.push(
      { label: 'Org Settings', path: 'org-settings', icon: <AdminPanelSettingsIcon /> },
      { label: 'Staff Assignments', path: 'staff-assignments', icon: <PersonAddIcon /> },
    );
  }

  groups.push({
    group: 'Settings',
    items: settingsItems,
  });

  return groups;
}

interface SidebarProps {
  collapsed?: boolean;
}

/** Load hidden sidebar items from localStorage */
function loadHiddenItems(): Set<string> {
  try {
    const saved = localStorage.getItem(SIDEBAR_HIDDEN_KEY);
    return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

/** Persist hidden sidebar items to localStorage */
function saveHiddenItems(items: Set<string>): void {
  localStorage.setItem(SIDEBAR_HIDDEN_KEY, JSON.stringify([...items]));
}

/* ── Customize Sidebar Dialog ── */
interface CustomizeDialogProps {
  open: boolean;
  onClose: () => void;
  allGroups: NavGroup[];
  hiddenItems: Set<string>;
  onToggle: (path: string) => void;
  onResetAll: () => void;
}

function CustomizeSidebarDialog({ open, onClose, allGroups, hiddenItems, onToggle, onResetAll }: CustomizeDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, fontSize: 16, pb: 0.5 }}>
        Customize Sidebar
        <IconButton size="small" onClick={onClose} aria-label="Close"><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 1, pb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, fontSize: 11 }}>
          Toggle items on or off to customise your sidebar navigation. Changes are saved automatically.
        </Typography>

        {allGroups.map((group) => (
          <Box key={group.group || '_root'} sx={{ mb: 1.5 }}>
            {group.group && (
              <Typography variant="overline" sx={{ fontSize: '0.6rem', letterSpacing: 1.5, fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5 }}>
                {group.group}
              </Typography>
            )}
            {group.items.map((item) => (
              <Box key={item.path} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.25, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ color: 'text.secondary', display: 'flex', '& .MuiSvgIcon-root': { fontSize: 16 } }}>{item.icon}</Box>
                  <Typography variant="body2" sx={{ fontSize: 13 }}>{item.label}</Typography>
                </Box>
                <Switch
                  size="small"
                  checked={!hiddenItems.has(item.path)}
                  onChange={() => onToggle(item.path)}
                  inputProps={{ 'aria-label': `Toggle ${item.label} visibility` }}
                />
              </Box>
            ))}
          </Box>
        ))}

        {hiddenItems.size > 0 && (
          <Box sx={{ mt: 1, textAlign: 'center' }}>
            <Typography
              variant="caption"
              role="button"
              tabIndex={0}
              onClick={onResetAll}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onResetAll(); } }}
              sx={{ color: 'primary.main', cursor: 'pointer', fontSize: 11, '&:hover': { textDecoration: 'underline' } }}
            >
              Reset all — show every item
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Sidebar({ collapsed = false }: SidebarProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const setActivePage = useUiStore((s) => s.setActivePage);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set(['Clinical Lists', 'Admin', 'Settings', 'Platform']));
  const toggleGroup = (g: string) => setCollapsedGroups(prev => { const next = new Set(prev); next.has(g) ? next.delete(g) : next.add(g); return next; });
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const { sidebarTitle, sidebarSubtitle, logoUrl } = useBrandingStore();
  const { bg: sidebarBg, accent: sidebarAccent } = useSidebarColors();
  const logoutMut = useLogout();

  const userRole = user?.role ?? 'clinician';
  const isSuperadmin = userRole === 'superadmin';
  const rawNavGroups = buildNavGroups(userRole);
  const { data: clinicModules = {} } = useQuery({
    queryKey: ['clinic-modules', 'me'],
    queryFn: async () => {
      try {
        const resp = await apiClient.get<{ modules: Record<string, boolean> }>(
          'power-settings/subscriptions/me/modules',
        );
        return resp?.modules ?? {};
      } catch {
        return {};
      }
    },
    staleTime: 60_000,
  });

  // Multi-specialty Phase 2: additionally filter each nav item through the
  // module registry. Items not listed in the registry are always visible
  // (framework is additive — new modules opt in, existing items are
  // unchanged). Items listed with a specialty are shown only when the
  // current user's visibility set contains that specialty.
  const { isNavVisible } = useModuleVisibility();
  const navGroups = React.useMemo<NavGroup[]>(() => {
    return rawNavGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          const moduleKey = NAV_PATH_TO_MODULE_KEY[item.path];
          const moduleEnabled = moduleKey
            ? (moduleKey in clinicModules
              ? clinicModules[moduleKey] !== false
              : !DEFAULT_DISABLED_MODULE_KEYS.has(moduleKey))
            : true;
          return moduleEnabled && isNavVisible(item.path) && canAccessRoute(user, item.path);
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [rawNavGroups, isNavVisible, user, clinicModules]);

  // ── Hidden sidebar items (persisted in localStorage) ──
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(loadHiddenItems);

  useEffect(() => {
    saveHiddenItems(hiddenItems);
  }, [hiddenItems]);

  const toggleHiddenItem = useCallback((path: string) => {
    setHiddenItems(prev => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); } else { next.add(path); }
      return next;
    });
  }, []);

  const resetHiddenItems = useCallback(() => {
    setHiddenItems(new Set());
  }, []);

  // ── Context menu (right-click to hide) ──
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; itemPath: string; itemLabel: string } | null>(null);
  // Long-press support
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: NavItem) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX + 2, mouseY: e.clientY - 6, itemPath: item.path, itemLabel: item.label });
  }, []);

  const handleTouchStart = useCallback((_e: React.TouchEvent, item: NavItem) => {
    longPressTimer.current = setTimeout(() => {
      // For long-press we open the customization dialog instead of a positioned context menu
      // because touch UX is better with a full dialog
      setCustomizeOpen(true);
      longPressTimer.current = null;
    }, 600);
    // Store which item for potential use
    void item;
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleHideFromContextMenu = useCallback(() => {
    if (contextMenu) {
      toggleHiddenItem(contextMenu.itemPath);
    }
    setContextMenu(null);
  }, [contextMenu, toggleHiddenItem]);

  // ── Customization dialog ──
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const handleNav = (path: string, label: string): void => {
    setActivePage(label);
    navigate(`/${path}`);
  };

  // Filter groups based on hidden items, but keep groups that have at least one visible item
  const visibleNavGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => !hiddenItems.has(item.path)),
  })).filter(group => group.items.length > 0);

  return (
    <Box
      component="nav"
      role="navigation"
      aria-label="Main navigation"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: sidebarBg,
        overflowY: 'auto',
        overflowX: 'hidden',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-thumb': {
          bgcolor: 'rgba(255,255,255,0.25)',
          borderRadius: 2,
        },
      }}
    >
      {/* Toggle + Logo */}
      <Box sx={{ px: collapsed ? 1.5 : 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, userSelect: 'none' }}>
        <IconButton onClick={toggleSidebar} aria-label="Toggle sidebar" sx={{ color: 'rgba(255,255,255,0.85)', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' }, p: 1 }}>
          <MenuIcon sx={{ fontSize: 24 }} />
        </IconButton>
        {collapsed ? (
          <Box component="img" src="/signacare-logo.svg" alt="Signacare"
            sx={{ width: 24, height: 24, filter: 'brightness(0) invert(1)', opacity: 0.9 }} />
        ) : (
          <Box sx={{ overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="img" src="/signacare-logo.svg" alt="Signacare"
              sx={{ width: 28, height: 28, filter: 'brightness(0) invert(1)', opacity: 0.9, flexShrink: 0 }} />
            <Box>
              {logoUrl ? (
                <Box component="img" src={logoUrl} alt={sidebarTitle} sx={{ maxWidth: 120, maxHeight: 24, display: 'block' }} />
              ) : (
                <Typography variant="subtitle1" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, color: '#FFFFFF', letterSpacing: 1, lineHeight: 1.2, whiteSpace: 'nowrap', fontSize: '0.95rem' }}>
                  {sidebarTitle || 'Signacare'}
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.55)', letterSpacing: 0.5, fontSize: '0.55rem', whiteSpace: 'nowrap' }}>
                {sidebarSubtitle || 'Mental Health EMR'}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)', mb: 0.5 }} />

      {/* Nav groups — filtered by hidden items */}
      {visibleNavGroups.map((group, gi) => (
        <Box key={group.group || `group-${gi}`} sx={{ mb: 0.5 }}>
          {group.group && !collapsed && (
            <Box
              role="button"
              tabIndex={0}
              aria-expanded={!collapsedGroups.has(group.group)}
              aria-label={`${group.group} navigation group — ${collapsedGroups.has(group.group) ? 'expand' : 'collapse'}`}
              onClick={() => toggleGroup(group.group)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(group.group); } }}
              sx={{
                px: 3, pt: gi === 0 ? 0.5 : 1, pb: 0.25,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }, borderRadius: 1,
                '&:focus-visible': { outline: '2px solid rgba(255,255,255,0.5)', outlineOffset: 2 },
              }}
            >
              <Typography variant="overline" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.6rem', letterSpacing: 1.5, fontWeight: 600 }}>
                {group.group}
              </Typography>
              {collapsedGroups.has(group.group)
                ? <ChevronRightIcon sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 18 }} />
                : <ExpandMoreIcon sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 18 }} />
              }
            </Box>
          )}
          {collapsed && group.group && gi > 0 && (
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mx: 1, my: 0.5 }} />
          )}
          {(!group.group || !collapsedGroups.has(group.group)) && <List dense disablePadding>
            {group.items.map((item) => {
              const isActive =
                location.pathname === `/${item.path}` ||
                (item.path !== 'dashboard' &&
                  location.pathname.startsWith(`/${item.path}`));

              const button = (
                <ListItemButton
                  key={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => handleNav(item.path, item.label)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  onTouchStart={(e) => handleTouchStart(e, item)}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  sx={{
                    mx: collapsed ? 0.5 : 1,
                    mb: 0.25,
                    borderRadius: 1.5,
                    py: 0.6,
                    px: collapsed ? 1.5 : 2,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    bgcolor: isActive ? 'rgba(255,255,255,0.18)' : 'transparent',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' },
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: collapsed ? 0 : 36,
                      mr: collapsed ? 0 : undefined,
                      color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.7)',
                      '& .MuiSvgIcon-root': { fontSize: 20 },
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: '0.8rem',
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.8)',
                        whiteSpace: 'nowrap',
                      }}
                    />
                  )}
                </ListItemButton>
              );

              return collapsed ? (
                <Tooltip key={item.path} title={item.label} placement="right" arrow>
                  {button}
                </Tooltip>
              ) : (
                <React.Fragment key={item.path}>{button}</React.Fragment>
              );
            })}
          </List>}
        </Box>
      ))}

      <Box sx={{ flexGrow: 1 }} />

      {/* User section at bottom */}
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)' }} />
      <Box sx={{ px: collapsed ? 1 : 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: sidebarAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Typography sx={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>
            {user?.givenName?.[0] ?? 'U'}{user?.familyName?.[0] ?? ''}
          </Typography>
        </Box>
        {!collapsed && (
          <Box sx={{ overflow: 'hidden', flex: 1 }}>
            <Typography variant="body2" sx={{ color: '#fff', fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user ? `${user.givenName} ${user.familyName}` : 'User'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>
              {user?.role ?? ''}
            </Typography>
          </Box>
        )}
        <Tooltip title="Take a Tour" placement={collapsed ? 'right' : 'top'}>
          <IconButton size="small" aria-label="Take a Tour" onClick={() => { import('./GuidedTour').then(m => m.reopenTour()); }}
            sx={{ color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' } }}>
            <SchoolIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Logout" placement={collapsed ? 'right' : 'top'}>
          <IconButton size="small" aria-label="Logout" onClick={() => logoutMut.mutate()} sx={{ color: 'rgba(255,255,255,0.5)', '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.1)' } }}>
            <LogoutIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Right-click context menu */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        <MenuItem onClick={handleHideFromContextMenu}>
          <ListItemIcon><VisibilityOffIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 13 }}>
            Hide &ldquo;{contextMenu?.itemLabel}&rdquo;
          </ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setContextMenu(null); setCustomizeOpen(true); }}>
          <ListItemIcon><TuneIcon fontSize="small" /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 13 }}>Customize Sidebar</ListItemText>
        </MenuItem>
      </Menu>

      {/* Customization dialog — shows all items with toggles (Platform section only visible to superadmin) */}
      <CustomizeSidebarDialog
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        allGroups={isSuperadmin ? navGroups : navGroups.filter(g => g.group !== 'Platform')}
        hiddenItems={hiddenItems}
        onToggle={toggleHiddenItem}
        onResetAll={resetHiddenItems}
      />
    </Box>
  );
}
