import { useState, useEffect, type SyntheticEvent } from 'react';
import {
  Box, Button, Typography, Chip, CircularProgress, Alert,
  Card, CardContent, Divider, IconButton, Tooltip, Stack,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import EmailIcon from '@mui/icons-material/Email';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import VideocamIcon from '@mui/icons-material/Videocam';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { apiClient } from '../../../shared/services/apiClient';

interface O365Status {
  configured: boolean;
  connected: boolean;
  email: string | null;
  features: {
    email?: boolean;
    calendar?: boolean;
    teams?: boolean;
    sharepoint?: boolean;
  };
}

interface ErrorWithMessage {
  response?: {
    data?: {
      error?: string;
    };
  };
  message?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as ErrorWithMessage;
  return maybe.response?.data?.error ?? maybe.message ?? fallback;
}

/**
 * Full Office 365 integration button with connection status,
 * feature list, and connect/disconnect actions.
 */
export function ConnectOutlookButton({ compact }: { compact?: boolean } = {}) {
  const [status, setStatus] = useState<O365Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStatus();
  }, []);

  // Check URL params for post-connect redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('outlook') === 'connected') {
      fetchStatus();
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiClient.get<O365Status>('integrations/outlook/o365-status');
      setStatus(res);
    } catch {
      setStatus({ configured: false, connected: false, email: null, features: {} });
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      setActionLoading(true);
      setError('');
      const res = await apiClient.get<{ url?: string; error?: string }>('integrations/outlook/auth-url');
      if (res.url) {
        window.location.href = res.url;
      } else {
        setError(res.error ?? 'Failed to get auth URL');
        setActionLoading(false);
      }
    } catch (error: unknown) {
      setError(getErrorMessage(error, 'Connection failed'));
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Office 365? Calendar sync and email features will stop working.')) return;
    try {
      setActionLoading(true);
      await apiClient.delete('integrations/outlook/disconnect');
      await fetchStatus();
    } catch {
      setError('Failed to disconnect');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={1} py={1}>
        <CircularProgress role="progressbar" aria-label="Loading" size={16} />
        <Typography variant="body2" color="text.secondary">Checking Office 365 status…</Typography>
      </Box>
    );
  }

  // Compact mode — single button for sidebars / toolbars
  if (compact) {
    return (
      <Tooltip title={status?.connected ? `Connected: ${status.email}` : 'Connect Office 365'}>
        <IconButton
          size="small"
          onClick={status?.connected ? handleDisconnect : handleConnect}
          disabled={actionLoading}
          sx={{ color: status?.connected ? '#327C8D' : '#999' }}
        >
          {actionLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={18} /> : status?.connected ? <CheckCircleIcon /> : <LinkIcon />}
        </IconButton>
      </Tooltip>
    );
  }

  // Full card mode
  return (
    <Card variant="outlined" sx={{ borderColor: status?.connected ? '#327C8D' : 'divider' }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        {/* Header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Box display="flex" alignItems="center" gap={1}>
            <Box
              component="img"
              src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzAwNzhkNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij48cGF0aCBkPSJNMjEuNSA0LjVoLTdWMi4yNUEuNzUuNzUgMCAwMDEzLjc1IDEuNWgtMy41YS43NS43NSAwIDAwLS43NS43NVY0LjVoLTdBLjUuNSAwIDAwMiA1djE0YS41LjUgMCAwMC41LjVoMTlhLjUuNSAwIDAwLjUtLjVWNWEuNS41IDAgMDAtLjUtLjV6Ii8+PC9zdmc+"
              alt="Office 365"
              sx={{ width: 24, height: 24 }}
              onError={(event: SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.display = 'none'; }}
            />
            <Typography variant="subtitle2" fontWeight={700}>Microsoft Office 365</Typography>
          </Box>
          <Chip
            label={status?.connected ? 'Connected' : status?.configured ? 'Not Connected' : 'Not Configured'}
            size="small"
            icon={status?.connected ? <CheckCircleIcon /> : <ErrorOutlineIcon />}
            sx={{
              fontSize: 11,
              bgcolor: status?.connected ? '#E8F5E9' : status?.configured ? '#FFF3E0' : '#FFEBEE',
              color: status?.connected ? '#2E7D32' : status?.configured ? '#E65100' : '#C62828',
              fontWeight: 600,
            }}
          />
        </Box>

        {/* Connected email */}
        {status?.connected && status.email && (
          <Typography variant="body2" color="text.secondary" mb={1}>
            Signed in as <strong>{status.email}</strong>
          </Typography>
        )}

        {/* Features available */}
        {status?.connected && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={0.5}>
              Available Features
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {status.features.email && (
                <Chip icon={<EmailIcon />} label="Email" size="small" variant="outlined"
                  sx={{ fontSize: 11, borderColor: '#327C8D', color: '#327C8D' }} />
              )}
              {status.features.calendar && (
                <Chip icon={<CalendarMonthIcon />} label="Calendar Sync" size="small" variant="outlined"
                  sx={{ fontSize: 11, borderColor: '#327C8D', color: '#327C8D' }} />
              )}
              {status.features.teams && (
                <Chip icon={<VideocamIcon />} label="Teams Meetings" size="small" variant="outlined"
                  sx={{ fontSize: 11, borderColor: '#327C8D', color: '#327C8D' }} />
              )}
              {status.features.sharepoint && (
                <Chip icon={<CloudUploadIcon />} label="SharePoint" size="small" variant="outlined"
                  sx={{ fontSize: 11, borderColor: '#327C8D', color: '#327C8D' }} />
              )}
            </Stack>
          </>
        )}

        {/* Not configured message */}
        {!status?.configured && (
          <Alert role="alert" severity="warning" sx={{ mt: 1, fontSize: 12 }}>
            Office 365 is not configured on the server. Your administrator needs to set these environment variables:
            <br /><code>O365_CLIENT_ID</code>, <code>O365_TENANT_ID</code>, <code>O365_CLIENT_SECRET</code>, <code>O365_REDIRECT_URI</code>
            <br /><br />Register an Azure AD application at{' '}
            <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer">
              Azure Portal → App Registrations
            </a>
          </Alert>
        )}

        {error && <Alert role="alert" severity="error" sx={{ mt: 1, fontSize: 12 }}>{error}</Alert>}

        {/* Action buttons */}
        <Box display="flex" gap={1} mt={2}>
          {status?.connected ? (
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={actionLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={14} /> : <LinkOffIcon />}
              onClick={handleDisconnect}
              disabled={actionLoading}
              sx={{ textTransform: 'none', fontSize: 12 }}
            >
              Disconnect
            </Button>
          ) : status?.configured ? (
            <Button
              size="small"
              variant="contained"
              startIcon={actionLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={14} color="inherit" /> : <LinkIcon />}
              onClick={handleConnect}
              disabled={actionLoading}
              sx={{ textTransform: 'none', fontSize: 12, bgcolor: '#0078d4', '&:hover': { bgcolor: '#005a9e' } }}
            >
              {actionLoading ? 'Redirecting…' : 'Connect Office 365'}
            </Button>
          ) : null}
          <Button
            size="small"
            variant="text"
            onClick={fetchStatus}
            disabled={loading}
            sx={{ textTransform: 'none', fontSize: 12, color: '#666' }}
          >
            Refresh Status
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
