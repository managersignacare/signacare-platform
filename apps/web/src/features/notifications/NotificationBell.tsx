// apps/web/src/features/notifications/NotificationBell.tsx
//
// Phase 10B — header bell icon + popover list.
//
// Reads from useNotifications() which handles both the initial
// fetch and live SSE updates. Clicking a row deep-links via
// action_url and marks the row read. "Mark all" clears the badge
// in one mutation.
import {
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Typography,
} from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationResponse } from '@signacare/shared';
import { useNotifications } from './useNotifications';
import { getNotificationTierBadge } from './notificationTier';

function severityIcon(sev: NotificationResponse['severity']) {
  switch (sev) {
    case 'critical': return <ErrorOutlineIcon fontSize="small" sx={{ color: '#D32F2F' }} />;
    case 'warning':  return <WarningAmberIcon fontSize="small" sx={{ color: '#E65100' }} />;
    case 'success':  return <CheckCircleOutlineIcon fontSize="small" sx={{ color: '#2E7D32' }} />;
    default:         return <InfoOutlinedIcon fontSize="small" sx={{ color: '#327C8D' }} />;
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { items, unreadCount, isLoading, markRead, markAllRead } = useNotifications({ limit: 50 });

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleItemClick = (n: NotificationResponse) => {
    if (!n.readAt) markRead(n.id);
    handleClose();
    if (n.actionUrl) navigate(n.actionUrl);
  };

  const BellIcon = unreadCount > 0 ? NotificationsActiveIcon : NotificationsNoneIcon;

  return (
    <>
      <IconButton
        onClick={handleOpen}
        size="small"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        sx={{ color: unreadCount > 0 ? '#b8621a' : '#757575' }}
      >
        <Badge badgeContent={unreadCount} color="error" max={99}>
          <BellIcon />
        </Badge>
      </IconButton>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxHeight: 500 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5 }}>
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Notifications
          </Typography>
          {unreadCount > 0 && (
            <Button size="small" onClick={() => markAllRead()} sx={{ textTransform: 'none' }}>
              Mark all as read
            </Button>
          )}
        </Box>
        <Divider />

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={20} />
          </Box>
        )}

        {!isLoading && items.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              You're all caught up.
            </Typography>
          </Box>
        )}

        {!isLoading && items.length > 0 && (
          <List disablePadding>
            {items.map((n) => {
              const tierBadge = getNotificationTierBadge(n.payload);
              return (
              <ListItemButton
                key={n.id}
                onClick={() => handleItemClick(n)}
                sx={{
                  borderLeft: n.readAt ? 'none' : '3px solid #b8621a',
                  bgcolor: n.readAt ? 'transparent' : 'rgba(184, 98, 26, 0.04)',
                  alignItems: 'flex-start',
                  py: 1,
                }}
              >
                <Box sx={{ mr: 1, mt: 0.5 }}>{severityIcon(n.severity)}</Box>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" fontWeight={n.readAt ? 400 : 600}>
                        {n.title}
                      </Typography>
                      {tierBadge && (
                        <Chip
                          size="small"
                          color={tierBadge.color}
                          variant={n.readAt ? 'outlined' : 'filled'}
                          label={tierBadge.label}
                          sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Box component="span" sx={{ display: 'block' }}>
                      {n.body && (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {n.body}
                        </Typography>
                      )}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {n.category} · {relativeTime(n.createdAt)}
                      </Typography>
                    </Box>
                  }
                />
              </ListItemButton>
              );
            })}
          </List>
        )}
      </Popover>
    </>
  );
}

export default NotificationBell;
