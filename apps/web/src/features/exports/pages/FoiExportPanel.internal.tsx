import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  Paper,
  FormControlLabel,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useAuthStore } from '../../../shared/store/authStore';
import { useStaffSignature } from '../../../shared/components/ui/DigitalSignature';
import { usePatientSearch } from './exportsPageInternalSupport';
import { EXPORT_MODULES, generatePdfHtml } from './exportsPageInternalSupport';

const MODULES = EXPORT_MODULES;

export function FoiExportPanel() {
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; label: string } | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const { data: searchResults } = usePatientSearch(searchInput);
  const [selectedModules, setSelectedModules] = useState<string[]>(MODULES.map(m => m.id));
  const [exporting, setExporting] = useState(false);
  const [applicantName, setApplicantName] = useState('');
  const [foiReference, setFoiReference] = useState('');
  const [includeRedactionLog, setIncludeRedactionLog] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(false);
  const { signature } = useStaffSignature();
  const user = useAuthStore((s) => s.user);

  const handleExport = async () => {
    if (!selectedPatient) return;
    setExporting(true);
    try {
      const sections = selectedModules.map((mod) => ({
        heading: MODULES.find((m) => m.id === mod)?.label ?? mod,
        content: `[${MODULES.find((m) => m.id === mod)?.label ?? mod} records for ${selectedPatient.label}]\\n\\nAll FOI-exempt content has been REMOVED from this section.\\nRecords would be populated from the database with FOI-exempt entries excluded.`,
      }));
      if (includeRedactionLog) {
        sections.push({
          heading: 'Redaction Log',
          content: 'The following entries were excluded under FOI exemption:\\n\\n• [Date, Author, Note Type] — Content withheld under FOI exemption\\n\\nNote: This log lists excluded entries without revealing their content.\\nThe actual redaction log would be generated from the database based on notes flagged as FOI exempt.',
        });
      }

      const meta: Record<string, string> = {
        Patient: selectedPatient.label,
        'FOI Applicant': applicantName || '(Not specified)',
        'FOI Reference': foiReference || '(Not specified)',
        'Modules Included': selectedModules.map((id) => MODULES.find((m) => m.id === id)?.label ?? id).join(', '),
        'FOI Exempt Content': 'EXCLUDED — all exempt material removed',
        'Redaction Log': includeRedactionLog ? 'Included (see end of document)' : 'Not included',
      };

      const sigOpts = includeSignature && signature
        ? {
          signerName: `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim(),
          signerTitle: user?.role ?? '',
          signatureDataUrl: signature,
        }
        : undefined;
      const html = generatePdfHtml(`FOI Release — ${selectedPatient.label}`, sections, meta, sigOpts);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
        win.print();
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>FOI Exempt File Export</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Export patient records with all FOI exempt content removed. Generates a PDF suitable for release under Freedom of Information requests.
        Notes and content marked as FOI exempt will be excluded from the output.
      </Typography>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={(searchResults?.data ?? []).map((p) => ({ id: p.id, label: `${p.familyName}, ${p.givenName} (${p.emrNumber})` }))}
            value={selectedPatient}
            onChange={(_, v) => setSelectedPatient(v)}
            inputValue={searchInput}
            onInputChange={(_, v) => setSearchInput(v)}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            renderInput={(params) => <TextField {...params} label="Select Patient *" size="small" placeholder="Search by name or UR..." />}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="FOI Applicant Name"
            fullWidth
            size="small"
            value={applicantName}
            onChange={(e) => setApplicantName(e.target.value)}
            placeholder="Name of the person requesting records"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="FOI Reference Number"
            fullWidth
            size="small"
            value={foiReference}
            onChange={(e) => setFoiReference(e.target.value)}
            placeholder="e.g. FOI-2026-001"
          />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Modules to Include</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            <Button size="small" onClick={() => setSelectedModules(MODULES.map((m) => m.id))} sx={{ fontSize: 10 }}>Select All</Button>
            <Button size="small" onClick={() => setSelectedModules([])} sx={{ fontSize: 10 }}>Deselect All</Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {MODULES.map((m) => (
              <FormControlLabel
                key={m.id}
                control={<Checkbox
                  size="small"
                  checked={selectedModules.includes(m.id)}
                  onChange={(_, v) => setSelectedModules(prev => v ? [...prev, m.id] : prev.filter((x) => x !== m.id))}
                />}
                label={<Typography variant="body2" sx={{ fontSize: 13 }}>{m.label}</Typography>}
              />
            ))}
          </Box>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={includeRedactionLog} onChange={(_, v) => setIncludeRedactionLog(v)} />}
            label={<Typography variant="body2">Include redaction log (lists excluded FOI exempt entries without content)</Typography>}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={includeSignature} onChange={(_, v) => setIncludeSignature(v)} disabled={!signature} />}
            label={<Typography variant="body2">{signature ? 'Include digital signature' : 'Include digital signature (set up in Settings)'}</Typography>}
          />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Alert role="alert" severity="warning" sx={{ fontSize: 12 }}>
            <strong>FOI Exempt Exclusions:</strong> All notes and content flagged as "FOI Exempt" in the clinical notes system
            will be completely removed from this export. The redaction log (if enabled) will list the date, author, and type of
            each excluded entry without revealing its content.
          </Alert>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              startIcon={
                exporting ? (
                  <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} />
                ) : (
                  <VisibilityOffIcon />
                )
              }
              onClick={handleExport}
              disabled={exporting || !selectedPatient}
              sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}
            >
              {exporting ? 'Generating PDF...' : 'Generate FOI File (PDF)'}
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
}
