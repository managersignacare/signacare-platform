import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Avatar,
  Box,
  Tooltip,
  Badge,
  Menu,
  MenuItem,
  Divider,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/NotificationsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { apiClient } from '../../services/apiClient';
import { useSidebarColors } from '../../theme/ThemeProvider';

interface Props {
  drawerWidth: number;
}

export function TopBar({ drawerWidth }: Props): React.ReactElement {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearUser = useAuthStore((s) => s.clearUser);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const notifications = useUiStore((s) => s.notifications);
  const { bg: sidebarBg, text: sidebarTextColor, accent } = useSidebarColors();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  const menuOpen = Boolean(anchorEl);

  const fullName = user
    ? `${user.givenName} ${user.familyName}`
    : 'User';

  const initials = user
    ? (user.givenName?.[0] ?? user.familyName?.[0] ?? 'N').toUpperCase()
    : 'NU';

  const handleLogout = async (): Promise<void> => {
    try {
      await apiClient.post<void>('auth/logout');
    } finally {
      clearUser();
      navigate('/login', { replace: true });
    }
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: sidebarBg,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        zIndex: (theme) => theme.zIndex.drawer + 1,
        width: { md: `calc(100% - ${drawerWidth}px)` },
        ml: { md: `${drawerWidth}px` },
      }}
    >
      <Toolbar sx={{ gap: 1 }}>
        {/* Hamburger – mobile only */}
        <IconButton
          color="inherit"
          edge="start"
          onClick={toggleSidebar}
          sx={{ display: { md: 'none' }, mr: 1 }}
          aria-label="Toggle navigation"
        >
          <MenuIcon />
        </IconButton>

        {/* Clinic name placeholder (replaced with real data from authStore/clinic context) */}
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 600,
            color: sidebarTextColor,
            flexGrow: 1,
            letterSpacing: 0.25,
          }}
        >
          Signacare
        </Typography>

        {/* Notifications */}
        <Tooltip title="Notifications">
          <IconButton
            color="inherit"
            aria-label="Notifications"
          >
            <Badge
              badgeContent={notifications.length}
              color="warning"
              max={9}
            >
              <NotificationsIcon />
            </Badge>
          </IconButton>
        </Tooltip>

        {/* User avatar menu */}
        <Tooltip title={fullName}>
          <IconButton
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label="User menu"
            aria-controls={menuOpen ? 'user-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={menuOpen ? 'true' : undefined}
            sx={{ p: 0.5 }}
          >
            <Avatar
              sx={{
                width: 34,
                height: 34,
                bgcolor: accent,
                fontFamily: 'Albert Sans, sans-serif',
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            >
              {initials}
            </Avatar>
          </IconButton>
        </Tooltip>

        <Menu
          id="user-menu"
          anchorEl={anchorEl}
          open={menuOpen}
          onClose={() => setAnchorEl(null)}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          PaperProps={{
            sx: { minWidth: 200, mt: 0.5 },
          }}
        >
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {fullName}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
            >
              {user?.email ?? ''}
            </Typography>
          </Box>
          <Divider />
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              navigate('/settings');
            }}
          >
            Settings
          </MenuItem>
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              void handleLogout();
            }}
            sx={{ color: 'error.main' }}
          >
            <LogoutIcon fontSize="small" sx={{ mr: 1 }} />
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
