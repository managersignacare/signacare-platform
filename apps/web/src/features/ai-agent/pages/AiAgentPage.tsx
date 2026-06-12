import AssessmentIcon from '@mui/icons-material/Assessment';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChatIcon from '@mui/icons-material/Chat';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import DescriptionIcon from '@mui/icons-material/Description';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SendIcon from '@mui/icons-material/Send';
import SummarizeIcon from '@mui/icons-material/Summarize';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel, MenuItem, Paper,
    Select, Tab, Tabs, TextField, Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { isDurableClinicalAiJobAction, requiresAsyncClinicalAiJob } from '@signacare/shared';
import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MarkdownRenderer } from '../../../shared/components/ui/MarkdownRenderer';
import { AiGeneratedNoteSaveDialog } from '../../../shared/components/ui/AiGeneratedNoteSaveDialog';
import { PrintExportButtons } from '../../../shared/components/ui/PrintExportButtons';
import { apiClient, LONG_RUNNING_AI_TIMEOUT_MS } from '../../../shared/services/apiClient';
import { llmAiJobsApi } from '../../../shared/services/llmAiJobsApi';
import { useAuthStore } from '../../../shared/store/authStore';
import { useThemeStore } from '../../../shared/theme/ThemeProvider';
import { PatientSearchAutocomplete, type PatientOption } from '../../patients/components/PatientSearchAutocomplete';
import {
  type AgentToolCall,
  type AiAlert,
  type AiAppointment,
  type AiClinicalNote,
  type AiContact,
  type AiEpisode,
  type AiMedication,
  type AiPatientContext,
  readArrayPayload,
  readErrorMessage,
} from './aiAgentPageSupport';
import { aiAgentKeys } from '../queryKeys';
import { useAvailableModels } from './aiAgentModels';
import { getPromptGroupsForRole } from './aiAgentPromptCatalog';
const AI_ACTIONS = [
  { id: 'maudsley', label: 'Generate Maudsley Summary', desc: 'Create a longitudinal psychiatric summary in Maudsley format', icon: <DescriptionIcon />, category: 'clinical' },
  { id: 'isbar', label: 'Generate ISBAR Handover', desc: 'Create an ISBAR clinical handover summary', icon: <PsychologyIcon />, category: 'clinical' },
  { id: 'formulation', label: 'Clinical Formulation', desc: 'Generate biopsychosocial formulation (4P framework)', icon: <PsychologyIcon />, category: 'clinical' },
  { id: '91day', label: '91-Day Review Summary', desc: 'Summarize the past 91 days of clinical engagement', icon: <AssessmentIcon />, category: 'clinical' },
  { id: 'letter', label: 'Generate Clinical Letter', desc: 'Draft a letter to GP, specialist, or other provider', icon: <DescriptionIcon />, category: 'clinical' },
  { id: 'ambient', label: 'Process Ambient Notes', desc: 'Convert ambient clinical notes into structured SOAP format', icon: <AutoAwesomeIcon />, category: 'clinical' },
  { id: 'admin-report', label: 'Admin Report', desc: 'Generate service statistics, caseload, or activity reports', icon: <SummarizeIcon />, category: 'admin' },
  { id: 'register-summary', label: 'Registration Summary', desc: 'Summarise referral/intake data for patient registration', icon: <PersonAddIcon />, category: 'admin' },
  { id: 'discharge', label: 'Discharge Summary', desc: 'Generate a comprehensive discharge summary', icon: <DescriptionIcon />, category: 'clinical' },
  { id: 'med-summary', label: 'Medication Summary', desc: 'Summarise medication history and changes over time', icon: <AssessmentIcon />, category: 'clinical' },
];

export default function AiAgentPage() {
  const [topTab, setTopTab] = useState<'clinical' | 'agent' | 'agentic'>('clinical');
  const navigate = useNavigate();
  const palette = useThemeStore((s) => s.palette);
  const bannerGradient = `linear-gradient(135deg, ${palette.sidebar} 0%, ${palette.secondary} 60%, ${palette.primary} 100%)`;
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: palette.background }}>
      {/* Hero Header */}
      <Box sx={{ background: bannerGradient, px: { xs: 2, md: 4 }, py: 3, borderRadius: '0 0 16px 16px', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AutoAwesomeIcon sx={{ color: '#fff', fontSize: 24 }} />
          </Box>
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#fff' }}>AI Clinical Assistant</Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              Local LLM — no patient data leaves your network
            </Typography>
          </Box>
          <Chip label="Local LLM" size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 10, ml: 'auto' }} />
        </Box>
        <Tabs aria-label="Navigation tabs" value={topTab} onChange={(_, v) => setTopTab(v)} sx={{ mt: 1, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', color: 'rgba(255,255,255,0.7)', '&.Mui-selected': { color: '#fff' } }, '& .MuiTabs-indicator': { bgcolor: '#fff' } }}>
          <Tab icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Clinical AI Tools" value="clinical" />
          <Tab icon={<ChatIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="AI Agent Chat" value="agent" />
          <Tab icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Agentic AI" value="agentic" />
        </Tabs>
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 } }}>
        {topTab === 'clinical' && <ClinicalAiPanel />}
        {topTab === 'agent' && <AgentChatPanel />}
        {topTab === 'agentic' && <AgenticAiLauncherPanel onOpen={() => navigate('/agentic-scribe')} />}
      </Box>
    </Box>
  );
}

/**
 * In-page launcher for the Agentic Scribe (Agentic AI) surface.
 *
 * AI Assistant keeps an in-page launcher for the Agentic Scribe
 * surface even though Medical Scribe is also exposed directly in the
 * sidebar. This preserves a cohesive AI workspace while still giving
 * clinicians a faster direct navigation path when they already know
 * they want scribe tooling.
 *
 * The Cmd-K palette shortcut `g y` still navigates here directly.
 * The Medical Scribe recorder also surfaces an Agentic AI button so
 * the recorder operator does not need to detour back to this page.
 */
function AgenticAiLauncherPanel({ onOpen }: { onOpen: () => void }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
      <Paper variant="outlined" sx={{ p: 4, maxWidth: 640, width: '100%', borderRadius: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 2, bgcolor: '#FFF3E0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 28 }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
              Agentic AI
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Multi-step clinical task drafts from your session transcript
            </Typography>
          </Box>
        </Box>
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
          Agentic AI proposes structured drafts (referrals, follow-up tasks, escalations)
          from an ambient or pasted clinical transcript and lets you accept or reject
          each draft individually. It is governed by the same on-prem LLM as the rest
          of the AI Assistant.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Button
            variant="contained"
            startIcon={<AutoAwesomeIcon />}
            onClick={onOpen}
            data-testid="aiagent-open-agentic-scribe"
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#a05418' }, textTransform: 'none', fontWeight: 600 }}
          >
            Open Agentic Scribe
          </Button>
          <Typography variant="caption" color="text.secondary">
            Cmd-K shortcut: <Chip label="g y" size="small" sx={{ ml: 0.5, height: 20, fontSize: 10 }} />
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}

function ClinicalAiPanel() {
  const navigate = useNavigate();
  const { data: models } = useAvailableModels();
  const [selectedAction, setSelectedAction] = useState('');
  const [inputText, setInputText] = useState('');
  const [result, setResult] = useState('');
  const [usedModel, setUsedModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [enriched, setEnriched] = useState(false);
  const [sectionCheck, setSectionCheck] = useState<{ valid: boolean; missing: string[] } | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [outlookStatus, setOutlookStatus] = useState<{ connected: boolean; email: string | null } | null>(null);

  React.useEffect(() => {
    apiClient
      .get<{ connected: boolean; email: string | null }>('integrations/outlook/status')
      .then(setOutlookStatus)
      .catch((err) => {
        console.warn('AiAgentPage: outlook status check failed', err);
      });
  }, []);

  const recommendedModel = React.useMemo(() => {
    if (!models?.length || !selectedAction) return '';
    const match = models.find(m => m.bestFor.includes(selectedAction) && m.available);
    return match?.id ?? '';
  }, [models, selectedAction]);

  const activeModel = recommendedModel;

  const loadPatientData = async (patientId: string) => {
    setAutoLoading(true);
    try {
      const strip = (html: string) => (html ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

      const [patient, notes, alerts, meds, episodes, contacts, appointments] = await Promise.all([
        apiClient.get<AiPatientContext>(`patients/${patientId}`),
        apiClient.get<{ notes?: AiClinicalNote[] } | AiClinicalNote[]>(`patients/${patientId}/notes`).then((r) => readArrayPayload<AiClinicalNote>(r, ['notes', 'data'])).catch((err) => { console.warn('AiAgentPage: query failed', err); return []; }),
        apiClient.get<{ alerts?: AiAlert[] } | AiAlert[]>(`patients/${patientId}/alerts`).then((r) => readArrayPayload<AiAlert>(r, ['alerts', 'data'])).catch((err) => { console.warn('AiAgentPage: query failed', err); return []; }),
        apiClient.get<{ data?: AiMedication[] } | AiMedication[]>(`medications/patients/${patientId}/medications`).then((r) => readArrayPayload<AiMedication>(r, ['data'])).catch((err) => { console.warn('AiAgentPage: query failed', err); return []; }),
        apiClient.get<{ data?: AiEpisode[] } | AiEpisode[]>(`episodes/patient/${patientId}`).then((r) => readArrayPayload<AiEpisode>(r, ['data'])).catch((err) => { console.warn('AiAgentPage: query failed', err); return []; }),
        apiClient.get<{ contacts?: AiContact[] } | AiContact[]>(`patients/${patientId}/contacts`).then((r) => readArrayPayload<AiContact>(r, ['contacts', 'data'])).catch((err) => { console.warn('AiAgentPage: query failed', err); return []; }),
        apiClient.get<{ data?: AiAppointment[]; appointments?: AiAppointment[] } | AiAppointment[]>(`appointments?patientId=${patientId}&limit=10`).then((r) => readArrayPayload<AiAppointment>(r, ['data', 'appointments'])).catch((err) => { console.warn('AiAgentPage: query failed', err); return []; }),
      ]);

      const p = patient;
      const activeMeds = meds.filter((m) => m.status === 'active');
      const ceasedMeds = meds.filter((m) => m.status === 'ceased');
      const activeAlerts = alerts.filter((a) => a.isActive);
      const openEpisodes = episodes.filter((e) => e.status === 'open');
      const closedEpisodes = episodes.filter((e) => e.status !== 'open');

      const sections: string[] = [];

      sections.push(`PATIENT DATA (Auto-populated from EMR)
Name: ${p.givenName} ${p.familyName}${p.preferredName ? ` (prefers ${p.preferredName})` : ''}
DOB: ${p.dateOfBirth} | Age: ${p.dateOfBirth ? Math.floor((Date.now() - new Date(p.dateOfBirth).getTime()) / 31557600000) : '?'} | Gender: ${p.gender || 'Not recorded'}
MRN: ${p.emrNumber} | Medicare: ${p.medicareNumber || 'N/A'}
ATSI: ${p.atsiStatus || 'Not recorded'} | Interpreter: ${p.interpreterRequired ? `Yes (${p.interpreterLanguage || 'not specified'})` : 'No'}
Address: ${[p.addressStreet, p.addressSuburb, p.addressState, p.addressPostcode].filter(Boolean).join(', ') || 'Not recorded'}
Phone: ${p.phoneMobile || 'N/A'} | Email: ${p.emailPrimary || 'N/A'}
${p.gpName ? `GP: ${p.gpName} at ${p.gpPractice || 'unknown'} (Ph: ${p.gpPhone || 'N/A'})` : ''}
${p.nokName ? `NOK: ${p.nokName} (${p.nokRelationship || 'unknown'}, Ph: ${p.nokPhone || 'N/A'})` : ''}`);

      if (contacts.length) {
        sections.push(`SUPPORT PERSONS (${contacts.length}):\n${contacts.map((c) => {
          const name = [c.givenName, c.familyName].filter(Boolean).join(' ') || 'Unknown';
          const roles = [c.isEmergencyContact && 'Emergency', c.isCarer && 'Carer'].filter(Boolean).join(', ');
          return `- ${name} (${c.relationship || 'unknown'})${roles ? ` — ${roles}` : ''}`;
        }).join('\n')}`);
      }

      if (episodes.length) {
        let epText = '';
        if (openEpisodes.length) {
          epText += `Active (${openEpisodes.length}):\n${openEpisodes.map((e) => `  - ${e.title || e.episodeType || 'Unknown'} (${e.team || 'No team'}, since ${e.startDate}) — Dx: ${e.primaryDiagnosis || 'Not recorded'}`).join('\n')}\n`;
        }
        if (closedEpisodes.length) {
          epText += `Historical (${closedEpisodes.length}):\n${closedEpisodes.slice(0, 5).map((e) => `  - ${e.title || e.episodeType || 'Unknown'} (${e.startDate} to ${e.endDate || '?'}) — ${e.closureReason || ''}`).join('\n')}`;
        }
        sections.push(`EPISODES (${episodes.length}):\n${epText}`);
      }

      if (activeMeds.length) {
        sections.push(`CURRENT MEDICATIONS (${activeMeds.length}):\n${activeMeds.map((m) =>
          `- ${m.medicationName} ${m.dose || ''} ${m.frequency || ''} (${m.route || 'unknown'})${m.isLai ? ' [LAI]' : ''}${m.isS8 ? ' [S8]' : ''}${m.isClozapine ? ' [Clozapine]' : ''}${m.indication ? ` — For: ${m.indication}` : ''}`
        ).join('\n')}`);
      }

      if (ceasedMeds.length) {
        sections.push(`CEASED MEDICATIONS (${ceasedMeds.length}):\n${ceasedMeds.slice(0, 10).map((m) =>
          `- ${m.medicationName} ${m.dose || ''} — ceased ${m.ceasedAt ? new Date(m.ceasedAt).toLocaleDateString('en-AU') : 'unknown'}${m.ceasedReason ? ` (${m.ceasedReason})` : ''}`
        ).join('\n')}`);
      }

      if (alerts.length) {
        let alertText = '';
        if (activeAlerts.length) {
          alertText += `Active (${activeAlerts.length}):\n${activeAlerts.map((a) => `  - ${a.title} (${a.alertSeverity}): ${a.notes || ''}`).join('\n')}\n`;
        }
        const resolved = alerts.filter((a) => !a.isActive);
        if (resolved.length) {
          alertText += `Resolved (${resolved.length}):\n${resolved.slice(0, 5).map((a) => `  - ${a.title} (resolved ${a.resolvedAt ? new Date(a.resolvedAt).toLocaleDateString('en-AU') : 'unknown'})`).join('\n')}`;
        }
        sections.push(`ALERTS (${alerts.length}):\n${alertText}`);
      }

      if (notes.length) {
        sections.push(`CLINICAL NOTES (last ${Math.min(notes.length, 10)}):\n${notes.slice(0, 10).map((n) => {
          const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-AU') : 'unknown';
          const content = strip(n.assessmentHtml ?? n.planHtml ?? n.bodyHtml ?? n.content ?? '');
          return `--- ${n.noteType || 'Note'} (${date}) by ${n.authorName || 'unknown'} ---\n${content.substring(0, 400)}${content.length > 400 ? '...' : ''}`;
        }).join('\n\n')}`);
      }

      if (appointments.length) {
        sections.push(`APPOINTMENTS (${appointments.length}):\n${appointments.slice(0, 5).map((a) =>
          `- ${a.startTime ? new Date(a.startTime).toLocaleDateString('en-AU') : 'unknown'} ${a.appointmentType || ''} — ${a.status || ''}`
        ).join('\n')}`);
      }

      setInputText(sections.join('\n\n'));
    } catch (err: unknown) {
      setInputText(`Error loading patient data: ${readErrorMessage(err, 'Unknown error')}`);
    } finally {
      setAutoLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedAction || !inputText.trim()) return;
    setLoading(true); setError(''); setResult(''); setUsedModel(''); setEnriched(false); setSectionCheck(null);
    try {
      if (
        isDurableClinicalAiJobAction(selectedAction)
        && requiresAsyncClinicalAiJob({
          action: selectedAction,
          patientId: selectedPatient?.id,
        })
      ) {
        const status = await llmAiJobsApi.runClinicalAiJobDetailed({
          action: selectedAction,
          data: inputText.trim(),
          model: activeModel || undefined,
          patientId: selectedPatient?.id,
          enhance: true,
        });
        const resultText = status.result?.trim();
        if (!resultText) {
          throw new Error('Clinical AI job completed without generated text.');
        }
        const jobResult = status.resultJson && typeof status.resultJson === 'object'
          ? status.resultJson as {
              model?: string;
              payload?: {
                enriched?: boolean;
                sections?: { valid: boolean; missing: string[] };
              };
            }
          : undefined;
        setResult(resultText);
        setUsedModel(jobResult?.model ?? activeModel);
        if (jobResult?.payload?.enriched) setEnriched(true);
        if (jobResult?.payload?.sections) setSectionCheck(jobResult.payload.sections);
      } else {
        const resp = await apiClient.post<{ result: string; model?: string; enriched?: boolean; sections?: { valid: boolean; missing: string[] } }>('llm/clinical-ai', {
          action: selectedAction,
          data: inputText.trim(),
          model: activeModel || undefined,
          patientId: selectedPatient ? selectedPatient.id : undefined,
          enhance: true,
        });
        setResult(resp.result);
        setUsedModel(resp.model ?? activeModel);
        if (resp.enriched) setEnriched(true);
        if (resp.sections) setSectionCheck(resp.sections);
      }
    } catch (err: unknown) {
      setError(readErrorMessage(err, 'AI generation failed. Ensure local Ollama is running.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim() || !result) return;
    setEmailSending(true);
    try {
      await apiClient.post('integrations/outlook/send-email', {
        to: emailTo.trim(),
        subject: emailSubject.trim() || `Clinical Correspondence — ${selectedPatient?.name ?? 'Patient'}`,
        body: result,
        recipientName: emailTo.split('@')[0],
        patientName: selectedPatient?.name ?? 'Patient',
        isLetter: ['letter', 'discharge', 'maudsley', 'isbar'].includes(selectedAction),
      });
      setEmailDialogOpen(false);
      setEmailTo(''); setEmailSubject('');
    } catch (err: unknown) {
      alert(`Failed to send: ${readErrorMessage(err, 'Outlook not connected')}`);
    } finally {
      setEmailSending(false);
    }
  };

  const [feedbackSent, setFeedbackSent] = React.useState(false);
  const sendFeedback = async (rating: number, accepted: boolean) => {
    try {
      await apiClient.post('llm/feedback', {
        action: selectedAction,
        modelUsed: usedModel || activeModel,
        inputText: inputText.substring(0, 4000),
        aiOutput: result.substring(0, 4000),
        wasAccepted: accepted,
        wasEdited: false,
        rating,
        patientId: selectedPatient?.id,
      });
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 3000);
    } catch { /* silent */ }
  };

  const clinicalActions = AI_ACTIONS.filter(a => a.category === 'clinical');
  const adminActions = AI_ACTIONS.filter(a => a.category === 'admin');

  return (
    <Box>
      {/* Patient Selection */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" fontWeight={600}>Patient:</Typography>
        {selectedPatient ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip label={selectedPatient.name} onDelete={() => { setSelectedPatient(null); setInputText(''); }} />
            <Button size="small" variant="outlined" onClick={() => loadPatientData(selectedPatient.id)} disabled={autoLoading}
              sx={{ borderColor: '#b8621a', color: '#b8621a', fontSize: 11 }}>
              {autoLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={14} /> : 'Load Data from EMR'}
            </Button>
          </Box>
        ) : (
          <PatientSearchField onSelect={(s) => setSelectedPatient(s)} />
        )}
      </Paper>

      {/* Action Selection — uniform grid */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" sx={{ color: '#327C8D', fontWeight: 700, letterSpacing: 1.5, display: 'block', mb: 1 }}>Clinical Documentation</Typography>
        <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
          {clinicalActions.map(action => {
            const isSelected = selectedAction === action.id;
            return (
              <Grid key={action.id} size={{ xs: 6, sm: 4, md: 3 }}>
                <Paper variant="outlined"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={action.label}
                  onClick={() => setSelectedAction(action.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAction(action.id); } }}
                  sx={{
                    p: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 1.5, borderRadius: 2, height: '100%',
                    borderColor: isSelected ? '#b8621a' : 'divider', borderWidth: isSelected ? 2 : 1,
                    bgcolor: isSelected ? '#FFF8F2' : '#fff',
                    boxShadow: isSelected ? '0 2px 8px rgba(184,98,26,0.15)' : 'none',
                    transition: 'all 0.2s', '&:hover': { borderColor: '#b8621a', transform: 'translateY(-1px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
                    '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 },
                  }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: isSelected ? '#b8621a' : '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                    <Box sx={{ color: isSelected ? '#fff' : '#3D484B', display: 'flex', '& svg': { fontSize: 18 } }}>{action.icon}</Box>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12, lineHeight: 1.3 }}>{action.label}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{action.desc}</Typography>
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
        <Typography variant="overline" sx={{ color: '#3D484B', fontWeight: 700, letterSpacing: 1.5, display: 'block', mb: 1 }}>Admin & Reports</Typography>
        <Grid container spacing={1.5}>
          {adminActions.map(action => {
            const isSelected = selectedAction === action.id;
            return (
              <Grid key={action.id} size={{ xs: 6, sm: 4, md: 3 }}>
                <Paper variant="outlined"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={action.label}
                  onClick={() => setSelectedAction(action.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAction(action.id); } }}
                  sx={{
                    p: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 1.5, borderRadius: 2, height: '100%',
                    borderColor: isSelected ? '#327C8D' : 'divider', borderWidth: isSelected ? 2 : 1,
                    bgcolor: isSelected ? '#E8F5F7' : '#fff',
                    boxShadow: isSelected ? '0 2px 8px rgba(50,124,141,0.15)' : 'none',
                    transition: 'all 0.2s', '&:hover': { borderColor: '#327C8D', transform: 'translateY(-1px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
                    '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 },
                  }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: isSelected ? '#327C8D' : '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                    <Box sx={{ color: isSelected ? '#fff' : '#3D484B', display: 'flex', '& svg': { fontSize: 18 } }}>{action.icon}</Box>
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12, lineHeight: 1.3 }}>{action.label}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{action.desc}</Typography>
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      </Box>

      {/* Input & Output */}
      {selectedAction && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Input</Typography>
              <TextField fullWidth multiline rows={12} value={inputText} onChange={e => setInputText(e.target.value)}
                placeholder={selectedAction === 'admin-report'
                  ? 'Describe the report you need: e.g. "Generate a caseload summary for the past month across all teams"'
                  : selectedAction === 'register-summary'
                  ? 'Paste referral letter, intake form, or triage notes to summarise for registration...'
                  : 'Paste clinical notes, patient data, or encounter transcript here...'}
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="contained" startIcon={loading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <SendIcon />}
                  onClick={handleGenerate} disabled={loading || !inputText.trim()}
                  sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
                  {loading ? 'Generating...' : 'Generate'}
                </Button>
              </Box>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2, borderLeft: '4px solid #b8621a' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={600}>AI Output</Typography>
                {usedModel && <Chip label={models?.find(m => m.id === usedModel)?.name ?? usedModel} size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#F3E5F5', color: '#7B1FA2' }} />}
              </Box>
              {error && <Alert role="alert" severity="error" sx={{ mb: 1 }}>{error}</Alert>}
              <Box sx={{ minHeight: 200, maxHeight: 400, overflowY: 'auto', bgcolor: '#FAFAFA', p: 2, borderRadius: 1 }}>
                {result ? <MarkdownRenderer content={result} /> : <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>(Output will appear here after generation)</Typography>}
              </Box>
              {/* Enhancement indicators */}
              {enriched && <Chip label="RAG Enriched" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#E8F5E9', color: '#2E7D32', mb: 1 }} />}
              {sectionCheck && !sectionCheck.valid && (
                <Alert role="alert" severity="warning" sx={{ mb: 1, fontSize: 11, py: 0.5 }}>
                  Missing sections: {sectionCheck.missing.join(', ')}. Consider regenerating.
                </Alert>
              )}

              {result && (
                <Box sx={{ mt: 1 }}>
                  {/* Rating + Feedback */}
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Rate this output:</Typography>
                    {[1, 2, 3, 4, 5].map(star => (
                      <Button key={star} size="small" onClick={() => sendFeedback(star, star >= 4)}
                        sx={{ minWidth: 28, p: 0.25, fontSize: 16, color: feedbackSent ? '#2E7D32' : '#b8621a', opacity: feedbackSent ? 0.5 : 1 }}>
                        {'★'}
                      </Button>
                    ))}
                    {feedbackSent && <Chip label="Feedback saved — helps improve AI" size="small" sx={{ fontSize: 10, height: 20, bgcolor: '#E8F5E9', color: '#2E7D32' }} />}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
                  <PrintExportButtons content={result} title={AI_ACTIONS.find(a => a.id === selectedAction)?.label ?? 'AI Output'} subtitle={selectedPatient?.name} />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                  {selectedPatient && (
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => setSaveDialogOpen(true)}
                      sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>Use in Note</Button>
                  )}
                  {outlookStatus?.connected && (
                    <Button size="small" variant="contained" onClick={() => {
                      setEmailSubject(`${AI_ACTIONS.find(a => a.id === selectedAction)?.label ?? 'Clinical Document'} — ${selectedPatient?.name ?? 'Patient'}`);
                      setEmailDialogOpen(true);
                    }} sx={{ bgcolor: '#0078D4', '&:hover': { bgcolor: '#106EBE' } }}>
                      Send via Outlook
                    </Button>
                  )}
                  {!selectedPatient && !outlookStatus?.connected && (
                    <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>Select patient to save / connect Outlook to send</Typography>
                  )}
                  </Box>
                </Box>
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      )}

      <AiGeneratedNoteSaveDialog
        open={saveDialogOpen}
        patientId={selectedPatient?.id ?? null}
        content={result}
        defaultTitle={`AI: ${AI_ACTIONS.find((action) => action.id === selectedAction)?.label ?? selectedAction}`}
        sourceKey={`ai_assistant:${selectedAction}`}
        sourceLabel="AI Assistant output"
        onClose={() => setSaveDialogOpen(false)}
        onSaved={() => {
          setSaveDialogOpen(false);
          if (selectedPatient) navigate(`/patients/${selectedPatient.id}`);
        }}
      />

      {/* Send via Outlook Dialog */}
      <Dialog aria-labelledby="dialog-title" open={emailDialogOpen} onClose={() => setEmailDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="img" src="https://img.icons8.com/color/24/microsoft-outlook-2019.png" alt="" sx={{ width: 24, height: 24 }} />
            Send via Outlook
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          {outlookStatus?.email && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              Sending from: {outlookStatus.email}
            </Typography>
          )}
          <TextField label="To (email address) *" fullWidth size="small" value={emailTo} onChange={e => setEmailTo(e.target.value)}
            placeholder="e.g. gp@clinic.com.au" sx={{ mb: 2 }} type="email" />
          <TextField label="Subject" fullWidth size="small" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} sx={{ mb: 2 }} />
          <Typography variant="caption" color="text.secondary">Email body preview:</Typography>
          <Box sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: '#FAFAFA', p: 1.5, borderRadius: 1, mt: 0.5, border: '1px solid #eee' }}>
            <MarkdownRenderer content={result.substring(0, 600) + (result.length > 600 ? '...' : '')} />
          </Box>
          <Alert severity="info" sx={{ mt: 2, fontSize: 11 }}>
            The email will be formatted as a professional clinical letter with your name, title, and a confidentiality notice.
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEmailDialogOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSendEmail} disabled={!emailTo.trim() || emailSending}
            sx={{ bgcolor: '#0078D4', '&:hover': { bgcolor: '#106EBE' } }}>
            {emailSending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Send Email'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface OrgUnitTreeNode {
  id: string;
  name: string;
  children?: OrgUnitTreeNode[];
}

interface OrgUnitOption {
  id: string;
  name: string;
}

function collectOrgUnitOptions(nodes: OrgUnitTreeNode[] | undefined): OrgUnitOption[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const byId = new Map<string, OrgUnitOption>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (typeof node.name === 'string' && node.name.trim().length > 0 && typeof node.id === 'string' && node.id.trim().length > 0) {
      byId.set(node.id, { id: node.id, name: node.name.trim() });
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function AgentChatPanel() {
  const palette = useThemeStore((s) => s.palette);
  const [messages, setMessages] = useState<{ role: 'user' | 'agent'; text: string; tools?: AgentToolCall[] }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [contextLevel, setContextLevel] = useState<'patient' | 'team' | 'org' | 'staff'>('org');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedStaff, setSelectedStaff] = useState('');
  const userRole = useAuthStore((s) => s.user?.role);
  const scrollRef = useRef<HTMLDivElement>(null);
  const promptGroups = useMemo(() => getPromptGroupsForRole(userRole), [userRole]);

  const { data: staffList } = useQuery({
    queryKey: aiAgentKeys.staffLookup(),
    queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string }[]>('staff/lookup').catch((err) => { console.warn('AiAgentPage: query failed', err); return []; }),
    staleTime: 60_000,
  });
  const { data: teamOptions = [] } = useQuery({
    queryKey: aiAgentKeys.orgUnitTree(),
    queryFn: async () => {
      const response = await apiClient
        .get<{ tree?: OrgUnitTreeNode[] } | OrgUnitTreeNode[]>('org-settings/units/tree')
        .catch((err) => {
          console.warn('AiAgentPage: query failed', err);
          return [];
        });
      const tree = Array.isArray(response)
        ? response
        : Array.isArray(response.tree)
          ? response.tree
          : [];
      return collectOrgUnitOptions(tree);
    },
    staleTime: 60_000,
  });

  const selectedTeam = teamOptions.find((team) => team.id === selectedTeamId);

  const handleSend = async (overrideInput?: string) => {
    if (loading) return;
    const userMsg = (overrideInput ?? input).trim();
    if (!userMsg) return;

    if (/\[(?:team\s*name|team|staff\s*name|staff)\]/i.test(userMsg)) {
      setMessages(prev => [
        ...prev,
        { role: 'agent', text: 'Please remove placeholder tags and ask directly using the selected context.' },
      ]);
      setLoading(false);
      return;
    }

    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);
    try {
      const selectedStaffRow = (staffList ?? []).find((s) => s.id === selectedStaff);
      const scope =
        contextLevel === 'patient' && patient
          ? { level: 'patient' as const, patientIds: [patient.id] }
          : contextLevel === 'team' && selectedTeam
            ? { level: 'team' as const, teamIds: [selectedTeam.id], teamLabels: [selectedTeam.name] }
            : contextLevel === 'staff' && selectedStaffRow
              ? {
                level: 'staff' as const,
                staffIds: [selectedStaffRow.id],
                staffLabels: [`${selectedStaffRow.givenName} ${selectedStaffRow.familyName}`.trim()],
              }
              : { level: 'clinic' as const };

      if (contextLevel === 'team' && !selectedTeam) {
        setMessages(prev => [
          ...prev,
          { role: 'agent', text: 'Select a team before running team-scoped prompts.' },
        ]);
        setLoading(false);
        return;
      }
      if (contextLevel === 'staff' && !selectedStaffRow) {
        setMessages(prev => [
          ...prev,
          { role: 'agent', text: 'Select a staff member before running staff-scoped prompts.' },
        ]);
        setLoading(false);
        return;
      }
      if (contextLevel === 'patient' && !patient) {
        setMessages(prev => [
          ...prev,
          { role: 'agent', text: 'Select a patient before running patient-scoped prompts.' },
        ]);
        setLoading(false);
        return;
      }

      const resp = await apiClient.instance.post<{ answer: string; toolCalls: AgentToolCall[]; iterations: number; model: string }>('llm/agent', {
        query: userMsg,
        patientId: patient?.id,
        purposeOfUse: 'clinical',
        scope,
      }, { timeout: LONG_RUNNING_AI_TIMEOUT_MS });
      setMessages(prev => [...prev, { role: 'agent', text: resp.data.answer, tools: resp.data.toolCalls }]);
    } catch (err: unknown) {
      setMessages(prev => [...prev, { role: 'agent', text: `Error: ${readErrorMessage(err, 'Agent unavailable.')}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 100);
    }
  };

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingSave, setPendingSave] = useState<{ title: string; content: string } | null>(null);

  const handlePromptClick = (q: string) => {
    void handleSend(q);
  };

  const openSaveDialogForMessage = (index: number) => {
    const message = messages[index];
    if (!message || message.role !== 'agent' || !patient) return;
    const previousUserMessage = [...messages.slice(0, index)]
      .reverse()
      .find((entry) => entry.role === 'user');
    const chatContent = [
      '# AI Agent Chat',
      '',
      previousUserMessage ? `## Prompt\n${previousUserMessage.text}` : null,
      '',
      '## Response',
      message.text,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    setPendingSave({
      title: `AI Agent Chat — ${new Date().toLocaleDateString('en-AU')}`,
      content: chatContent,
    });
  };

  return (
    <Box sx={{ display: 'flex', gap: 2 }}>
      {/* ── Left Sidebar: Prompts ── */}
      {sidebarOpen && (
        <Paper elevation={0} sx={{ width: 260, flexShrink: 0, border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 680 }}>
          <Box sx={{ px: 1.5, py: 1, bgcolor: palette.sidebar, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" fontWeight={700} sx={{ color: palette.sidebarText, fontSize: 11 }}>Quick Prompts</Typography>
            <IconButton size="small" onClick={() => setSidebarOpen(false)} sx={{ color: palette.sidebarText, p: 0.3 }}>
              <CloseFullscreenIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
            {promptGroups.map(g => (
              <Box key={g.title} sx={{ mb: 1.5 }}>
                <Typography variant="caption" fontWeight={700} sx={{ color: g.color, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5, px: 0.5 }}>
                  {g.title}
                </Typography>
                {g.prompts.map(q => (
                  <Box key={q}
                    role="button"
                    tabIndex={0}
                    aria-label={q}
                    onClick={() => handlePromptClick(q)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePromptClick(q); } }}
                    sx={{ px: 1, py: 0.5, borderRadius: 1, cursor: 'pointer', fontSize: 11, lineHeight: 1.4, color: '#3D484B',
                      '&:hover': { bgcolor: g.color + '12', color: g.color },
                      '&:focus-visible': { outline: `2px solid ${g.color}`, outlineOffset: -2 },
                      transition: 'all 0.15s' }}>
                    {q}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* ── Main Chat Area ── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {/* Context Bar */}
        <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 3, background: 'linear-gradient(180deg, #fff 0%, #FAFAFA 100%)' }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {!sidebarOpen && (
              <IconButton size="small" onClick={() => setSidebarOpen(true)} sx={{ border: '1px solid', borderColor: 'divider' }}>
                <OpenInFullIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Context</InputLabel>
              <Select value={contextLevel} onChange={e => setContextLevel(e.target.value as 'patient' | 'team' | 'org' | 'staff')} label="Context">
                <MenuItem value="org">Organisation</MenuItem>
                <MenuItem value="team">Team / Unit</MenuItem>
                <MenuItem value="staff">Staff Member</MenuItem>
                <MenuItem value="patient">Patient</MenuItem>
              </Select>
            </FormControl>

            {contextLevel === 'patient' && (
              patient ? (
                <Chip label={patient.name} onDelete={() => setPatient(null)} sx={{ height: 28 }} />
              ) : (
                <Box sx={{ flex: 1, maxWidth: 250 }}><PatientSearchField onSelect={(s) => setPatient(s)} /></Box>
              )
            )}
            {contextLevel === 'team' && (
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Team</InputLabel>
                <Select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)} label="Team">
                  <MenuItem value="">Select Team</MenuItem>
                  {teamOptions.length > 0 ? (
                    teamOptions.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)
                  ) : (
                    <MenuItem disabled value="__no_teams__">No teams found</MenuItem>
                  )}
                </Select>
              </FormControl>
            )}
            {contextLevel === 'staff' && (
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>Staff</InputLabel>
                <Select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} label="Staff">
                  <MenuItem value="">All Staff</MenuItem>
                  {(staffList ?? []).map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            {contextLevel === 'org' && (
              <Typography variant="caption" color="text.secondary">Current clinic data only</Typography>
            )}

            <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <Button size="small" variant="outlined" onClick={() => setMessages([])}
                sx={{ borderColor: 'divider', color: 'text.secondary', textTransform: 'none', fontSize: 11, minWidth: 50 }}>Clear</Button>
            </Box>
          </Box>
        </Paper>

        {/* Chat Area */}
        <Paper elevation={0} sx={{ flex: 1, height: 560, display: 'flex', flexDirection: 'column', border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}>
        <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', p: 2, background: 'linear-gradient(180deg, #FAFAFA 0%, #F5F3F0 100%)' }}>
          {!messages.length && (
            <Box sx={{ py: 3, px: 2 }}>
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <ChatIcon sx={{ fontSize: 40, opacity: 0.3, mb: 0.5 }} />
                <Typography variant="body1" fontWeight={600}>AI Clinical Agent</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 500, mx: 'auto' }}>
                  All answers come from your EMR database — no fabricated data. Select prompts from the sidebar or type your own query.
                </Typography>
              </Box>
            </Box>
          )}
          {messages.map((msg, i) => (
            <Box key={i} sx={{
              mb: 2.5, display: 'flex', gap: 1.5,
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              alignItems: 'flex-start',
              animation: 'fadeSlideIn 0.3s ease-out',
              '@keyframes fadeSlideIn': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
            }}>
              {/* Avatar */}
              <Box sx={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #327C8D 0%, #265F6B 100%)'
                  : 'linear-gradient(135deg, #b8621a 0%, #e06030 50%, #D32F2F 100%)',
                color: '#fff', fontSize: msg.role === 'user' ? 14 : 11, fontWeight: 700,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}>
                {msg.role === 'user' ? 'You' : 'AI'}
              </Box>
              <Box sx={{ maxWidth: '78%' }}>
                <Paper elevation={0} sx={{
                  p: 2,
                  borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  bgcolor: msg.role === 'user' ? '#E3F2FD' : '#fff',
                  border: '1px solid', borderColor: msg.role === 'user' ? '#BBDEFB' : '#E0E0E0',
                  boxShadow: msg.role === 'user' ? '0 1px 4px rgba(50,124,141,0.1)' : '0 1px 4px rgba(0,0,0,0.06)',
                }}>
                  {msg.role === 'agent'
                    ? <MarkdownRenderer content={msg.text} sx={{ fontSize: 13, lineHeight: 1.7 }} />
                    : <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7 }}>{msg.text}</Typography>}
                </Paper>
                {/* Action bar below agent messages */}
                {msg.role === 'agent' && msg.text.length > 50 && (
                  <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1, px: 0.5 }}>
                    <PrintExportButtons content={msg.text} title="AI Agent Response" compact />
                    {contextLevel === 'patient' && patient && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => openSaveDialogForMessage(i)}
                        sx={{ textTransform: 'none', minWidth: 0, px: 1 }}
                      >
                        Save to Episode
                      </Button>
                    )}
                    {msg.tools?.length ? (
                      <Box sx={{ display: 'flex', gap: 0.3, alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>Used:</Typography>
                        {msg.tools.map((t, j) => (
                          <Chip key={j} label={t.tool} size="small" sx={{ fontSize: 8, height: 18, bgcolor: '#F3E5F5', color: '#7B1FA2' }} />
                        ))}
                      </Box>
                    ) : null}
                  </Box>
                )}
              </Box>
            </Box>
          ))}
          {loading && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', mb: 2, animation: 'fadeSlideIn 0.3s ease-out', '@keyframes fadeSlideIn': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } } }}>
              <Box sx={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #b8621a, #e06030)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>AI</Box>
              <Paper elevation={0} sx={{ p: 2, borderRadius: '18px 18px 18px 4px', bgcolor: '#fff', border: '1px solid #E0E0E0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', gap: 0.4 }}>
                    {[0, 1, 2].map(k => (
                      <Box key={k} sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#b8621a', animation: 'bounce 1.4s ease-in-out infinite', animationDelay: `${k * 0.15}s`, '@keyframes bounce': { '0%, 80%, 100%': { opacity: 0.3, transform: 'scale(0.7)' }, '40%': { opacity: 1, transform: 'scale(1.1)' } } }} />
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>Analysing clinical data...</Typography>
                </Box>
              </Paper>
            </Box>
          )}
        </Box>

        {/* Input */}
        <Box sx={{ p: 2, borderTop: '1px solid #eee', bgcolor: '#fff', display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField fullWidth size="small" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void handleSend())}
            placeholder={contextLevel === 'team' && selectedTeam ? `Ask about ${selectedTeam.name}...` : contextLevel === 'patient' && patient ? `Ask about ${patient.name}...` : 'Ask the AI agent...'}
            multiline maxRows={3}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: '#FAFAFA' } }} />
          <Button id="agent-send-btn" variant="contained" onClick={() => void handleSend()} disabled={!input.trim() || loading}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, minWidth: 80, borderRadius: 2, height: 40 }}>Send</Button>
        </Box>
      </Paper>
      <AiGeneratedNoteSaveDialog
        open={pendingSave !== null}
        patientId={patient?.id ?? null}
        content={pendingSave?.content ?? ''}
        defaultTitle={pendingSave?.title ?? 'AI Agent Chat'}
        sourceKey="ai_agent_chat"
        sourceLabel="AI Agent patient chat"
        onClose={() => setPendingSave(null)}
        onSaved={() => setPendingSave(null)}
      />
      </Box>
    </Box>
  );
}

interface PatientSearchFieldProps {
  onSelect: (selection: { id: string; name: string } | null) => void;
}
function PatientSearchField({ onSelect }: PatientSearchFieldProps) {
  const [selected, setSelected] = React.useState<PatientOption | null>(null);
  return (
    <PatientSearchAutocomplete
      value={selected}
      onChange={(p) => {
        setSelected(p);
        const safeGiven = p?.givenName?.trim() || 'Unknown';
        const safeFamily = p?.familyName?.trim() || 'Unknown';
        const safeMrn = p?.emrNumber?.trim() || 'No MRN';
        onSelect(p ? { id: p.id, name: `${safeFamily}, ${safeGiven} (${safeMrn})` } : null);
      }}
      placeholder="Search patient by name or UR..."
      sx={{ minWidth: 300 }}
    />
  );
}
