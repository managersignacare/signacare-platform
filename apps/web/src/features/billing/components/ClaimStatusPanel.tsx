import React, { useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableHead,
  TableRow, Chip, MenuItem, TextField, CircularProgress,
  Alert, Paper, Tooltip,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useClaims } from '../hooks/useBilling';
import type { ClaimResponse, ClaimStatus, ClaimType } from '../types/billingTypes';

const CLAIM_STATUS_COLOR: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  not_submitted: 'default',
  pending: 'info',
  processing: 'warning',
  approved: 'success',
  rejected: 'error',
  partial: 'warning',
  paid: 'success',
};

const CLAIM_TYPE_LABEL: Record<string, string> = {
  medicare: 'Medicare',
  dva: 'DVA',
  ndis: 'NDIS',
  private_health: 'Private Health',
  self_funded: 'Self-Funded',
};

interface Props {
  patientId?: string;
}

export const ClaimStatusPanel: React.FC<Props> = ({ patientId }) => {
  const [typeFilter, setTypeFilter] = useState<ClaimType | ''>('');
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | ''>('');

  const { data: claims, isLoading, isError } = useClaims({
    patientId,
    claimType: typeFilter || undefined,
    claimStatus: statusFilter || undefined,
  });

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (isError) return <Alert role="alert" severity="error">Failed to load claims.</Alert>;

  // Aggregate summary counts
  const summary = (claims ?? []).reduce<Record<string, number>>(
    (acc: Record<string, number>, c: ClaimResponse) => {
      const key = c.claimStatus ?? 'not_submitted';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Claim Status Tracking
        <Tooltip title="Tracks Medicare, DVA, and NDIS claim submissions and outcomes. No live gateway integration — statuses are updated manually or via admin.">
          <InfoOutlinedIcon fontSize="small" sx={{ ml: 1, verticalAlign: 'middle', color: 'text.secondary' }} />
        </Tooltip>
      </Typography>

      {/* Summary Chips */}
      {claims && claims.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
          {(Object.entries(summary) as [ClaimStatus, number][]).map(([status, count]) => (
            <Chip
              key={status}
              label={`${status.replace('_', ' ')}: ${count}`}
              size="small"
              color={CLAIM_STATUS_COLOR[status]}
              variant={statusFilter === status ? 'filled' : 'outlined'}
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
              sx={{ cursor: 'pointer', textTransform: 'capitalize' }}
            />
          ))}
        </Box>
      )}

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Claim Type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ClaimType | '')}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All Types</MenuItem>
          {(Object.entries(CLAIM_TYPE_LABEL) as [ClaimType, string][]).map(([value, label]) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ClaimStatus | '')}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All Statuses</MenuItem>
          {(['not_submitted','pending','processing','approved','rejected','partial','paid'] as ClaimStatus[]).map((s) => (
            <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>
              {s.replace('_', ' ')}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {!claims || claims.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No claims found.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invoice ID</TableCell>
              <TableCell>Claim Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell align="right">Approved Amount</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell>Processed</TableCell>
              <TableCell>Rejection Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {claims.map((claim) => (
              <TableRow key={claim.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {claim.invoiceId.slice(0, 8)}…
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={CLAIM_TYPE_LABEL[claim.claimType]}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={claim.claimStatus.replace('_', ' ')}
                    size="small"
                    color={CLAIM_STATUS_COLOR[claim.claimStatus]}
                    sx={{ textTransform: 'capitalize' }}
                  />
                </TableCell>
                <TableCell>{claim.claimReference ?? '—'}</TableCell>
                <TableCell align="right">
                  {claim.approvedAmount != null
                    ? <Typography variant="body2" color="success.main">${claim.approvedAmount.toFixed(2)}</Typography>
                    : '—'}
                </TableCell>
                <TableCell>{claim.submittedAt ? claim.submittedAt.split('T')[0] : '—'}</TableCell>
                <TableCell>{claim.processedAt ? claim.processedAt.split('T')[0] : '—'}</TableCell>
                <TableCell>
                  {claim.rejectionReason ? (
                    <Typography variant="body2" color="error.main" sx={{ maxWidth: 200 }}>
                      {claim.rejectionReason}
                    </Typography>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Paper
        variant="outlined"
        sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderColor: 'divider' }}
      >
        <Typography variant="caption" color="text.secondary">
          <strong>Note:</strong> Medicare, DVA, and NDIS claim statuses are managed via Signacare admin
          or future gateway integration. Claim reference numbers and outcomes should be updated
          manually by billing staff after receiving payer responses.
        </Typography>
      </Paper>
    </Box>
  );
};
