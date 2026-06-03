import React, { useState, useRef } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, FormControl, InputLabel,
  MenuItem, Select, TextField, Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { patientsKeys } from '../../../queryKeys';

interface DocumentsTabProps { patientId: string }
type AttachmentDoc = {
  id?: string;
  filename?: string | null;
  label?: string | null;
  createdAt?: string | null;
  createdat?: string | null;
  downloadUrl?: string | null;
  download_url?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readAttachments(payload: unknown): AttachmentDoc[] {
  if (Array.isArray(payload)) return payload as AttachmentDoc[];
  if (!isRecord(payload)) return [];
  const maybe = payload.attachments;
  return Array.isArray(maybe) ? (maybe as AttachmentDoc[]) : [];
}
export function DocumentsTab({ patientId }: DocumentsTabProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: docs, isLoading } = useQuery({
    queryKey: patientsKeys.attachments(patientId),
    queryFn: () => apiClient.get<unknown>(`patients/${patientId}/attachments`).then(readAttachments),
    enabled: !!patientId,
  });

  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      return apiClient.instance.post(`patients/${patientId}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: patientsKeys.attachments(patientId) }),
    onError: (err: unknown) => {
      const msg = isRecord(err) && typeof err.message === 'string' ? err.message : 'Unknown';
      alert(`Upload failed: ${msg}`);
    },
  });

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) uploadMut.mutate(Array.from(e.target.files));
    e.target.value = '';
  };

  const filtered = (docs ?? []).filter((d) => {
    if (typeFilter && !d.label?.toLowerCase().includes(typeFilter.toLowerCase())) return false;
    const docDate = d.createdAt ?? d.createdat;
    if (dateFrom && docDate && new Date(docDate) < new Date(dateFrom)) return false;
    if (dateTo && docDate && new Date(docDate) > new Date(dateTo + 'T23:59:59')) return false;
    return true;
  });

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Documents</Typography>
        <Button startIcon={<CloudUploadIcon />} variant="contained" size="small" onClick={() => fileRef.current?.click()}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Upload Document</Button>
        <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.tiff" style={{ display: 'none' }} onChange={handleFiles} />
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 160 }}><InputLabel>Type</InputLabel>
          <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} label="Type" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Types</MenuItem>
            <MenuItem value="pathology">Pathology</MenuItem>
            <MenuItem value="physical">Physical Health</MenuItem>
            <MenuItem value="referral">Referral</MenuItem>
            <MenuItem value="legal">Legal</MenuItem>
            <MenuItem value="advance">Advance Directive</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
        </FormControl>
        <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }}
          value={dateFrom} onChange={e => setDateFrom(e.target.value)} sx={{ width: 160 }} />
        <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }}
          value={dateTo} onChange={e => setDateTo(e.target.value)} sx={{ width: 160 }} />
      </Box>

      {!filtered?.length ? (
        <Alert severity="info">No documents uploaded. Click &quot;Upload Document&quot; to add.</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {filtered.map((d, i: number) => {
            const createdOn = d.createdAt ?? d.createdat;
            return (
              <Card key={d.id ?? `doc-${i}`} variant="outlined"
                role="button"
                tabIndex={0}
                aria-label={`Download ${d.filename}`}
                onClick={() => { const url = d.downloadUrl ?? d.download_url; if (url) window.open(url, '_blank'); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const url = d.downloadUrl ?? d.download_url; if (url) window.open(url, '_blank'); } }}
                sx={{ cursor: 'pointer', '&:hover': { borderColor: '#b8621a' }, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 } }}>
                <CardContent sx={{ py: 1, '&:last-child': { pb: 1 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <AttachFileIcon sx={{ fontSize: 18, color: '#b8621a' }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={500} sx={{ color: '#327C8D', textDecoration: 'underline' }}>{d.filename}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {d.label || 'Document'} — {createdOn ? new Date(createdOn).toLocaleDateString('en-AU') : '—'}
                    </Typography>
                  </Box>
                  {d.label && <Chip label={d.label.split(':')[0]} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />}
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
export default DocumentsTab;
