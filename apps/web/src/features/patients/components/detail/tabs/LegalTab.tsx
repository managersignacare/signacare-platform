import AddIcon from '@mui/icons-material/Add';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EditIcon from '@mui/icons-material/Edit';
import GavelIcon from '@mui/icons-material/Gavel';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel,
    MenuItem, Paper, Select, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import { llmAiJobsApi } from '../../../../../shared/services/llmAiJobsApi';
import AdvanceDirectivesTab from './AdvanceDirectivesTab';
import { legalOrdersKeys, patientsKeys, patientReferralsKeys } from '../../../queryKeys';

interface OrderType { id: string; name: string; category: string; isActive: boolean }
interface LegalOrder {
  id: string; orderTypeId: string; orderTypeName: string; orderCategory: string; orderNumber: string | null;
  startDate: string; endDate: string | null; reviewDate: string | null; nextApplicationDate: string | null;
  status: string; notes: string | null; aiSummary: string | null; enteredByName: string; createdAt: string;
  lockVersion: number;
}

const CATEGORY_LABELS: Record<string, string> = { mha: 'Mental Health Act', forensic: 'Forensic', guardianship: 'Guardianship & Administration', other: 'Other' };

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { response?: { data?: { error?: string } }; message?: string };
    return maybeError.response?.data?.error ?? maybeError.message ?? 'Unknown';
  }
  return 'Unknown';
}

interface LegalTabProps { patientId: string }
export function LegalTab({ patientId }: LegalTabProps) {
  const [tab, setTab] = useState<'orders' | 'advance'>('orders');
  return (
    <Box>
      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif' } }}>
        <Tab label="Legal Orders" value="orders" />
        <Tab label="Advance Statements" value="advance" />
      </Tabs>
      {tab === 'orders' && <OrdersPanel patientId={patientId} />}
      {tab === 'advance' && <AdvanceDirectivesTab patientId={patientId} />}
    </Box>
  );
}

// ============ Orders Panel ============

interface OrdersPanelProps { patientId: string }
function OrdersPanel({ patientId }: OrdersPanelProps) {
  const qc = useQueryClient();
  const { data: orderTypes } = useQuery({ queryKey: legalOrdersKeys.types(), queryFn: () => apiClient.get<{ types: OrderType[] }>('patients/legal-order-types').then(r => r.types) });
  const { data: orders, isLoading } = useQuery({ queryKey: legalOrdersKeys.byPatient(patientId), queryFn: () => apiClient.get<{ orders: LegalOrder[] }>(`patients/${patientId}/legal-orders`).then(r => r.orders), enabled: !!patientId });

  const createMut = useMutation({ mutationFn: (d: Record<string, unknown>) => apiClient.post(`patients/${patientId}/legal-orders`, d), onSuccess: () => qc.invalidateQueries({ queryKey: legalOrdersKeys.byPatient(patientId) }), onError: (err: unknown) => alert(`Failed to create legal order: ${getErrorMessage(err)}`) });
  const updateMut = useMutation({ mutationFn: ({ id, d }: { id: string; d: Record<string, unknown> }) => apiClient.patch(`patients/legal-orders/${id}`, d), onSuccess: () => qc.invalidateQueries({ queryKey: legalOrdersKeys.byPatient(patientId) }), onError: (err: unknown) => alert(`Failed to update legal order: ${getErrorMessage(err)}`) });

  const [addOpen, setAddOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<LegalOrder | null>(null);
  const [mhrtOpen, setMhrtOpen] = useState(false);
  const [mhrtContent, setMhrtContent] = useState('');
  const [mhrtLoading, setMhrtLoading] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactFormTitle, setContactFormTitle] = useState('');
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryText, setSummaryText] = useState('');

  // Form state
  const [orderTypeId, setOrderTypeId] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [nextAppDate, setNextAppDate] = useState('');
  const [status, setStatus] = useState('active');
  const [notes, setNotes] = useState('');

  const openAdd = () => {
    setEditOrder(null); setOrderTypeId(''); setOrderNumber(''); setStartDate(new Date().toISOString().split('T')[0]);
    setEndDate(''); setReviewDate(''); setNextAppDate(''); setStatus('active'); setNotes('');
    setAddOpen(true);
  };
  const openEdit = (o: LegalOrder) => {
    setEditOrder(o); setOrderTypeId(o.orderTypeId); setOrderNumber(o.orderNumber ?? '');
    setStartDate(o.startDate ?? ''); setEndDate(o.endDate ?? ''); setReviewDate(o.reviewDate ?? '');
    setNextAppDate(o.nextApplicationDate ?? ''); setStatus(o.status); setNotes(o.notes ?? '');
    setAddOpen(true);
  };

  const handleSave = async () => {
    if (!orderTypeId || !startDate) return;
    const data = { orderTypeId, orderNumber: orderNumber || undefined, startDate, endDate: endDate || undefined, reviewDate: reviewDate || undefined, nextApplicationDate: nextAppDate || undefined, status, notes: notes || undefined };
    if (editOrder) {
      await updateMut.mutateAsync({
        id: editOrder.id,
        // R-FIX-BUG-566-WEB-EXPECTED-LOCKVERSION
        d: { ...data, expectedLockVersion: editOrder.lockVersion },
      });
    }
    else { await createMut.mutateAsync(data); }
    setAddOpen(false);
  };

  const activeOrders = orders?.filter(o => o.status === 'active' || o.status === 'pending') ?? [];
  const expiredOrders = orders?.filter(o => o.status === 'expired' || o.status === 'revoked') ?? [];

  // Generate AI summary
  const aiSummary = React.useMemo(() => {
    if (!activeOrders.length) return 'No active legal orders.';
    const lines = activeOrders.map(o => {
      let line = `${o.orderTypeName} — active since ${new Date(o.startDate).toLocaleDateString('en-AU')}`;
      if (o.endDate) line += `, expires ${new Date(o.endDate).toLocaleDateString('en-AU')}`;
      if (o.reviewDate) line += `, review due ${new Date(o.reviewDate).toLocaleDateString('en-AU')}`;
      if (o.nextApplicationDate) line += `, next application ${new Date(o.nextApplicationDate).toLocaleDateString('en-AU')}`;
      return line;
    });
    return lines.join('\n');
  }, [activeOrders]);

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  return (
    <Box>
      {/* AI Summary */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderLeft: '4px solid #b8621a' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 20 }} />
            <Typography variant="subtitle2" fontWeight={600}>Legal Summary</Typography>
            <Chip label="AI Generated" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#E65100' }} />
          </Box>
          <Button size="small" onClick={() => { setSummaryEditing(!summaryEditing); setSummaryText(aiSummary); }} sx={{ fontSize: 11, color: '#b8621a' }}>
            {summaryEditing ? 'Cancel' : 'Edit'}
          </Button>
        </Box>
        {summaryEditing ? (
          <TextField fullWidth size="small" multiline rows={4} value={summaryText} onChange={e => setSummaryText(e.target.value)} />
        ) : (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-line', color: activeOrders.length ? '#3D484B' : 'text.secondary' }}>
            {aiSummary}
          </Typography>
        )}
      </Paper>

      {/* Current Orders */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} fontFamily="Albert Sans, sans-serif">Current Orders</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button startIcon={<AutoAwesomeIcon />} variant="outlined" size="small" onClick={() => setMhrtOpen(true)}
            sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}>Generate Tribunal Report</Button>
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={openAdd} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Add Order</Button>
        </Box>
      </Box>

      {activeOrders.length === 0 ? (
        <Alert severity="info" sx={{ mb: 3 }}>No active legal orders.</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
          {activeOrders.map(o => <OrderCard key={o.id} order={o} onEdit={() => openEdit(o)} />)}
        </Box>
      )}

      {expiredOrders.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Expired / Revoked Orders</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, opacity: 0.7 }}>
            {expiredOrders.map(o => <OrderCard key={o.id} order={o} onEdit={() => openEdit(o)} />)}
          </Box>
        </>
      )}

      {/* Add/Edit Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>{editOrder ? 'Edit Order' : 'Add Legal Order'}</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <FormControl fullWidth size="small" required>
                <InputLabel>Order Type *</InputLabel>
                <Select value={orderTypeId} onChange={e => setOrderTypeId(e.target.value)} label="Order Type *">
                  {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                    const items = orderTypes?.filter(t => t.category === cat) ?? [];
                    if (!items.length) return null;
                    return [
                      <MenuItem key={`hdr-${cat}`} disabled sx={{ fontWeight: 600, fontSize: 12, color: 'text.secondary' }}>— {label} —</MenuItem>,
                      ...items.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>),
                    ];
                  })}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Order Number"
                fullWidth
                size="small"
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 50 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>Status</InputLabel>
                <Select value={status} onChange={e => setStatus(e.target.value)} label="Status">
                  <MenuItem value="active">Active</MenuItem><MenuItem value="pending">Pending</MenuItem>
                  <MenuItem value="expired">Expired</MenuItem><MenuItem value="revoked">Revoked</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Start Date *" type="date" fullWidth size="small" value={startDate} onChange={e => setStartDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="End / Expiry Date" type="date" fullWidth size="small" value={endDate} onChange={e => setEndDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Review Date" type="date" fullWidth size="small" value={reviewDate} onChange={e => setReviewDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Next Application Date" type="date" fullWidth size="small" value={nextAppDate} onChange={e => setNextAppDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Notes" fullWidth size="small" multiline rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!orderTypeId || !startDate || createMut.isPending || updateMut.isPending}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {(createMut.isPending || updateMut.isPending) ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : editOrder ? 'Save Changes' : 'Add Order'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* MHRT Tribunal Report Dialog */}
      <Dialog aria-labelledby="dialog-title" open={mhrtOpen} onClose={() => setMhrtOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#327C8D' }} />
            Mental Health Review Tribunal Report
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          {!mhrtContent && !mhrtLoading && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Generate a comprehensive MHRT report from the patient's clinical data, legal orders, medications, and risk assessments.
              </Typography>
              <Button variant="contained" startIcon={mhrtLoading ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <AutoAwesomeIcon />}
                onClick={async () => {
                  setMhrtLoading(true);
                  try {
                    const context = `Patient legal orders: ${JSON.stringify(orders?.map((o) => ({ type: o.orderTypeName, status: o.status, startDate: o.startDate, endDate: o.endDate, notes: o.notes })) ?? [])}`;
                    const result = await llmAiJobsApi.runClinicalAiJob({
                      action: 'mhrt-report', data: context, patientId, enhance: true,
                    });
                    setMhrtContent(result);
                  } catch (err: unknown) {
                    setMhrtContent(`[Generation failed: ${getErrorMessage(err)}. Please write the report manually.]`);
                  }
                  setMhrtLoading(false);
                }}
                disabled={mhrtLoading}
                sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
                {mhrtLoading ? 'Generating...' : 'Generate Report with AI'}
              </Button>
            </Box>
          )}
          {mhrtLoading && <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /><Typography variant="caption" display="block" sx={{ mt: 1 }}>Generating tribunal report... this may take 1-2 minutes</Typography></Box>}
          {mhrtContent && !mhrtLoading && (
            <TextField fullWidth multiline rows={20} value={mhrtContent} onChange={e => setMhrtContent(e.target.value)}
              sx={{ mt: 1, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
          )}
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => { setMhrtOpen(false); setMhrtContent(''); }} sx={{ color: 'text.secondary' }}>Cancel</Button>
          {mhrtContent && (
            <Button variant="contained" onClick={async () => {
              await apiClient.post(`patients/${patientId}/notes`, {
                title: 'Mental Health Review Tribunal Report',
                noteType: 'report',
                content: mhrtContent,
                status: 'draft',
              });
              qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
              setMhrtOpen(false);
              setMhrtContent('');
              setContactFormTitle('Mental Health Review Tribunal Report');
              setContactFormOpen(true);
            }} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
              Save as Clinical Note
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <ContactFormDialog
        open={contactFormOpen}
        patientId={patientId}
        onClose={() => setContactFormOpen(false)}
        onSaved={() => {
          setContactFormOpen(false);
          qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
        }}
        initialNoteType="report"
        initialNoteTitle={contactFormTitle || 'Legal Report'}
      />
    </Box>
  );
}

// ============ Order Card ============

interface OrderCardProps { order: LegalOrder; onEdit: () => void }
function OrderCard({ order, onEdit }: OrderCardProps) {
  const statusColor = order.status === 'active' ? 'success' : order.status === 'pending' ? 'warning' : 'default';
  return (
    <Card variant="outlined" sx={{ borderLeft: `4px solid ${order.status === 'active' ? '#327C8D' : '#999'}` }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <GavelIcon sx={{ fontSize: 18, color: '#327C8D' }} />
              <Typography fontWeight={600} variant="body2">{order.orderTypeName}</Typography>
              <Chip label={order.status} size="small" color={statusColor} sx={{ fontSize: 10, height: 18, textTransform: 'capitalize' }} />
              <Chip label={CATEGORY_LABELS[order.orderCategory] || order.orderCategory} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
            </Box>
            <Box sx={{ ml: 3.5, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary"><strong>Start:</strong> {new Date(order.startDate).toLocaleDateString('en-AU')}</Typography>
              {order.endDate && <Typography variant="caption" color="text.secondary"><strong>Expires:</strong> {new Date(order.endDate).toLocaleDateString('en-AU')}</Typography>}
              {order.reviewDate && <Typography variant="caption" color={new Date(order.reviewDate) < new Date() ? 'error' : 'text.secondary'}><strong>Review:</strong> {new Date(order.reviewDate).toLocaleDateString('en-AU')}</Typography>}
              {order.nextApplicationDate && <Typography variant="caption" color="text.secondary"><strong>Next App:</strong> {new Date(order.nextApplicationDate).toLocaleDateString('en-AU')}</Typography>}
            </Box>
            {order.notes && <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5, mt: 0.5 }}>{order.notes}</Typography>}
          </Box>
          <Tooltip title="Edit"><IconButton size="small" aria-label="Edit order" onClick={onEdit}><EditIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
      </CardContent>
    </Card>
  );
}

export default LegalTab;
