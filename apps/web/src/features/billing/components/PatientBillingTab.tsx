import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, Stack, Table, TableHead,
  TableRow, TableCell, TableBody, Button, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../services/billingApi';
import { billingKeys } from '../queryKeys';
import type { InvoiceResponse, ReferralValidityResponse } from '@signacare/shared';

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const statusColors: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  draft: 'default',
  pending_approval: 'warning',
  approved: 'info',
  sent: 'info',
  paid: 'success',
  partially_paid: 'warning',
  overdue: 'error',
  void: 'default',
};

interface Props {
  patientId: string;
}

export function PatientBillingTab({ patientId }: Props) {
  const qc = useQueryClient();
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralForm, setReferralForm] = useState({ name: '', number: '', type: 'gp', date: '' });

  // Billing account
  const { data: account } = useQuery({
    queryKey: billingKeys.account(patientId),
    queryFn: () => billingApi.getAccount(patientId),
  });

  // Active referral
  const { data: referralData } = useQuery({
    queryKey: billingKeys.referral(patientId),
    queryFn: () => billingApi.getActiveReferral(patientId),
  });

  // Invoices
  const { data: invoices, isLoading } = useQuery({
    queryKey: billingKeys.patientInvoices(patientId),
    queryFn: () => billingApi.listInvoicesByPatient(patientId),
  });

  const referralMut = useMutation({
    mutationFn: () => billingApi.createReferral({
      patientId,
      referringProviderName: referralForm.name,
      referringProviderNumber: referralForm.number || undefined,
      referralType: referralForm.type as 'gp' | 'specialist',
      referralDate: referralForm.date,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: billingKeys.referral(patientId) });
      setReferralOpen(false);
    },
  });

  const approveMut = useMutation({
    mutationFn: (invoiceId: string) => billingApi.approveInvoice(invoiceId, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: billingKeys.patientInvoices(patientId) }),
  });

  const referral: ReferralValidityResponse | null = referralData?.referral ?? null;
  const invoiceList: InvoiceResponse[] = invoices ?? [];
  const outstanding = invoiceList
    .filter((i) => !['paid', 'void', 'cancelled', 'written_off'].includes(i.status))
    .reduce((sum, i) => sum + (i.totalCents - i.paidCents), 0);

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        {/* Billing Account */}
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">Billing Account</Typography>
            {account ? (
              <>
                <Typography variant="body2">Type: <strong>{String(account.billingType ?? 'Not set').replace(/_/g, ' ')}</strong></Typography>
                {account.healthFundName && <Typography variant="body2">Fund: {account.healthFundName}</Typography>}
                {account.dvaNumber && <Typography variant="body2">DVA: {account.dvaNumber} ({account.dvaCardType})</Typography>}
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">No billing account configured</Typography>
            )}
          </CardContent>
        </Card>

        {/* Referral Status */}
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Typography variant="subtitle2" color="text.secondary">GP/Specialist Referral</Typography>
              <Button size="small" variant="outlined" onClick={() => setReferralOpen(true)}>
                Record Referral
              </Button>
            </Stack>
            {referral ? (
              <>
                <Typography variant="body2">
                  {referral.referringProviderName} ({referral.referralType.toUpperCase()})
                </Typography>
                <Typography variant="body2">
                  Expires: {referral.expiryDate}
                  {referral.isExpired ? (
                    <Chip label="EXPIRED" color="error" size="small" sx={{ ml: 1 }} />
                  ) : (
                    <Chip label={`${referral.daysRemaining} days`} color={referral.daysRemaining <= 30 ? 'warning' : 'success'} size="small" sx={{ ml: 1 }} />
                  )}
                </Typography>
              </>
            ) : (
              <Alert severity="warning" sx={{ mt: 1 }}>No valid referral on file. MBS billing requires a valid GP or specialist referral.</Alert>
            )}
          </CardContent>
        </Card>

        {/* Outstanding Balance */}
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary">Outstanding Balance</Typography>
            <Typography variant="h4" color={outstanding > 0 ? 'error.main' : 'success.main'}>
              {centsToDisplay(outstanding)}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {/* Invoice List */}
      <Typography variant="subtitle1" sx={{ mb: 1 }}>Invoices</Typography>
      {isLoading && <CircularProgress size={24} />}
      {!isLoading && invoiceList.length === 0 && <Alert severity="info">No invoices for this patient.</Alert>}
      {invoiceList.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invoice #</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>MBS Item</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Provider Fee</TableCell>
              <TableCell align="right">Gap</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invoiceList.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>{inv.invoiceNumber}</TableCell>
                <TableCell>{inv.createdAt?.split('T')[0]}</TableCell>
                <TableCell>{inv.lineItems?.[0]?.mbsItemNumber ?? '-'}</TableCell>
                <TableCell>{inv.billingType?.replace(/_/g, ' ')}</TableCell>
                <TableCell align="right">{centsToDisplay(inv.providerFeeCents)}</TableCell>
                <TableCell align="right">{centsToDisplay(inv.gapCents)}</TableCell>
                <TableCell align="right">{centsToDisplay(inv.totalCents)}</TableCell>
                <TableCell>
                  <Chip label={inv.status.replace(/_/g, ' ')} color={statusColors[inv.status] ?? 'default'} size="small" />
                  {inv.autoGenerated && <Chip label="Auto" size="small" sx={{ ml: 0.5 }} variant="outlined" />}
                </TableCell>
                <TableCell>
                  {inv.status === 'draft' && (
                    <Button size="small" variant="contained" onClick={() => approveMut.mutate(inv.id)} disabled={approveMut.isPending}>
                      Approve
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Record Referral Dialog */}
      <Dialog open={referralOpen} onClose={() => setReferralOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Record GP/Specialist Referral</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Referring Provider Name" size="small" fullWidth value={referralForm.name} onChange={(e) => setReferralForm({ ...referralForm, name: e.target.value })} />
            <TextField label="Provider Number (optional)" size="small" fullWidth value={referralForm.number} onChange={(e) => setReferralForm({ ...referralForm, number: e.target.value })} />
            <TextField select label="Referral Type" size="small" fullWidth value={referralForm.type} onChange={(e) => setReferralForm({ ...referralForm, type: e.target.value })}>
              <MenuItem value="gp">GP Referral (valid 12 months)</MenuItem>
              <MenuItem value="specialist">Specialist Referral (valid 3 months)</MenuItem>
            </TextField>
            <TextField label="Referral Date" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={referralForm.date} onChange={(e) => setReferralForm({ ...referralForm, date: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReferralOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!referralForm.name || !referralForm.date || referralMut.isPending} onClick={() => referralMut.mutate()}>
            Save Referral
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
