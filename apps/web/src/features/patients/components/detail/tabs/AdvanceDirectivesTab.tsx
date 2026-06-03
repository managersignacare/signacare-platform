/**
 * Advance Care Directives Tab
 * Mental Health Advance Directives, Nominated Persons
 */
import { useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem,
  Select, Snackbar, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DescriptionIcon from '@mui/icons-material/Description';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { advanceDirectivesKeys } from '../../../queryKeys';

interface AdvanceDirective {
  id: string; directive_type: string; status: string; document_date: string; expiry_date: string;
  treatment_preferences: string; refused_treatments: string; nominated_person_name: string;
  nominated_person_relationship: string; nominated_person_phone: string; crisis_instructions: string;
  notes: string; attachment_id?: string; attachment_filename?: string;
}

const DIRECTIVE_TYPES = [
  { id: 'mental_health_advance_directive', label: 'Mental Health Advance Directive' },
  { id: 'advance_care_directive', label: 'Advance Care Directive' },
  { id: 'nominated_person', label: 'Nominated Person Appointment' },
];

/** Format a YYYY-MM-DD date string for display without UTC shift */
function formatDateLocal(dateStr: string): string {
  if (!dateStr) return '';
  // Append T00:00:00 to force local-timezone parsing and avoid the off-by-one
  // bug that occurs when `new Date('YYYY-MM-DD')` is interpreted as UTC midnight.
  const d = new Date(dateStr.split('T')[0] + 'T00:00:00');
  return d.toLocaleDateString('en-AU');
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const withResponse = err as { response?: { data?: { error?: unknown } } };
    const apiError = withResponse.response?.data?.error;
    if (typeof apiError === 'string' && apiError.trim()) return apiError;
    const withMessage = err as { message?: unknown };
    if (typeof withMessage.message === 'string' && withMessage.message.trim()) return withMessage.message;
  }
  return 'Unknown';
}

interface AdvanceDirectivesTabProps { patientId: string }
export default function AdvanceDirectivesTab({ patientId }: AdvanceDirectivesTabProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ directiveType: 'mental_health_advance_directive' });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSnack, setUploadSnack] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMut = useMutation({
    mutationFn: async ({ file, directiveType }: { file: File; directiveType: string }) => {
      const label = `Advance Directive: ${DIRECTIVE_TYPES.find(t => t.id === directiveType)?.label ?? directiveType}`;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('label', label);
      formData.append('category', 'advance_directive');
      const resp = await apiClient.instance.post(`patients/${patientId}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return resp.data as { id: string };
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadSnack('Document uploaded successfully.');
      qc.invalidateQueries({ queryKey: advanceDirectivesKeys.byPatient(patientId) });
    },
    onError: () => {
      setUploadSnack('Failed to upload document. Please try again.');
    },
  });

  const { data: directives, isLoading } = useQuery({
    queryKey: advanceDirectivesKeys.byPatient(patientId),
    queryFn: () => apiClient.get<AdvanceDirective[]>(`advance-directives/patient/${patientId}`),
    enabled: !!patientId,
  });

  const saveMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.post('advance-directives', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: advanceDirectivesKeys.byPatient(patientId) }); setAddOpen(false); setForm({ directiveType: 'mental_health_advance_directive' }); },
    onError: (err: unknown) => alert(`Failed to save advance directive: ${getErrorMessage(err)}`),
  });

  const active = (directives ?? []).filter(d => d.status === 'active');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DescriptionIcon sx={{ color: '#1565C0' }} />
          <Typography variant="h6" fontWeight={600}>Advance Directives</Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#1565C0', '&:hover': { bgcolor: '#0D47A1' }, textTransform: 'none', fontSize: 12 }}>
          Add Directive
        </Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {!isLoading && active.length === 0 && (
        <Alert severity="info">No advance directives on file. Patients may create a Mental Health Advance Directive to express their treatment preferences.</Alert>
      )}

      <Grid container spacing={2}>
        {active.map(d => (
          <Grid key={d.id} size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={{ borderLeft: '4px solid #1565C0' }}>
              <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    {DIRECTIVE_TYPES.find(t => t.id === d.directive_type)?.label ?? d.directive_type}
                  </Typography>
                  <Chip label={d.status} size="small" color={d.status === 'active' ? 'success' : 'default'} sx={{ fontSize: 9 }} />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Dated: {formatDateLocal(d.document_date)}
                  {d.expiry_date && ` | Expires: ${formatDateLocal(d.expiry_date)}`}
                </Typography>
                {d.treatment_preferences && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" fontWeight={600} color="#327C8D">Treatment Preferences</Typography>
                    <Typography variant="body2" sx={{ fontSize: 12 }}>{d.treatment_preferences}</Typography>
                  </Box>
                )}
                {d.refused_treatments && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" fontWeight={600} color="#D32F2F">Refused Treatments</Typography>
                    <Typography variant="body2" sx={{ fontSize: 12 }}>{d.refused_treatments}</Typography>
                  </Box>
                )}
                {d.nominated_person_name && (
                  <Box sx={{ mt: 1, p: 1, bgcolor: '#E3F2FD', borderRadius: 1 }}>
                    <Typography variant="caption" fontWeight={600}>Nominated Person</Typography>
                    <Typography variant="body2">{d.nominated_person_name} ({d.nominated_person_relationship})</Typography>
                    {d.nominated_person_phone && <Typography variant="body2">{d.nominated_person_phone}</Typography>}
                  </Box>
                )}
                {d.crisis_instructions && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" fontWeight={600} color="#E65100">Crisis Instructions</Typography>
                    <Typography variant="body2" sx={{ fontSize: 12 }}>{d.crisis_instructions}</Typography>
                  </Box>
                )}
                {d.attachment_id && (
                  <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AttachFileIcon sx={{ fontSize: 16, color: '#1565C0' }} />
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<DescriptionIcon sx={{ fontSize: 14 }} />}
                      href={`${apiClient.instance.defaults.baseURL ?? ''}/patients/${patientId}/attachments/${d.attachment_id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ textTransform: 'none', fontSize: 12, color: '#1565C0', p: 0, minWidth: 0 }}
                    >
                      {d.attachment_filename ?? 'View Document'}
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Add Advance Directive</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={form.directiveType ?? ''} onChange={e => setForm(p => ({ ...p, directiveType: e.target.value }))} label="Type">
                  {DIRECTIVE_TYPES.map(t => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 3 }}><TextField label="Document Date" type="date" fullWidth size="small" value={form.documentDate ?? new Date().toISOString().split('T')[0]} onChange={e => setForm(p => ({ ...p, documentDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 3 }}><TextField label="Expiry Date" type="date" fullWidth size="small" value={form.expiryDate ?? ''} onChange={e => setForm(p => ({ ...p, expiryDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Treatment Preferences" fullWidth multiline rows={3} size="small" value={form.treatmentPreferences ?? ''} onChange={e => setForm(p => ({ ...p, treatmentPreferences: e.target.value }))} placeholder="Preferred treatments, medications, providers..." /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Refused Treatments" fullWidth multiline rows={2} size="small" value={form.refusedTreatments ?? ''} onChange={e => setForm(p => ({ ...p, refusedTreatments: e.target.value }))} placeholder="Treatments the person does not consent to..." /></Grid>
            <Grid size={{ xs: 12 }}><Divider><Typography variant="caption">Nominated Person</Typography></Divider></Grid>
            <Grid size={{ xs: 4 }}><TextField label="Name" fullWidth size="small" value={form.nominatedPersonName ?? ''} onChange={e => setForm(p => ({ ...p, nominatedPersonName: e.target.value }))} /></Grid>
            <Grid size={{ xs: 4 }}><TextField label="Relationship" fullWidth size="small" value={form.nominatedPersonRelationship ?? ''} onChange={e => setForm(p => ({ ...p, nominatedPersonRelationship: e.target.value }))} /></Grid>
            <Grid size={{ xs: 4 }}><TextField label="Phone" fullWidth size="small" value={form.nominatedPersonPhone ?? ''} onChange={e => setForm(p => ({ ...p, nominatedPersonPhone: e.target.value }))} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Crisis Instructions" fullWidth multiline rows={3} size="small" value={form.crisisInstructions ?? ''} onChange={e => setForm(p => ({ ...p, crisisInstructions: e.target.value }))} placeholder="What I want to happen if I become unwell and cannot express my wishes..." /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Notes" fullWidth multiline rows={2} size="small" value={form.notes ?? ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></Grid>
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }}><Typography variant="caption">Document Upload</Typography></Divider>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.tiff"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) setUploadFile(file);
                }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CloudUploadIcon />}
                  onClick={() => fileInputRef.current?.click()}
                  sx={{ textTransform: 'none', borderColor: '#1565C0', color: '#1565C0' }}
                >
                  {uploadFile ? 'Change File' : 'Attach Document'}
                </Button>
                {uploadFile && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <AttachFileIcon sx={{ fontSize: 16, color: '#1565C0' }} />
                    <Typography variant="caption" color="text.secondary">{uploadFile.name}</Typography>
                  </Box>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Upload a scanned or digital copy of the advance directive (PDF, JPG, PNG, TIFF).
              </Typography>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => { setAddOpen(false); setUploadFile(null); }}>Cancel</Button>
          <Button variant="contained" onClick={async () => {
            let attachmentId: string | undefined;
            if (uploadFile) {
              const uploadResult = await uploadMut.mutateAsync({ file: uploadFile, directiveType: form.directiveType });
              attachmentId = uploadResult?.id;
            }
            await saveMut.mutateAsync({
              patientId,
              ...form,
              ...(attachmentId ? { attachmentId, attachmentFilename: uploadFile?.name } : {}),
            });
          }}
            disabled={saveMut.isPending || uploadMut.isPending} sx={{ bgcolor: '#1565C0', '&:hover': { bgcolor: '#0D47A1' } }}>
            {saveMut.isPending || uploadMut.isPending ? 'Saving...' : 'Save Directive'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!uploadSnack} autoHideDuration={4000} onClose={() => setUploadSnack('')} message={uploadSnack} />
    </Box>
  );
}
