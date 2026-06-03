import {
    Alert, Box, Chip, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select,
    Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
    Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ListExportBar } from '../../../shared/components/ui/ListExportBar';
import { apiClient } from '../../../shared/services/apiClient';
import { useAuthStore } from '../../../shared/store/authStore';
import { canAccessRoute } from '../../../shared/utils/frontendAccessPolicy';
import { auditKeys } from '../queryKeys';

interface AuditLogEntry {
  id?: string;
  createdAt?: string;
  userName?: string;
  username?: string;
  action?: string;
  module?: string;
  entityId?: string;
  ipAddress?: string;
  details?: string | Record<string, unknown> | null;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
}

const ACTION_COLORS: Record<string, string> = {
  login: '#327C8D', logout: '#3D484B', create: '#4CAF50', read: '#2196F3',
  update: '#b8621a', delete: '#D32F2F', export: '#9C27B0', access_change: '#FF9800',
  soft_delete: '#E65100', restore: '#2E7D32', mfa_verify: '#1565C0', access: '#7B1FA2',
};

export default function AuditPage() {
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const user = useAuthStore((s) => s.user);
  const canViewAudit = canAccessRoute(user, '/audit');
  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: auditKeys.list({ page, actionFilter, moduleFilter }),
    queryFn: () => {
      const params: Record<string, string | number> = {
        page: page + 1,
        limit: 50,
      };
      if (actionFilter) params.action = actionFilter;
      if (moduleFilter) params.module = moduleFilter;
      return apiClient.get<AuditLogResponse>('staff-settings/audit-log', params);
    },
    enabled: canViewAudit,
    retry: 1,
  });

  if (!canViewAudit) {
    return (
      <Box p={3}>
        <Alert role="alert" severity="error">
          Access denied. You do not have permission to access the Audit Log.
        </Alert>
      </Box>
    );
  }

  const entries = data?.entries ?? [];
  const errorMessage = error instanceof Error ? error.message : 'Failed to load audit log entries.';

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>Audit Log</Typography>
        <Typography variant="body2" color="text.secondary">Track all system actions, access changes, and data modifications</Typography>
      </Box>

      {isError && (
        <Alert
          severity="error"
          role="alert"
          sx={{ mb: 2 }}
          action={
            <Typography
              component="button"
              type="button"
              onClick={() => { void refetch(); }}
              sx={{
                border: 'none',
                background: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontWeight: 600,
                textDecoration: 'underline',
                p: 0,
              }}
            >
              Retry
            </Typography>
          }
        >
          Failed to load audit entries. {errorMessage}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Action</InputLabel>
          <Select value={actionFilter} onChange={e => setActionFilter(e.target.value)} label="Action" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Actions</MenuItem>
            {['login', 'logout', 'create', 'read', 'update', 'delete', 'soft_delete', 'access'].map(a => (
              <MenuItem key={a} value={a} sx={{ textTransform: 'capitalize' }}>{a.replace('_', ' ')}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Module</InputLabel>
          <Select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} label="Module" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Modules</MenuItem>
            {['patients', 'episodes', 'medications', 'clinical_notes', 'referrals', 'appointments', 'tasks', 'staff', 'prescriptions', 'pathology'].map(m => (
              <MenuItem key={m} value={m} sx={{ textTransform: 'capitalize' }}>{m.replace('_', ' ')}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', ml: 1 }}>
          {isFetching && !isLoading ? 'Refreshing… ' : ''}{data?.total ?? 0} total entries
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
        <ListExportBar compact title="Audit Log" subtitle={`${entries.length} entries`}
          columns={['Timestamp', 'User', 'Action', 'Module', 'Entity', 'IP', 'Details']}
          rows={entries.map((e) => [
            e.createdAt ? new Date(e.createdAt).toLocaleString('en-AU') : '',
            e.userName ?? e.username ?? '', (e.action ?? '').toLowerCase(), e.module ?? '',
            e.entityId ? `${(e.entityId ?? '').substring(0, 8)}` : '',
            e.ipAddress ?? '', typeof e.details === 'string' ? e.details : '',
          ])} />
      </Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer role="region" aria-label="Data table">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Timestamp', 'User', 'Action', 'Module', 'Entity', 'IP Address', 'Details'].map(c => (
                  <TableCell key={c} sx={{ fontWeight: 600, fontSize: 13, bgcolor: '#FBF8F5' }}>{c}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6 }}><CircularProgress role="progressbar" aria-label="Loading" size={28} sx={{ color: '#b8621a' }} /></TableCell></TableRow>
              ) : entries.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6 }}><Typography color="text.secondary">No audit entries found</Typography></TableCell></TableRow>
              ) : (
                entries.map((e, i) => {
                  const action = (e.action ?? '').toLowerCase();
                  const details = typeof e.details === 'string' ? e.details : (e.details ? JSON.stringify(e.details).slice(0, 200) : '');
                  return (
                  <TableRow key={e.id ?? i} hover>
                    <TableCell sx={{ fontSize: 12 }}>{e.createdAt ? new Date(e.createdAt).toLocaleString('en-AU') : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{e.userName ?? e.username ?? '—'}</TableCell>
                    <TableCell><Chip label={action || '—'} size="small" sx={{ fontSize: 9, height: 18, bgcolor: (ACTION_COLORS[action] ?? '#999') + '20', color: ACTION_COLORS[action] ?? '#999', textTransform: 'capitalize' }} /></TableCell>
                    <TableCell sx={{ fontSize: 12, textTransform: 'capitalize' }}>{(e.module ?? '').replace(/_/g, ' ') || '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{e.entityId ? `${(e.entityId ?? '').substring(0, 8)}...` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11, color: 'text.secondary' }}>{e.ipAddress || '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11, color: 'text.secondary', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{details || '—'}</TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={data?.total ?? 0} page={page}
          onPageChange={(_, p) => setPage(p)} rowsPerPage={50} rowsPerPageOptions={[50]} />
      </Paper>
    </Box>
  );
}
