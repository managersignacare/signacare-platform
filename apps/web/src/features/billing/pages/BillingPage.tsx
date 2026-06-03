import AddIcon from '@mui/icons-material/Add';
import {
    Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem, Paper, Select,
    Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs,
    TextField, Typography
} from '@mui/material';
import { useState } from 'react';

const MBS_ITEMS = [
  { code: '291', desc: 'Initial consultation (< 45 min)', fee: 185.30 },
  { code: '293', desc: 'Initial consultation (> 45 min)', fee: 280.45 },
  { code: '296', desc: 'Group psychotherapy', fee: 65.20 },
  { code: '300', desc: 'Subsequent attendance (< 15 min)', fee: 60.10 },
  { code: '302', desc: 'Subsequent attendance (15-30 min)', fee: 120.50 },
  { code: '304', desc: 'Subsequent attendance (30-45 min)', fee: 175.85 },
  { code: '306', desc: 'Subsequent attendance (> 45 min)', fee: 260.70 },
  { code: '2710', desc: 'Telepsychiatry initial (< 45 min)', fee: 185.30 },
  { code: '2712', desc: 'Telepsychiatry initial (> 45 min)', fee: 280.45 },
];

interface Invoice {
  id: string; patientName: string; mbsCode: string; description: string; fee: number;
  date: string; status: string; claimType: string;
}

const DEMO_INVOICES: Invoice[] = [];

export default function BillingPage() {
  const [tab, setTab] = useState('invoices');
  const [addOpen, setAddOpen] = useState(false);

  const totalPending = DEMO_INVOICES.filter(i => i.status === 'pending').reduce((sum, i) => sum + i.fee, 0);
  const totalSubmitted = DEMO_INVOICES.filter(i => i.status === 'submitted').reduce((sum, i) => sum + i.fee, 0);
  const totalPaid = DEMO_INVOICES.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.fee, 0);

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>Billing</Typography>
          <Typography variant="body2" color="text.secondary">Medicare claims, DVA billing, and invoice management</Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>New Invoice</Button>
      </Box>

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 4 }}>
          <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Pending</Typography>
              <Typography variant="h5" fontWeight={700} color="#b8621a">${totalPending.toFixed(2)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 4 }}>
          <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Submitted</Typography>
              <Typography variant="h5" fontWeight={700} color="#327C8D">${totalSubmitted.toFixed(2)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 4 }}>
          <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Paid (MTD)</Typography>
              <Typography variant="h5" fontWeight={700} color="#3D484B">${totalPaid.toFixed(2)}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}>
        <Tab label="Invoices" value="invoices" />
        <Tab label="MBS Schedule" value="mbs" />
      </Tabs>

      {tab === 'invoices' && (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <TableContainer role="region" aria-label="Data table">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>{['Date', 'Patient', 'MBS Item', 'Description', 'Fee', 'Claim Type', 'Status'].map(c => <TableCell key={c} sx={{ fontWeight: 600, fontSize: 13, bgcolor: '#FBF8F5' }}>{c}</TableCell>)}</TableRow>
              </TableHead>
              <TableBody>
                {DEMO_INVOICES.map(inv => (
                  <TableRow key={inv.id} hover>
                    <TableCell sx={{ fontSize: 13 }}>{new Date(inv.date).toLocaleDateString('en-AU')}</TableCell>
                    <TableCell sx={{ fontWeight: 500 }}>{inv.patientName}</TableCell>
                    <TableCell><Chip label={inv.mbsCode} size="small" sx={{ fontSize: 11, height: 20 }} /></TableCell>
                    <TableCell sx={{ fontSize: 13 }}>{inv.description}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>${inv.fee.toFixed(2)}</TableCell>
                    <TableCell><Chip label={inv.claimType.replace('_', ' ')} size="small" variant="outlined" sx={{ fontSize: 10, height: 18, textTransform: 'capitalize' }} /></TableCell>
                    <TableCell><Chip label={inv.status} size="small" color={inv.status === 'paid' ? 'success' : inv.status === 'submitted' ? 'info' : 'warning'} sx={{ fontSize: 10, height: 20, textTransform: 'capitalize' }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {tab === 'mbs' && (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <TableContainer role="region" aria-label="Data table">
            <Table size="small">
              <TableHead>
                <TableRow>{['MBS Code', 'Description', 'Schedule Fee'].map(c => <TableCell key={c} sx={{ fontWeight: 600, fontSize: 13, bgcolor: '#FBF8F5' }}>{c}</TableCell>)}</TableRow>
              </TableHead>
              <TableBody>
                {MBS_ITEMS.map(m => (
                  <TableRow key={m.code} hover>
                    <TableCell><Chip label={m.code} size="small" sx={{ fontSize: 11, height: 20 }} /></TableCell>
                    <TableCell sx={{ fontSize: 13 }}>{m.desc}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>${m.fee.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* New Invoice Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>New Invoice</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField label="Patient Name" fullWidth size="small" placeholder="Search patient..." /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>MBS Item</InputLabel>
                <Select label="MBS Item" defaultValue="">
                  {MBS_ITEMS.map(m => <MenuItem key={m.code} value={m.code}>{m.code} — {m.desc}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>Claim Type</InputLabel>
                <Select label="Claim Type" defaultValue="bulk_bill">
                  <MenuItem value="bulk_bill">Bulk Bill (Medicare)</MenuItem>
                  <MenuItem value="dva">DVA</MenuItem>
                  <MenuItem value="private">Private</MenuItem>
                  <MenuItem value="ndis">NDIS</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Date of Service" type="date" fullWidth size="small" defaultValue={new Date().toISOString().split('T')[0]} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Fee ($)" type="number" fullWidth size="small" /></Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={() => setAddOpen(false)} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Create Invoice</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
