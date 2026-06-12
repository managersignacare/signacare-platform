import {
  Box,
  Drawer,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { lazy, Suspense } from 'react';
import { useUiStore } from '../../store/uiStore';
import { useSidebarColors } from '../../theme/ThemeProvider';
import { Sidebar } from './Sidebar';
import { PatientTabBar } from './PatientTabBar';
import { KeyboardShortcutHandler } from './KeyboardShortcuts';
import { CommandPalette } from './CommandPalette';
import { NotificationBell } from '../../../features/notifications/NotificationBell';
import { useEventStream } from '../../hooks/useEventStream';
import { BuildStamp } from './BuildStamp';

const DRAWER_WIDTH = 240;
const COLLAPSED_WIDTH = 64;
const GuidedTourOverlay = lazy(() =>
  import('./GuidedTour').then((module) => ({ default: module.GuidedTourOverlay })),
);

interface Props {
  children: React.ReactNode;
}

export function AppShell({ children }: Props): React.ReactElement {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const { bg: sidebarBg } = useSidebarColors();

  // Connect SSE for real-time events (auto-reconnects)
  useEventStream();

  const currentWidth = isMobile ? 0 : sidebarOpen ? DRAWER_WIDTH : COLLAPSED_WIDTH;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }} role="application" aria-label="Signacare EMR">
      {/* WCAG 2.4.1: Skip navigation link for keyboard users */}
      <a
        href="#main-content"
        style={{
          position: 'absolute',
          left: '-9999px',
          top: 'auto',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          zIndex: 9999,
          padding: '8px 16px',
          background: '#327C8D',
          color: '#fff',
          textDecoration: 'none',
          borderRadius: '4px',
          fontSize: '14px',
          fontWeight: 600,
        }}
        onFocus={(e) => {
          e.currentTarget.style.left = '8px';
          e.currentTarget.style.top = '8px';
          e.currentTarget.style.width = 'auto';
          e.currentTarget.style.height = 'auto';
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = '-9999px';
          e.currentTarget.style.top = 'auto';
          e.currentTarget.style.width = '1px';
          e.currentTarget.style.height = '1px';
        }}
      >
        Skip to main content
      </a>
      <KeyboardShortcutHandler />

      {/* Sidebar */}
      {isMobile ? (
        <Drawer
          variant="temporary"
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, bgcolor: sidebarBg, border: 'none' } }}
        >
          <Sidebar collapsed={false} />
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          open
          sx={{
            width: currentWidth,
            flexShrink: 0,
            transition: 'width 0.2s ease',
            '& .MuiDrawer-paper': {
              width: currentWidth,
              bgcolor: sidebarBg,
              border: 'none',
              boxSizing: 'border-box',
              overflowX: 'hidden',
              transition: 'width 0.2s ease',
            },
          }}
        >
          <Sidebar collapsed={!sidebarOpen} />
        </Drawer>
      )}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          bgcolor: 'background.default',
          transition: 'margin-left 0.2s ease',
        }}
      >
        {/* Patient Tab Bar + Notification Bell */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}><PatientTabBar /></Box>
          <Box sx={{ px: 1 }}><NotificationBell /></Box>
        </Box>

        {/* Page content */}
        <Box
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
          }}
        >
          <main id="main-content" role="main" aria-label="Clinical workspace">
            {children}
          </main>
        </Box>
      </Box>
      <CommandPalette />
      <Suspense fallback={null}>
        <GuidedTourOverlay />
      </Suspense>
      <BuildStamp />
    </Box>
  );
}
