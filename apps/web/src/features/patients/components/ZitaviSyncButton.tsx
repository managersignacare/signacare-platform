import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { patientsKeys } from '../queryKeys';

interface ZitaviSyncDetail {
  action: string;
  name: string;
}

interface ZitaviSyncResponse {
  summary?: {
    created?: number;
    existing?: number;
    errors?: number;
    total?: number;
  };
  details?: ZitaviSyncDetail[];
}

export function ZitaviSyncButton() {
  const qc = useQueryClient();
  const [result, setResult] = React.useState<ZitaviSyncResponse | null>(null);

  const syncMut = useMutation({
    mutationFn: () => apiClient.post<ZitaviSyncResponse>('patients/zitavi-sync', {}),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: patientsKeys.all });
    },
  });

  return (
    <>
      <Tooltip title="Import patients from Zitavi mobile app">
        <Button
          variant="outlined"
          size="small"
          startIcon={syncMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={14} /> : <SyncIcon />}
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending}
          sx={{ textTransform: 'none', borderColor: '#2E7D32', color: '#2E7D32', fontSize: 12 }}
        >
          {syncMut.isPending ? 'Syncing...' : 'Sync Zitavi'}
        </Button>
      </Tooltip>
      {result && (
        <Dialog open onClose={() => setResult(null)} maxWidth="sm" fullWidth>
          <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Zitavi Sync Complete</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Chip label={`${result.summary?.created ?? 0} Created`} sx={{ bgcolor: '#E8F5E9', color: '#2E7D32', fontWeight: 600 }} />
              <Chip label={`${result.summary?.existing ?? 0} Already Exist`} sx={{ bgcolor: '#E3F2FD', color: '#1565C0', fontWeight: 600 }} />
              {(result.summary?.errors ?? 0) > 0 && <Chip label={`${result.summary?.errors ?? 0} Errors`} sx={{ bgcolor: '#FDECEA', color: '#D32F2F', fontWeight: 600 }} />}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {result.summary?.total ?? 0} patients found in Zitavi mobile app.
            </Typography>
            {(result.details ?? []).filter((d) => d.action === 'created').length > 0 && (
              <Box>
                <Typography variant="caption" fontWeight={600}>New patients added:</Typography>
                {(result.details ?? []).filter((d) => d.action === 'created').map((d, i: number) => (
                  <Typography key={i} variant="caption" display="block" sx={{ pl: 1 }}>+ {d.name}</Typography>
                ))}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setResult(null)} variant="contained" sx={{ bgcolor: '#327C8D' }}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
