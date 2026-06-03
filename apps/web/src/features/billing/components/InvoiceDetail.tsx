import React, { useState } from 'react';
import {
  Box, Typography, Grid, Divider, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, Button, TextField, MenuItem,
  CircularProgress, Alert, Paper, Dialog, DialogTitle,
  DialogContent, DialogActions,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useInvoice, useRecordPayment, useSubmitClaim, useCancelInvoice } from '../hooks/useBilling';
import {
  type ClaimType,
  RecordPaymentSchema,
  type ClaimResponse,
  type InvoiceResponseView,
  type RecordPaymentDTO,
} from '../types/billingTypes';
import type { PaymentCreateDTO } from '@signacare/shared';

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
  invoiceId: string;
  onBack?: () => void;
}

interface InvoiceLineItemView {
  id: string;
  mbsItemNumber?: string;
  description: string;
  serviceDate?: string;
  quantity: number;
  unitPrice: number;
  gstAmount: number;
  lineTotal: number;
}

interface InvoicePaymentView {
  id: string;
  paidAt: string;
  method: string;
  reference?: string | null;
  amount: number;
  notes?: string;
}

type InvoiceClaimView = ClaimResponse;

function deriveClaimType(invoice: InvoiceResponseView): ClaimType {
  if (invoice.claimType) return invoice.claimType;
  switch (invoice.billingType) {
    case 'dva':
      return 'dva';
    case 'ndis':
      return 'ndis';
    case 'private_health':
      return 'private_health';
    default:
      return 'self_funded';
  }
}

export const InvoiceDetail: React.FC<Props> = ({ invoiceId, onBack }) => {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const { data: invoiceRaw, isLoading, isError } = useInvoice(invoiceId);
  const invoice = invoiceRaw as InvoiceResponseView | null;
  const recordPayment = useRecordPayment();
  const submitClaim = useSubmitClaim();
  const cancelInvoice = useCancelInvoice();

  const today = new Date().toISOString().split('T')[0]!;

  const { control, handleSubmit, reset, formState: { errors } } = useForm<RecordPaymentDTO>({
    resolver: zodResolver(RecordPaymentSchema),
    defaultValues: {
      invoiceId,
      method: 'card',
      paidAt: today,
      amount: 0,
    },
  });

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (isError || !invoice)
    return <Alert role="alert" severity="error">Failed to load invoice.</Alert>;

  const lineItems = (invoice.lineItems ?? []) as unknown as InvoiceLineItemView[];
  const payments = (invoice.payments ?? []) as unknown as InvoicePaymentView[];
  const claims = (invoice.claims ?? []) as unknown as InvoiceClaimView[];
  const invoiceTotal = invoice.total ?? ((invoice.totalCents ?? 0) / 100);
  const invoiceGstTotal = invoice.gstTotal ?? ((invoice.gstCents ?? 0) / 100);
  const invoiceBalance = invoice.balance ?? ((invoice.totalCents ?? 0) - (invoice.paidCents ?? 0));

  const onPaymentSubmit = (data: RecordPaymentDTO) => {
    recordPayment.mutate(data as unknown as PaymentCreateDTO, {
      onSuccess: () => {
        setPaymentOpen(false);
        reset({ invoiceId, method: 'card', paidAt: today, amount: 0 });
      },
    });
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          {onBack && (
            <Button size="small" onClick={onBack} sx={{ mb: 0.5 }}>← Back</Button>
          )}
          <Typography variant="h5">{invoice.invoiceNumber}</Typography>
          <Typography variant="body2" color="text.secondary">
            {invoice.patientName ?? 'Patient'} · Created {invoice.createdAt.split('T')[0]}
            {invoice.dueDate ? ` · Due ${invoice.dueDate}` : ''}
          </Typography>
        </Box>
        <Chip label={invoice.status.replace('_', ' ')} color={STATUS_COLOR[invoice.status] ?? 'default'} />
      </Box>

      {/* Summary Row */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid>
          <Typography variant="caption" color="text.secondary">Billing Type</Typography>
          <Typography variant="body1">
            {(invoice.billingType ?? invoice.claimType ?? 'private').replace('_', ' ').toUpperCase()}
          </Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary">Subtotal</Typography>
          <Typography variant="body1">${((invoice.subtotalCents ?? invoice.subtotal ?? 0) / 100).toFixed(2)}</Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary">GST</Typography>
          <Typography variant="body1">${((invoice.gstCents ?? invoice.gstTotal ?? 0) / 100).toFixed(2)}</Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary">Total</Typography>
          <Typography variant="body1" fontWeight={700}>${((invoice.totalCents ?? invoice.total ?? 0) / 100).toFixed(2)}</Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary">Paid</Typography>
          <Typography variant="body1" color="success.main">${((invoice.paidCents ?? invoice.amountPaid ?? 0) / 100).toFixed(2)}</Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary">Balance</Typography>
          <Typography
            variant="body1"
            fontWeight={700}
            color={(invoice.balance ?? ((invoice.totalCents ?? 0) - (invoice.paidCents ?? 0))) > 0 ? 'warning.main' : 'success.main'}
          >
            ${(((invoice.totalCents ?? 0) - (invoice.paidCents ?? 0)) / 100).toFixed(2)}
          </Typography>
        </Grid>
      </Grid>

      {/* Line Items */}
      <Typography variant="subtitle1" sx={{ mb: 1 }}>Line Items</Typography>
      <Table size="small" sx={{ mb: 3 }}>
        <TableHead>
          <TableRow>
            <TableCell>MBS Item</TableCell>
            <TableCell>Description</TableCell>
            <TableCell>Service Date</TableCell>
            <TableCell align="right">Qty</TableCell>
            <TableCell align="right">Unit Price</TableCell>
            <TableCell align="right">GST</TableCell>
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lineItems.map((li: InvoiceLineItemView) => (
            <TableRow key={li.id}>
              <TableCell>{li.mbsItemNumber ?? '—'}</TableCell>
              <TableCell>{li.description}</TableCell>
              <TableCell>{li.serviceDate}</TableCell>
              <TableCell align="right">{li.quantity}</TableCell>
              <TableCell align="right">${li.unitPrice.toFixed(2)}</TableCell>
              <TableCell align="right">${li.gstAmount.toFixed(2)}</TableCell>
              <TableCell align="right">${li.lineTotal.toFixed(2)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={5} />
            <TableCell align="right"><strong>GST Total</strong></TableCell>
            <TableCell align="right">${invoiceGstTotal.toFixed(2)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell colSpan={5} />
            <TableCell align="right"><strong>Invoice Total</strong></TableCell>
            <TableCell align="right"><strong>${invoiceTotal.toFixed(2)}</strong></TableCell>
          </TableRow>
        </TableBody>
      </Table>

      {/* Payments */}
      <Typography variant="subtitle1" sx={{ mb: 1 }}>Payments</Typography>
      {payments.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No payments recorded.
        </Typography>
      ) : (
        <Table size="small" sx={{ mb: 3 }}>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Method</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Notes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payments.map((p: InvoicePaymentView) => (
              <TableRow key={p.id}>
                <TableCell>{p.paidAt.split('T')[0]}</TableCell>
                <TableCell sx={{ textTransform: 'capitalize' }}>{p.method.replace('_', ' ')}</TableCell>
                <TableCell>{p.reference ?? '—'}</TableCell>
                <TableCell align="right">${p.amount.toFixed(2)}</TableCell>
                <TableCell>{p.notes ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Claim Status */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>Claim Status</Typography>
        {claims.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No claims submitted.</Typography>
        ) : (
          claims.map((claim: InvoiceClaimView) => (
            <Box key={claim.id} sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1, alignItems: 'center' }}>
              <Chip label={claim.claimType.toUpperCase()} size="small" variant="outlined" />
              <Chip
                label={claim.claimStatus.replace('_', ' ')}
                size="small"
                color={
                  claim.claimStatus === 'approved' || claim.claimStatus === 'paid'
                    ? 'success'
                    : claim.claimStatus === 'rejected'
                      ? 'error'
                      : 'warning'
                }
              />
              {claim.claimReference && (
                <Typography variant="body2">Ref: {claim.claimReference}</Typography>
              )}
              {claim.approvedAmount != null && (
                <Typography variant="body2">Approved: ${claim.approvedAmount.toFixed(2)}</Typography>
              )}
              {claim.rejectionReason && (
                <Typography variant="body2" color="error.main">
                  Reason: {claim.rejectionReason}
                </Typography>
              )}
              {claim.submittedAt && (
                <Typography variant="caption" color="text.secondary">
                  Submitted: {claim.submittedAt.split('T')[0]}
                </Typography>
              )}
            </Box>
          ))
        )}
      </Paper>

      {invoice.notes && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Notes</Typography>
          <Typography variant="body2">{invoice.notes}</Typography>
        </Paper>
      )}

      {/* Actions */}
      <Divider sx={{ my: 2 }} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {invoiceBalance > 0 && invoice.status !== 'cancelled' && (
          <Button variant="contained" onClick={() => setPaymentOpen(true)}>
            Record Payment
          </Button>
        )}
        {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
          <Button
            variant="outlined"
            onClick={() => submitClaim.mutate({ invoiceId: invoice.id, claimType: deriveClaimType(invoice) })}
            disabled={submitClaim.isPending}
          >
            {submitClaim.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} /> : 'Submit Claim'}
          </Button>
        )}
        {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
          <Button
            variant="outlined"
            color="error"
            onClick={() => cancelInvoice.mutate(invoice.id)}
            disabled={cancelInvoice.isPending}
          >
            Cancel Invoice
          </Button>
        )}
      </Box>

      {/* Record Payment Dialog */}
      <Dialog aria-labelledby="dialog-title" open={paymentOpen} onClose={() => setPaymentOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Record Payment — {invoice.invoiceNumber}</DialogTitle>
        <Box component="form" onSubmit={handleSubmit(onPaymentSubmit)}>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            {recordPayment.isError && (
              <Alert role="alert" severity="error">Failed to record payment.</Alert>
            )}
            <Controller
              name="amount"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  onChange={(e) => field.onChange(parseFloat(e.target.value))}
                  label="Amount ($)"
                  type="number"
                  inputProps={{ step: '0.01', min: '0.01', max: invoiceBalance }}
                  fullWidth
                  error={!!errors.amount}
                  helperText={errors.amount?.message ?? `Max: $${invoiceBalance.toFixed(2)}`}
                />
              )}
            />
            <Controller
              name="method"
              control={control}
              render={({ field }) => (
                <TextField {...field} select label="Payment Method" fullWidth>
                  {(['cash','card','eft','cheque','bpay','online','medicare_rebate','other'] as const).map((m) => (
                    <MenuItem key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              name="paidAt"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Payment Date"
                  type="date"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  error={!!errors.paidAt}
                  helperText={errors.paidAt?.message}
                />
              )}
            />
            <Controller
              name="reference"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Reference / Receipt Number" fullWidth />
              )}
            />
            <Controller
              name="notes"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Notes" fullWidth multiline rows={2} />
              )}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setPaymentOpen(false)} disabled={recordPayment.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={recordPayment.isPending}>
              {recordPayment.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} /> : 'Record Payment'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
};
