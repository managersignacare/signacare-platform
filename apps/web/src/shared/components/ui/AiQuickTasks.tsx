import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DescriptionIcon from '@mui/icons-material/Description';
import GavelIcon from '@mui/icons-material/Gavel';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import SpeedIcon from '@mui/icons-material/Speed';
import {
    Autocomplete, Box, Button, Card, CardContent, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, Grid,
    InputLabel, MenuItem, Paper, Select, TextField, Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../services/apiClient';
import { sharedPatientQuickTaskKeys } from '../../queryKeys';
import { useAuthStore } from '../../store/authStore';
import { llmAiJobsApi } from '../../services/llmAiJobsApi';
import type { ClinicalAiJobAction } from '../../services/llmAiJobsApi';
import { MarkdownRenderer } from './MarkdownRenderer';

interface QuickTask {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  requiresPatient: boolean;
}

interface ErrorWithMessage {
  message?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as ErrorWithMessage;
  return maybe.message ?? fallback;
}

const QUICK_TASKS: QuickTask[] = [
  { id: 'med-certificate', label: 'Medical Certificate', description: 'Generate a medical certificate for work/study absence', icon: <DescriptionIcon />, requiresPatient: true },
  { id: 'mhrt-report', label: 'MHRT Report', description: 'Generate a Mental Health Review Tribunal report', icon: <GavelIcon />, requiresPatient: true },
  { id: 'discharge-summary', label: 'Discharge Summary', description: 'Generate a comprehensive discharge summary', icon: <LocalHospitalIcon />, requiresPatient: true },
  { id: 'ndis-report', label: 'NDIS Report', description: 'Generate an NDIS functional capacity / support needs report', icon: <AccessibilityNewIcon />, requiresPatient: true },
  { id: 'book-appointment', label: 'Book Appointment', description: 'AI generates 2-3 appointment options for you to select', icon: <CalendarMonthIcon />, requiresPatient: true },
  { id: 'risk-summary', label: 'Risk Summary', description: 'Generate a structured risk assessment summary', icon: <SpeedIcon />, requiresPatient: true },
];

function usePatientSearch(query: string) {
  return useQuery({
    queryKey: sharedPatientQuickTaskKeys.search(query),
    queryFn: () => apiClient.get<{ data: { id: string; givenName: string; familyName: string; emrNumber: string }[] }>('patients', { search: query, limit: 8 }),
    enabled: query.length >= 2,
    staleTime: 10_000,
  });
}

export function AiQuickTasksButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="small" startIcon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />} onClick={() => setOpen(true)}
        sx={{ color: '#b8621a', fontSize: 12, textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: 'rgba(240,133,44,0.08)' } }}>
        AI Tasks
      </Button>
      <AiQuickTasksDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

interface AiQuickTasksDialogProps { open: boolean; onClose: () => void }
function AiQuickTasksDialog({ open, onClose }: AiQuickTasksDialogProps) {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const clinicianName = user ? `Dr ${user.givenName} ${user.familyName}` : 'Treating Clinician';
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [patient, setPatient] = useState<{ id: string; label: string } | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const { data: searchResults } = usePatientSearch(searchInput);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const [jobAction, setJobAction] = useState('');

  // Appointment booking specific
  const [apptOptions, setApptOptions] = useState<{ time: string; type: string; mode: string }[]>([]);

  const task = QUICK_TASKS.find(t => t.id === selectedTask);

  const handleGenerate = async () => {
    if (!selectedTask || !patient) return;
    setLoading(true); setResult('');
    try {
      let action: ClinicalAiJobAction | null = null;
      let data = '';
      let templateType: string | undefined;
      switch (selectedTask) {
        case 'med-certificate': {
          action = 'certificate';
          const certDate = extraFields.date ? new Date(extraFields.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
          const certDuration = extraFields.duration || '1 day';
          const certReason = extraFields.reason || 'Medical treatment / Mental health care';
          data = `Generate a MEDICAL CERTIFICATE in the following exact format. Do NOT include Aboriginal status, interpreter status, or patient ID/UUID. Use the UR number as the patient identifier.

Attending Physician: ${clinicianName}
Date of certificate: ${certDate}

FORMAT (follow this structure exactly):

MEDICAL CERTIFICATE

Date: ${certDate}

To Whom It May Concern:

THIS IS TO CERTIFY that [Patient Full Name], UR: [Patient UR Number], Date of Birth: [Patient DOB],

was examined and treated at [Service Name] on ${certDate}, with the following diagnosis:

[Patient's current primary diagnosis from their clinical record]

And would need medical attention for ${certDuration} barring complication.

Reason: ${certReason}

This certificate is issued at the request of the patient for the purpose of [work/study absence].

${clinicianName}
(Attending Physician)

Signature: ________________________     Date: ${certDate}

IMPORTANT: Use the patient's actual name, UR number, date of birth, and diagnosis from their clinical record. Do NOT include Medicare number, Aboriginal status, interpreter status, or UUID. Keep the format clean and formal like a printed medical certificate.`;
          break;
        }
        case 'mhrt-report':
          action = 'mhrt-report';
          data = `Generate an MHRT (Mental Health Review Tribunal) report for this patient.
Include: current legal status, diagnosis and ICD-10 code, treatment history, current treatment plan (medications with doses, psychological interventions, social supports), mental state examination, risk assessment (to self, to others, vulnerability), treating team opinion on continued order with clinical justification, patient's expressed views, and least restrictive alternative analysis.
Reference: Mental Health Act 2014 (Vic). This is for a formal tribunal hearing.`;
          templateType = 'MHRT report';
          break;
        case 'discharge-summary':
          action = 'discharge';
          data = `Generate discharge summary for patient (ID: ${patient.id}).
Discharge date: ${extraFields.dischargeDate || new Date().toLocaleDateString('en-AU')}
Destination: ${extraFields.destination || 'Community care'}
Include: admission summary, diagnosis, treatment provided, medications at discharge, follow-up plan, GP recommendations.`;
          break;
        case 'ndis-report':
          action = 'letter';
          data = `Generate an NDIS functional capacity report for patient (ID: ${patient.id}).
Include: diagnosis, functional impact across domains (self-care, communication, social interaction, learning, mobility, self-management), support needs, recommended NDIS support categories and hours, goals.
Follow NDIS evidence guidelines for psychosocial disability.`;
          templateType = 'NDIS functional capacity report';
          break;
        case 'risk-summary':
          action = 'risk-summary';
          data = `Generate a structured risk assessment summary for patient (ID: ${patient.id}).
Include: risk to self (suicidal ideation, self-harm, overdose), risk to others (aggression, violence), vulnerability (exploitation, neglect, homelessness), historical risk factors, current protective factors, risk management plan.`;
          break;
        case 'book-appointment': {
          // Generate appointment options
          const weeks = parseInt(extraFields.weeks, 10) || 2;
          const mode = extraFields.mode || 'in-person';
          const baseDate = new Date();
          baseDate.setDate(baseDate.getDate() + weeks * 7);
          const opts = [
            { time: `${baseDate.toLocaleDateString('en-AU')} 09:00 AM`, type: 'Psychiatrist Review', mode },
            { time: `${new Date(baseDate.getTime() + 86400000).toLocaleDateString('en-AU')} 02:00 PM`, type: 'Psychiatrist Review', mode },
            { time: `${new Date(baseDate.getTime() + 2 * 86400000).toLocaleDateString('en-AU')} 10:30 AM`, type: 'Psychiatrist Review', mode },
          ];
          setApptOptions(opts);
          setResult(`Generated ${opts.length} appointment options for ${patient.label} (${mode}):\n\n${opts.map((o, i) => `Option ${i + 1}: ${o.time} — ${o.type} (${o.mode})`).join('\n')}`);
          setLoading(false);
          return;
        }
      }

      if (!action) {
        throw new Error(`Unsupported quick task: ${selectedTask}`);
      }

      setJobAction(action);
      const status = await llmAiJobsApi.runClinicalAiJobDetailed({
        action,
        data,
        patientId: patient.id,
        enhance: true,
        templateType,
      });
      const completed = status.result?.trim();
      if (!completed) {
        throw new Error('Clinical AI job completed without generated text.');
      }
      setResult(completed);
    } catch (error: unknown) {
      setResult(`Error: ${getErrorMessage(error, 'AI unavailable')}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAsNote = async () => {
    if (!patient || !result) return;
    try {
      await apiClient.post(`patients/${patient.id}/notes`, {
        title: `AI: ${task?.label ?? 'Quick Task'}`,
        noteType: 'progress',
        content: result,
        status: 'draft',
      });
      navigate(`/patients/${patient.id}?tab=notes`);
      onClose();
    } catch { /* ignore */ }
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeIcon sx={{ color: '#b8621a' }} />
        AI Quick Tasks
      </DialogTitle>
      <Divider />
      <DialogContent>
        {!selectedTask ? (
          <Grid container spacing={2}>
            {QUICK_TASKS.map(t => (
              <Grid key={t.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card variant="outlined"
                  role="button"
                  tabIndex={0}
                  aria-label={t.label}
                  onClick={() => setSelectedTask(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTask(t.id); } }}
                  sx={{ cursor: 'pointer', '&:hover': { borderColor: '#b8621a', transform: 'translateY(-2px)', boxShadow: 2 }, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 }, transition: 'all 0.15s', height: '100%' }}>
                  <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, color: '#b8621a' }}>{t.icon}
                      <Typography variant="subtitle2" fontWeight={600}>{t.label}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">{t.description}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Box>
            <Button size="small" onClick={() => { setSelectedTask(null); setResult(''); setApptOptions([]); }} sx={{ mb: 2, color: 'text.secondary' }}>
              ← Back to tasks
            </Button>
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>{task?.label}</Typography>

            {/* Patient Selector */}
            <Autocomplete
              options={(searchResults?.data ?? []).map(p => ({ id: p.id, label: `${p.familyName}, ${p.givenName} (${p.emrNumber})` }))}
              value={patient}
              onChange={(_, v) => setPatient(v)}
              inputValue={searchInput}
              onInputChange={(_, v) => setSearchInput(v)}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              renderInput={(params) => <TextField {...params} label="Select Patient *" size="small" />}
              sx={{ mb: 2 }}
            />

            {/* Task-specific fields */}
            {selectedTask === 'med-certificate' && (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="Reason" fullWidth size="small" value={extraFields.reason ?? ''} onChange={e => setExtraFields(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. Mental health treatment" /></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><TextField label="Duration" fullWidth size="small" value={extraFields.duration ?? ''} onChange={e => setExtraFields(p => ({ ...p, duration: e.target.value }))} placeholder="e.g. 1 week" /></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><TextField label="Date" type="date" fullWidth size="small" value={extraFields.date ?? new Date().toISOString().split('T')[0]} onChange={e => setExtraFields(p => ({ ...p, date: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
              </Grid>
            )}
            {selectedTask === 'discharge-summary' && (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6 }}><TextField label="Discharge Date" type="date" fullWidth size="small" value={extraFields.dischargeDate ?? new Date().toISOString().split('T')[0]} onChange={e => setExtraFields(p => ({ ...p, dischargeDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
                <Grid size={{ xs: 6 }}><TextField label="Destination" fullWidth size="small" value={extraFields.destination ?? ''} onChange={e => setExtraFields(p => ({ ...p, destination: e.target.value }))} placeholder="e.g. Community care, PARC" /></Grid>
              </Grid>
            )}
            {selectedTask === 'book-appointment' && (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6, sm: 4 }}><TextField label="In X Weeks" type="number" fullWidth size="small" value={extraFields.weeks ?? '2'} onChange={e => setExtraFields(p => ({ ...p, weeks: e.target.value }))} /></Grid>
                <Grid size={{ xs: 6, sm: 4 }}>
                  <FormControl fullWidth size="small"><InputLabel>Mode</InputLabel>
                    <Select value={extraFields.mode ?? 'in-person'} onChange={e => setExtraFields(p => ({ ...p, mode: e.target.value }))} label="Mode">
                      <MenuItem value="in-person">In Person</MenuItem>
                      <MenuItem value="telehealth">Telehealth</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField label="Invite (email)" fullWidth size="small" value={extraFields.invite ?? ''} onChange={e => setExtraFields(p => ({ ...p, invite: e.target.value }))} placeholder="doctor@clinic.com" />
                </Grid>
              </Grid>
            )}

            {!result && (
                <Button variant="contained" startIcon={loading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <AutoAwesomeIcon />}
                onClick={handleGenerate} disabled={loading || !patient}
                sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
                {loading ? `Generating${jobAction ? ` (${jobAction})` : ''}...` : 'Generate'}
              </Button>
            )}

            {/* Result */}
            {result && (
              <Paper variant="outlined" sx={{ p: 2, mt: 2, borderLeft: '4px solid #b8621a' }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>AI Output</Typography>
                <Box sx={{ maxHeight: 300, overflowY: 'auto', bgcolor: '#FAFAFA', p: 2, borderRadius: 1, border: '1px solid #eee' }}>
                  <MarkdownRenderer content={result} />
                </Box>

                {/* Appointment options — selectable */}
                {apptOptions.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Select an option to book:</Typography>
                    {apptOptions.map((opt, i) => (
                      <Button key={i} variant="outlined" fullWidth sx={{ mb: 1, justifyContent: 'flex-start', textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}
                        onClick={() => { navigate('/calendar'); onClose(); }}>
                        Option {i + 1}: {opt.time} — {opt.type} ({opt.mode})
                      </Button>
                    ))}
                  </Box>
                )}

                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  <Button size="small" variant="outlined" onClick={() => navigator.clipboard.writeText(result)}
                    sx={{ borderColor: '#327C8D', color: '#327C8D' }}>Copy</Button>
                  <Button size="small" variant="contained" onClick={handleSaveAsNote}
                    sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>Save as Note</Button>
                  <Button size="small" variant="outlined" onClick={() => { setResult(''); setApptOptions([]); }}
                    sx={{ color: '#b8621a', borderColor: '#b8621a' }}>Regenerate</Button>
                </Box>
              </Paper>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
