/**
 * ABF Contact Form Banner
 *
 * Shows a persistent banner when the clinician has incomplete (draft) contact records.
 * Appears after saving a note, letter, or message.
 * Clicking opens a quick-fill dialog for the ABF fields.
 */

import AssignmentIcon from '@mui/icons-material/Assignment';
import {
    Alert, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
    Grid, InputLabel, MenuItem, Select, Switch, TextField, Typography
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { sharedContactFormKeys } from '../../queryKeys';

interface ContactRecord {
  id: string;
  patientId: string;
  sourceType: string;
  contactDate: string;
  contactType: string;
  serviceSetting: string | null;
  durationCategory: string | null;
  practitionerCategory: string | null;
  principalDiagnosis: string | null;
  patientPresent: boolean;
  didNotAttend: boolean;
  isReportable: boolean;
  status: string;
  briefSummary: string | null;
}

const CONTACT_TYPES = [
  'Face to face — Individual', 'Face to face — Group', 'Telephone', 'Video conference',
  'Home visit', 'Outreach', 'Case conference (without patient)', 'Non-face-to-face — Clinical documentation',
];
const SERVICE_SETTINGS = [
  'Community mental health centre', 'Patient home', 'Outpatient clinic',
  'Emergency department', 'Inpatient unit', 'Residential facility', 'Other',
];
const DURATIONS = ['< 15 minutes', '15–30 minutes', '30–45 minutes', '45–60 minutes', '60–90 minutes', '> 90 minutes'];
const PRACTITIONERS = ['Psychiatrist', 'Psychiatry Registrar', 'Psychologist', 'Clinical Psychologist', 'Mental Health Nurse', 'Social Worker', 'Occupational Therapist', 'Peer Support Worker', 'Other'];
export function ContactFormBanner() {
  const [open, setOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<ContactRecord | null>(null);
  const qc = useQueryClient();

  const { data: incompleteRecords } = useQuery({
    queryKey: sharedContactFormKeys.incomplete(),
    queryFn: () => apiClient.get<{ records: ContactRecord[] }>('contact-records/incomplete/mine').then(r => r.records),
    refetchInterval: 30_000,
  });

  const count = incompleteRecords?.length ?? 0;
  if (count === 0) return null;

  return (
    <>
      <Alert role="alert"
        severity="warning"
        icon={<AssignmentIcon />}
        action={
          <Button size="small" variant="outlined" onClick={() => { setEditRecord(incompleteRecords![0]); setOpen(true); }}
            sx={{ textTransform: 'none', borderColor: '#b8621a', color: '#b8621a' }}>
            Complete Now
          </Button>
        }
        sx={{ mb: 2, borderRadius: 2 }}
      >
        <Typography variant="body2" fontWeight={500}>
          {count} incomplete ABF contact form{count > 1 ? 's' : ''} — please complete for funding compliance
        </Typography>
      </Alert>

      {editRecord && (
        <ContactFormDialog
          open={open}
          record={editRecord}
          onClose={() => { setOpen(false); setEditRecord(null); }}
          onSaved={() => {
            setOpen(false);
            setEditRecord(null);
            qc.invalidateQueries({ queryKey: sharedContactFormKeys.all });
          }}
        />
      )}
    </>
  );
}

interface ContactFormDialogProps { open: boolean;
  record: ContactRecord;
  onClose: () => void;
  onSaved: () => void; }
function ContactFormDialog({ open, record, onClose, onSaved }: ContactFormDialogProps) {
  const [contactType, setContactType] = useState(record.contactType || 'Face to face — Individual');
  const [setting, setSetting] = useState(record.serviceSetting || '');
  const [duration, setDuration] = useState(record.durationCategory || '');
  const [practitioner, setPractitioner] = useState(record.practitionerCategory || '');
  const [patientPresent, setPatientPresent] = useState(record.patientPresent);
  const [dna, setDna] = useState(record.didNotAttend);
  const [reportable, setReportable] = useState(record.isReportable);
  const [summary, setSummary] = useState(record.briefSummary || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch(`contact-records/${record.id}`, {
        contactType,
        serviceSetting: setting,
        durationCategory: duration,
        practitionerCategory: practitioner,
        patientPresent,
        didNotAttend: dna,
        isReportable: reportable,
        briefSummary: summary,
        status: 'completed',
      });
      onSaved();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <AssignmentIcon sx={{ color: '#b8621a' }} />
        ABF Contact Form
        <Chip label={record.sourceType.replace('_', ' ')} size="small" sx={{ ml: 1, fontSize: 10 }} />
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Complete this form for Activity Based Funding reporting. Date: {record.contactDate}
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Contact Type</InputLabel>
              <Select value={contactType} onChange={e => setContactType(e.target.value)} label="Contact Type">
                {CONTACT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Service Setting</InputLabel>
              <Select value={setting} onChange={e => setSetting(e.target.value)} label="Service Setting">
                {SERVICE_SETTINGS.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Duration</InputLabel>
              <Select value={duration} onChange={e => setDuration(e.target.value)} label="Duration">
                {DURATIONS.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Practitioner</InputLabel>
              <Select value={practitioner} onChange={e => setPractitioner(e.target.value)} label="Practitioner">
                {PRACTITIONERS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 4 }}>
            <FormControlLabel control={<Switch checked={patientPresent} onChange={(_, v) => setPatientPresent(v)} size="small" />}
              label={<Typography variant="caption">Patient Present</Typography>} />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <FormControlLabel control={<Switch checked={dna} onChange={(_, v) => setDna(v)} size="small" color="error" />}
              label={<Typography variant="caption">DNA</Typography>} />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <FormControlLabel control={<Switch checked={reportable} onChange={(_, v) => setReportable(v)} size="small" color="success" />}
              label={<Typography variant="caption">ABF Reportable</Typography>} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth size="small" label="Brief Summary" value={summary} onChange={e => setSummary(e.target.value)}
              multiline rows={2} />
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Skip</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Complete & Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
