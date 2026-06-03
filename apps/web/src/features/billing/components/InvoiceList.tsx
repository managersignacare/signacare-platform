import React, { useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableHead,
  TableRow, Chip, Button, MenuItem, TextField, CircularProgress, Alert,
} from '@mui/material';
import { useInvoices } from '../hooks/useBilling';
import type { ClaimType, InvoiceResponseView } from '../types/billingTypes';

const STATUS_COLOR: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
  overdue: 'error',
  cancelled: 'default',
  written_off: 'default',
};

interface Props {
  patientId?: string;
  onViewInvoice: (id: string) => void;
  onNewInvoice?: () => void;
}

export const InvoiceList: React.FC<Props> = ({
  patientId,
  onViewInvoice,
  onNewInvoice,
}) => {
  const [statusFilter, setStatusFilter] = useState('');
  const [claimTypeFilter, setClaimTypeFilter] = useState('');

  const { data: invoicesResponse, isLoading, isError } = useInvoices({
    patientId,
    status: statusFilter || undefined,
    billingType: claimTypeFilter || undefined,
  });
  const invoices: InvoiceResponseView[] = invoicesResponse?.data ?? [];

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (isError) return <Alert role="alert" severity="error">Failed to load invoices.</Alert>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6">Invoices</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            select size="small" label="Status" value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 130 }}
          >
            <MenuItem value="">All</MenuItem>
            {(['draft','issued','partially_paid','paid','overdue','cancelled'] as const).map((s) => (
              <MenuItem key={s} value={s}>{s.replace('_', ' ')}</MenuItem>
            ))}
          </TextField>
          <TextField
            select size="small" label="Claim Type" value={claimTypeFilter}
            onChange={(e) => setClaimTypeFilter(e.target.value)} sx={{ minWidth: 130 }}
          >
            <MenuItem value="">All</MenuItem>
            {(['medicare','dva','ndis','private_health','self_funded'] as const).map((c) => (
              <MenuItem key={c} value={c}>{c.replace('_', ' ').toUpperCase()}</MenuItem>
            ))}
          </TextField>
          {onNewInvoice && (
            <Button variant="contained" size="small" onClick={onNewInvoice}>
              New Invoice
            </Button>
          )}
        </Box>
      </Box>

      {invoices.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No invoices found.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invoice #</TableCell>
              <TableCell>Patient</TableCell>
              <TableCell>Claim Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">Balance</TableCell>
              <TableCell>Due Date</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoices.map((inv) => {
              const claimType = (inv.claimType ?? inv.billingType ?? 'self_funded') as ClaimType;
              const total = inv.total ?? inv.totalCents / 100;
              const balance = inv.balance ?? inv.gapCents / 100;
              return (
              <TableRow
                key={inv.id} hover
                sx={{ cursor: 'pointer' }}
                onClick={() => onViewInvoice(inv.id)}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ color: 'primary.main' }}>
                    {inv.invoiceNumber}
                  </Typography>
                </TableCell>
                <TableCell>{inv.patientName}</TableCell>
                <TableCell>
                  <Chip
                    label={claimType.replace('_', ' ').toUpperCase()}
                    size="small" variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={inv.status.replace('_', ' ')}
                    size="small"
                    color={STATUS_COLOR[inv.status]}
                  />
                </TableCell>
                <TableCell align="right">${total.toFixed(2)}</TableCell>
                <TableCell
                  align="right"
                  sx={{ color: balance > 0 ? 'warning.main' : 'success.main' }}
                >
                  ${balance.toFixed(2)}
                </TableCell>
                <TableCell>{inv.dueDate ?? '—'}</TableCell>
                <TableCell>{inv.createdAt.split('T')[0]}</TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};
